// Cópia de segurança dos ARQUIVOS do DG Brasil (os buckets do Storage).
//
// O backup do Supabase cobre o banco de dados, não os arquivos. Sem esta cópia,
// um arquivo apagado ou corrompido no Storage não volta: o banco continua
// dizendo que o documento existe, mas o conteúdo se perdeu.
//
// O que faz: espelha os buckets para uma pasta de destino, copiando só o que é
// novo ou mudou desde a última vez. Na origem (Supabase) só LÊ: lista e baixa.
//
//   cd supabase
//   node --env-file=<arquivo de chaves> scripts/backup-documentos.mjs --destino "<pasta>" --simular
//   node --env-file=<arquivo de chaves> scripts/backup-documentos.mjs --destino "<pasta>"
//
// Opções:
//   --destino <pasta>   onde guardar (obrigatório). Disco externo, pasta de outro
//                       serviço de nuvem sincronizada no computador etc.
//   --simular           só mostra o que seria copiado; não grava nada.
//   --bucket <nome>     só este bucket (pode repetir). Padrão: os quatro do sistema.
//   --restaurar         caminho de volta: reenvia para o Storage os arquivos do
//                       backup que NÃO existem mais lá. Nunca sobrescreve. Exige
//                       --bucket e --confirmar (ou --simular). Roteiro completo em
//                       docs/deploy/restauracao-dos-documentos.md.
//   --prefixo <pasta/>  na restauração, só os arquivos cujo caminho começa assim.
//
// Variáveis (num arquivo de chaves FORA do Git): SUPABASE_URL e
// SUPABASE_SERVICE_ROLE_KEY do projeto. A chave nunca é impressa.
//
// Como fica o destino:
//   <destino>/<bucket>/<caminho do arquivo>      a cópia atual
//   <destino>/_manifestos/<bucket>.json          o que foi copiado (tamanho, etag, sha256, quando)
//   <destino>/_versoes-anteriores/<bucket>/...   a cópia de antes, quando o arquivo mudou na origem
//   <destino>/_relatorios/backup-<data>.json     o relatório de cada rodada
//
// Regras de segurança da cópia:
//   - arquivo que sumiu da origem NÃO é apagado do backup (fica marcado no manifesto);
//   - arquivo que mudou na origem não apaga a cópia de antes (vai para _versoes-anteriores);
//   - cada arquivo é gravado inteiro antes de valer (arquivo .parcial, depois renomeia)
//     e o tamanho é conferido com o da origem;
//   - nome de arquivo estranho nunca grava fora da pasta do bucket.

import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const BUCKETS = ['legal-documents', 'reference-materials', 'imports', 'skill-files']
const PAGINA = 1000
const TENTATIVAS = 3

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const existe = async (p) => { try { return await stat(p) } catch { return null } }

// ───────────────────────────── caminhos ─────────────────────────────────────

