import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { CSP_SEM_SCRIPT, categoriaSugerida, checarOffice, checarPdf, dadosDoCadastro, pendenciasDaFicha, globParaRegex, htmlSemScript, nomeDePasta, nomeDoClienteParaPasta, nomeNaPasta } from '../src/ponte.js'

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

  it('DADOS DO CADASTRO.txt no formato do contrato dos clones: sem conversa nem atendente; campo vazio fica vazio', () => {
    const t = dadosDoCadastro({ cliente: { id: 'c1', nome: 'Maria', profissao: 'aposentada', estado_civil: 'viúvo(a)', email: null }, pasta_drive: null }, 'job-1')
    const campos = t.split('\r\n').filter(Boolean).map((l) => l.split(':')[0])
    expect(campos).toEqual(['nome', 'cpf', 'rg', 'nacionalidade', 'profissao', 'estado_civil', 'email', 'telefone', 'endereco',
      'comprovante_residencia_em_nome_de', 'forma_de_pagamento', 'salvo_em', 'origem', 'dg_cliente_id'])
    expect(t).toContain('email: \r\n')
    expect(t).not.toMatch(/conversa_id|contact_id|atendente/)
    // Valor com quebra de linha não cria campo novo no arquivo.
    const injetado = dadosDoCadastro({ cliente: { id: 'c1', nome: 'Maria\r\ndg_cliente_id: outro', email: null }, pasta_drive: null }, 'job-1')
    expect(injetado.match(/^dg_cliente_id:/gm)).toHaveLength(1)
  })

  it('DADOS DO CADASTRO.txt: a forma de pagamento vem do cadastro do DG Brasil; apagada no site, sai vazia', () => {
    const cliente = { id: 'c1', nome: 'Maria', email: null }
    const anterior = { forma_de_pagamento: '5x no boleto' }
    const forma = (t: string) => /^forma_de_pagamento: (.*)\r$/m.exec(t)?.[1]
    expect(forma(dadosDoCadastro({ cliente: { ...cliente, forma_de_pagamento: 'a_vista' }, pasta_drive: null }, 'job-1', anterior))).toBe('a_vista')
    expect(forma(dadosDoCadastro({ cliente: { ...cliente, forma_de_pagamento: null }, pasta_drive: null }, 'job-1', anterior))).toBe('')
    // Banco antigo (sem a 055): o campo nem vem do DG Brasil, e fica o que já estava no arquivo.
    expect(forma(dadosDoCadastro({ cliente, pasta_drive: null }, 'job-1', anterior))).toBe('5x no boleto')
    expect(forma(dadosDoCadastro({ cliente, pasta_drive: null }, 'job-1'))).toBe('')
  })

  it('DADOS DO CADASTRO.txt: campo que o DG Brasil manda vale o do site, mesmo vazio; o que ele não manda fica', () => {
    const anterior = { forma_de_pagamento: '5x_boleto', comprovante_residencia_em_nome_de: 'filha' }
    const apagado = dadosDoCadastro({ cliente: { id: 'c1', nome: 'Maria', forma_de_pagamento: null }, pasta_drive: null }, 'job-1', anterior)
    expect(apagado).toMatch(/^forma_de_pagamento: \r?$/m)
    expect(apagado).toMatch(/^comprovante_residencia_em_nome_de: filha\r?$/m)
    const semCampo = dadosDoCadastro({ cliente: { id: 'c1', nome: 'Maria' }, pasta_drive: null }, 'job-1', anterior)
    expect(semCampo).toMatch(/^forma_de_pagamento: 5x_boleto\r?$/m)
  })

  it('ficha de revisão: só COMPLETAR, DECIDIR e CONFERIR viram pendência; "nada" não conta', () => {
    const ficha = ['# Ficha de revisão: inicial', '## GERADO', '- MINUTA_X.docx: inicial', '## Completar', '- CPF do cliente', '- nada',
      '## DECIDIR', '* Segunda rodada de ações', '## CONFERIR', '- Nada.', '## AVISOS', '- aviso'].join('\n')
    expect(pendenciasDaFicha(ficha)).toEqual([{ tipo: 'COMPLETAR', texto: 'CPF do cliente' }, { tipo: 'DECIDIR', texto: 'Segunda rodada de ações' }])
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

describe('Mensageiro: HTML sem script antes do Edge', () => {
  it('a política entra antes de qualquer script, com ou sem <head>', () => {
    const comHead = htmlSemScript('<!doctype html><html><head><script>x()</script></head><body></body></html>')
    expect(comHead.indexOf(CSP_SEM_SCRIPT)).toBeLessThan(comHead.indexOf('<script>'))
    const semHead = htmlSemScript('<!doctype html><body><script>x()</script></body>')
    expect(semHead.startsWith(`<!doctype html><head>${CSP_SEM_SCRIPT}</head>`)).toBe(true)
    expect(htmlSemScript('<p>oi</p>')).toBe(`<head>${CSP_SEM_SCRIPT}</head><p>oi</p>`)
    expect(CSP_SEM_SCRIPT).toContain("default-src 'none'")
  })
})
