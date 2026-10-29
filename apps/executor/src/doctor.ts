import { execFile } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { DgApi, ErroApi } from './api.js'
import { caminhoConfig, ErroConfig, lerConfig, VERSAO } from './config.js'

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
    else escrever('  AVISO Execução pelo escritório: DESLIGADA (ligue em Configurações → Computador do escritório)')
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

  try {
    const { stdout } = await promisify(execFile)('claude', ['--version'], { timeout: 15_000, windowsHide: true })
    ok(`Claude Code ${stdout.trim()}`)
  } catch {
    escrever('  AVISO Claude Code não encontrado no PATH deste terminal (confira com: claude --version)')
  }

  escrever(tudoOk ? '\nTudo certo.' : '\nCorrija os itens com FALHA e rode de novo.')
  return tudoOk
}
