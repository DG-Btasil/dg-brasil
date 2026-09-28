import { Settings, type LucideIcon } from "lucide-react";
import type { Audience } from "@/lib/permissions";
import { isNavActive, navItemsFor, type NavKey } from "./nav-config";

export type RouteAreaKey = NavKey | "settings";

export interface RouteArea {
  key: RouteAreaKey;
  /** Rótulo exibido no header para a área atual. */
  label: string;
  href: string;
  icon: LucideIcon;
}

/**
 * Mapa central rota → rótulo → ícone. É a única fonte para o elemento do
 * header que indica "onde estou". Os ícones são os mesmos do menu da casa
 * (NAV_ITEMS), para que cada área tenha um único ícone em todo o produto.
 * Subrotas herdam a área pai: /clientes/123 → Clientes. Cada público
 * (interno × parceiro) tem o seu conjunto de áreas.
 */
function areasFor(audience: Audience): RouteArea[] {
  return [
    ...navItemsFor(audience).map((item) => ({
      key: item.key,
      label: item.key === "home" ? "Início" : item.label,
      href: item.href,
      icon: item.icon,
    })),
    ...(audience === "OWNER" ? [{ key: "settings" as const, label: "Configurações", href: "/configuracoes", icon: Settings }] : []),
  ];
}

export const ROUTE_AREAS: Record<Audience, RouteArea[]> = { OWNER: areasFor("OWNER"), PARTNER: areasFor("PARTNER") };

/** Área da rota atual (prefixo mais longo). Rotas desconhecidas caem em Início. */
export function resolveRouteArea(pathname: string, audience: Audience = "OWNER"): RouteArea {
  const areas = ROUTE_AREAS[audience];
  let match: RouteArea | undefined;
  for (const area of areas) {
    if (isNavActive(pathname, area.href) && (!match || area.href.length > match.href.length)) match = area;
  }
  return match ?? (areas.find((a) => a.key === "home") as RouteArea);
}
