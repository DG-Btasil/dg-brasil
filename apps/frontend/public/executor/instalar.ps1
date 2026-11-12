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
#   5. ponte com os agentes da máquina (docs/ponte.md): ponte.json, permissões
#      das pastas dos clientes e os agentes Porteiro, Arquivista e Mensageiro;
#   6. cria o atalho "DG Brasil - Vigia" na área de trabalho (sessão que
#      processa a fila sozinha a cada 15 minutos enquanto estiver aberta, e na
#      hora quando alguém clica em "Verificar agora" no DG Brasil);
#   7. roda o diagnóstico.
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
# Reinstalação: reaproveita o token que já está neste computador (ninguém precisa
# colar de novo). Para trocar de token, rode com $env:DG_BRASIL_TOKEN.
if (-not $token -and (Test-Path $Cfg)) {
  try {
    $anteriorCfg = Get-Content -Raw -Encoding UTF8 $Cfg | ConvertFrom-Json
    if ($anteriorCfg.token -and "$($anteriorCfg.token)".StartsWith('dgx_') -and "$($anteriorCfg.url)".TrimEnd('/') -eq $Base) {
      $token = "$($anteriorCfg.token)"
      Ok 'Token deste computador reaproveitado da instalação anterior'
    }
  } catch { Aviso 'Não deu para ler a configuração anterior; o token será pedido.' }
  Remove-Variable anteriorCfg -ErrorAction SilentlyContinue
}
if (-not $token) {
  Write-Host '    No DG Brasil: DG Brasil → Computador do escritório → Autorizar computador → Gerar token.'
  $seguro = Read-Host '    Cole o token (dgx_...) e tecle Enter' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro)
  try { $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
$token = $token.Trim()
if (-not $token.StartsWith('dgx_')) { Falha 'O token começa com "dgx_". Gere de novo no DG Brasil e cole o texto inteiro.' }
# "Verificar agora": com $env:DG_BRASIL_ESPERAR_FILA = '1', a Vigia também acorda
# sozinha quando entra trabalho novo na fila (padrão: só o botão e os 15 min).
# Sem a variável, vale o que já estava neste computador.
$esperarFila = $false
if ($env:DG_BRASIL_ESPERAR_FILA) { $esperarFila = $env:DG_BRASIL_ESPERAR_FILA -eq '1' }
elseif (Test-Path $Cfg) {
  try { $esperarFila = ((Get-Content -Raw -Encoding UTF8 $Cfg | ConvertFrom-Json).esperar_fila -eq $true) } catch { }
}
$config = [ordered]@{ url = $Base; token = $token; pasta_trabalhos = $Trabalhos; esperar_fila = $esperarFila } | ConvertTo-Json
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
  'Read(./trabalhos/**)', 'Edit(./trabalhos/**)',
  # "Verificar agora" (docs/mcp/instalacao.md, seção 6): no fim de cada rodada a
  # Vigia pergunta se já há espera e deixa o "esperar" em segundo plano. SÓ estas
  # duas linhas exatas (nada de Bash(node *)): o Claude Code compara o comando
  # inteiro, com barras normais, como o roteiro_vigia manda escrever.
  'Bash(node C:/DGBrasil/executor/dg-executor.mjs esperar --situacao)',
  'Bash(node C:/DGBrasil/executor/dg-executor.mjs esperar)',
  'PowerShell(node C:/DGBrasil/executor/dg-executor.mjs esperar --situacao)',
  'PowerShell(node C:/DGBrasil/executor/dg-executor.mjs esperar)'
)
# Ponte com os agentes da máquina (docs/ponte.md). Os agentes do escritório
# trabalham na pasta do cliente no G:, na pasta de trabalho deles e com os
# scripts deles. Para pular (só o fluxo entrada/saida): $env:DG_BRASIL_PONTE = '0'.
$ComPonte = $env:DG_BRASIL_PONTE -ne '0'
$Ponte = Join-Path $CfgDir 'ponte.json'
# Nomes com acento montados por código: o script chega por "irm | iex" e o
# PowerShell 5.1 pode ler o texto numa codificação que estraga os acentos.
$Trav = [char]0x2014; $Cced = [char]0x00C7; $Atil = [char]0x00C3; $Otil = [char]0x00D5; $Oagudo = [char]0x00D3; $cMin = [char]0x00E7; $aMin = [char]0x00E3
$Novos = '000. PASTA CLIENTES NOVOS'
$ComProcesso = "01. ADVOCACIA $Trav CLIENTES"
if ($ComPonte) {
  $allow += @(
    'mcp__dg-brasil__ver_ponte', 'mcp__dg-brasil__verificar_arquivos',
    'mcp__dg-brasil__copiar_para_pasta_do_cliente', 'mcp__dg-brasil__trazer_da_pasta_do_cliente',
    # pastas dos clientes (as raízes do ponte.json)
    # Caminho absoluto no Windows: "//g/..." (letra minúscula, sem dois-pontos). Gravar
    # é a regra Edit (Write(...) não vale para nada). code.claude.com/docs/en/permissions
    "Read(//g/Meu Drive/$Novos/**)", "Edit(//g/Meu Drive/$Novos/**)",
    "Read(//g/Meu Drive/$ComProcesso/**)", "Edit(//g/Meu Drive/$ComProcesso/**)",
    # modelos e bases que os redatores leem (só leitura)
    "Read(//g/Meu Drive/Modelos - Peti$cMin$($aMin)o Inicial Fraude Consignado INSS/**)",
    "Read(//g/Meu Drive/05. FORMA$Cced$($Atil)O E PROJETOS/LIVES SECRETAS/**)",
    'Read(//g/Meu Drive/**/FLUXOGRAMA AGENTES/**)',
    "Read(//g/Meu Drive/02. ADVOCACIA $Trav MODELOS E PETI$Cced$($Otil)ES/**)",
    # jurisprudência já conferida (os redatores acrescentam)
    'Read(//g/Meu Drive/**/JURISPRUDENCIAS_VERIFICADAS_*.md)', 'Edit(//g/Meu Drive/**/JURISPRUDENCIAS_VERIFICADAS_*.md)',
    # arquivos e scripts dos agentes neste computador
    'Read(~/.claude/agents/**)', 'Read(~/.claude/scripts/**)', 'Read(~/.claude/docs/**)', 'Read(~/.claude/skills/**)',
    # pasta de trabalho dos agentes e registro_pecas.csv (trava contra peça repetida)
    'Read(~/agentes-juridicos/**)', 'Edit(~/agentes-juridicos/**)',
    # o que os agentes rodam: Python e os .ps1 do escritório (o Word por COM sai daqui)
    'Bash(python *)', 'Bash(py *)', 'Bash(powershell -NoProfile -ExecutionPolicy Bypass -File *)', 'Bash(powershell -File *)',
    'PowerShell(python *)', 'PowerShell(py *)', 'PowerShell(powershell -NoProfile -ExecutionPolicy Bypass -File *)',
    'PowerShell(Get-ChildItem *)', 'PowerShell(Test-Path *)', 'PowerShell(Copy-Item *)', 'PowerShell(Get-Item *)', 'PowerShell(New-Item *)'
  )
}
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
# Internet (decisão de Barbara, 10/11/2026): com a ponte, os agentes conferem a
# jurisprudência no portal oficial e o BACEN. WebFetch e WebSearch saem do
# bloqueio (no Claude Code o bloqueio vence a liberação) e entram como liberados,
# para a vigia não parar pedindo confirmação. A regra do roteiro continua: nunca
# pôr dado do cliente numa busca ou num endereço.
$Internet = @('WebFetch', 'WebSearch')
if ($ComPonte) {
  $deny = @($deny | Where-Object { $Internet -notcontains $_ })
  $allow += $Internet
}
if (Test-Path $Settings) {
  try {
    $anterior = Get-Content -Raw -Encoding UTF8 $Settings | ConvertFrom-Json
    $extra = @($anterior.permissions.deny) | Where-Object { $_ -and ($deny -notcontains $_) -and -not ($ComPonte -and $Internet -contains $_) }
    if ($extra) { $deny += $extra; Ok "Mantidas $(@($extra).Count) regra(s) de bloqueio acrescentadas neste computador" }
    Copy-Item $Settings "$Settings.anterior" -Force
  } catch { Aviso "Não deu para ler o settings.json anterior; ele foi guardado como settings.json.anterior." ; Copy-Item $Settings "$Settings.anterior" -Force }
}
$permissoes = [ordered]@{
  disableClaudeAiConnectors = $true
  # O servidor dg-brasil do .mcp.json desta pasta já vem aprovado: sem isso, a vigia
  # (aberta minimizada) fica parada no "aprovar servidor MCP?" e nunca conecta.
  enabledMcpjsonServers = @('dg-brasil')
  permissions = [ordered]@{ allow = $allow; deny = @($deny) }
} | ConvertTo-Json -Depth 6
Gravar $Settings $permissoes
Ok $Sessao

