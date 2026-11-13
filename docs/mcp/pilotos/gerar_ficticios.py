"""Documentos FICTÍCIOS para validar os agentes clonados do DG Brasil.

Tudo aqui é inventado: pessoas, bancos, números, processos e valores. Nenhum
dado real. Os PDFs vão para docs/mcp/pilotos/documentos/.
"""
import sys
from pathlib import Path

from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

DESTINO = Path(sys.argv[1])
DESTINO.mkdir(parents=True, exist_ok=True)

AUTOR = 'JOSÉ DA SILVA FICTÍCIO'
CPF = '999.000.000-05'
NB = '000.000.000-0'
ADV = 'FULANA DE TAL FICTÍCIA, OAB/RJ 000.000'
ADV_BANCO = 'CICLANO DE TAL FICTÍCIO, OAB/SP 000.001'
RODAPE = 'DOCUMENTO FICTÍCIO PARA TESTE DO DG BRASIL. Pessoas, números, processos e valores inventados.'

base = getSampleStyleSheet()
T = ParagraphStyle('t', parent=base['Title'], fontSize=13, leading=16, spaceAfter=8)
S = ParagraphStyle('s', parent=base['Heading3'], fontSize=11, leading=14, spaceBefore=8, spaceAfter=4)
P = ParagraphStyle('p', parent=base['BodyText'], fontSize=10.5, leading=14.5, alignment=TA_JUSTIFY, spaceAfter=6)
C = ParagraphStyle('c', parent=P, alignment=TA_CENTER)
N = ParagraphStyle('n', parent=P, fontSize=8, leading=10, alignment=TA_CENTER, textColor='#666666')


def cnj(numero, ano, j, tr, origem):
    """Número CNJ com o dígito verificador certo (Res. CNJ 65/2008, módulo 97)."""
    n = int(f'{numero:07d}{ano}{j}{tr:02d}{origem:04d}00')
    dv = 98 - (n % 97)
    return f'{numero:07d}-{dv:02d}.{ano}.{j}.{tr:02d}.{origem:04d}'


def pdf(nome, partes):
    def rodape(canvas, doc):
        canvas.saveState()
        canvas.setFont('Helvetica', 7.5)
        canvas.setFillColor('#777777')
        canvas.drawCentredString(A4[0] / 2, 1.2 * cm, f'{RODAPE}  ·  página {doc.page}')
        canvas.restoreState()
    doc = SimpleDocTemplate(str(DESTINO / nome), pagesize=A4, leftMargin=2.5 * cm, rightMargin=2.2 * cm,
                            topMargin=2.2 * cm, bottomMargin=2 * cm, title=nome, author='DG Brasil (teste)')
    doc.build(partes, onFirstPage=rodape, onLaterPages=rodape)
    print('gerado', nome)


