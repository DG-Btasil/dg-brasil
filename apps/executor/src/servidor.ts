import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { VERSAO } from './config.js'
import { registrarFerramentas } from './ferramentas.js'
import { criarLog } from './log.js'
import { INSTRUCOES_SERVIDOR, registrarRoteiro } from './prompt.js'
import type { Trabalhos } from './trabalhos.js'

/** O servidor MCP "dg-brasil": ferramentas + o roteiro do modo assistido. */
export function criarServidor(trabalhos: Trabalhos, versaoCliente: string, log = criarLog(), fetchFn?: typeof fetch): McpServer {
  const servidor = new McpServer({ name: 'dg-brasil', version: VERSAO }, { instructions: INSTRUCOES_SERVIDOR })
  registrarFerramentas(servidor, { trabalhos, log, versaoCliente, fetchFn })
  registrarRoteiro(servidor)
  return servidor
}
