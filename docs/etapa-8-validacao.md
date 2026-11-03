# Validação: Etapa 8 — Integrações judiciais e prazos

**Para o agente validador na outra máquina.** Siga na ordem, sem pular parte, e
devolva o relatório no formato da seção final.

- **Escopo:**
  - migration 043;
  - busca no DJEN e no DataJud pelo servidor (`/api/cron/judicial-sync`);
  - actions `judicial.*`;
  - telas: Configurações → Integrações → Integração judicial, menu **Publicações**, processo (quadro "Acompanhamento automático" e aba "Publicações") e portal do parceiro (Minha Conta → OABs acompanhadas).
- **Como funciona (leia antes):** [judicial.md](judicial.md).

**Regras:**
- Use **só o Supabase DEV** (`DG_ENV=development`).
- Os testes automáticos usam **só dados fictícios** e simulam o DJEN e o DataJud.
- As Partes 5 e 6 consultam o DJEN de verdade com as OABs reais da Barbara:
  - isso só grava no DEV o **número** dos processos (público), nunca o teor nem nomes, porque nenhum processo real está cadastrado no DEV;
  - **não cadastre processo real no DEV**.
- Não mexa em dados que não foram criados por esta validação.
- Não digite a senha da Barbara. Telas: Playwright, como nas validações anteriores. A Barbara faz o login (ADMIN, com MFA) e você navega.

---

## Parte 0: Preparar

1. `git pull` e confira que o último commit é o da Etapa 8 ("judicial" ou posterior).
2. Caminho do repositório **sem acento**.
3. Node 24, Supabase CLI logada no projeto DEV, `supabase/.env.real` e `apps/frontend/.env.local` como antes.
4. **Nenhuma variável nova é obrigatória.** `DG_WORKER_DB_URL` e `CRON_SECRET` já existem; `DATAJUD_API_KEY` é opcional.

## Parte 1: Migration 043 no DEV

```bash
cd supabase
npx supabase db push --remote --dry-run    # deve listar SÓ 20261101000043_judicial_monitoring.sql
npx supabase db push --remote
```

- [ ] **Push sem erro.**
- [ ] **Agendamentos.** No SQL Editor:

  ```sql
  select jobname, schedule, active from cron.job where jobname like 'dg-%' order by jobname;
  ```

  Esperado, todos ativos:
  - `dg-datajud` (`*/20 * * * *`);
  - `dg-importacoes`;
  - `dg-lembretes-de-prazo`;
  - `dg-manutencao`.
- [ ] **Processos com CNJ viraram "acompanhados"**: a contagem abaixo é igual à de processos não excluídos com CNJ.

  ```sql
  select count(*) from process_external_refs where provider = 'DATAJUD';
  ```

## Parte 2: Banco

```bash
cd supabase
npm run verificar        # esperado: 763 verificações, todas passaram
npm run validar:real     # esperado: todas passaram (148 anteriores + 4 novas da seção 41i)
```

- [ ] `verificar`: 763/763. As seções "Integração judicial … [043]" cobrem:
  - OABs por escritório;
  - DJEN só para processo cadastrado;
  - sem duplicar;
  - cancelamento;
  - cobertura;
  - DataJud com linha de base;
  - contagem em dias úteis;
  - triagem;
  - agente → Revisões;
  - catálogo.
- [ ] `validar:real`: a seção **41i** passa. Anote a linha `pg_net … · resultado: …`. Sem pg_net ou sem os segredos do Vault ainda, o resultado esperado é `pg_net ou Vault indisponível` ou `segredos … ausentes` (a Parte 6 resolve).

## Parte 3: Site (front e servidor)

```bash
cd apps/frontend
npm test                    # esperado: 45 arquivos, 526 testes
npm run lint && npx tsc --noEmit -p .
npm run build               # a rota /publicacoes aparece na lista
npm run test:integration    # esperado: 32 arquivos (31 anteriores + judicial.int.test.ts com 7 testes)
```

