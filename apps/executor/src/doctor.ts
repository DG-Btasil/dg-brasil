import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { DgApi, ErroApi } from './api.js'
import { caminhoConfig, ErroConfig, lerConfig, VERSAO } from './config.js'
import { caminhoPonte, ErroPonte, lerPonte } from './ponte.js'

/**
 * dg-executor doctor: confere, sem mexer em nada do DG Brasil, se este
 * computador está pronto. Escreve no stdout (aqui não é o MCP).
 */
export async function diagnostico(escrever: (l: string) => void = (l) => console.log(l)): Promise<boolean> {
  let tudoOk = true
  const ok = (l: string) => escrever(`  OK   ${l}`)
  const falha = (l: string) => { tudoOk = false; escrever(`  FALHA ${l}`) }

  escrever(`dg-executor ${VERSAO} — diagnóstico`)
  const [maior] = process.versions.node.split('.').map(Number)
  if (maior >= 22) ok(`Node ${process.versions.node}`)
  else falha(`Node ${process.versions.node}: precisa da versão 22 ou mais nova`)

  let cfg
  try {
    cfg = await lerConfig()
    ok(`Configuração: ${cfg.arquivoConfig} (token ${cfg.token.slice(0, 8)}…)`)
  } catch (e) {
    falha(e instanceof ErroConfig ? e.message : `Configuração ilegível em ${caminhoConfig()}`)
    return false
  }

  try {
    const eu = await new DgApi(cfg.url, cfg.token, cfg.versaoCliente).eu()
    ok(`DG Brasil em ${cfg.url} reconhece este computador como "${eu.name}"`)
    if (eu.execution_enabled) ok('Execução pelo escritório: LIGADA')
    else escrever('  AVISO Execução pelo escritório: DESLIGADA (ligue em DG Brasil → Computador do escritório)')
  } catch (e) {
    falha(e instanceof ErroApi ? `DG Brasil recusou: ${e.message}` : 'Sem conexão com o DG Brasil')
  }

  try {
    await mkdir(cfg.pastaTrabalhos, { recursive: true })
    const teste = join(cfg.pastaTrabalhos, '.teste-escrita')
    await writeFile(teste, 'ok')
    await rm(teste)
    ok(`Pasta de trabalhos: ${cfg.pastaTrabalhos}`)
  } catch {
    falha(`Sem permissão de escrita em ${cfg.pastaTrabalhos}`)
  }

  // Ponte com os agentes da máquina (docs/ponte.md).
  try {
    const ponte = await lerPonte()
    if (!ponte) {
      escrever(`  AVISO Ponte: sem ${caminhoPonte()} (nenhum agente passa pela ponte; fluxo entrada/saida)`)
    } else {
      const raizes = ponte.raizes.filter((r) => existsSync(r))
      if (raizes.length === ponte.raizes.length) ok(`Ponte: ${Object.keys(ponte.agentes).length} agente(s), raiz encontrada (${ponte.raizes.join('; ')})`)
      else falha(`Ponte: raiz não encontrada: ${ponte.raizes.filter((r) => !existsSync(r)).join('; ')} (o Google Drive para computador está aberto?)`)
      const instalados = await agentesInstalados()
      for (const [agente, a] of Object.entries(ponte.agentes)) {
        const pastas = (Array.isArray(a.pasta) ? a.pasta : [a.pasta]).map((p) => (isAbsolute(p) ? p : join(ponte.raizes[0], p)))
        const faltam = pastas.filter((p) => !existsSync(p))
        if (faltam.length) falha(`Ponte: ${agente} → pasta não encontrada: ${faltam.join('; ')}`)
        else ok(`Ponte: ${agente} → ${pastas.join(' | ')}`)
        if (!instalados.has(agente)) escrever(`  AVISO Ponte: nenhum agente com name: ${agente} em ${join(homedir(), '.claude', 'agents')}`)
      }
      for (const a of ['porteiro-dg', 'arquivista-dg', 'mensageiro-dg']) {
        if (instalados.has(a)) ok(`Ponte: agente ${a} instalado`)
        else falha(`Ponte: falta o agente ${a} em ${join(homedir(), '.claude', 'agents')} (copie de docs/mcp/pilotos/agentes/)`)
      }
      if (process.platform === 'win32') {
        const defender = join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Windows Defender', 'MpCmdRun.exe')
        if (!ponte.antivirus) escrever('  AVISO Ponte: antivírus DESLIGADO no ponte.json')
        else if (existsSync(defender)) ok('Ponte: antivírus do Windows encontrado')
        else escrever('  AVISO Ponte: antivírus do Windows não encontrado: todo arquivo vai sair "suspeito"')
        const edge = ['ProgramFiles(x86)', 'ProgramFiles'].map((v) => join(process.env[v] ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')).find((c) => existsSync(c))
        if (edge) ok('Ponte: Microsoft Edge encontrado (HTML e Markdown viram PDF)')
        else escrever('  AVISO Ponte: Microsoft Edge não encontrado: HTML e Markdown não viram PDF')
      }
    }
  } catch (e) {
    falha(e instanceof ErroPonte ? e.message : 'Ponte: ponte.json ilegível')
  }

  try {
    const { stdout } = await promisify(execFile)('claude', ['--version'], { timeout: 15_000, windowsHide: true })
    ok(`Claude Code ${stdout.trim()}`)
  } catch {
    escrever('  AVISO Claude Code não encontrado no PATH deste terminal (confira com: claude --version)')
  }

  escrever(tudoOk ? '\nTudo certo.' : '\nCorrija os itens com FALHA e rode de novo.')
  return tudoOk
}

/**
 * Nomes dos agentes do Claude Code deste computador. Vale o `name:` de dentro do
 * arquivo (o arquivo pode se chamar "72-clara-hiscon.md"); sem `name:`, o nome
 * do arquivo.
 */
async function agentesInstalados(): Promise<Set<string>> {
  const pasta = join(homedir(), '.claude', 'agents')
  const nomes = new Set<string>()
  let arquivos: string[] = []
  try { arquivos = (await readdir(pasta)).filter((f) => f.toLowerCase().endsWith('.md')) } catch { return nomes }
  for (const f of arquivos) {
    try {
      const inicio = (await readFile(join(pasta, f), 'utf8')).slice(0, 2000)
      const m = /^name:[ \t]*["']?([a-z0-9][a-z0-9-]*)["']?[ \t]*$/m.exec(inicio)
      nomes.add(m ? m[1].trim() : f.slice(0, -3))
    } catch { /* arquivo ilegível: ignora */ }
  }
  return nomes
}
