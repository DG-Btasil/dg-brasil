import { describe, expect, it } from "vitest";
import { settingsSchema, decideSchema } from "@/server/domain/judicial/schemas";
import { agentBlocker, CALENDAR_HELP, captureNotice, runSummary, waitingFor } from "./labels";

describe("publicação com o agente (062)", () => {
  it("há quanto tempo está com o agente: minutos, horas e dias, sem número negativo", () => {
    const now = new Date("2026-11-13T15:00:00Z");
    expect(waitingFor("2026-11-13T14:35:00Z", now)).toBe("25 minutos");
    expect(waitingFor("2026-11-13T14:59:40Z", now)).toBe("1 minuto");
    expect(waitingFor("2026-11-13T12:00:00Z", now)).toBe("3 horas");
    expect(waitingFor("2026-11-13T14:00:00Z", now)).toBe("1 hora");
    expect(waitingFor("2026-11-10T15:00:00Z", now)).toBe("3 dias");
    // Relógio do navegador atrasado em relação ao servidor: nunca "há -2 minutos".
    expect(waitingFor("2026-11-13T15:02:00Z", now)).toBe("1 minuto");
  });
  it("por que o agente não responde: execução desligada vem antes de computador desconectado; tudo certo ou sem informação = nada", () => {
    expect(agentBlocker({ executionEnabled: false, executorOnline: false })).toBe("A execução dos agentes está desligada.");
    expect(agentBlocker({ executionEnabled: true, executorOnline: false })).toBe("O computador do escritório não está conectado.");
    expect(agentBlocker({ executionEnabled: true, executorOnline: true })).toBeNull();
    expect(agentBlocker(undefined)).toBeNull();
  });
  it("entradas: tempo de espera de 1 a 72 horas inteiras; a ação de assumir a publicação é aceita", () => {
    expect(settingsSchema.safeParse({ agentTimeoutHours: 4 }).success).toBe(true);
    expect(settingsSchema.safeParse({ agentTimeoutHours: 72 }).success).toBe(true);
    expect(settingsSchema.safeParse({ agentTimeoutHours: 0 }).success).toBe(false);
    expect(settingsSchema.safeParse({ agentTimeoutHours: 73 }).success).toBe(false);
    expect(settingsSchema.safeParse({ agentTimeoutHours: 2.5 }).success).toBe(false);
    expect(settingsSchema.safeParse({}).success).toBe(true);
    const id = "3f2c1d7e-8a4b-4c6d-9e1f-2a3b4c5d6e7f";
    expect(decideSchema.safeParse({ id, action: "TAKE_OVER" }).success).toBe(true);
    expect(decideSchema.safeParse({ id, action: "OUTRA" }).success).toBe(false);
  });
});

describe("alerta da captura (062)", () => {
  const late = { late: true, title: "A busca de publicações não rodou hoje", message: "Nenhuma busca no DJEN começou hoje.", configProblem: "pg_net ou Vault indisponível" };
  it("captura atrasada: alerta vermelho para quem vê a integração, com o texto do servidor", () => {
    expect(captureNotice(late, false)).toEqual({ tone: "danger", title: late.title, message: late.message });
    expect(captureNotice({ late: true }, true)?.tone).toBe("danger");
  });
  it("agendador sem configuração: só para quem configura; em dia e configurado, nada", () => {
    const cfg = { late: false, configProblem: "segredos dg_app_url/dg_cron_secret ausentes" };
    expect(captureNotice(cfg, true)).toMatchObject({ tone: "warning", title: "O agendador da busca de publicações está sem configuração" });
    expect(captureNotice(cfg, true)?.message).toContain("segredos dg_app_url/dg_cron_secret ausentes");
    expect(captureNotice(cfg, false)).toBeNull();
    expect(captureNotice({ late: false }, true)).toBeNull();
    expect(captureNotice(undefined, true)).toBeNull();
  });
});

describe("textos da integração judicial", () => {
  it("resumo da rodada mostra os dias antigos relidos e o que ficou para o próximo lote", () => {
    expect(runSummary({ oabs: 2, oabsChecked: 2, publicationsNew: 3, djenBackfillWindows: 4, djenBackfillLeftForNextRun: 1 }))
      .toBe("2/2 OAB(s) · 3 publicação(ões) nova(s) · 4 período(s) antigo(s) relido(s) · 1 OAB(s) com dias antigos por ler");
    expect(runSummary({})).toBe("Nada novo");
    expect(runSummary(undefined)).toBe("—");
  });
  it("calendário de prazos: só o dia do tribunal inteiro; não promete mais que a data nunca sai depois da real", () => {
    expect(CALENDAR_HELP).toContain("TRIBUNAL INTEIRO");
    expect(CALENDAR_HELP).toContain("Feriado de uma cidade só não entra");
    expect(CALENDAR_HELP).toContain("DEPOIS da real");
    expect(CALENDAR_HELP).not.toMatch(/nunca depois/i);
  });
});
