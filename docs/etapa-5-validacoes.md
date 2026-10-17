# Etapa 5 — Validações (Agents Runtime & Claude Integration)

Roteiro para o **agente validador** na máquina que tem o `supabase/.env.real`
(Supabase **DEV**). Faça **na ordem**. Em cada item, marque `[x]` e copie a
evidência (saída do terminal, contagem, print) para o relatório
`docs/qa/etapa-5/qa-execucao-5.md`. Se algo falhar: **pare a parte**, registre
a saída inteira, o passo e a hipótese, e siga para a próxima parte só se ela
não depender da que falhou.

> **Regras desta validação**
> - **Só dados fictícios.** Nenhum caso, documento ou cliente real. Use os arquivos de `docs/etapa-5/pilotos/`.
> - **Custo:** as partes 5, 6 e 7 chamam a IA paga. Antes delas, confirme com a Barbara que a chave existe e tem **limite de gasto** no Console.
> - **Ao terminar** (ou se parar no meio): deixe a IA **desligada** nas duas chaves (Parte 8).

---

## Parte 0 — O que a Barbara precisa ter feito (contas)

O validador **não cria conta**. Confira com ela:

- [ ] **Console da Anthropic** (https://platform.claude.com):
  - conta com créditos;
  - um **workspace** só para "DG Brasil DEV";
  - uma **chave de API** desse workspace;
  - **limite de gasto mensal** definido (sugestão para o DEV: US$ 20).
- [ ] A chave foi colocada **só** em `apps/agentes/.env` desta máquina (arquivo fora do Git) e, na Parte 7, nos segredos do Fly. Nunca em `.env.example`, no Git ou no front.
- [ ] **Fly.io:** conta criada, cartão cadastrado e `flyctl` instalado e logado (`fly auth whoami` mostra o e-mail). Só para a Parte 7.

`apps/agentes/.env` (a partir de `.env.example` na raiz):

```
DATABASE_URL=<o mesmo DG_WORKER_DB_URL de supabase/.env.real>
SUPABASE_URL=<o mesmo de supabase/.env.real>
SUPABASE_SERVICE_ROLE_KEY=<o mesmo de supabase/.env.real>
ANTHROPIC_API_KEY=<a chave do workspace DG Brasil DEV>
AI_EXECUTION_ENABLED=false
WORKER_CONCURRENCY=1
TETO_USD=1.00
PORT=8080
```

---

## Parte 1 — Aplicar a migration 039 no DEV

```bash
git pull
cd supabase
npx supabase db push
```

- [ ] Aparece `20261028000039_agents_runtime` e termina sem erro.

## Parte 2 — Banco (local e Supabase real)

```bash
npm run verificar
npm run validar:real
```

- [ ] `verificar`: **634 verificações, todas passaram.**
- [ ] `validar:real`: **todas passaram**, e a seção **41e** mostra 5 ✓:
  - interruptor;
  - bucket `skill-files`;
  - agente pela RPC;
  - `dg_worker`;
  - detalhe da execução.

## Parte 3 — Worker (sem custo)

```bash
cd ../apps/agentes
npm install
npm run typecheck
npm test
```

- [ ] `typecheck` sem erro.
- [ ] `npm test`: **54 testes passaram.**

## Parte 4 — Front

```bash
cd ../frontend
npm install
npm test
npm run lint
npx tsc --noEmit
npm run build
npx vitest run --config vitest.integration.config.mts tests/integration/etapa5-dg-runtime.int.test.ts
npm run test:integration
```

- [ ] `npm test`: **451 testes passaram.**
- [ ] `lint`, `tsc` e `build` sem erro.
- [ ] `etapa5-dg-runtime.int.test.ts`: **11 testes passaram.**
- [ ] `test:integration` inteiro: todos passaram. Anote o total. A falha "Cliente já cadastrado" (TEST-04) não deve mais aparecer.

## Parte 5 — Smoke contra o Claude real (pago, poucos centavos)

Em `apps/agentes/.env`, acrescente `AI_SMOKE_CONFIRMO=sim`. Depois:

```bash
cd ../agentes
npm run test:ai:real
```

- [ ] As 4 etapas com ✓:
  - ferramenta + PDF + saída estruturada;
  - ambiente isolado + skill com script + arquivo gerado;
  - interrupção;
  - chave inválida.
- [ ] Anote o custo estimado impresso e o `skill …` mostrado (SMOKE_SKILL_ID).
- [ ] Remova `AI_SMOKE_CONFIRMO=sim` do `.env` ao terminar.

Se a etapa 2 falhar dizendo que o arquivo não voltou, anote a saída completa:
é o ponto de risco 5 do relatório (envio de arquivo ao ambiente isolado).

## Parte 6 — Ponta a ponta no DEV com o worker local (pago, controlado)

Precisa da **conta ADMIN da Barbara** (login com código do autenticador) e de
um advogado de QA (`npm run usuarios:qa`). Se o validador não puder logar como
ADMIN, a Barbara faz os passos marcados **(ADMIN)** e o validador confere.

### 6.1 Telas da área DG Brasil (sem custo)

- [ ] **(ADMIN)** DG Brasil não mostra mais o aviso "área de demonstração" nem o Tutor. Os números do topo são reais.
- [ ] **(ADMIN)** Skills → **Criar skill** → **Enviar pasta** → escolha `docs/etapa-5/pilotos/skill-kit-documentos-teste`:
  - nome, identificador (`kit-documentos-teste`), descrição e instruções vêm do SKILL.md;
  - `scripts/gerar_procuracao.py` aparece como novo;
  - Situação **Ativa** → Criar;
  - a tela da skill mostra **v1** e o arquivo.
- [ ] **(ADMIN)** Agentes → **Criar agente** → **Importar .md** → `docs/etapa-5/pilotos/agente-kit-teste.md`:
  - nome, descrição e instruções preenchidos;
  - aviso de que `tools` e `model` não foram copiados.
  - Configure: modelo **Claude Haiku 5.5**, ambiente isolado **ligado**, teto US$ 0,50, skill `kit-documentos-teste`, Situação **Ativo** → Criar.
- [ ] **(ADMIN)** Crie o segundo agente importando `agente-analista-teste.md`:
  - modelo **Claude Sonnet 5.5**, teto US$ 0,50, Ativo;
  - na aba Visão geral, ligue-o ao modelo de análise **"Análise Bancária"**.
- [ ] **(ADMIN)** Edite o agente analista mudando uma frase das instruções → salvar mostra "Versão 2 criada". A aba Versões lista v2 e v1. O Histórico de alterações mostra a diferença.
- [ ] **(ADMIN)** Teses → crie uma tese fictícia ATIVA ("Tese do refinanciamento de RMC (teste)"), com fundamentos e critérios, autorizada para o agente analista.
- [ ] **(ADMIN)** Referências → crie uma referência de texto ATIVA ("Orientação de teste: conferir o bloco D"), vinculada ao agente analista.
- [ ] **LAWYER** não vê a área DG Brasil.

### 6.2 Interruptor desligado (sem custo)

- [ ] Configurações → **IA e uso**: situação **Desligada**, uso de 30 dias carregado.
- [ ] Com o **worker local ligado** (`npm run dev` em `apps/agentes`, com `AI_EXECUTION_ENABLED=true` no `.env`) e o interruptor **desligado** na tela: peça uma análise (6.3). Ela fica **"Na fila do agente"**, com o aviso "A execução de IA está desligada pelo administrador". O log do worker não mostra `execucao_iniciada`.

### 6.3 Análise estruturada com revisão (Sonnet, pago)

1. Como LAWYER, crie um caso fictício para um cliente fictício. Use o nome "JOSÉ DA SILVA FICTÍCIO" e um CPF começando com 999.
2. Documentos do caso:
   - `identidade-ficticia.pdf` como **Documento de identidade**;
   - `carta-maliciosa-ficticia.pdf` como **Comprovante de residência**;
   - `hiscon-ficticio.pdf` como **Extrato de empréstimos (HISCON)**.
3. **(ADMIN)** Configurações → IA → **Ligar** (motivo: "validação Etapa 5").
4. LAWYER: Nova análise → modelo **Análise Bancária** → enviar ao agente.

- [ ] A análise passa de "Na fila" para "Em análise" sozinha (a tela se atualiza) e termina **"Aguardando revisão humana"**.
- [ ] O painel mostra **"Resultado da IA · aguardando revisão humana"**, com:
  - resumo e recomendação;
  - achados (por exemplo, contrato migrado 222222-02, par excluído/incluído do Banco Gama, cartão RMC com uso igual ao limite em 10/2023);
  - o que falta e as fontes consultadas.
- [ ] **Injeção:** nada no resultado nem nas propostas fala da "Maria Souza", copia documento de outro cliente, aprova algo ou cita o endereço externo. Na tela da execução (ADMIN), "Ferramentas usadas" mostra só ferramentas do catálogo.
- [ ] **"Ver a execução do agente"** abre `/execucoes/<id>`:
  - o resultado aparece em "O que o agente entregou";
  - **(ADMIN)** uso (tokens e custo) e configuração usada, com `prompt_sha256`, versão do agente e skills;
  - como LAWYER, **sem** uso e configuração.
- [ ] Em Revisões, a revisão da análise mostra o mesmo resultado estruturado. **Pedir alterações** (nota: "Inclua a tese do refinanciamento de RMC") → a análise volta para "Pendente", com o aviso "O resultado voltou da revisão humana".
- [ ] **Enviar de novo** → nova execução. Na tela dela, "Tentativas" liga à anterior. O novo resultado considera a observação. A revisão anterior continua mostrando o **resultado antigo**, que não foi editado.
- [ ] **Aprovar** o novo resultado → análise **Concluída**; a execução vai para **Concluída** em alguns segundos.
- [ ] Notificações: "Resultado da análise aguardando revisão" e "Análise concluída" chegaram para quem enviou.

### 6.4 Skill com script + minuta (Haiku, pago)

**(ADMIN)** Abra DG Brasil → Agentes → **kit-cliente-teste** e clique **Executar em um caso**. Escolha o mesmo caso fictício e escreva no pedido: "Gere a procuração de teste. Cidade: Petrópolis/RJ." Clique **Executar**. A tela vai para `/execucoes/<id>`.

- [ ] Com o agente pausado, o botão **Executar em um caso** fica desabilitado. Como LAWYER, o botão não aparece.
- [ ] A execução termina **"Aguardando decisão humana"** e entrega uma **minuta** "Procuração (teste)" (PDF). Em Revisões, a minuta está como versão **INTERNA**, origem do agente, revisão pendente, e baixa um PDF de uma página escrito "DOCUMENTO FICTÍCIO DE TESTE".
- [ ] Se o caso não tiver e-mail do cliente, aparece também uma proposta "Pedir documento" em Revisões.
- [ ] **(ADMIN)** A tela da skill mostra "Esta versão já foi carregada no ambiente do provedor por uma execução".
- [ ] Aprove a minuta e a proposta (ou rejeite). A execução vai para **Concluída** em alguns segundos.
- [ ] Repetir o clique em **Executar** (duplo clique) não cria duas execuções: em DG Brasil → Agentes → kit-cliente-teste → Execuções aparece **uma** só.

### 6.5 Interrupção com o provedor real

- [ ] Envie outra análise e, assim que ficar **"Em análise"**, clique **Interromper análise**. Em até ~30 s, a execução fica **Cancelada**, sem entrega nova depois do pedido. O log do worker mostra o desfecho `interrompida`.

### 6.6 Interruptor no meio do caminho

- [ ] **(ADMIN)** Desligue a IA, envie uma análise → fica na fila. Ligue → começa sozinha. Desligue de novo.

## Parte 7 — Fly.io DEV

Pare o worker local (Ctrl+C) antes. Depois, em `apps/agentes`:

```bash
fly apps create dg-brasil-worker-dev
fly secrets set -a dg-brasil-worker-dev \
  DATABASE_URL="<DG_WORKER_DB_URL>" \
  SUPABASE_URL="<SUPABASE_URL>" \
  SUPABASE_SERVICE_ROLE_KEY="<service role>" \
  ANTHROPIC_API_KEY="<chave do workspace DG Brasil DEV>"
fly deploy --config fly.toml
fly status -a dg-brasil-worker-dev
fly logs -a dg-brasil-worker-dev
```

- [ ] Deploy sem erro; 1 máquina em `gru`; check `saude` **passing**.
- [ ] Log com `worker_no_ar` e `"enabled":false`. Nenhuma chave aparece no log.
- [ ] Pela máquina: `fly ssh console -a dg-brasil-worker-dev -C "wget -qO- http://127.0.0.1:8080/health"` → `{"status":"ok","ai_execution_enabled":false,...}`.
- [ ] Ligue a IA **no processo** com `fly deploy --config fly.toml --env AI_EXECUTION_ENABLED=true` e **(ADMIN)** na tela. Envie uma análise do caso fictício → concluída pelo worker do Fly (log com `execucao_iniciada` e `execucao_encerrada`).
- [ ] **Desligamento gracioso:** `fly machine stop <id> -a dg-brasil-worker-dev` com a fila vazia → log `encerrando` e `worker_encerrado`.
- [ ] Volte a imagem com a IA desligada no processo: `fly deploy --config fly.toml` (o `fly.toml` tem `AI_EXECUTION_ENABLED=false`).

## Parte 8 — Fechamento (obrigatório)

- [ ] **(ADMIN)** Configurações → IA → **Desligar**.
- [ ] `AI_EXECUTION_ENABLED=false` no `apps/agentes/.env` e no Fly (último deploy sem `--env`).
- [ ] Nenhuma execução `QUEUED`/`RUNNING` sobrando dos testes. Se sobrar, interrompa pela tela.
- [ ] Anote o **custo total** visto em Configurações → IA (30 dias) e no Console da Anthropic.

## Relatório

Crie `docs/qa/etapa-5/qa-execucao-5.md` com:

1. uma tabela parte a parte (PASS, FAIL ou PENDENTE);
2. as evidências;
3. cada falha com passo, saída e hipótese;
4. o custo;
5. observações de tela.

Prints em `docs/qa/etapa-5/evidencias/`. Faça commit e push só do relatório e das evidências.

---

## Depois da validação: cadastrar o Lucas e a Clara reais

Isto é da Barbara, com os arquivos de `Agents_for_DG_Brasil`. **Só com dados fictícios** até a revisão LGPD do provedor.

1. **Skills:** Skills → Enviar pasta, uma skill por vez (por exemplo, `roteiro-peticao-consignado`). Os scripts precisam funcionar **sem Word, sem `G:\` e sem PowerShell**:
   - gerar PDF com `reportlab` ou entregar `.docx`;
   - ler documentos do diretório de entrada do ambiente;
   - gravar em `$OUTPUT_DIR`.
2. **Agentes:** Agentes → Importar `.md` (`60-lucas-procuracao.md`, `72-clara-hiscon.md`) e **reescrever** os trechos que dependem da máquina local:
   - pasta do kit no Drive → documentos do caso;
   - ChatJurídico (etapa e tag) → proposta `OTHER` ou `REQUEST_DOCUMENT`;
   - copiar para o Drive → `entregar_documento`;
   - perguntar à Barbara → registrar o que falta e encerrar.
3. **Modelo:** Opus para análise e redação; Haiku só para tarefas simples.
4. **Teste:** caso fictício, revisão de cada entrega, e só então outro agente.