- [ ] Unit 526/526. O arquivo `src/server/integrations/judicial/judicial.test.ts` (20 testes) cobre:
  - HTML do DJEN vira texto;
  - índice do DataJud por CNJ (inclusive `tre-df`);
  - paginação e limite 429 do DJEN;
  - hash de movimentação;
  - rodada.
- [ ] Lint, tsc e build sem erro.
- [ ] Integração 32 arquivos. Em `judicial.int.test.ts`:
  - processo acompanhado;
  - OABs (ADMIN, parceiro A, parceiro B isolado);
  - DJEN só no processo cadastrado;
  - parceiro A vê e é avisado, B não;
  - prazo a partir da publicação;
  - DataJud com linha de base e aviso;
  - calendário.

  O teste desliga o agente de prazos durante a execução, se houver um configurado, e o devolve no fim.

## Parte 4: Deploy

1. Confirme que o commit da Etapa 8 foi publicado na Vercel (deploy verde).
2. Na Vercel, em **Settings → Cron Jobs**, aparecem duas rotas:
   - `/api/cron/drive-sync` (`0 9 * * *`);
   - `/api/cron/judicial-sync` (`30 9 * * *`).
   - [ ] **As duas rotas aparecem.**
3. Chamada sem a senha de agendamento:
   ```bash
   curl -s -o /dev/null -w "%{http_code}" https://app.dgbrasil.adv.br/api/cron/judicial-sync
   ```
   - [ ] **Devolve `401`.**

## Parte 5: Telas e o DJEN real (Barbara logada como ADMIN, Playwright)

### 5.1 Configurações → Integrações → Integração judicial

- [ ] O painel aparece **acima** do Google Drive, sem aviso de "Demonstração" (o aviso agora vale só para "Outros serviços").
- [ ] **Adicionar OAB** `225006` / `RJ`, nome "Barbara Amaral Cardoso". Depois `548089` / `SP`.
  - Mensagem esperada: "OAB cadastrada".
  - Repetir a mesma OAB dá "OAB reativada" e não duplica.
- [ ] **Buscar agora.** Leva até ~60 s. Esperado:
  - mensagem "Busca concluída" (ou "com falhas", com o motivo);
  - na tabela "Últimas buscas", uma linha "Publicações e andamentos · pedida na tela";
  - na OAB RJ, a última busca com "N publicação(ões) na janela · 0 de processos do DG Brasil";
  - o link "N processo(s) com publicação que não estão no DG Brasil", que abre a lista só com números CNJ.

  Anote N. Em 2026-11-03, a OAB RJ tinha cerca de 280 publicações em 6 dias.
  - **Se der falha de rede ou HTTP 403 no DJEN:** é o risco de bloqueio por IP do servidor. Registre a mensagem exata no relatório. **Bloqueia.**
- [ ] **Cobertura** da OAB RJ: os últimos dias aparecem como "Conferido", com a quantidade por dia. Os de 2 ou mais dias atrás aparecem como "Conferido e assentado".
- [ ] **Calendário de prazos:** adicione `2099-12-31`, tribunal `TJXX`, "Teste validação". Ele aparece; depois remova.
- [ ] **Configuração:** salve "Dias revistos" = 5 e o agente = "Nenhum". Recarregue e confira que ficou.

### 5.2 Menu **Publicações**

- [ ] O item "Publicações" aparece no menu (equipe interna).
- [ ] "Todas a tratar" lista as publicações FICTÍCIAS criadas pelo teste de integração (`Intimação FICTÍCIA …`), se ainda não tratadas. Abra uma:
  - aparecem o teor, o processo, "Encontrada pela OAB AC 9…" e o link "Certidão do DJEN" (o link fictício não abre, e isso é esperado);
  - **Criar prazo**: os dias úteis vêm com 15 e o vencimento já calculado; trocar para 5 recalcula; mostra "Publicada em …" e os dias não contados;
  - crie o prazo. A publicação passa a "Tratada", e o prazo aparece em Processo → Prazos.
- [ ] Em outra publicação, **Não há prazo** sem motivo fica com o botão desabilitado. Com motivo, vira "Tratada / Sem prazo". **Reabrir** volta para "A tratar".

### 5.3 Processo

