# Setup do DG Brasil (migration 072): os agentes do kit (clones -dg), os scripts
# deles e os dados de quem assina, no computador do escritório.
#
# Quem chama é o lançador "Setup DG Brasil.cmd", que a dona do escritório baixa
# em Sua conta e sessões. Ele traz só um código de uso único (15 minutos, uma
# vez), em $env:DG_SETUP_CODE. Este arquivo é público e não tem segredo: sem o
# código, não baixa nada.
#
# O que faz:
#   1. troca o código pelo pacote (/api/setup/v1/baixar) e confere o SHA-256;
#   2. remove o setup anterior: os agentes que ele instalou em
#      %USERPROFILE%\.claude\agents e a pasta C:\DGBrasil\agentes\scripts.
#      NUNCA toca em C:\DGBrasil\agentes\trabalho nem nos agentes do escritório
#      (só arquivos terminados em -dg.md e o orquestrador.md);
#   3. grava o escritorio.json do pacote (o anterior fica em .anterior);
#   4. roda o instalador dos agentes que veio no pacote
#      (apps\executor\scripts\instalar-agentes-bancario.ps1);
#   5. anota a versão em C:\DGBrasil\agentes\setup.json.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Passo($texto) { Write-Host "`n==> $texto" -ForegroundColor Cyan }
function Ok($texto) { Write-Host "    OK  $texto" -ForegroundColor Green }
function Aviso($texto) { Write-Host "    AVISO  $texto" -ForegroundColor Yellow }
function Falha($texto) { Write-Host "`n    ERRO  $texto" -ForegroundColor Red; throw $texto }

$Codigo = "$env:DG_SETUP_CODE".Trim()
$Base = "$env:DG_BRASIL_URL".Trim().TrimEnd('/')
Remove-Item Env:DG_SETUP_CODE -ErrorAction SilentlyContinue
$Raiz = 'C:\DGBrasil\agentes'
$Agentes = Join-Path $env:USERPROFILE '.claude\agents'
$Manifesto = Join-Path $Raiz 'setup.json'
$Utf8 = New-Object System.Text.UTF8Encoding $false

Write-Host 'Setup do DG Brasil' -ForegroundColor White
if ($Codigo -notmatch '^dgs_[A-Za-z0-9_-]{40,60}$') { Falha 'Abra o arquivo "Setup DG Brasil" que foi baixado em Sua conta e sessões.' }
if ($Base -notmatch '^https?://[a-z0-9.-]+(:\d+)?$') { Falha 'Endereço do DG Brasil inválido. Baixe o setup de novo.' }

