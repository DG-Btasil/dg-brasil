import { daysFromNowISO, now } from "@/lib/clock";
import type { LegalArea } from "@/lib/constants/legal";
import type { LegalCaseStatus } from "@/lib/constants/status";
import type { LegalCase } from "@/types";
import { AN, C, CS, OFFICE_ID, P, PC, PCS, PO, PP, PU, U } from "../ids";

/*
 * Casos jurídicos de demonstração (todos fictícios). Cobrem todos os
 * estados: rascunho, enviado, aguardando documentos, em análise, aguardando
 * revisão, aceito sem processo, aceito com processos, rejeitado e encerrado.
 *
 * Exemplo central "origem do cliente ≠ origem do caso": Helena é cliente
 * de origem Bárbara; o caso CS.helenaBancaria é próprio, e o caso
 * PCS.helenaCartao foi originado pela Ferreira & Lima (com parceria).
 *
 * Origem (comercial) × acesso operacional do parceiro — sempre independentes:
 * (a) CS.franciscoIndicacao: origem Almeida, criado pela equipe interna, SEM
 *     vínculo operacional → o Almeida não vê o caso (só há divisão de parceria).
 * (b) PCS.merceariaCapitalGiro: criado pelo Almeida, origem Bárbara → o Almeida
 *     opera e vê o caso, sem divisão de parceria.
 * (c) PCS.sandraRevisional (e demais PCS): criado pelo Almeida, origem Almeida
 *     → acesso operacional e parceria.
 */

const minutesAgoISO = (m: number) => new Date(now().getTime() - m * 60_000).toISOString();

interface CaseSeed {
  id: string;
  clientId: string;
  title: string;
  area: LegalArea;
  caseType: string;
  status: LegalCaseStatus;
  summary: string;
  origin?: string;
  /** Escritório que criou o caso (padrão: proprietário). Parceiro criador → acesso operacional. */
  createdByOffice?: string;
  /** Vínculo operacional explícito (sobrepõe o derivado do criador). A origem nunca o define. */
  partnerOffice?: string | null;
  createdBy?: string;
  lawyer?: string | null;
  analysisId?: string;
  opposingParty?: string;
  createdDaysAgo: number;
  submittedDaysAgo?: number;
  acceptedDaysAgo?: number;
  rejectedDaysAgo?: number;
  closedDaysAgo?: number;
  rejectionReasonPublic?: string;
  rejectionReasonInternal?: string;
  notes?: string;
  partnerNotes?: string;
  createdAt?: string;
  submittedAt?: string;
}

function legalCase(c: CaseSeed): LegalCase {
  const createdAt = c.createdAt ?? daysFromNowISO(-c.createdDaysAgo, 10);
  const day = (d?: number) => (d === undefined ? undefined : daysFromNowISO(-d, 11));
  const origin = c.origin ?? OFFICE_ID;
  const createdByOrganization = c.createdByOffice ?? OFFICE_ID;
  return {
    id: c.id,
    officeId: OFFICE_ID,
    clientId: c.clientId,
    title: c.title,
    area: c.area,
    caseType: c.caseType,
    originOrganizationId: origin,
    createdByOrganizationId: createdByOrganization,
    // Acesso operacional: vínculo explícito; senão, o parceiro que criou o caso; senão, interno.
    // A origem comercial nunca concede acesso.
    partnerOrganizationId: c.partnerOffice !== undefined ? c.partnerOffice : createdByOrganization !== OFFICE_ID ? createdByOrganization : null,
    createdBy: c.createdBy ?? U.barbara,
    assignedLawyerId: c.lawyer === undefined ? U.claudio : c.lawyer,
    summary: c.summary,
    opposingParty: c.opposingParty,
    status: c.status,
    analysisId: c.analysisId,
    submittedAt: c.submittedAt ?? day(c.submittedDaysAgo),
    acceptedAt: day(c.acceptedDaysAgo),
    acceptedBy: c.acceptedDaysAgo !== undefined ? U.barbara : undefined,
    rejectedAt: day(c.rejectedDaysAgo),
    rejectionReasonPublic: c.rejectionReasonPublic,
    rejectionReasonInternal: c.rejectionReasonInternal,
    closedAt: day(c.closedDaysAgo),
    notes: c.notes,
    partnerNotes: c.partnerNotes,
    createdAt,
    updatedAt: day(Math.min(c.createdDaysAgo, c.acceptedDaysAgo ?? 999, c.rejectedDaysAgo ?? 999, c.closedDaysAgo ?? 999)) ?? createdAt,
  };
}

