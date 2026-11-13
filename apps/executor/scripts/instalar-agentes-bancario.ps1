# Instala no computador do escritório os AGENTES CLONADOS do DG Brasil (esteira
# bancária) e os scripts deles. Regras: docs/agentes/clonagem/contrato-dos-clones.md.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File apps\executor\scripts\instalar-agentes-bancario.ps1
#   ... -Simular     mostra o que faria, sem gravar nada
#
# O que faz:
#   1. copia agentes\bancario\*-dg.md e os agentes da ponte (Porteiro, Arquivista,
#      Mensageiro, orquestrador) para %USERPROFILE%\.claude\agents;
#   2. copia agentes\scripts para C:\DGBrasil\agentes\scripts;
#   3. cria C:\DGBrasil\agentes\trabalho e, no Drive, DG BRASIL\CLIENTE BANCÁRIO e
#      DG BRASIL\BASE DE CONHECIMENTO;
#   4. cria C:\DGBrasil\agentes\escritorio.json a partir do exemplo, se não existir
#      (quem assina: preencher com os dados reais);
#   5. acrescenta os clones ao %APPDATA%\DGBrasil\ponte.json (guarda o anterior);
#   6. libera, na sessão do DG Brasil (C:\DGBrasil\sessao), as pastas dos clones
#      (guarda o settings.json anterior).
#
# NUNCA altera os agentes do escritório: só grava arquivos terminados em -dg.md e
# os quatro agentes da ponte. Não mexe em tarefas agendadas.
param(
  [string]$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path,
  [string]$Sessao = 'C:\DGBrasil\sessao',
  [string]$Drive = 'G:\Meu Drive',
  [switch]$Simular
)
$ErrorActionPreference = 'Stop'

function Passo($t) { Write-Host ''; Write-Host "== $t" -ForegroundColor Cyan }
function Ok($t) { Write-Host "  OK  $t" -ForegroundColor Green }
function Aviso($t) { Write-Host "  !   $t" -ForegroundColor Yellow }
function Faria($t) { Write-Host "  (simulação) $t" -ForegroundColor DarkGray }
function GravarTexto($caminho, $texto) {
  if ($Simular) { Faria "gravar $caminho"; return }
  [IO.File]::WriteAllText($caminho, $texto, (New-Object Text.UTF8Encoding($false)))
}
function CriarPasta($caminho) {
  if (Test-Path -LiteralPath $caminho) { return }
  if ($Simular) { Faria "criar a pasta $caminho"; return }
  New-Item -ItemType Directory -Force -Path $caminho | Out-Null
  Ok "Pasta criada: $caminho"
}

$Agentes = Join-Path $Repo 'agentes\bancario'
$Scripts = Join-Path $Repo 'agentes\scripts'
$DaPonte = Join-Path $Repo 'docs\mcp\pilotos\agentes'
if (-not (Test-Path $Agentes)) { throw "Não achei $Agentes. Rode de dentro do repositório dg-brasil." }

$Raiz = 'C:\DGBrasil\agentes'
$RaizDrive = Join-Path $Drive 'DG BRASIL'
$Clientes = Join-Path $RaizDrive 'CLIENTE BANCÁRIO'
$Base = Join-Path $RaizDrive 'BASE DE CONHECIMENTO'

