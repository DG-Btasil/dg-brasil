# Publica no DG Brasil uma versão nova do SETUP DO ESCRITÓRIO (migration 072):
# os agentes do kit (agentes\bancario, agentes\geral), os scripts deles
# (agentes\scripts), os agentes da ponte, o instalador dos agentes e os dados de
# quem assina (C:\DGBrasil\agentes\escritorio.json).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File apps\executor\scripts\publicar-setup.ps1
#   ... -Simular     monta o pacote e mostra o que enviaria, sem enviar
#
# Roda num computador do escritório JÁ AUTORIZADO (usa o token de
# %APPDATA%\DGBrasil\executor.json) e de dentro da cópia local do repositório,
# onde está a pasta agentes\ (que não vai para o GitHub: o repositório é público).
# O pacote vai para o bucket privado office-setup; a dona do escritório recebe um
# aviso no sino e, no próximo "Setup" em Sua conta e sessões, baixa esta versão.
param(
  [string]$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path,
  [string]$Escritorio = 'C:\DGBrasil\agentes\escritorio.json',
  [switch]$Simular
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Passo($t) { Write-Host ''; Write-Host "== $t" -ForegroundColor Cyan }
function Ok($t) { Write-Host "  OK  $t" -ForegroundColor Green }

# ── conferências ─────────────────────────────────────────────────────────────
$Bancario = Join-Path $Repo 'agentes\bancario'
if (-not (Test-Path $Bancario)) { throw "Não achei $Bancario. Rode de dentro da cópia local do dg-brasil, neste computador." }
if (-not (Test-Path -LiteralPath $Escritorio)) { throw "Não achei $Escritorio (quem assina). Rode o instalar-agentes-bancario.ps1 e preencha os dados reais." }
$exemplo = Join-Path $Repo 'agentes\escritorio.exemplo.json'
if ((Test-Path $exemplo) -and ((Get-FileHash -LiteralPath $Escritorio).Hash -eq (Get-FileHash -LiteralPath $exemplo).Hash)) {
  throw "$Escritorio ainda está com os dados FICTÍCIOS do exemplo. Preencha com os dados reais antes de publicar."
}
$null = Get-Content -Raw -Encoding UTF8 -LiteralPath $Escritorio | ConvertFrom-Json
$Cfg = Join-Path $env:APPDATA 'DGBrasil\executor.json'
if (-not (Test-Path -LiteralPath $Cfg)) { throw "Este computador não está conectado ao DG Brasil ($Cfg). Autorize em DG Brasil > Computador do escritório." }
$cfg = Get-Content -Raw -Encoding UTF8 -LiteralPath $Cfg | ConvertFrom-Json
$Base = "$($cfg.url)".TrimEnd('/')
$Token = "$($cfg.token)".Trim()
if ($Token -notmatch '^dgx_[A-Za-z0-9_-]{20,100}$') { throw "Token do computador inválido em $Cfg." }
$Versao = (Get-Content -Raw -Encoding UTF8 (Join-Path $Repo 'apps\executor\package.json') | ConvertFrom-Json).version

# ── pacote ───────────────────────────────────────────────────────────────────
Passo 'Montando o pacote'
$Tmp = Join-Path $env:TEMP ('dg-publicar-setup-' + [guid]::NewGuid().ToString('N'))
$Stage = Join-Path $Tmp 'pacote'
try {
  function Copiar($relativo) {
    $de = Join-Path $Repo $relativo
    if (-not (Test-Path -LiteralPath $de)) { return 0 }
    $n = 0
    foreach ($f in @(Get-ChildItem -LiteralPath $de -File -Recurse | Where-Object { $_.FullName -notmatch '\\__pycache__\\' -and $_.Extension -ne '.pyc' })) {
      $rel = $f.FullName.Substring($Repo.Length).TrimStart('\')
      $para = Join-Path $Stage $rel
      New-Item -ItemType Directory -Force -Path (Split-Path $para) | Out-Null
      Copy-Item -LiteralPath $f.FullName -Destination $para -Force
      $n++
    }
    return $n
  }
  $total = 0
  foreach ($p in @('agentes\bancario', 'agentes\geral', 'agentes\scripts', 'docs\mcp\pilotos\agentes')) { $total += Copiar $p }
  foreach ($arq in @('agentes\escritorio.exemplo.json', 'apps\executor\scripts\instalar-agentes-bancario.ps1')) {
    $para = Join-Path $Stage $arq
    New-Item -ItemType Directory -Force -Path (Split-Path $para) | Out-Null
    Copy-Item -LiteralPath (Join-Path $Repo $arq) -Destination $para -Force
    $total++
  }
  Copy-Item -LiteralPath $Escritorio -Destination (Join-Path $Stage 'escritorio.json') -Force
  $total++
  $Zip = Join-Path $Tmp 'setup.zip'
  Compress-Archive -Path (Join-Path $Stage '*') -DestinationPath $Zip -CompressionLevel Optimal
  $tamanho = (Get-Item -LiteralPath $Zip).Length
  $sha = (Get-FileHash -LiteralPath $Zip -Algorithm SHA256).Hash.ToLowerInvariant()
  $agentes = @(Get-ChildItem -LiteralPath $Stage -Recurse -Filter '*-dg.md' -File).Count
  Ok "$total arquivos ($agentes agentes), $([math]::Round($tamanho / 1KB)) KB, SHA-256 $($sha.Substring(0, 12))…"
  if ($Simular) { Write-Host "  (simulação) enviaria para $Base"; return }

  # ── envio ──────────────────────────────────────────────────────────────────
  Passo "Enviando para $Base"
  $h = @{ authorization = "Bearer $Token"; 'x-dg-client' = "dg-executor/$Versao" }
  function Api($caminho, $corpo) {
    try {
      return Invoke-RestMethod -Method Post -Uri "$Base/api/executor/v1/$caminho" -Headers $h -ContentType 'application/json' -Body ($corpo | ConvertTo-Json)
    } catch {
      $msg = $null
      try { $msg = ($_.ErrorDetails.Message | ConvertFrom-Json).error.message } catch { }
      throw ($(if ($msg) { $msg } else { $_.Exception.Message }))
    }
  }
  $prep = Api 'setup/prepare' @{ size = $tamanho; checksum_sha256 = $sha }
  Invoke-WebRequest -UseBasicParsing -Method Put -Uri $prep.upload_url -InFile $Zip -ContentType 'application/zip' -Headers @{ 'x-upsert' = 'false'; 'cache-control' = 'no-store' } | Out-Null
  $pub = Api "setup/$($prep.id)/publish" @{}
  Ok "Versão $($pub.version) publicada. A dona do escritório foi avisada no sino."
} finally {
  Remove-Item -LiteralPath $Tmp -Recurse -Force -ErrorAction SilentlyContinue
}
