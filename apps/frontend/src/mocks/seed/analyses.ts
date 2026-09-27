import { daysFromNowISO } from "@/lib/clock";
import type { AnalysisStep, AnalysisStepStatus, LegalAnalysis } from "@/types";
import { A, AN, C, FICTITIOUS_BANKS, OFFICE_ID, P, R, T, TPL, U } from "../ids";

export const ANALYSIS_STEP_KEYS = ["documents", "agent", "review", "conclusion"] as const;
const STEP_LABEL: Record<(typeof ANALYSIS_STEP_KEYS)[number], string> = {
  documents: "Verificação de documentos",
  agent: "Avaliação pelo agente",
  review: "Revisão humana",
  conclusion: "Conclusão",
};

/** Monta as etapas a partir do status de cada uma, na ordem padrão. */
export function buildSteps(statuses: [AnalysisStepStatus, AnalysisStepStatus, AnalysisStepStatus, AnalysisStepStatus], at: (string | undefined)[] = []): AnalysisStep[] {
  return ANALYSIS_STEP_KEYS.map((key, i) => ({ key, label: STEP_LABEL[key], status: statuses[i] ?? "PENDING", at: at[i] }));
}

const agent = (id: string, name: string) => ({ type: "AGENT" as const, id, name });
const user = (id: string, name: string) => ({ type: "USER" as const, id, name });
const TRIAGEM = agent(A.triagem, "Agente de Triagem Bancária");
const DOCS = agent(A.documentacao, "Agente de Documentação");

