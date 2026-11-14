import { describe, expect, it } from "vitest";
import { isTallArea, TOUR_CARD_EST_H, tourLayout } from "./tour-position";

describe("tour: destaque e cartão sempre na tela (C4)", () => {
  it("área mais alta que a tela: destaque recortado e cartão dentro da tela, com o botão à vista", () => {
    const l = tourLayout({ top: -300, left: 40, width: 800, height: 1600, vw: 1366, vh: 768 }, 60);
    expect(l.hole.top).toBeGreaterThanOrEqual(60);
    expect(l.hole.top + l.hole.height).toBeLessThanOrEqual(768);
    expect(l.card.top).toBeGreaterThanOrEqual(60);
    expect(l.card.top + TOUR_CARD_EST_H).toBeLessThanOrEqual(768);
  });

  it("área pequena: cartão logo abaixo; sem espaço embaixo, logo acima", () => {
    const below = tourLayout({ top: 100, left: 40, width: 300, height: 80, vw: 1366, vh: 768 }, 60);
    expect(below.card.top).toBe(100 + 80 + 6 + 12);
    const above = tourLayout({ top: 600, left: 40, width: 300, height: 120, vw: 1366, vh: 768 }, 60);
    expect(above.card.top + TOUR_CARD_EST_H).toBeLessThanOrEqual(600 - 6);
  });

  it("área alta rola até o começo dela", () => {
    expect(isTallArea(900, 768)).toBe(true);
    expect(isTallArea(200, 768)).toBe(false);
  });
});