export function buildLegalCases(): LegalCase[] {
  return [
    /* ------------------------- próprios ------------------------- */
    legalCase({
      id: CS.helenaBancaria,
      clientId: C.helena,
      title: "Revisão de consignados — Helena",
      area: "BANKING",
      caseType: "Revisional de contratos consignados",
      status: "IN_PROGRESS",
      summary: "Três contratos consignados com taxas acima do parâmetro e tarifas não informadas. Duas ações: revisional e restituição de tarifas.",
      analysisId: AN.helena,
      createdDaysAgo: 58,
      submittedDaysAgo: 57,
      acceptedDaysAgo: 21,
      notes: "Cliente prefere contato pela manhã; filha acompanha.",
    }),
    legalCase({
      id: CS.franciscoBancaria,
      clientId: C.francisco,
      title: "Descontos indevidos e seguro prestamista — Francisco",
      area: "BANKING",
      caseType: "Declaratória c/c repetição de indébito",
      status: "IN_PROGRESS",
      summary: "Descontos de contrato não reconhecido e cobrança de seguro prestamista embutido.",
      createdDaysAgo: 240,
      submittedDaysAgo: 239,
      acceptedDaysAgo: 230,
    }),
    legalCase({
      id: CS.ferragensBancaria,
      clientId: C.ferragens,
      title: "Cédula de crédito e execução — Ferragens Horizonte",
      area: "BANKING",
      caseType: "Revisional de cédula de crédito bancário",
      status: "IN_PROGRESS",
      summary: "Revisão da cédula de crédito e defesa na execução proposta pelo banco.",
      createdDaysAgo: 150,
      submittedDaysAgo: 149,
      acceptedDaysAgo: 140,
    }),
    legalCase({
      id: CS.transportesCobranca,
      clientId: C.transportes,
      title: "Cobrança de fornecedor — Via Sul",
      area: "CIVIL",
      caseType: "Ação de cobrança",
      status: "IN_PROGRESS",
      summary: "Cobrança de serviços de transporte prestados e não pagos.",
      lawyer: U.beatriz,
      createdDaysAgo: 120,
      submittedDaysAgo: 120,
      acceptedDaysAgo: 118,
    }),
    legalCase({
      id: CS.transportesTrabalhista,
      clientId: C.transportes,
      title: "Defesa trabalhista — ex-motorista",
      area: "LABOR",
      caseType: "Reclamação trabalhista (defesa)",
      status: "IN_PROGRESS",
      summary: "Defesa da empresa em reclamação de ex-motorista.",
      lawyer: U.beatriz,
      createdDaysAgo: 90,
      submittedDaysAgo: 90,
      acceptedDaysAgo: 89,
    }),
    legalCase({
      id: CS.pedroVeiculo,
      clientId: C.pedro,
      title: "Financiamento de veículo — Pedro",
      area: "BANKING",
      caseType: "Revisional de financiamento",
      status: "CLOSED",
      summary: "Revisional do financiamento de veículo, encerrada com acordo.",
      lawyer: U.beatriz,
      createdDaysAgo: 400,
      submittedDaysAgo: 400,
      acceptedDaysAgo: 395,
      closedDaysAgo: 30,
    }),
    legalCase({
      id: CS.pedroCartaoLoja,
      clientId: C.pedro,
      title: "Cartão de loja — Pedro",
      area: "CONSUMER",
      caseType: "Revisional de cartão de loja",
      status: "REJECTED",
      summary: "Cliente pediu revisão de juros de cartão de loja já quitado.",
      lawyer: null,
      createdDaysAgo: 20,
      submittedDaysAgo: 19,
      rejectedDaysAgo: 15,
      rejectionReasonPublic: "Não identificamos fundamento para prosseguir com a demanda.",
      rejectionReasonInternal: "Valor envolvido inferior ao custo do processo; contrato quitado há mais de 5 anos.",
    }),
    legalCase({
      id: CS.luizaTelefonia,
      clientId: C.luiza,
      title: "Cobrança indevida em telefonia — Luiza",
      area: "CONSUMER",
      caseType: "Indenizatória",
      status: "IN_PROGRESS",
      summary: "Cobranças por serviços não contratados na linha telefônica.",
      lawyer: U.beatriz,
      createdDaysAgo: 80,
      submittedDaysAgo: 80,
      acceptedDaysAgo: 78,
    }),
    legalCase({
      id: CS.luizaBancaria,
      clientId: C.luiza,
      title: "Revisão de contrato bancário — Luiza",
      area: "BANKING",
      caseType: "Revisional de contrato bancário",
      status: "WAITING_DOCUMENTS",
      summary: "Análise interrompida: contrato apresentado diverge do extrato.",
      analysisId: AN.luiza,
      lawyer: U.beatriz,
      createdDaysAgo: 12,
      submittedDaysAgo: 12,
    }),
    legalCase({
      id: CS.joaoCredito,
      clientId: C.joao,
      title: "Crédito pessoal — João",
      area: "BANKING",
      caseType: "Revisional de crédito pessoal",
      status: "IN_PROGRESS",
      summary: "Revisional de crédito pessoal; processo suspenso aguardando tema repetitivo.",
      createdDaysAgo: 300,
      submittedDaysAgo: 300,
      acceptedDaysAgo: 295,
    }),
    legalCase({
      id: CS.joaoDescontos,
      clientId: C.joao,
      title: "Descontos não reconhecidos — João",
      area: "BANKING",
      caseType: "Declaratória de inexistência de débito",
      status: "WAITING_DOCUMENTS",
      summary: "Descontos em benefício que o cliente não reconhece. Aguardando extrato e contrato.",
      analysisId: AN.joao,
      createdDaysAgo: 9,
      submittedDaysAgo: 9,
    }),
    legalCase({
      id: CS.clinicaTributario,
      clientId: C.clinica,
      title: "Contribuição previdenciária — Clínica",
      area: "TAX",
      caseType: "Mandado de segurança",
      status: "IN_PROGRESS",
      summary: "Discussão de contribuição incidente sobre verbas indenizatórias.",
      lawyer: U.beatriz,
      createdDaysAgo: 180,
      submittedDaysAgo: 180,
      acceptedDaysAgo: 175,
    }),
    legalCase({
      id: CS.clinicaBancaria,
      clientId: C.clinica,
      title: "Contratos bancários — Clínica",
      area: "BANKING",
      caseType: "Revisional de contrato bancário",
      status: "WAITING_DOCUMENTS",
      summary: "Revisão de contratos de capital de giro da clínica.",
      analysisId: AN.clinica,
      lawyer: U.beatriz,
      createdDaysAgo: 6,
      submittedDaysAgo: 6,
    }),
    legalCase({
      id: CS.marlenePensao,
      clientId: C.marlene,
      title: "Descontos em pensão — Marlene",
      area: "BANKING",
      caseType: "Declaratória c/c repetição de indébito",
      status: "IN_PROGRESS",
      summary: "Descontos em pensão por contrato não reconhecido; recurso em andamento.",
      lawyer: U.beatriz,
      createdDaysAgo: 200,
      submittedDaysAgo: 200,
      acceptedDaysAgo: 196,
    }),
    legalCase({
      id: CS.marleneEmprestimos,
      clientId: C.marlene,
      title: "Empréstimos consignados — Marlene",
      area: "BANKING",
      caseType: "Revisional de contratos consignados",
      status: "ANALYZING",
      summary: "Novos contratos consignados identificados no extrato do benefício.",
      analysisId: AN.marlene,
      lawyer: U.beatriz,
      createdDaysAgo: 2,
      submittedDaysAgo: 2,
    }),
    legalCase({
      id: CS.robertoCartao,
      clientId: C.roberto,
      title: "Cartão consignado — Roberto",
      area: "BANKING",
      caseType: "Cartão de crédito consignado contratado como empréstimo",
      status: "WAITING_REVIEW",
      summary: "Cliente buscou empréstimo e recebeu cartão com desconto mínimo mensal.",
      analysisId: AN.roberto,
      // Sem advogado: o aceite exige definir o responsável.
      lawyer: null,
      createdDaysAgo: 5,
      submittedDaysAgo: 5,
    }),
    legalCase({
      id: CS.anaSuperendividamento,
      clientId: C.ana,
      title: "Superendividamento — Ana Cláudia",
      area: "CONSUMER",
      caseType: "Repactuação de dívidas (superendividamento)",
      status: "DRAFT",
      summary: "Rascunho: levantar todas as dívidas e a renda mensal antes do envio.",
      lawyer: null,
      createdDaysAgo: 1,
      createdBy: U.renata,
    }),
    legalCase({
      id: CS.panificadoraCapitalGiro,
      clientId: C.panificadora,
      title: "Capital de giro — Padaria Bom Grão",
      area: "BANKING",
      caseType: "Revisional de capital de giro",
      status: "ACCEPTED",
      summary: "Caso aceito; minuta da inicial em preparação. Ainda sem processo judicial.",
      lawyer: U.beatriz,
      createdDaysAgo: 14,
      submittedDaysAgo: 14,
      acceptedDaysAgo: 3,
    }),

    // (a) Origem parceira SEM acesso operacional: indicação do Almeida, operada só pela equipe.
    legalCase({
      id: CS.franciscoIndicacao,
      clientId: C.francisco,
      title: "Cartão consignado (indicação Almeida) — Francisco",
      area: "BANKING",
      caseType: "Cartão de crédito consignado contratado como empréstimo",
      status: "SUBMITTED",
      summary: "Indicação comercial da Almeida Advocacia. O parceiro não opera este caso nem o vê no portal; se aceito, gera divisão de parceria.",
      origin: PO.almeida,
      lawyer: null,
      createdDaysAgo: 3,
      submittedDaysAgo: 3,
    }),

    /* ------------------------- parceiros ------------------------- */
    legalCase({
      id: PCS.sandraRevisional,
      clientId: PC.sandra,
      title: "Revisional de empréstimo consignado — Sandra",
      area: "BANKING",
      caseType: "Revisional de contrato bancário",
      status: "IN_PROGRESS",
      summary: "Contrato consignado com taxa muito acima da média. Cliente já possui processo distribuído.",
      origin: PO.almeida,
      createdByOffice: PO.almeida,
      createdBy: PU.marcos,
      createdDaysAgo: 38,
      submittedDaysAgo: 38,
      acceptedDaysAgo: 37,
      notes: "Nota interna: avaliar pedido de tutela na réplica.",
    }),
    legalCase({
      id: PCS.sandraTarifa,
      clientId: PC.sandra,
      title: "Tarifa de cadastro — Sandra",
      area: "BANKING",
      caseType: "Repetição de indébito",
      status: "REJECTED",
      summary: "Cobrança de tarifa de cadastro em contrato antigo.",
      origin: PO.almeida,
      createdByOffice: PO.almeida,
      createdBy: PU.marcos,
      lawyer: null,
      createdDaysAgo: 16,
      submittedDaysAgo: 16,
      rejectedDaysAgo: 13,
      rejectionReasonPublic: "Documentação insuficiente para prosseguir.",
      rejectionReasonInternal: "Risco elevado: a mesma tarifa já foi discutida em ação anterior (critério interno de admissibilidade).",
    }),
    legalCase({
      id: PCS.otavioConsignado,
      clientId: PC.otavio,
      title: "Descontos de consignado não reconhecidos — Otávio",
      area: "BANKING",
      caseType: "Declaratória de inexistência de débito",
      status: "SUBMITTED",
      summary: "Aposentado relata descontos mensais de consignado que não reconhece. Nunca assinou contrato com o banco.",
      origin: PO.almeida,
      createdByOffice: PO.almeida,
      createdBy: PU.carla,
      lawyer: null,
      opposingParty: "Crediplus Financeira S.A. (fictícia)",
      createdDaysAgo: 0,
      createdAt: minutesAgoISO(26),
      submittedAt: minutesAgoISO(18),
    }),
    legalCase({
      id: PCS.merceariaCapitalGiro,
      clientId: PC.mercearia,
      title: "Capital de giro — Mercearia Boa Vista",
      area: "BANKING",
      caseType: "Revisional de contrato bancário",
      status: "WAITING_DOCUMENTS",
      summary: "Contrato de capital de giro renegociado três vezes. Suspeita de capitalização indevida.",
      // (b) O Almeida opera o caso, mas atribuiu a origem à Bárbara: sem divisão de parceria.
      origin: OFFICE_ID,
      createdByOffice: PO.almeida,
      createdBy: PU.marcos,
      lawyer: U.beatriz,
      createdDaysAgo: 12,
      submittedDaysAgo: 12,
    }),
    legalCase({
      id: PCS.ritaIndenizatoria,
      clientId: PC.rita,
      title: "Negativação indevida — Rita",
      area: "CONSUMER",
      caseType: "Indenizatória",
      status: "IN_PROGRESS",
      summary: "Negativação por dívida já quitada.",
      origin: PO.ferreiraLima,
      createdByOffice: PO.ferreiraLima,
      createdBy: PU.patricia,
      lawyer: U.beatriz,
      createdDaysAgo: 25,
      submittedDaysAgo: 25,
      acceptedDaysAgo: 24,
    }),
    // Mesmo cliente (Helena, origem Bárbara), outro caso, origem Ferreira & Lima.
    legalCase({
      id: PCS.helenaCartao,
      clientId: C.helena,
      title: "Cartão consignado — Helena",
      area: "BANKING",
      caseType: "Declaratória c/c repetição de indébito",
      status: "IN_PROGRESS",
      summary: "Cliente contratou cartão acreditando ser empréstimo.",
      origin: PO.ferreiraLima,
      createdByOffice: PO.ferreiraLima,
      createdBy: PU.patricia,
      createdDaysAgo: 8,
      submittedDaysAgo: 8,
      acceptedDaysAgo: 7,
    }),
  ];
}

