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
    title: "Home: visão do escritório",
    text: "Os indicadores resumem o volume jurídico do escritório. Cada número leva à lista correspondente.",
  },
  {
    id: "attention",
    anchors: ["home-attention"],
    title: "Precisa da sua atenção",
    text: "Prazos próximos, análises bloqueadas e pendências aparecem aqui, das mais urgentes para as menos urgentes.",
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
    text: "Em Clientes ficam cadastro, documentos e análises jurídicas de cada pessoa ou empresa atendida.",
    permission: "clients.view",
    openMenu: true,
  },
  {
    id: "processes",
    anchors: ["nav-processes"],
    title: "Processos",
    text: "Em Processos você acompanha movimentações, prazos e o andamento de cada ação.",
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
    text: "Honorários, recebimentos e contratos ligados a clientes e processos. Visível apenas para administradores.",
    permission: "finance.view",
    openMenu: true,
  },
  {
    id: "dgbrasil",
    anchors: ["nav-dgbrasil"],
    title: "DG Brasil",
    text: "Na Central do DG Brasil você configura agentes, Skills e teses, e consulta o histórico de alterações.",
    permission: "dgbrasil.view",
    openMenu: true,
  },
  {
    id: "notifications",
    anchors: ["notifications"],
    title: "Alertas",
    text: "Prazos, revisões aguardando e movimentações relevantes chegam como alertas, conforme o seu perfil.",
  },
  {
    id: "settings",
    anchors: ["settings"],
    title: "Configurações",
    text: "Dados do escritório, equipe, integrações e preferências de notificação.",
    permission: "settings.view",
  },
  {
    id: "user-menu",
    anchors: ["user-menu"],
    title: "Seu menu",
    text: "Perfil, sessão e a opção de refazer esta introdução quando quiser.",
  },
];
