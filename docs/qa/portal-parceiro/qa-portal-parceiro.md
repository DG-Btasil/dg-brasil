# Portal do parceiro logado: relatório

**Quando:** 10/11/2026 · **Onde:** `portal.dgbrasil.adv.br` (Supabase DEV), logado
pela Barbara com contas de teste do "Parceiro QA A"; navegação pelo Claude
(Playwright), só leitura · **Commit no ar:** `b22f8a5`.

Fecha a pendência do Roadmap 2.0 ("falta só conferir no portal, logado como
parceiro", [qa-roadmap-2.0.md](../roadmap-2.0/qa-roadmap-2.0.md)) e confere a
caixa única de OAB pedida hoje.

**Resultado: APROVADA.** Nenhum erro de console.

## Usuário comum do parceiro (PARTNER_USER)

| Ponto | Visto | Resultado |
|---|---|---|
| Início: 5 indicadores numa linha | 5 cartões na mesma altura, 255 px cada (clientes novos, enviados, aceitos, não aceitos, processos ativos) | OK |
| Financeiro | "Acesso restrito": o financeiro é só do administrador do parceiro | OK |
| Minha conta: Divisão padrão | Não aparece (só administrador) | OK |
| Minha conta: OAB | Só "OABs acompanhadas", sem "Minhas OABs"; sem botão de adicionar (só administrador) | OK |

## Administrador do parceiro (PARTNER_ADMIN)

| Ponto | Visto | Resultado |
|---|---|---|
| Início: 5 indicadores numa linha | Os mesmos 5 cartões numa linha, mais o bloco "Sua participação" (acumulada e disponível) (`portal-01-inicio.png`) | OK |
| Financeiro: "Sua participação no período" na largura toda | Bloco com 1323 px numa área de 1387 px (o resto é a margem) (`portal-02-financeiro.png`) | OK |
| Financeiro: texto da divisão por caso | "Percentual definido quando o caso foi criado."; o texto antigo "congelado no aceite" não aparece | OK |
| Minha conta → Divisão padrão | "Vale para os casos criados a partir de agora. Cada caso mantém a divisão de quando foi criado." (40% / 60%) (`portal-03-minha-conta.png`) | OK |
| Minha conta: OAB | Só "OABs acompanhadas", com o botão "Adicionar OAB"; "Minhas OABs" não aparece | OK |
