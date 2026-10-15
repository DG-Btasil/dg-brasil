import { describe, expect, it } from "vitest";
import { can } from "@/lib/permissions";
import { defaultPreferences, preferencesFromRows, saveNotificationPreferencesSchema } from "@/server/domain/notifications/preferences";
import { notificationFromRow } from "@/server/domain/notifications/mappers";
import { visibleCategories } from "./categories";
import { notificationTarget, notificationTypeLabel } from "./presentation";

const UUID = "8f6c1f0e-3b7a-4d2c-9a51-2f4e5d6c7b8a";

describe("preferências de notificação (4.3.1, 037)", () => {
  it("padrão: tudo na plataforma, nada por e-mail, sem resumo; segurança travada", () => {
    const d = defaultPreferences();
    expect(d.categories.every((c) => c.inApp && !c.email)).toBe(true);
    expect(d.categories.find((c) => c.category === "SECURITY")?.locked).toBe(true);
    expect([d.digest, d.saved]).toEqual(["NONE", false]);
  });

  it("linhas do banco por categoria; segurança nunca aparece desligada; resumo desconhecido vira NONE", () => {
    const p = preferencesFromRows(
      [
        { notification_type: "DEADLINES", in_app: false, email: true },
        { notification_type: "SECURITY", in_app: false, email: false },
      ],
      "QUALQUER",
    );
    expect(p.categories.find((c) => c.category === "DEADLINES")).toMatchObject({ inApp: false, email: true });
    expect(p.categories.find((c) => c.category === "SECURITY")).toMatchObject({ inApp: true, locked: true });
    expect([p.digest, p.saved]).toEqual(["NONE", true]);
  });

  it("schema recusa categoria desconhecida e categoria repetida; nada de userId vindo do navegador", () => {
    expect(saveNotificationPreferencesSchema.safeParse({ categories: [{ category: "QUALQUER", inApp: true, email: false }], digest: "NONE" }).success).toBe(false);
    expect(
      saveNotificationPreferencesSchema.safeParse({
        categories: [
          { category: "CASES", inApp: true, email: false },
          { category: "CASES", inApp: false, email: false },
        ],
        digest: "NONE",
      }).success,
    ).toBe(false);
    expect(saveNotificationPreferencesSchema.parse({ categories: [], digest: "DAILY", userId: UUID })).not.toHaveProperty("userId");
  });

  it("cada perfil vê só as categorias que pode receber", () => {
    const of = (role: Parameters<typeof can>[0], surface: "INTERNAL" | "PARTNER") => visibleCategories(surface, (p) => can(role, p));
    expect(of("LAWYER", "INTERNAL")).toEqual(["CASES", "DEADLINES", "DOCUMENTS", "REVIEWS", "PARTNER_REQUESTS", "ANALYSES", "SECURITY"]);
    expect(of("ASSISTANT", "INTERNAL")).not.toContain("REVIEWS");
    expect(of("PARTNER_ADMIN", "PARTNER")).toEqual(["CASES", "DOCUMENTS", "PARTNER_REQUESTS", "FINANCE", "SECURITY"]);
    expect(of("PARTNER_USER", "PARTNER")).not.toContain("FINANCE");
  });
});

describe("avisos produzidos pelo banco (037) na tela", () => {
  const row = (over: Record<string, unknown> = {}) =>
    notificationFromRow({
      id: UUID,
      type: "REVIEW_ASSIGNED",
      title: "Revisão atribuída a você",
      message: null,
      severity: "INFO",
      legal_case_id: UUID,
      legal_process_id: null,
      partner_request_id: null,
      related_type: "review",
      related_id: UUID,
      read_at: null,
      created_at: "2026-10-01T10:00:00Z",
      ...over,
    } as never);

  it("rótulos dos tipos novos; destino específico (revisão, análise, prazo, repasse, execução)", () => {
    expect(notificationTypeLabel("DEADLINE_OVERDUE")).toBe("Prazo vencido");
    expect(notificationTypeLabel("TIPO_FUTURO")).toBe("Notificação");
    expect(notificationTarget(row(), "INTERNAL")?.href).toBe(`/revisoes/${UUID}`);
    expect(notificationTarget(row({ type: "ANALYSIS_COMPLETED", related_type: "analysis" }), "INTERNAL")?.href).toBe(`/casos/${UUID}?aba=analise`);
    expect(notificationTarget(row({ type: "DEADLINE_DUE_SOON", related_type: "deadline", legal_process_id: UUID }), "INTERNAL")?.href).toBe(`/processos/${UUID}?aba=prazos`);
    expect(notificationTarget(row({ type: "PARTNER_TRANSFER_PAID", related_type: "transfer", legal_case_id: null }), "PARTNER")?.href).toBe("/financeiro");
    expect(notificationTarget(row({ type: "AGENT_RUN_ATTENTION", related_type: "agent_run", legal_case_id: null }), "INTERNAL")?.href).toBe("/dg-brasil/execucoes");
  });

  it("parceiro nunca recebe link para revisão; relação desconhecida é ignorada", () => {
    expect(notificationTarget(row(), "PARTNER")?.href).toBe(`/casos/${UUID}`);
    expect(row({ related_type: "audit_event" })).toMatchObject({ relatedType: undefined, relatedId: undefined });
  });
});
