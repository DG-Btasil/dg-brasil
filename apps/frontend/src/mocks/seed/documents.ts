import { daysFromNowISO } from "@/lib/clock";
import type { DocumentCategory, DocumentStatus, DocumentVerification } from "@/lib/constants/status";
import type { ClientDocument } from "@/types";
import { C, OFFICE_ID, P, U } from "../ids";

let seq = 0;

function doc(
  clientId: string,
  category: DocumentCategory,
  name: string,
  status: DocumentStatus,
  opts: {
    daysAgo?: number;
    verification?: DocumentVerification;
    fileName?: string;
    sizeKb?: number;
    required?: boolean;
    notes?: string;
    processId?: string;
    uploadedBy?: string;
  } = {},
): ClientDocument {
  seq += 1;
  const received = status !== "MISSING";
  const at = daysFromNowISO(-(opts.daysAgo ?? 5), 10 + (seq % 7), (seq * 7) % 60);
  return {
    id: `doc_${String(seq).padStart(3, "0")}`,
    officeId: OFFICE_ID,
    clientId,
    processId: opts.processId,
    name,
    category,
    status,
    verification: opts.verification ?? (status === "RECEIVED" ? "VERIFIED" : "UNVERIFIED"),
    fileName: received ? (opts.fileName ?? `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`) : undefined,
    sizeKb: received ? (opts.sizeKb ?? 180 + ((seq * 37) % 900)) : undefined,
    uploadedAt: received ? at : undefined,
    uploadedBy: received ? (opts.uploadedBy ?? U.renata) : undefined,
    required: opts.required ?? true,
    notes: opts.notes,
    updatedAt: at,
    visibility: "INTERNAL",
  };
}

