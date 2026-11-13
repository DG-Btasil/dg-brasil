// node --test "scripts/*.test.mjs"   (npm run test:scripts)
//
// A lógica da cópia e da restauração com um Storage SIMULADO (em memória) e um
// destino de verdade (pasta temporária). Não fala com o Supabase.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { BUCKETS, caminhoLocal, copiar, lerArgumentos, lerManifesto, listarObjetos, restaurar } from './backup-documentos.mjs'

const temporarias = []
const pastaNova = async () => { const p = await mkdtemp(path.join(os.tmpdir(), 'dg-backup-')); temporarias.push(p); return p }
after(async () => { for (const p of temporarias) await rm(p, { recursive: true, force: true }) })

/** Storage simulado: { bucket: { 'pasta/arquivo.pdf': { bytes, versao } } }, com páginas e pastas como o Supabase devolve. */
function storage(conteudo, { pagina = 1000 } = {}) {
  const chamadas = { list: 0, download: [], upload: [] }
  const falhar = new Map()
  const s = {
    conteudo, chamadas, falhar,
    async list(bucket, pasta, { limit, offset }) {
      chamadas.list++
      if (!(bucket in conteudo)) throw new Error('Bucket not found')
      const prefixo = pasta ? `${pasta}/` : ''
      const nomes = new Map()
      for (const [caminho, o] of Object.entries(conteudo[bucket])) {
        if (!caminho.startsWith(prefixo)) continue
        const resto = caminho.slice(prefixo.length)
        const [primeiro, ...mais] = resto.split('/')
        if (mais.length) nomes.set(primeiro, { name: primeiro, id: null, metadata: null, updated_at: null })
        else nomes.set(primeiro, { name: primeiro, id: `id-${caminho}`, updated_at: o.em ?? '2026-11-01T10:00:00Z',
          metadata: { size: o.tamanhoDeclarado ?? o.bytes.length, eTag: `"${o.versao ?? 1}"`, mimetype: 'application/pdf' } })
      }
      const tudo = [...nomes.values()].sort((a, b) => (a.name < b.name ? -1 : 1))
      return tudo.slice(offset, offset + Math.min(limit, pagina))
    },
    async download(bucket, caminho) {
      chamadas.download.push(`${bucket}/${caminho}`)
      const restantes = falhar.get(caminho) ?? 0
      if (restantes > 0) { falhar.set(caminho, restantes - 1); throw new Error('rede caiu eyJhbGciOi.eyJzdWIi.assinatura') }
      return conteudo[bucket][caminho].bytes
    },
    async upload(bucket, caminho, bytes) {
      chamadas.upload.push(`${bucket}/${caminho}`)
      if (conteudo[bucket][caminho]) throw new Error('The resource already exists')
      conteudo[bucket][caminho] = { bytes: Buffer.from(bytes) }
    },
  }
  return s
}
const b = (texto) => Buffer.from(texto)
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const base = () => ({
  'legal-documents': {
    'org1/doc1/v1.pdf': { bytes: b('procuracao') },
    'org1/doc1/v2.pdf': { bytes: b('procuracao corrigida') },
    'org1/doc2/hiscon.pdf': { bytes: b('extrato') },
  },
  'reference-materials': { 'tese.pdf': { bytes: b('tese') } },
  imports: {},
  'skill-files': {},
})

test('lista todas as pastas e todas as páginas', async () => {
  const conteudo = { 'legal-documents': {} }
  for (let i = 0; i < 7; i++) conteudo['legal-documents'][`org/pasta${i % 3}/arq${i}.pdf`] = { bytes: b(`x${i}`) }
  conteudo['legal-documents']['raiz.pdf'] = { bytes: b('r') }
  // Página "cheia" de 1000 itens na raiz, para forçar a segunda consulta.
  for (let i = 0; i < 1001; i++) conteudo['legal-documents'][`muitos-${String(i).padStart(4, '0')}.pdf`] = { bytes: b('m') }
  const o = storage(conteudo)
  const lista = await listarObjetos(o, 'legal-documents')
  assert.equal(lista.length, 7 + 1 + 1001)
  assert.deepEqual(lista.find((x) => x.caminho === 'org/pasta1/arq4.pdf'), { caminho: 'org/pasta1/arq4.pdf', tamanho: 2, etag: '"1"', tipo: 'application/pdf', atualizado_em: '2026-11-01T10:00:00Z' })
})

