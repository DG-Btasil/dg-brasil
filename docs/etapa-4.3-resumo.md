# Etapas 4.3 e 4.3.1 — Resumo (concluídas)

**Status:** Front V1 ligado ao backend real, funcionalidades restauradas,
validado no Supabase DEV e no QA manual (2026-10-15/16). Os relatórios,
guias de validação e evidências detalhados foram removidos do repositório
depois da validação; continuam no histórico do git (até o commit `d4a6091`).

## O que foi entregue

**4.3 — Front V1 sem mocks (Fases A–H).** Clientes, casos, processos, prazos,
movimentações, documentos e pendências, parceiros, solicitações e Portal do
Parceiro, revisões e análises, financeiro, execuções de agente, notificações,
auditoria e Início lendo e gravando pelo servidor (Server Actions + RLS),
com paginação e filtros no servidor, idempotência por intenção de envio,
DTO próprio do parceiro e estados de carregando/vazio/erro em todas as telas.
Detalhes técnicos por domínio: [`frontend-integration.md`](frontend-integration.md).

**4.3.1 — Restauração com backend real.**

| Função | Onde |
|---|---|
| Produtor de notificações (gatilhos no banco, na mesma transação; sem duplicar; parceiro só do próprio escritório) | 037 |
| Preferências por categoria (Segurança sempre ligada; e-mail guardado para o futuro) | 037 |
| Edição manual na revisão = versão N+1 + revisão nova (versão N intacta) | 034 |
| Interromper análise/execução (fila para já; rodando, o worker confirma) | 033 |
| Cronograma de parcelas (centavos exatos, atômico, idempotente) | 035 |
| Valores da parceria (só leitura) e "contratado por modelo" | 035 |
| Histórico do caso e contagens por cliente no portal (sanitizados, só o escopo do escritório) | 036 |

## Migrations

`028`–`037`, todas aplicadas no DEV. (A `038` é da Etapa 4.3.2.)

| # | Conteúdo |
|---|---|
| 028 | Representantes e sócios de PJ (edição atômica) |
| 029 | Início atômico de análise |
| 030 | Ciclo de vida do acordo financeiro no banco |
| 031 | Execuções de agente paginadas |
| 032 | RLS do portal calculada uma vez por consulta (lista de clientes: 6,5–14 s → 49 ms) |
| 033–037 | 4.3.1 (tabela acima) |

## Validação final

| Verificação | Resultado |
|---|---|
| `supabase: npm run verificar` | 579 verificações |
| `frontend: npm test` | 425 testes (+ lint, typecheck e build limpos) |
| `agentes: npm test` | 34 testes |
| `validar:real` (DEV) | 129 verificações |
| `test:integration` (DEV) | 192 casos (as 4 falhas da 1ª rodada eram dos próprios testes; corrigidas em `d4a6091`) |
| QA manual (todos os papéis) | Aprovado; defeitos encontrados corrigidos (BUG-01 a 07) |

## Decisões que valem daqui para frente

- Postgres é a fonte única; o navegador nunca envia organização, papel,
  destinatário nem id de domínio.
- Nenhum uso novo de service role (só `team-actions` e
  `documents/signed-storage`, que só age em caminho autorizado pelo banco).
- Toda função nova `SECURITY DEFINER` com `search_path` vazio e sem EXECUTE
  para `anon` (conferido no verificador).
- Listas que precisam de tudo usam `loadAllPages` (páginas de 50): o
  servidor recusa página maior.
- Ferramentas de QA que ficam: `supabase: npm run usuarios:qa` (contas fixas
  de teste) e a limpeza automática do `validar:real`.

## Pendente para etapas futuras

- Auth/Security Hardening (sessões e dispositivos): feito na Etapa 4.3.2 — `docs/etapa-4.3.2-relatorio.md`.
- IA/Claude real e edição por IA; worker no Fly.io (os lembretes de prazo
  rodam no ciclo do worker ou no `pg_cron`).
- E-mail/SMTP (preferências de e-mail já guardadas).
- Integração judicial, importação, Google Drive.
- Áreas ainda de demonstração: configuração DG Brasil (agentes e afins),
  Integrações, Importação, Configurações → IA.
- Limpeza dos dados de teste acumulados no DEV (ou reset do DEV).
