import { Banknote, Briefcase, ClipboardCheck, Home, Landmark, Users, type LucideIcon } from "lucide-react";
import type { Permission } from "@/lib/permissions";

export type NavKey = "home" | "clients" | "processes" | "reviews" | "finance" | "dgbrasil";

export interface NavItem {
  key: NavKey;
  label: string;
  href: string;
  description: string;
  icon: LucideIcon;
  permission: Permission;
}

/** Navegação principal (menu da casa). A permissão decide o que aparece. */
export const NAV_ITEMS: NavItem[] = [
  { key: "home", label: "Home", href: "/home", description: "Visão geral e o que precisa da sua atenção", icon: Home, permission: "home.view" },
  { key: "clients", label: "Clientes", href: "/clientes", description: "Cadastro, documentos e análises jurídicas", icon: Users, permission: "clients.view" },
  { key: "processes", label: "Processos", href: "/processos", description: "Acompanhamento, movimentações e prazos", icon: Briefcase, permission: "processes.view" },
  { key: "reviews", label: "Revisões", href: "/revisoes", description: "Materiais dos agentes aguardando decisão", icon: ClipboardCheck, permission: "reviews.view" },
  { key: "finance", label: "Financeiro", href: "/financeiro", description: "Honorários, recebimentos e contratos", icon: Banknote, permission: "finance.view" },
  { key: "dgbrasil", label: "DG Brasil", href: "/dg-brasil", description: "Agentes, Skills, teses e histórico", icon: Landmark, permission: "dgbrasil.view" },
];

export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
