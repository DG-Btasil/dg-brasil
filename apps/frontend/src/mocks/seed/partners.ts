import { dateFromNow, daysFromNowISO, now } from "@/lib/clock";
import { DEMO_LEGAL_DISCLAIMER } from "@/lib/constants/legal";
import type {
  ActorRef,
  AuditEvent,
  Client,
  ClientDocument,
  ClientOfficeRelationship,
  Invitation,
  Notification,
  PartnerOffice,
  PartnerRequest,
  Process,
  ProcessEvent,
  CasePartnershipAgreement,
  Review,
  User,
} from "@/types";
import type { DocumentCategory, DocumentStatus } from "@/lib/constants/status";
import { A, C, FICTITIOUS_BANKS, OFFICE_ID, PC, PCS, PO, PP, PR, PU, S, U } from "../ids";

/*
 * Escritórios parceiros, usuários, clientes e casos — TODOS FICTÍCIOS.
 * Nomes, OABs, CNPJs, CPFs e contatos não correspondem a pessoas reais.
 */

const o = { officeId: OFFICE_ID };

/** Minutos atrás, em ISO (para "enviado há 18 minutos"). */
function minutesAgoISO(minutes: number): string {
  return new Date(now().getTime() - minutes * 60_000).toISOString();
}

/* ------------------------------------------------------------------ */
/* Escritórios                                                         */
/* ------------------------------------------------------------------ */