export function buildDocuments(): ClientDocument[] {
  seq = 0;
  return [
    // Helena — documentação completa
    doc(C.helena, "IDENTIFICATION", "RG — Helena", "RECEIVED", { daysAgo: 57 }),
    doc(C.helena, "ADDRESS_PROOF", "Comprovante de residência", "RECEIVED", { daysAgo: 57 }),
    doc(C.helena, "LOAN_CONTRACT", "Contrato consignado nº 0001 (fictício)", "RECEIVED", { daysAgo: 55 }),
    doc(C.helena, "BENEFIT_STATEMENT", "Extrato de benefício — últimos 12 meses", "RECEIVED", { daysAgo: 55 }),
    doc(C.helena, "BANK_STATEMENT", "Extrato bancário — conta benefício", "RECEIVED", { daysAgo: 54 }),
    doc(C.helena, "POWER_OF_ATTORNEY", "Procuração assinada", "RECEIVED", { daysAgo: 50 }),
    doc(C.helena, "PETITION", "Petição inicial — revisional", "RECEIVED", {
      daysAgo: 38,
      processId: P.helenaRevisional,
      required: false,
      uploadedBy: U.claudio,
    }),

    // João — faltam contrato e extrato
    doc(C.joao, "IDENTIFICATION", "CNH — João", "RECEIVED", { daysAgo: 8 }),
    doc(C.joao, "ADDRESS_PROOF", "Conta de energia", "NEEDS_UPDATE", {
      daysAgo: 8,
      notes: "Comprovante com mais de 90 dias. Solicitar versão recente.",
    }),
    doc(C.joao, "BENEFIT_STATEMENT", "Extrato de benefício", "PENDING", { daysAgo: 2 }),
    doc(C.joao, "LOAN_CONTRACT", "Contrato do empréstimo", "MISSING"),
    doc(C.joao, "BANK_STATEMENT", "Extrato bancário", "MISSING"),

    // Ana — documentação obrigatória completa, análise não iniciada
    doc(C.ana, "IDENTIFICATION", "RG — Ana Cláudia", "RECEIVED", { daysAgo: 1 }),
    doc(C.ana, "ADDRESS_PROOF", "Comprovante de residência", "RECEIVED", { daysAgo: 1 }),
    doc(C.ana, "LOAN_CONTRACT", "Contrato de crédito pessoal (fictício)", "RECEIVED", { daysAgo: 1 }),
    doc(C.ana, "BANK_STATEMENT", "Extratos bancários — 6 meses", "RECEIVED", { daysAgo: 0 }),
    doc(C.ana, "INCOME_PROOF", "Holerite", "PENDING", { daysAgo: 0, required: false }),

    // Roberto
    doc(C.roberto, "IDENTIFICATION", "RG — Roberto", "RECEIVED", { daysAgo: 20 }),
    doc(C.roberto, "ADDRESS_PROOF", "Comprovante de residência", "RECEIVED", { daysAgo: 20 }),
    doc(C.roberto, "LOAN_CONTRACT", "Contrato de cartão consignado (fictício)", "RECEIVED", { daysAgo: 18 }),
    doc(C.roberto, "BANK_STATEMENT", "Faturas do cartão — 12 meses", "RECEIVED", { daysAgo: 18 }),
    doc(C.roberto, "BENEFIT_STATEMENT", "Extrato de benefício", "RECEIVED", { daysAgo: 18 }),

    // Marlene
    doc(C.marlene, "IDENTIFICATION", "RG — Marlene", "RECEIVED", { daysAgo: 110 }),
    doc(C.marlene, "ADDRESS_PROOF", "Comprovante de residência", "RECEIVED", { daysAgo: 6 }),
    doc(C.marlene, "LOAN_CONTRACT", "Contrato de refinanciamento (fictício)", "RECEIVED", { daysAgo: 4 }),
    doc(C.marlene, "BENEFIT_STATEMENT", "Extrato de pensão", "RECEIVED", { daysAgo: 4 }),
    doc(C.marlene, "BANK_STATEMENT", "Extrato bancário", "RECEIVED", { daysAgo: 3 }),

    // Francisco
    doc(C.francisco, "IDENTIFICATION", "RG — Francisco", "RECEIVED", { daysAgo: 44 }),
    doc(C.francisco, "ADDRESS_PROOF", "Comprovante de residência", "RECEIVED", { daysAgo: 44 }),
    doc(C.francisco, "COURT_DECISION", "Decisão — intimação para réplica", "RECEIVED", {
      daysAgo: 12,
      processId: P.franciscoDeclaratoria,
      required: false,
      uploadedBy: U.claudio,
    }),

    // Luiza — divergência
    doc(C.luiza, "IDENTIFICATION", "RG — Luiza", "RECEIVED", { daysAgo: 33 }),
    doc(C.luiza, "ADDRESS_PROOF", "Comprovante de residência", "RECEIVED", { daysAgo: 33 }),
    doc(C.luiza, "LOAN_CONTRACT", "Contrato apresentado pela cliente", "REJECTED", {
      daysAgo: 30,
      verification: "FAILED",
      notes: "Número e valores divergem do extrato bancário. Solicitar via original ou 2ª via ao banco.",
    }),
    doc(C.luiza, "BANK_STATEMENT", "Extrato bancário", "RECEIVED", { daysAgo: 30 }),

    // Pedro
    doc(C.pedro, "IDENTIFICATION", "CNH — Pedro", "RECEIVED", { daysAgo: 290 }),
    doc(C.pedro, "COURT_DECISION", "Sentença", "RECEIVED", {
      daysAgo: 60,
      processId: P.pedroEncerrado,
      required: false,
    }),

    // Ferragens (PJ)
    doc(C.ferragens, "CORPORATE_DOCUMENTS", "Contrato social consolidado", "RECEIVED", { daysAgo: 148 }),
    doc(C.ferragens, "IDENTIFICATION", "Documento do sócio administrador", "RECEIVED", { daysAgo: 148 }),
    doc(C.ferragens, "LOAN_CONTRACT", "Cédula de crédito bancário (fictícia)", "RECEIVED", { daysAgo: 140 }),
    doc(C.ferragens, "BANK_STATEMENT", "Extratos conta PJ — 12 meses", "RECEIVED", { daysAgo: 140 }),

    // Via Sul (PJ)
    doc(C.transportes, "CORPORATE_DOCUMENTS", "Estatuto e ata de eleição", "RECEIVED", { daysAgo: 190 }),
    doc(C.transportes, "POWER_OF_ATTORNEY", "Procuração", "NEEDS_UPDATE", {
      daysAgo: 190,
      notes: "Procuração vence em 30 dias.",
    }),

    // Panificadora (PJ) — nada recebido
    doc(C.panificadora, "CORPORATE_DOCUMENTS", "Contrato social", "MISSING"),
    doc(C.panificadora, "BANK_STATEMENT", "Extratos conta PJ", "MISSING"),

    // Clínica (PJ) — aguardando documentos
    doc(C.clinica, "IDENTIFICATION", "Documento da sócia administradora", "RECEIVED", { daysAgo: 11 }),
    doc(C.clinica, "LOAN_CONTRACT", "Contrato de capital de giro (fictício)", "RECEIVED", { daysAgo: 10 }),
    doc(C.clinica, "CORPORATE_DOCUMENTS", "Contrato social", "MISSING"),
    doc(C.clinica, "BANK_STATEMENT", "Extratos conta PJ", "MISSING"),
  ];
}
