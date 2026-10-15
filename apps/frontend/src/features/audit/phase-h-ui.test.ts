import { describe, expect, it } from "vitest";
import { listAuditEventsSchema } from "@/server/domain/audit/schemas";
import { listProcessesSchema } from "@/server/domain/processes/schemas";
import { updateOwnerOfficeSchema } from "@/server/domain/organizations/schemas";
import { deadlineCutoff } from "@/server/domain/processes/service";
import { notificationTarget, notificationTypeLabel } from "@/features/notifications/presentation";
import { officePatchToServer, parseOab } from "@/features/settings/office-input";
import { officeSchema } from "@/features/settings/schemas";
import { INPUT_MASKS } from "@/lib/formatting/masks";
import { processQueryFromSearchParams, processQueryToInput, DEFAULT_PROCESS_QUERY } from "@/features/processes/list-query";
import { actionLabel, eventDetail } from "./humanize";
import { auditTimelineInput } from "./query";

const UUID = "8f6c1f0e-3b7a-4d2c-9a51-2f4e5d6c7b8a";

describe("auditoria humanizada", () => {
  it("ação conhecida, com prefixo dinâmico e desconhecida", () => {
    expect(actionLabel("CASE_ACCEPTED")).toBe("Caso aceito");
    expect(actionLabel("AGENT_RUN_COMPLETED")).toBe("Execução de agente atualizada");
    expect(actionLabel("ALGO_NOVO")).toBe("Algo novo");
  });
  it("detalhe: situação de → para e campos alterados (sem updated_at/status)", () => {
    expect(eventDetail({ metadata: { from: "SUBMITTED", to: "ACCEPTED", fields: ["status", "updated_at"] }, metadataOmitted: false })).toBe("de enviado para aceito");
    expect(eventDetail({ metadata: { fields: ["title", "summary", "updated_at"] }, metadataOmitted: false })).toBe("campos: title, summary");
    expect(eventDetail({ metadata: {}, metadataOmitted: true })).toBeUndefined();
  });
  it("linha do tempo de um registro: entrada aceita pelo schema real", () => {
    expect(listAuditEventsSchema.parse(auditTimelineInput(UUID, 2))).toMatchObject({ entityId: UUID, page: 2, column: "created_at", ascending: false });
  });
});

describe("notificações — destino e rótulo", () => {
  it("o mais específico primeiro; parceiro vai para Pendências; sem referência, sem link", () => {
    expect(notificationTarget({ partnerRequestId: UUID, legalCaseId: UUID }, "PARTNER")).toEqual({ href: "/pendencias", label: "Ver pendências" });
    expect(notificationTarget({ partnerRequestId: UUID, legalCaseId: UUID }, "INTERNAL")?.href).toBe(`/casos/${UUID}?aba=documentos`);
    expect(notificationTarget({ processId: UUID, legalCaseId: UUID }, "INTERNAL")?.href).toBe(`/processos/${UUID}`);
    expect(notificationTarget({}, "INTERNAL")).toBeUndefined();
    expect(notificationTypeLabel("TIPO_NOVO_DO_BANCO")).toBe("Notificação");
  });
});

describe("processos — filtro de prazo e resumo", () => {
  it("vencidos = antes de agora; 5 dias = antes do início do 6º dia em São Paulo", () => {
    const now = new Date("2026-10-13T15:00:00Z");
    expect(deadlineCutoff("OVERDUE", now)).toBe("2026-10-13T15:00:00.000Z");
    expect(deadlineCutoff("NEXT_5_DAYS", now)).toBe("2026-10-19T03:00:00.000Z");
    // 01h UTC do dia 14 ainda é dia 13 em SP.
    expect(deadlineCutoff("NEXT_5_DAYS", new Date("2026-10-14T01:00:00Z"))).toBe("2026-10-19T03:00:00.000Z");
  });
  it("URL ?prazo=vencidos vira o filtro do servidor", () => {
    const q = processQueryFromSearchParams({ prazo: "vencidos" });
    expect(q.deadline).toBe("OVERDUE");
    expect(listProcessesSchema.parse(processQueryToInput(q))).toMatchObject({ deadline: "OVERDUE" });
    expect(processQueryFromSearchParams({ prazo: "x" })).toEqual(DEFAULT_PROCESS_QUERY);
  });
});

describe("Configurações → Geral (escritório real)", () => {
  it("OAB em texto ↔ estruturada", () => {
    expect(parseOab("OAB/SP 123.456")).toEqual({ state: "SP", number: "123456" });
    expect(parseOab("oab rj 9")).toEqual({ state: "RJ", number: "9" });
    expect(parseOab("")).toBeNull();
  });
  it("OAB do placeholder cabe inteira na máscara e nada é cortado sem aviso (QA 4.3, BUG-05)", () => {
    const typed = [..."OAB/SP 123.456"].reduce((acc, ch) => INPUT_MASKS.oab(acc + ch), "");
    expect(typed).toBe("OAB/SP 123.456");
    expect(parseOab(typed)).toEqual({ state: "SP", number: "123456" });
    expect(parseOab("SP 123456")).toEqual({ state: "SP", number: "123456" });
    // Inválido não vira "limpo" em silêncio: o formulário recusa com mensagem.
    for (const bad of ["123456", "OAB/XX 123", "OAB/SP 12345678901"]) {
      expect(parseOab(bad)).toBeNull();
      expect(officeSchema.shape.oab.safeParse(bad).success).toBe(false);
    }
    expect(officeSchema.shape.oab.safeParse("").success).toBe(true);
  });
  it("vazio limpa (null); endereço vazio = null; passa no schema real", () => {
    const patch = officePatchToServer({
      name: " Bárbara Cardoso Advocacia ",
      legalName: "",
      cnpj: "",
      oab: "OAB/SP 1",
      principalLawyer: "Bárbara",
      email: "",
      phone: "",
      website: "",
      zipCode: "",
      street: "",
      number: "",
      complement: "",
      district: "",
      city: "",
      state: "",
      statesOfPractice: ["SP", "SP"],
      units: "Sede\n\nFilial ",
    } as Parameters<typeof officePatchToServer>[0]);
    expect(patch).toMatchObject({ name: "Bárbara Cardoso Advocacia", legalName: null, email: null, address: null, units: ["Sede", "Filial"] });
    expect(updateOwnerOfficeSchema.parse(patch)).toMatchObject({ statesOfPractice: ["SP"], oab: { state: "SP", number: "1" } });
  });
});
