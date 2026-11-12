import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { inflateSync } from 'node:zlib'
import { z } from 'zod'
import { LIMITE_MINUTA } from './arquivos.js'

/**
 * A PONTE (docs/ponte.md): os agentes do computador do escritório fazem o
 * trabalho do DG Brasil na pasta do cliente no Drive (G:\). Desde 11/11/2026 os
 * agentes são os CLONES do DG Brasil (agentes/bancario, sufixo -dg), na pasta
 * G:\Meu Drive\DG BRASIL\CLIENTE BANCÁRIO\<NOME DO CLIENTE>
 * (docs/agentes/clonagem). O conector faz por CÓDIGO tudo o que não pode
 * depender de uma IA:
 *
 *   verificar_arquivos            checagens por script (tipo real, PDF ativo, macro, antivírus)
 *   copiar_para_pasta_do_cliente  entrada → pasta do cliente, com os nomes que os agentes esperam
 *   trazer_da_pasta_do_cliente    o que o agente gerou depois do início → saida (HTML vira PDF)
 *
 * Travas: a pasta do cliente fica SEMPRE dentro de uma raiz permitida do
 * ponte.json (conferido com realpath, sem atalho/junção); nunca sobrescreve,
 * nunca apaga, nunca move; só copia arquivo que o script E o Porteiro
 * liberaram, com o mesmo SHA-256 que foi conferido.
 */

// ── configuração (%APPDATA%\DGBrasil\ponte.json) ────────────────────────────

const NOME_AGENTE = /^[a-z0-9][a-z0-9-]{0,63}$/

const Trazer = z.union([
  z.string().min(1).max(200),
  z.object({
    padrao: z.string().min(1).max(200),
    categoria: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/).optional(),
    titulo: z.string().min(3).max(200).optional(),
  }).strict(),
])

const AgentePonte = z.object({
  /**
   * Pasta(s) da etapa onde ficam as pastas dos clientes (relativas à primeira
   * raiz, ou absolutas dentro de uma raiz). Várias: a pasta do cliente é
   * procurada em todas, na ordem; se não existir, é criada na primeira.
   */
  pasta: z.union([z.string().min(1).max(400), z.array(z.string().min(1).max(400)).min(1).max(10)]),
  trazer: z.array(Trazer).min(1).max(30),
  /** Até quantos níveis de subpasta da pasta do cliente o Mensageiro procura (subpasta do banco, PEÇAS GERADAS...). */
  profundidade: z.number().int().min(0).max(4).default(3),
  /** Gravar o DADOS DO CADASTRO.txt quando a pasta não tiver um (padrão: sim). */
  dados_do_cadastro: z.boolean().default(true),
  /** Criar a pasta do cliente quando ela não existir em nenhuma etapa (padrão: sim). */
  criar_pasta: z.boolean().default(true),
  /**
   * De onde sai o nome da pasta do cliente. "drive": a pasta do Google Drive
   * ligada ao cliente no DG Brasil (os agentes do escritório). "cliente": o nome
   * do cliente no cadastro, sempre (os agentes clonados, em DG BRASIL\CLIENTE BANCÁRIO).
   */
  nome_da_pasta: z.enum(['drive', 'cliente']).default('drive'),
}).strict()

const ArquivoPonte = z.object({
  raiz_permitida: z.string().min(3).max(400).optional(),
  raizes_permitidas: z.array(z.string().min(3).max(400)).max(10).optional(),
  /** Sem pasta do Drive ligada no DG Brasil, usar o nome do cliente (MAIÚSCULAS, sem acento). Padrão: não. */
  pasta_pelo_nome: z.boolean().default(false),
  /** Antivírus do Windows em cada arquivo (padrão: sim). */
  antivirus: z.boolean().default(true),
  agentes: z.record(z.string().regex(NOME_AGENTE), AgentePonte),
}).strict()

export interface ConfigPonte {
  arquivo: string
  raizes: string[]
  pastaPeloNome: boolean
  antivirus: boolean
  agentes: Record<string, z.infer<typeof AgentePonte>>
}

export class ErroPonte extends Error {
  constructor(readonly codigo: 'CONFIG' | 'SEM_PASTA' | 'FORA_DA_RAIZ' | 'PORTEIRO' | 'ORDEM' | 'CONFLITO' | 'NADA', message: string) {
    super(message)
  }
}

export function caminhoPonte(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DG_EXECUTOR_PONTE) return env.DG_EXECUTOR_PONTE
  if (process.platform === 'win32' && env.APPDATA) return join(env.APPDATA, 'DGBrasil', 'ponte.json')
  return join(homedir(), '.config', 'dg-brasil', 'ponte.json')
}

