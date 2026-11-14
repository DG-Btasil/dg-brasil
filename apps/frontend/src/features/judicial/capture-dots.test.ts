import { describe, expect, it } from "vitest";
import { datajudProcessDot, datajudSummaryDot, djenMonitorDot } from "./capture-dots";

// São Paulo = UTC−3 (sem horário de verão). 16/11/2026 é segunda-feira; 14 e 15/11, sábado e domingo.
const SP = (local: string) => new Date(`${local}-03:00`);

describe("bolinha do DJEN por OAB (074), validade hoje em São Paulo", () => {
  const monday10 = SP("2026-11-16T10:00:00");

  it("pausada é cinza, mesmo conferida hoje", () => {
    expect(djenMonitorDot({ active: false, lastSuccessAt: SP("2026-11-16T09:00:00").toISOString(), now: monday10 })).toEqual({ tone: "neutral", label: "Pausada" });
  });

  it("busca concluída hoje é verde", () => {
    expect(djenMonitorDot({ active: true, lastSuccessAt: SP("2026-11-16T09:00:00").toISOString(), now: monday10 })).toEqual({ tone: "success", label: "Conferida hoje" });
  });

  it("virada do dia é a de São Paulo, não a de UTC", () => {
    // 23:30 de segunda em SP já é terça em UTC: a busca das 06:00 de segunda ainda é de hoje.
    expect(djenMonitorDot({ active: true, lastSuccessAt: SP("2026-11-16T06:00:00").toISOString(), now: SP("2026-11-16T23:30:00") }).tone).toBe("success");
    // 00:30 de terça em SP: a de segunda não vale mais, e ainda é cedo.
    expect(djenMonitorDot({ active: true, lastSuccessAt: SP("2026-11-16T06:00:00").toISOString(), now: SP("2026-11-17T00:30:00") })).toEqual({ tone: "warning", label: "Ainda não conferida hoje" });
    // Domingo 23:00 em SP é segunda em UTC: não conta como segunda.
    expect(djenMonitorDot({ active: true, lastSuccessAt: SP("2026-11-15T23:00:00").toISOString(), now: monday10 })).toEqual({ tone: "danger", label: "Sem conferência hoje" });
  });

  it("busca entre 00:00 e 05:00 não conta como conferida no dia, como no servidor (062)", () => {
    expect(djenMonitorDot({ active: true, lastSuccessAt: SP("2026-11-16T04:59:00").toISOString(), now: monday10 }).tone).toBe("danger");
    expect(djenMonitorDot({ active: true, lastSuccessAt: SP("2026-11-16T05:00:00").toISOString(), now: monday10 }).tone).toBe("success");
  });

  it("dia útil: antes das 08:00 é amarelo; a partir das 08:00 é vermelho", () => {
    expect(djenMonitorDot({ active: true, now: SP("2026-11-16T07:59:00") })).toEqual({ tone: "warning", label: "Ainda não conferida hoje" });
    expect(djenMonitorDot({ active: true, now: SP("2026-11-16T08:00:00") })).toEqual({ tone: "danger", label: "Sem conferência hoje" });
    expect(djenMonitorDot({ active: true, lastSuccessAt: SP("2026-11-13T09:00:00").toISOString(), now: SP("2026-11-16T08:00:00") }).tone).toBe("danger");
  });

  it("fim de semana sem busca hoje é cinza; com busca hoje, verde", () => {
    expect(djenMonitorDot({ active: true, lastSuccessAt: SP("2026-11-13T09:00:00").toISOString(), now: SP("2026-11-14T10:00:00") })).toEqual({ tone: "neutral", label: "Fim de semana" });
    expect(djenMonitorDot({ active: true, now: SP("2026-11-15T20:00:00") })).toEqual({ tone: "neutral", label: "Fim de semana" });
    expect(djenMonitorDot({ active: true, lastSuccessAt: SP("2026-11-14T06:00:00").toISOString(), now: SP("2026-11-14T10:00:00") }).tone).toBe("success");
  });

  it("DJEN desligado é cinza, a qualquer hora", () => {
    expect(djenMonitorDot({ active: true, now: monday10, djenEnabled: false })).toEqual({ tone: "neutral", label: "DJEN desligado" });
    expect(djenMonitorDot({ active: true, now: SP("2026-11-16T07:00:00"), djenEnabled: false }).tone).toBe("neutral");
  });

  it("dia útil em que o servidor não cobra a busca (feriado: capture.applies falso) é cinza; quando cobra, vermelho", () => {
    expect(djenMonitorDot({ active: true, now: monday10, djenEnabled: true, captureApplies: false })).toEqual({ tone: "neutral", label: "Dia sem expediente" });
    expect(djenMonitorDot({ active: true, now: monday10, djenEnabled: true, captureApplies: true }).tone).toBe("danger");
  });
});

