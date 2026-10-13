import { describe, expect, it } from "vitest";
import {
  createPayload,
  internalCaseFromRows,
  listItemFromRow,
  partnerCaseFromRow,
  partnerSubmitPayload,
  updatePayload,
  type CaseListRow,
  type CaseRow,
} from "./mappers";
import { caseDbError, likePattern } from "./repository";
const KEY = "11111111-1111-4111-8111-111111111111";

import {
  acceptCaseSchema,
  changeOriginSchema,
  createCaseSchema,
  listCasesSchema,
  overrideStatusSchema,
  partnerSubmitCaseSchema,
  rejectCaseSchema,
  updateCaseSchema,
} from "./schemas";

const OWNER = "00000000-0000-4000-8000-000000000001";
const PARTNER_A = "00000000-0000-4000-8000-00000000000a";
const CLIENT = "00000000-0000-4000-8000-0000000000c1";
const AREA = "00000000-0000-4000-8000-0000000000a1";
const LAWYER = "00000000-0000-4000-8000-0000000000b1";

const caseRow = (over: Partial<CaseRow> = {}): CaseRow => ({
  id: "k1",
  client_id: CLIENT,
  legal_area_id: AREA,
  case_type_id: null,
  title: "Revisional consignado",
  summary: "Resumo",
  opposing_party: "Banco X",
  status: "REJECTED",
  partner_organization_id: PARTNER_A,
  origin_organization_id: OWNER,
  partner_notes: "nota do parceiro",
  submitted_at: "2026-10-01T00:00:00Z",
  accepted_at: null,
  rejected_at: "2026-10-03T00:00:00Z",
  closed_at: null,
  archived_at: null,
  rejection_reason_public: "Sem documentos suficientes",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-03T00:00:00Z",
  legal_areas: { code: "BANKING", name: "Direito Bancário" },
  case_types: null,
  created_by_organization_id: PARTNER_A,
  created_by: "u-criador",
  assigned_lawyer_id: LAWYER,
  ...over,
});

const internalRow = { rejection_reason_internal: "cliente com histórico ruim", internal_notes: "nota interna sigilosa", accepted_by: "u-aceite" };

describe("mapeamento banco → domínio", () => {
  it("ficha interna monta o LegalCase do front com dados internos", () => {
    const c = internalCaseFromRows(caseRow(), internalRow, OWNER);
    expect(c).toMatchObject({
      id: "k1",
      officeId: OWNER,
      area: "BANKING",
      areaName: "Direito Bancário",
      caseType: "",
      status: "REJECTED",
      partnerOrganizationId: PARTNER_A,
      originOrganizationId: OWNER,
      createdBy: "u-criador",
      assignedLawyerId: LAWYER,
      rejectionReasonPublic: "Sem documentos suficientes",
      rejectionReasonInternal: "cliente com histórico ruim",
      notes: "nota interna sigilosa",
      acceptedBy: "u-aceite",
    });
    expect(c.caseTypeId).toBeUndefined();
  });

  it("ficha do parceiro não tem NENHUM campo interno, mesmo recebendo a linha interna completa", () => {
    // Passa de propósito a linha INTERNA (com autoria e advogado): o mapper copia campo a campo.
    const p = partnerCaseFromRow(caseRow(), PARTNER_A);
    for (const field of [
      "rejectionReasonInternal",
      "notes",
      "acceptedBy",
      "createdBy",
      "createdByOrganizationId",
      "assignedLawyerId",
      "officeId",
      "internal_notes",
      "rejection_reason_internal",
      "accepted_by",
    ]) {
      expect(p).not.toHaveProperty(field);
    }
    expect(p.rejectionReasonPublic).toBe("Sem documentos suficientes");
    expect(p.partnerOrganizationId).toBe(PARTNER_A);
    expect(JSON.stringify(p)).not.toContain(LAWYER);
    expect(JSON.stringify(p)).not.toContain("u-criador");
  });

  it("embeds podem vir como array (PostgREST) e o tipo vem do catálogo", () => {
    const p = partnerCaseFromRow(
      caseRow({ legal_areas: [{ code: "CIVIL", name: "Direito Civil" }], case_types: [{ code: "DANOS", name: "Danos morais" }], case_type_id: "t1" }),
      PARTNER_A,
    );
    expect(p).toMatchObject({ area: "CIVIL", caseType: "Danos morais", caseTypeCode: "DANOS", caseTypeId: "t1" });
  });

  it("linha da listagem: advogado só para a equipe interna; nome do cliente PF ou PJ", () => {
    const row: CaseListRow = {
      id: "k1",
      client_id: CLIENT,
      legal_area_id: AREA,
      case_type_id: null,
      title: "T",
      status: "SUBMITTED",
      origin_organization_id: OWNER,
      partner_organization_id: PARTNER_A,
      assigned_lawyer_id: LAWYER,
      submitted_at: "2026-10-01T00:00:00Z",
      accepted_at: null,
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-01T00:00:00Z",
      legal_areas: { code: "BANKING", name: "Direito Bancário" },
      case_types: null,
      clients: { individual_client_details: [{ full_name: "Maria Teste" }], company_client_details: null },
    };
    expect(listItemFromRow(row, { surface: "INTERNAL" })).toMatchObject({ clientName: "Maria Teste", assignedLawyerId: LAWYER, area: "BANKING" });
    expect(listItemFromRow(row, { surface: "PARTNER" }).assignedLawyerId).toBeUndefined();
    const company = listItemFromRow({ ...row, clients: { individual_client_details: null, company_client_details: { legal_name: "ACME Ltda" } } }, { surface: "INTERNAL" });
    expect(company.clientName).toBe("ACME Ltda");
    expect(listItemFromRow({ ...row, clients: null }, { surface: "PARTNER" }).clientName).toBe("");
  });
});

