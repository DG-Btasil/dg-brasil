import { daysFromNowISO } from "@/lib/clock";
import type { ReferenceMaterial } from "@/types";
import { A, OFFICE_ID, S, T, U } from "../ids";

/* Referências de demonstração (conteúdo fictício). */
export function buildReferences(): ReferenceMaterial[] {
  const base = { officeId: OFFICE_ID, createdBy: U.barbara, status: "ACTIVE" as const };
  return [
    {
      ...base,
      id: "ref_inicial_revisional",
      title: "Petição inicial revisional — modelo aprovado",
      description: "Inicial revisional de consignado aprovada em revisão, usada como padrão de estrutura e tom.",
      type: "APPROVED_PETITION",
      area: "BANKING",
      file: { name: "inicial-revisional-aprovada.docx", sizeKb: 86 },
      tags: ["consignado", "revisional", "juros"],
      skillIds: [S.peticaoInicial, S.redacaoBancaria],
      thesisIds: [T.juros],
      agentIds: [A.peticoes],
      createdAt: daysFromNowISO(-40),
      updatedAt: daysFromNowISO(-40),
    },
    {
      ...base,
      id: "ref_guia_redacao",
      title: "Guia de redação do escritório",
      description: "Orientações de linguagem: frases curtas, pedidos numerados, sem adjetivação excessiva.",
      type: "INTERNAL_GUIDELINE",
      file: { name: "guia-redacao.pdf", sizeKb: 210 },
      tags: ["estilo", "linguagem"],
      skillIds: [S.redacaoBancaria, S.comunicacaoCliente],
      thesisIds: [],
      agentIds: [A.peticoes, A.revisoes],
      createdAt: daysFromNowISO(-55),
      updatedAt: daysFromNowISO(-12),
    },
    {
      ...base,
      id: "ref_cartao_consignado",
      title: "Notas sobre cartão de crédito consignado",
      description: "Resumo de entendimentos usados na triagem de casos de cartão consignado (material de demonstração).",
      type: "LEGAL_REFERENCE",
      area: "BANKING",
      file: { name: "notas-cartao-consignado.pdf", sizeKb: 140 },
      tags: ["cartão", "RMC"],
      skillIds: [S.triagemContratos],
      thesisIds: [T.cartaoConsignado],
      agentIds: [A.triagem],
      status: "DRAFT",
      createdAt: daysFromNowISO(-6),
      updatedAt: daysFromNowISO(-6),
    },
  ];
}