/** Processo → caso (cada processo pertence a um caso). */
export const PROCESS_CASE: Record<string, string> = {
  [P.helenaRevisional]: CS.helenaBancaria,
  [P.helenaTarifas]: CS.helenaBancaria,
  [P.franciscoDeclaratoria]: CS.franciscoBancaria,
  [P.franciscoRepeticao]: CS.franciscoBancaria,
  [P.ferragensRevisional]: CS.ferragensBancaria,
  [P.ferragensExecucao]: CS.ferragensBancaria,
  [P.transportesCobranca]: CS.transportesCobranca,
  [P.transportesTrabalhista]: CS.transportesTrabalhista,
  [P.pedroEncerrado]: CS.pedroVeiculo,
  [P.luizaConsumidor]: CS.luizaTelefonia,
  [P.joaoSuspenso]: CS.joaoCredito,
  [P.clinicaTributario]: CS.clinicaTributario,
  [P.marleneRecurso]: CS.marlenePensao,
  [PP.sandraRevisional]: PCS.sandraRevisional,
  [PP.ritaIndenizatoria]: PCS.ritaIndenizatoria,
  [PP.helenaCartao]: PCS.helenaCartao,
};

/** Análise → caso. */
export const ANALYSIS_CASE: Record<string, string> = {
  [AN.helena]: CS.helenaBancaria,
  [AN.joao]: CS.joaoDescontos,
  [AN.roberto]: CS.robertoCartao,
  [AN.marlene]: CS.marleneEmprestimos,
  [AN.luiza]: CS.luizaBancaria,
  [AN.clinica]: CS.clinicaBancaria,
};