/** Lê o ponte.json. Sem arquivo: null (ninguém passa pela ponte, fluxo de hoje). */
export async function lerPonte(arquivo = caminhoPonte()): Promise<ConfigPonte | null> {
  let bruto: string
  try {
    bruto = await readFile(arquivo, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return null
    throw new ErroPonte('CONFIG', `Não consegui ler ${arquivo}.`)
  }
  let cfg: z.infer<typeof ArquivoPonte>
  try {
    cfg = ArquivoPonte.parse(JSON.parse(bruto.replace(/^\uFEFF/, '')))
  } catch (e) {
    throw new ErroPonte('CONFIG', `ponte.json inválido (${arquivo}): ${e instanceof Error ? e.message.slice(0, 500) : e}`)
  }
  const raizes = [...(cfg.raiz_permitida ? [cfg.raiz_permitida] : []), ...(cfg.raizes_permitidas ?? [])].map((r) => resolve(r))
  if (!raizes.length) throw new ErroPonte('CONFIG', 'ponte.json sem "raiz_permitida".')
  return { arquivo, raizes, pastaPeloNome: cfg.pasta_pelo_nome, antivirus: cfg.antivirus, agentes: cfg.agentes }
}

// ── caminhos ──────────────────────────────────────────────────────────────

/** `alvo` está DENTRO de `base` (nunca a própria base)? Caminhos já resolvidos. */
export function dentro(base: string, alvo: string): boolean {
  const rel = relative(base, alvo)
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
}

const PROIBIDO_NO_NOME = /[\\/:*?"<>|\u0000-\u001f]/

/** Nome de pasta de cliente vindo do DG Brasil: um nome só, sem caminho. */
export function nomeDePasta(nome: string | null | undefined): string | null {
  const n = String(nome ?? '').normalize('NFC').trim().replace(/[. ]+$/, '')
  if (!n || n === '.' || n === '..' || n.length > 200 || PROIBIDO_NO_NOME.test(n)) return null
  return n
}

/** Convenção da Luísa e do Lucas: nome completo em MAIÚSCULAS, sem acento. */
export function nomeDoClienteParaPasta(nome: string): string | null {
  return nomeDePasta(nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').toUpperCase())
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

export function globParaRegex(padrao: string): RegExp {
  const corpo = semAcento(padrao).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${corpo}$`, 'i')
}

export interface PastaDoCliente {
  agente: string
  raiz: string
  etapa: string
  pasta: string
  nome: string
  existe: boolean
  /** Outra etapa da raiz onde já existe uma pasta com o mesmo nome (a ponte não move pasta). */
  emOutraEtapa: string | null
  origemDoNome: 'DG_BRASIL' | 'NOME_DO_CLIENTE'
}

/**
 * Onde o agente trabalha para este cliente. Confere, com realpath, que a etapa
 * e a pasta do cliente ficam dentro de uma raiz permitida e que nenhuma das
 * duas é atalho para outro lugar.
 */
export async function resolverPasta(cfg: ConfigPonte, agente: string, nomeInformado: string, origem: PastaDoCliente['origemDoNome']): Promise<PastaDoCliente> {
  const a = cfg.agentes[agente]
  if (!a) throw new ErroPonte('CONFIG', `O agente ${agente} não está no ponte.json.`)
  const nome = nomeDePasta(nomeInformado)
  if (!nome) throw new ErroPonte('SEM_PASTA', 'O nome da pasta do cliente que veio do DG Brasil não é um nome de pasta válido.')

  const raizesReais: string[] = []
  for (const r of cfg.raizes) {
    try { raizesReais.push(await realpath(r)) } catch { /* raiz ausente neste computador */ }
  }
  const etapas: Array<{ etapa: string; raiz: string }> = []
  for (const p of Array.isArray(a.pasta) ? a.pasta : [a.pasta]) {
    const informada = isAbsolute(p) ? resolve(p) : resolve(cfg.raizes[0], p)
    let real: string
    try {
      real = await realpath(informada)
    } catch {
      throw new ErroPonte('CONFIG', `A pasta da etapa do agente ${agente} não foi encontrada: ${informada}. O Google Drive para computador está aberto?`)
    }
    const raiz = raizesReais.find((r) => dentro(r, real))
    if (!raiz) throw new ErroPonte('FORA_DA_RAIZ', `A pasta ${informada} do agente ${agente} fica fora das raízes permitidas do ponte.json.`)
    etapas.push({ etapa: real, raiz })
  }

  for (const { etapa, raiz } of etapas) {
    const pasta = join(etapa, nome)
    let info
    try { info = await lstat(pasta) } catch { continue }
    if (info.isSymbolicLink() || !info.isDirectory()) throw new ErroPonte('FORA_DA_RAIZ', 'A pasta do cliente é um atalho ou não é uma pasta. A ponte não usa atalhos.')
    const real = await realpath(pasta)
    if (!dentro(etapa, real)) throw new ErroPonte('FORA_DA_RAIZ', 'A pasta do cliente aponta para fora da etapa do agente.')
    return { agente, raiz, etapa, pasta: real, nome, existe: true, emOutraEtapa: null, origemDoNome: origem }
  }

  const { etapa, raiz } = etapas[0]
  let emOutraEtapa: string | null = null
  try {
    for (const item of await readdir(raiz, { withFileTypes: true })) {
      if (!item.isDirectory()) continue
      const outra = join(raiz, item.name)
      if (etapas.some((e) => e.etapa.toLowerCase() === outra.toLowerCase())) continue
      if (existsSync(join(outra, nome))) { emOutraEtapa = item.name; break }
    }
  } catch { /* raiz ilegível: segue sem a conferência */ }
  return { agente, raiz, etapa, pasta: join(etapa, nome), nome, existe: false, emOutraEtapa, origemDoNome: origem }
}

// ── Porteiro: checagens por script ────────────────────────────────────────

export type Veredito = 'liberado' | 'suspeito' | 'recusado'

export interface ChecagemArquivo {
  arquivo: string
  sha256: string
  tamanho: number
  tipo: string
  resultado: Veredito
  motivos: string[]
}

export type Antivirus = (arquivo: string) => Promise<'limpo' | 'ameaca' | 'indisponivel'>

const MAGICOS: Record<string, { tipo: string; confere: (b: Buffer) => boolean }> = {
  '.pdf': { tipo: 'PDF', confere: (b) => b.subarray(0, 1024).includes('%PDF-') },
  '.docx': { tipo: 'DOCX', confere: (b) => b.subarray(0, 4).equals(Buffer.from('PK\u0003\u0004', 'latin1')) },
  '.xlsx': { tipo: 'XLSX', confere: (b) => b.subarray(0, 4).equals(Buffer.from('PK\u0003\u0004', 'latin1')) },
  '.jpg': { tipo: 'JPEG', confere: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  '.jpeg': { tipo: 'JPEG', confere: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  '.png': { tipo: 'PNG', confere: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  '.txt': { tipo: 'TXT', confere: (b) => !b.includes(0) },
  '.csv': { tipo: 'CSV', confere: (b) => !b.includes(0) },
}

/** Fim de um nome do PDF: espaço, delimitador ou fim do texto (\b deixaria "/JSX" passar como "/JS"). */
const FIM = String.raw`(?=[\s/<>\[\]()%{}]|$)`
const nome = (n: string) => new RegExp(`/${n}${FIM}`)

/** Nomes do PDF que fazem o arquivo AGIR (script, abrir programa, arquivo embutido, ação automática). */
const PDF_ATIVO: Array<[RegExp, string]> = [
  [nome('JavaScript'), 'PDF com JavaScript (/JavaScript)'],
  [nome('JS'), 'PDF com JavaScript (/JS)'],
  [nome('Launch'), 'PDF que abre programa (/Launch)'],
  [new RegExp(`/EmbeddedFiles?${FIM}`), 'PDF com arquivo embutido (/EmbeddedFile)'],
  [nome('RichMedia'), 'PDF com mídia ativa (/RichMedia)'],
  [nome('SubmitForm'), 'PDF que envia dados (/SubmitForm)'],
  [nome('ImportData'), 'PDF que importa dados (/ImportData)'],
  [nome('AA'), 'PDF com ação automática (/AA)'],
]

/** Nomes do PDF podem vir escritos em hexadecimal (/J#61vaScript) para escapar de busca. */
const decodificarNomes = (t: string) => t.replace(/\/[^\s/<>[\]()%]+/g, (n) => n.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))))

const LIMITE_INFLADO = 200 * 1024 * 1024

/**
 * Onde moram as AÇÕES de um PDF: nos objetos (fora dos fluxos) e nos "object
 * streams" (/Type /ObjStm), que guardam objetos comprimidos. Imagem, fonte e
 * conteúdo de página ficam de fora: são binários e formariam "/JS" por acaso.
 */
function textoDoPdf(b: Buffer): { texto: string; cortado: boolean } {
  const bruto = b.toString('latin1')
  const partes: string[] = []
  let total = 0
  let cortado = false
  let ultimo = 0
  const re = /stream\r?\n/g
  let m: RegExpExecArray | null
  while ((m = re.exec(bruto))) {
    if (bruto.slice(Math.max(0, m.index - 3), m.index) === 'end') continue
    const inicio = m.index + m[0].length
    const fim = bruto.indexOf('endstream', inicio)
    if (fim < 0) break
    partes.push(bruto.slice(ultimo, m.index))
    ultimo = fim + 'endstream'.length
    re.lastIndex = ultimo
    const abre = bruto.lastIndexOf(' obj', m.index)
    const cabecalho = decodificarNomes(bruto.slice(abre >= 0 && m.index - abre < 4000 ? abre : Math.max(0, m.index - 400), m.index))
    if (!/\/Type\s*\/ObjStm/.test(cabecalho)) continue
    if (!/\/FlateDecode/.test(cabecalho)) { partes.push(bruto.slice(inicio, fim)); continue }
    try {
      const saida = inflateSync(b.subarray(inicio, fim), { maxOutputLength: 20 * 1024 * 1024 })
      total += saida.length
      if (total > LIMITE_INFLADO) { cortado = true; break }
      partes.push(saida.toString('latin1'))
    } catch {
      // Object stream que não abre: não dá para conferir o que tem dentro.
      cortado = true
    }
  }
  partes.push(bruto.slice(ultimo))
  return { texto: decodificarNomes(partes.join('\n')), cortado }
}

export function checarPdf(b: Buffer): string[] {
  const { texto, cortado } = textoDoPdf(b)
  const motivos = PDF_ATIVO.filter(([re]) => re.test(texto)).map(([, m]) => m)
  // /OpenAction que só abre numa página ([pág /Fit]) é comum (o HISCON tem). Ação em dicionário é suspeita.
  if (/\/OpenAction\s*<</.test(texto)) motivos.push('PDF com ação ao abrir (/OpenAction)')
  if (nome('Encrypt').test(texto)) motivos.push('PDF criptografado: o conteúdo não pôde ser conferido')
  if (cortado) motivos.push('PDF com parte comprimida que não pôde ser conferida')
  return [...new Set(motivos)]
}

export function checarOffice(b: Buffer): string[] {
  const t = b.toString('latin1')
  const motivos: string[] = []
  if (!t.includes('[Content_Types].xml')) motivos.push('Não é um documento do Office válido')
  if (/vbaProject\.bin/i.test(t)) motivos.push('Documento com macro (vbaProject.bin)')
  if (/activeX/i.test(t)) motivos.push('Documento com controle ActiveX')
  if (/oleObject\d*\.bin/i.test(t)) motivos.push('Documento com objeto embutido (OLE)')
  return motivos
}

/** Antivírus do Windows (Microsoft Defender), sem mexer no arquivo. Código 2 = ameaça. */
export const defender: Antivirus = async (arquivo) => {
  const exe = join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Windows Defender', 'MpCmdRun.exe')
  if (process.platform !== 'win32' || !existsSync(exe)) return 'indisponivel'
  return new Promise((ok) => {
    execFile(exe, ['-Scan', '-ScanType', '3', '-File', arquivo, '-DisableRemediation'], { timeout: 180_000, windowsHide: true }, (e) => {
      if (!e) return ok('limpo')
      const codigo = (e as unknown as { code?: number | string }).code
      ok(codigo === 2 ? 'ameaca' : 'indisponivel')
    })
  })
}

export async function checarArquivo(caminho: string, nome: string, antivirus: Antivirus | null): Promise<ChecagemArquivo> {
  const motivos: string[] = []
  const info = await lstat(caminho)
  const ext = extname(nome).toLowerCase()
  const magico = MAGICOS[ext]
  if (info.isSymbolicLink() || !info.isFile()) {
    return { arquivo: nome, sha256: '', tamanho: 0, tipo: '?', resultado: 'recusado', motivos: ['Não é um arquivo comum (atalho ou pasta).'] }
  }
  if (info.size === 0) return { arquivo: nome, sha256: '', tamanho: 0, tipo: '?', resultado: 'recusado', motivos: ['Arquivo vazio.'] }
  if (info.size > LIMITE_MINUTA) return { arquivo: nome, sha256: '', tamanho: info.size, tipo: '?', resultado: 'recusado', motivos: ['Arquivo maior que 50 MB.'] }
  const b = await readFile(caminho)
  const sha256 = createHash('sha256').update(b).digest('hex')
  if (!magico) {
    return { arquivo: nome, sha256, tamanho: b.length, tipo: ext || '?', resultado: 'recusado', motivos: [`Tipo ${ext || 'sem extensão'} não passa pela ponte (aceitos: ${Object.keys(MAGICOS).join(', ')}).`] }
  }
  if (!magico.confere(b)) {
    return { arquivo: nome, sha256, tamanho: b.length, tipo: magico.tipo, resultado: 'recusado', motivos: [`O conteúdo não é ${magico.tipo}, apesar da extensão ${ext}.`] }
  }
  if (magico.tipo === 'PDF') motivos.push(...checarPdf(b))
  if (magico.tipo === 'DOCX' || magico.tipo === 'XLSX') motivos.push(...checarOffice(b))
  if (antivirus) {
    const av = await antivirus(caminho)
    if (av === 'ameaca') return { arquivo: nome, sha256, tamanho: b.length, tipo: magico.tipo, resultado: 'recusado', motivos: ['O antivírus do Windows encontrou ameaça.', ...motivos] }
    if (av === 'indisponivel') motivos.push('O antivírus do Windows não respondeu: arquivo não verificado')
  }
  return { arquivo: nome, sha256, tamanho: b.length, tipo: magico.tipo, resultado: motivos.length ? 'suspeito' : 'liberado', motivos }
}

/** O que o Porteiro (agente) grava em saida\porteiro.json, depois da leitura. */
export const LeituraPorteiro = z.object({
  arquivos: z.array(z.object({
    arquivo: z.string().min(1).max(260),
    resultado: z.enum(['liberado', 'suspeito', 'recusado']),
    motivo: z.string().max(2000).optional(),
  }).passthrough()).min(1).max(200),
}).passthrough()

// ── Arquivista: nomes na pasta do cliente ──────────────────────────────────

/** Nome do arquivo na pasta do cliente pela categoria do documento no DG Brasil (os nomes do FLUXO_COMERCIAL). */
export function nomeNaPasta(categoria: string, titulo: string, nomeOriginal: string): string {
  const ext = extname(nomeOriginal).toLowerCase() || '.pdf'
  const t = semAcento(titulo)
  switch (categoria) {
    case 'BENEFIT_STATEMENT': return `${/hiscren/.test(t) ? 'HISCREN' : 'HISCON'}${ext}`
    case 'IDENTIFICATION': return `IDENTIDADE${ext}`
    case 'ADDRESS_PROOF': return `COMPROVANTE DE RESIDÊNCIA${ext}`
    case 'INCOME_PROOF': return `CONTRACHEQUE${ext}`
    default: {
      // Autos do processo: os redatores procuram o PDF que começa com AUTOS (ex.: AUTOS_REIS_BANCO-PINE_2026-09-21.pdf).
      if (/\bautos\b/.test(t)) {
        const corpo = (nomeDoClienteParaPasta(titulo.replace(/[\\/:*?"<>|]/g, ' ')) ?? 'PROCESSO').replace(/\s+/g, '_').replace(/^AUTOS_?/, '')
        return `${`AUTOS_${corpo || 'PROCESSO'}`.slice(0, 150)}${ext}`
      }
      const base = (nomeDePasta(titulo.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ')) ?? 'DOCUMENTO').slice(0, 150)
      return `${base}${ext}`
    }
  }
}

/** Nome livre com a regra da Luísa: "HISCON.pdf" existe → "HISCON (2).pdf", "HISCON (3).pdf"... */
export async function nomeLivreDaPasta(pasta: string, nome: string): Promise<string> {
  const ext = extname(nome)
  const corpo = nome.slice(0, nome.length - ext.length)
  for (let i = 1; i < 100; i++) {
    const candidato = join(pasta, i === 1 ? nome : `${corpo} (${i})${ext}`)
    try { await lstat(candidato) } catch { return candidato }
  }
  throw new ErroPonte('CONFLITO', `Já existem 99 versões de ${nome} na pasta do cliente.`)
}

/** Já existe na pasta um arquivo com o mesmo nome-base e o mesmo conteúdo? (repetição do mesmo trabalho) */
export async function mesmoConteudoNaPasta(pasta: string, nome: string, sha256: string): Promise<string | null> {
  const ext = extname(nome).toLowerCase()
  const corpo = semAcento(nome.slice(0, nome.length - ext.length))
  for (const item of await readdir(pasta, { withFileTypes: true })) {
    if (!item.isFile() || extname(item.name).toLowerCase() !== ext) continue
    const c = semAcento(item.name.slice(0, item.name.length - ext.length))
    if (c !== corpo && !new RegExp(`^${corpo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(\\d+\\)$`).test(c)) continue
    const b = await readFile(join(pasta, item.name))
    if (createHash('sha256').update(b).digest('hex') === sha256) return item.name
  }
  return null
}

export interface DadosPonte {
  cliente: null | {
    id: string; tipo?: string; nome: string | null; profissao?: string | null; estado_civil?: string | null; email?: string | null
    /** Desde a migration 053. */
    cpf?: string | null; rg?: string | null; nacionalidade?: string | null; telefone?: string | null; endereco?: string | null
    /** Desde a migration 055: a_vista, 5x_boleto, 5x_cartao ou final_do_processo (o código que o gerador do contrato entende). */
    forma_de_pagamento?: string | null
  }
  pasta_drive: null | { id: string; nome: string | null }
  /** Quem assina, pelo cadastro do escritório no DG Brasil (migration 053). */
  escritorio?: null | {
    nome?: string | null; advogado?: string | null; oab?: string | null
    endereco?: string | null; cidade?: string | null; email?: string | null; telefone?: string | null
  }
}

const agora = () => new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '')

const umaLinha = (v: unknown) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').trim()

/** Campos do DADOS DO CADASTRO.txt, na ordem do contrato dos clones (docs/agentes/clonagem/contrato-dos-clones.md). */
export const CAMPOS_DO_CADASTRO = [
  'nome', 'cpf', 'rg', 'nacionalidade', 'profissao', 'estado_civil', 'email', 'telefone', 'endereco',
  'comprovante_residencia_em_nome_de', 'forma_de_pagamento',
] as const

/** Lê um arquivo "campo: valor" (um por linha). */
export function lerCampos(texto: string): Record<string, string> {
  const campos: Record<string, string> = {}
  for (const linha of texto.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = /^([a-z_]+):[ \t]*(.*)$/i.exec(linha)
    if (m) campos[m[1].toLowerCase()] = m[2].trim()
  }
  return campos
}

/**
 * DADOS DO CADASTRO.txt: o que os agentes leem do cadastro do cliente. Campo sem
 * valor no DG Brasil fica vazio, a não ser que o arquivo que já está na pasta
 * tenha um valor (a equipe pode ter completado à mão: não se perde).
 */
export function dadosDoCadastro(d: DadosPonte, trabalhoId: string, anterior: Record<string, string> = {}): string {
  const c = d.cliente
  const doSite: Record<string, unknown> = {
    nome: c?.nome, cpf: c?.cpf, rg: c?.rg, nacionalidade: c?.nacionalidade, profissao: c?.profissao,
    estado_civil: c?.estado_civil, email: c?.email, telefone: c?.telefone, endereco: c?.endereco,
    forma_de_pagamento: c?.forma_de_pagamento,
  }
  return [
    ...CAMPOS_DO_CADASTRO.map((k) => `${k}: ${umaLinha(doSite[k]) || umaLinha(anterior[k])}`),
    `salvo_em: ${agora()}`,
    `origem: DG Brasil, trabalho ${trabalhoId}`,
    `dg_cliente_id: ${c?.id ?? ''}`,
    '',
  ].join('\r\n')
}

// ── quem assina (DADOS DO ESCRITORIO.txt) ───────────────────────────────────

/** Dados do escritório neste computador, fora do repositório (C:\DGBrasil\agentes\escritorio.json). */
export function caminhoEscritorio(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DG_ESCRITORIO_JSON) return env.DG_ESCRITORIO_JSON
  return process.platform === 'win32' ? 'C:\\DGBrasil\\agentes\\escritorio.json' : join(homedir(), '.config', 'dg-brasil', 'escritorio.json')
}

const EscritorioLocal = z.object({
  escritorio: z.string().optional(),
  advogado: z.string().optional(),
  oabs: z.array(z.object({ uf: z.string(), numero: z.string() }).passthrough()).optional(),
  endereco_profissional: z.string().optional(),
  cidade_do_fecho: z.string().optional(),
  email: z.string().optional(),
  telefones: z.array(z.string()).optional(),
}).passthrough()

export type Escritorio = z.infer<typeof EscritorioLocal>

export async function lerEscritorio(arquivo = caminhoEscritorio()): Promise<Escritorio | null> {
  try {
    return EscritorioLocal.parse(JSON.parse((await readFile(arquivo, 'utf8')).replace(/^\uFEFF/, '')))
  } catch {
    return null
  }
}

/**
 * DADOS DO ESCRITORIO.txt: quem assina. O arquivo deste computador manda (é o
 * mais completo); o que faltar nele vem do cadastro do escritório no DG Brasil.
 * Campo vazio: o agente escreve [COMPLETAR] na peça.
 */
export function dadosDoEscritorio(local: Escritorio | null, d: DadosPonte): string {
  const oabs = (local?.oabs ?? []).map((o) => `OAB/${umaLinha(o.uf).toUpperCase()} ${umaLinha(o.numero)}`).join('; ')
  return [
    `escritorio: ${umaLinha(local?.escritorio) || umaLinha(d.escritorio?.nome)}`,
    `advogado: ${umaLinha(local?.advogado) || umaLinha(d.escritorio?.advogado)}`,
    `oab: ${oabs || umaLinha(d.escritorio?.oab)}`,
    `endereco_profissional: ${umaLinha(local?.endereco_profissional) || umaLinha(d.escritorio?.endereco)}`,
    `cidade_do_fecho: ${umaLinha(local?.cidade_do_fecho) || umaLinha(d.escritorio?.cidade)}`,
    `email: ${umaLinha(local?.email) || umaLinha(d.escritorio?.email)}`,
    `telefone: ${(local?.telefones ?? []).map(umaLinha).filter(Boolean).join('; ') || umaLinha(d.escritorio?.telefone)}`,
    `salvo_em: ${agora()}`,
    '',
  ].join('\r\n')
}

/** Lê o DADOS DO CADASTRO.txt que já está na pasta e confere se é deste cliente. */
export async function conferirCadastroExistente(pasta: string, d: DadosPonte): Promise<{ situacao: 'ausente' | 'confere'; campos: Record<string, string> }> {
  let texto: string
  try {
    texto = await readFile(join(pasta, 'DADOS DO CADASTRO.txt'), 'utf8')
  } catch {
    return { situacao: 'ausente', campos: {} }
  }
  const campos = lerCampos(texto)
  const campo = (k: string) => campos[k] ?? ''
  const id = campo('dg_cliente_id')
  if (id && d.cliente?.id && id !== d.cliente.id) {
    throw new ErroPonte('CONFLITO', 'A pasta do cliente já tem um DADOS DO CADASTRO.txt de OUTRO cliente do DG Brasil. Nada foi copiado: confira a pasta (homônimo?).')
  }
  const nome = semAcento(campo('nome')).replace(/\s+/g, ' ')
  const esperado = semAcento(d.cliente?.nome ?? '').replace(/\s+/g, ' ')
  if (nome && esperado && nome !== esperado) {
    throw new ErroPonte('CONFLITO', 'O DADOS DO CADASTRO.txt da pasta tem outro nome de cliente. Nada foi copiado: confira a pasta (homônimo?).')
  }
  return { situacao: 'confere', campos }
}

// ── Mensageiro: trazer o que o agente gerou ────────────────────────────────

export type HtmlParaPdf = (html: string, pdf: string) => Promise<void>

/** Política que a cópia do HTML leva antes de ir para o Edge: sem script, sem conexão, sem objeto embutido. */
export const CSP_SEM_SCRIPT = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: file:; style-src 'unsafe-inline' file:; font-src data: file:">`

/** Põe a política no começo do <head> (ou logo depois do doctype), antes de qualquer script do arquivo. */
export function htmlSemScript(html: string): string {
  const head = /<head(\s[^>]*)?>/i.exec(html)
  if (head) return html.slice(0, head.index + head[0].length) + CSP_SEM_SCRIPT + html.slice(head.index + head[0].length)
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)
  if (doctype) return doctype[0] + `<head>${CSP_SEM_SCRIPT}</head>` + html.slice(doctype[0].length)
  return `<head>${CSP_SEM_SCRIPT}</head>${html}`
}

export function caminhoEdge(): string | null {
  const candidatos = [
    join(process.env['ProgramFiles(x86)'] ?? 'C:\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(process.env.ProgramFiles ?? 'C:\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ]
  return candidatos.find((c) => existsSync(c)) ?? null
}

/**
 * HTML → PDF pelo Edge, numa cópia com a política acima (o "scriptEnabled=false"
 * do Edge impede a impressão), sem rede e com perfil descartável.
 */
export const edgeHtmlParaPdf: HtmlParaPdf = async (html, pdf) => {
  const exe = caminhoEdge()
  if (!exe) throw new ErroPonte('CONFIG', 'Microsoft Edge não encontrado: não dá para converter HTML em PDF.')
  const temporaria = await mkdtemp(join(tmpdir(), 'dg-edge-'))
  try {
    const copia = join(temporaria, 'documento.html')
    await writeFile(copia, htmlSemScript(await readFile(html, 'utf8')), 'utf8')
    await new Promise<void>((ok, falha) => {
      execFile(exe, [
        '--headless', '--disable-gpu', '--no-first-run', '--disable-extensions', '--disable-sync',
        `--user-data-dir=${join(temporaria, 'perfil')}`, '--host-resolver-rules=MAP * ~NOTFOUND',
        '--no-pdf-header-footer', `--print-to-pdf=${pdf}`, pathToFileURL(copia).href,
      ], { timeout: 120_000, windowsHide: true }, (e) => (e ? falha(e) : ok()))
    })
  } finally {
    await rm(temporaria, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined)
  }
  const info = await stat(pdf).catch(() => null)
  if (!info || info.size === 0) throw new ErroPonte('NADA', 'O Edge não gerou o PDF.')
}

/** Categoria sugerida pelo nome do arquivo que o agente gerou. */
export function categoriaSugerida(nome: string): string {
  const n = semAcento(nome)
  if (/procurac/.test(n)) return 'POWER_OF_ATTORNEY'
  if (/hipossufici|carencia/.test(n)) return 'HARDSHIP_DECLARATION'
  if (/minuta|peticao|inicial|replica|embargo|recurso|agravo|emenda|cumprimento/.test(n)) return 'PETITION'
  return 'OTHER'
}

/** FICHA_REVISAO_*.md (contrato dos clones, seção 6): o que o agente deixou para o advogado. */
export const E_FICHA_DE_REVISAO = /^ficha_revisao_.*\.md$/i

export interface PendenciaDaFicha { tipo: 'COMPLETAR' | 'DECIDIR' | 'CONFERIR'; texto: string }

/** Itens das seções COMPLETAR, DECIDIR e CONFERIR da ficha ("- nada" não conta). */
export function pendenciasDaFicha(texto: string): PendenciaDaFicha[] {
  const itens: PendenciaDaFicha[] = []
  let secao: PendenciaDaFicha['tipo'] | null = null
  for (const bruta of texto.split(/\r?\n/)) {
    const linha = bruta.trim()
    const titulo = /^#{1,6}\s*(.+?)\s*$/.exec(linha)
    if (titulo) {
      const t = semAcento(titulo[1]).toUpperCase()
      secao = t === 'COMPLETAR' || t === 'DECIDIR' || t === 'CONFERIR' ? t : null
      continue
    }
    const item = /^[-*]\s+(.+)$/.exec(linha)
    if (!secao || !item) continue
    const conteudo = item[1].trim()
    if (/^nada\.?$/i.test(conteudo)) continue
    itens.push({ tipo: secao, texto: conteudo.slice(0, 1500) })
  }
  return itens.slice(0, 40)
}

export interface Trazido {
  origem: string
  arquivo: string
  categoria: string
  titulo: string | null
  convertido: boolean
}

const LIMITE_TRAZER = 20

/** Texto (Markdown) → HTML só com o texto, escapado, para o Edge imprimir. */
export function textoParaHtml(titulo: string, texto: string): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title>` +
    '<style>body{font-family:Segoe UI,Arial,sans-serif;font-size:11pt;margin:18mm}pre{white-space:pre-wrap;font-family:inherit}</style>' +
    `</head><body><pre>${esc(texto)}</pre></body></html>`
}

/** Arquivos da pasta e das subpastas, até a profundidade. Atalho/junção não conta como pasta nem como arquivo. */
async function* arquivosAte(pasta: string, profundidade: number, prefixo = ''): AsyncGenerator<{ caminho: string; relativo: string; nome: string }> {
  for (const item of await readdir(pasta, { withFileTypes: true })) {
    const caminho = join(pasta, item.name)
    const relativo = prefixo ? `${prefixo}/${item.name}` : item.name
    if (item.isSymbolicLink()) continue
    if (item.isFile()) yield { caminho, relativo, nome: item.name }
    else if (item.isDirectory() && profundidade > 0) yield* arquivosAte(caminho, profundidade - 1, relativo)
  }
}

export async function trazer(
  pasta: string, padroes: z.infer<typeof Trazer>[], desde: number, saida: string, htmlParaPdf: HtmlParaPdf,
  nomeLivre: (pasta: string, nome: string) => Promise<string>, profundidade = 3,
): Promise<{ trazidos: Trazido[]; ignorados: string[]; pendencias: PendenciaDaFicha[] }> {
  const regras = padroes.map((p) => (typeof p === 'string' ? { padrao: p } : p)).map((p) => ({ ...p, re: globParaRegex(p.padrao) }))
  const trazidos: Trazido[] = []
  const ignorados: string[] = []
  const pendencias: PendenciaDaFicha[] = []
  const temporaria = await mkdtemp(join(tmpdir(), 'dg-ponte-'))
  try {
    for await (const item of arquivosAte(pasta, profundidade)) {
      const regra = regras.find((r) => r.re.test(semAcento(item.nome)))
      if (!regra) continue
      const info = await lstat(item.caminho)
      if (info.isSymbolicLink() || !info.isFile()) continue
      if (info.mtimeMs < desde) { ignorados.push(`${item.relativo} (já existia antes deste trabalho)`); continue }
      if (info.size === 0 || info.size > LIMITE_MINUTA) { ignorados.push(`${item.relativo} (vazio ou maior que 50 MB)`); continue }
      if (trazidos.length >= LIMITE_TRAZER) { ignorados.push(`${item.relativo} (limite de ${LIMITE_TRAZER} arquivos)`); continue }
      const ext = extname(item.nome).toLowerCase()
      const corpo = basename(item.nome, extname(item.nome))
      const base = { origem: item.relativo, categoria: regra.categoria ?? categoriaSugerida(item.nome), titulo: regra.titulo ?? null }
      if (ext === '.html' || ext === '.htm') {
        const destino = await nomeLivre(saida, `${corpo} (versão HTML).pdf`)
        await htmlParaPdf(item.caminho, destino)
        trazidos.push({ ...base, arquivo: basename(destino), convertido: true })
      } else if (ext === '.md') {
        const html = join(temporaria, `${trazidos.length}.html`)
        const md = await readFile(item.caminho, 'utf8')
        if (E_FICHA_DE_REVISAO.test(item.nome)) pendencias.push(...pendenciasDaFicha(md))
        await writeFile(html, textoParaHtml(corpo, md), 'utf8')
        const destino = await nomeLivre(saida, `${corpo}.pdf`)
        await htmlParaPdf(html, destino)
        trazidos.push({ ...base, arquivo: basename(destino), convertido: true })
      } else {
        const destino = await nomeLivre(saida, item.nome)
        await copyFile(item.caminho, destino)
        trazidos.push({ ...base, arquivo: basename(destino), convertido: false })
      }
    }
  } finally {
    await rm(temporaria, { recursive: true, force: true }).catch(() => undefined)
  }
  return { trazidos, ignorados, pendencias }
}