const RESERVADOS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/** Caminho do objeto → caminho relativo seguro no disco (vale no Windows). Lança se o nome não for aceitável. */
export function caminhoLocal(caminhoDoObjeto) {
  const partes = String(caminhoDoObjeto).split('/')
  if (partes.length === 0 || partes.some((p) => p === '' || p === '.' || p === '..')) {
    throw new Error('nome de arquivo não permitido')
  }
  return partes.map((p) => {
    // eslint-disable-next-line no-control-regex
    let s = p.replace(/[<>:"|?*\\\u0000-\u001f]/g, '_').replace(/[. ]+$/, (m) => '_'.repeat(m.length))
    if (RESERVADOS.test(s)) s = `_${s}`
    return s
  }).join('/')
}

function dentroDe(raiz, relativo) {
  const completo = path.resolve(raiz, ...relativo.split('/'))
  const base = path.resolve(raiz) + path.sep
  if (!completo.startsWith(base)) throw new Error('nome de arquivo não permitido')
  return completo
}

// ───────────────────────────── origem ───────────────────────────────────────

/** Todos os arquivos de um bucket (percorre as pastas e as páginas). */
export async function listarObjetos(origem, bucket) {
  const arquivos = []
  const pastas = ['']
  while (pastas.length) {
    const pasta = pastas.shift()
    for (let offset = 0; ; offset += PAGINA) {
      const itens = await origem.list(bucket, pasta, { limit: PAGINA, offset })
      for (const item of itens ?? []) {
        if (!item?.name) continue
        const caminho = pasta ? `${pasta}/${item.name}` : item.name
        // No Storage do Supabase, pasta vem sem id e sem metadata.
        if (item.id == null && item.metadata == null) { pastas.push(caminho); continue }
        arquivos.push({
          caminho,
          tamanho: typeof item.metadata?.size === 'number' ? item.metadata.size : null,
          etag: item.metadata?.eTag ?? null,
          tipo: item.metadata?.mimetype ?? null,
          atualizado_em: item.updated_at ?? item.created_at ?? null,
        })
      }
      if (!itens || itens.length < PAGINA) break
    }
  }
  return arquivos.sort((a, b) => (a.caminho < b.caminho ? -1 : a.caminho > b.caminho ? 1 : 0))
}

async function comTentativas(fn) {
  let ultimo
  for (let i = 0; i < TENTATIVAS; i++) {
    try { return await fn() } catch (e) { ultimo = e }
  }
  throw ultimo
}

const motivo = (e) => String(e?.message ?? e).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[chave]').slice(0, 200)

// ───────────────────────────── manifesto ────────────────────────────────────

const arquivoDoManifesto = (destino, bucket) => path.join(destino, '_manifestos', `${bucket}.json`)

export async function lerManifesto(destino, bucket) {
  const p = arquivoDoManifesto(destino, bucket)
  if (!(await existe(p))) return { bucket, objetos: {} }
  const m = JSON.parse(await readFile(p, 'utf8'))
  if (!m || typeof m.objetos !== 'object') throw new Error(`manifesto ilegível: ${p}`)
  return m
}

async function gravarManifesto(destino, bucket, manifesto, agora) {
  const p = arquivoDoManifesto(destino, bucket)
  await mkdir(path.dirname(p), { recursive: true })
  const texto = JSON.stringify({ ...manifesto, bucket, atualizado_em: agora }, null, 2)
  await writeFile(`${p}.parcial`, texto)
  await rename(`${p}.parcial`, p)
}

// ───────────────────────────── cópia ────────────────────────────────────────

/**
 * Espelha os buckets no destino. `origem` = { list(bucket, pasta, { limit, offset }), download(bucket, caminho) → bytes }.
 * Devolve o relatório. Não lança por falha de um arquivo ou de um bucket: registra e segue.
 */
export async function copiar({ origem, destino, buckets = BUCKETS, simular = false, agora = () => new Date() }) {
  const inicio = agora().toISOString()
  const relatorio = { tipo: 'backup', simulacao: simular, destino, inicio, fim: null, buckets: [], ok: true }
  for (const bucket of buckets) {
    const r = { bucket, encontrados: 0, novos: 0, alterados: 0, recopiados: 0, iguais: 0, ausentes_na_origem: 0, bytes_copiados: 0, falhas: [], erro: null }
    relatorio.buckets.push(r)
    try {
      const objetos = await comTentativas(() => listarObjetos(origem, bucket))
      const manifesto = await lerManifesto(destino, bucket)
      const raiz = path.join(destino, bucket)
      const usados = new Map()
      const naOrigem = new Set()
      r.encontrados = objetos.length
      for (const o of objetos) {
        naOrigem.add(o.caminho)
        try {
          const relativo = caminhoLocal(o.caminho)
          const chave = relativo.toLowerCase()
          if (usados.has(chave) && usados.get(chave) !== o.caminho) throw new Error('dois arquivos da origem dariam o mesmo nome no destino')
          usados.set(chave, o.caminho)
          const alvo = dentroDe(raiz, relativo)
          const antes = manifesto.objetos[o.caminho]
          const noDisco = await existe(alvo)
          let situacao
          if (!antes) situacao = 'novos'
          else if (antes.etag !== o.etag || antes.tamanho !== o.tamanho || antes.atualizado_em !== o.atualizado_em) situacao = 'alterados'
          else if (!noDisco || (o.tamanho != null && noDisco.size !== o.tamanho)) situacao = 'recopiados'
          else situacao = 'iguais'

          if (situacao === 'iguais') {
            r.iguais++
            if (antes.ausente_na_origem_desde && !simular) delete antes.ausente_na_origem_desde
            continue
          }
          if (simular) { r[situacao]++; r.bytes_copiados += o.tamanho ?? 0; continue }

          const bytes = Buffer.from(await comTentativas(() => origem.download(bucket, o.caminho)))
          if (o.tamanho != null && bytes.length !== o.tamanho) throw new Error(`tamanho baixado (${bytes.length}) diferente do da origem (${o.tamanho})`)
          await mkdir(path.dirname(alvo), { recursive: true })
          if (situacao === 'alterados' && noDisco) {
            // A cópia de antes não se perde: pode ser a única boa.
            const guardado = dentroDe(path.join(destino, '_versoes-anteriores', bucket), `${relativo}.${inicio.replace(/[:.]/g, '-')}`)
            await mkdir(path.dirname(guardado), { recursive: true })
            await rename(alvo, guardado)
          }
          await writeFile(`${alvo}.parcial`, bytes)
          await rename(`${alvo}.parcial`, alvo)
          const gravado = await stat(alvo)
          if (gravado.size !== bytes.length) throw new Error('arquivo gravado com tamanho diferente')
          manifesto.objetos[o.caminho] = {
            arquivo: relativo, tamanho: o.tamanho ?? bytes.length, etag: o.etag, tipo: o.tipo,
            atualizado_em: o.atualizado_em, sha256: sha256(bytes), copiado_em: agora().toISOString(),
          }
          r[situacao]++
          r.bytes_copiados += bytes.length
        } catch (e) {
          r.falhas.push({ caminho: o.caminho, motivo: motivo(e) })
        }
      }
      // O que está no backup e não está mais na origem: fica, só marcado.
      for (const [caminho, entrada] of Object.entries(manifesto.objetos)) {
        if (naOrigem.has(caminho)) continue
        r.ausentes_na_origem++
        if (!simular && !entrada.ausente_na_origem_desde) entrada.ausente_na_origem_desde = inicio
      }
      if (!simular) await gravarManifesto(destino, bucket, manifesto, agora().toISOString())
    } catch (e) {
      r.erro = motivo(e)
    }
    if (r.erro || r.falhas.length) relatorio.ok = false
  }
  relatorio.fim = agora().toISOString()
  if (!simular) await gravarRelatorio(destino, relatorio)
  return relatorio
}

async function gravarRelatorio(destino, relatorio) {
  const pasta = path.join(destino, '_relatorios')
  await mkdir(pasta, { recursive: true })
  const nome = `${relatorio.tipo}-${relatorio.inicio.replace(/[:.]/g, '-')}.json`
  await writeFile(path.join(pasta, nome), JSON.stringify(relatorio, null, 2))
}

// ───────────────────────────── restauração ──────────────────────────────────

/**
 * Reenvia ao Storage os arquivos do backup que NÃO existem mais na origem.
 * Nunca sobrescreve (o envio é recusado se o arquivo existir). Confere o
 * sha256 da cópia com o do manifesto antes de enviar.
 * `origem` precisa também de upload(bucket, caminho, bytes, tipo).
 */
export async function restaurar({ origem, destino, bucket, prefixo = '', simular = false, agora = () => new Date() }) {
  const inicio = agora().toISOString()
  const r = { tipo: 'restauracao', simulacao: simular, destino, bucket, prefixo, inicio, fim: null, no_backup: 0, ja_existiam: 0, restaurados: 0, bytes_enviados: 0, falhas: [], erro: null, ok: true }
  try {
    const manifesto = await lerManifesto(destino, bucket)
    const naOrigem = new Set((await comTentativas(() => listarObjetos(origem, bucket))).map((o) => o.caminho))
    const raiz = path.join(destino, bucket)
    for (const [caminho, entrada] of Object.entries(manifesto.objetos).sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (prefixo && !caminho.startsWith(prefixo)) continue
      r.no_backup++
      if (naOrigem.has(caminho)) { r.ja_existiam++; continue }
      try {
        const bytes = await readFile(dentroDe(raiz, entrada.arquivo ?? caminhoLocal(caminho)))
        if (entrada.sha256 && sha256(bytes) !== entrada.sha256) throw new Error('a cópia no backup não confere com o manifesto (arquivo alterado ou corrompido)')
        if (!simular) await origem.upload(bucket, caminho, bytes, entrada.tipo ?? 'application/octet-stream')
        r.restaurados++
        r.bytes_enviados += bytes.length
      } catch (e) {
        r.falhas.push({ caminho, motivo: motivo(e) })
      }
    }
  } catch (e) {
    r.erro = motivo(e)
  }
  r.ok = !r.erro && r.falhas.length === 0
  r.fim = agora().toISOString()
  if (!simular) await gravarRelatorio(destino, r)
  return r
}

// ───────────────────────────── linha de comando ─────────────────────────────

export function lerArgumentos(argv) {
  const a = { destino: null, simular: false, restaurar: false, confirmar: false, buckets: [], prefixo: '' }
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]
    if (v === '--simular') a.simular = true
    else if (v === '--restaurar') a.restaurar = true
    else if (v === '--confirmar') a.confirmar = true
    else if (v === '--destino' || v === '--bucket' || v === '--prefixo') {
      const valor = argv[++i]
      if (!valor || valor.startsWith('--')) throw new Error(`${v} precisa de um valor`)
      if (v === '--destino') a.destino = valor
      else if (v === '--bucket') a.buckets.push(valor)
      else a.prefixo = valor
    } else throw new Error(`opção desconhecida: ${v}`)
  }
  if (!a.destino) throw new Error('informe --destino <pasta>')
  for (const b of a.buckets) if (!BUCKETS.includes(b)) throw new Error(`bucket desconhecido: ${b} (os do sistema: ${BUCKETS.join(', ')})`)
  if (a.restaurar) {
    if (a.buckets.length !== 1) throw new Error('--restaurar exige exatamente um --bucket')
    if (!a.simular && !a.confirmar) throw new Error('--restaurar envia arquivos para o Storage: rode antes com --simular e depois com --confirmar')
  } else if (a.prefixo || a.confirmar) throw new Error('--prefixo e --confirmar só valem com --restaurar')
  return a
}

