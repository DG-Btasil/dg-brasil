# DG Brasil — conectar este computador do escritório (Roadmap 2.0)
#
# Uso (PowerShell, como a pessoa que vai usar o Claude Code):
#   irm https://app.dgbrasil.adv.br/executor/instalar.ps1 | iex
#
# O que faz, nesta ordem:
#   1. confere o Node.js (22 ou mais novo) e o Claude Code;
#   2. baixa o conector do DG Brasil para C:\DGBrasil\executor;
#   3. pede o TOKEN gerado no DG Brasil (DG Brasil → Computador do escritório)
#      e grava em %APPDATA%\DGBrasil\executor.json (só esta conta do Windows lê);
#   4. prepara a pasta de sessão C:\DGBrasil\sessao com as permissões seguras;
#   5. cria o atalho "DG Brasil - Vigia" na área de trabalho (sessão que
#      processa a fila sozinha a cada 15 minutos enquanto estiver aberta);
#   6. roda o diagnóstico.
# Nada aqui mexe em outras pastas, nos agendamentos atuais nem no Claude Code
# fora da pasta de sessão. Pode rodar de novo para atualizar.

$ErrorActionPreference = 'Stop'
$Base = if ($env:DG_BRASIL_URL) { $env:DG_BRASIL_URL.TrimEnd('/') } else { 'https://app.dgbrasil.adv.br' }
$Root = 'C:\DGBrasil'
$ExeDir = Join-Path $Root 'executor'
$Exe = Join-Path $ExeDir 'dg-executor.mjs'
$Sessao = Join-Path $Root 'sessao'
$Trabalhos = Join-Path $Sessao 'trabalhos'
$CfgDir = Join-Path $env:APPDATA 'DGBrasil'
$Cfg = Join-Path $CfgDir 'executor.json'
$Utf8 = New-Object System.Text.UTF8Encoding $false

function Passo($texto) { Write-Host "`n==> $texto" -ForegroundColor Cyan }
function Ok($texto) { Write-Host "    OK  $texto" -ForegroundColor Green }
function Aviso($texto) { Write-Host "    AVISO  $texto" -ForegroundColor Yellow }
function Falha($texto) { Write-Host "    ERRO  $texto" -ForegroundColor Red; throw $texto }
function Gravar($caminho, $conteudo) { [System.IO.File]::WriteAllText($caminho, $conteudo, $Utf8) }

Write-Host "DG Brasil — conectar o computador do escritório ($Base)" -ForegroundColor White

Passo 'Conferindo o Node.js e o Claude Code'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Falha 'Node.js não encontrado. Instale a versão LTS em https://nodejs.org e rode este comando de novo.' }
$versao = (& node --version).TrimStart('v')
if ([int]($versao.Split('.')[0]) -lt 22) { Falha "Node.js $versao é antigo. Instale a versão 22 ou mais nova (https://nodejs.org)." }
Ok "Node.js $versao"
if (Get-Command claude -ErrorAction SilentlyContinue) { Ok 'Claude Code instalado' } else { Aviso 'Claude Code não encontrado neste terminal. Instale e faça login antes de processar os trabalhos.' }

Passo 'Baixando o conector do DG Brasil'
New-Item -ItemType Directory -Force -Path $ExeDir, $Trabalhos, (Join-Path $Sessao '.claude'), $CfgDir | Out-Null
Invoke-WebRequest -UseBasicParsing -Uri "$Base/executor/dg-executor.mjs" -OutFile $Exe
Ok $Exe

