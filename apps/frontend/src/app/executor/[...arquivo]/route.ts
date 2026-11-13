/**
 * Arquivo pedido em /executor/ que NÃO existe em `public/executor` (os que
 * existem são servidos antes de chegar aqui). Responde 404 de verdade.
 *
 * Sem esta rota, o endereço cairia na rota coringa da área autenticada, que
 * manda quem não tem sessão para o login: o instalador do computador do
 * escritório (`instalar.ps1`) seguiria o redirecionamento e gravaria a página de
 * login no lugar do conector ou de um agente.
 */

export function GET() {
  return new Response("Arquivo não encontrado.\n", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