- [ ] Abra um processo fictício com CNJ.
  - "Visão geral" mostra o quadro **Acompanhamento automático** como "Ativo".
  - "Buscar andamentos agora" responde em até ~60 s. Para CNJ fictício, o esperado é o aviso "Processo ainda não aparece no DataJud…", e isso é correto.
  - "Pausar acompanhamento" troca para "Pausado"; retome em seguida.
- [ ] A aba **Publicações** do processo existe e lista só as dele.

### 5.4 Portal do parceiro

Use o usuário de teste PARTNER_ADMIN, como nas validações 4.3.x.

- [ ] Minha Conta mostra **OABs acompanhadas**. "Adicionar OAB" com um número fictício `9xxxxxx` / `AC` dá certo, e a OAB aparece sem nome de escritório.
- [ ] Com o PARTNER_USER, a lista aparece **sem** o botão "Adicionar OAB" e sem "Pausar".
- [ ] De volta como ADMIN, a OAB do parceiro aparece na tabela com o escritório e "Parceiro". **Pause** essa OAB fictícia no fim.

## Parte 6: Agendador do banco (lotes do DataJud) — com a Barbara

A Barbara faz no Supabase DEV ([deploy/producao.md](deploy/producao.md), item 10):
1. Liga `pg_net` em **Database → Extensions**.
2. Cria os dois segredos (`dg_app_url` = `https://app.dgbrasil.adv.br`, `dg_cron_secret` = o `CRON_SECRET` da Vercel).

Depois:

- [ ] `select private.judicial_cron_kick();` devolve `chamado` ou `nada a ler`.
- [ ] Se `chamado`: após ~1 min, `select status_code from net._http_response order by created desc limit 1;` devolve `200`, e em "Últimas buscas" aparece "Andamentos (lote)".
- [ ] Se faltar algo, registre e siga. Não bloqueia: o DataJud continua na rodada da manhã.

## Parte 7: Conferência com o APOGEU (um dia)

Só se você tiver o conector APOGEU DJEN disponível. Se não tiver, marque "não feito".

- [ ] Escolha um dia útil já "assentado" (2 ou mais dias atrás).
  - No DG Brasil: Cobertura da OAB RJ → quantidade daquele dia.
  - No APOGEU: `resumo_publicacoes` (ou `listar_publicacoes`) da OAB 225006/RJ no mesmo dia.
- [ ] Os números batem? Se não, liste a diferença (dia, quantidade de cada lado). Isso é o começo do ciclo de conferência em dupla ([judicial.md](judicial.md)) e não bloqueia esta validação.

## Parte 8: Fora desta validação (adiado por decisão)

- **Agente que propõe prazos rodando no computador do escritório**, com o arquivo [mcp/pilotos/agentes/prazos-dg.md](mcp/pilotos/agentes/prazos-dg.md):
  - fica para a ponta a ponta com o Claude Code no computador do escritório, que a Barbara adiou para o fim do projeto;
  - o caminho no banco (trabalho → proposta → Revisões → prazo) já é coberto pelo `verificar`.

---

## Relatório (formato de entrega)

Salve em `docs/qa/etapa-8/qa-etapa-8.md` e faça o commit:

```markdown
# QA — Etapa 8 (integrações judiciais e prazos)

Commit: <hash>. Data: <data>. Supabase DEV (<ref mascarado>). Máquina: <Windows/versão>.

## Resumo
| Parte | Status (PASS / FAIL / PASS com ressalva / não feito) | Evidência curta |
|---|---|---|
| 1 — Migration 043 e pg_cron | | |
| 2 — verificar / validar:real | | totais; linha pg_net |
| 3 — front (unit, lint, tsc, build, integração) | | totais |
| 4 — deploy e crons | | |
| 5.1–5.4 — telas e DJEN real | | N publicações na janela, tempo da busca |
| 6 — agendador do banco | | resultado do kick |
| 7 — conferência com o APOGEU | | dia, números |

## Problemas encontrados
Um bloco por problema: ID (JUD-01, …), parte, o que fez, o que esperava, o que
aconteceu (mensagem exata), gravidade (bloqueia / atrapalha / cosmético).
```
