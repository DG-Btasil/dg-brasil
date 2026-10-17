import { randomUUID } from 'node:crypto'
import { armazenamentoSupabase } from './armazenamento.js'
import { aplicarDecididas, lembrarPrazos } from './aplicar.js'
import { bancoPostgres } from './banco.js'
import { lerConfig } from './config.js'
import { iaHabilitadaNoBanco, lerMensagem, processarMensagem, type Dependencias } from './fila.js'
import { criarLogger } from './log.js'
import { ClaudeApiProvider } from './provedor/anthropic.js'
import { servidorSaude } from './saude.js'

/**
 * Worker de agentes. Processo contínuo (não serverless).
 *
 * Duas chaves precisam estar ligadas para uma execução começar:
 *   AI_EXECUTION_ENABLED=true no ambiente do processo (deploy), e
 *   o interruptor do ADMIN no banco (Configurações → IA; 039).
 * Com qualquer uma desligada, o worker não reserva nada (as execuções ficam
 * na fila) — mas continua aplicando propostas já decididas por humanos e
 * fechando execuções decididas, que não chamam IA.
 */

const cfg = lerConfig()
const base = `${cfg.maquina}-${randomUUID().slice(0, 8)}`
const log = criarLogger({ worker: base })
const OCIOSO_MS = 5_000

const banco = bancoPostgres(cfg.bancoUrl)
const armazenamento = armazenamentoSupabase(cfg.supabaseUrl, cfg.supabaseChaveServico)
// Sem chave com a IA ligada no processo: falha logo, na subida (não na primeira execução).
const provedor = cfg.execucaoHabilitada
  ? new ClaudeApiProvider({ chave: cfg.anthropicChave, maxRetries: cfg.anthropicMaxRetries, timeoutMs: cfg.anthropicTimeoutMs, logger: log })
  : null

const estado = { ultimaVolta: Date.now(), encerrando: false, execucaoHabilitada: cfg.execucaoHabilitada, emAndamento: 0 }
const saude = servidorSaude(cfg.porta, () => estado)

let parando = false
for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, () => {
    // Não mata execução no meio: para de reservar trabalho novo e termina o
    // atual. Se o processo for morto antes, a mensagem volta a ficar visível
    // (VT) e a reserva vencida é retomada por outro worker — nunca "sucesso" falso.
    log.info('encerrando', { signal: sinal, count: estado.emAndamento })
    parando = true
    estado.encerrando = true
  })
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Uma "vaga" de execução. WORKER_CONCURRENCY vagas = execuções simultâneas. */
async function vaga(i: number) {
  const deps: Dependencias | null = provedor && {
    banco, armazenamento, provedor, worker: `${base}-${i}`, log,
    maxTentativas: cfg.maxTentativas,
    // Invisibilidade da mensagem. O batimento a renova enquanto o agente roda;
    // se o worker morrer, ela reaparece depois disso e outro worker assume.
    vtSegundos: cfg.vtSegundos,
    reservaVencidaSegundos: cfg.reservaVencidaSegundos,
    tetoUsd: cfg.tetoUsd,
  }
  while (!parando) {
    estado.ultimaVolta = Date.now()
    let trabalhou = false
    try {
      if (deps && await iaHabilitadaNoBanco(banco)) {
        const msg = await lerMensagem(banco, deps.vtSegundos)
        if (msg) {
          trabalhou = true
          estado.emAndamento++
          try {
            const desfecho = await processarMensagem(deps, msg)
            log.info('mensagem_processada', { msg_id: msg.msg_id, attempt: msg.read_ct, desfecho })
          } finally {
            estado.emAndamento--
          }
        }
      }
    } catch (erro) {
      // Banco fora do ar, rede caiu: espera e tenta de novo. Não derruba o worker.
      log.error('erro_no_laco', { reason: erro instanceof Error ? erro.name : typeof erro })
      await dormir(OCIOSO_MS * 3)
    }
    if (!trabalhou) await dormir(OCIOSO_MS)
  }
}

/** Trabalho sem IA: propostas decididas por humanos e lembretes de prazo. */
async function manutencao() {
  while (!parando) {
    try {
      const decididas = await aplicarDecididas(banco, base)
      if (decididas > 0) log.info('propostas_processadas', { count: decididas })
      // Lembretes de prazo (037): idempotentes no banco; a cada 15 min no máximo.
      const lembretes = await lembrarPrazos(banco)
      if (lembretes > 0) log.info('lembretes_de_prazo', { count: lembretes })
    } catch (erro) {
      log.error('erro_na_manutencao', { reason: erro instanceof Error ? erro.name : typeof erro })
    }
    estado.ultimaVolta = Date.now()
    await dormir(OCIOSO_MS)
  }
}

async function principal() {
  log.info('worker_no_ar', { enabled: cfg.execucaoHabilitada, concurrency: cfg.concorrencia, port: cfg.porta,
    provider: provedor?.id ?? 'nenhum' })
  await Promise.all([manutencao(), ...Array.from({ length: cfg.concorrencia }, (_, i) => vaga(i))])
  await banco.fechar()
  saude.close()
  log.info('worker_encerrado')
}

principal().catch((erro) => {
  log.error('falha_fatal', { reason: erro instanceof Error ? erro.name : typeof erro })
  process.exit(1)
})