if ($ComPonte) {
  Passo 'Ponte com os agentes da máquina'
  if (Test-Path $Ponte) {
    Ok "Mantido o $Ponte que já existe (não é sobrescrito)"
  } else {
    # Quem entra na ponte e onde cada um trabalha (docs/ponte.md, item 3.3).
    # Os padrões de "trazer" são os nomes reais que cada agente grava.
    $redator = "G:\Meu Drive\$ComProcesso\CLIENTE - ESCRIT$($Oagudo)RIO"
    $minuta = @('MINUTA_*.docx', 'MINUTA_*.pdf', 'Memoria_Calculo_*.xlsx', 'MEMORIA_CALCULO_*.xlsx', 'FICHA_*.md')
    $agentes = [ordered]@{
      'clara-hiscon'     = [ordered]@{ pasta = @('7. KIT DO CLIENTE', "3. PROCURA$Cced$($Atil)O ASSINADA"); trazer = @('ROTEIRO_CONSIGNADO_*.pdf', 'ROTEIRO_CONSIGNADO_*.html', 'TETO_NORMATIVO_*.pdf', 'TETO_NORMATIVO_*.html') }
      'lucas-procuracao' = [ordered]@{ pasta = @('7. KIT DO CLIENTE'); trazer = @('Procuracao_*.pdf', 'Declaracao_Hipossuficiencia_*.pdf', 'Contrato_Honorarios_*.pdf', 'Declaracao_Residencia_*.pdf') }
    }
    foreach ($r in @('alice-inicial', 'atlas-revisional', 'vicente-agregados', 'murilo-replica', 'pedro-provas', 'laura-emenda',
                     'gabriel-embargos', 'rafael-recurso', 'paulo-agravo', 'beatriz-cumprimento', 'teresa-audiencia')) {
      $agentes[$r] = [ordered]@{ pasta = @($redator); trazer = $minuta; dados_do_cadastro = $false; criar_pasta = $false }
    }
    $conteudo = [ordered]@{
      raizes_permitidas = @("G:\Meu Drive\$Novos", "G:\Meu Drive\$ComProcesso")
      pasta_pelo_nome = $false
      antivirus = $true
      agentes = $agentes
    } | ConvertTo-Json -Depth 8
    Gravar $Ponte $conteudo
    Ok "$Ponte (Clara, Lucas e os redatores; confira os nomes com os agentes deste computador)"
  }
  # Os três agentes da ponte (Porteiro, Arquivista, Mensageiro): atualizados a cada instalação.
  New-Item -ItemType Directory -Force -Path (Join-Path $env:USERPROFILE '.claude\agents') | Out-Null
  $faltam = @('porteiro-dg', 'arquivista-dg', 'mensageiro-dg')
  foreach ($a in $faltam) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "$Base/executor/agentes/$a.md" -OutFile (Join-Path $env:USERPROFILE ".claude\agents\$a.md")
      Ok "Agente $a instalado em $env:USERPROFILE\.claude\agents"
    } catch { Aviso "Não deu para baixar o agente $a. Copie de docs/mcp/pilotos/agentes/$a.md para $env:USERPROFILE\.claude\agents." }
  }
}

