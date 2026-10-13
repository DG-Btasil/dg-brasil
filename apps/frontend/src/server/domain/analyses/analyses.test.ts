import { describe, expect, it } from "vitest";
import type { DocumentCategory } from "@/lib/constants/status";
import { detailFromRow, fieldValuesPayload, missingRequirements, resultFromRow, validateTemplateFields, type AnalysisDetailRow, type TemplateFieldRow, type TemplateRequirementRow } from "./mappers";
import { listAnalysesSchema, startAnalysisSchema } from "./schemas";

const THESIS = "00000000-0000-4000-8000-0000000000f1";
const CASE = "00000000-0000-4000-8000-0000000000c1";

const requirements: TemplateRequirementRow[] = [
  { document_category: "BENEFIT_STATEMENT", label: "HISCON", description: null, required: true, applies_to_client_kind: null, sort_order: 30 },
  { document_category: "IDENTIFICATION", label: "RG/CPF", description: "Frente e verso", required: true, applies_to_client_kind: null, sort_order: 10 },
  { document_category: "CORPORATE_DOCUMENTS", label: "Contrato social", description: null, required: true, applies_to_client_kind: "COMPANY", sort_order: 20 },
  { document_category: "BANK_STATEMENT", label: "Extrato", description: null, required: false, applies_to_client_kind: null, sort_order: 40 },
];

const fields: TemplateFieldRow[] = [
  { key: "banco", label: "o banco", field_type: "text", required: true, options: null },
  { key: "valor", label: "o valor", field_type: "currency", required: false, options: null },
  { key: "tipo", label: "o tipo", field_type: "select", required: false, options: [{ value: "consignado", label: "Consignado" }] },
  { key: "inicio", label: "a data", field_type: "date", required: false, options: null },
  { key: "ativo", label: "ativo", field_type: "boolean", required: false, options: null },
];

const row = (over: Partial<AnalysisDetailRow> = {}): AnalysisDetailRow => ({
  id: "a1",
  legal_case_id: CASE,
  analysis_template_id: "t1",
  status: "PENDING",
  agent_run_id: null,
  started_at: null,
  completed_at: null,
  created_at: "2026-10-12T10:00:00Z",
  updated_at: "2026-10-12T10:00:00Z",
  summary: null,
  field_values: { banco: "Banco X" },
  result_data: {},
  interruption_reason: null,
  started_by: null,
  ...over,
});

describe("checklist de documentos", () => {
  it("PF: ignora item só de PJ, ordena e tira o que o caso já tem", () => {
    const missing = missingRequirements(requirements, "INDIVIDUAL", new Set<DocumentCategory>(["IDENTIFICATION"]));
    expect(missing.map((m) => m.category)).toEqual(["BENEFIT_STATEMENT", "BANK_STATEMENT"]);
    expect(missing[1].required).toBe(false);
  });

  it("PJ: inclui o item só de PJ", () => {
    expect(missingRequirements(requirements, "COMPANY", new Set()).map((m) => m.category)).toContain("CORPORATE_DOCUMENTS");
  });
});

describe("status do front", () => {
  it("PENDING vira READY só sem documento obrigatório faltando (recomendado não bloqueia)", () => {
    const onlyRecommended = missingRequirements(requirements, "INDIVIDUAL", new Set<DocumentCategory>(["IDENTIFICATION", "BENEFIT_STATEMENT"]));
    expect(detailFromRow(row(), onlyRecommended, null)).toMatchObject({ status: "READY", requiredDocumentsComplete: true });
    const missingRequired = missingRequirements(requirements, "INDIVIDUAL", new Set());
    expect(detailFromRow(row(), missingRequired, null)).toMatchObject({ status: "NOT_STARTED", requiredDocumentsComplete: false });
  });

  it("QUEUED/RUNNING → ANALYZING; FAILED → INTERRUPTED; mantém o status do banco", () => {
    expect(detailFromRow(row({ status: "QUEUED" }), [], null)).toMatchObject({ status: "ANALYZING", dbStatus: "QUEUED" });
    expect(detailFromRow(row({ status: "FAILED" }), [], "r1")).toMatchObject({ status: "INTERRUPTED", reviewId: "r1" });
  });
});

describe("resultado estruturado", () => {
  it("monta resumo, teses (só UUID) e recomendação", () => {
    expect(resultFromRow("Resumo", { identified_thesis_ids: [THESIS, "nao-uuid", 3], recommendation: "Ajuizar" })).toEqual({
      summary: "Resumo",
      identifiedThesisIds: [THESIS],
      recommendation: "Ajuizar",
    });
  });

  it("sem resultado → undefined; result_data não-objeto vira {}", () => {
    expect(resultFromRow(null, {})).toBeUndefined();
    expect(detailFromRow(row({ result_data: [1, 2] }), [], null).resultData).toEqual({});
  });
});

describe("campos do template", () => {
  it("aceita respostas válidas e grava só o que foi preenchido", () => {
    const values = { banco: " Banco X ", valor: "1500,50", tipo: "consignado", inicio: "2024-01-31", ativo: "true" };
    expect(validateTemplateFields(values, fields)).toBeNull();
    expect(fieldValuesPayload({ banco: " Banco X ", valor: "  " })).toEqual({ banco: "Banco X" });
  });

  it("recusa campo desconhecido, obrigatório vazio e formatos inválidos", () => {
    const errors = validateTemplateFields({ extra: "x", valor: "abc", tipo: "outro", inicio: "31/01/2024", ativo: "talvez" }, fields);
    expect(Object.keys(errors ?? {}).sort()).toEqual(["fields.ativo", "fields.banco", "fields.extra", "fields.inicio", "fields.tipo", "fields.valor"]);
  });
});

describe("schemas", () => {
  it("início: cliente não vem do navegador; chave de campo no formato do banco", () => {
    const parsed = startAnalysisSchema.parse({ idempotencyKey: CASE, legalCaseId: CASE, templateId: CASE, clientId: CASE, fields: { banco: "X" } });
    expect(parsed).not.toHaveProperty("clientId");
    expect(parsed.send).toBe(false);
    expect(startAnalysisSchema.safeParse({ idempotencyKey: CASE, legalCaseId: CASE, templateId: CASE, fields: { "Banco X": "y" } }).success).toBe(false);
  });

  it("início (029): sem chave de envio é recusado; enviar é opt-in explícito", () => {
    expect(startAnalysisSchema.safeParse({ legalCaseId: CASE, templateId: CASE }).success).toBe(false);
    expect(startAnalysisSchema.parse({ idempotencyKey: CASE, legalCaseId: CASE, templateId: CASE, send: true, requestText: "  Pedido  " })).toMatchObject({ send: true });
  });

  it("listagem: ordenação por whitelist", () => {
    expect(listAnalysesSchema.parse({ sortBy: "updatedAt" })).toMatchObject({ column: "updated_at" });
    expect(listAnalysesSchema.safeParse({ sortBy: "summary" }).success).toBe(false);
  });
});
