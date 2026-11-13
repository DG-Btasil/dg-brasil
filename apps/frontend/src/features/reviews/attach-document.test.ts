import { describe, expect, it } from "vitest";
import { createDocumentSchema, listDocumentsSchema } from "@/server/domain/documents/schemas";
import type { DocumentListItem } from "@/server/domain/documents/dto";
import type { ReviewTargetDTO } from "@/server/domain/reviews/dto";
import { attachedDocuments, attachHelpText, caseDocumentsHref, recentCaseDocumentsInput, reviewUploadTarget, type SessionUpload } from "./attach-document";

const CASE = "8f6c1f0e-3b7a-4d2c-9a51-2f4e5d6c7b8a";
const PROCESS = "1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b";
const CREATED = "2026-11-10T12:00:00.000Z";

const proposal = (proposalType: string, payload: Record<string, unknown>): ReviewTargetDTO => ({
  kind: "AGENT_PROPOSAL",
  proposalId: "p",
  agentRunId: "r",
  proposalType,
  proposalStatus: "PENDING",
  payload,
  requiresHumanReview: true,
  createdAt: CREATED,
});

function caseDoc(id: string, createdAt: string, over: { source?: "UPLOAD" | "AGENT" | "IMPORT"; status?: "ACTIVE" | "ARCHIVED"; noFile?: boolean; title?: string } = {}): DocumentListItem {
  return {
    surface: "INTERNAL",
    id,
    clientId: "c",
    category: "BANK_STATEMENT",
    title: over.title ?? `Documento ${id}`,
    visibility: "INTERNAL",
    status: over.status ?? "ACTIVE",
    createdAt,
    updatedAt: createdAt,
    currentVersion: over.noFile ? undefined : { id: `v-${id}`, versionNumber: 1, source: over.source ?? "UPLOAD", createdAt, verification: "UNVERIFIED", approval: "PENDING" },
  };
}

describe("anexar documento na revisão: destino do envio", () => {
  it("revisão sem caso não aceita anexo", () => {
    expect(reviewUploadTarget({ target: null })).toBeNull();
    expect(reviewUploadTarget({ processId: PROCESS, target: null })).toBeNull();
  });
  it("revisão de caso: documento novo no caso; de processo: caso + processo", () => {
    expect(reviewUploadTarget({ legalCaseId: CASE, target: null })).toEqual({ kind: "new", legalCaseId: CASE });
    expect(reviewUploadTarget({ legalCaseId: CASE, processId: PROCESS, target: null })).toEqual({ kind: "new", legalCaseId: CASE, legalProcessId: PROCESS });
  });
  it("o destino passa no schema real de criação de documento (mesmo envio da aba Documentos)", () => {
    const target = reviewUploadTarget({ legalCaseId: CASE, processId: PROCESS, target: null });
    const input = { legalCaseId: target?.legalCaseId, legalProcessId: target?.legalProcessId, category: "BANK_STATEMENT", title: "Extrato" };
    expect(createDocumentSchema.safeParse(input).success).toBe(true);
  });
  it("pedido de documento do agente: categoria e nome pedidos já vêm preenchidos", () => {
    const target = proposal("REQUEST_DOCUMENT", { summary: "Falta o extrato", data: { category: "BENEFIT_STATEMENT", label: "  Extrato do benefício (HISCON)  ", required: true } });
    expect(reviewUploadTarget({ legalCaseId: CASE, target })).toEqual({ kind: "new", legalCaseId: CASE, defaultCategory: "BENEFIT_STATEMENT", defaultTitle: "Extrato do benefício (HISCON)" });
  });
  it("categoria fora do catálogo da tela, nome vazio ou outro tipo de proposta: sem preenchimento", () => {
    const unknown = proposal("REQUEST_DOCUMENT", { data: { category: "CATEGORIA_NOVA", label: "   " } });
    expect(reviewUploadTarget({ legalCaseId: CASE, target: unknown })).toEqual({ kind: "new", legalCaseId: CASE });
    const deadline = proposal("CREATE_DEADLINE", { data: { category: "PETITION", label: "Réplica" } });
    expect(reviewUploadTarget({ legalCaseId: CASE, target: deadline })).toEqual({ kind: "new", legalCaseId: CASE });
  });
  it("pedido sem o envelope { data }: lê o próprio payload; nome longo é cortado no limite do título", () => {
    const flat = proposal("REQUEST_DOCUMENT", { category: "ADDRESS_PROOF", label: "x".repeat(300) });
    const target = reviewUploadTarget({ legalCaseId: CASE, target: flat });
    expect(target?.defaultCategory).toBe("ADDRESS_PROOF");
    expect(target?.defaultTitle).toHaveLength(200);
  });
});

