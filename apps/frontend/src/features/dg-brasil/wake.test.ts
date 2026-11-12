import { describe, expect, it } from "vitest";
import { describeWake, wakePollMs, WAKE_NO_ANSWER_MS, WAKE_RECENT_MS } from "./wake";

const T0 = Date.parse("2026-11-11T15:00:00Z");
const pedido = (status: "PENDING" | "ATTENDED" | "EXPIRED", extra: Record<string, string> = {}) => ({
  id: "w1",
  status,
  requestedAt: new Date(T0).toISOString(),
  requestedByName: "Lucas",
  ...extra,
});

describe('"Verificar agora": o que a tela diz', () => {
  it("sem pedido: nada (a tela mostra só a explicação do botão)", () => {
    expect(describeWake(undefined, T0)).toBeNull();
  });

  it('logo depois do clique: "pedido enviado", botão desabilitado e a tela continua perguntando', () => {
    const v = describeWake(pedido("PENDING"), T0 + 5_000)!;
    expect(v.text).toMatch(/^Pedido enviado às \d{2}:\d{2}\. Aguardando a Vigia/);
    expect([v.tone, v.waiting, v.pending]).toEqual(["info", true, true]);
  });

  it('sem resposta em 2 minutos: "a Vigia não respondeu (janela fechada?)", e ainda pode ser atendido', () => {
    const v = describeWake(pedido("PENDING"), T0 + WAKE_NO_ANSWER_MS + 1_000)!;
    expect(v.text).toMatch(/A Vigia não respondeu \(janela fechada\?\)/);
    expect([v.tone, v.waiting, v.pending]).toEqual(["warning", true, true]);
  });

  it('atendido: "atendido às HH:MM" (com o computador, quando o ADMIN vê) e para de perguntar', () => {
    const attendedAt = new Date(T0 + 12_000).toISOString();
    const v = describeWake(pedido("ATTENDED", { attendedAt, attendedByName: "Computador A" }), T0 + 15_000)!;
    expect(v.text).toMatch(/^Atendido às \d{2}:\d{2} pelo Computador A\./);
    expect([v.tone, v.waiting, v.pending]).toEqual(["success", false, false]);
    const semNome = describeWake(pedido("ATTENDED", { attendedAt }), T0 + 15_000)!;
    expect(semNome.text).toMatch(/^Atendido às \d{2}:\d{2}\. A Vigia/);
  });

  it("vencido (10 min sem ninguém): aviso para abrir a Vigia e pedir de novo; botão liberado", () => {
    const v = describeWake(pedido("EXPIRED"), T0 + 11 * 60_000)!;
    expect(v.text).toMatch(/não respondeu ao pedido das \d{2}:\d{2} \(janela fechada\?\)/);
    expect([v.tone, v.waiting, v.pending]).toEqual(["warning", false, false]);
  });

  it("pedido antigo vira só histórico", () => {
    const attendedAt = new Date(T0 + 12_000).toISOString();
    expect(describeWake(pedido("ATTENDED", { attendedAt }), T0 + WAKE_RECENT_MS + 60_000)!.tone).toBe("neutral");
    expect(describeWake(pedido("EXPIRED"), T0 + WAKE_RECENT_MS + 60_000)!.tone).toBe("neutral");
  });

  it("a tela pergunta a cada 3 s nos 2 primeiros minutos, depois a cada 10 s", () => {
    expect(wakePollMs(pedido("PENDING"), T0 + 1_000)).toBe(3_000);
    expect(wakePollMs(pedido("PENDING"), T0 + WAKE_NO_ANSWER_MS + 1)).toBe(10_000);
  });
});