def tabela(linhas, larguras):
    t = Table(linhas, colWidths=larguras, repeatRows=1)
    t.setStyle(TableStyle([
        ('FONT', (0, 0), (-1, -1), 'Helvetica', 8.5), ('FONT', (0, 0), (-1, 0), 'Helvetica-Bold', 8.5),
        ('GRID', (0, 0), (-1, -1), 0.4, '#999999'), ('BACKGROUND', (0, 0), (-1, 0), '#eeeeee'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    return t


def cabecalho(juizo, numero, classe, reu='BANCO FICTÍCIO S.A.'):
    return [
        Paragraph('PODER JUDICIÁRIO DO ESTADO DO RIO DE JANEIRO (FICTÍCIO)', C),
        Paragraph(juizo, C),
        Spacer(1, 6),
        Paragraph(f'Processo nº {numero} · {classe}', C),
        Paragraph(f'Autor: {AUTOR} (CPF {CPF}) · Réu: {reu}', C),
        Spacer(1, 10),
    ]


def inicial(numero, juizo, contrato, banco, valor_parcela, inclusao, pedido_extra=''):
    return [
        Paragraph('PETIÇÃO INICIAL (cópia)', S),
        Paragraph(f'{AUTOR}, aposentado, CPF {CPF}, titular do benefício previdenciário nº {NB}, por sua advogada, '
                  f'propõe AÇÃO DECLARATÓRIA DE INEXISTÊNCIA DE RELAÇÃO JURÍDICA cumulada com REPETIÇÃO DE INDÉBITO '
                  f'e INDENIZAÇÃO POR DANOS MORAIS em face de {banco}.', P),
        Paragraph(f'O autor nunca contratou o empréstimo consignado nº {contrato}, incluído no seu benefício em '
                  f'{inclusao}, com parcelas mensais de {valor_parcela}. Não assinou contrato, não recebeu valor e só '
                  f'soube do desconto ao consultar o extrato do INSS (HISCON).', P),
        Paragraph('Pede: a declaração de inexistência do contrato; a cessação dos descontos em tutela de urgência; a '
                  'devolução em dobro dos valores descontados a partir de 30/03/2021 e simples antes disso; indenização '
                  f'por danos morais de R$ 10.000,00; a gratuidade de justiça; a inversão do ônus da prova.{pedido_extra}', P),
        Paragraph(f'Valor da causa: R$ 22.640,00. Advogada: {ADV}.', P),
    ]


def contestacao(banco, contrato, extra=''):
    return [
        Paragraph('CONTESTAÇÃO (cópia)', S),
        Paragraph(f'{banco}, por seu advogado ({ADV_BANCO}), contesta. Preliminarmente, alega falta de interesse de agir '
                  'por ausência de reclamação administrativa e impugna a gratuidade de justiça.', P),
        Paragraph(f'No mérito, afirma que o contrato nº {contrato} foi celebrado regularmente por meio eletrônico, com '
                  'selfie e geolocalização, e que o valor de R$ 8.400,00 foi creditado por TED. Junta: (1) cédula de '
                  'crédito bancário com assinatura eletrônica; (2) comprovante de TED para a conta 0000-0, agência 0001, '
                  'do BANCO ÔMEGA FICTÍCIO; (3) fotografia (selfie) e relatório de geolocalização.', P),
        Paragraph('Observação dos autos: a conta de destino da TED não é a conta em que o autor recebe o benefício. A '
                  'selfie juntada não tem data nem prova de vida. A cédula traz endereço diferente do comprovante de '
                  f'residência do autor.{extra}', P),
        Paragraph('Pede a improcedência dos pedidos e, se houver condenação, a compensação do valor creditado.', P),
    ]


hoje = '10/11/2026'

# ── 0. HISCON, identidade e comprovante com o CPF do cadastro (999.000.000-05) ──
# Os da Frente B tinham 999.000.000-01, que não confere com o cadastro do cliente fictício.
pdf('hiscon-ficticio.pdf', [
    Paragraph('INSTITUTO NACIONAL DO SEGURO SOCIAL - DOCUMENTO FICTÍCIO PARA TESTE (NÃO É REAL)', C),
    Paragraph('HISTÓRICO DE EMPRÉSTIMO CONSIGNADO - HISCON', T),
    Paragraph(f'Beneficiário: {AUTOR} · CPF: {CPF} (fictício)', P),
    Paragraph(f'Benefício (NB): {NB} (fictício) · Espécie: 41 - Aposentadoria por idade', P),
    Paragraph('Banco pagador: BANCO FICTÍCIO S.A. · Data do extrato: 01/10/2026', P),
    Paragraph('Margem consignável: R$ 1.000,00 · Utilizada: R$ 980,00 · Disponível: R$ 20,00', P),
    Paragraph('EMPRÉSTIMOS BANCÁRIOS', S),
    tabela([
        ['Contrato', 'Banco', 'Situação', 'Origem da averbação', 'Inclusão', 'Parcelas', 'Valor'],
        ['111111-01', 'BANCO ALFA S.A.', 'Ativo', 'Averbação nova', '10/01/2021', '84', 'R$ 210,00'],
        ['222222-02', 'BANCO BETA S.A.', 'Ativo', 'Migração de contrato (portab.)', '15/03/2023', '84', 'R$ 180,00'],
        ['333333-03', 'BANCO GAMA S.A.', 'Excluído', 'Averbação nova', '02/05/2024', '72', 'R$ 150,00'],
        ['333333-04', 'BANCO GAMA S.A.', 'Ativo', 'Averbação nova', '06/05/2024', '72', 'R$ 160,00'],
    ], [1.8 * cm, 2.9 * cm, 1.5 * cm, 4.2 * cm, 1.8 * cm, 1.4 * cm, 1.8 * cm]),
    Paragraph('CARTÃO DE CRÉDITO (RMC)', S),
    tabela([
        ['Contrato', 'Banco', 'Situação', 'Inclusão', 'Limite', 'Utilizado', '10/2023', '11/2023', '12/2023'],
        ['444444-RMC', 'BANCO DELTA S.A.', 'Ativo', '20/07/2019', 'R$ 1.400,00', 'R$ 1.400,00', 'R$ 900', 'R$ 900', 'R$ 900'],
    ], [2 * cm, 2.7 * cm, 1.3 * cm, 1.7 * cm, 1.8 * cm, 1.8 * cm, 1.4 * cm, 1.4 * cm, 1.4 * cm]),
    Spacer(1, 10),
    Paragraph('Fim do extrato fictício. Todos os nomes, números e valores são inventados para teste.', N),
])
pdf('identidade-ficticia.pdf', [
    Paragraph('REPÚBLICA FEDERATIVA DO BRASIL - CARTEIRA DE IDENTIDADE (DOCUMENTO FICTÍCIO DE TESTE)', T),
    Paragraph(f'Nome: {AUTOR}', P),
    Paragraph('Registro Geral: 00.000.000-0 · Órgão expedidor: DETRAN/RJ', P),
    Paragraph(f'CPF: {CPF} (fictício)', P),
    Paragraph('Data de nascimento: 01/01/1950 · Naturalidade: Petrópolis/RJ', P),
    Paragraph('Documento inventado para validar o DG Brasil. Não tem valor legal.', N),
])
pdf('comprovante-residencia-ficticio.pdf', [
    Paragraph('COMPROVANTE DE RESIDÊNCIA (DOCUMENTO FICTÍCIO DE TESTE)', T),
    Paragraph('Companhia de Energia Fictícia S.A. - Conta de luz', P),
    Paragraph(f'Titular: {AUTOR} · CPF: {CPF} (fictício)', P),
    Paragraph('Endereço: Rua das Flores Fictícias, 100 - Centro · Petrópolis/RJ - CEP 25600-000', P),
    Paragraph('Referência: 10/2026 · Vencimento: 10/11/2026', P),
    Paragraph('Documento inventado para validar o DG Brasil. Não corresponde a pessoa real.', N),
])

# ── 1. HISCON sem nenhum empréstimo (Clara sem viabilidade) ─────────────────
pdf('hiscon-sem-acao-ficticio.pdf', [
    Paragraph('INSTITUTO NACIONAL DO SEGURO SOCIAL - DOCUMENTO FICTÍCIO PARA TESTE (NÃO É REAL)', C),
    Paragraph('HISTÓRICO DE EMPRÉSTIMO CONSIGNADO - HISCON', T),
    Paragraph(f'Beneficiário: {AUTOR} · CPF: {CPF} (fictício)', P),
    Paragraph(f'Benefício (NB): {NB} (fictício) · Espécie: 41 - Aposentadoria por idade', P),
    Paragraph('Banco pagador: BANCO FICTÍCIO S.A. · Data do extrato: 01/11/2026', P),
    Paragraph('Margem consignável: R$ 1.000,00 · Utilizada: R$ 0,00 · Disponível: R$ 1.000,00', P),
    Paragraph('EMPRÉSTIMOS BANCÁRIOS', S),
    Paragraph('Nenhum empréstimo consignado ativo, suspenso, excluído ou encerrado no histórico deste benefício.', P),
    Paragraph('CARTÃO DE CRÉDITO (RMC) E CARTÃO BENEFÍCIO (RCC)', S),
    Paragraph('Nenhuma reserva de margem para cartão no histórico deste benefício.', P),
    Spacer(1, 10),
    Paragraph('Fim do extrato fictício. Todos os nomes, números e valores são inventados para teste.', N),
])

# ── 2. Boleto no lugar do comprovante de residência (Porteiro, qualidade) ───
pdf('boleto-no-lugar-do-comprovante-ficticio.pdf', [
    Paragraph('BANCO FICTÍCIO S.A. · BOLETO BANCÁRIO (FICTÍCIO)', T),
    Paragraph('Beneficiário: LOJA DE MÓVEIS FICTÍCIA LTDA · CNPJ 00.000.000/0001-00', P),
    Paragraph(f'Pagador: {AUTOR} · CPF {CPF}', P),
    Paragraph('Endereço do pagador: Rua das Flores Fictícias, 100, Centro, Petrópolis/RJ, CEP 25600-000', P),
    Paragraph('Parcela 3 de 10 do carnê · Vencimento: 15/10/2026 · Valor: R$ 189,90', P),
    Paragraph('Linha digitável: 00000.00000 00000.000000 00000.000000 0 00000000000000', P),
    Spacer(1, 10),
    Paragraph('Documento fictício: boleto de compra parcelada, não é conta de consumo (água, luz, telefone, gás).', N),
])

# ── 3. Contrato de empréstimo pessoal (Atlas) ───────────────────────────────
pdf('contrato-emprestimo-pessoal-ficticio.pdf', [
    Paragraph('CÉDULA DE CRÉDITO BANCÁRIO · EMPRÉSTIMO PESSOAL (FICTÍCIA)', T),
    Paragraph('Credor: FINANCEIRA FICTÍCIA S.A. - CRÉDITO, FINANCIAMENTO E INVESTIMENTO · CNPJ 00.000.000/0002-00', P),
    Paragraph(f'Emitente: {AUTOR} · CPF {CPF} · aposentado', P),
    tabela([
        ['Item', 'Condição'],
        ['Modalidade', 'Crédito pessoal não consignado, com débito em conta corrente'],
        ['Data da contratação', '06/05/2024'],
        ['Valor liberado', 'R$ 3.000,00'],
        ['Parcelas', '24 parcelas mensais de R$ 612,34'],
        ['Taxa de juros', '18,00% ao mês · 628,76% ao ano'],
        ['Custo efetivo total (CET)', '19,12% ao mês'],
        ['Primeiro vencimento', '06/06/2024'],
        ['Seguro prestamista', 'Não contratado'],
    ], [5 * cm, 10.5 * cm]),
    Spacer(1, 8),
    Paragraph('As parcelas são debitadas na conta 0000-0, agência 0001, do BANCO FICTÍCIO S.A., em que o emitente '
              'recebe o benefício do INSS. Até 06/10/2026 foram pagas 29 parcelas, incluídas as de atraso com encargos.', P),
    Paragraph('Documento fictício para teste. Nenhuma pessoa ou instituição real.', N),
])

# ── 4. Consulta SUSEP com seguro não contratado (Vicente) ───────────────────
pdf('consulta-susep-seguro-ficticia.pdf', [
    Paragraph('SUPERINTENDÊNCIA DE SEGUROS PRIVADOS · CONSULTA DE APÓLICES POR CPF (FICTÍCIA)', T),
    Paragraph(f'CPF consultado: {CPF} · Nome: {AUTOR} · Data da consulta: 05/11/2026', P),
    tabela([
        ['Seguradora', 'Ramo', 'Apólice', 'Início', 'Situação', 'Prêmio mensal'],
        ['SEGURADORA FICTÍCIA S.A.', 'Prestamista', '0000000-1', '15/03/2023', 'Vigente', 'R$ 29,90'],
        ['SEGURADORA FICTÍCIA S.A.', 'Acidentes pessoais', '0000000-2', '15/03/2023', 'Vigente', 'R$ 14,90'],
    ], [4.2 * cm, 2.8 * cm, 2.3 * cm, 2 * cm, 1.8 * cm, 2.4 * cm]),
    Spacer(1, 8),
    Paragraph('Os prêmios são debitados na conta em que o beneficiário recebe o benefício do INSS. O início das duas '
              'apólices coincide com a inclusão do contrato consignado 222222-02 do BANCO BETA S.A. (portabilidade), '
              'que pertence a outro grupo econômico. O segurado declara que nunca contratou esses seguros.', P),
    Paragraph('Documento fictício para teste. Nenhuma pessoa ou instituição real.', N),
])

# ── 5. Autos com contestação (Murilo, réplica · Vara Cível) ─────────────────
n1 = cnj(1001, 2026, 8, 19, 999)
pdf('AUTOS replica - processo ficticio 1.pdf', cabecalho('1ª Vara Cível da Comarca de Cidade Fictícia/RJ', n1, 'Procedimento comum cível') + inicial(
    n1, '', '555555-05', 'BANCO FICTÍCIO S.A.', 'R$ 210,00', '10/01/2021') + [PageBreak()] + contestacao('BANCO FICTÍCIO S.A.', '555555-05') + [
    Paragraph('ATO ORDINATÓRIO', S),
    Paragraph(f'Em {hoje}: à parte autora, para réplica à contestação e aos documentos, no prazo de 15 (quinze) dias '
              '(CPC, arts. 350 e 351). Intimação disponibilizada no DJEN em 10/11/2026.', P),
])

# ── 6. Autos com despacho de emenda (Laura · Vara Cível) ────────────────────
n2 = cnj(1002, 2026, 8, 19, 999)
pdf('AUTOS emenda - processo ficticio 2.pdf', cabecalho('2ª Vara Cível da Comarca de Cidade Fictícia/RJ', n2, 'Procedimento comum cível') + inicial(
    n2, '', '666666-06', 'BANCO FICTÍCIO S.A.', 'R$ 180,00', '15/03/2023') + [
    Paragraph('DESPACHO', S),
    Paragraph(f'Em {hoje}. Emende o autor a petição inicial, em 15 (quinze) dias, sob pena de indeferimento (CPC, art. 321): '
              '(a) junte comprovante de residência atualizado, em seu nome, ou declaração de residência; (b) apresente '
              'planilha discriminada do valor da causa, com as parcelas descontadas e a forma de cálculo da repetição em '
              'dobro; (c) junte extratos bancários dos três últimos meses para a análise da gratuidade de justiça. '
              'Intimação disponibilizada no DJEN em 10/11/2026.', P),
])

# ── 7. Autos com decisão que indefere a tutela (Paulo · Vara Cível) ─────────
n3 = cnj(1003, 2026, 8, 19, 999)
pdf('AUTOS agravo - processo ficticio 3.pdf', cabecalho('3ª Vara Cível da Comarca de Cidade Fictícia/RJ', n3, 'Procedimento comum cível') + inicial(
    n3, '', '777777-07', 'BANCO FICTÍCIO S.A.', 'R$ 160,00', '06/05/2024') + [
    Paragraph('DECISÃO', S),
    Paragraph(f'Em {hoje}. Indefiro a tutela de urgência. Não há prova inequívoca da fraude: o contrato pode ter sido '
              'celebrado por meio eletrônico, e a questão depende de instrução. O perigo de dano também não está '
              'demonstrado, pois os descontos ocorrem desde 2024. Indefiro, ainda, a gratuidade de justiça: o autor '
              'recebe benefício e não comprovou a insuficiência de recursos. Recolha as custas em 15 dias. Cite-se. '
              'Intimação disponibilizada no DJEN em 10/11/2026.', P),
])

# ── 8. Autos na fase de provas (Pedro · Vara Cível) ─────────────────────────
n4 = cnj(1004, 2026, 8, 19, 999)
pdf('AUTOS provas - processo ficticio 4.pdf', cabecalho('4ª Vara Cível da Comarca de Cidade Fictícia/RJ', n4, 'Procedimento comum cível') + inicial(
    n4, '', '888888-08', 'BANCO FICTÍCIO S.A.', 'R$ 150,00', '02/05/2024') + [PageBreak()] + contestacao('BANCO FICTÍCIO S.A.', '888888-08') + [
    Paragraph('RÉPLICA (resumo)', S),
    Paragraph('O autor impugnou a assinatura eletrônica, a selfie sem prova de vida e a TED para conta de terceiro, e '
              'reiterou que nunca contratou.', P),
    Paragraph('DESPACHO', S),
    Paragraph(f'Em {hoje}. Especifiquem as partes, em 15 (quinze) dias, as provas que pretendem produzir, justificando '
              'a pertinência, sob pena de preclusão. Intimação disponibilizada no DJEN em 10/11/2026.', P),
])

# ── 9. Autos com sentença de improcedência (Rafael e Gabriel · JEC) ─────────
n5 = cnj(1005, 2026, 8, 19, 999)
pdf('AUTOS sentenca improcedente - processo ficticio 5.pdf', cabecalho('Juizado Especial Cível da Comarca de Cidade Fictícia/RJ', n5, 'Procedimento do Juizado Especial Cível') + inicial(
    n5, '', '999999-09', 'BANCO FICTÍCIO S.A.', 'R$ 210,00', '10/01/2021') + [PageBreak()] + contestacao('BANCO FICTÍCIO S.A.', '999999-09') + [
    Paragraph('SENTENÇA', S),
    Paragraph('Dispensado o relatório (Lei 9.099/95, art. 38). O réu juntou o contrato eletrônico, a selfie e o comprovante '
              'de transferência. Há prova da contratação. O autor não demonstrou que deixou de receber o valor. Julgo '
              'IMPROCEDENTES os pedidos (CPC, art. 487, I). Sem custas nem honorários (Lei 9.099/95, art. 55).', P),
    Paragraph('Observação dos autos: a sentença não examina que a TED foi feita para conta de outro banco, que não é a '
              'conta do benefício, ponto levantado na réplica; e não aprecia o pedido de inversão do ônus da prova.', P),
    Paragraph('Intimação da sentença disponibilizada no DJEN em 10/11/2026.', P),
])

# ── 10. Autos com sentença procedente transitada (Beatriz · JEC) ────────────
n6 = cnj(1006, 2026, 8, 19, 999)
pdf('AUTOS cumprimento - processo ficticio 6.pdf', cabecalho('Juizado Especial Cível da Comarca de Cidade Fictícia/RJ', n6, 'Procedimento do Juizado Especial Cível') + inicial(
    n6, '', '121212-12', 'BANCO FICTÍCIO S.A.', 'R$ 175,00', '05/04/2021') + [
    Paragraph('SENTENÇA', S),
    Paragraph('O réu não juntou o contrato nem prova do crédito ao autor. Julgo PROCEDENTES os pedidos para: (a) declarar '
              'inexistente o contrato nº 121212-12; (b) condenar o réu a cessar os descontos em 10 dias, sob pena de multa '
              'de R$ 300,00 por desconto, limitada a R$ 6.000,00; (c) condenar o réu a restituir em dobro as parcelas de '
              'R$ 175,00 descontadas de 05/2021 a 08/2026, com correção monetária desde cada desconto (Súmula 43/STJ) e '
              'juros desde cada desconto (Súmula 54/STJ), nos termos dos arts. 389 e 406 do CC, com a redação da Lei '
              '14.905/2024; (d) condenar o réu a pagar R$ 5.000,00 de danos morais, corrigidos desde esta data (Súmula '
              '362/STJ) e com juros desde o primeiro desconto.', P),
    Paragraph('Data da sentença: 10/09/2026.', P),
    Paragraph('CERTIDÃO DE TRÂNSITO EM JULGADO', S),
    Paragraph('Certifico que a sentença transitou em julgado em 05/10/2026, sem recurso. O réu não comprovou o pagamento '
              'nem a cessação dos descontos: o HISCON de 01/11/2026 ainda mostra o contrato ativo.', P),
    Paragraph(f'DESPACHO de {hoje}: requeira a parte autora o que entender de direito. Intimação disponibilizada no DJEN '
              'em 10/11/2026.', P),
])

# ── 11. Autos com audiência de instrução designada (Teresa · JEC) ──────────
n7 = cnj(1007, 2026, 8, 19, 999)
pdf('AUTOS audiencia - processo ficticio 7.pdf', cabecalho('Juizado Especial Cível da Comarca de Cidade Fictícia/RJ', n7, 'Procedimento do Juizado Especial Cível') + inicial(
    n7, '', '131313-13', 'BANCO FICTÍCIO S.A.', 'R$ 190,00', '20/08/2022') + [PageBreak()] + contestacao('BANCO FICTÍCIO S.A.', '131313-13') + [
    Paragraph('DESPACHO', S),
    Paragraph(f'Em {hoje}. Designo audiência de instrução e julgamento para 10/12/2026, às 14h, por videoconferência. '
              'Intimem-se as partes para depoimento pessoal. O réu deverá comparecer por preposto com carta de preposição. '
              'Intimação disponibilizada no DJEN em 10/11/2026.', P),
])

print('CNJ:', n1, n2, n3, n4, n5, n6, n7)
