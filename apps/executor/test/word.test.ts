import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32 } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { wordDocxParaPdf } from '../src/ponte.js'

/**
 * O Word DE VERDADE. Só roda quando alguém pede, num computador com o Microsoft
 * Word (no PowerShell):
 *
 *   $env:DG_TESTE_WORD = '1'; npx vitest run test/word.test.ts
 *
 * Os outros testes usam um Word de mentira (executor.test.ts). O documento é
 * fictício, criado aqui, numa pasta temporária.
 */

/** ZIP sem compressão, o bastante para um .docx mínimo. */
function zip(arquivos: Array<[string, string]>): Buffer {
  const locais: Buffer[] = []
  const centrais: Buffer[] = []
  let posicao = 0
  for (const [nome, texto] of arquivos) {
    const n = Buffer.from(nome, 'utf8')
    const dados = Buffer.from(texto, 'utf8')
    const comum = Buffer.alloc(26)
    comum.writeUInt16LE(20, 0)            // versão mínima
    comum.writeUInt16LE(0x0800, 2)        // nomes em UTF-8
    comum.writeUInt16LE(0, 4)             // sem compressão
    comum.writeUInt32LE(0x58210000, 6)    // hora e data fixas (01/01/2024)
    comum.writeUInt32LE(crc32(dados), 10)
    comum.writeUInt32LE(dados.length, 14)
    comum.writeUInt32LE(dados.length, 18)
    comum.writeUInt16LE(n.length, 22)
    comum.writeUInt16LE(0, 24)
    const local = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), comum, n, dados])
    const fim = Buffer.alloc(14)
    fim.writeUInt32LE(posicao, 10)        // onde começa o arquivo
    centrais.push(Buffer.concat([Buffer.from([0x50, 0x4b, 0x01, 0x02, 20, 0]), comum, fim, n]))
    locais.push(local)
    posicao += local.length
  }
  const central = Buffer.concat(centrais)
  const final = Buffer.alloc(22)
  final.writeUInt32LE(0x06054b50, 0)
  final.writeUInt16LE(arquivos.length, 8)
  final.writeUInt16LE(arquivos.length, 10)
  final.writeUInt32LE(central.length, 12)
  final.writeUInt32LE(posicao, 16)
  return Buffer.concat([...locais, central, final])
}

const docxFicticio = (paragrafos: string[]) => zip([
  ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
  ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
  ['word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    paragrafos.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join('') + '</w:body></w:document>'],
])

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

/** Quantos WINWORD.EXE estão abertos agora. */
const instanciasDoWord = () => new Promise<number>((ok) => {
  execFile('tasklist', ['/FI', 'IMAGENAME eq WINWORD.EXE', '/FO', 'CSV', '/NH'], { windowsHide: true }, (_e, saida) =>
    ok(String(saida ?? '').split(/\r?\n/).filter((l) => /^"WINWORD\.EXE"/i.test(l)).length))
})

describe.runIf(process.env.DG_TESTE_WORD === '1')('Word de verdade (só com DG_TESTE_WORD=1)', () => {
  it('converte um .docx fictício em PDF sem mexer no original; o nome do arquivo (acento, espaço, aspas, &) não atrapalha; nunca sobrescreve', async () => {
    const pasta = await mkdtemp(join(tmpdir(), 'dg-word-teste-'))
    try {
      const docx = join(pasta, "MINUTA_RÉPLICA_D'ÁVILA & SILVA $(fictício); `x`.docx")
      await writeFile(docx, docxFicticio(['MINUTA FICTÍCIA DO DG BRASIL', 'Teste da conversão de Word em PDF. Nenhum dado de cliente.', 'Cidade Fictícia, 13 de novembro de 2026.']))
      const antes = sha(await readFile(docx))
      const antesDoWord = await instanciasDoWord()
      const pdf = join(pasta, 'convertido.pdf')
      const inicio = Date.now()
      await wordDocxParaPdf(docx, pdf)
      console.log(`Word → PDF em ${Date.now() - inicio} ms`)
      const b = await readFile(pdf)
      expect(b.subarray(0, 5).toString('latin1')).toBe('%PDF-')
      expect(b.length).toBeGreaterThan(1000)
      // O original não foi tocado, e o Word não deixou arquivo de trava (~$...) ao lado dele.
      expect(sha(await readFile(docx))).toBe(antes)
      expect((await readdir(pasta)).sort()).toEqual(['MINUTA_RÉPLICA_D\'ÁVILA & SILVA $(fictício); `x`.docx', 'convertido.pdf'].sort())
      await expect(wordDocxParaPdf(docx, pdf)).rejects.toMatchObject({ code: 'EEXIST' })
      expect(sha(await readFile(pdf))).toBe(sha(b))
      // Nenhuma instância do Word fica aberta depois da conversão.
      await new Promise((r) => setTimeout(r, 3000))
      expect(await instanciasDoWord()).toBe(antesDoWord)
    } finally {
      await rm(pasta, { recursive: true, force: true })
    }
  }, 300_000)
})
