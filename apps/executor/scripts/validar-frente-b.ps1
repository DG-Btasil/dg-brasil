# DG Brasil — Frente B da validação da ponte, AUTOMÁTICA, no computador do escritório.
#
# Guia: docs/mcp/ponte-validacao-maquina-principal.md (Parte B).
# Quem roda: o Claude Code da pessoa do escritório, a partir do prompt pronto. A
# pessoa não digita nada; no máximo autoriza o Claude Code a rodar este script.
#
# O que faz, sozinho:
#   1. atualiza o repositório (git pull);
#   2. reinstala o conector do DG Brasil reaproveitando o token desta máquina;
#   3. guarda as evidências da instalação (ponte.json, permissões, agentes, doctor);
#   4. cria a pasta de teste do cliente fictício no G:, se não existir;
#   5. abre a janela "DG Brasil - Vigia" (fecha uma vigia antiga sem trabalho);
#   6. observa por até -Minutos: os trabalhos que a vigia pega, os arquivos do
#      Porteiro e a pasta de teste no G:;
#   7. fecha a vigia que abriu, escreve o relatório e envia (branch qa/ponte-frente-b-...).
#
# Só olha a pasta do cliente FICTÍCIO (-Cliente) e as pastas dos trabalhos do DG
# Brasil de teste. Não lê pasta de cliente real, não apaga nada no Drive.
#
# Uso:  powershell -NoProfile -ExecutionPolicy Bypass -File validar-frente-b.ps1 -Repo C:\Projetos\dg-brasil
#       -Simular: sem instalar, sem vigia e sem push (para conferir o script em outra máquina).

param(
  [string]$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path,
  [int]$Minutos = 120,
  [int]$OciosoMinutos = 20,
  [string]$Cliente = 'DG TESTE - JOSE DA SILVA FICTICIO',
  [string]$Base = 'https://app.dgbrasil.adv.br',
  [switch]$Simular,
  # Sem pasta do Drive ligada no site: usa o nome do cliente durante a validação e volta ao normal no fim.
  [switch]$PastaPeloNome,
  # Abre a vigia em janela normal (não minimizada), para quem está no computador ver o que ela pede.
  [switch]$Visivel,
  [switch]$SemPush
)

$ErrorActionPreference = 'Continue'
# O Git responde em UTF-8: sem isto, o PowerShell 5.1 estraga os acentos.
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8 } catch {}
$inicio = Get-Date
$stamp = $inicio.ToString('yyyyMMdd-HHmm')
$Saida = Join-Path $Repo "docs\qa\ponte\frente-b\$stamp"
New-Item -ItemType Directory -Force -Path $Saida | Out-Null
$Utf8 = New-Object System.Text.UTF8Encoding $false
$Linha = New-Object System.Collections.Generic.List[string]
$Checks = [ordered]@{}

function Agora { (Get-Date).ToString('HH:mm:ss') }
function Log($t) { $l = "$(Agora)  $t"; $Linha.Add($l); Write-Host $l }
function Gravar($nome, $conteudo) { [IO.File]::WriteAllText((Join-Path $Saida $nome), $conteudo, $Utf8) }
function Check($id, $ok, $detalhe) { $Checks[$id] = [ordered]@{ resultado = $(if ($ok -eq $null) { 'NAO TESTADO' } elseif ($ok) { 'OK' } else { 'FALHOU' }); detalhe = $detalhe } }
# Nada de token no relatório: "dgx_..." e "dgl_..." viram "***".
function SemSegredo($t) { "$t" -replace 'dg[xl]_[A-Za-z0-9_-]+', 'dg?_***' }

try { Start-Transcript -Path (Join-Path $env:TEMP "dg-frente-b-$stamp.log") -Force | Out-Null } catch {}
Log "Frente B automatica: inicio em $($inicio.ToString('dd/MM/yyyy HH:mm')) no computador $env:COMPUTERNAME (usuario $env:USERNAME). Simular=$Simular"

