import {
  Banknote,
  Bell,
  Briefcase,
  ClipboardCheck,
  ClipboardList,
  Handshake,
  Home,
  Landmark,
  UserRoundCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Audience, Permission } from "@/lib/permissions";

export type NavKey =
  | "home"
  | "clients"
  | "processes"
  | "reviews"
  | "finance"
  | "partners"
  | "dgbrasil"
  | "pending"
  | "notifications"
  | "account";

export interface NavItem {
  key: NavKey;
  label: string;
  href: string;
  description: string;
  icon: LucideIcon;
  permission: Permission;
  /** Ambiente em que o item aparece: interno (Bárbara Cardoso Advocacia) ou portal do parceiro. */
  audience: Audience;
}

/**
 * Navegação principal (menu da casa). O público escolhe o conjunto de itens;
 * a permissão decide o que aparece dentro dele.
 */
export const NAV_ITEMS: NavItem[] = [
  { key: "home", label: "Home", href: "/home", description: "Visão geral e o que precisa da sua atenção", icon: Home, permission: "home.view", audience: "OWNER" },
  { key: "clients", label: "Clientes", href: "/clientes", description: "Cadastro, documentos e análises jurídicas", icon: Users, permission: "clients.view", audience: "OWNER" },
  { key: "processes", label: "Processos", href: "/processos", description: "Acompanhamento, movimentações e prazos", icon: Briefcase, permission: "processes.view", audience: "OWNER" },
  { key: "reviews", label: "Revisões", href: "/revisoes", description: "Materiais dos agentes aguardando decisão", icon: ClipboardCheck, permission: "reviews.view", audience: "OWNER" },
  { key: "finance", label: "Financeiro", href: "/financeiro", description: "Honorários, recebimentos e contratos", icon: Banknote, permission: "finance.view", audience: "OWNER" },
  { key: "partners", label: "Parceiros", href: "/parceiros", description: "Escritórios parceiros, casos enviados e parcerias", icon: Handshake, permission: "partners.view", audience: "OWNER" },
  { key: "dgbrasil", label: "DG Brasil", href: "/dg-brasil", description: "Agentes, Skills, teses e histórico", icon: Landmark, permission: "dgbrasil.view", audience: "OWNER" },

  // Portal do parceiro: escopo e vocabulário próprios, sem áreas internas.
  { key: "home", label: "Início", href: "/home", description: "Seus casos e o que precisa da sua atenção", icon: Home, permission: "partnerPortal.view", audience: "PARTNER" },
  { key: "clients", label: "Clientes", href: "/clientes", description: "Clientes do seu escritório e novos cadastros", icon: Users, permission: "partnerPortal.view", audience: "PARTNER" },
  { key: "processes", label: "Processos", href: "/processos", description: "Andamento dos casos enviados", icon: Briefcase, permission: "partnerPortal.view", audience: "PARTNER" },
  { key: "pending", label: "Documentos e Pendências", href: "/pendencias", description: "Solicitações, documentos e respostas", icon: ClipboardList, permission: "partnerPortal.view", audience: "PARTNER" },
  { key: "finance", label: "Financeiro", href: "/financeiro", description: "Sua participação nos casos", icon: Banknote, permission: "partnerPortal.finance.view", audience: "PARTNER" },
  { key: "notifications", label: "Notificações", href: "/notificacoes", description: "Atualizações dos seus casos", icon: Bell, permission: "partnerPortal.view", audience: "PARTNER" },
  { key: "account", label: "Minha Conta", href: "/minha-conta", description: "Seus dados e usuários do escritório", icon: UserRoundCog, permission: "partnerPortal.view", audience: "PARTNER" },
];

export function navItemsFor(audience: Audience | undefined): NavItem[] {
  return NAV_ITEMS.filter((item) => item.audience === (audience ?? "OWNER"));
}

export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
