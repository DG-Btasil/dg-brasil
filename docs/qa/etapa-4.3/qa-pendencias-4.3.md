# QA 4.3 — Pendências, bloqueios e ponto de retomada

## Ponto de retomada

- **Data:** 2026-10-15
- **Concluído:** **todo o QA executável** — lotes 0–15: ADMIN (A–H), LAWYER, ASSISTANT, PARTNER_ADMIN A,
  PARTNER_ADMIN B (isolamento inverso) e PARTNER_USER A. Consolidado: 132 PASS · 7 FAIL · 5 NOT_RUN.
- **Próximo passo:** corrigir BUG-04 (alto) e BUG-06; depois retestar F-02, F-03, F-04 (estorno), F-05,
  F-08, T-05 (contrato/recebimento) e A-08, B-06, H-05.
- **Como executar:** scripts Playwright em
  `C:\Users\MIGUEL\AppData\Local\Temp\claude\c--Users-MIGUEL-OneDrive-Programa--o-Meus-Projetos-dg-brasil\c8a52b0a-89f7-4fad-9f85-a387eb784964\scratchpad\pw\`
  (`lib.mjs`, `loteN.mjs`). Cada papel tem **perfil próprio** do Chrome (`profile-<papel>`): as sessões
  ficam isoladas e podem coexistir. Login: `node login.mjs <papel>`; você faz login + termos + MFA na
  janela, e nenhum script digita credenciais. Estado dos dados criados: `qa-state.json` na mesma pasta.

## Bloqueios

| # | Bloqueio | Situação |
|---|---|---|
| BL-01 | Ferramentas do Playwright MCP não carregadas nesta sessão do Claude Code. | Contornado: scripts Playwright por lote (mesmo motor). |
| BL-02 | Login com outros papéis exige você. | Resolvido: todos os papéis autenticados por você. |
| BL-03 | **BUG-04** impede criar contrato e operar obrigações e lançamentos. | F-02, F-03, F-05, F-08 e partes de T-05 e F-04 seguem bloqueados até a correção. |

## Testes por papel

Todos executados (ver lotes 10–15 em qa-execucao-4.3.md).

## NOT_RUN sem fixture possível nesta etapa

| Item | Motivo |
|---|---|
| C-10b, E-12, parte "proposta estrutural" de E-08 | Exigem minuta ou proposta estrutural gerada por agente; nenhuma IA executa nesta etapa. |
| E-04 | Nenhum modelo tem agente **e** documentos obrigatórios. Exigiria outra fixture (modelo com agente + checklist). |
| E-06 | Nenhum modelo ativo pede "Dados específicos". Exigiria modelo com campos. |
| A-01 (sub-item) | "Banco vazio" não é reproduzível no DEV compartilhado. |
| G-02 (sub-item) | 0 execuções "Concluída" no DEV. |

## Limpeza

1. **Feito:** bloco pós-QA do §6.2 — agente `qa-analise-43` INACTIVE, modelo inativo, 0 execuções na fila.
2. **Pendente (decisão sua, OBS-01):** cancelar as 9 execuções QUEUED dos agentes `teste-rmv…` do `validar:real`.
3. Dados QA43 (clientes, casos, processos, documentos, parceiro `QA43 Parceiro 8diz`, casos do portal)
   ficaram como histórico fictício; nada foi apagado indiscriminadamente.
