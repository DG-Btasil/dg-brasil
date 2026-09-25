import { randomUUID } from 'node:crypto'
import { pool } from './db.js'
import { executar } from './executor.js'
import { aplicarAprovadas } from './aplicar.js'
import { concluir, falhar, liberarExpiradas, proximaExecucao } from './fila.js'

const WORKER = `${process.env.FLY_MACHINE_ID ?? 'local'}-${randomUUID().slice(0, 8)}`
const OCIOSO_MS = 5_000

let parando = false
for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, () => {
    // Não mata execução no meio: para de pegar trabalho novo e termina o atual.
    // A reserva no banco cobre o caso de o processo morrer de verdade.
    console.log(`[${WORKER}] ${sinal} recebido, encerrando após a execução atual`)
    parando = true
  })
}

async function laço() {
  console.log(`[${WORKER}] worker de agentes no ar`)

  while (!parando) {
    let trabalhou = false

    try {
      const item = await proximaExecucao(WORKER)
      if (item) {
        trabalhou = true
        const { execucao, agente } = item
        console.log(`[${WORKER}] execução ${execucao.id} → agente ${agente.slug}`)

        try {
          const metricas = await executar(execucao, agente)
          const estado = await concluir(execucao.id, metricas)
          console.log(
            `[${WORKER}] ${execucao.id} ${estado}` +
              ` · US$ ${metricas.custoUsd.toFixed(4)}`,
          )
        } catch (erro) {
          const destino = await falhar(execucao, erro)
          console.error(`[${WORKER}] ${execucao.id} ${destino}:`, erro)
        }
      }

      // Propostas que um humano aprovou no painel só produzem efeito aqui.
      const aplicadas = await aplicarAprovadas()
      if (aplicadas > 0) {
        trabalhou = true
        console.log(`[${WORKER}] ${aplicadas} proposta(s) aplicada(s)`)
      }

      if (!trabalhou) {
        const liberadas = await liberarExpiradas()
        if (liberadas) console.warn(`[${WORKER}] ${liberadas} execução(ões) devolvidas à fila`)
        await dormir(OCIOSO_MS)
      }
    } catch (erro) {
      // Banco fora do ar, rede caiu: espera e tenta de novo. Não derruba o worker.
      console.error(`[${WORKER}] erro no laço:`, erro)
      await dormir(OCIOSO_MS * 3)
    }
  }

  await pool.end()
  console.log(`[${WORKER}] encerrado`)
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

laço().catch((erro) => {
  console.error('falha fatal no worker:', erro)
  process.exit(1)
})
