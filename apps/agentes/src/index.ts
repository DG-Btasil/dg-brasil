import { randomUUID } from 'node:crypto'
import { armazenamentoSupabase } from './armazenamento.js'
import { aplicarDecididas } from './aplicar.js'
import { bancoPostgres } from './banco.js'
import { executarComClaude } from './executor.js'
import { lerMensagem, processarMensagem, type Dependencias } from './fila.js'

function obrigatorio(nome: string): string {
  const v = process.env[nome]
  if (!v) throw new Error(`variável de ambiente ausente: ${nome}`)
  return v
}

const WORKER = `${process.env.FLY_MACHINE_ID ?? 'local'}-${randomUUID().slice(0, 8)}`
const OCIOSO_MS = 5_000

const deps: Dependencias = {
  banco: bancoPostgres(obrigatorio('DATABASE_URL')),
  armazenamento: armazenamentoSupabase(obrigatorio('SUPABASE_URL'), obrigatorio('SUPABASE_SERVICE_ROLE_KEY')),
  executar: executarComClaude,
  worker: WORKER,
  maxTentativas: Number(process.env.MAX_TENTATIVAS ?? '3'),
  // Maior que a execução mais longa esperada: se o worker morrer, a mensagem
  // reaparece depois disso e outro worker assume.
  vtSegundos: Number(process.env.FILA_VT_SEGUNDOS ?? '1800'),
}

let parando = false
for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, () => {
    // Não mata execução no meio: para de pegar trabalho novo e termina o atual.
    console.log(`[${WORKER}] ${sinal} recebido, encerrando após a execução atual`)
    parando = true
  })
}

async function laço() {
  console.log(`[${WORKER}] worker de agentes no ar`)

  while (!parando) {
    let trabalhou = false
    try {
      const msg = await lerMensagem(deps.banco, deps.vtSegundos)
      if (msg) {
        trabalhou = true
        const desfecho = await processarMensagem(deps, msg)
        // Só ids no log: nada de conteúdo, CPF ou prompt.
        console.log(`[${WORKER}] mensagem ${msg.msg_id} (tentativa ${msg.read_ct}): ${desfecho}`)
      }

      // Propostas decididas em Revisões só produzem efeito aqui.
      const decididas = await aplicarDecididas(deps.banco)
      if (decididas > 0) {
        trabalhou = true
        console.log(`[${WORKER}] ${decididas} proposta(s) decidida(s) processada(s)`)
      }

      if (!trabalhou) await dormir(OCIOSO_MS)
    } catch (erro) {
      // Banco fora do ar, rede caiu: espera e tenta de novo. Não derruba o worker.
      console.error(`[${WORKER}] erro no laço:`, erro instanceof Error ? erro.message : erro)
      await dormir(OCIOSO_MS * 3)
    }
  }

  await deps.banco.fechar()
  console.log(`[${WORKER}] encerrado`)
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

laço().catch((erro) => {
  console.error('falha fatal no worker:', erro)
  process.exit(1)
})