describe("anexar documento na revisão: textos e link", () => {
  it("link abre a aba Documentos do caso", () => {
    expect(caseDocumentsHref(CASE)).toBe(`/casos/${CASE}?aba=documentos`);
  });
  it("ajuda: a revisão continua aguardando a decisão só enquanto está aberta", () => {
    expect(attachHelpText("MINE")).toBe("O documento entra nos documentos do caso. A revisão continua aguardando a sua decisão.");
    expect(attachHelpText("OTHERS")).toBe("O documento entra nos documentos do caso. A revisão continua aguardando decisão.");
    expect(attachHelpText("NONE")).toBe("O documento entra nos documentos do caso.");
  });
  it("consulta dos documentos recentes passa no schema real: um escopo, mais novos primeiro", () => {
    const parsed = listDocumentsSchema.safeParse(recentCaseDocumentsInput(CASE));
    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({ legalCaseId: CASE, status: "ACTIVE", page: 1, column: "created_at", ascending: false });
  });
});

describe("documentos anexados nesta revisão", () => {
  const session = (documentId: string, attachedAt: string, title = "Comprovante"): SessionUpload => ({ documentId, title, attachedAt });

  it("sem envio e sem documento novo no caso: lista vazia", () => {
    expect(attachedDocuments([], [], CREATED)).toEqual([]);
    expect(attachedDocuments([], [caseDoc("old", "2026-11-01T09:00:00.000Z")], CREATED)).toEqual([]);
  });
  it("entra só arquivo ENVIADO ao caso depois da criação da revisão (agente, importação, arquivado e sem arquivo ficam fora)", () => {
    const docs = [
      caseDoc("a", "2026-11-11T09:00:00.000Z"),
      caseDoc("agent", "2026-11-11T10:00:00.000Z", { source: "AGENT" }),
      caseDoc("import", "2026-11-11T10:00:00.000Z", { source: "IMPORT" }),
      caseDoc("archived", "2026-11-11T10:00:00.000Z", { status: "ARCHIVED" }),
      caseDoc("empty", "2026-11-11T10:00:00.000Z", { noFile: true }),
      caseDoc("before", "2026-11-09T10:00:00.000Z"),
    ];
    expect(attachedDocuments([], docs, CREATED).map((d) => d.documentId)).toEqual(["a"]);
  });
  it("mais novos primeiro; o enviado nesta visita não repete quando o servidor já o lista", () => {
    const docs = [caseDoc("a", "2026-11-11T09:00:00.000Z"), caseDoc("b", "2026-11-12T09:00:00.000Z", { title: "Extrato" })];
    const list = attachedDocuments([session("b", "2026-11-12T09:00:05.000Z")], docs, CREATED);
    expect(list.map((d) => [d.documentId, d.fromThisVisit])).toEqual([
      ["b", true],
      ["a", false],
    ]);
    expect(list[0]).toMatchObject({ title: "Extrato", category: "BANK_STATEMENT", attachedAt: "2026-11-12T09:00:00.000Z" });
  });
  it("leitura do caso falhou ou ainda não chegou: o enviado nesta visita aparece mesmo assim", () => {
    expect(attachedDocuments([session("n", "2026-11-13T15:00:00.000Z")], [], CREATED)).toEqual([
      { documentId: "n", title: "Comprovante", attachedAt: "2026-11-13T15:00:00.000Z", fromThisVisit: true },
    ]);
  });
  it("fuso diferente no texto da data não muda a comparação", () => {
    const sameInstantOtherOffset = caseDoc("tz", "2026-11-10T09:00:00.000-03:00");
    expect(attachedDocuments([], [sameInstantOtherOffset], CREATED).map((d) => d.documentId)).toEqual(["tz"]);
  });
});
