/**
 * Log do executor: uma linha JSON por evento, SEMPRE em stderr — o stdout é o
 * canal do protocolo MCP com o Claude Code. Só ids, contagens e códigos:
 * nunca token, conteúdo de documento, nome de cliente ou texto do caso.
 */

type Campos = Record<string, string | number | boolean | null | undefined>

const PROIBIDO = /token|lease|senha|password|secret|key|url|nome|name|cpf|texto|text|conteudo|content/i

export interface Log {
  info(evento: string, campos?: Campos): void
  warn(evento: string, campos?: Campos): void
  error(evento: string, campos?: Campos): void
}

export function criarLog(destino: (linha: string) => void = (l) => process.stderr.write(l + '\n')): Log {
  const emitir = (nivel: string) => (evento: string, campos: Campos = {}) => {
    const limpo: Campos = {}
    for (const [k, v] of Object.entries(campos)) {
      if (v === undefined) continue
      limpo[k] = PROIBIDO.test(k) && !/(^|_)id$/i.test(k) ? '[oculto]' : v
    }
    destino(JSON.stringify({ ts: new Date().toISOString(), nivel, evento, ...limpo }))
  }
  return { info: emitir('info'), warn: emitir('warn'), error: emitir('error') }
}

export const logMudo: Log = { info() {}, warn() {}, error() {} }