describe("domínio → banco", () => {
  it("criação: rascunho por padrão, enviado com submit; vínculo de parceiro só o resolvido", () => {
    const input = createCaseSchema.parse({ idempotencyKey: KEY, clientId: CLIENT, area: "banking", title: " Caso ", originOrganizationId: PARTNER_A });
    const draft = createPayload(input, { id: "k1", legalAreaId: AREA, caseTypeId: null, partnerOrganizationId: null });
    expect(draft).toMatchObject({ id: "k1", status: "DRAFT", title: "Caso", origin_organization_id: PARTNER_A, partner_organization_id: null, assigned_lawyer_id: null });
    // Nada de autoria nem nota interna no payload de legal_cases.
    for (const col of ["created_by", "created_by_organization_id", "internal_notes", "accepted_at"]) expect(draft).not.toHaveProperty(col);
    const sent = createPayload({ ...input, submit: true }, { id: "k2", legalAreaId: AREA, caseTypeId: null, partnerOrganizationId: PARTNER_A });
    expect(sent).toMatchObject({ status: "SUBMITTED", partner_organization_id: PARTNER_A });
  });

  it("PATCH: só chaves presentes; null/vazio limpa; notes nunca vai para legal_cases", () => {
    const { patch } = updateCaseSchema.parse({ id: CLIENT, patch: { summary: "", opposingParty: null, notes: "interna" } });
    const out = updatePayload(patch);
    expect(out).toEqual({ summary: null, opposing_party: null });
    expect(updatePayload({ title: "Novo" }, { legalAreaId: AREA, caseTypeId: null })).toEqual({ title: "Novo", legal_area_id: AREA, case_type_id: null });
    expect(updatePayload({ title: "Novo" }, { caseTypeId: undefined })).toEqual({ title: "Novo" });
  });

  it("envio do parceiro: payload da RPC com origens resolvidas e endereço no formato do banco", () => {
    const input = partnerSubmitCaseSchema.parse({ idempotencyKey: KEY,
      client: { kind: "INDIVIDUAL", document: "999.000.111-22", fullName: "Maria", address: { zipCode: "01001-000", district: "Centro", state: "sp" } },
      case: { area: "BANKING", title: "Caso", origin: "OWNER" },
    });
    const { p_client, p_case } = partnerSubmitPayload(input, { clientOriginId: PARTNER_A, caseOriginId: OWNER, legalAreaId: AREA, caseTypeId: null });
    expect(p_client).toMatchObject({
      document: "99900011122",
      kind: "INDIVIDUAL",
      origin_organization_id: PARTNER_A,
      full_name: "Maria",
      address: { postal_code: "01001000", neighborhood: "Centro", state: "SP" },
    });
    expect(p_case).toMatchObject({ legal_area_id: AREA, case_type_id: null, title: "Caso", origin_organization_id: OWNER });
    expect(p_case).not.toHaveProperty("partner_organization_id"); // o banco usa a sessão
    expect(p_case).not.toHaveProperty("status");
  });
});