Passo 'Token deste computador'
$token = $env:DG_BRASIL_TOKEN
if (-not $token) {
  Write-Host '    No DG Brasil: DG Brasil → Computador do escritório → Autorizar computador → Gerar token.'
  $seguro = Read-Host '    Cole o token (dgx_...) e tecle Enter' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro)
  try { $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
$token = $token.Trim()
if (-not $token.StartsWith('dgx_')) { Falha 'O token começa com "dgx_". Gere de novo no DG Brasil e cole o texto inteiro.' }
$config = [ordered]@{ url = $Base; token = $token; pasta_trabalhos = $Trabalhos } | ConvertTo-Json
Gravar $Cfg $config
try {
  # Só a conta atual do Windows lê o arquivo do token.
  & icacls $Cfg /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
} catch { Aviso 'Não foi possível restringir as permissões do arquivo do token.' }
Ok $Cfg
Remove-Variable token, config -ErrorAction SilentlyContinue

Passo 'Preparando a pasta de sessão (permissões seguras)'
$mcp = [ordered]@{ mcpServers = [ordered]@{ 'dg-brasil' = [ordered]@{ type = 'stdio'; command = 'node'; args = @($Exe, 'mcp') } } } | ConvertTo-Json -Depth 6
Gravar (Join-Path $Sessao '.mcp.json') $mcp
# Isolamento da sessão (QA máquina principal, MP-05): uma lista de conectores
# proibidos não basta, porque cada conector novo do claude.ai entraria liberado.
# Por isso, três camadas:
#   1. "disableClaudeAiConnectors": nenhum conector do claude.ai carrega nesta pasta;
#   2. os atalhos abrem o Claude Code com --strict-mcp-config, que só carrega o
#      servidor dg-brasil (nem os servidores MCP do usuário, como o "djen");
#   3. o "deny" continua, como reserva, e é MESCLADO: regras que alguém
#      acrescentou à mão neste computador não se perdem ao rodar o instalador.
$Settings = Join-Path $Sessao '.claude\settings.json'
$allow = @(
  'mcp__dg-brasil__listar_trabalhos', 'mcp__dg-brasil__ver_trabalho', 'mcp__dg-brasil__ver_caso',
  'mcp__dg-brasil__ver_processo', 'mcp__dg-brasil__listar_documentos', 'mcp__dg-brasil__baixar_documentos',
  'mcp__dg-brasil__consultar_teses', 'mcp__dg-brasil__listar_referencias', 'mcp__dg-brasil__abrir_referencia',
  'mcp__dg-brasil__informar_progresso', 'mcp__dg-brasil__entregar_analise', 'mcp__dg-brasil__entregar_minuta',
  'mcp__dg-brasil__propor', 'mcp__dg-brasil__concluir_trabalho', 'mcp__dg-brasil__informar_falha',
  'mcp__dg-brasil__devolver_trabalho', 'mcp__dg-brasil__reservar_trabalho', 'mcp__dg-brasil__roteiro_vigia',
  'Read(./trabalhos/**)', 'Write(./trabalhos/**)'
)
$deny = @(
  'Read(~/AppData/Roaming/DGBrasil/**)',
  'WebFetch', 'WebSearch',
  'mcp__claude_ai_*',
  'mcp__claude_ai_Gmail__*', 'mcp__claude_ai_Chat_Juridico_MCP__*', 'mcp__claude_ai_ADVBOX__*',
  'mcp__claude_ai_Google_Drive__*', 'mcp__claude_ai_Notion__*', 'mcp__claude_ai_APOGEU_DJEN__*',
  'mcp__claude_ai_Calendly__*', 'mcp__claude_ai_Claude_Docs__*', 'mcp__claude_ai_Google_Calendar__*',
  'mcp__claude_ai_Metricool_Social_Media_Management__*', 'mcp__claude_ai_Supermetrics_Marketing_Analytics__*',
  'mcp__claude_ai_TikTok_for_Business__*', 'mcp__djen'
)
if (Test-Path $Settings) {
  try {
    $anterior = Get-Content -Raw -Encoding UTF8 $Settings | ConvertFrom-Json
    $extra = @($anterior.permissions.deny) | Where-Object { $_ -and ($deny -notcontains $_) }
    if ($extra) { $deny += $extra; Ok "Mantidas $(@($extra).Count) regra(s) de bloqueio acrescentadas neste computador" }
    Copy-Item $Settings "$Settings.anterior" -Force
  } catch { Aviso "Não deu para ler o settings.json anterior; ele foi guardado como settings.json.anterior." ; Copy-Item $Settings "$Settings.anterior" -Force }
}
$permissoes = [ordered]@{
  disableClaudeAiConnectors = $true
  permissions = [ordered]@{ allow = $allow; deny = @($deny) }
} | ConvertTo-Json -Depth 6
Gravar $Settings $permissoes
Ok $Sessao

Passo 'Atalhos na área de trabalho'
# "DG Brasil - Sessão": modo assistido (a pessoa digita /mcp__dg-brasil__trabalhos).
# "DG Brasil - Vigia": processa a fila sozinha a cada 15 minutos enquanto estiver
# aberta (uma pessoa abre de manhã e fecha no fim do dia). Tudo continua indo
# para Revisões: só a aprovação de um advogado produz efeito.
# Os dois abrem com --strict-mcp-config: só o servidor dg-brasil carrega.
$Isolado = 'claude --strict-mcp-config --mcp-config .mcp.json'
$Loop = '/loop 15m Use a ferramenta roteiro_vigia do servidor dg-brasil e siga exatamente o roteiro que ela devolver.'
try {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $shell = New-Object -ComObject WScript.Shell
  foreach ($a in @(
      @{ nome = 'DG Brasil - Sessão'; cmd = $Isolado; desc = 'Abre o Claude Code para processar a fila do DG Brasil (modo assistido)' },
      @{ nome = 'DG Brasil - Vigia'; cmd = "$Isolado '$Loop'"; desc = 'Abre o Claude Code processando a fila do DG Brasil a cada 15 minutos' })) {
    $atalho = $shell.CreateShortcut((Join-Path $desktop "$($a.nome).lnk"))
    $atalho.TargetPath = (Get-Command powershell.exe).Source
    $atalho.Arguments = "-NoExit -Command `"Set-Location '$Sessao'; $($a.cmd)`""
    $atalho.WorkingDirectory = $Sessao
    $atalho.Description = $a.desc
    $atalho.Save()
    Ok (Join-Path $desktop "$($a.nome).lnk")
  }
} catch { Aviso "Não foi possível criar os atalhos. Abra manualmente: cd $Sessao; $Isolado" }

Passo 'Diagnóstico'
& node $Exe doctor

Write-Host "`nPronto. Para processar os trabalhos:" -ForegroundColor Green
Write-Host '  - Modo assistido: abra o atalho "DG Brasil - Sessão" e digite /mcp__dg-brasil__trabalhos'
Write-Host '  - Sozinho, a cada 15 minutos: abra o atalho "DG Brasil - Vigia" (feche no fim do dia)'
Write-Host 'Abra sempre pelos atalhos: eles carregam só o DG Brasil, sem os conectores do claude.ai.'
Write-Host 'Nunca autorize um conector (link de login) pedido nessa janela.' -ForegroundColor Yellow
Write-Host 'No DG Brasil, a aba Conexões mostra este computador como conectado.'
