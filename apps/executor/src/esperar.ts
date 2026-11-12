import { mkdir, open, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ErroApi } from './api.js'

/**
 * "dg-executor esperar": o botão "Verificar agora" da sessão Vigia (052).
 *
 * A Vigia roda o roteiro a cada 15 minutos pelo /loop do Claude Code. No fim de
 * cada rodada ela deixa este comando em SEGUNDO PLANO. Ele fica parado,
 * consultando o DG Brasil a cada 15 a 30 s (sem o Claude, sem gastar a
 * assinatura). Quando um advogado clica em "Verificar agora", a consulta
 * devolve wake=true, o comando imprime uma linha e termina. O Claude Code
 * avisa a sessão que o comando terminou, e ela roda o roteiro na hora.
 *
 * Qualquer término acorda o Claude (com ou sem saída). Por isso:
 *  - uma espera por vez (trava em <pasta da sessão>\esperar.lock). A rodada
 *    pergunta antes com "esperar --situacao" (em primeiro plano, não acorda
 *    ninguém) e só inicia uma espera nova se não houver outra;
 *  - queda de rede, 5xx e 429: espera mais e tenta de novo, em silêncio;
 *  - execução DESLIGADA: continua esperando, em silêncio, até religar;
 *  - erro definitivo (token revogado, configuração, DG Brasil sem a rota):
 *    imprime uma linha e termina UMA vez; a marca esperar.parado impede que a
 *    rodada seguinte comece outra espera que pararia igual;
 *  - a sessão fechou (o processo do Claude Code sumiu): termina em silêncio,
 *    porque não há ninguém para acordar.
 */

export const LINHA = {
  verificar: 'VERIFICAR_AGORA',
  trabalhoNovo: 'TRABALHO_NOVO',
  parada: 'ESPERA_PARADA',
  jaEsperando: 'JA_ESPERANDO',
  ativa: 'ESPERA_ATIVA',
  semEspera: 'SEM_ESPERA',
} as const

const REPETIR_ROTEIRO = 'Use agora a ferramenta roteiro_vigia do servidor dg-brasil e siga exatamente o roteiro que ela devolver.'

export interface RespostaVerificar { wake: boolean; execution_enabled: boolean; newest_job_at: string | null }

export interface ApiEsperar {
  verificar(): Promise<RespostaVerificar>
  eu(): Promise<{ execution_enabled: boolean }>
}

export interface OpcoesEsperar {
  api: ApiEsperar
  /** Pasta da trava e da marca de parada (C:\DGBrasil\sessao). */
  pasta: string
  /** Também termina quando entra trabalho novo na fila (opção "esperar_fila"). */
  fila?: boolean
  escrever?: (linha: string) => void
  /** Processos que, se sumirem, encerram a espera em silêncio (Claude Code, shell que chamou). */
  vigiar?: number[]
  dormir?: (ms: number) => Promise<void>
  agora?: () => number
  vivo?: (pid: number) => boolean
  sorteio?: () => number
  pid?: number
}

/** Intervalo normal entre consultas: 15 a 30 s. */
export const INTERVALO_MIN_MS = 15_000
export const INTERVALO_MAX_MS = 30_000
/** Execução desligada: consulta a cada minuto, em silêncio. */
export const INTERVALO_DESLIGADA_MS = 60_000
/** Sem conexão: 30 s, 60 s, 120 s... até 5 min. */
export const ESPERA_ERRO_MIN_MS = 30_000
export const ESPERA_ERRO_MAX_MS = 300_000
/** A trava é renovada a cada fatia de sono; sem renovar por 2 min, ela venceu. */
export const FATIA_MS = 20_000
export const TRAVA_VENCE_MS = 120_000
/** "--fila": espera 1 min depois do primeiro trabalho novo, para juntar os que chegarem juntos. */
export const AGRUPAR_FILA_MS = 60_000

export const arquivoTrava = (pasta: string) => join(pasta, 'esperar.lock')
export const arquivoParada = (pasta: string) => join(pasta, 'esperar.parado')