$CfgDir = Join-Path $env:APPDATA 'DGBrasil'
$CfgExec = Join-Path $CfgDir 'executor.json'
$CfgPonte = Join-Path $CfgDir 'ponte.json'
$Sessao = 'C:\DGBrasil\sessao'
$Exe = 'C:\DGBrasil\executor\dg-executor.mjs'
if ($Simular) {
  $raizSim = Join-Path $env:TEMP "dg-frente-b-sim-$stamp"
  $CfgDir = Join-Path $raizSim 'appdata'; $CfgExec = Join-Path $CfgDir 'executor.json'; $CfgPonte = Join-Path $CfgDir 'ponte.json'
  $Sessao = Join-Path $raizSim 'sessao'
  New-Item -ItemType Directory -Force -Path $CfgDir, (Join-Path $Sessao 'trabalhos'), (Join-Path $raizSim 'G\7. KIT DO CLIENTE') | Out-Null
  [IO.File]::WriteAllText($CfgPonte, (@{ raizes_permitidas = @((Join-Path $raizSim 'G')); agentes = @{ 'clara-hiscon' = @{ pasta = @('7. KIT DO CLIENTE'); trazer = @('ROTEIRO_*.pdf') } } } | ConvertTo-Json -Depth 6), $Utf8)
  [IO.File]::WriteAllText($CfgExec, (@{ url = $Base; token = 'dgx_simulado'; pasta_trabalhos = (Join-Path $Sessao 'trabalhos') } | ConvertTo-Json), $Utf8)
}

# ── 1. repositório ─────────────────────────────────────────────────────────
if (-not $Simular) {
  $pull = & git -C $Repo pull --ff-only 2>&1 | Out-String
  Log "git pull: $($pull.Trim())"
}
$commit = (& git -C $Repo log -1 --format='%h %s' 2>$null) -join ''
Log "Repositorio: $Repo, commit $commit"

# ── 2. reinstalar o conector (token reaproveitado) ──────────────────────────
if (-not $Simular) {
  if (-not (Test-Path $CfgExec)) {
    Log "FALHA: $CfgExec nao existe. Sem ele o instalador pediria o token; a Barbara precisa instalar uma vez."
    Check 'PB-01' $false 'sem executor.json: instalacao nao feita'
  } else {
    Log 'Instalador do DG Brasil (reaproveitando o token)...'
    try {
      # Num processo separado e sem console de entrada: se por algum motivo o
      # instalador fosse pedir o token, ele falha em vez de ficar esperando.
      $env:DG_BRASIL_URL = $Base
      $saidaInstalador = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "irm '$Base/executor/instalar.ps1' | iex" 2>&1 | Out-String
      Gravar 'instalador.txt' (SemSegredo $saidaInstalador)
      Log 'Instalador terminou.'
      Check 'PB-01' ($saidaInstalador -match 'Ponte com os agentes') 'passo da ponte apareceu no instalador'
    } catch {
      Log "FALHA no instalador: $($_.Exception.Message)"
      Check 'PB-01' $false "instalador falhou: $($_.Exception.Message)"
    }
  }
}

# ── 3. evidências da instalação ─────────────────────────────────────────────
$ponte = $null
if (Test-Path $CfgPonte) {
  Copy-Item $CfgPonte (Join-Path $Saida 'ponte.json') -Force
  try { $ponte = Get-Content -Raw -Encoding UTF8 $CfgPonte | ConvertFrom-Json } catch { Log "ponte.json ilegivel: $($_.Exception.Message)" }
}
if ($ponte) {
  $nomes = @($ponte.agentes.PSObject.Properties.Name)
  $raizes = @($ponte.raizes_permitidas) + @($ponte.raiz_permitida) | Where-Object { $_ }
  $acentos = (($raizes -join '|') -match 'ADVOCACIA \u2014 CLIENTES') -or (($raizes -join '|') -match 'ADVOCACIA ' + [char]0x2014 + ' CLIENTES')
  Check 'PB-02' (($nomes -contains 'clara-hiscon') -and ($nomes -contains 'lucas-procuracao') -and $acentos) "agentes: $($nomes -join ', ') | raizes: $($raizes -join ' ; ')"
} else { Check 'PB-02' $false 'ponte.json ausente' }

$agentesDir = Join-Path $env:USERPROFILE '.claude\agents'
$daPonte = @('porteiro-dg', 'arquivista-dg', 'mensageiro-dg') | Where-Object { Test-Path (Join-Path $agentesDir "$_.md") }
$reais = @(Get-ChildItem -LiteralPath $agentesDir -Filter '*.md' -ErrorAction SilentlyContinue | ForEach-Object { $_.BaseName })
Gravar 'agentes.txt' ($reais -join "`r`n")
Check 'PB-03' (@($daPonte).Count -eq 3) "agentes da ponte instalados: $($daPonte -join ', ')"