$Tmp = Join-Path $env:TEMP ('dg-setup-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $Tmp | Out-Null
try {
  # ── 1. pacote ─────────────────────────────────────────────────────────────
  Passo 'Baixando o setup'
  try {
    $r = Invoke-RestMethod -Method Post -Uri "$Base/api/setup/v1/baixar" -ContentType 'application/json' -Body (@{ code = $Codigo } | ConvertTo-Json)
  } catch {
    $msg = $null
    try { $msg = ($_.ErrorDetails.Message | ConvertFrom-Json).error.message } catch { }
    if (-not $msg) { $msg = 'Não foi possível falar com o DG Brasil. Confira a internet e baixe o setup de novo.' }
    Falha $msg
  }
  $Zip = Join-Path $Tmp 'setup.zip'
  Invoke-WebRequest -UseBasicParsing -Uri $r.url -OutFile $Zip
  $hash = (Get-FileHash -LiteralPath $Zip -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hash -ne $r.sha256) { Falha 'O arquivo baixado não confere com o DG Brasil. Nada foi instalado; baixe o setup de novo.' }
  $Pacote = Join-Path $Tmp 'pacote'
  Expand-Archive -LiteralPath $Zip -DestinationPath $Pacote -Force
  $Instalador = Join-Path $Pacote 'apps\executor\scripts\instalar-agentes-bancario.ps1'
  $EscritorioNovo = Join-Path $Pacote 'escritorio.json'
  if (-not (Test-Path -LiteralPath $Instalador) -or -not (Test-Path -LiteralPath $EscritorioNovo)) { Falha 'O pacote do setup está incompleto. Nada foi instalado.' }
  Ok "Versão $($r.version)"

  # ── 2. setup anterior ─────────────────────────────────────────────────────
  # O anterior vai para a pasta temporária (não é apagado de vez): se a instalação
  # falhar no meio, ele volta e o computador continua como estava.
  Passo 'Removendo o setup anterior'
  $Guardado = Join-Path $Tmp 'anterior'
  New-Item -ItemType Directory -Force -Path (Join-Path $Guardado 'agents') | Out-Null
  $removidos = @()
  if (Test-Path -LiteralPath $Agentes) {
    foreach ($f in @(Get-ChildItem -LiteralPath $Agentes -File | Where-Object { $_.Name -like '*-dg.md' -or $_.Name -eq 'orquestrador.md' })) {
      Move-Item -LiteralPath $f.FullName -Destination (Join-Path $Guardado 'agents') -Force
      $removidos += $f.Name
    }
  }
  $Scripts = Join-Path $Raiz 'scripts'
  $tinhaScripts = Test-Path -LiteralPath $Scripts
  if ($tinhaScripts) { Move-Item -LiteralPath $Scripts -Destination (Join-Path $Guardado 'scripts') -Force }
  New-Item -ItemType Directory -Force -Path $Raiz | Out-Null
  $Escritorio = Join-Path $Raiz 'escritorio.json'
  $tinhaEscritorio = Test-Path -LiteralPath $Escritorio
  if ($tinhaEscritorio) { Copy-Item -LiteralPath $Escritorio -Destination (Join-Path $Guardado 'escritorio.json') -Force }
  Ok "$($removidos.Count) agentes e a pasta de scripts removidos (a pasta de trabalho continua)"

  try {
    # ── 3. quem assina ──────────────────────────────────────────────────────
    if ($tinhaEscritorio) { Copy-Item -LiteralPath $Escritorio -Destination "$Escritorio.anterior" -Force }
    Copy-Item -LiteralPath $EscritorioNovo -Destination $Escritorio -Force

    # ── 4. agentes ──────────────────────────────────────────────────────────
    Passo 'Instalando a versão mais recente'
    & $Instalador -Repo $Pacote
  } catch {
    Aviso 'A instalação falhou. Voltando o setup anterior.'
    foreach ($nome in $removidos) { Copy-Item -LiteralPath (Join-Path (Join-Path $Guardado 'agents') $nome) -Destination (Join-Path $Agentes $nome) -Force }
    if (Test-Path -LiteralPath $Scripts) { Remove-Item -LiteralPath $Scripts -Recurse -Force }
    if ($tinhaScripts) { Move-Item -LiteralPath (Join-Path $Guardado 'scripts') -Destination $Scripts -Force }
    if ($tinhaEscritorio) { Copy-Item -LiteralPath (Join-Path $Guardado 'escritorio.json') -Destination $Escritorio -Force }
    Falha "$($_.Exception.Message)"
  }

  # ── 5. versão ─────────────────────────────────────────────────────────────
  $instalados = @()
  if (Test-Path -LiteralPath $Agentes) {
    $instalados = @(Get-ChildItem -LiteralPath $Agentes -File | Where-Object { $_.Name -like '*-dg.md' -or $_.Name -eq 'orquestrador.md' } | ForEach-Object { $_.BaseName } | Sort-Object)
  }
  $m = [ordered]@{ versao = $r.version; instalado_em = (Get-Date).ToString('s'); agentes = $instalados }
  [IO.File]::WriteAllText($Manifesto, ($m | ConvertTo-Json -Depth 4), $Utf8)

  if (-not (Test-Path -LiteralPath (Join-Path $env:APPDATA 'DGBrasil\executor.json'))) {
    Aviso 'Este computador ainda não está conectado ao DG Brasil. Autorize em DG Brasil > Computador do escritório e rode o comando que aparece lá.'
  }
  Write-Host "`nSetup instalado (versão $($r.version))." -ForegroundColor Green
  Write-Host '  Feche e abra de novo a janela "DG Brasil - Vigia".'
} finally {
  Remove-Item -LiteralPath $Tmp -Recurse -Force -ErrorAction SilentlyContinue
}