describe("bolinha do DataJud por processo (074), validade 24 h", () => {
  const now = new Date("2026-11-16T15:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const H = 3_600_000;
  const base = { hasCnj: true, tracked: true, now };

  it("sem número CNJ ou pausado é cinza (pausado mesmo com erro antigo)", () => {
    expect(datajudProcessDot({ ...base, hasCnj: false, tracked: false })).toEqual({ tone: "neutral", label: "Sem número CNJ" });
    expect(datajudProcessDot({ ...base, tracked: false, lastError: "Tempo esgotado", lastSyncedAt: ago(50 * H) })).toEqual({ tone: "neutral", label: "Acompanhamento pausado" });
  });

  it("erro na última leitura é vermelho, mesmo lido há pouco", () => {
    expect(datajudProcessDot({ ...base, lastSyncedAt: ago(H), lastError: "Tempo esgotado" })).toEqual({ tone: "danger", label: "A última leitura falhou" });
  });

  it("acompanhado e ainda não lido é amarelo", () => {
    expect(datajudProcessDot(base)).toEqual({ tone: "warning", label: "Ainda não lido" });
  });

  it("ainda não aparece no DataJud (075) é amarelo, nunca lido ou lido há tempo; os outros tipos continuam vermelhos", () => {
    const naoAparece = "Processo ainda não aparece no DataJud (a cópia pública atrasa semanas).";
    expect(datajudProcessDot({ ...base, lastError: naoAparece, lastErrorKind: "NOT_FOUND" })).toEqual({ tone: "warning", label: "Ainda não aparece no DataJud" });
    expect(datajudProcessDot({ ...base, lastError: naoAparece, lastErrorKind: "NOT_FOUND", lastSyncedAt: ago(50 * H) }).tone).toBe("warning");
    expect(datajudProcessDot({ ...base, lastError: "Tempo esgotado", lastErrorKind: "TRANSIENT" })).toEqual({ tone: "danger", label: "A última leitura falhou" });
    expect(datajudProcessDot({ ...base, lastError: "Sem índice", lastErrorKind: "OTHER" }).tone).toBe("danger");
    // Pausado continua cinza; tipo sem erro (não acontece) não vale.
    expect(datajudProcessDot({ ...base, tracked: false, lastError: naoAparece, lastErrorKind: "NOT_FOUND" }).tone).toBe("neutral");
    expect(datajudProcessDot({ ...base, lastErrorKind: "NOT_FOUND", lastSyncedAt: ago(H) }).tone).toBe("success");
  });

  it("banco sem a 075 (sem o tipo): todo erro é vermelho, como antes", () => {
    expect(datajudProcessDot({ ...base, lastError: "Processo ainda não aparece no DataJud (a cópia pública atrasa semanas)." }).tone).toBe("danger");
  });

  it("lido há 1 h é verde; 24 h exatas ainda é verde; depois disso, vermelho", () => {
    expect(datajudProcessDot({ ...base, lastSyncedAt: ago(H) })).toEqual({ tone: "success", label: "Lido nas últimas 24 h" });
    expect(datajudProcessDot({ ...base, lastSyncedAt: ago(24 * H) }).tone).toBe("success");
    expect(datajudProcessDot({ ...base, lastSyncedAt: ago(24 * H + 1000) })).toEqual({ tone: "danger", label: "Sem leitura há mais de 24 h" });
    expect(datajudProcessDot({ ...base, lastSyncedAt: ago(30 * H) }).tone).toBe("danger");
  });
});

describe("resumo do DataJud em Integrações (074)", () => {
  it("todos lidos e nenhum com falha é verde", () => {
    expect(datajudSummaryDot({ datajudEnabled: true, tracked: 12, withError: 0, syncedLast24h: 12 })).toMatchObject({ tone: "success", text: "12 de 12 processos lidos nas últimas 24 h · 0 com falha" });
  });

  it("falta ler algum é amarelo; com falha é vermelho, mesmo com todos lidos", () => {
    expect(datajudSummaryDot({ datajudEnabled: true, tracked: 12, withError: 0, syncedLast24h: 10 }).tone).toBe("warning");
    expect(datajudSummaryDot({ datajudEnabled: true, tracked: 12, withError: 1, syncedLast24h: 12 })).toMatchObject({ tone: "danger", text: "12 de 12 processos lidos nas últimas 24 h · 1 com falha" });
  });

  it("DataJud desligado é cinza; nenhum acompanhado também, com o texto próprio", () => {
    expect(datajudSummaryDot({ datajudEnabled: false, tracked: 12, withError: 3, syncedLast24h: 0 })).toMatchObject({ tone: "neutral", label: "DataJud desligado" });
    expect(datajudSummaryDot({ datajudEnabled: true, tracked: 0, withError: 0, syncedLast24h: 0 })).toMatchObject({ tone: "neutral", text: "Nenhum processo acompanhado" });
  });

  it("banco sem a 074 (campo ausente): só acompanhados e falhas, sem verde", () => {
    expect(datajudSummaryDot({ datajudEnabled: true, tracked: 12, withError: 0 })).toMatchObject({ tone: "warning", text: "12 processos acompanhados · 0 com falha" });
    expect(datajudSummaryDot({ datajudEnabled: true, tracked: 12, withError: 2 }).tone).toBe("danger");
    expect(datajudSummaryDot({ datajudEnabled: true, tracked: 0, withError: 0 }).tone).toBe("neutral");
  });

  it("singular", () => {
    expect(datajudSummaryDot({ datajudEnabled: true, tracked: 1, withError: 0, syncedLast24h: 1 }).text).toBe("1 de 1 processo lido nas últimas 24 h · 0 com falha");
    expect(datajudSummaryDot({ datajudEnabled: true, tracked: 1, withError: 0 }).text).toBe("1 processo acompanhado · 0 com falha");
    expect(datajudSummaryDot({ datajudEnabled: true, tracked: 1, withError: 0, syncedLast24h: 0, notInDatajud: 1 }).text).toBe("0 de 1 processo lido nas últimas 24 h · 1 ainda não aparece no DataJud");
  });
});

describe("resumo do DataJud em Integrações com os que ainda não aparecem (075)", () => {
  const base = { datajudEnabled: true, tracked: 47 };

  it("cada parte depois da primeira só aparece com número maior que 0", () => {
    expect(datajudSummaryDot({ ...base, withError: 0, syncedLast24h: 47, notInDatajud: 0 }).text).toBe("47 de 47 processos lidos nas últimas 24 h");
    expect(datajudSummaryDot({ ...base, withError: 2, syncedLast24h: 3, notInDatajud: 0 }).text).toBe("3 de 47 processos lidos nas últimas 24 h · 2 com falha");
    expect(datajudSummaryDot({ ...base, withError: 0, syncedLast24h: 3, notInDatajud: 44 }).text).toBe("3 de 47 processos lidos nas últimas 24 h · 44 ainda não aparecem no DataJud");
    expect(datajudSummaryDot({ ...base, withError: 2, syncedLast24h: 3, notInDatajud: 42 }).text).toBe("3 de 47 processos lidos nas últimas 24 h · 2 com falha · 42 ainda não aparecem no DataJud");
  });

  it("o caso do DEV de 14/11: só os que não aparecem é amarelo, não vermelho", () => {
    expect(datajudSummaryDot({ ...base, withError: 0, syncedLast24h: 3, notInDatajud: 44 })).toMatchObject({
      tone: "warning",
      label: "Os que faltam ainda não aparecem no DataJud (a cópia pública atrasa semanas)",
    });
    // Falta ler algum além dos que não aparecem: amarelo, com o rótulo geral.
    expect(datajudSummaryDot({ ...base, withError: 0, syncedLast24h: 3, notInDatajud: 40 })).toMatchObject({ tone: "warning", label: "Há processo ainda não lido nas últimas 24 h" });
  });

  it("vermelho com falha; verde com todos lidos; cinza desligado ou sem acompanhados", () => {
    expect(datajudSummaryDot({ ...base, withError: 1, syncedLast24h: 3, notInDatajud: 43 }).tone).toBe("danger");
    expect(datajudSummaryDot({ ...base, withError: 0, syncedLast24h: 47, notInDatajud: 0 }).tone).toBe("success");
    expect(datajudSummaryDot({ ...base, datajudEnabled: false, withError: 0, syncedLast24h: 3, notInDatajud: 44 }).tone).toBe("neutral");
    expect(datajudSummaryDot({ datajudEnabled: true, tracked: 0, withError: 0, syncedLast24h: 0, notInDatajud: 0 })).toMatchObject({ tone: "neutral", text: "Nenhum processo acompanhado" });
  });

  it("banco sem a 075 (campo ausente): o texto da 074, com o \"· Z com falha\" sempre", () => {
    expect(datajudSummaryDot({ ...base, withError: 0, syncedLast24h: 47 }).text).toBe("47 de 47 processos lidos nas últimas 24 h · 0 com falha");
    expect(datajudSummaryDot({ ...base, withError: 44, syncedLast24h: 3 })).toMatchObject({ tone: "danger", text: "3 de 47 processos lidos nas últimas 24 h · 44 com falha" });
  });
});
