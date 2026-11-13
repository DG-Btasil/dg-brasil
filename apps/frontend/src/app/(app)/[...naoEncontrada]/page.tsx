import { notFound } from "next/navigation";

/**
 * Qualquer endereço que nenhuma outra rota atende cai aqui, DENTRO da área
 * autenticada: a pessoa vê "Página não encontrada" com o menu (`../not-found.tsx`)
 * em vez da tela solta. Quem não tem sessão nem chega aqui: o proxy manda para o
 * login antes. Rotas de API e arquivos de `public/` têm prioridade sobre esta.
 */
export default function CatchAllNotFound() {
  notFound();
}