describe("schemas", () => {
  it("criação exige área (código OU id) e não aceita os dois", () => {
    expect(createCaseSchema.safeParse({ idempotencyKey: KEY, clientId: CLIENT, title: "T", originOrganizationId: OWNER }).success).toBe(false);
    expect(createCaseSchema.safeParse({ idempotencyKey: KEY, clientId: CLIENT, title: "T", originOrganizationId: OWNER, area: "BANKING", legalAreaId: AREA }).success).toBe(false);
    expect(createCaseSchema.safeParse({ idempotencyKey: KEY, clientId: CLIENT, title: "T", originOrganizationId: OWNER, legalAreaId: AREA }).success).toBe(true);
    expect(createCaseSchema.safeParse({ idempotencyKey: KEY, clientId: CLIENT, title: "T", originOrganizationId: OWNER, area: "bancário!" }).success).toBe(false);
    const parsed = createCaseSchema.parse({ idempotencyKey: KEY, clientId: CLIENT, title: "T", originOrganizationId: OWNER, area: "BANKING" });
    expect(parsed).toMatchObject({ submit: false, linkPartner: false });
  });

  it("edição vazia é recusada", () => {
    expect(updateCaseSchema.safeParse({ id: CLIENT, patch: {} }).success).toBe(false);
  });

  it("rejeição exige motivo público; interno é opcional", () => {
    expect(rejectCaseSchema.safeParse({ id: CLIENT, publicReason: "  " }).success).toBe(false);
    expect(rejectCaseSchema.parse({ id: CLIENT, publicReason: "Motivo", internalNote: "" }).internalNote).toBeUndefined();
  });

  it("aceite: advogado opcional mas, se vier, é uuid", () => {
    expect(acceptCaseSchema.safeParse({ id: CLIENT, lawyerId: "joao" }).success).toBe(false);
    expect(acceptCaseSchema.safeParse({ id: CLIENT }).success).toBe(true);
  });

  it("listagem: status único ou lista; ordenação só da whitelist", () => {
    expect(listCasesSchema.parse({ status: "SUBMITTED" })).toMatchObject({ status: ["SUBMITTED"], column: "updated_at", ascending: false, page: 1, pageSize: 25 });
    expect(listCasesSchema.parse({ status: ["ACCEPTED", "IN_PROGRESS"], sortBy: "title", sortDirection: "asc" })).toMatchObject({ column: "title", ascending: true });
    expect(listCasesSchema.safeParse({ sortBy: "rejection_reason_public" }).success).toBe(false);
    expect(listCasesSchema.safeParse({ status: "QUALQUER" }).success).toBe(false);
    expect(listCasesSchema.safeParse({ pageSize: 500 }).success).toBe(false);
  });

  it("parceiro escolhe origem só entre o próprio escritório e o proprietário (sem id no input)", () => {
    const parsed = partnerSubmitCaseSchema.parse({ idempotencyKey: KEY, client: { kind: "COMPANY", document: "99900011122233" }, case: { area: "BANKING", title: "T" } });
    expect(parsed.client.origin).toBe("OWN_OFFICE");
    expect(parsed.case.origin).toBe("OWN_OFFICE");
    expect(partnerSubmitCaseSchema.safeParse({ idempotencyKey: KEY, client: { kind: "INDIVIDUAL", document: "99900011122" }, case: { area: "BANKING", title: "T", origin: PARTNER_A } }).success).toBe(false);
    // CPF em cliente PJ: recusado.
    expect(partnerSubmitCaseSchema.safeParse({ idempotencyKey: KEY, client: { kind: "COMPANY", document: "99900011122" }, case: { area: "BANKING", title: "T" } }).success).toBe(false);
  });

  it("troca de origem e exceção de status", () => {
    expect(changeOriginSchema.parse({ id: CLIENT, originOrganizationId: OWNER })).toMatchObject({ linkPartner: false });
    expect(overrideStatusSchema.safeParse({ id: CLIENT, status: "SUBMITTED", reason: "" }).success).toBe(false);
  });
});

describe("erros do banco → domínio", () => {
  it("aceite sem advogado vira VALIDATION com campo", () => {
    const e = caseDbError({ code: "23514", message: 'new row for relation "legal_cases" violates check constraint "legal_cases_accepted_requires_lawyer"' });
    expect(e.code).toBe("VALIDATION");
    expect(e.fieldErrors?.lawyerId?.[0]).toMatch(/advogado/);
    expect(e.publicMessage).not.toMatch(/legal_cases|constraint/);
  });

  it("transição inválida vira INVALID_STATE sem códigos técnicos", () => {
    const e = caseDbError({ code: "23514", message: "Transição de caso inválida: ACCEPTED → DRAFT" });
    expect(e.code).toBe("INVALID_STATE");
    expect(e.publicMessage).not.toContain("ACCEPTED");
  });

  it("caso inexistente na RPC vira NOT_FOUND sem o id", () => {
    const e = caseDbError({ code: "23503", message: "Caso 00000000-0000-4000-8000-000000000001 não existe" });
    expect(e.code).toBe("NOT_FOUND");
    expect(e.publicMessage).not.toContain("0000");
  });

  it("recusa de papel do banco segue FORBIDDEN com a mensagem nossa", () => {
    const e = caseDbError({ code: "42501", message: "Somente ADMIN interno pode alterar a origem de um caso aceito" });
    expect(e.code).toBe("FORBIDDEN");
    expect(e.publicMessage).toMatch(/ADMIN/);
    expect(caseDbError({ code: "42501", message: 'new row violates row-level security policy for table "legal_cases"' }).publicMessage).not.toMatch(/legal_cases/);
  });

  it("ILIKE: curinga do usuário não vira padrão", () => {
    expect(likePattern("50%_off")).toBe("%50\\%\\_off%");
  });
});