export function processoVivo(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Processos a vigiar: o Claude Code (CLAUDE_PID, quando existe) e quem chamou. */
export function processosDaSessao(env: NodeJS.ProcessEnv = process.env, ppid = process.ppid): number[] {
  const pids = [Number(env.CLAUDE_PID), ppid].filter((p) => Number.isInteger(p) && p > 0)
  return [...new Set(pids)]
}

type Dependencias = Required<Omit<OpcoesEsperar, 'fila' | 'vigiar'>> & { fila: boolean; vigiar: number[] }

function preencher(o: OpcoesEsperar): Dependencias {
  return {
    fila: false,
    vigiar: [],
    escrever: (l) => process.stdout.write(`${l}\n`),
    dormir: (ms) => new Promise((r) => setTimeout(r, ms)),
    agora: Date.now,
    vivo: processoVivo,
    sorteio: Math.random,
    pid: process.pid,
    ...o,
  }
}

// ───────────────────────────── trava ─────────────────────────────

interface Trava { pid: number; desde: string }

async function lerTrava(pasta: string): Promise<{ trava: Trava | null; idadeMs: number } | null> {
  try {
    const caminho = arquivoTrava(pasta)
    const [texto, info] = await Promise.all([readFile(caminho, 'utf8'), stat(caminho)])
    let trava: Trava | null = null
    try { trava = JSON.parse(texto) as Trava } catch { trava = null }
    return { trava, idadeMs: Date.now() - info.mtimeMs }
  } catch {
    return null
  }
}

/** Há uma espera viva? (trava renovada há menos de 2 min e o processo dono existe) */
async function esperaViva(pasta: string, d: Pick<Dependencias, 'vivo'>): Promise<boolean> {
  const t = await lerTrava(pasta)
  if (!t?.trava) return false
  return t.idadeMs < TRAVA_VENCE_MS && d.vivo(Number(t.trava.pid))
}

async function pegarTrava(pasta: string, d: Dependencias): Promise<boolean> {
  await mkdir(pasta, { recursive: true })
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      const h = await open(arquivoTrava(pasta), 'wx')
      await h.writeFile(JSON.stringify({ pid: d.pid, desde: new Date(d.agora()).toISOString() } satisfies Trava))
      await h.close()
      return true
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      if (await esperaViva(pasta, d)) return false
      // Trava velha (processo sumiu ou parou de renovar): tira e tenta de novo.
      await rm(arquivoTrava(pasta), { force: true })
    }
  }
  return false
}

async function renovarTrava(pasta: string) {
  const agora = new Date()
  await utimes(arquivoTrava(pasta), agora, agora).catch(() => undefined)
}

async function soltarTrava(pasta: string, pid: number) {
  const t = await lerTrava(pasta)
  if (t?.trava?.pid === pid) await rm(arquivoTrava(pasta), { force: true })
}

// ───────────────────────────── erros ─────────────────────────────

/** Marca de parada sem ser de acesso: a rodada tenta de novo depois de 1 hora. */
export const PARADA_REVER_MS = 3_600_000

interface Definitivo { tipo: 'acesso' | 'outro'; motivo: string }

/** Erro que não se resolve esperando: token revogado ou inválido, rota inexistente, outro 4xx. */
export function erroDefinitivo(e: unknown): Definitivo | null {
  if (!(e instanceof ErroApi)) return null
  if (e.status === 0 || e.status === 429 || e.status >= 500) return null
  if (e.status === 401 || e.status === 403) {
    return { tipo: 'acesso', motivo: 'o DG Brasil recusou o acesso deste computador (token revogado ou inválido). Autorize de novo em DG Brasil → Computador do escritório e rode o instalador.' }
  }
  if (e.status === 404) return { tipo: 'outro', motivo: 'o DG Brasil ainda não tem o "Verificar agora". Atualize o conector (rode o instalador de novo).' }
  return { tipo: 'outro', motivo: `o DG Brasil respondeu ${e.status} (${e.codigo}).` }
}

interface Parada extends Definitivo { em: string }

async function marcarParada(pasta: string, p: Definitivo, d: Pick<Dependencias, 'agora'>) {
  await mkdir(pasta, { recursive: true }).catch(() => undefined)
  const conteudo: Parada = { ...p, em: new Date(d.agora()).toISOString() }
  await writeFile(arquivoParada(pasta), JSON.stringify(conteudo)).catch(() => undefined)
}

async function lerParada(pasta: string): Promise<Parada | null> {
  try {
    const p = JSON.parse(await readFile(arquivoParada(pasta), 'utf8')) as Partial<Parada>
    return { tipo: p.tipo === 'acesso' ? 'acesso' : 'outro', motivo: p.motivo ?? 'motivo não registrado', em: p.em ?? '' }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    return { tipo: 'outro', motivo: 'marca de parada ilegível', em: '' }
  }
}

/** A causa da parada passou? Acesso: pergunta ao DG Brasil (sem consumir pedido). Outro: depois de 1 hora. */
async function paradaResolvida(p: Parada, d: Dependencias): Promise<boolean> {
  if (p.tipo === 'outro') return !(d.agora() - Date.parse(p.em) < PARADA_REVER_MS)
  try {
    await d.api.eu()
    return true
  } catch (e) {
    // Sem conexão agora não prova nada: deixa a espera tentar sozinha.
    return erroDefinitivo(e) === null
  }
}

