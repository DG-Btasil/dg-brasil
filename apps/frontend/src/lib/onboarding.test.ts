import { describe, expect, it } from "vitest";
import { firstCompletion, shouldOfferProductTour } from "./onboarding";

const base = { completedAt: null as string | null, pathname: "/home", promptDismissed: false, active: false };

describe("introdução do produto: uma vez por usuário", () => {
  it("usuário novo (sem data no banco) → oferece na Home", () => {
    expect(shouldOfferProductTour(base)).toBe(true);
  });
  it("concluída ou pulada (data no banco) → nunca mais oferece, em qualquer navegador", () => {
    expect(shouldOfferProductTour({ ...base, completedAt: "2026-10-13T10:00:00.000Z" })).toBe(false);
  });
  it("só na Home, e não por cima do próprio tour ou depois de fechado nesta visita", () => {
    expect(shouldOfferProductTour({ ...base, pathname: "/clientes" })).toBe(false);
    expect(shouldOfferProductTour({ ...base, active: true })).toBe(false);
    expect(shouldOfferProductTour({ ...base, promptDismissed: true })).toBe(false);
  });
  it("rever a introdução não muda a data da primeira conclusão", () => {
    const now = new Date("2026-10-13T12:00:00.000Z");
    expect(firstCompletion(null, now)).toBe("2026-10-13T12:00:00.000Z");
    expect(firstCompletion("2026-10-01T09:00:00.000Z", now)).toBe("2026-10-01T09:00:00.000Z");
  });
});
