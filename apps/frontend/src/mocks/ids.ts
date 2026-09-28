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

/* ------------------------------------------------------------------ */
/* Escritórios parceiros (todos fictícios)                             */
/* ------------------------------------------------------------------ */

export const PO = {
  almeida: "pof_almeida",
  ferreiraLima: "pof_ferreira_lima",
  costa: "pof_costa",
  nogueira: "pof_nogueira",
} as const;

/** Usuários dos escritórios parceiros. */
export const PU = {
  marcos: "usr_p_marcos",
  carla: "usr_p_carla",
  patricia: "usr_p_patricia",
  rodrigo: "usr_p_rodrigo",
  eduardo: "usr_p_eduardo",
  silvia: "usr_p_silvia",
} as const;

/** Clientes cujo cadastro canônico foi criado por parceiros. */
export const PC = {
  sandra: "cli_p_sandra",
  otavio: "cli_p_otavio",
  mercearia: "cli_p_mercearia",
  rita: "cli_p_rita",
} as const;

/** Processos originados por parceiros. */
export const PP = {
  sandraRevisional: "prc_p_sandra_revisional",
  otavioConsignado: "prc_p_otavio_consignado",
  merceariaCapitalGiro: "prc_p_mercearia_capital_giro",
  ritaIndenizatoria: "prc_p_rita_indenizatoria",
  helenaCartao: "prc_p_helena_cartao",
} as const;

export const PR = {
  merceariaExtrato: "prq_mercearia_extrato",
  merceariaCadastro: "prq_mercearia_cadastro",
  sandraComprovante: "prq_sandra_comprovante",
  ritaProcuracao: "prq_rita_procuracao",
} as const;
