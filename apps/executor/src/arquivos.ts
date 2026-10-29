import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { lstat, mkdir, readFile, realpath, rm, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/**
 * Arquivos de um trabalho, numa pasta só dele:
 *
 *   <pasta de trabalhos>\<id do trabalho>\entrada   documentos baixados do DG Brasil
 *   <pasta de trabalhos>\<id do trabalho>\saida     o que o agente gera para entregar
 *
 * Download confere o SHA-256 que o banco tem da versão (documento trocado no
 * caminho = trabalho para). Entrega só aceita arquivo DENTRO de saida
 * (sem "..", sem atalho para fora). A pasta é apagada ao terminar.
 */

export const LIMITE_MINUTA = 50 * 1024 * 1024
export const LIMITE_DOWNLOAD = 60 * 1024 * 1024

export const MIME_MINUTA: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
}

export class ErroArquivo extends Error {
  constructor(readonly codigo: 'CHECKSUM' | 'FORA_DA_SAIDA' | 'INEXISTENTE' | 'TIPO' | 'TAMANHO' | 'REDE', message: string) {
    super(message)
  }
}

export interface PastasTrabalho {
  raiz: string
  entrada: string
  saida: string
}

export async function criarPastas(pastaTrabalhos: string, trabalhoId: string): Promise<PastasTrabalho> {
  if (!/^[0-9a-f-]{36}$/i.test(trabalhoId)) throw new Error('id de trabalho inválido')
  const raiz = join(pastaTrabalhos, trabalhoId)
  const entrada = join(raiz, 'entrada')
  const saida = join(raiz, 'saida')
  await mkdir(entrada, { recursive: true })
  await mkdir(saida, { recursive: true })
  return { raiz, entrada, saida }
}

export async function apagarPasta(raiz: string): Promise<void> {
  await rm(raiz, { recursive: true, force: true, maxRetries: 3 })
}

const RESERVADOS = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i

/** Nome de arquivo seguro no Windows, preservando a extensão. */
export function nomeSeguro(nome: string | null | undefined, reserva: string): string {
  const base = basename(String(nome ?? '').replace(/\\/g, '/'))
  const ext = extname(base).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10)
  let corpo = base.slice(0, base.length - extname(base).length)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ._-]/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 100)
  if (!corpo || RESERVADOS.test(corpo)) corpo = reserva
  return `${corpo}${ext}`
}

/** Nome livre dentro da pasta (não sobrescreve: _2, _3...). */
export async function nomeLivre(pasta: string, nome: string): Promise<string> {
  const ext = extname(nome)
  const corpo = nome.slice(0, nome.length - ext.length)
  for (let i = 1; i < 1000; i++) {
    const candidato = join(pasta, i === 1 ? nome : `${corpo}_${i}${ext}`)
    try { await lstat(candidato) } catch { return candidato }
  }
  throw new Error('pasta cheia')
}

/** Baixa para `destino` calculando o SHA-256 no caminho; confere se `esperado` vier. */
export async function baixar(url: string, destino: string, esperado: string | null, fetchFn: typeof fetch = fetch): Promise<{ sha256: string; tamanho: number }> {
  const r = await fetchFn(url, { signal: AbortSignal.timeout(120_000) })
  if (!r.ok || !r.body) throw new ErroArquivo('REDE', `Falha ao baixar (${r.status}).`)
  const hash = createHash('sha256')
  let tamanho = 0
  const contar = new Transform({
    transform(pedaco: Buffer, _enc, cb) {
      tamanho += pedaco.length
      if (tamanho > LIMITE_DOWNLOAD) return cb(new ErroArquivo('TAMANHO', 'Documento maior que o limite.'))
      hash.update(pedaco)
      cb(null, pedaco)
    },
  })
  try {
    await pipeline(Readable.fromWeb(r.body as never), contar, createWriteStream(destino, { flags: 'wx' }))
  } catch (e) {
    await rm(destino, { force: true })
    throw e
  }
  const sha256 = hash.digest('hex')
  if (esperado && sha256 !== esperado) {
    await rm(destino, { force: true })
    throw new ErroArquivo('CHECKSUM', 'O arquivo baixado não confere com a versão registrada no DG Brasil.')
  }
  return { sha256, tamanho }
}

/**
 * Resolve um arquivo que o agente diz ter gerado. Aceita caminho relativo à
 * saida (ou absoluto, desde que dentro dela). Recusa tudo fora — inclusive
 * atalho/junção que aponte para fora.
 */
export async function caminhoNaSaida(saida: string, informado: string): Promise<{ caminho: string; tamanho: number }> {
  const alvo = isAbsolute(informado) ? resolve(informado) : resolve(saida, informado)
  const saidaReal = await realpath(saida)
  let real: string
  try {
    real = await realpath(alvo)
  } catch {
    throw new ErroArquivo('INEXISTENTE', `Arquivo não encontrado na pasta saida: ${informado}`)
  }
  const rel = relative(saidaReal, real)
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
    throw new ErroArquivo('FORA_DA_SAIDA', 'Só é possível entregar arquivos que estão dentro da pasta saida deste trabalho.')
  }
  const info = await stat(real)
  if (!info.isFile()) throw new ErroArquivo('INEXISTENTE', 'Não é um arquivo.')
  if (info.size === 0) throw new ErroArquivo('TAMANHO', 'Arquivo vazio.')
  if (info.size > LIMITE_MINUTA) throw new ErroArquivo('TAMANHO', 'Arquivo maior que 50 MB.')
  return { caminho: real, tamanho: info.size }
}

export async function arquivoDaSaida(saida: string, informado: string): Promise<{ caminho: string; nome: string; mime: string; tamanho: number }> {
  const { caminho: real, tamanho } = await caminhoNaSaida(saida, informado)
  const nome = basename(real)
  const mime = MIME_MINUTA[extname(nome).toLowerCase()]
  if (!mime) throw new ErroArquivo('TIPO', `Tipo não aceito. Use: ${Object.keys(MIME_MINUTA).join(', ')}`)
  return { caminho: real, nome, mime, tamanho }
}

export async function lerComHash(caminho: string): Promise<{ bytes: Buffer; sha256: string }> {
  const bytes = await readFile(caminho)
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') }
}

/** Envia para a URL assinada do Storage (escrita única). */
export async function enviar(url: string, bytes: Buffer, mime: string, fetchFn: typeof fetch = fetch): Promise<void> {
  const r = await fetchFn(url, {
    method: 'PUT',
    headers: { 'content-type': mime, 'x-upsert': 'false', 'cache-control': 'no-store' },
    body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(120_000),
  })
  if (!r.ok) throw new ErroArquivo('REDE', `Falha ao enviar o arquivo (${r.status}).`)
}