$settingsPath = Join-Path $Sessao '.claude\settings.json'
if (Test-Path $settingsPath) {
  $st = Get-Content -Raw -Encoding UTF8 $settingsPath | ConvertFrom-Json
  $allow = @($st.permissions.allow); $deny = @($st.permissions.deny)
  Gravar 'settings.json' (SemSegredo ($st | ConvertTo-Json -Depth 6))
  $okSettings = ($allow -contains 'mcp__dg-brasil__ver_ponte') -and ($allow -contains 'WebFetch') -and -not ($deny -contains 'WebFetch') -and ($deny -contains 'mcp__claude_ai_*')
  Check 'PB-04' $okSettings "allow ponte/internet e deny dos conectores"
} else { Check 'PB-04' $null 'settings.json da sessao nao encontrado' }

if (-not $Simular -and (Test-Path $Exe)) {
  $doctor = & node $Exe doctor 2>&1 | Out-String
  Gravar 'doctor.txt' (SemSegredo $doctor)
  $falhas = @($doctor -split "`n" | Where-Object { $_ -match 'FALHA' })
  Check 'PB-05' ($falhas.Count -eq 0) $(if ($falhas.Count) { ($falhas -join ' / ').Trim() } else { 'doctor sem FALHA' })
  $versao = (& node $Exe --version 2>&1 | Out-String).Trim()
  Check 'PB-06' ($versao -eq '1.1.0') "versao do conector: $versao"
  Log "doctor: $($falhas.Count) falha(s); conector $versao"
}

$pelonomeAntes = $null
if ($PastaPeloNome -and (Test-Path $CfgPonte)) {
  $pj = Get-Content -Raw -Encoding UTF8 $CfgPonte | ConvertFrom-Json
  $pelonomeAntes = [bool]$pj.pasta_pelo_nome
  $pj | Add-Member -NotePropertyName pasta_pelo_nome -NotePropertyValue $true -Force
  [IO.File]::WriteAllText($CfgPonte, ($pj | ConvertTo-Json -Depth 8), $Utf8)
  Log 'ponte.json: pasta_pelo_nome = true durante a validacao.'
}

# ── 4. pasta de teste do cliente fictício ──────────────────────────────────
$pastasTeste = @()
if ($ponte) {
  $raiz0 = @($raizes)[0]
  foreach ($nome in @('clara-hiscon', 'lucas-procuracao')) {
    $a = $ponte.agentes.$nome
    if (-not $a) { continue }
    foreach ($p in @($a.pasta)) {
      $etapa = if ([IO.Path]::IsPathRooted($p)) { $p } else { Join-Path $raiz0 $p }
      $pastasTeste += (Join-Path $etapa $Cliente)
    }
  }
  $pastasTeste = @($pastasTeste | Select-Object -Unique)
  $kit = @($pastasTeste)[0]
  if ($kit -and -not ($pastasTeste | Where-Object { Test-Path -LiteralPath $_ })) {
    try {
      New-Item -ItemType Directory -Path $kit -ErrorAction Stop | Out-Null
      Log "Pasta de teste criada (vazia) para a Barbara ligar no DG Brasil: $kit"
    } catch { Log "Nao deu para criar a pasta de teste: $($_.Exception.Message)" }
  }
}

