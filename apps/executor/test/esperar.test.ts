import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ErroApi } from '../src/api.js'
import {
  AGRUPAR_FILA_MS, ESPERA_ERRO_MAX_MS, ESPERA_ERRO_MIN_MS, INTERVALO_DESLIGADA_MS, INTERVALO_MAX_MS, INTERVALO_MIN_MS,
  PARADA_REVER_MS, arquivoParada, arquivoTrava, esperar, situacao, type ApiEsperar, type RespostaVerificar,
} from '../src/esperar.js'
import { COMANDO_ESPERAR, ROTEIRO_VIGIA } from '../src/prompt.js'

/**
 * "dg-executor esperar" sem rede e sem esperar de verdade: a API é uma lista
 * de respostas, o relógio anda quando o comando "dorme".
 */

type Passo = Partial<RespostaVerificar> | Error

function cenario(passos: Passo[], extra: { eu?: () => Promise<{ execution_enabled: boolean }> } = {}) {
  let relogio = Date.parse('2026-11-11T12:00:00Z')
  const sonos: number[] = []
  const saida: string[] = []
  let consultas = 0
  const api: ApiEsperar = {
    async verificar() {
      const p = passos[Math.min(consultas, passos.length - 1)]
      consultas++
      if (p instanceof Error) throw p
      return { wake: false, execution_enabled: true, newest_job_at: null, ...p }
    },
    eu: extra.eu ?? (async () => ({ execution_enabled: true })),
  }
  return {
    api,
    saida,
    sonos,
    get consultas() { return consultas },
    agora: () => relogio,
    dormir: async (ms: number) => { sonos.push(ms); relogio += ms },
    escrever: (l: string) => { saida.push(l) },
  }
}

const rede = () => new ErroApi(0, 'NETWORK', 'Sem conexão')
const revogado = () => new ErroApi(403, 'FORBIDDEN', 'Acesso do computador inválido ou revogado')

let pasta: string
beforeEach(async () => { pasta = await mkdtemp(join(tmpdir(), 'dg-esperar-')) })
afterEach(async () => { await rm(pasta, { recursive: true, force: true }) })

const opcoes = (c: ReturnType<typeof cenario>, extra: Record<string, unknown> = {}) =>
  ({ api: c.api, pasta, escrever: c.escrever, dormir: c.dormir, agora: c.agora, sorteio: () => 0.5, pid: 4242, vivo: () => true, ...extra })