// ───────────────────────────── comandos ─────────────────────────────

/**
 * "esperar --situacao" (em primeiro plano, no fim de cada rodada): diz se a
 * rodada deve iniciar uma espera. Termina na hora e imprime UMA linha.
 *   ESPERA_ATIVA   já há uma espera: não inicie outra
 *   SEM_ESPERA     inicie "esperar" em segundo plano
 *   ESPERA_PARADA  a última parou por erro definitivo que continua: não inicie
 */
export async function situacao(o: OpcoesEsperar): Promise<string> {
  const d = preencher(o)
  if (await esperaViva(d.pasta, d)) return emitir(d, `${LINHA.ativa}: já há uma espera rodando. Não inicie outra.`)
  const parada = await lerParada(d.pasta)
  if (parada) {
    // O problema pode ter sido resolvido (computador autorizado de novo, conector atualizado).
    if (!(await paradaResolvida(parada, d))) {
      return emitir(d, `${LINHA.parada}: ${parada.motivo} Não inicie a espera; a Vigia segue de 15 em 15 minutos.`)
    }
    await rm(arquivoParada(d.pasta), { force: true })
  }
  return emitir(d, `${LINHA.semEspera}: inicie a espera em segundo plano.`)
}

/** "esperar" (em segundo plano): devolve o código de saída. */
export async function esperar(o: OpcoesEsperar): Promise<number> {
  const d = preencher(o)
  if (!(await pegarTrava(d.pasta, d))) {
    emitir(d, `${LINHA.jaEsperando}: já há uma espera rodando neste computador. Nada a fazer nesta rodada.`)
    return 0
  }
  try {
    return await laco(d)
  } finally {
    await soltarTrava(d.pasta, d.pid)
  }
}

async function laco(d: Dependencias): Promise<number> {
  let falhasSeguidas = 0
  let linhaDeBase: string | null | undefined // hora do trabalho mais novo quando a espera começou
  let novoDesde: number | null = null
  for (;;) {
    let proxima: number
    try {
      const r = await d.api.verificar()
      falhasSeguidas = 0
      if (r.wake) {
        emitir(d, `${LINHA.verificar}: um advogado pediu pelo DG Brasil para verificar a fila agora. ${REPETIR_ROTEIRO}`)
        return 0
      }
      if (!r.execution_enabled) {
        proxima = INTERVALO_DESLIGADA_MS
      } else {
        if (d.fila) {
          if (linhaDeBase === undefined) linhaDeBase = r.newest_job_at
          else if (novoDesde === null && r.newest_job_at && (!linhaDeBase || r.newest_job_at > linhaDeBase)) novoDesde = d.agora()
          if (novoDesde !== null && d.agora() - novoDesde >= AGRUPAR_FILA_MS) {
            emitir(d, `${LINHA.trabalhoNovo}: entrou trabalho novo na fila do DG Brasil. ${REPETIR_ROTEIRO}`)
            return 0
          }
        }
        proxima = INTERVALO_MIN_MS + Math.floor(d.sorteio() * (INTERVALO_MAX_MS - INTERVALO_MIN_MS))
        if (novoDesde !== null) proxima = Math.min(proxima, Math.max(1_000, AGRUPAR_FILA_MS - (d.agora() - novoDesde)))
      }
    } catch (e) {
      const definitivo = erroDefinitivo(e)
      if (definitivo) {
        await marcarParada(d.pasta, definitivo, d)
        emitir(d, `${LINHA.parada}: ${definitivo.motivo} A espera parou; a Vigia segue de 15 em 15 minutos. Não inicie outra espera.`)
        return 2
      }
      falhasSeguidas++
      proxima = Math.min(ESPERA_ERRO_MIN_MS * 2 ** (falhasSeguidas - 1), ESPERA_ERRO_MAX_MS)
    }
    if (!(await dormirVigiando(d, proxima))) return 0
  }
}

/** Dorme em fatias, renovando a trava. Devolve false se a sessão fechou (sair em silêncio). */
async function dormirVigiando(d: Dependencias, ms: number): Promise<boolean> {
  let resta = ms
  while (resta > 0) {
    if (d.vigiar.some((pid) => !d.vivo(pid))) return false
    const fatia = Math.min(resta, FATIA_MS)
    await d.dormir(fatia)
    resta -= fatia
    await renovarTrava(d.pasta)
  }
  return !d.vigiar.some((pid) => !d.vivo(pid))
}

function emitir(d: Pick<Dependencias, 'escrever'>, linha: string): string {
  d.escrever(linha)
  return linha
}
