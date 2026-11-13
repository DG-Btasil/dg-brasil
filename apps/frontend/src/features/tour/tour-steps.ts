import type { Permission } from "@/lib/permissions";

export interface TourStep {
  id: string;
  /** Âncoras `data-tour`, em ordem de preferência. Passo sem âncora na tela é pulado. */
  anchors: string[];
  title: string;
  text: string;
  permission?: Permission;
  /** Abre o menu da casa durante o passo (para mostrar um módulo). */
  openMenu?: boolean;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "home",
    anchors: ["home-kpis"],
    title: "Início: visão do escritório",
    text: "Os indicadores resumem o volume jurídico do escritório. Cada número leva à lista correspondente.",
  },
  {
    id: "attention",
    anchors: ["home-attention"],
    title: "Precisa da sua atenção",
    text: "Prazos vencidos e os que vencem nos próximos 5 dias aparecem aqui, dos mais urgentes para os menos urgentes.",
  },
  {
    id: "menu",
    anchors: ["nav-panel", "home-menu"],
    title: "Navegação pela casa",
    text: "Passe o mouse ou clique no ícone da casa, no topo, para abrir as áreas do escritório. Não há barra lateral.",
    openMenu: true,
  },
  {
    id: "clients",
    anchors: ["nav-clients"],
    title: "Clientes",
    text: "Em Clientes ficam o cadastro e os documentos de cada pessoa ou empresa atendida, com os casos de cada uma.",
    permission: "clients.view",
    openMenu: true,
  },
  {
    id: "cases",
    anchors: ["nav-cases"],
    title: "Casos",
    text: "Cada demanda do cliente é um caso. Aqui ficam a origem, a análise jurídica, o aceite e os processos ligados ao caso.",
    permission: "cases.view",
    openMenu: true,
  },
  {
    id: "processes",
    anchors: ["nav-processes"],
    title: "Processos",
    text: "Em Processos você acompanha andamentos, prazos e tarefas de cada ação.",
    permission: "processes.view",
    openMenu: true,
  },
  {
    id: "deadlines",
    anchors: ["nav-deadlines"],
    title: "Prazos",
    text: "Em Prazos fica a agenda de prazos do escritório, dos mais próximos para os mais distantes.",
    permission: "processes.view",
    openMenu: true,
  },
  {
    id: "publications",
    anchors: ["nav-publications"],
    title: "Publicações",
    text: "As intimações do DJEN chegam aqui. Cada uma é tratada: vira prazo ou é marcada como sem prazo.",
    permission: "processes.view",
    openMenu: true,
  },
  {
    id: "reviews",
    anchors: ["nav-reviews"],
    title: "Revisões",
    text: "Todo material produzido pelos agentes passa por aqui. Nada segue adiante sem a decisão de uma pessoa.",
    permission: "reviews.view",
    openMenu: true,
  },
  {
    id: "finance",
    anchors: ["nav-finance"],
    title: "Financeiro",
    text: "Honorários, recebimentos e contratos ligados a casos e processos. Visível apenas para administradores.",
    permission: "finance.view",
    openMenu: true,
  },
  {
    id: "partners",
    anchors: ["nav-partners"],
    title: "Parceiros",
    text: "Escritórios parceiros, os casos que eles enviam e a divisão de honorários de cada parceria.",
    permission: "partners.view",
    openMenu: true,
  },
  {
    id: "dgbrasil",
    anchors: ["nav-dgbrasil"],
    title: "DG Brasil",
    text: "Aqui ficam os agentes, as teses, as integrações e o computador do escritório, onde os agentes trabalham.",
    permission: "dgbrasil.view",
    openMenu: true,
  },
  {
    id: "notifications",
    anchors: ["notifications"],
    title: "Alertas",
    text: "Prazos, revisões aguardando e andamentos relevantes chegam como alertas, conforme o seu perfil.",
  },
  {
    id: "settings",
    anchors: ["settings"],
    title: "Configurações",
    text: "Dados do escritório, equipe, preferências de notificação, sua conta e segurança.",
    permission: "settings.view",
  },
  {
    id: "user-menu",
    anchors: ["user-menu"],
    title: "Seu menu",
    text: "Perfil, sessão e a opção de refazer esta introdução quando quiser.",
  },
];