describe('esperar (Verificar agora)', () => {
  it('fica parado consultando a cada 15 a 30 s e termina com VERIFICAR_AGORA quando pedem', async () => {
    const c = cenario([{}, {}, { wake: true }])
    expect(await esperar(opcoes(c))).toBe(0)
    expect(c.consultas).toBe(3)
    expect(c.saida).toHaveLength(1)
    expect(c.saida[0]).toMatch(/^VERIFICAR_AGORA: .*roteiro_vigia/)
    // Duas esperas entre as três consultas, cada uma entre 15 e 30 s (em fatias de no máximo 20 s).
    const total = c.sonos.reduce((a, b) => a + b, 0)
    expect(total).toBe(2 * (INTERVALO_MIN_MS + (INTERVALO_MAX_MS - INTERVALO_MIN_MS) / 2))
    expect(Math.max(...c.sonos)).toBeLessThanOrEqual(20_000)
    expect(existsSync(arquivoTrava(pasta))).toBe(false)
  })

  it('não imprime nada enquanto espera: qualquer saída acordaria o Claude', async () => {
    const c = cenario([{}, {}, {}, {}, { wake: true }])
    await esperar(opcoes(c))
    expect(c.saida).toHaveLength(1)
  })

  it('uma espera por vez: com outra viva, a segunda sai na hora com JA_ESPERANDO e não consulta', async () => {
    await writeFile(arquivoTrava(pasta), JSON.stringify({ pid: 999, desde: 'x' }))
    const c = cenario([{ wake: true }])
    expect(await esperar(opcoes(c, { vivo: (pid: number) => pid === 999 }))).toBe(0)
    expect(c.consultas).toBe(0)
    expect(c.saida[0]).toMatch(/^JA_ESPERANDO/)
    expect(JSON.parse(await readFile(arquivoTrava(pasta), 'utf8')).pid).toBe(999)
  })

  it('trava de espera que morreu (processo sumiu ou parou de renovar) não impede uma nova', async () => {
    await writeFile(arquivoTrava(pasta), JSON.stringify({ pid: 999, desde: 'x' }))
    const c = cenario([{ wake: true }])
    expect(await esperar(opcoes(c, { vivo: (pid: number) => pid !== 999 }))).toBe(0)
    expect(c.saida[0]).toMatch(/^VERIFICAR_AGORA/)

    await writeFile(arquivoTrava(pasta), JSON.stringify({ pid: 999, desde: 'x' }))
    const velho = new Date(Date.now() - 5 * 60_000)
    await utimes(arquivoTrava(pasta), velho, velho)
    const c2 = cenario([{ wake: true }])
    expect(await esperar(opcoes(c2))).toBe(0)
    expect(c2.saida[0]).toMatch(/^VERIFICAR_AGORA/)
  })

  it('queda de rede: tenta de novo em silêncio, esperando 30 s, 60 s, 120 s... até 5 min', async () => {
    const passos: Passo[] = [rede(), rede(), rede(), rede(), rede(), rede(), rede(), { wake: true }]
    const c = cenario(passos)
    expect(await esperar(opcoes(c))).toBe(0)
    expect(c.saida).toEqual([expect.stringMatching(/^VERIFICAR_AGORA/)])
    // Soma das esperas por consulta (as fatias de 20 s somadas).
    const esperas: number[] = []
    let acumulado = 0
    const alvo = [30, 60, 120, 240, 300, 300, 300].map((s) => s * 1000)
    for (const s of c.sonos) { acumulado += s; if (acumulado === alvo[esperas.length]) { esperas.push(acumulado); acumulado = 0 } }
    expect(esperas).toEqual(alvo)
    expect(Math.max(...alvo)).toBe(ESPERA_ERRO_MAX_MS)
    expect(alvo[0]).toBe(ESPERA_ERRO_MIN_MS)
  })

  it('5xx e 429 também são passageiros', async () => {
    const c = cenario([new ErroApi(503, 'HTTP', 'fora'), new ErroApi(429, 'RATE_LIMITED', 'calma'), { wake: true }])
    expect(await esperar(opcoes(c))).toBe(0)
    expect(c.saida).toHaveLength(1)
  })

  it('execução DESLIGADA: continua esperando em silêncio, a cada minuto, até religar', async () => {
    const c = cenario([{ execution_enabled: false }, { execution_enabled: false }, { wake: true }])
    expect(await esperar(opcoes(c))).toBe(0)
    expect(c.saida).toEqual([expect.stringMatching(/^VERIFICAR_AGORA/)])
    expect(c.sonos.reduce((a, b) => a + b, 0)).toBe(2 * INTERVALO_DESLIGADA_MS)
  })

  it('token revogado: imprime ESPERA_PARADA uma vez, termina e deixa a marca para a rodada não começar outra', async () => {
    const c = cenario([revogado()])
    expect(await esperar(opcoes(c))).toBe(2)
    expect(c.saida).toHaveLength(1)
    expect(c.saida[0]).toMatch(/^ESPERA_PARADA: .*revogado/)
    expect(JSON.parse(await readFile(arquivoParada(pasta), 'utf8')).tipo).toBe('acesso')
    expect(existsSync(arquivoTrava(pasta))).toBe(false)

    // A rodada seguinte pergunta antes e NÃO inicia outra espera enquanto o acesso continuar recusado.
    const r = cenario([], { eu: async () => { throw revogado() } })
    await situacao(opcoes(r))
    expect(r.saida[0]).toMatch(/^ESPERA_PARADA: .*revogado/)
    expect(existsSync(arquivoParada(pasta))).toBe(true)

    // Computador autorizado de novo: a marca sai e a espera volta.
    const ok = cenario([])
    await situacao(opcoes(ok))
    expect(ok.saida[0]).toMatch(/^SEM_ESPERA/)
    expect(existsSync(arquivoParada(pasta))).toBe(false)
  })

  it('DG Brasil sem a rota (404): para uma vez; a rodada só tenta de novo depois de 1 hora', async () => {
    const c = cenario([new ErroApi(404, 'NOT_FOUND', 'Rota inexistente.')])
    expect(await esperar(opcoes(c))).toBe(2)
    expect(c.saida[0]).toMatch(/^ESPERA_PARADA: .*Atualize o conector/)
    const logo = cenario([])
    await situacao(opcoes(logo, { agora: () => c.agora() + 60_000 }))
    expect(logo.saida[0]).toMatch(/^ESPERA_PARADA/)
    const depois = cenario([])
    await situacao(opcoes(depois, { agora: () => c.agora() + PARADA_REVER_MS + 60_000 }))
    expect(depois.saida[0]).toMatch(/^SEM_ESPERA/)
  })

  it('sessão fechada (o Claude Code sumiu): termina em silêncio, sem ninguém para acordar', async () => {
    const c = cenario([{}, {}, {}, { wake: true }])
    let vivo = true
    const pronto = esperar(opcoes(c, { vigiar: [777], vivo: (pid: number) => pid !== 777 || vivo, dormir: async (ms: number) => { await c.dormir(ms); vivo = false } }))
    expect(await pronto).toBe(0)
    expect(c.saida).toEqual([])
    expect(c.consultas).toBe(1)
    expect(existsSync(arquivoTrava(pasta))).toBe(false)
  })

  it('--situacao: ESPERA_ATIVA com outra viva, SEM_ESPERA sem; nunca consulta (não consome pedido)', async () => {
    const c = cenario([{ wake: true }])
    await situacao(opcoes(c))
    expect(c.saida[0]).toMatch(/^SEM_ESPERA/)
    await writeFile(arquivoTrava(pasta), JSON.stringify({ pid: 999, desde: 'x' }))
    await situacao(opcoes(c, { vivo: (pid: number) => pid === 999 }))
    expect(c.saida[1]).toMatch(/^ESPERA_ATIVA/)
    expect(c.consultas).toBe(0)
  })

  it('pedido que chega durante uma rodada fica no DG Brasil: a espera nova pega na primeira consulta', async () => {
    const c = cenario([{ wake: true }])
    expect(await esperar(opcoes(c))).toBe(0)
    expect(c.consultas).toBe(1)
    expect(c.sonos).toEqual([])
  })

  describe('--fila (opcional)', () => {
    it('termina com TRABALHO_NOVO 1 min depois do primeiro trabalho novo (junta os que chegam juntos)', async () => {
      const c = cenario([
        { newest_job_at: '2026-11-11T10:00:00Z' },
        { newest_job_at: '2026-11-11T10:00:00Z' },
        { newest_job_at: '2026-11-11T12:00:30Z' },
        { newest_job_at: '2026-11-11T12:00:40Z' },
      ])
      let inicioNovo = 0
      const agoraOriginal = c.agora
      expect(await esperar(opcoes(c, { fila: true, escrever: (l: string) => { c.saida.push(l); inicioNovo = agoraOriginal() } }))).toBe(0)
      expect(c.saida).toEqual([expect.stringMatching(/^TRABALHO_NOVO: .*roteiro_vigia/)])
      expect(inicioNovo).toBeGreaterThan(0)
      expect(c.sonos.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(2 * INTERVALO_MIN_MS + AGRUPAR_FILA_MS)
    })

    it('trabalho que já estava na fila (ou que voltou para tentar de novo) não acorda', async () => {
      const c = cenario([
        { newest_job_at: '2026-11-11T10:00:00Z' },
        { newest_job_at: '2026-11-11T10:00:00Z' },
        { newest_job_at: null },
        { newest_job_at: '2026-11-11T10:00:00Z', wake: true },
      ])
      await esperar(opcoes(c, { fila: true }))
      expect(c.saida).toEqual([expect.stringMatching(/^VERIFICAR_AGORA/)])
    })

    it('sem a opção, trabalho novo não acorda (só o botão e os 15 min)', async () => {
      const c = cenario([{ newest_job_at: null }, { newest_job_at: '2026-11-11T12:00:30Z' }, {}, {}, {}, {}, { wake: true }])
      await esperar(opcoes(c))
      expect(c.saida).toEqual([expect.stringMatching(/^VERIFICAR_AGORA/)])
    })
  })
})

describe('roteiro da Vigia: passo ESPERA', () => {
  it('no fim de toda rodada: pergunta a situação e só então deixa o esperar em segundo plano', () => {
    expect(COMANDO_ESPERAR).toBe('node C:/DGBrasil/executor/dg-executor.mjs esperar')
    expect(ROTEIRO_VIGIA).toContain(`em primeiro plano: ${COMANDO_ESPERAR} --situacao`)
    expect(ROTEIRO_VIGIA).toContain(`run_in_background=true: ${COMANDO_ESPERAR}\n`)
    expect(ROTEIRO_VIGIA).toMatch(/SEM_ESPERA[\s\S]*ESPERA_ATIVA ou ESPERA_PARADA: não inicie outro/)
    expect(ROTEIRO_VIGIA).toMatch(/VERIFICAR_AGORA ou TRABALHO_NOVO: rode a rodada inteira agora/)
    expect(ROTEIRO_VIGIA).toMatch(/ESPERA_PARADA ou JA_ESPERANDO: não rode a rodada/)
  })

  it('fila vazia e execução desligada também terminam no passo 4, não num "pare"', () => {
    expect(ROTEIRO_VIGIA).toContain('"Fila vazia" e a hora, numa linha, e vá direto ao passo 4 (ESPERA)')
    expect(ROTEIRO_VIGIA).toContain('"Execução desligada no DG Brasil", não tente os outros e vá ao passo 4 (ESPERA)')
    // O passo 4 vem depois do resumo (passo 3) e antes do MODO VIGIA.
    expect(ROTEIRO_VIGIA).toMatch(/3\. No fim, resuma em poucas linhas[\s\S]*\n4\. ESPERA[\s\S]*MODO VIGIA/)
  })

  it('o comando sai exatamente na grafia que a regra do instalador libera', () => {
    for (const linha of ROTEIRO_VIGIA.split('\n').filter((l) => l.includes('dg-executor.mjs'))) {
      expect(linha).not.toMatch(/\\|"node|'node|cd /)
    }
  })
})