# ── 1. agentes ───────────────────────────────────────────────────────────────
Passo 'Agentes clonados'
$Destino = Join-Path $env:USERPROFILE '.claude\agents'
CriarPasta $Destino
$clones = @(Get-ChildItem -Path $Agentes -Filter '*-dg.md' -File | Sort-Object Name)
if (-not $clones.Count) { throw "Nenhum agente em $Agentes." }
$nomes = @()
foreach ($f in $clones) {
  $m = Select-String -Path $f.FullName -Pattern '^name:\s*([a-z0-9-]+)\s*$' -List
  if (-not $m) { throw "$($f.Name) sem 'name:' no cabeçalho." }
  $nome = $m.Matches[0].Groups[1].Value
  if ("$nome.md" -ne $f.Name -or -not $nome.EndsWith('-dg')) { throw "$($f.Name): o 'name:' ($nome) tem de ser o nome do arquivo e terminar em -dg." }
  $nomes += $nome
  if ($Simular) { Faria "copiar $($f.Name)" } else { Copy-Item -LiteralPath $f.FullName -Destination (Join-Path $Destino $f.Name) -Force }
}
Ok "$($clones.Count) agentes: $($nomes -join ', ')"
# Agentes do kit que NÃO passam pela ponte (trabalham só com o pedido, sem pasta do cliente), como o de
# prazos das publicações: são instalados e liberados na sessão, mas não entram no ponte.json.
$Gerais = Join-Path $Repo 'agentes\geral'
$nomesGerais = @()
if (Test-Path $Gerais) {
  foreach ($f in @(Get-ChildItem -Path $Gerais -Filter '*-dg.md' -File | Sort-Object Name)) {
    $m = Select-String -Path $f.FullName -Pattern '^name:\s*([a-z0-9-]+)\s*$' -List
    if (-not $m -or "$($m.Matches[0].Groups[1].Value).md" -ne $f.Name) { throw "$($f.Name): o 'name:' tem de ser o nome do arquivo." }
    $nomesGerais += $m.Matches[0].Groups[1].Value
    if ($Simular) { Faria "copiar $($f.Name)" } else { Copy-Item -LiteralPath $f.FullName -Destination (Join-Path $Destino $f.Name) -Force }
  }
  if ($nomesGerais.Count) { Ok "Fora da ponte: $($nomesGerais -join ', ')" }
}
foreach ($a in @('porteiro-dg', 'arquivista-dg', 'mensageiro-dg', 'orquestrador')) {
  $origem = Join-Path $DaPonte "$a.md"
  if (-not (Test-Path $origem)) { Aviso "Não achei $origem"; continue }
  if ($Simular) { Faria "copiar $a.md" } else { Copy-Item -LiteralPath $origem -Destination (Join-Path $Destino "$a.md") -Force }
}
Ok 'Agentes da ponte atualizados (Porteiro, Arquivista, Mensageiro, orquestrador)'