test('primeira cópia: tudo novo, com manifesto, sha256 e relatório; os quatro buckets do sistema por padrão', async () => {
  assert.deepEqual(BUCKETS, ['legal-documents', 'reference-materials', 'imports', 'skill-files'])
  const destino = await pastaNova(), o = storage(base())
  const r = await copiar({ origem: o, destino })
  assert.equal(r.ok, true)
  assert.deepEqual(r.buckets.map((x) => [x.bucket, x.encontrados, x.novos, x.iguais, x.falhas.length]), [
    ['legal-documents', 3, 3, 0, 0], ['reference-materials', 1, 1, 0, 0], ['imports', 0, 0, 0, 0], ['skill-files', 0, 0, 0, 0]])
  assert.equal((await readFile(path.join(destino, 'legal-documents', 'org1', 'doc1', 'v2.pdf'))).toString(), 'procuracao corrigida')
  const m = await lerManifesto(destino, 'legal-documents')
  assert.equal(m.objetos['org1/doc2/hiscon.pdf'].sha256, sha(b('extrato')))
  assert.equal(m.objetos['org1/doc2/hiscon.pdf'].tamanho, 7)
  assert.equal((await readdir(path.join(destino, '_relatorios'))).length, 1)
  assert.equal((await readdir(path.join(destino, 'legal-documents', 'org1', 'doc1'))).some((f) => f.endsWith('.parcial')), false, 'nenhum arquivo parcial sobra')
})

test('segunda cópia sem mudança: não baixa nada', async () => {
  const destino = await pastaNova(), o = storage(base())
  await copiar({ origem: o, destino })
  const baixados = o.chamadas.download.length
  const r = await copiar({ origem: o, destino })
  assert.equal(o.chamadas.download.length, baixados, 'nenhum download a mais')
  assert.deepEqual(r.buckets.map((x) => [x.novos, x.alterados, x.recopiados, x.iguais]), [[0, 0, 0, 3], [0, 0, 0, 1], [0, 0, 0, 0], [0, 0, 0, 0]])
})

test('só o que é novo ou mudou: arquivo novo entra; arquivo alterado é copiado e a cópia de antes fica guardada', async () => {
  const destino = await pastaNova(), conteudo = base(), o = storage(conteudo)
  await copiar({ origem: o, destino })
  o.chamadas.download.length = 0
  conteudo['legal-documents']['org1/doc3/novo.pdf'] = { bytes: b('documento novo') }
  conteudo['legal-documents']['org1/doc2/hiscon.pdf'] = { bytes: b('extrato trocado'), versao: 2, em: '2026-11-10T09:00:00Z' }
  const r = await copiar({ origem: o, destino })
  const legal = r.buckets[0]
  assert.deepEqual([legal.novos, legal.alterados, legal.iguais, legal.bytes_copiados], [1, 1, 2, 'documento novo'.length + 'extrato trocado'.length])
  assert.deepEqual(o.chamadas.download.sort(), ['legal-documents/org1/doc2/hiscon.pdf', 'legal-documents/org1/doc3/novo.pdf'])
  assert.equal((await readFile(path.join(destino, 'legal-documents', 'org1', 'doc2', 'hiscon.pdf'))).toString(), 'extrato trocado')
  const guardados = await readdir(path.join(destino, '_versoes-anteriores', 'legal-documents', 'org1', 'doc2'))
  assert.equal(guardados.length, 1)
  assert.equal((await readFile(path.join(destino, '_versoes-anteriores', 'legal-documents', 'org1', 'doc2', guardados[0]))).toString(), 'extrato')
})

