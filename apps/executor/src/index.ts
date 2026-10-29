#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { DgApi } from './api.js'
import { ErroConfig, lerConfig, VERSAO } from './config.js'
import { diagnostico } from './doctor.js'
import { criarLog } from './log.js'
import { criarServidor } from './servidor.js'
import { Trabalhos } from './trabalhos.js'

/**
 * dg-executor mcp     servidor MCP stdio (o Claude Code inicia este processo)
 * dg-executor doctor  confere se o computador está pronto
 */

async function mcp() {
  const log = criarLog()
  let cfg
  try {
    cfg = await lerConfig()
  } catch (e) {
    log.error('configuracao_invalida', { motivo: e instanceof ErroConfig ? e.message : 'erro ao ler' })
    process.exit(1)
  }
  const api = new DgApi(cfg.url, cfg.token, cfg.versaoCliente)
  const trabalhos = new Trabalhos(api, cfg.pastaTrabalhos, log)
  const sobras = await trabalhos.limparSobras()
  if (sobras) log.info('pastas_antigas_apagadas', { quantidade: sobras })

  try {
    const eu = await api.eu()
    log.info('conectado', { executor_id: eu.executor_id, ligado: eu.execution_enabled })
  } catch (e) {
    // Sobe mesmo assim: as ferramentas devolvem o motivo ao Claude Code.
    log.warn('dg_brasil_indisponivel_ao_iniciar', { tipo: e instanceof Error ? e.name : typeof e })
  }

  // Presença: o DG Brasil mostra "computador conectado" enquanto a sessão está aberta.
  const presenca = setInterval(() => { api.eu().catch(() => undefined) }, 60_000)
  presenca.unref()

  const servidor = criarServidor(trabalhos, cfg.versaoCliente, log)
  let saindo = false
  const sair = async () => {
    if (saindo) return
    saindo = true
    clearInterval(presenca)
    await trabalhos.liberarTodos().catch(() => undefined)
    await servidor.close().catch(() => undefined)
    process.exit(0)
  }
  process.stdin.on('end', () => void sair())
  process.on('SIGINT', () => void sair())
  process.on('SIGTERM', () => void sair())

  await servidor.connect(new StdioServerTransport())
  log.info('mcp_pronto', { versao: VERSAO })
}

const comando = process.argv[2]
if (comando === 'mcp') {
  await mcp()
} else if (comando === 'doctor') {
  process.exit((await diagnostico()) ? 0 : 1)
} else if (comando === '--version' || comando === '-v') {
  console.log(VERSAO)
} else if (comando !== undefined || process.argv[1]?.endsWith('index.js')) {
  console.log('Uso: dg-executor mcp | doctor | --version')
  process.exit(comando ? 1 : 0)
}