export function buildPartnerOffices(): PartnerOffice[] {
  return [
    {
      ...o,
      id: PO.almeida,
      name: "Almeida Advocacia",
      legalName: "Almeida Sociedade de Advogados (fictícia)",
      cnpj: "00.300.400/0001-10",
      responsibleName: "Marcos Almeida",
      responsibleOab: "000.401",
      oabState: "MG",
      email: "contato@almeida.exemplo",
      phone: "(31) 3000-4100",
      address: { zipCode: "30100-000", street: "Rua dos Exemplos", number: "410", district: "Funcionários", city: "Belo Horizonte", state: "MG", country: "Brasil" },
      status: "ACTIVE",
      partnershipPercentage: 50,
      ownerPercentage: 50,
      createdAt: daysFromNowISO(-45, 9),
      updatedAt: daysFromNowISO(-45, 9),
      activatedAt: daysFromNowISO(-44, 11),
      notes: "Parceria focada em consignados de aposentados na região metropolitana de BH.",
    },
    {
      ...o,
      id: PO.ferreiraLima,
      name: "Ferreira & Lima Advogados",
      legalName: "Ferreira & Lima Advogados Associados (fictícia)",
      cnpj: "00.500.600/0001-20",
      responsibleName: "Patrícia Lima",
      responsibleOab: "000.502",
      oabState: "PR",
      email: "contato@ferreiralima.exemplo",
      phone: "(41) 3000-5200",
      address: { zipCode: "80000-000", street: "Avenida Fictícia", number: "52", district: "Centro", city: "Curitiba", state: "PR", country: "Brasil" },
      status: "ACTIVE",
      partnershipPercentage: 60,
      ownerPercentage: 40,
      createdAt: daysFromNowISO(-30, 10),
      updatedAt: daysFromNowISO(-30, 10),
      activatedAt: daysFromNowISO(-29, 16),
    },
    {
      ...o,
      id: PO.costa,
      name: "Costa Jurídico",
      responsibleName: "Eduardo Costa",
      responsibleOab: "000.603",
      oabState: "SP",
      email: "eduardo@costajuridico.exemplo",
      phone: "(11) 3000-6300",
      status: "PENDING_INVITE",
      partnershipPercentage: 50,
      ownerPercentage: 50,
      createdAt: daysFromNowISO(-3, 15),
      updatedAt: daysFromNowISO(-3, 15),
    },
    {
      ...o,
      id: PO.nogueira,
      name: "Nogueira Prado Advocacia",
      responsibleName: "Sílvia Prado",
      responsibleOab: "000.704",
      oabState: "RJ",
      email: "contato@nogueiraprado.exemplo",
      phone: "(21) 3000-7400",
      status: "INACTIVE",
      partnershipPercentage: 30,
      ownerPercentage: 70,
      createdAt: daysFromNowISO(-160, 10),
      updatedAt: daysFromNowISO(-40, 10),
      activatedAt: daysFromNowISO(-158, 10),
      notes: "Parceria encerrada por decisão do parceiro. Mantida para histórico.",
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Usuários dos parceiros                                              */
/* ------------------------------------------------------------------ */

export function buildPartnerUsers(): User[] {
  const base = { ...o, hasCompletedTour: true };
  return [
    {
      ...base,
      id: PU.marcos,
      partnerOfficeId: PO.almeida,
      name: "Marcos Almeida",
      displayName: "Dr. Marcos",
      email: "marcos@almeida.exemplo",
      role: "PARTNER_ADMIN",
      title: "Sócio responsável",
      oab: "OAB/MG 000.401",
      status: "ACTIVE",
      lastAccessAt: daysFromNowISO(0, 9, 12),
      createdAt: daysFromNowISO(-44, 11),
    },
    {
      ...base,
      id: PU.carla,
      partnerOfficeId: PO.almeida,
      name: "Carla Souza",
      displayName: "Carla",
      email: "carla@almeida.exemplo",
      role: "PARTNER_USER",
      title: "Assistente jurídica",
      status: "ACTIVE",
      lastAccessAt: daysFromNowISO(0, 8, 50),
      createdAt: daysFromNowISO(-40, 9),
    },
    {
      ...base,
      id: PU.patricia,
      partnerOfficeId: PO.ferreiraLima,
      name: "Patrícia Lima",
      displayName: "Dra. Patrícia",
      email: "patricia@ferreiralima.exemplo",
      role: "PARTNER_ADMIN",
      title: "Sócia",
      oab: "OAB/PR 000.502",
      status: "ACTIVE",
      lastAccessAt: daysFromNowISO(-1, 17, 5),
      createdAt: daysFromNowISO(-29, 16),
    },
    {
      ...base,
      id: PU.rodrigo,
      partnerOfficeId: PO.ferreiraLima,
      name: "Rodrigo Ferreira",
      displayName: "Rodrigo",
      email: "rodrigo@ferreiralima.exemplo",
      role: "PARTNER_USER",
      title: "Advogado",
      oab: "OAB/PR 000.503",
      status: "ACTIVE",
      lastAccessAt: daysFromNowISO(-2, 10, 0),
      createdAt: daysFromNowISO(-28, 10),
    },
    {
      ...base,
      id: PU.eduardo,
      partnerOfficeId: PO.costa,
      name: "Eduardo Costa",
      displayName: "Dr. Eduardo",
      email: "eduardo@costajuridico.exemplo",
      role: "PARTNER_ADMIN",
      title: "Advogado titular",
      oab: "OAB/SP 000.603",
      status: "INVITED",
      createdAt: daysFromNowISO(-3, 15),
    },
    {
      ...base,
      id: PU.silvia,
      partnerOfficeId: PO.nogueira,
      name: "Sílvia Prado",
      displayName: "Dra. Sílvia",
      email: "silvia@nogueiraprado.exemplo",
      role: "PARTNER_ADMIN",
      title: "Sócia",
      status: "DISABLED",
      createdAt: daysFromNowISO(-158, 10),
    },
  ];
}

export function buildPartnerInvitations(): Invitation[] {
  return [
    {
      ...o,
      id: "inv_p_eduardo",
      token: "demo-convite-parceiro",
      email: "eduardo@costajuridico.exemplo",
      name: "Eduardo Costa",
      role: "PARTNER_ADMIN",
      partnerOfficeId: PO.costa,
      invitedBy: U.barbara,
      createdAt: daysFromNowISO(-3, 15),
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Clientes criados por parceiros (registro canônico)                  */
/* ------------------------------------------------------------------ */

export function buildPartnerClients(): Client[] {
  return [
    {
      ...o,
      kind: "INDIVIDUAL",
      id: PC.sandra,
      status: "ACTIVE",
      fullName: "Sandra Regina Mello",
      cpf: "000.801.902-11",
      birthDate: "1958-11-04",
      nationality: "Brasileira",
      maritalStatus: "DIVORCED",
      profession: "Professora aposentada",
      responsibleUserId: U.claudio,
      contact: { email: "sandra.mello@email.exemplo", phone: "(31) 99000-8011" },
      address: { zipCode: "30200-000", street: "Rua Exemplo das Flores", number: "12", district: "Floresta", city: "Belo Horizonte", state: "MG", country: "Brasil" },
      notes: "Anotação interna: cliente sensível a ligações; preferir e-mail.",
      originOfficeId: PO.almeida,
      createdByOfficeId: PO.almeida,
      createdAt: daysFromNowISO(-38, 10),
      updatedAt: daysFromNowISO(-5, 9),
    },
    {
      ...o,
      kind: "INDIVIDUAL",
      id: PC.otavio,
      status: "NEW",
      fullName: "Otávio Ferreira Neves",
      cpf: "000.812.903-22",
      birthDate: "1956-02-19",
      nationality: "Brasileiro",
      maritalStatus: "MARRIED",
      profession: "Metalúrgico aposentado",
      responsibleUserId: U.claudio,
      contact: { email: "otavio.neves@email.exemplo", phone: "(31) 99000-8122" },
      address: { zipCode: "32000-000", street: "Rua das Amostras", number: "300", district: "Eldorado", city: "Contagem", state: "MG", country: "Brasil" },
      originOfficeId: PO.almeida,
      createdByOfficeId: PO.almeida,
      createdAt: minutesAgoISO(26),
      updatedAt: minutesAgoISO(18),
    },
    {
      ...o,
      kind: "COMPANY",
      id: PC.mercearia,
      status: "WAITING_DOCUMENTS",
      legalName: "Mercearia Boa Vista Ltda. (fictícia)",
      tradeName: "Mercearia Boa Vista",
      cnpj: "00.823.904/0001-33",
      responsibleUserId: U.beatriz,
      contact: { email: "financeiro@boavista.exemplo" },
      representatives: [{ id: "rep_bv_1", name: "José Antônio Vieira", cpf: "000.823.905-44", role: "Sócio administrador", isPrimary: true }],
      partners: [],
      originOfficeId: PO.almeida,
      createdByOfficeId: PO.almeida,
      createdAt: daysFromNowISO(-12, 14),
      updatedAt: daysFromNowISO(-4, 10),
    },
    {
      ...o,
      kind: "INDIVIDUAL",
      id: PC.rita,
      status: "ACTIVE",
      fullName: "Rita de Cássia Carvalho",
      cpf: "000.834.905-55",
      nationality: "Brasileira",
      profession: "Comerciante",
      responsibleUserId: U.beatriz,
      contact: { email: "rita.carvalho@email.exemplo", phone: "(41) 99000-8344" },
      address: { zipCode: "80200-000", street: "Rua Modelo", number: "77", district: "Batel", city: "Curitiba", state: "PR", country: "Brasil" },
      originOfficeId: PO.ferreiraLima,
      createdByOfficeId: PO.ferreiraLima,
      createdAt: daysFromNowISO(-25, 11),
      updatedAt: daysFromNowISO(-9, 11),
    },
  ];
}

/**
 * Relacionamentos cliente ↔ escritório. Cada cliente do seed interno ganha
 * o relacionamento OWNER; os clientes de parceiros ganham o do parceiro (e,
 * como a Bárbara opera todos os casos, também o OWNER).
 * Helena é o exemplo de cliente canônico compartilhado: cliente própria da
 * Bárbara que depois recebeu um caso originado pela Ferreira & Lima.
 */
export function buildClientRelationships(ownerClientIds: string[]): ClientOfficeRelationship[] {
  const owner = (clientId: string, days: number): ClientOfficeRelationship => ({
    ...o,
    id: `rel_owner_${clientId}`,
    clientId,
    officeType: "OWNER",
    status: "ACTIVE",
    createdAt: daysFromNowISO(-days),
    createdBy: U.barbara,
  });
  const partner = (clientId: string, partnerOfficeId: string, createdBy: string, at: string): ClientOfficeRelationship => ({
    ...o,
    id: `rel_${partnerOfficeId}_${clientId}`,
    clientId,
    officeType: "PARTNER",
    partnerOfficeId,
    status: "ACTIVE",
    createdAt: at,
    createdBy,
  });
  return [
    ...ownerClientIds.map((id) => owner(id, 60)),
    owner(PC.sandra, 38),
    owner(PC.otavio, 0),
    owner(PC.mercearia, 12),
    owner(PC.rita, 25),
    partner(PC.sandra, PO.almeida, PU.marcos, daysFromNowISO(-38, 10)),
    partner(PC.otavio, PO.almeida, PU.carla, minutesAgoISO(26)),
    partner(PC.mercearia, PO.almeida, PU.marcos, daysFromNowISO(-12, 14)),
    partner(PC.rita, PO.ferreiraLima, PU.patricia, daysFromNowISO(-25, 11)),
    partner(C.helena, PO.ferreiraLima, PU.patricia, daysFromNowISO(-8, 15)),
  ];
}

/* ------------------------------------------------------------------ */
/* Processos originados por parceiros                                  */
/* ------------------------------------------------------------------ */

export function buildPartnerProcesses(): Process[] {
  const partnerProcess = (p: Omit<Process, "officeId">): Process => ({ ...o, ...p });
  return [
    partnerProcess({
      id: PP.sandraRevisional,
      legalCaseId: PCS.sandraRevisional,
      clientId: PC.sandra,
      cnj: "0004410-22.2026.8.13.0000",
      title: "Revisional de empréstimo consignado",
      court: "TJMG",
      unit: "5ª Vara Cível (fictícia)",
      district: "Belo Horizonte",
      state: "MG",
      area: "BANKING",
      actionType: "Ação revisional de contrato bancário",
      subject: "Juros remuneratórios",
      clientPole: "ACTIVE",
      opposingParty: FICTITIOUS_BANKS.horizonte,
      responsibleUserId: U.claudio,
      distributionDate: dateFromNow(-30),
      caseValue: 20000,
      economicEstimate: 14000,
      status: "ACTIVE",
      phase: "PLEADINGS",
      origin: "MANUAL",
      summary: "Revisão de contrato consignado com taxa acima do parâmetro.",
      notes: "Nota interna: avaliar pedido de tutela na réplica.",
      lastMovementAt: daysFromNowISO(-1, 16),
      createdAt: daysFromNowISO(-37, 10),
      updatedAt: daysFromNowISO(-1, 16),
    }),
    partnerProcess({
      id: PP.ritaIndenizatoria,
      legalCaseId: PCS.ritaIndenizatoria,
      clientId: PC.rita,
      cnj: "0008820-35.2026.8.16.0000",
      title: "Indenizatória por negativação indevida",
      court: "TJPR",
      unit: "12º Juizado Especial Cível (fictício)",
      district: "Curitiba",
      state: "PR",
      area: "CONSUMER",
      actionType: "Ação indenizatória",
      clientPole: "ACTIVE",
      opposingParty: FICTITIOUS_BANKS.serrano,
      responsibleUserId: U.beatriz,
      distributionDate: dateFromNow(-20),
      caseValue: 15000,
      status: "ACTIVE",
      phase: "EVIDENCE",
      origin: "INTEGRATION",
      summary: "Audiência de instrução designada.",
      lastMovementAt: daysFromNowISO(-6, 11),
      createdAt: daysFromNowISO(-24, 11),
      updatedAt: daysFromNowISO(-6, 11),
    }),
    // Helena é cliente de origem Bárbara (caso próprio com 2 processos). Este processo
    // pertence a OUTRO caso dela, originado pela Ferreira & Lima (com parceria).
    partnerProcess({
      id: PP.helenaCartao,
      legalCaseId: PCS.helenaCartao,
      cnj: "0012345-11.2026.8.26.0000",
      court: "TJSP",
      district: "Ribeirão Preto",
      state: "SP",
      distributionDate: dateFromNow(-2),
      clientId: C.helena,
      title: "Cartão consignado contratado como empréstimo",
      area: "BANKING",
      actionType: "Ação declaratória c/c repetição de indébito",
      clientPole: "ACTIVE",
      opposingParty: FICTITIOUS_BANKS.crediplus,
      responsibleUserId: U.claudio,
      caseValue: 12000,
      status: "FILED",
      phase: "PLEADINGS",
      origin: "MANUAL",
      summary: "Processo do caso originado pela Ferreira & Lima para cliente já atendida pelo escritório.",
      lastMovementAt: daysFromNowISO(-8, 15),
      createdAt: daysFromNowISO(-8, 15),
      updatedAt: daysFromNowISO(-8, 15),
    }),
  ];
}

export function buildPartnerProcessEvents(): ProcessEvent[] {
  let seq = 0;
  const ev = (processId: string, at: string, title: string, source: ProcessEvent["source"], description?: string, important = false): ProcessEvent => {
    seq += 1;
    return { ...o, id: `mov_p_${String(seq).padStart(3, "0")}`, processId, at, title, description, source, important };
  };
  return [
    ev(PP.sandraRevisional, daysFromNowISO(-37, 10), "Processo cadastrado (caso da Almeida Advocacia)", "SYSTEM"),
    ev(PP.sandraRevisional, daysFromNowISO(-30, 14), "Distribuído por sorteio", "COURT"),
    ev(PP.sandraRevisional, daysFromNowISO(-12, 11), "Juntada de contestação", "COURT", "Contestação apresentada pela parte ré."),
    ev(PP.sandraRevisional, daysFromNowISO(-9, 10), "Nota interna: estratégia de réplica", "AGENT", "Sugestões preliminares do agente (uso interno)."),
    ev(PP.sandraRevisional, daysFromNowISO(-1, 16), "Intimação para réplica", "COURT", "Prazo de 15 dias para manifestação.", true),
    ev(PP.ritaIndenizatoria, daysFromNowISO(-24, 11), "Processo cadastrado (caso da Ferreira & Lima)", "SYSTEM"),
    ev(PP.ritaIndenizatoria, daysFromNowISO(-20, 9), "Distribuído", "INTEGRATION"),
    ev(PP.ritaIndenizatoria, daysFromNowISO(-6, 11), "Audiência de instrução designada", "COURT", undefined, true),
    ev(PP.helenaCartao, daysFromNowISO(-8, 15), "Processo cadastrado (caso da Ferreira & Lima)", "SYSTEM"),
  ];
}

/* ------------------------------------------------------------------ */
/* Documentos                                                          */
/* ------------------------------------------------------------------ */

export function buildPartnerDocuments(): ClientDocument[] {
  const partnerDoc = (
    id: string,
    clientId: string,
    processId: string | undefined,
    partnerOfficeId: string,
    uploadedBy: string,
    category: DocumentCategory,
    name: string,
    at: string,
    opts: { status?: DocumentStatus; versionGroupId?: string; version?: number; supersededAt?: string } = {},
  ): ClientDocument => ({
    ...o,
    id,
    clientId,
    processId,
    name,
    category,
    status: opts.status ?? "RECEIVED",
    verification: opts.status === "PENDING" ? "UNVERIFIED" : "VERIFIED",
    fileName: `${name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-")}.pdf`,
    sizeKb: 240 + (id.length * 37) % 700,
    uploadedAt: at,
    uploadedBy,
    required: true,
    updatedAt: at,
    visibility: "PARTNER_VISIBLE",
    uploadedByPartnerOfficeId: partnerOfficeId,
    submittedAt: at,
    versionGroupId: opts.versionGroupId ?? id,
    version: opts.version ?? 1,
    supersededAt: opts.supersededAt,
  });
  const otavioAt = minutesAgoISO(19);
  // Documentos do parceiro pertencem ao CASO (e ao processo, quando já existe).
  const CASE_BY_CLIENT: Record<string, string> = {
    [PC.otavio]: PCS.otavioConsignado,
    [PC.mercearia]: PCS.merceariaCapitalGiro,
    [PC.sandra]: PCS.sandraRevisional,
    [PC.rita]: PCS.ritaIndenizatoria,
    [C.helena]: PCS.helenaCartao,
  };
  const docs: ClientDocument[] = [
    partnerDoc("doc_p_01", PC.otavio, undefined, PO.almeida, PU.carla, "IDENTIFICATION", "RG — Otávio", otavioAt, { status: "PENDING" }),
    partnerDoc("doc_p_02", PC.otavio, undefined, PO.almeida, PU.carla, "ADDRESS_PROOF", "Comprovante de residência — Otávio", otavioAt, { status: "PENDING" }),
    partnerDoc("doc_p_03", PC.otavio, undefined, PO.almeida, PU.carla, "BENEFIT_STATEMENT", "Extrato de benefício INSS", otavioAt, { status: "PENDING" }),
    partnerDoc("doc_p_04", PC.otavio, undefined, PO.almeida, PU.carla, "BANK_STATEMENT", "Extrato bancário — últimos 6 meses", otavioAt, { status: "PENDING" }),
    partnerDoc("doc_p_05", PC.otavio, undefined, PO.almeida, PU.carla, "POWER_OF_ATTORNEY", "Procuração", otavioAt, { status: "PENDING" }),
    partnerDoc("doc_p_06", PC.otavio, undefined, PO.almeida, PU.carla, "HARDSHIP_DECLARATION", "Declaração de hipossuficiência", otavioAt, { status: "PENDING" }),
    partnerDoc("doc_p_07", PC.sandra, PP.sandraRevisional, PO.almeida, PU.marcos, "IDENTIFICATION", "RG — Sandra", daysFromNowISO(-38, 10)),
    partnerDoc("doc_p_08", PC.sandra, PP.sandraRevisional, PO.almeida, PU.marcos, "LOAN_CONTRACT", "Contrato de empréstimo consignado", daysFromNowISO(-38, 10)),
    // Versionamento: a v1 da procuração foi substituída pela v2, mas continua preservada.
    partnerDoc("doc_p_09", PC.sandra, PP.sandraRevisional, PO.almeida, PU.marcos, "POWER_OF_ATTORNEY", "Procuração", daysFromNowISO(-38, 10), {
      versionGroupId: "doc_p_09",
      version: 1,
      supersededAt: daysFromNowISO(-20, 9),
    }),
    partnerDoc("doc_p_10", PC.sandra, PP.sandraRevisional, PO.almeida, PU.marcos, "POWER_OF_ATTORNEY", "Procuração", daysFromNowISO(-20, 9), {
      versionGroupId: "doc_p_09",
      version: 2,
    }),
    partnerDoc("doc_p_11", PC.mercearia, undefined, PO.almeida, PU.marcos, "CORPORATE_DOCUMENTS", "Contrato social consolidado", daysFromNowISO(-12, 14)),
    partnerDoc("doc_p_12", PC.rita, PP.ritaIndenizatoria, PO.ferreiraLima, PU.patricia, "IDENTIFICATION", "RG — Rita", daysFromNowISO(-25, 11)),
    partnerDoc("doc_p_13", C.helena, PP.helenaCartao, PO.ferreiraLima, PU.patricia, "LOAN_CONTRACT", "Contrato de cartão consignado", daysFromNowISO(-8, 15)),
    // Documento interno do caso da Sandra: nunca chega ao parceiro.
    {
      ...o,
      id: "doc_p_int_01",
      clientId: PC.sandra,
      processId: PP.sandraRevisional,
      name: "Parecer interno de viabilidade",
      category: "OTHER",
      status: "RECEIVED",
      verification: "VERIFIED",
      fileName: "parecer-interno-viabilidade.pdf",
      sizeKb: 180,
      uploadedAt: daysFromNowISO(-35, 10),
      uploadedBy: U.claudio,
      required: false,
      notes: "Uso interno — não compartilhar.",
      updatedAt: daysFromNowISO(-35, 10),
      visibility: "INTERNAL",
    },
    // Petição inicial aprovada internamente e disponibilizada ao parceiro.
    {
      ...o,
      id: "doc_p_shared_01",
      clientId: PC.sandra,
      processId: PP.sandraRevisional,
      name: "Petição inicial — versão aprovada",
      category: "PETITION",
      status: "RECEIVED",
      verification: "VERIFIED",
      fileName: "peticao-inicial-sandra-aprovada.pdf",
      sizeKb: 320,
      uploadedAt: daysFromNowISO(-31, 17),
      uploadedBy: U.claudio,
      required: false,
      updatedAt: daysFromNowISO(-31, 17),
      visibility: "PARTNER_VISIBLE",
      approvedContent: {
        title: "Petição inicial — Ação revisional de contrato bancário",
        version: 2,
        approvedAt: daysFromNowISO(-31, 16),
        sections: [
          { heading: "Dos fatos", body: "A autora celebrou contrato de empréstimo consignado com taxa de juros significativamente superior à média de mercado divulgada para o período." },
          { heading: "Do direito", body: "Fundamentação resumida para fins de demonstração." },
          { heading: "Dos pedidos", body: "Revisão da taxa contratada e restituição dos valores pagos a maior, na forma a ser apurada." },
        ],
      },
    },
  ];
  return docs.map((d) => ({ ...d, legalCaseId: CASE_BY_CLIENT[d.clientId] }));
}

/* ------------------------------------------------------------------ */
/* Revisão interna em andamento (conteúdo nunca chega ao parceiro)     */
/* ------------------------------------------------------------------ */

export function buildPartnerReviews(): Review[] {
  return [
    {
      ...o,
      id: "rev_p_replica_sandra",
      title: "Minuta de réplica — Sandra Regina Mello",
      type: "PETITION_DRAFT",
      status: "PENDING",
      priority: "HIGH",
      clientId: PC.sandra,
      legalCaseId: PCS.sandraRevisional,
      processId: PP.sandraRevisional,
      agentId: A.peticoes,
      skillIds: [S.redacaoBancaria],
      consultedDocumentIds: ["doc_p_08"],
      summary: "Minuta de réplica elaborada a partir da contestação juntada no caso enviado pela Almeida Advocacia.",
      evidence: ["Contestação não impugna especificamente a taxa aplicada.", "Contrato juntado pela parte autora comprova a taxa pactuada."],
      proposedActions: ["Aprovar a minuta para protocolo manual.", "Disponibilizar a versão aprovada ao parceiro."],
      nextStepOnApproval: "a minuta será marcada como aprovada e poderá ser disponibilizada ao parceiro",
      content: {
        title: "Réplica à contestação",
        sections: [
          { heading: "Síntese da contestação", body: "A parte ré sustenta a regularidade da taxa pactuada e a ausência de abusividade." },
          { heading: "Impugnação", body: "A taxa contratada supera substancialmente a média de mercado do período (argumentação fictícia para demonstração)." },
          { heading: "Requerimentos", body: "Reiteração dos pedidos iniciais e produção de prova pericial contábil." },
        ],
        disclaimer: DEMO_LEGAL_DISCLAIMER,
      },
      contentVersion: 1,
      assignedUserId: U.claudio,
      createdAt: daysFromNowISO(-1, 17),
      dueAt: daysFromNowISO(5, 18),
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Solicitações (PartnerRequest)                                       */
/* ------------------------------------------------------------------ */

const beatrizActor: ActorRef = { type: "USER", id: U.beatriz, name: "Beatriz Nogueira" };
const claudioActor: ActorRef = { type: "USER", id: U.claudio, name: "Cláudio" };

export function buildPartnerRequests(): PartnerRequest[] {
  return [
    {
      ...o,
      id: PR.merceariaExtrato,
      partnerOfficeId: PO.almeida,
      clientId: PC.mercearia,
      legalCaseId: PCS.merceariaCapitalGiro,
      type: "DOCUMENT_REQUEST",
      title: "Extrato bancário dos últimos 12 meses",
      description: "Precisamos do extrato bancário dos últimos 12 meses da conta vinculada ao contrato de capital de giro.",
      status: "OPEN",
      createdBy: beatrizActor,
      createdAt: daysFromNowISO(-4, 10),
      dueDate: dateFromNow(3),
      messages: [],
      updatedAt: daysFromNowISO(-4, 10),
    },
    {
      ...o,
      id: PR.merceariaCadastro,
      partnerOfficeId: PO.almeida,
      clientId: PC.mercearia,
      legalCaseId: PCS.merceariaCapitalGiro,
      type: "INFORMATION_REQUEST",
      title: "Telefone de contato da empresa",
      description: "Informação cadastral incompleta: informe um telefone de contato do sócio administrador.",
      status: "OPEN",
      createdBy: beatrizActor,
      createdAt: daysFromNowISO(-4, 10, 5),
      dueDate: dateFromNow(5),
      messages: [],
      updatedAt: daysFromNowISO(-4, 10, 5),
    },
    {
      ...o,
      id: PR.sandraComprovante,
      partnerOfficeId: PO.almeida,
      clientId: PC.sandra,
      legalCaseId: PCS.sandraRevisional,
      processId: PP.sandraRevisional,
      type: "DOCUMENT_REQUEST",
      title: "Comprovante de residência atualizado",
      description: "O comprovante enviado tem mais de 90 dias. Envie um comprovante recente.",
      status: "RESOLVED",
      createdBy: claudioActor,
      createdAt: daysFromNowISO(-25, 10),
      dueDate: dateFromNow(-18),
      messages: [
        { id: "msg_1", at: daysFromNowISO(-22, 9), actor: { type: "USER", id: PU.marcos, name: "Marcos Almeida" }, side: "PARTNER", message: "Segue comprovante de agosto." },
        { id: "msg_2", at: daysFromNowISO(-21, 11), actor: claudioActor, side: "OWNER", message: "Recebido, obrigado." },
      ],
      resolvedAt: daysFromNowISO(-21, 11),
      updatedAt: daysFromNowISO(-21, 11),
    },
    {
      ...o,
      id: PR.ritaProcuracao,
      partnerOfficeId: PO.ferreiraLima,
      clientId: PC.rita,
      legalCaseId: PCS.ritaIndenizatoria,
      processId: PP.ritaIndenizatoria,
      type: "CORRECTION_REQUEST",
      title: "Procuração sem data",
      description: "A procuração enviada está sem data. Envie nova versão datada e assinada.",
      status: "OPEN",
      createdBy: beatrizActor,
      createdAt: daysFromNowISO(-2, 15),
      dueDate: dateFromNow(2),
      messages: [],
      updatedAt: daysFromNowISO(-2, 15),
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Acordos de parceria por caso (nascem no ACEITE, snapshot)           */
/* ------------------------------------------------------------------ */

export function buildPartnershipAgreements(): CasePartnershipAgreement[] {
  const agreement = (
    id: string,
    legalCaseId: string,
    partnerOfficeId: string,
    partnerPercentage: number,
    at: string,
    values: Partial<Pick<CasePartnershipAgreement, "revenueBase" | "realizedRevenue" | "payouts">> = {},
  ): CasePartnershipAgreement => ({
    ...o,
    id,
    legalCaseId,
    partnerOfficeId,
    partnerPercentage,
    ownerPercentage: 100 - partnerPercentage,
    effectiveAt: at,
    payouts: [],
    createdAt: at,
    updatedAt: at,
    ...values,
  });
  // Somente casos ACEITOS têm acordo: Otávio (enviado) e Mercearia (aguardando documentos) ainda não.
  return [
    // Exemplo do escopo: honorários R$ 4.000, 50/50, R$ 1.000 já repassado.
    agreement("ppa_sandra", PCS.sandraRevisional, PO.almeida, 50, daysFromNowISO(-37, 11), {
      revenueBase: 4000,
      realizedRevenue: 4000,
      payouts: [{ id: "pay_p_1", at: daysFromNowISO(-10, 11), amount: 1000, note: "Primeiro repasse", registeredBy: U.barbara }],
    }),
    agreement("ppa_rita", PCS.ritaIndenizatoria, PO.ferreiraLima, 60, daysFromNowISO(-24, 11), { revenueBase: 3000 }),
    agreement("ppa_helena", PCS.helenaCartao, PO.ferreiraLima, 60, daysFromNowISO(-7, 11), { revenueBase: 2500 }),
  ];
}

/* ------------------------------------------------------------------ */
/* Notificações                                                        */
/* ------------------------------------------------------------------ */

export function buildPartnerNotifications(): Notification[] {
  return [
    // Internas: novo caso de parceiro e advogado responsável necessário.
    {
      ...o,
      id: "ntf_p_owner_01",
      type: "CASE_SUBMITTED",
      severity: "warning",
      title: "Novo caso enviado pela Almeida Advocacia",
      description: "Otávio Ferreira Neves · Direito Bancário · 6 documentos.",
      at: minutesAgoISO(18),
      read: false,
      clientId: PC.otavio,
      legalCaseId: PCS.otavioConsignado,
      cta: { label: "Abrir caso", href: `/casos/${PCS.otavioConsignado}` },
      requiredPermission: "cases.view",
    },
    {
      ...o,
      id: "ntf_owner_case_lawyer",
      type: "CASE_LAWYER_REQUIRED",
      severity: "warning",
      title: "Advogado responsável necessário",
      description: "Cartão consignado — Roberto · análise aguardando revisão sem responsável definido.",
      at: daysFromNowISO(-1, 9),
      read: false,
      clientId: C.roberto,
      legalCaseId: "cas_roberto_cartao",
      cta: { label: "Abrir caso", href: "/casos/cas_roberto_cartao" },
      requiredPermission: "cases.decide",
    },
    // Portal do parceiro (Almeida).
    {
      ...o,
      id: "ntf_p_alm_01",
      partnerOfficeId: PO.almeida,
      type: "PARTNER_REQUEST",
      severity: "warning",
      title: "Nova solicitação: extrato bancário",
      description: "Mercearia Boa Vista · Bárbara Cardoso Advocacia solicitou documentação adicional.",
      at: daysFromNowISO(-4, 10),
      read: false,
      clientId: PC.mercearia,
      legalCaseId: PCS.merceariaCapitalGiro,
      cta: { label: "Enviar documento", href: "/pendencias" },
      requiredPermission: "partnerPortal.view",
    },
    {
      ...o,
      id: "ntf_p_alm_02",
      partnerOfficeId: PO.almeida,
      type: "PROCESS_MOVEMENT",
      severity: "info",
      title: "Processo recebeu nova movimentação",
      description: "Sandra Regina Mello · Intimação para réplica.",
      at: daysFromNowISO(-1, 16),
      read: false,
      clientId: PC.sandra,
      processId: PP.sandraRevisional,
      cta: { label: "Abrir processo", href: `/processos/${PP.sandraRevisional}?aba=movimentacoes` },
      requiredPermission: "partnerPortal.view",
    },
    {
      ...o,
      id: "ntf_p_alm_03",
      partnerOfficeId: PO.almeida,
      type: "DOCUMENT_APPROVED",
      severity: "info",
      title: "Documento aprovado",
      description: "Sandra Regina Mello · Petição inicial — versão aprovada.",
      at: daysFromNowISO(-31, 17),
      read: true,
      clientId: PC.sandra,
      processId: PP.sandraRevisional,
      cta: { label: "Ver documento", href: `/processos/${PP.sandraRevisional}?aba=documentos` },
      requiredPermission: "partnerPortal.view",
    },
    {
      ...o,
      id: "ntf_p_alm_04",
      partnerOfficeId: PO.almeida,
      type: "PAYOUT_UPDATE",
      severity: "info",
      title: "Repasse registrado",
      description: "Sandra Regina Mello · repasse de R$ 1.000,00 registrado.",
      at: daysFromNowISO(-10, 11),
      read: true,
      processId: PP.sandraRevisional,
      cta: { label: "Abrir Financeiro", href: "/financeiro" },
      requiredPermission: "partnerPortal.finance.view",
    },
    // Portal do parceiro (Ferreira & Lima).
    {
      ...o,
      id: "ntf_p_fl_01",
      partnerOfficeId: PO.ferreiraLima,
      type: "PARTNER_REQUEST",
      severity: "warning",
      title: "Correção solicitada: procuração sem data",
      description: "Rita de Cássia Carvalho · envie nova versão datada.",
      at: daysFromNowISO(-2, 15),
      read: false,
      clientId: PC.rita,
      processId: PP.ritaIndenizatoria,
      cta: { label: "Responder", href: "/pendencias" },
      requiredPermission: "partnerPortal.view",
    },
    {
      ...o,
      id: "ntf_p_fl_02",
      partnerOfficeId: PO.ferreiraLima,
      type: "CASE_ACCEPTED",
      severity: "info",
      title: "Caso aceito",
      description: "Helena Martins Ribeiro · Cartão consignado.",
      at: daysFromNowISO(-7, 11),
      read: true,
      clientId: C.helena,
      legalCaseId: PCS.helenaCartao,
      cta: { label: "Abrir caso", href: `/casos/${PCS.helenaCartao}` },
      requiredPermission: "partnerPortal.view",
    },
    {
      ...o,
      id: "ntf_p_alm_05",
      partnerOfficeId: PO.almeida,
      type: "CASE_REJECTED",
      severity: "info",
      title: "Caso não aceito",
      description: "Sandra Regina Mello · Tarifa de cadastro: Documentação insuficiente para prosseguir.",
      at: daysFromNowISO(-13, 11),
      read: true,
      clientId: PC.sandra,
      legalCaseId: PCS.sandraTarifa,
      cta: { label: "Ver caso", href: `/casos/${PCS.sandraTarifa}` },
      requiredPermission: "partnerPortal.view",
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Auditoria (com resumo seguro para a linha do tempo do parceiro)     */
/* ------------------------------------------------------------------ */

export function buildPartnerAuditEvents(): AuditEvent[] {
  const barbara: ActorRef = { type: "USER", id: U.barbara, name: "Dra. Bárbara Cardoso" };
  const marcos: ActorRef = { type: "USER", id: PU.marcos, name: "Marcos Almeida" };
  const carla: ActorRef = { type: "USER", id: PU.carla, name: "Carla Souza" };
  const patricia: ActorRef = { type: "USER", id: PU.patricia, name: "Patrícia Lima" };
  let seq = 0;
  const ev = (e: Omit<AuditEvent, "id" | "officeId">): AuditEvent => {
    seq += 1;
    return { ...o, id: `aud_p_${String(seq).padStart(2, "0")}`, ...e };
  };
  return [
    ev({ at: minutesAgoISO(18), actor: carla, action: "CASE_SUBMITTED", entityType: "legalCase", entityId: PCS.otavioConsignado, partnerOfficeId: PO.almeida, description: "Caso de Otávio Ferreira Neves enviado pela Almeida Advocacia (6 documentos).", partnerSummary: "Caso de Otávio Ferreira Neves enviado com 6 documentos." }),
    ev({ at: daysFromNowISO(-13, 11), actor: barbara, action: "CASE_REJECTED", entityType: "legalCase", entityId: PCS.sandraTarifa, partnerOfficeId: PO.almeida, description: "Caso “Tarifa de cadastro — Sandra” rejeitado.", partnerSummary: "Caso de Sandra Regina Mello (tarifa de cadastro) não aceito: Documentação insuficiente para prosseguir." }),
    ev({ at: daysFromNowISO(-13, 11), actor: barbara, action: "CASE_REJECTION_INTERNAL_NOTE", entityType: "legalCase", entityId: PCS.sandraTarifa, partnerOfficeId: PO.almeida, description: "Nota interna registrada na rejeição (não visível ao parceiro)." }),
    ev({ at: daysFromNowISO(-37, 11), actor: barbara, action: "PARTNERSHIP_SNAPSHOT_CREATED", entityType: "legalCase", entityId: PCS.sandraRevisional, partnerOfficeId: PO.almeida, description: "Acordo de parceria criado no aceite: 50% parceiro / 50% Bárbara.", partnerSummary: "Caso de Sandra Regina Mello aceito." }),
    ev({ at: daysFromNowISO(-1, 16), actor: { type: "SYSTEM", id: "system", name: "DG Brasil" }, action: "PROCESS_UPDATED", entityType: "process", entityId: PP.sandraRevisional, partnerOfficeId: PO.almeida, description: "Nova movimentação: intimação para réplica.", partnerSummary: "Processo de Sandra Regina Mello atualizado: intimação para réplica." }),
    ev({ at: daysFromNowISO(-4, 10), actor: beatrizActor, action: "PARTNER_REQUEST_CREATED", entityType: "partnerRequest", entityId: PR.merceariaExtrato, partnerOfficeId: PO.almeida, description: "Solicitado extrato bancário de 12 meses à Almeida Advocacia.", partnerSummary: "Bárbara Cardoso Advocacia solicitou o extrato bancário dos últimos 12 meses (Mercearia Boa Vista)." }),
    ev({ at: daysFromNowISO(-10, 11), actor: barbara, action: "PARTNER_PAYOUT_REGISTERED", entityType: "partnershipAgreement", entityId: "ppa_sandra", partnerOfficeId: PO.almeida, description: "Repasse de R$ 1.000,00 registrado para Almeida Advocacia.", partnerSummary: "Repasse registrado no caso de Sandra Regina Mello." }),
    ev({ at: daysFromNowISO(-12, 14), actor: marcos, action: "CASE_SUBMITTED", entityType: "legalCase", entityId: PCS.merceariaCapitalGiro, partnerOfficeId: PO.almeida, description: "Caso de Mercearia Boa Vista enviado.", partnerSummary: "Caso de Mercearia Boa Vista enviado." }),
    ev({ at: daysFromNowISO(-20, 9), actor: marcos, action: "DOCUMENT_VERSION_ADDED", entityType: "document", entityId: "doc_p_10", partnerOfficeId: PO.almeida, description: "Procuração de Sandra Regina Mello: versão 2 enviada (v1 preservada).", partnerSummary: "Nova versão da procuração de Sandra Regina Mello enviada (v2)." }),
    ev({ at: daysFromNowISO(-31, 17), actor: claudioActor, action: "DOCUMENT_SHARED_WITH_PARTNER", entityType: "document", entityId: "doc_p_shared_01", partnerOfficeId: PO.almeida, description: "Petição inicial aprovada disponibilizada à Almeida Advocacia.", partnerSummary: "Documento aprovado disponível: petição inicial de Sandra Regina Mello." }),
    ev({ at: daysFromNowISO(-37, 10), actor: barbara, action: "PARTNERSHIP_VALUE_UPDATED", entityType: "partnershipAgreement", entityId: "ppa_sandra", partnerOfficeId: PO.almeida, description: "Honorários estimados do caso de Sandra Regina Mello: R$ 4.000,00.", partnerSummary: "Valores registrados no caso de Sandra Regina Mello." }),
    ev({ at: daysFromNowISO(-38, 10), actor: marcos, action: "CASE_SUBMITTED", entityType: "legalCase", entityId: PCS.sandraRevisional, partnerOfficeId: PO.almeida, description: "Caso de Sandra Regina Mello enviado.", partnerSummary: "Caso de Sandra Regina Mello enviado." }),
    ev({ at: daysFromNowISO(-40, 9), actor: barbara, action: "PARTNER_USER_INVITED", entityType: "user", entityId: PU.carla, partnerOfficeId: PO.almeida, description: "Carla Souza convidada como Usuário do parceiro (Almeida Advocacia).", partnerSummary: "Carla Souza foi convidada para o portal." }),
    ev({ at: daysFromNowISO(-45, 9), actor: barbara, action: "PARTNER_CREATED", entityType: "partnerOffice", entityId: PO.almeida, partnerOfficeId: PO.almeida, description: "Parceiro Almeida Advocacia cadastrado (divisão 50% / 50%).", partnerSummary: "Parceria com Bárbara Cardoso Advocacia iniciada." }),
    ev({ at: daysFromNowISO(-2, 15), actor: beatrizActor, action: "PARTNER_REQUEST_CREATED", entityType: "partnerRequest", entityId: PR.ritaProcuracao, partnerOfficeId: PO.ferreiraLima, description: "Solicitada nova procuração datada à Ferreira & Lima.", partnerSummary: "Bárbara Cardoso Advocacia solicitou correção da procuração de Rita de Cássia Carvalho." }),
    ev({ at: daysFromNowISO(-8, 15), actor: patricia, action: "CLIENT_DUPLICATE_DETECTED", entityType: "client", entityId: C.helena, partnerOfficeId: PO.ferreiraLima, description: "CPF já cadastrado informado pela Ferreira & Lima; novo vínculo criado sem duplicar o cliente." }),
    ev({ at: daysFromNowISO(-8, 15), actor: patricia, action: "CLIENT_RELATIONSHIP_CREATED", entityType: "client", entityId: C.helena, partnerOfficeId: PO.ferreiraLima, description: "Vínculo da Ferreira & Lima com Helena Martins Ribeiro criado para novo caso.", partnerSummary: "Novo caso vinculado a Helena Martins Ribeiro." }),
    ev({ at: daysFromNowISO(-8, 15), actor: patricia, action: "CASE_SUBMITTED", entityType: "legalCase", entityId: PCS.helenaCartao, partnerOfficeId: PO.ferreiraLima, description: "Caso “Cartão consignado — Helena” enviado pela Ferreira & Lima.", partnerSummary: "Caso de Helena Martins Ribeiro enviado." }),
    ev({ at: daysFromNowISO(-30, 10), actor: barbara, action: "PARTNER_CREATED", entityType: "partnerOffice", entityId: PO.ferreiraLima, partnerOfficeId: PO.ferreiraLima, description: "Parceiro Ferreira & Lima Advogados cadastrado (divisão 60% / 40%).", partnerSummary: "Parceria com Bárbara Cardoso Advocacia iniciada." }),
    ev({ at: daysFromNowISO(-3, 15), actor: barbara, action: "PARTNER_CREATED", entityType: "partnerOffice", entityId: PO.costa, partnerOfficeId: PO.costa, description: "Parceiro Costa Jurídico cadastrado (divisão 50% / 50%). Convite enviado.", partnerSummary: "Parceria com Bárbara Cardoso Advocacia iniciada." }),
  ];
}
