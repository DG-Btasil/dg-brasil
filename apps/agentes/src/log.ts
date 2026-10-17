/**
 * Log estruturado (uma linha JSON por evento). Só campos da lista abaixo
 * saem: ids, nomes de ferramenta, contagens, duração, categoria de erro.
 * Nunca prompt, documento, CPF, entrada de ferramenta, resposta do provedor
 * nem chave. Campo fora da lista é descartado em silêncio — de propósito:
 * quem adicionar um campo novo precisa adicioná-lo aqui, conscientemente.
 */

const CAMPOS = new Set([
  'worker', 'agent_run_id', 'msg_id', 'attempt', 'agent', 'agent_version_id', 'provider', 'model',
  'status', 'desfecho', 'duration_ms', 'tools', 'tool', 'tool_calls', 'steps', 'error_category',
  'error_code', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens',
  'estimated_cost_usd', 'skills', 'documents', 'proposals', 'count', 'concurrency', 'enabled',
  'reason', 'signal', 'port', 'retry_in_s',
])

type Nivel = 'info' | 'warn' | 'error'

export interface Logger {
  info(evento: string, campos?: Record<string, unknown>): void
  warn(evento: string, campos?: Record<string, unknown>): void
  error(evento: string, campos?: Record<string, unknown>): void
}

export function criarLogger(base: Record<string, unknown> = {}, saida: (linha: string) => void = (l) => console.log(l)): Logger {
  const emitir = (nivel: Nivel, evento: string, campos: Record<string, unknown> = {}) => {
    const limpo: Record<string, unknown> = { t: new Date().toISOString(), nivel, evento }
    for (const [k, v] of Object.entries({ ...base, ...campos })) {
      if (CAMPOS.has(k) && v !== undefined) limpo[k] = v
    }
    saida(JSON.stringify(limpo))
  }
  return {
    info: (e, c) => emitir('info', e, c),
    warn: (e, c) => emitir('warn', e, c),
    error: (e, c) => emitir('error', e, c),
  }
}

/** Logger que não escreve (testes). */
export const loggerMudo: Logger = { info() {}, warn() {}, error() {} }
