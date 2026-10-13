import { describe, expect, it } from "vitest";
import {
  OWNER_TEAM_LABEL,
  dateInSaoPaulo,
  dueAtFromDate,
  insertRow,
  internalDetailFromRows,
  listItemFromRow,
  partnerDetailFromRows,
  type PartnerRequestMessageRow,
  type PartnerRequestRow,
} from "./mappers";
import { addPartnerRequestMessageSchema, closePartnerRequestSchema, createPartnerRequestSchema, listPartnerRequestsSchema } from "./schemas";

const PARTNER_A = "00000000-0000-4000-8000-00000000000a";
const CASE = "00000000-0000-4000-8000-0000000000c1";
const LAWYER = "00000000-0000-4000-8000-0000000000b1";
const PARTNER_USER = "00000000-0000-4000-8000-0000000000e1";
const INTERNAL_DOC = "00000000-0000-4000-8000-0000000000d1";
const VISIBLE_DOC = "00000000-0000-4000-8000-0000000000d2";

const row = (over: Partial<PartnerRequestRow> = {}): PartnerRequestRow => ({
  id: "r1",
  partner_organization_id: PARTNER_A,
  legal_case_id: CASE,
  legal_process_id: null,
  type: "DOCUMENT",
  title: "Enviar procuração",
  description: "Assinada",
  due_at: "2026-10-20T02:59:59Z",
  status: "OPEN",
  created_by: LAWYER,
  created_at: "2026-10-12T10:00:00Z",
  updated_at: "2026-10-12T10:00:00Z",
  answered_at: null,
  resolved_at: null,
  ...over,
});

const messages: PartnerRequestMessageRow[] = [
  { id: "m1", author_id: LAWYER, body: "Precisamos da procuração.", document_id: INTERNAL_DOC, created_at: "2026-10-12T10:00:00Z" },
  { id: "m2", author_id: PARTNER_USER, body: "Segue anexo.", document_id: VISIBLE_DOC, created_at: "2026-10-12T11:00:00Z" },
];
const partnerAuthors = new Set([PARTNER_USER]);
const names = new Map([
  [LAWYER, "Dra. Interna"],
  [PARTNER_USER, "Parceiro Fulano"],
]);

describe("mapeamento de solicitação", () => {
  it("tipo do banco vira o vocabulário do front e o prazo vira data de São Paulo", () => {
    const item = listItemFromRow(row(), "INTERNAL");
    expect(item.type).toBe("DOCUMENT_REQUEST");
    expect(item.dueDate).toBe("2026-10-19");
    expect(item.partnerOrganizationId).toBe(PARTNER_A);
    expect(item.createdById).toBe(LAWYER);
  });

  it("linha do parceiro não tem as chaves internas", () => {
    const item = listItemFromRow(row(), "PARTNER");
    expect(item).not.toHaveProperty("partnerOrganizationId");
    expect(item).not.toHaveProperty("createdById");
  });

  it("data civil ↔ fim do dia em São Paulo", () => {
    expect(dueAtFromDate("2026-10-19")).toBe("2026-10-19T23:59:59-03:00");
    expect(dateInSaoPaulo(new Date(dueAtFromDate("2026-10-19")).toISOString())).toBe("2026-10-19");
  });

  it("inserção usa o parceiro do caso e o tipo do banco", () => {
    const payload = insertRow("id1", createPartnerRequestSchema.parse({ legalCaseId: CASE, type: "CORRECTION_REQUEST", title: " Corrigir CPF ", dueDate: "2026-11-01" }), PARTNER_A);
    expect(payload).toMatchObject({ id: "id1", partner_organization_id: PARTNER_A, type: "CORRECTION", title: "Corrigir CPF", description: null, legal_process_id: null });
    expect(payload.due_at).toBe("2026-11-01T23:59:59-03:00");
  });
});

describe("DTO por superfície (sanitização do parceiro)", () => {
  it("interno vê autores identificados e todos os documentos", () => {
    const dto = internalDetailFromRows(row(), messages, partnerAuthors, names);
    expect(dto.messages.map((m) => m.side)).toEqual(["OWNER", "PARTNER"]);
    expect(dto.messages[0].author).toEqual({ id: LAWYER, name: "Dra. Interna" });
    expect(dto.messages[0].documentId).toBe(INTERNAL_DOC);
    expect(dto.createdById).toBe(LAWYER);
  });

  it("parceiro não recebe id/nome da equipe interna, nem documento que não abre, nem quem criou", () => {
    const dto = partnerDetailFromRows(row(), messages, partnerAuthors, names, new Set([VISIBLE_DOC]));
    const json = JSON.stringify(dto);
    expect(json).not.toContain(LAWYER);
    expect(json).not.toContain("Dra. Interna");
    expect(json).not.toContain(INTERNAL_DOC);
    expect(dto).not.toHaveProperty("createdById");
    expect(dto).not.toHaveProperty("partnerOrganizationId");
    expect(dto.messages[0]).toEqual({ id: "m1", at: "2026-10-12T10:00:00Z", side: "OWNER", authorName: OWNER_TEAM_LABEL, message: "Precisamos da procuração." });
    expect(dto.messages[1]).toMatchObject({ side: "PARTNER", authorName: "Parceiro Fulano", documentId: VISIBLE_DOC });
    for (const m of dto.messages) expect(m).not.toHaveProperty("author");
  });
});

describe("schemas", () => {
  it("listagem: ordenação só por whitelist, página limitada", () => {
    expect(listPartnerRequestsSchema.parse({})).toMatchObject({ page: 1, pageSize: 25, column: "created_at", ascending: false });
    expect(listPartnerRequestsSchema.parse({ sortBy: "dueAt", sortDirection: "asc" })).toMatchObject({ column: "due_at", ascending: true });
    expect(listPartnerRequestsSchema.safeParse({ sortBy: "title" }).success).toBe(false);
    expect(listPartnerRequestsSchema.safeParse({ pageSize: 500 }).success).toBe(false);
  });

  it("criação: tipo do front, título obrigatório, sem escritório vindo do navegador", () => {
    expect(createPartnerRequestSchema.safeParse({ legalCaseId: CASE, type: "DOCUMENT", title: "x" }).success).toBe(false);
    expect(createPartnerRequestSchema.safeParse({ legalCaseId: CASE, type: "DOCUMENT_REQUEST", title: "  " }).success).toBe(false);
    const parsed = createPartnerRequestSchema.parse({ legalCaseId: CASE, type: "DOCUMENT_REQUEST", title: "Doc", partnerOrganizationId: PARTNER_A });
    expect(parsed).not.toHaveProperty("partnerOrganizationId");
  });

  it("mensagem obrigatória e encerramento só RESOLVED/CANCELLED", () => {
    expect(addPartnerRequestMessageSchema.safeParse({ requestId: CASE, message: "" }).success).toBe(false);
    expect(addPartnerRequestMessageSchema.parse({ requestId: CASE, message: "ok" }).reopen).toBe(false);
    expect(closePartnerRequestSchema.safeParse({ id: CASE, resolution: "OPEN" }).success).toBe(false);
  });
});