# ── 2. scripts ───────────────────────────────────────────────────────────────
Passo 'Scripts dos agentes'
CriarPasta $Raiz
CriarPasta (Join-Path $Raiz 'scripts')
CriarPasta (Join-Path $Raiz 'trabalho')
if (Test-Path $Scripts) {
  $arquivos = @(Get-ChildItem -Path $Scripts -File -Recurse | Where-Object { $_.FullName -notmatch '\\__pycache__\\' })
  foreach ($f in $arquivos) {
    $rel = $f.FullName.Substring($Scripts.Length).TrimStart('\')
    $para = Join-Path (Join-Path $Raiz 'scripts') $rel
    if ($Simular) { continue }
    New-Item -ItemType Directory -Force -Path (Split-Path $para) | Out-Null
    Copy-Item -LiteralPath $f.FullName -Destination $para -Force
  }
  if ($Simular) { Faria "copiar $($arquivos.Count) arquivos para $Raiz\scripts" } else { Ok "$($arquivos.Count) arquivos em $Raiz\scripts" }
} else { Aviso "Não achei ${Scripts}: os agentes vão falhar ao chamar os scripts." }

# ── 3. pastas do Drive ───────────────────────────────────────────────────────
Passo 'Pastas no Drive'
if (Test-Path -LiteralPath $Drive) {
  CriarPasta $RaizDrive; CriarPasta $Clientes; CriarPasta $Base
  Ok "Clientes em: $Clientes"
} else { Aviso "O Drive ($Drive) não está acessível. Abra o Google Drive para computador e rode de novo." }

# ── 4. quem assina ───────────────────────────────────────────────────────────
Passo 'Dados do escritório (quem assina)'
$Escritorio = Join-Path $Raiz 'escritorio.json'
if (Test-Path $Escritorio) {
  Ok "Mantido o $Escritorio que já existe"
} else {
  $exemplo = Join-Path $Repo 'agentes\escritorio.exemplo.json'
  if ($Simular) { Faria "criar $Escritorio a partir do exemplo" }
  elseif (Test-Path $exemplo) { Copy-Item -LiteralPath $exemplo -Destination $Escritorio; Aviso "Criado $Escritorio com dados FICTÍCIOS. Preencha com os dados reais do escritório antes de gerar peça ou kit." }
}

# ── 5. ponte.json ────────────────────────────────────────────────────────────
Passo 'Ponte (ponte.json)'
$Ponte = Join-Path $env:APPDATA 'DGBrasil\ponte.json'
$ficha = 'FICHA_REVISAO_*.md'
$minuta = @('MINUTA_*.docx', 'MINUTA_*.pdf', 'Memoria_Calculo_*.xlsx', 'MEMORIA_CALCULO_*.xlsx', $ficha)
$trazer = @{
  'clara-hiscon-dg'     = @('ROTEIRO_CONSIGNADO_*.html', 'ROTEIRO_CONSIGNADO_*.pdf', 'TETO_NORMATIVO_*.html', 'TETO_NORMATIVO_*.pdf', $ficha)
  'lucas-procuracao-dg' = @('Procuracao_*.pdf', 'Declaracao_Hipossuficiencia_*.pdf', 'Contrato_Honorarios_*.pdf', 'Declaracao_Residencia_*.pdf', $ficha)
  'alice-inicial-dg'    = $minuta + @('PARECER_*.docx', 'TABELA_*.docx', 'TABELA_*.xlsx')
}
if (Test-Path $Ponte) {
  $cfg = Get-Content -Raw -Encoding UTF8 $Ponte | ConvertFrom-Json
} else {
  CriarPasta (Split-Path $Ponte)
  $cfg = [pscustomobject]@{ raizes_permitidas = @(); pasta_pelo_nome = $false; antivirus = $true; agentes = [pscustomobject]@{} }
}
$raizes = @()
if ($cfg.PSObject.Properties['raiz_permitida'] -and $cfg.raiz_permitida) { $raizes += $cfg.raiz_permitida; $cfg.PSObject.Properties.Remove('raiz_permitida') }
if ($cfg.PSObject.Properties['raizes_permitidas']) { $raizes += @($cfg.raizes_permitidas) }
if ($raizes -notcontains $RaizDrive) { $raizes += $RaizDrive }
$cfg | Add-Member -NotePropertyName raizes_permitidas -NotePropertyValue @($raizes) -Force
if (-not $cfg.PSObject.Properties['agentes']) { $cfg | Add-Member -NotePropertyName agentes -NotePropertyValue ([pscustomobject]@{}) }
foreach ($nome in $nomes) {
  $padroes = if ($trazer.ContainsKey($nome)) { $trazer[$nome] } else { $minuta }
  $entrada = [ordered]@{ pasta = @($Clientes); nome_da_pasta = 'cliente'; trazer = @($padroes); profundidade = 1; dados_do_cadastro = $true; criar_pasta = $true }
  $cfg.agentes | Add-Member -NotePropertyName $nome -NotePropertyValue $entrada -Force
}
if ((Test-Path $Ponte) -and -not $Simular) { Copy-Item -LiteralPath $Ponte -Destination "$Ponte.anterior" -Force }
GravarTexto $Ponte ($cfg | ConvertTo-Json -Depth 8)
Ok "$($nomes.Count) clones no ponte.json, na pasta $Clientes (o anterior ficou em ponte.json.anterior)"

# ── 6. permissões da sessão do DG Brasil ─────────────────────────────────────
Passo 'Sessão do DG Brasil'
$Settings = Join-Path $Sessao '.claude\settings.json'
if (-not (Test-Path $Settings)) {
  Aviso "Não achei $Settings. Instale o conector do DG Brasil neste computador (docs/mcp/instalacao.md) e rode de novo."
} else {
  $s = Get-Content -Raw -Encoding UTF8 $Settings | ConvertFrom-Json
  $novas = @(
    'Read(//g/Meu Drive/DG BRASIL/**)', 'Edit(//g/Meu Drive/DG BRASIL/**)',
    'Read(//c/DGBrasil/agentes/**)', 'Edit(//c/DGBrasil/agentes/trabalho/**)',
    # modelos de recurso que o Rafael lê (só leitura; não é pasta de cliente)
    'Read(//g/Meu Drive/BASE DE CONHECIMENTO CLAUDE/**)'
  )
  $allow = @($s.permissions.allow)
  foreach ($r in $novas) { if ($allow -notcontains $r) { $allow += $r } }
  # A Vigia tira da lista os agentes que não chama: os clones precisam ficar.
  $liberar = @(($nomes + $nomesGerais) | ForEach-Object { "Agent($_)" }) + @('Agent(orquestrador)')
  $deny = @(@($s.permissions.deny) | Where-Object { $liberar -notcontains $_ })
  $s.permissions.allow = $allow
  $s.permissions.deny = $deny
  if (-not $Simular) { Copy-Item -LiteralPath $Settings -Destination "$Settings.anterior" -Force }
  GravarTexto $Settings ($s | ConvertTo-Json -Depth 8)
  Ok 'Pastas dos clones liberadas na sessão (o anterior ficou em settings.json.anterior)'
}

Write-Host ''
Write-Host 'Pronto.' -ForegroundColor Green
Write-Host '  - No DG Brasil (Agentes), o campo "Agente no Claude Code" de cada agente passa a ser o nome com -dg (ex.: clara-hiscon-dg).'
Write-Host '  - Feche e abra de novo a janela "DG Brasil - Vigia" para ela enxergar os agentes novos.'
Write-Host "  - Confira o $Escritorio (quem assina)."
