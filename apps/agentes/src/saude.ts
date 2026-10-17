import { createServer, type Server } from 'node:http'

/**
 * Verificação de saúde para o Fly.io. NÃO executa agente, não toca no
 * provedor de IA e não devolve segredo nem configuração: só se o laço está
 * vivo e se a execução de IA está ligada no processo.
 *
 *   GET /health  200 laço vivo (última volta há menos de `parado` ms)
 *                503 laço parado ou encerrando
 */
export interface EstadoSaude {
  ultimaVolta: number
  encerrando: boolean
  execucaoHabilitada: boolean
  emAndamento: number
}

export function servidorSaude(porta: number, estado: () => EstadoSaude, parado = 5 * 60_000): Server {
  const servidor = createServer((req, res) => {
    if (req.method !== 'GET' || (req.url !== '/health' && req.url !== '/')) {
      res.writeHead(404).end()
      return
    }
    const e = estado()
    const vivo = !e.encerrando && Date.now() - e.ultimaVolta < parado
    res.writeHead(vivo ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify({
      status: vivo ? 'ok' : e.encerrando ? 'shutting_down' : 'stalled',
      ai_execution_enabled: e.execucaoHabilitada,
      running: e.emAndamento,
    }))
  })
  servidor.listen(porta)
  return servidor
}