export function buildAnalyses(): LegalAnalysis[] {
  const o = { officeId: OFFICE_ID, templateId: TPL.bancaria };
  return [
    {
      ...o,
      id: AN.helena,
      clientId: C.helena,
      status: "COMPLETED",
      fields: {
        instituicao: FICTITIOUS_BANKS.meridional,
        tipo_contrato: "consignado",
        numero_contrato: "0001 (fictício)",
        taxa_mensal: "3,9",
        relato: "Cliente relata parcelas elevadas em três contratos consignados e não recebeu cópia dos contratos no ato.",
      },
      missingDocuments: [],
      steps: buildSteps(["DONE", "DONE", "DONE", "DONE"], [daysFromNowISO(-25), daysFromNowISO(-22), daysFromNowISO(-20), daysFromNowISO(-20)]),
      timeline: [
        { id: "ev_h1", at: daysFromNowISO(-25, 10), actor: user(U.rafael, "Dr. Rafael Moura"), message: "Análise bancária iniciada." },
        { id: "ev_h2", at: daysFromNowISO(-22, 10), actor: TRIAGEM, message: "Parecer preliminar concluído e enviado para Revisões." },
        { id: "ev_h3", at: daysFromNowISO(-20, 15), actor: user(U.rafael, "Dr. Rafael Moura"), message: "Resultado aprovado. Processo revisional criado." },
      ],
      startedAt: daysFromNowISO(-25, 10),
      startedBy: U.rafael,
      completedAt: daysFromNowISO(-20, 15),
      result: {
        summary: "Taxas contratadas significativamente acima do parâmetro adotado pelo escritório em dois dos três contratos. Tarifas sem previsão clara no terceiro.",
        identifiedThesisIds: [T.juros, T.tarifas],
        recommendation: "Ajuizar ação revisional para os dois contratos e avaliar ação autônoma sobre tarifas.",
      },
      reviewId: R.analiseHelena,
      processId: P.helenaRevisional,
      createdAt: daysFromNowISO(-25, 10),
      updatedAt: daysFromNowISO(-20, 15),
    },
    {
      ...o,
      id: AN.joao,
      clientId: C.joao,
      status: "WAITING_DOCUMENTS",
      fields: {
        instituicao: FICTITIOUS_BANKS.crediplus,
        tipo_contrato: "consignado",
        relato: "Cliente não reconhece o contrato que gera descontos mensais no benefício desde o início do ano.",
      },
      missingDocuments: ["ADDRESS_PROOF", "LOAN_CONTRACT", "BANK_STATEMENT"],
      steps: buildSteps(["BLOCKED", "PENDING", "PENDING", "PENDING"], [daysFromNowISO(-8)]),
      timeline: [
        { id: "ev_j1", at: daysFromNowISO(-8, 11), actor: user(U.rafael, "Dr. Rafael Moura"), message: "Análise bancária iniciada." },
        { id: "ev_j2", at: daysFromNowISO(-8, 11, 2), actor: DOCS, message: "Faltam contrato do empréstimo e extrato bancário. Comprovante de residência precisa de atualização." },
        { id: "ev_j3", at: daysFromNowISO(-2, 11), actor: DOCS, message: "Extrato de benefício recebido; aguardando verificação." },
      ],
      startedAt: daysFromNowISO(-8, 11),
      startedBy: U.rafael,
      createdAt: daysFromNowISO(-8, 11),
      updatedAt: daysFromNowISO(-2, 11),
    },
    {
      ...o,
      id: AN.roberto,
      clientId: C.roberto,
      status: "WAITING_REVIEW",
      fields: {
        instituicao: FICTITIOUS_BANKS.atlantico,
        tipo_contrato: "cartao_consignado",
        valor_contratado: "4.800,00",
        relato: "Cliente buscou empréstimo e só depois percebeu que se tratava de cartão com desconto mínimo mensal.",
      },
      missingDocuments: [],
      steps: buildSteps(["DONE", "DONE", "CURRENT", "PENDING"], [daysFromNowISO(-6), daysFromNowISO(-2)]),
      timeline: [
        { id: "ev_r1", at: daysFromNowISO(-6, 9), actor: user(U.rafael, "Dr. Rafael Moura"), message: "Análise bancária iniciada." },
        { id: "ev_r2", at: daysFromNowISO(-6, 9, 1), actor: DOCS, message: "Documentação completa." },
        { id: "ev_r3", at: daysFromNowISO(-2, 14), actor: TRIAGEM, message: "Parecer preliminar concluído e enviado para Revisões." },
      ],
      startedAt: daysFromNowISO(-6, 9),
      startedBy: U.rafael,
      reviewId: R.analiseRoberto,
      createdAt: daysFromNowISO(-6, 9),
      updatedAt: daysFromNowISO(-2, 14),
    },
    {
      ...o,
      id: AN.marlene,
      clientId: C.marlene,
      status: "ANALYZING",
      fields: {
        instituicao: FICTITIOUS_BANKS.horizonte,
        tipo_contrato: "consignado",
        relato: "Refinanciamento feito por telefone; a pensionista afirma não ter recebido valor adicional.",
      },
      missingDocuments: [],
      steps: buildSteps(["DONE", "CURRENT", "PENDING", "PENDING"], [daysFromNowISO(0, 8, 45)]),
      timeline: [
        { id: "ev_m1", at: daysFromNowISO(0, 8, 45), actor: user(U.beatriz, "Dra. Beatriz Nogueira"), message: "Análise bancária iniciada." },
        { id: "ev_m2", at: daysFromNowISO(0, 8, 46), actor: DOCS, message: "Documentação completa." },
        { id: "ev_m3", at: daysFromNowISO(0, 8, 50), actor: TRIAGEM, message: "Avaliação do material iniciada." },
      ],
      startedAt: daysFromNowISO(0, 8, 45),
      startedBy: U.beatriz,
      createdAt: daysFromNowISO(0, 8, 45),
      updatedAt: daysFromNowISO(0, 8, 50),
    },
    {
      ...o,
      id: AN.luiza,
      clientId: C.luiza,
      status: "INTERRUPTED",
      fields: {
        instituicao: FICTITIOUS_BANKS.serrano,
        tipo_contrato: "pessoal",
        relato: "Cliente questiona o valor das parcelas de crédito pessoal.",
      },
      missingDocuments: ["LOAN_CONTRACT"],
      steps: buildSteps(["BLOCKED", "PENDING", "PENDING", "PENDING"], [daysFromNowISO(-30)]),
      timeline: [
        { id: "ev_l1", at: daysFromNowISO(-30, 10), actor: user(U.beatriz, "Dra. Beatriz Nogueira"), message: "Análise bancária iniciada." },
        { id: "ev_l2", at: daysFromNowISO(-3, 10, 20), actor: DOCS, message: "Contrato apresentado diverge do extrato (número e valores)." },
        { id: "ev_l3", at: daysFromNowISO(-3, 10, 40), actor: user(U.beatriz, "Dra. Beatriz Nogueira"), message: "Análise interrompida até o recebimento do contrato correto." },
      ],
      startedAt: daysFromNowISO(-30, 10),
      startedBy: U.beatriz,
      interruptionReason: "Contrato apresentado diverge do extrato bancário. Aguardando via original ou 2ª via emitida pelo banco.",
      createdAt: daysFromNowISO(-30, 10),
      updatedAt: daysFromNowISO(-3, 10, 40),
    },
    {
      ...o,
      id: AN.clinica,
      clientId: C.clinica,
      status: "WAITING_DOCUMENTS",
      fields: {
        instituicao: FICTITIOUS_BANKS.meridional,
        tipo_contrato: "ccb",
        valor_contratado: "180.000,00",
        relato: "Capital de giro com encargos que a clínica considera superiores ao contratado.",
      },
      missingDocuments: ["CORPORATE_DOCUMENTS", "BANK_STATEMENT"],
      steps: buildSteps(["BLOCKED", "PENDING", "PENDING", "PENDING"], [daysFromNowISO(-10)]),
      timeline: [
        { id: "ev_c1", at: daysFromNowISO(-10, 15), actor: user(U.beatriz, "Dra. Beatriz Nogueira"), message: "Análise bancária iniciada." },
        { id: "ev_c2", at: daysFromNowISO(-10, 15, 1), actor: DOCS, message: "Faltam contrato social e extratos da conta PJ." },
      ],
      startedAt: daysFromNowISO(-10, 15),
      startedBy: U.beatriz,
      createdAt: daysFromNowISO(-10, 15),
      updatedAt: daysFromNowISO(-1, 9),
    },
  ];
}
