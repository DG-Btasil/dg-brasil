import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { DgApi, ErroApi, type Contexto } from './api.js'
import { apagarPasta, criarPastas, type PastasTrabalho } from './arquivos.js'
import type { Log } from './log.js'

/**
 * Os trabalhos que ESTA sessão do Claude Code reservou. O token de reserva
 * fica só na memória deste processo: o Claude passa o id do trabalho, nunca
 * vê o token.
 *
 * Enquanto um trabalho está reservado, a reserva é renovada a cada minuto.
 * Se a sessão fecha ou o computador desliga, a renovação para; em 5 minutos o
 * DG Brasil devolve o trabalho à fila (ou marca falha, se já houve entrega).
 */

export interface Trabalho {
  id: string
  reserva: string
  contexto: Contexto
  pastas: PastasTrabalho
  inicio: number
  interrompido: boolean
  perdido: boolean
  baixados: number
  entregas: number
  timer: NodeJS.Timeout
}

export class ErroTrabalho extends Error {}

export class Trabalhos {
  private readonly ativos = new Map<string, Trabalho>()

  constructor(
    readonly api: DgApi,
    private readonly pastaTrabalhos: string,
    private readonly log: Log,
    private readonly intervaloMs = 60_000,
  ) {}

  /** Pastas que sobraram de sessão anterior (reserva já perdida): apaga. */
  async limparSobras(): Promise<number> {
    let n = 0
    try {
      for (const nome of await readdir(this.pastaTrabalhos)) {
        if (/^[0-9a-f-]{36}$/i.test(nome) && !this.ativos.has(nome)) {
          await apagarPasta(join(this.pastaTrabalhos, nome))
          n++
        }
      }
    } catch { /* pasta ainda não existe */ }
    return n
  }

  async reservar(id: string): Promise<Trabalho> {
    if (this.ativos.has(id)) return this.ativos.get(id)!
    const r = await this.api.reservar(id)
    if (!r.claimed) {
      const motivo: Record<string, string> = {
        DISABLED: 'A execução pelo escritório está DESLIGADA no DG Brasil (Configurações → Computador do escritório). Peça a um ADMIN para ligar.',
        NOT_AVAILABLE: 'Este trabalho não está mais disponível (outra sessão reservou, foi concluído ou interrompido).',
        MAX_ATTEMPTS: 'Este trabalho atingiu o limite de 3 tentativas e foi marcado como falho.',
      }
      throw new ErroTrabalho(motivo[r.reason] ?? `Não foi possível reservar (${r.reason}).`)
    }
    const pastas = await criarPastas(this.pastaTrabalhos, id)
    const t: Trabalho = {
      id, reserva: r.lease_token, contexto: r.context, pastas, inicio: Date.now(),
      interrompido: false, perdido: false, baixados: 0, entregas: 0,
      timer: setInterval(() => void this.renovar(id), this.intervaloMs),
    }
    t.timer.unref?.()
    this.ativos.set(id, t)
    this.log.info('trabalho_reservado', { trabalho_id: id, tentativa: r.attempt })
    return t
  }

  /** O trabalho, se esta sessão ainda o tem. Interrompido/perdido: erro claro. */
  obter(id: string, paraEscrever = false): Trabalho {
    const t = this.ativos.get(id)
    if (!t) throw new ErroTrabalho('Este trabalho não está reservado nesta sessão. Use reservar_trabalho primeiro.')
    if (t.perdido) throw new ErroTrabalho('A reserva deste trabalho foi perdida (sessão parada por mais de 5 minutos ou acesso revogado). Ele voltou para a fila.')
    if (paraEscrever && t.interrompido) {
      throw new ErroTrabalho('Um advogado pediu para INTERROMPER este trabalho. Não entregue mais nada: chame concluir_trabalho para encerrar.')
    }
    return t
  }

  ativosIds(): string[] {
    return [...this.ativos.keys()]
  }

  async progresso(id: string, mensagem: string): Promise<{ interrompido: boolean }> {
    const t = this.obter(id)
    const r = await this.api.batimento(id, t.reserva, mensagem)
    this.aplicarBatimento(t, r)
    return { interrompido: t.interrompido }
  }

  private async renovar(id: string) {
    const t = this.ativos.get(id)
    if (!t || t.perdido) return
    try {
      this.aplicarBatimento(t, await this.api.batimento(id, t.reserva))
    } catch (e) {
      this.log.warn('renovacao_falhou', { trabalho_id: id, status: e instanceof ErroApi ? e.status : 0 })
      if (e instanceof ErroApi && (e.status === 401 || e.status === 403)) t.perdido = true
    }
  }

  private aplicarBatimento(t: Trabalho, r: { ok: boolean; status: string | null; cancel_requested: boolean }) {
    if (r.cancel_requested && !t.interrompido) {
      t.interrompido = true
      this.log.info('interrupcao_pedida', { trabalho_id: t.id })
    }
    if (!r.ok) t.perdido = true
  }

  /** Encerra: chama o DG Brasil, para a renovação e apaga a pasta. */
  async encerrar<T>(id: string, chamada: (t: Trabalho) => Promise<T>): Promise<T> {
    const t = this.ativos.get(id)
    if (!t) throw new ErroTrabalho('Este trabalho não está reservado nesta sessão.')
    const r = await chamada(t)
    clearInterval(t.timer)
    this.ativos.delete(id)
    await apagarPasta(t.pastas.raiz)
    this.log.info('trabalho_encerrado', { trabalho_id: id, duracao_ms: Date.now() - t.inicio, entregas: t.entregas })
    return r
  }

  /**
   * Sessão fechando: devolve o que ainda está reservado. O servidor decide
   * (sem entrega: volta à fila; com entrega: falha parcial). No Windows o
   * Claude Code espera pouco — o que não der tempo, a reserva vence sozinha.
   */
  async liberarTodos(): Promise<void> {
    await Promise.allSettled(this.ativosIds().map((id) =>
      this.encerrar(id, (t) => this.api.falhar(id, t.reserva, 'INTERRUPTED', 'A sessão do Claude Code foi encerrada antes do fim.', true))))
  }
}