/** Adaptador do Storage do Supabase para a interface `origem`. */
export function origemSupabase(client) {
  return {
    list: async (bucket, pasta, opcoes) => {
      const { data, error } = await client.storage.from(bucket).list(pasta, { ...opcoes, sortBy: { column: 'name', order: 'asc' } })
      if (error) throw new Error(error.message)
      return data
    },
    download: async (bucket, caminho) => {
      const { data, error } = await client.storage.from(bucket).download(caminho)
      if (error) throw new Error(error.message)
      return Buffer.from(await data.arrayBuffer())
    },
    upload: async (bucket, caminho, bytes, tipo) => {
      const { error } = await client.storage.from(bucket).upload(caminho, bytes, { contentType: tipo, upsert: false })
      if (error) throw new Error(error.message)
    },
  }
}

const n = (v) => Number(v).toLocaleString('pt-BR')
const mb = (v) => `${(v / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`

export function imprimir(r, log = console.log) {
  if (r.tipo === 'restauracao') {
    log(`\nRestauração do bucket ${r.bucket}${r.prefixo ? ` (só "${r.prefixo}")` : ''}${r.simulacao ? ': SIMULAÇÃO, nada foi enviado' : ''}`)
    log(`  no backup: ${n(r.no_backup)}   já existiam no Storage: ${n(r.ja_existiam)}   ${r.simulacao ? 'seriam restaurados' : 'restaurados'}: ${n(r.restaurados)} (${mb(r.bytes_enviados)})   falhas: ${n(r.falhas.length)}`)
    if (r.erro) log(`  ERRO: ${r.erro}`)
    for (const f of r.falhas.slice(0, 50)) log(`  falhou: ${f.caminho}: ${f.motivo}`)
    return
  }
  log(`\nCópia de segurança dos documentos${r.simulacao ? ': SIMULAÇÃO, nada foi gravado' : ''}`)
  log(`Destino: ${r.destino}`)
  for (const b of r.buckets) {
    log(`\n  ${b.bucket}`)
    if (b.erro) { log(`    ERRO: ${b.erro}`); continue }
    log(`    na origem: ${n(b.encontrados)}   novos: ${n(b.novos)}   alterados: ${n(b.alterados)}   recopiados: ${n(b.recopiados)}   sem mudança: ${n(b.iguais)}`)
    log(`    ${r.simulacao ? 'a copiar' : 'copiado'}: ${mb(b.bytes_copiados)}   só no backup (sumiram da origem): ${n(b.ausentes_na_origem)}   falhas: ${n(b.falhas.length)}`)
    for (const f of b.falhas.slice(0, 50)) log(`    falhou: ${f.caminho}: ${f.motivo}`)
    if (b.falhas.length > 50) log(`    … e mais ${n(b.falhas.length - 50)} (lista completa no relatório)`)
  }
  log(`\n${r.ok ? 'Terminou sem falhas.' : 'TERMINOU COM FALHAS: veja acima e rode de novo.'}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let a
  try { a = lerArgumentos(process.argv.slice(2)) } catch (e) { console.error(`Uso incorreto: ${e.message}`); process.exit(2) }
  const env = (k) => {
    const v = process.env[k]
    if (!v) { console.error(`variável ausente: ${k}`); process.exit(2) }
    return v
  }
  const { createClient } = await import('@supabase/supabase-js')
  const client = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
  const origem = origemSupabase(client)
  const destino = path.resolve(a.destino)
  if (!a.simular && !a.restaurar) await mkdir(destino, { recursive: true })
  const r = a.restaurar
    ? await restaurar({ origem, destino, bucket: a.buckets[0], prefixo: a.prefixo, simular: a.simular })
    : await copiar({ origem, destino, buckets: a.buckets.length ? a.buckets : BUCKETS, simular: a.simular })
  imprimir(r)
  process.exit(r.ok ? 0 : 1)
}
