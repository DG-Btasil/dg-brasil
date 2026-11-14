/**
 * Posição do destaque e do cartão do tour (puro, testado em tour-position.test.ts).
 *
 * Achado dos testes (C4): uma área mais alta que a tela (o painel "Precisa da
 * sua atenção" com muitos prazos) deixava o destaque passar das bordas e o
 * cartão ia para fora da tela (top negativo), sem o botão Próximo. Agora o
 * destaque é recortado na parte visível e o cartão fica sempre inteiro na
 * tela: embaixo da área, em cima dela ou, se não couber em nenhum dos dois,
 * no pé da tela, por cima da área.
 */

export interface TourMeasure {
  top: number;
  left: number;
  width: number;
  height: number;
  /** Largura e altura da janela. */
  vw: number;
  vh: number;
}

export const TOUR_PAD = 6;
export const TOUR_CARD_W = 360;
/** Altura estimada do cartão (o texto mais longo cabe nela). */
export const TOUR_CARD_EST_H = 210;
const GAP = 12;
const EDGE = 16;

export interface TourLayout {
  hole: { top: number; left: number; width: number; height: number };
  card: { top: number; left: number };
}

export function tourLayout(m: TourMeasure, topInset = 0): TourLayout {
  const minTop = Math.max(0, topInset) + 4;
  const top = Math.max(minTop, m.top - TOUR_PAD);
  const bottom = Math.min(m.vh - 4, m.top + m.height + TOUR_PAD);
  const hole = { top, left: m.left - TOUR_PAD, width: m.width + TOUR_PAD * 2, height: Math.max(0, bottom - top) };
  const left = Math.min(Math.max(EDGE, hole.left), Math.max(EDGE, m.vw - TOUR_CARD_W - EDGE));
  const need = TOUR_CARD_EST_H + GAP + EDGE;
  let cardTop: number;
  if (m.vh - bottom >= need) cardTop = bottom + GAP;
  else if (top - minTop >= need) cardTop = top - GAP - TOUR_CARD_EST_H;
  else cardTop = m.vh - TOUR_CARD_EST_H - EDGE;
  // Nunca fora da tela: o botão "Próximo" tem de estar sempre à vista.
  cardTop = Math.min(Math.max(minTop + EDGE, cardTop), Math.max(minTop + EDGE, m.vh - TOUR_CARD_EST_H - EDGE));
  return { hole, card: { top: cardTop, left } };
}

/** Área mais alta que a maior parte da tela: rola até o começo dela (o título fica visível), não até o meio. */
export const isTallArea = (height: number, vh: number) => height > vh * 0.6;
