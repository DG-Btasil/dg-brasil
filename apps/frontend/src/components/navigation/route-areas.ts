import { Settings, type LucideIcon } from "lucide-react";
import { NAV_ITEMS, isNavActive, type NavKey } from "./nav-config";

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
 * Subrotas herdam a área pai: /clientes/123 → Clientes.
 */
export const ROUTE_AREAS: RouteArea[] = [
  ...NAV_ITEMS.map((item) => ({
    key: item.key,
    label: item.key === "home" ? "Início" : item.label,
    href: item.href,
    icon: item.icon,
  })),
  { key: "settings", label: "Configurações", href: "/configuracoes", icon: Settings },
];

const HOME_AREA = ROUTE_AREAS.find((a) => a.key === "home") as RouteArea;

/** Área da rota atual (prefixo mais longo). Rotas desconhecidas caem em Início. */
export function resolveRouteArea(pathname: string): RouteArea {
  let match: RouteArea | undefined;
  for (const area of ROUTE_AREAS) {
    if (isNavActive(pathname, area.href) && (!match || area.href.length > match.href.length)) match = area;
  }
  return match ?? HOME_AREA;
}