test('arquivo que sumiu da origem continua no backup, só marcado; se voltar, a marca sai', async () => {
  const destino = await pastaNova(), conteudo = base(), o = storage(conteudo)
  await copiar({ origem: o, destino })
  const guardado = conteudo['legal-documents']['org1/doc1/v1.pdf']
  delete conteudo['legal-documents']['org1/doc1/v1.pdf']
  const r = await copiar({ origem: o, destino })
  assert.equal(r.buckets[0].ausentes_na_origem, 1)
  assert.equal(r.ok, true, 'sumir da origem não é falha da cópia')
  assert.equal((await readFile(path.join(destino, 'legal-documents', 'org1', 'doc1', 'v1.pdf'))).toString(), 'procuracao')
  assert.ok((await lerManifesto(destino, 'legal-documents')).objetos['org1/doc1/v1.pdf'].ausente_na_origem_desde)
  conteudo['legal-documents']['org1/doc1/v1.pdf'] = guardado
  await copiar({ origem: o, destino })
  assert.equal((await lerManifesto(destino, 'legal-documents')).objetos['org1/doc1/v1.pdf'].ausente_na_origem_desde, undefined)
})

test('cópia apagada ou truncada no destino é refeita', async () => {
  const destino = await pastaNova(), o = storage(base())
  await copiar({ origem: o, destino })
  await rm(path.join(destino, 'legal-documents', 'org1', 'doc1', 'v1.pdf'))
  await writeFile(path.join(destino, 'legal-documents', 'org1', 'doc1', 'v2.pdf'), 'cortado')
  const r = await copiar({ origem: o, destino })
  assert.deepEqual([r.buckets[0].recopiados, r.buckets[0].iguais], [2, 1])
  assert.equal((await readFile(path.join(destino, 'legal-documents', 'org1', 'doc1', 'v2.pdf'))).toString(), 'procuracao corrigida')
})

test('simulação: conta o que seria copiado e não grava nem baixa nada', async () => {
  const destino = path.join(await pastaNova(), 'ainda-nao-existe'), o = storage(base())
  const r = await copiar({ origem: o, destino, simular: true })
  assert.equal(r.simulacao, true)
  assert.deepEqual(r.buckets.map((x) => x.novos), [3, 1, 0, 0])
  assert.equal(r.buckets[0].bytes_copiados, 'procuracao'.length + 'procuracao corrigida'.length + 'extrato'.length)
  assert.equal(o.chamadas.download.length, 0)
  assert.equal(await stat(destino).then(() => true, () => false), false, 'a pasta de destino nem é criada')
})

test('falha num arquivo não para a cópia: tenta de novo, registra o motivo sem a chave e termina com falha', async () => {
  const destino = await pastaNova(), conteudo = base(), o = storage(conteudo)
  o.falhar.set('org1/doc1/v1.pdf', 2)      // falha duas vezes, passa na terceira
  o.falhar.set('org1/doc2/hiscon.pdf', 99) // nunca passa
  conteudo['legal-documents']['org1/doc1/v2.pdf'].tamanhoDeclarado = 999 // a origem diz um tamanho, chega outro
  const r = await copiar({ origem: o, destino })
  assert.equal(r.ok, false)
  const legal = r.buckets[0]
  assert.equal(legal.novos, 1, 'o que falhou duas vezes foi copiado na terceira')
  assert.deepEqual(legal.falhas.map((f) => f.caminho).sort(), ['org1/doc1/v2.pdf', 'org1/doc2/hiscon.pdf'])
  assert.match(legal.falhas.find((f) => f.caminho === 'org1/doc1/v2.pdf').motivo, /tamanho baixado/)
  assert.doesNotMatch(JSON.stringify(r), /eyJhbGciOi/, 'nada que pareça chave no relatório')
  assert.equal(r.buckets[1].novos, 1, 'os outros buckets seguem')
  // O que falhou não entra no manifesto: a próxima rodada tenta de novo.
  assert.equal((await lerManifesto(destino, 'legal-documents')).objetos['org1/doc2/hiscon.pdf'], undefined)
})

test('bucket que não existe ou sem permissão: erro só naquele bucket', async () => {
  const destino = await pastaNova(), conteudo = base()
  delete conteudo.imports
  const r = await copiar({ origem: storage(conteudo), destino })
  assert.equal(r.ok, false)
  assert.deepEqual(r.buckets.map((x) => [x.bucket, x.erro]), [['legal-documents', null], ['reference-materials', null], ['imports', 'Bucket not found'], ['skill-files', null]])
})

