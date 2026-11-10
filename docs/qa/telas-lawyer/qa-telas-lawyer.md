# Telas do advogado (perfil LAWYER): relatório

**Quando:** 10/11/2026 · **Onde:** `app.dgbrasil.adv.br` (Supabase DEV), logado
como advogado de teste pela Barbara; navegação pelo Claude (Playwright), só
leitura · **Commit no ar:** `aafd134`.

**Resultado: APROVADA.** Tudo conforme as permissões do código
(`lib/permissions`: a central DG Brasil é só do ADMIN; o advogado trabalha com
os agentes dentro dos casos).

| Tela | Esperado | Visto | Resultado |
|---|---|---|---|
| DG Brasil → Computador do escritório (`/dg-brasil/computador`) | Só ADMIN | "Acesso restrito" (`lawyer-01-computador.png`) | OK |
| Central DG Brasil e Execuções da central (`/dg-brasil`, `/dg-brasil/execucoes`) | Só ADMIN (`dgbrasil.view`) | "Acesso restrito" | OK |
| Revisões (`/revisoes`) | Advogado vê e decide | Fila com 206 aguardando, filtros por tipo e prioridade (`lawyer-05-revisoes.png`) | OK |
| Caso → Análise | Resultado da IA marcado "não aprovado", achados, link para a revisão e para a execução; tabela das execuções do caso | Tudo presente, inclusive o achado da carta maliciosa (`lawyer-07-caso-analise.png`) | OK |
| Execução (`/execucoes/<id>`, aberta pelo caso) | Advogado abre: entregas, propostas e linha do tempo | Abre, com "Reservado por Computador principal" e os documentos abertos (`lawyer-10-execucao.png`) | OK |
| Caso → "Nova análise" | Disponível para quem tem `analyses.start` | Link para `/casos/<id>/analise/nova` | OK |
| Aviso de execução desligada ou sem computador | Aparece na análise que está na fila ou pronta para enviar | Código conferido (`analysis-panel.tsx`); a análise vista já estava em revisão, por isso sem aviso | OK (pelo código) |
| Cliente → Documentos → Pasta no Google Drive | Some para todos sem o Drive configurado; com ele, advogado liga a pasta | Painel ausente: Drive sem credencial no servidor (`lawyer-12-cliente-documentos.png`). Conferir de novo com a credencial | OK; rever com o Drive |

## Achados da mesma navegação (como ADMIN, antes de trocar de conta)

- **Computador principal:** último contato hoje às 14:17 com `dg-executor/1.1.0`:
  o script da Frente B rodou no escritório e o instalador novo reaproveitou o
  token. Estava "Desconectado" às 15:45 (a vigia não ficou aberta). A coleta do
  script chega numa branch `qa/ponte-frente-b-*` quando ele termina.
- **Interruptor geral da execução: DESLIGADO** desde 10/11/2026 00:05 ("fim da
  validação da máquina principal"). Precisa ser ligado antes de repetir a
  Frente B, senão nenhum trabalho é pego.
