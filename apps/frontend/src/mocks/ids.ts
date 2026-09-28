/**
 * IDs estáveis dos dados de demonstração. Centralizados para que os
 * arquivos de seed se refiram uns aos outros sem strings soltas.
 */
export const OFFICE_ID = "office_demo";

export const U = {
  barbara: "usr_barbara",
  claudio: "usr_claudio",
  beatriz: "usr_beatriz",
  renata: "usr_renata",
  thiago: "usr_thiago",
} as const;

export const C = {
  helena: "cli_helena",
  joao: "cli_joao",
  ana: "cli_ana",
  roberto: "cli_roberto",
  marlene: "cli_marlene",
  francisco: "cli_francisco",
  luiza: "cli_luiza",
  pedro: "cli_pedro",
  ferragens: "cli_ferragens",
  transportes: "cli_transportes",
  panificadora: "cli_panificadora",
  clinica: "cli_clinica",
} as const;

export const P = {
  helenaRevisional: "prc_helena_revisional",
  helenaTarifas: "prc_helena_tarifas",
  franciscoDeclaratoria: "prc_francisco_declaratoria",
  franciscoRepeticao: "prc_francisco_repeticao",
  ferragensRevisional: "prc_ferragens_revisional",
  ferragensExecucao: "prc_ferragens_execucao",
  transportesCobranca: "prc_transportes_cobranca",
  transportesTrabalhista: "prc_transportes_trabalhista",
  pedroEncerrado: "prc_pedro_encerrado",
  luizaConsumidor: "prc_luiza_consumidor",
  joaoSuspenso: "prc_joao_suspenso",
  clinicaTributario: "prc_clinica_tributario",
  marleneRecurso: "prc_marlene_recurso",
  robertoCartao: "prc_roberto_cartao",
} as const;

export const A = {
  triagem: "agt_triagem",
  documentacao: "agt_documentacao",
  peticoes: "agt_peticoes",
  prazos: "agt_prazos",
  revisoes: "agt_revisoes",
} as const;

export const S = {
  triagemContratos: "skl_triagem_contratos",
  conferenciaDocumental: "skl_conferencia_documental",
  peticaoInicial: "skl_peticao_inicial",
  redacaoBancaria: "skl_redacao_bancaria",
  contagemPrazos: "skl_contagem_prazos",
  leituraMovimentacoes: "skl_leitura_movimentacoes",
  comunicacaoCliente: "skl_comunicacao_cliente",
  resumoProcessual: "skl_resumo_processual",
} as const;

export const T = {
  juros: "ths_juros_remuneratorios",
  descontoNaoContratado: "ths_desconto_nao_contratado",
  tarifas: "ths_tarifas_nao_informadas",
  seguroPrestamista: "ths_seguro_prestamista",
  portabilidade: "ths_portabilidade",
  superendividamento: "ths_superendividamento",
  cartaoConsignado: "ths_cartao_consignado",
} as const;

export const TPL = {
  bancaria: "tpl_bancaria",
  consumidor: "tpl_consumidor",
} as const;

export const AN = {
  helena: "ana_helena",
  joao: "ana_joao",
  roberto: "ana_roberto",
  marlene: "ana_marlene",
  luiza: "ana_luiza",
  clinica: "ana_clinica",
} as const;

export const R = {
  analiseRoberto: "rev_analise_roberto",
  peticaoHelena: "rev_peticao_helena",
  documentosJoao: "rev_documentos_joao",
  prazoFrancisco: "rev_prazo_francisco",
  mensagemClinica: "rev_mensagem_clinica",
  movimentacaoTransportes: "rev_movimentacao_transportes",
  analiseHelena: "rev_analise_helena",
  peticaoFerragens: "rev_peticao_ferragens",
  mensagemLuiza: "rev_mensagem_luiza",
} as const;

export const FEE = {
  bancarioA: "fee_bancario_a",
  bancarioB: "fee_bancario_b",
  empresarialMensal: "fee_empresarial_mensal",
  consultivo: "fee_consultivo",
} as const;

/** Nomes de instituições financeiras — todos fictícios. */
export const FICTITIOUS_BANKS = {
  meridional: "Banco Meridional S.A. (fictício)",
  atlantico: "Banco Atlântico de Crédito S.A. (fictício)",
  horizonte: "Financeira Horizonte S.A. (fictícia)",
  serrano: "Cooperativa de Crédito Serrana (fictícia)",
  crediplus: "Crediplus Financeira S.A. (fictícia)",
} as const;