Passo 'Atalhos na área de trabalho'
# "DG Brasil - Sessão": modo assistido (a pessoa digita /mcp__dg-brasil__trabalhos).
# "DG Brasil - Vigia": processa a fila sozinha a cada 15 minutos enquanto estiver
# aberta (uma pessoa abre de manhã e fecha no fim do dia), e na hora quando
# alguém clica em "Verificar agora" no DG Brasil. Tudo continua indo para
# Revisões: só a aprovação de um advogado produz efeito.
# Os dois abrem com --strict-mcp-config: só o servidor dg-brasil carrega.
$Isolado = 'claude --strict-mcp-config --mcp-config .mcp.json'
$Loop = '/loop 15m Use a ferramenta roteiro_vigia do servidor dg-brasil e siga exatamente o roteiro que ela devolver.'
try {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $shell = New-Object -ComObject WScript.Shell
  foreach ($a in @(
      @{ nome = 'DG Brasil - Sessão'; cmd = $Isolado; desc = 'Abre o Claude Code para processar a fila do DG Brasil (modo assistido)' },
      # O prompt vem ANTES das opções: --mcp-config aceita vários arquivos e, depois
      # dele, o texto do /loop era lido como outro arquivo de configuração ("MCP
      # config file not found") e o Claude Code saía na hora (Frente B, 10/11/2026).
      @{ nome = 'DG Brasil - Vigia'; cmd = "claude '$Loop' --strict-mcp-config --mcp-config .mcp.json"; desc = 'Abre o Claude Code processando a fila do DG Brasil a cada 15 minutos' })) {
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
Write-Host '    Com a Vigia aberta, "Verificar agora" no DG Brasil (Computador do escritório) faz ela rodar na hora.'
Write-Host 'Abra sempre pelos atalhos: eles carregam só o DG Brasil, sem os conectores do claude.ai.'
Write-Host 'Nunca autorize um conector (link de login) pedido nessa janela.' -ForegroundColor Yellow
Write-Host 'No DG Brasil, a aba Conexões mostra este computador como conectado.'