test('nome de arquivo estranho nunca grava fora da pasta do bucket', async () => {
  assert.equal(caminhoLocal('org/a:b?.pdf'), 'org/a_b_.pdf')
  assert.equal(caminhoLocal('org/CON/x. '), 'org/_CON/x__')
  for (const ruim of ['../fora.pdf', 'a/../../fora.pdf', '/absoluto.pdf', 'a//b.pdf', './a.pdf', '']) assert.throws(() => caminhoLocal(ruim), /não permitido/, ruim)
  const destino = await pastaNova()
  const conteudo = { 'legal-documents': { 'ok.pdf': { bytes: b('ok') }, 'A.pdf': { bytes: b('maiuscula') }, 'a.pdf': { bytes: b('minuscula') }, 'x/a:b.pdf': { bytes: b('1') }, 'x/a?b.pdf': { bytes: b('2') } } }
  const r = await copiar({ origem: storage(conteudo), destino, buckets: ['legal-documents'] })
  // Dois nomes que dariam o mesmo arquivo no disco: o segundo falha, com motivo claro, em vez de sobrescrever o primeiro.
  assert.equal(r.buckets[0].falhas.length, 2)
  assert.ok(r.buckets[0].falhas.every((f) => /mesmo nome no destino/.test(f.motivo)))
  assert.equal(r.buckets[0].novos, 3)
})

test('restauração: reenvia só o que falta no Storage, confere o sha256, nunca sobrescreve; simulação não envia', async () => {
  const destino = await pastaNova(), conteudo = base(), o = storage(conteudo)
  await copiar({ origem: o, destino })
  delete conteudo['legal-documents']['org1/doc1/v1.pdf']
  delete conteudo['legal-documents']['org1/doc2/hiscon.pdf']
  const sim = await restaurar({ origem: o, destino, bucket: 'legal-documents', simular: true })
  assert.deepEqual([sim.no_backup, sim.ja_existiam, sim.restaurados, o.chamadas.upload.length], [3, 1, 2, 0])
  // Só uma pasta.
  const parte = await restaurar({ origem: o, destino, bucket: 'legal-documents', prefixo: 'org1/doc2/' })
  assert.deepEqual([parte.no_backup, parte.restaurados, parte.ok], [1, 1, true])
  assert.equal(conteudo['legal-documents']['org1/doc2/hiscon.pdf'].bytes.toString(), 'extrato')
  // Cópia adulterada no backup não é enviada.
  await writeFile(path.join(destino, 'legal-documents', 'org1', 'doc1', 'v1.pdf'), 'adulterado')
  const ruim = await restaurar({ origem: o, destino, bucket: 'legal-documents' })
  assert.equal(ruim.ok, false)
  assert.match(ruim.falhas[0].motivo, /não confere com o manifesto/)
  assert.equal(conteudo['legal-documents']['org1/doc1/v1.pdf'], undefined)
  assert.deepEqual(o.chamadas.upload, ['legal-documents/org1/doc2/hiscon.pdf'], 'o que já existe nunca é reenviado')
})

test('linha de comando: destino obrigatório; restauração exige um bucket e --simular ou --confirmar', () => {
  assert.deepEqual(lerArgumentos(['--destino', 'D:/b', '--simular']), { destino: 'D:/b', simular: true, restaurar: false, confirmar: false, buckets: [], prefixo: '' })
  assert.deepEqual(lerArgumentos(['--destino', 'D:/b', '--bucket', 'imports', '--bucket', 'skill-files']).buckets, ['imports', 'skill-files'])
  assert.throws(() => lerArgumentos([]), /informe --destino/)
  assert.throws(() => lerArgumentos(['--destino']), /precisa de um valor/)
  assert.throws(() => lerArgumentos(['--destino', 'x', '--bucket', 'outro']), /bucket desconhecido/)
  assert.throws(() => lerArgumentos(['--destino', 'x', '--apagar']), /opção desconhecida/)
  assert.throws(() => lerArgumentos(['--destino', 'x', '--restaurar']), /exatamente um --bucket/)
  assert.throws(() => lerArgumentos(['--destino', 'x', '--restaurar', '--bucket', 'imports']), /--simular e depois com --confirmar/)
  assert.equal(lerArgumentos(['--destino', 'x', '--restaurar', '--bucket', 'imports', '--confirmar', '--prefixo', 'org1/']).prefixo, 'org1/')
  assert.throws(() => lerArgumentos(['--destino', 'x', '--prefixo', 'org1/']), /só valem com --restaurar/)
})