# ── 5. vigia ────────────────────────────────────────────────────────────────
$cfgE = $null
try { $cfgE = Get-Content -Raw -Encoding UTF8 $CfgExec | ConvertFrom-Json } catch {}
$Trabalhos = if ($cfgE -and $cfgE.pasta_trabalhos) { $cfgE.pasta_trabalhos } else { Join-Path $Sessao 'trabalhos' }
function Vigias { @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine -match 'strict-mcp-config' -and $_.CommandLine -match 'roteiro_vigia' }) }
function TrabalhosAtivos { @(Get-ChildItem -LiteralPath $Trabalhos -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^[0-9a-f-]{36}$' }) }
$abertos = @()
if (-not $Simular -and (Get-Command claude -ErrorAction SilentlyContinue)) {
  # Sem abrir conversa: o servidor dg-brasil está conectado, esperando aprovação ou falhando?
  $job = Start-Job -ScriptBlock { param($d) Set-Location $d; & claude mcp list 2>&1 | Out-String } -ArgumentList $Sessao
  if (Wait-Job $job -Timeout 90) { $mcpList = Receive-Job $job } else { $mcpList = '(claude mcp list nao respondeu em 90 s)'; Stop-Job $job }
  Remove-Job $job -Force -ErrorAction SilentlyContinue
  Gravar 'claude-mcp-list.txt' (SemSegredo $mcpList)
  Check 'PB-MCP' ($mcpList -match 'dg-brasil' -and $mcpList -match 'Connected|Conectado|✔|✓') "claude mcp list: $((($mcpList -split "`n") | Where-Object { $_ -match 'dg-brasil' }) -join ' ')"
  Log "claude mcp list: $((($mcpList -split "`n") | Where-Object { $_ -match 'dg-brasil' }) -join ' ')"
}
if (-not $Simular) {
  $antigas = @(Vigias)
  if ($antigas.Count) {
    $espera = 0
    while ((TrabalhosAtivos).Count -and $espera -lt 20) { Log 'Vigia antiga com trabalho em andamento: esperando 1 min...'; Start-Sleep 60; $espera++ }
    # Só os processos da própria vigia (a janela do PowerShell e o Claude Code
    # dela). NUNCA o processo pai: pode ser o Explorer da pessoa.
    foreach ($v in $antigas) {
      Log "Fechando vigia antiga (processo $($v.ProcessId)) para carregar o conector novo."
      Stop-Process -Id $v.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
  $atalho = Join-Path ([Environment]::GetFolderPath('Desktop')) 'DG Brasil - Vigia.lnk'
  if (Test-Path -LiteralPath $atalho) {
    Start-Process -FilePath $atalho -WindowStyle $(if ($Visivel) { 'Normal' } else { 'Minimized' })
    Start-Sleep 20
    $abertos = @(Vigias)
    Check 'PB-VIGIA' ($abertos.Count -ge 1) "vigia aberta pelo atalho: $($abertos.Count) processo(s)"
    Log "Vigia aberta ($(if ($Visivel) { 'visivel' } else { 'minimizada' })). Processos: $(@($abertos | ForEach-Object { $_.ProcessId }) -join ', ')"
    # O conector do DG Brasil sobe DENTRO da vigia (node dg-executor.mjs mcp). Se não
    # subir em 3 minutos, a janela está parada numa tela esperando resposta.
    $mcp = @()
    for ($i = 0; $i -lt 9 -and -not $mcp.Count; $i++) {
      Start-Sleep 20
      $mcp = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine -match 'dg-executor\.mjs' -and $_.CommandLine -match 'mcp' })
    }
    Check 'PB-CONECTOR' ($mcp.Count -ge 1) $(if ($mcp.Count) { "conector do DG Brasil rodando dentro da vigia (processo $($mcp[0].ProcessId))" } else { 'o conector do DG Brasil NAO subiu em 3 min: a janela da vigia deve estar parada numa tela pedindo resposta' })
    Log $(if ($mcp.Count) { 'Conector do DG Brasil subiu dentro da vigia.' } else { 'ATENCAO: o conector do DG Brasil nao subiu em 3 min. Olhe a janela da vigia: ela deve estar pedindo uma resposta.' })
  } else {
    Check 'PB-VIGIA' $false "atalho nao encontrado: $atalho"
    Log "FALHA: atalho da vigia nao encontrado em $atalho"
  }
}

# ── 6. observar ────────────────────────────────────────────────────────────
$vistos = @{}       # id do trabalho -> @{ inicio; fim; saida = lista }
$pastaEstado = @{}  # arquivo -> "tamanho|data"
$ultimoMovimento = Get-Date
$limite = $inicio.AddMinutes($Minutos)
$EvTrab = Join-Path $Saida 'trabalhos'
New-Item -ItemType Directory -Force -Path $EvTrab | Out-Null
$rodadas = 0
while ((Get-Date) -lt $limite) {
  $rodadas++
  if ($Simular -and $rodadas -eq 1) {
    # Simulação: um trabalho falso com o Porteiro e os arquivos que a Clara gravaria.
    $fake = Join-Path $Trabalhos '11111111-2222-4333-8444-555555555555'
    New-Item -ItemType Directory -Force -Path (Join-Path $fake 'saida'), (Join-Path $fake 'entrada') | Out-Null
    [IO.File]::WriteAllText((Join-Path $fake 'saida\porteiro.json'), '{"arquivos":[{"arquivo":"hiscon.pdf","resultado":"liberado"}]}', $Utf8)
    [IO.File]::WriteAllText((Join-Path $fake 'entrada\hiscon.pdf'), '%PDF-1.4', $Utf8)
    $kitSim = @($pastasTeste)[0]
    foreach ($n in 'HISCON.pdf', 'DADOS DO CADASTRO.txt', 'ROTEIRO_CONSIGNADO_TESTE_2026-11-10.pdf') { [IO.File]::WriteAllText((Join-Path $kitSim $n), 'x', $Utf8) }
  }
  if ($Simular -and $rodadas -eq 3) { Remove-Item -Recurse -Force (Join-Path $Trabalhos '11111111-2222-4333-8444-555555555555') }
  $ativos = TrabalhosAtivos
  foreach ($t in $ativos) {
    if (-not $vistos.ContainsKey($t.Name)) { $vistos[$t.Name] = @{ inicio = Agora; fim = $null; saida = @() }; Log "Trabalho $($t.Name.Substring(0,8)) comecou (pasta criada pela vigia)."; $ultimoMovimento = Get-Date }
    $s = Join-Path $t.FullName 'saida'
    $arqs = @(Get-ChildItem -LiteralPath $s -File -ErrorAction SilentlyContinue)
    $vistos[$t.Name].saida = @($arqs | ForEach-Object { "$($_.Name) ($($_.Length) bytes)" })
    $dest = Join-Path $EvTrab $t.Name.Substring(0, 8)
    foreach ($a in ($arqs | Where-Object { $_.Name -like '*.json' })) {
      New-Item -ItemType Directory -Force -Path $dest | Out-Null
      Copy-Item -LiteralPath $a.FullName -Destination (Join-Path $dest $a.Name) -Force -ErrorAction SilentlyContinue
    }
    $ent = @(Get-ChildItem -LiteralPath (Join-Path $t.FullName 'entrada') -File -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Name) ($($_.Length) bytes)" })
    $vistos[$t.Name].entrada = $ent
  }
  foreach ($id in @($vistos.Keys)) {
    if (-not $vistos[$id].fim -and -not ($ativos | Where-Object { $_.Name -eq $id })) { $vistos[$id].fim = Agora; Log "Trabalho $($id.Substring(0,8)) terminou (pasta apagada pela vigia)."; $ultimoMovimento = Get-Date }
  }
  foreach ($p in $pastasTeste) {
    if (-not (Test-Path -LiteralPath $p)) { continue }
    foreach ($f in @(Get-ChildItem -LiteralPath $p -Recurse -Depth 3 -File -ErrorAction SilentlyContinue)) {
      $chave = $f.FullName.Substring($p.Length).TrimStart('\')
      $sig = "$($f.Length)|$($f.LastWriteTime.ToString('HH:mm:ss'))"
      if ($pastaEstado[$chave] -ne $sig) { Log "Pasta de teste: $chave ($($f.Length) bytes, $($f.LastWriteTime.ToString('HH:mm:ss')))"; $pastaEstado[$chave] = $sig; $ultimoMovimento = Get-Date }
    }
  }
  if (-not $Simular -and @($abertos).Count -and -not @(Vigias).Count) { Log 'ATENCAO: a janela da vigia foi fechada antes do fim.'; break }
  if ($Simular -and $rodadas -ge 4) { break }
  $ocioso = ((Get-Date) - $ultimoMovimento).TotalMinutes
  if ($vistos.Count -gt 0 -and (TrabalhosAtivos).Count -eq 0 -and $ocioso -ge $OciosoMinutos) { Log "Nenhum movimento ha $OciosoMinutos min depois dos trabalhos: encerrando a observacao."; break }
  Start-Sleep -Seconds $(if ($Simular) { 1 } else { 60 })
}

# ── 7. fechar, relatório e envio ────────────────────────────────────────────
foreach ($v in (Vigias)) {
  # Só os processos da vigia (nunca o processo pai).
  Stop-Process -Id $v.ProcessId -Force -ErrorAction SilentlyContinue
}
if (@($abertos).Count) { Log 'Vigia aberta por este script foi fechada.' }
if ($PastaPeloNome -and $pelonomeAntes -ne $null) {
  $pj = Get-Content -Raw -Encoding UTF8 $CfgPonte | ConvertFrom-Json
  $pj | Add-Member -NotePropertyName pasta_pelo_nome -NotePropertyValue $pelonomeAntes -Force
  [IO.File]::WriteAllText($CfgPonte, ($pj | ConvertTo-Json -Depth 8), $Utf8)
  Log "ponte.json: pasta_pelo_nome de volta para $pelonomeAntes."
}

$arquivosPasta = @($pastaEstado.Keys | Sort-Object)
$tem = { param($re) [bool]($arquivosPasta | Where-Object { $_ -match $re }) }
Check 'PB-10' ((& $tem '^HISCON(\s\(\d+\))?\.pdf$') -and (& $tem '^DADOS DO CADASTRO\.txt$')) 'HISCON.pdf e DADOS DO CADASTRO.txt na pasta de teste'
Check 'PB-11' (& $tem '^ROTEIRO_CONSIGNADO_.*\.(pdf|html)$') 'roteiro da Clara gravado na pasta de teste'
Check 'PB-20' ((& $tem '^Procuracao_.*\.pdf$') -and (& $tem '^Declaracao_Hipossuficiencia_.*\.pdf$')) 'procuracao e declaracao do Lucas na pasta de teste'
$porteiros = @(Get-ChildItem -LiteralPath $EvTrab -Recurse -Filter 'porteiro.json' -ErrorAction SilentlyContinue)
$bloqueios = @($porteiros | Where-Object { (Get-Content -Raw -Encoding UTF8 $_.FullName) -match '"(suspeito|recusado)"' })
Check 'PB-09' ($porteiros.Count -ge 1) "porteiro.json capturado em $($porteiros.Count) trabalho(s)"
Check 'PB-16/18' $(if ($porteiros.Count -ge 2) { $bloqueios.Count -ge 1 } else { $null }) "porteiro.json com suspeito/recusado: $($bloqueios.Count)"
Check 'PB-14' $(if ($vistos.Count) { -not @($vistos.Values | Where-Object { -not $_.fim }).Count } else { $null }) 'todos os trabalhos vistos terminaram (vigia nao ficou parada esperando confirmacao)'

$md = New-Object System.Text.StringBuilder
[void]$md.AppendLine("# Frente B automatica: coleta de $($inicio.ToString('dd/MM/yyyy HH:mm'))")
[void]$md.AppendLine('')
[void]$md.AppendLine("Computador $env:COMPUTERNAME, usuario $env:USERNAME, commit $commit. Duracao: $([int]((Get-Date) - $inicio).TotalMinutes) min.")
[void]$md.AppendLine('As telas do DG Brasil (Revisoes, execucoes) sao conferidas pela Barbara e pelo Claude, de fora.')
[void]$md.AppendLine('')
[void]$md.AppendLine('| Item | Resultado | Detalhe |')
[void]$md.AppendLine('|---|---|---|')
foreach ($k in $Checks.Keys) { [void]$md.AppendLine("| $k | $($Checks[$k].resultado) | $((SemSegredo $Checks[$k].detalhe) -replace '\|', '/') |") }
[void]$md.AppendLine('')
[void]$md.AppendLine('## Trabalhos vistos')
foreach ($id in $vistos.Keys) {
  $v = $vistos[$id]
  [void]$md.AppendLine("- $($id.Substring(0,8)): $($v.inicio) a $($v.fim). Entrada: $(@($v.entrada) -join ', '). Saida: $(@($v.saida) -join ', ')")
}
[void]$md.AppendLine('')
[void]$md.AppendLine('## Pasta de teste (arquivos)')
foreach ($a in $arquivosPasta) { [void]$md.AppendLine("- $a") }
[void]$md.AppendLine('')
[void]$md.AppendLine('## Linha do tempo')
foreach ($l in $Linha) { [void]$md.AppendLine("    $(SemSegredo $l)") }
Gravar 'coleta.md' $md.ToString()
Gravar 'checks.json' ($Checks | ConvertTo-Json -Depth 4)
Log "Relatorio em $Saida"

try { Stop-Transcript | Out-Null } catch {}
if (-not $Simular -and -not $SemPush) {
  $branch = "qa/ponte-frente-b-$stamp"
  & git -C $Repo checkout -b $branch 2>&1 | Out-Null
  & git -C $Repo add -- "docs/qa/ponte/frente-b/$stamp" 2>&1 | Out-Null
  & git -C $Repo commit -m "docs(qa-ponte): coleta automatica da Frente B ($stamp)" 2>&1 | Out-Null
  $push = & git -C $Repo push -u origin $branch 2>&1 | Out-String
  Write-Host $push
  & git -C $Repo checkout - 2>&1 | Out-Null
  Write-Host "Enviado para a branch $branch (se o push acima nao deu erro)."
}
Write-Host 'Frente B automatica: fim.'
