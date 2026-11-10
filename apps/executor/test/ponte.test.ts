import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { categoriaSugerida, checarOffice, checarPdf, dadosDoCadastro, globParaRegex, nomeDePasta, nomeDoClienteParaPasta, nomeNaPasta } from '../src/ponte.js'

/** As checagens do Porteiro e os nomes do Arquivista, sem rede e sem disco. */

const pdf = (corpo: string) => Buffer.from(`%PDF-1.7\n${corpo}\n%%EOF`, 'latin1')

describe('Porteiro: PDF', () => {
  it('PDF comum (o HISCON abre na primeira página com /OpenAction [..]) passa', () => {
    expect(checarPdf(pdf('1 0 obj << /Type /Catalog /OpenAction [3 0 R /FitH null] >> endobj'))).toEqual([])
  })

  it('ação ao abrir em dicionário, JavaScript, /Launch, arquivo embutido e /AA são suspeitos', () => {
    expect(checarPdf(pdf('<< /OpenAction << /S /GoTo >> >>'))).toContain('PDF com ação ao abrir (/OpenAction)')
    expect(checarPdf(pdf('<< /S /Launch /F (cmd.exe) >>'))).toContain('PDF que abre programa (/Launch)')
    expect(checarPdf(pdf('<< /Names << /EmbeddedFiles 4 0 R >> >>'))).toContain('PDF com arquivo embutido (/EmbeddedFile)')
    expect(checarPdf(pdf('<< /AA << /O 5 0 R >> >>'))).toContain('PDF com ação automática (/AA)')
    expect(checarPdf(pdf('<< /S /JavaScript /JS (x) >>'))).toEqual(expect.arrayContaining(['PDF com JavaScript (/JavaScript)', 'PDF com JavaScript (/JS)']))
  })

  it('JavaScript escondido num fluxo comprimido (object stream) é achado', () => {
    const escondido = deflateSync(Buffer.from('7 0 obj << /S /JavaScript /JS (app.launchURL("x")) >> endobj'))
    const b = Buffer.concat([Buffer.from('%PDF-1.7\n5 0 obj << /Type /ObjStm /Filter /FlateDecode /Length 99 >>\nstream\n', 'latin1'), escondido, Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1')])
    expect(checarPdf(b)).toContain('PDF com JavaScript (/JavaScript)')
  })

  it('PDF criptografado não pode ser conferido por dentro: suspeito', () => {
    expect(checarPdf(pdf('trailer << /Encrypt 9 0 R >>'))).toContain('PDF criptografado: o conteúdo não pôde ser conferido')
  })
})

describe('Porteiro: Office', () => {
  it('macro, ActiveX e objeto embutido são suspeitos; documento sem [Content_Types].xml não é Office', () => {
    const doc = (extra: string) => Buffer.from(`PK\u0003\u0004[Content_Types].xml word/document.xml ${extra}`, 'latin1')
    expect(checarOffice(doc(''))).toEqual([])
    expect(checarOffice(doc('word/vbaProject.bin'))).toContain('Documento com macro (vbaProject.bin)')
    expect(checarOffice(doc('word/activeX/activeX1.xml'))).toContain('Documento com controle ActiveX')
    expect(checarOffice(doc('word/embeddings/oleObject1.bin'))).toContain('Documento com objeto embutido (OLE)')
    expect(checarOffice(Buffer.from('PK\u0003\u0004 qualquer.zip', 'latin1'))).toContain('Não é um documento do Office válido')
  })
})

describe('Arquivista: nomes', () => {
  it('nomes da Luísa pela categoria do DG Brasil; autos começam com AUTOS', () => {
    expect(nomeNaPasta('BENEFIT_STATEMENT', 'HISCON maio', 'x.pdf')).toBe('HISCON.pdf')
    expect(nomeNaPasta('BENEFIT_STATEMENT', 'Extrato HISCREN', 'x.pdf')).toBe('HISCREN.pdf')
    expect(nomeNaPasta('IDENTIFICATION', 'RG', 'rg.jpg')).toBe('IDENTIDADE.jpg')
    expect(nomeNaPasta('ADDRESS_PROOF', 'Conta de luz', 'c.pdf')).toBe('COMPROVANTE DE RESIDÊNCIA.pdf')
    expect(nomeNaPasta('INCOME_PROOF', 'Contracheque', 'c.pdf')).toBe('CONTRACHEQUE.pdf')
    expect(nomeNaPasta('COURT_DECISION', 'Autos Reis x Banco Pine', 'a.pdf')).toBe('AUTOS_REIS_X_BANCO_PINE.pdf')
    expect(nomeNaPasta('OTHER', 'Carta: ../../x', 'c.pdf')).toBe('Carta .. .. x.pdf')
  })

  it('pasta do cliente: um nome só; pelo nome do cliente, MAIÚSCULAS sem acento nem cedilha', () => {
    expect(nomeDePasta('..')).toBeNull()
    expect(nomeDePasta('A\\B')).toBeNull()
    expect(nomeDePasta('C:')).toBeNull()
    expect(nomeDePasta('JOSE DA SILVA. ')).toBe('JOSE DA SILVA')
    expect(nomeDoClienteParaPasta('Conceição  Araújo de Souça')).toBe('CONCEICAO ARAUJO DE SOUCA')
  })

  it('DADOS DO CADASTRO.txt no formato da Luísa, sem conversa do ChatJurídico', () => {
    const t = dadosDoCadastro({ cliente: { id: 'c1', nome: 'Maria', profissao: 'aposentada', estado_civil: 'viúvo(a)', email: null }, pasta_drive: null }, 'job-1')
    const campos = t.split('\r\n').filter(Boolean).map((l) => l.split(':')[0])
    expect(campos.slice(0, 9)).toEqual(['nome', 'conversa_id', 'contact_id', 'atendente', 'profissao', 'estado_civil', 'email', 'comprovante_residencia_em_nome_de', 'salvo_em'])
    expect(t).toContain('email: não tenho')
  })
})

describe('Mensageiro: padrões e categorias', () => {
  it('padrão sem diferença de acento e de maiúscula', () => {
    expect(globParaRegex('Procuracao_*.pdf').test('procuracao_silva.pdf')).toBe(true)
    expect(globParaRegex('MINUTA_*.docx').test('MINUTA_INICIAL_REIS_PINE_JEC_2026-11-10.docx')).toBe(true)
    expect(globParaRegex('MINUTA_*.docx').test('MINUTA_X.docx.exe')).toBe(false)
  })

  it('categoria pelo nome do arquivo', () => {
    expect(categoriaSugerida('Procuracao_SILVA.pdf')).toBe('POWER_OF_ATTORNEY')
    expect(categoriaSugerida('Declaracao_Hipossuficiencia_SILVA.pdf')).toBe('HARDSHIP_DECLARATION')
    expect(categoriaSugerida('MINUTA_REPLICA_REIS.docx')).toBe('PETITION')
    expect(categoriaSugerida('Contrato_Honorarios_SILVA.pdf')).toBe('OTHER')
  })
})
