# QA: Roadmap 2.0 — fechamento do MVP

Executado em 2026-11-09 contra o Supabase DEV (`hcoigxkgrzaxpvmlkidb`) e o site
publicado `app.dgbrasil.adv.br`, que usa esse mesmo banco. Commit validado:
`4ed6d8d`. Guia: [roadmap-2.0-validacao.md](../../roadmap-2.0-validacao.md).

## 1. Resumo

**Veredito: APROVADO COM PENDÊNCIAS.** Nenhum defeito que bloqueie o uso foi
encontrado no que foi possível testar. O veredito não é "aprovado" porque ficaram
correções a fazer (seção 9) e a Parte 4, que é opcional.

| Item | Situação |
|---|---|
| Parte 1 — migrations 045–049 | Aprovada |
| Parte 2 — testes automáticos | Com ressalvas: integração só passa com fixtures ajustadas (R2-01), lint com 2 erros (R2-04) |
| Parte 3 — telas do escritório (ADMIN) | Aprovada, com achados menores |
| Parte 3 — portal do parceiro | Aprovada (PARTNER_ADMIN de teste), com achados menores |
| Parte 3 — convite até o primeiro acesso | Aprovada: teste manual do Miguel em 2026-11-09, com e-mail real, depois de corrigir o SMTP (R2-16) |
| Parte 4 — orquestrador ponta a ponta | Não feita (opcional, exige o computador do escritório) |

Skills usadas (`.claude/skills/`):

| Parte | Skill | Veredito |
|---|---|---|
| 1 | `ecc-database-migrations`, `ecc-postgres-patterns` | Dry-run listou só 045–049; o que é apagado confere com o aviso do guia. RLS, grants e `security_invoker` corretos nos objetos novos |
| 2 | `ecc-verification-loop` | Ver abaixo |
| 3 | `ecc-browser-qa` | **SHIP WITH FIXES** nas telas ADMIN e no portal; **INCONCLUSIVE** na regressão visual (não há prints de referência) |
| 3 | `ecc-e2e-testing` | Roteiros por bloco e prints nesta pasta |
| 3 | `ecc-security-review` | Sem falha encontrada no que foi revisado (seção 5) |
| Relatório | `ecc-production-audit` | Seção 6 |

```
VERIFICATION REPORT (ecc-verification-loop)
Build:     PASS  (clone em caminho sem acento)
Types:     PASS  (0 erros)
Lint:      FAIL  (2 erros, 997 avisos, todos em public/executor/dg-executor.mjs)
Tests:     FAIL no repositório (integração: 164 passam, 63 falham, 16 ignorados); PASS com fixtures ajustadas (243/243)
           Unitários 598/598, verificar 833/833, executor 13/13. Cobertura não medida.
Security:  PASS  (nenhum segredo no código; a única ocorrência é um valor fictício em teste)
Diff:      222 arquivos (64363fb..4ed6d8d), revisados por amostragem nos pontos de segurança
Overall:   NOT READY até resolver R2-01 e R2-04
Target:    VERIFIED parcial (Supabase DEV e site publicado; primeiro acesso do parceiro NOT PERFORMED)
```

## 2. Parte 1 e Parte 2

### Contagens antes e depois do push

| Medida | Antes | Depois |
|---|---|---|
| Status | ACTIVE 66, ARCHIVED 8, FILED 1, PRE_FILING 55, PREPARING 260, SUSPENDED 9 | Igual (não havia status antigo) |
| Fase | ARCHIVED 8, EVIDENCE 13, PLEADINGS 15, PRELIMINARY 55, nula 308 | ARCHIVED 8, **PROCEEDINGS 28**, PRELIMINARY 55, nula 308 |
| Clientes com responsável | 1.043 de 1.917 | Coluna removida (1.043 valores perdidos, dados fictícios) |
| `stable_union` preenchido | 0 de 1.789 | Coluna removida |
| Linhas alteradas | | **28** fases (13 EVIDENCE + 15 PLEADINGS); 0 status |

- Push sem erro. Nenhum valor antigo sobrou e as duas colunas saíram.
- Todos os objetos novos existem: 3 tabelas de domínio, 2 visões, `process_task_settings` e as 5 funções do guia.
- Contratos sem processo depois do push: ACTIVE 112 de 128, CANCELLED 41 de 41, COMPLETED 15 de 15, DRAFT 74 de 74.
- Nenhum rascunho ou ativo de caso com um único processo ficou sem `legal_process_id` (0 linhas), como o guia pede.

### Comandos

| Comando | Resultado |
|---|---|
| `npm run verificar` | **833/833** |
| `npm run validar:real` | **152/152**, depois de remover o cliente de R2-02 |
| `npm run typecheck` | Limpo |
| `npm run lint` | **2 erros**, 997 avisos (R2-04) |
| `npm test` (frontend) | **598/598** |
| `npm run test:integration` | **164 passam, 63 falham, 16 ignorados** (243), 14 arquivos com falha (R2-01) |
| Integração com fixtures ajustadas | **243 de 243** (226 na rodada completa; os 17 restantes passaram ao corrigir o ajuste e repetir 3 arquivos) |
| `npm test` (executor) | **13/13** |
| `npm run build` | OK, em clone sem acento no caminho |

As fixtures foram ajustadas **só num clone descartável**. Nenhum arquivo do
repositório foi alterado. Os testes de isolamento entre parceiros (IDOR/RLS) estão
entre os que passaram com o ajuste.

**PostgREST:** `/financeiro?aba=processos` e `?aba=despesas` abriram sem erro.

## 3. Achados

| ID | O quê | Onde | Como reproduzir | Gravidade | Print |
|---|---|---|---|---|---|
| R2-01 | 63 testes e 3 arquivos de integração falham porque as fixtures não acompanharam a 045: faltam os campos agora obrigatórios, `finance` cria contrato sem processo e `imports` lê a coluna apagada. Não é defeito do produto, mas a suíte fica inútil até corrigir | `apps/frontend/tests/integration/*` (`finance.int.test.ts:199`, `imports.int.test.ts:100`) | `npm run test:integration` | Incomoda | — |
| R2-02 | `validar:real` não roda: há 1 cliente fora do padrão de teste, criado em 2026-11-06 por `qa.advogado`, com 3 casos (id `55ced8af-f813-43a2-afbb-de900ed348d5`). Removido a pedido do Miguel; na segunda rodada, 152/152 | `supabase/tests/real/validar-real.mjs:96` | `npm run validar:real` | **Resolvido** em 2026-11-09 | — |
| R2-03 | Com o CPF desligado, o campo mostra "Consultando a Receita Federal…" por um instante e o navegador chama o servidor. O guia pede que nada seja consultado nem apareça aviso. A Receita não é chamada de fato | `features/lookup/use-autofill.ts:64` e `autofillHint` | Novo cliente PF (e novo caso no portal), digitar um CPF válido | Incomoda | `b6-cep-cpf.png` |
| R2-04 | O lint analisa o arquivo gerado e minificado do executor, que não está nos ignores | `apps/frontend/eslint.config.mjs`, `public/executor/dg-executor.mjs` | `npm run lint` | Cosmético | — |
| R2-05 | Diálogos altos não rolam. Em janela de 611 px de altura, "Nova despesa" termina em 682 px e o botão de confirmar fica inalcançável | Diálogo `position: fixed` sem `max-height` | Janela com menos de ~680 px de altura, Processo → Financeiro → Nova despesa | Incomoda | — |
| R2-06 | "Convidar parceiro" cria o escritório antes de validar o nome do contato: um erro de digitação deixa um escritório "Convite: …" inativo. O nome do escritório usa o e-mail, não o contato | `server/auth/team-actions.ts:433-435` | Convidar parceiro com número no nome | Incomoda | `b5-convite-parceiro-resultado.png` |
| R2-07 | Sem layout de celular ou tablet: `body` tem `min-width: 1024px` (desde o primeiro commit), com rolagem horizontal em 375 e 768 px. Pode ser decisão de produto | `src/app/globals.css:184` | Abrir em 375 px | Incomoda | `b1-login-375.png`, `b8-home-375.png` |
| R2-08 | Texto antigo: "Estados em que o escritório atua e unidades", embora o campo Unidades tenha saído | `features/settings/components/sections/office-form.tsx:101` | Configurações → Geral | Cosmético | `b5-atuacao-sem-unidades.png` |
| R2-09 | Acessibilidade (axe, WCAG 2.2 AA): contraste insuficiente em 3 a 29 elementos por tela; na Início, 2 elementos focáveis dentro de `aria-hidden` (gráficos) | 5 telas verificadas | Rodar axe-core | Cosmético | — |
| R2-10 | Falha única na criação de caso (erro interno) durante a integração; passou na repetição. Causa não identificada | `createCaseOnce`, teste "prazo: criar (data civil)…" | Não reproduzido | Incomoda | — |
| R2-11 | Resto de código: a importação ainda monta `client.responsible_user_id`. A migration ignora a chave | `server/domain/imports/normalize.ts:416` | Leitura de código | Cosmético | — |
| R2-16 | Convite por e-mail falhou com endereço real (Gmail); a mensagem diz "Nada foi criado", mas ficam escritórios inativos. O Auth tenta enviar e o SMTP falha; causa em aberto (seção 9) | Parceiros → Convidar parceiro; `server/auth/team-actions.ts:297` | Convidar com e-mail fora da equipe do projeto Supabase | **Resolvido** em 2026-11-09 (envio); falta corrigir a mensagem | — |
| R2-13 | No portal, depois do CEP o foco fica no próprio CEP; no escritório vai para o número, como o guia pede | `features/partner-portal/components/new-case-wizard.tsx:196` | Portal → Novo caso → digitar o CEP | Cosmético | `b6-portal-cep.png` |
| R2-14 | Telefone é obrigatório no cadastro do escritório e opcional no do portal. O roadmap não lista telefone entre os obrigatórios | Formulários de cliente | Comparar `/clientes/novo` e o assistente do portal | Cosmético | `b6-portal-cliente-novo.png` |
| R2-15 | Observado uma vez no portal: "Selecione o estado civil" continuou depois de escolher a opção, e o primeiro clique em Continuar não avançou; o segundo avançou sem mudar nada. Não reproduzido | Assistente de novo caso do portal | Enviar vazio, preencher, Continuar | Cosmético | — |
| R2-12 | 7 chaves estrangeiras novas sem índice (`created_by`, `agent_id`, `orchestrator_agent_id` etc.). Sem impacto no volume atual | `process_expenses`, `process_tasks`, `process_task_settings` | Consulta ao catálogo | Cosmético | — |

## 4. Telas (Parte 3)

Sem erro de console nem resposta 4xx/5xx nas 17 telas varridas (o único 404 foi
um endereço digitado por mim, `/dg-brasil/agentes`, que não é link do sistema).

**Bloco 1**
- OK — `/login`: olhinho mostra e esconde. Nova senha e primeiro acesso usam o mesmo componente, verificado **só no código**.
- OK — Indicadores da Início abrem filtrados (`?situacao=ativos`, `?situacao=aguardando`), em ~90 ms. O esqueleto de carregamento não foi capturado.
- OK — Documentos: área com alça de redimensionar e menu "Mais" inteiro por cima (`b1-documentos-mais.png`).
- OK — PF com tipo, emissor e UF, sem número, salva (`b1-cliente-sem-numero-doc.png`).
- OK — "Data do prazo" (`b1-prazo-data.png`).
- OK — Novo caso sem "Tipo", no escritório e no portal (`b1-novo-caso-sem-tipo.png`, `b1-portal-novo-caso.png`).

**Bloco 2**
- OK — PF e PJ exigem os campos pedidos, sem os removidos (`b2-cliente-pf-obrigatorios.png`).
- OK — Lista filtra por Canal (2.100 → 1) e mostra a coluna.
- OK — Ficha do caso separa canal e origem; caso sem canal herdou o do cliente.
- OK — Novo processo sem nome resumido e vencimento, com honorários; aparece com o nome do caso (`b2-ficha-processo.png`).
- OK — Status e fases com os nomes novos.
- OK — "Informações adicionais para os agentes" aparece no detalhe da análise (`b2-analise-detalhe.png`).

**Bloco 3**
- OK — Abas e indicadores do Financeiro (`b3-financeiro-visao.png`).
- OK — Processo → Financeiro: cartões, nova despesa, marcar como paga, cancelar exige motivo (`b3-despesas.png`).
- OK — Contrato ligado ao processo; o segundo ATIVO é recusado com mensagem clara (`b3-segundo-contrato-recusado.png`).
- OK — `?secao=honorarios` leva a Financeiro → Modelos.

**Bloco 4**
- OK — Escolher orquestrador (`b4-orquestrador.png`).
- OK — Na fila → Agente trabalhando → Para revisar → Concluída, riscada, com movimentação (`b4-*.png`).
- OK — Devolver cria a 2ª tentativa com nova execução; Cancelar exige motivo.
- Não feito — `/mcp__dg-brasil__trabalhos` (exige o computador do escritório).

**Bloco 5**
- OK — Minhas OABs: adicionar duas, tornar principal, remover (`b5-minhas-oabs.png`).
- OK — Advogado exige OAB; Administrador tem "É advogado(a)" e OAB opcional (`b5-convite-exige-oab.png`).
- OK — Geral → Atuação sem "Unidades" (ver R2-08).
- OK — Convidar parceiro: com e-mail real, Miguel aceitou o convite e informou que o primeiro acesso funcionou. O agente não acompanhou esse teste na tela. Em endereço `@dgbrasil.test` o e-mail não sai: o convite é revogado e o escritório fica inativo.
- OK — Portal → Pendências → Anexar documento: a resposta aparece com "Documento anexado", e o documento fica no caso (`b5-portal-documento-anexado.png`, `b5-portal-doc-no-caso.png`). Solicitação criada nesta validação.

**Bloco 6**
- OK — CEP preenche e o foco vai para o número. CNPJ preenche razão social, fantasia, telefone e sede (`b6-*.png`).
- **FALHA parcial** — CPF: nada vai à Receita, mas há aviso e chamada ao servidor (R2-03).
- OK — Portal → Novo caso: CEP e CNPJ preenchem (`b6-portal-cep.png`, `b6-portal-cnpj.png`), com as diferenças de R2-13 e R2-03.

**Bloco 7**
- OK — Conexões com os 6 cartões e a situação de cada um (`b7-dg-conexoes.png`).
- OK — Abas novas; `?secao=ia` e `?secao=integracoes` redirecionam.
- OK — Autorizar computador mostra um comando e o token (print mascarado). O token de teste foi revogado.
- OK — `instalar.ps1` e `dg-executor.mjs` abrem sem login e são idênticos aos do repositório.
- Não feito — Rodar o instalador num Windows de teste (opcional).

**Bloco 8**
- OK — Início: gráfico de entradas, distribuição com status novos e "O escritório em números" (`b8-home.png`).
- OK — Indicadores com filtro em Clientes (863 em 7 dias contra 2.097 em 30), Casos, Processos e Parceiros.
- OK — Portal (PARTNER_ADMIN do "Parceiro QA A"): Início com "Seu escritório em números" e Financeiro com "Participação no período" (`b8-portal-home.png`, `b8-portal-financeiro.png`). Os números batem com o banco (9 casos em 30 dias, 3 processos ativos, R$ 120,00) e o filtro de período responde.

**Parte 4:** não feita.

## 5. Segurança (`ecc-security-review`)

- Rotas protegidas sem sessão redirecionam ao login; `/api/executor/v1` e o cron devolvem 401.
- `/executor/` não expõe listagem nem arquivos fora dos dois públicos (`.env` e travessia dão 404).
- O instalador pede o token de forma mascarada e restringe o arquivo à conta do Windows. Ele baixa o conector por HTTPS sem conferir hash, o que é aceitável com a origem própria.
- Convites: token só em hash no banco, uso único e verificação do e-mail da sessão. `set_invitation_oab` só para service role; `create_partner_invite_office` confere ADMIN no banco.
- OABs e funções novas: `search_path` vazio, sem execução para `anon`.
- `process_finance_*` usam `security_invoker`; `process_expenses` só para ADMIN; `get_dashboard_metrics` respeita a RLS de quem pede.
- CEP/CNPJ exigem sessão e têm limite por usuário, em memória por instância (melhor esforço).
- Portal, logado como PARTNER_ADMIN: caso e processo do escritório principal dão "não encontrado"; `/dg-brasil`, `/parceiros` e `/configuracoes` dão "Acesso restrito"; a lista mostra só os 8 clientes do parceiro; sem erro de console nem de rede.

## 6. O que quebra em produção? (`ecc-production-audit`)

Antes de dado real:

1. Testar o convite de parceiro com e-mail real, do link até o portal. É o fluxo novo de maior risco e não foi visto de ponta a ponta.
2. Corrigir R2-01, para a integração voltar a proteger as próximas mudanças.
3. A 045 apaga dados: os 1.043 responsáveis de cliente do DEV seriam, em produção, informação real. Fazer backup antes e decidir se o responsável precisa ir para o caso.
4. A conferência em dupla dos prazos continua valendo (`ROADMAP.md`).

## 7. Dados criados no DEV

Tudo fictício, com "QA R2" no nome:

- Cliente `5ea19d14-…`, caso `4cbccdb3-…`, processo `9e4097bf-…`, 2 despesas, 1 contrato ATIVO, 2 tarefas e 1 análise.
- Agente "QA R2 Agente": pausado, e o orquestrador voltou a "Nenhum".
- Computador "Computador QA R2": revogado.
- 2 escritórios "Convite: qa.r2.parceiro…" inativos e 1 convite revogado.
- Pelo portal: cliente "Cliente Validacao Portal", caso `5a3f985c-…`, 1 solicitação e 1 documento fictício (no escritório "Parceiro QA A").
- Tentativas de convite feitas pelo Miguel: 2 escritórios "Convite: …" inativos e 2 convites revogados.
- Massa habitual das rodadas de integração (`@dgbrasil.test`).
- OABs de teste do usuário `adm`: removidas; o painel voltou a ficar vazio.

Removido a pedido do Miguel: o cliente de R2-02 com 3 casos, 4 documentos e 56 notificações, em exclusão física numa única transação. Os 2 registros de acesso LGPD desse cliente e as 4 versões de documento também saíram, pela operação administrativa prevista na migration 001 (`dg.allow_physical_delete`). Os arquivos desses documentos no Storage não foram confirmados: a remoção retornou 0 itens.

## 8. Para concluir

1. Implementar as correções da seção 9 e atualizar os testes de integração (R2-01).
2. Parte 4, com alguém no computador do escritório.

## 9. Correções pedidas depois da validação (2026-11-09)

Pedidas pelo Miguel ao revisar as telas. Nada disto foi implementado ainda.

### Convite por e-mail (R2-16)

Convidar um parceiro com um Gmail real falhou com "O convite não pôde ser enviado por e-mail. Nada foi criado; tente novamente."

- **Atualização:** resolvido depois de ajustar a configuração do Resend; o convite chegou e foi aceito. Restam os itens 3 e 4 abaixo.
- **Diagnóstico:** o Miguel informou que já ligou o SMTP próprio. Um convite de diagnóstico direto no Auth do DEV, para endereço fictício, devolveu `500 Error sending invite email`. Esse erro indica que o Auth tentou enviar e o envio falhou. O bloqueio do SMTP padrão costuma vir como `Email address not authorized`.
- **Causa ainda não identificada.** O motivo real só aparece no log do Auth. Hipóteses a conferir: usuário ou senha do SMTP errados, remetente fora do domínio verificado, porta, ou plano sem SMTP (o Zoho gratuito não tem, ver `docs/deploy/producao.md`, item 4 da seção de e-mail).
- **O que fazer:**
  1. No Supabase DEV, abrir **Logs → Auth** e ler a linha do erro de envio.
  2. Corrigir a configuração indicada e repetir o convite.
  3. Corrigir a mensagem: "Nada foi criado" não é verdade. As 2 tentativas deixaram 2 escritórios "Convite: …" inativos (R2-06).
  4. Só criar o escritório depois de o convite sair, ou reaproveitar o pendente na nova tentativa.
- Sem isso, o primeiro acesso do parceiro não pode ser testado.

### Correções estéticas

| ID | Tela | O que mudar |
|---|---|---|
| E-01 | Parceiros | "Casos por escritório" e "Clientes por escritório" com a mesma altura de "Casos novos × aceitos", com rolagem interna na lista |
| E-02 | Início | "Casos por escritório de origem" e "Como os clientes chegaram" com a mesma altura, rolagem interna, sem espaço branco abaixo |
| E-03 | Clientes | "Escritório de origem" e "Como chegaram" com a mesma altura de "Novos clientes" |
| E-04 | Casos | Hoje "Escritório de origem" fica sozinho e muito alto, com "Como chegaram" quase vazio ao lado. Transformar em faixa larga e baixa, ocupando a largura toda, com a lista em colunas e rolagem |
| E-05 | Revisões | Indicadores clicáveis no modelo de Processos, que funcionam como filtro (lista abaixo) |
| E-06 | Financeiro → Visão geral | Quarto gráfico no espaço vazio ao lado de "Contratado por modelo" |
| E-07 | Todas as telas | Revisar alinhamento, altura e posição de todos os blocos (ver o prompt) |
| E-08 | Portal | Foco no número depois do CEP (R2-13) e telefone igual ao do escritório (R2-14) |
| E-09 | Configurações → Geral | Tirar "e unidades" da descrição de Atuação (R2-08) |
| E-10 | Portal do parceiro | Mesma arrumação de indicadores, gráficos, altura, rolagem e posicionamento do escritório, na Início, no Financeiro e demais telas |
| E-11 | Parceiros → ficha do parceiro | A edição da divisão já existe ("Alterar divisão da parceria", só para novos casos, auditada). Deixar visível e adicionar confirmação mostrando divisão atual → nova antes de salvar |
| E-13 | Portal → Convidar usuário e primeiro acesso | OAB **opcional** para o usuário do parceiro, que pode ser secretária ou outra função sem OAB. No primeiro acesso a pessoa informa se tem OAB (opção "Não sou advogado(a)") e depois cadastra quantas quiser em Minha conta → Minhas OABs. Hoje é obrigatória em `lib/auth/oab.ts:11` e em `first-access-screen.tsx:19` |
| E-12 | Convidar parceiro | Campo "Porcentagem do parceiro (%)", com texto claro: "É a parte dos honorários que fica com o parceiro. Ex.: 30 = 30% para o parceiro e 70% para o seu escritório." e prévia "Parceiro X% · Escritório Y%" |

**Indicadores de Revisões (E-05):** faixa como `ProcessSummaryStrip`, contada no banco para a fila inteira.

| Indicador | Ao clicar |
|---|---|
| Aguardando decisão | Visão "Aguardando decisão" |
| Urgentes e alta prioridade | Filtra a prioridade |
| Vencendo em até 7 dias (inclui vencidas) | Filtro novo pelo prazo (`due_at`) |
| Sem responsável | Liga "Sem responsável" |

**Quarto gráfico do Financeiro (E-06), recomendado: "A receber por vencimento".** Barras com o saldo em aberto em: em atraso, até 30 dias, 31 a 60, 61 a 90 e acima de 90. Responde "quanto entra e quando", o que nenhum dos três gráficos atuais mostra, e destaca o atraso. Alternativa: "Honorários por mês: escritório × parceiro".

### Prompt para a correção

```text
No projeto DG Brasil (apps/frontend), corrija a estética dos indicadores e gráficos.
Não mude regras de negócio, permissões nem as consultas existentes, exceto o que for
pedido nos itens 4 e 5. Leia docs/qa/roadmap-2.0/qa-roadmap-2.0.md, seção 9.

1. Altura padrão dos painéis (features/metrics/components/metrics-board.tsx)
   - Hoje o componente Trend tem gráfico de 200 px, e Categories cresce com o número
     de linhas. Com muitos escritórios, ele fica enorme.
   - Faça Categories ter o corpo com a mesma altura do gráfico de Trend, com o
     cabeçalho fixo e rolagem vertical só na lista.
   - Todos os painéis da mesma linha devem ter altura igual (h-full, sem sobra
     branca), inclusive os estados vazios e com poucas linhas.
   - Rolagem acessível por teclado (tabIndex=0 e aria-label na área rolável).
   - Vale para Parceiros, Início, Clientes, Casos, Processos e portal.

2. Início: os Tiles compactos da terceira coluna devem ocupar a mesma altura dos
   painéis ao lado.

3. Casos: são 4 painéis numa grade de 3 colunas, e o último fica sozinho.
   Faça "Escritório de origem" ocupar a largura toda (xl:col-span-3), baixo, com a
   lista em 2 ou 3 colunas e a mesma altura máxima com rolagem.
   Se houver só um escritório, o painel não aparece: a grade não pode ficar com buraco.

4. Revisões (features/reviews/components/review-queue.tsx): acrescente, acima das
   abas, uma faixa no modelo de ProcessSummaryStrip com: Aguardando decisão, Urgentes
   e alta prioridade, Vencendo em até 7 dias (inclui vencidas) e Sem responsável.
   Conte no banco para a fila inteira, respeitando a RLS. Cada indicador é um botão
   que aplica o filtro na URL (aria-pressed); clicar de novo limpa. O filtro por
   prazo é novo: crie-o no servidor, com schema Zod e teste.

5. Financeiro → Visão geral (features/finance/components/finance-overview.tsx):
   adicione o gráfico "A receber por vencimento" (em atraso, até 30, 31 a 60, 61 a 90,
   acima de 90 dias), com o saldo em aberto somado no servidor, no quarto espaço da
   grade, seguindo chart-theme.ts. Contratos antigos seguem a mesma regra dos totais.

6. Correções pequenas: R2-08, R2-13 e R2-14 do relatório. Convite de parceiro (E-12):
   rótulo "Porcentagem do parceiro (%)", explicação de quem fica com o quê e prévia.
   Ficha do parceiro (E-11): manter ChangeShareDialog, deixar o botão visível e pedir
   confirmação com a divisão atual e a nova. Continua valendo só para novos casos.
   Mensagem do convite: não dizer "Nada foi criado" (R2-16).
   OAB do convidado (E-13): tirar PARTNER_USER de OAB_REQUIRED_ROLES e colocar em
   OAB_OPTIONAL_ROLES em lib/auth/oab.ts; igualar a cópia local em
   features/auth/components/first-access-screen.tsx (o ideal é importar de lib/auth/oab.ts);
   conferir o servidor do aceite e os testes. No convite, o campo aparece como opcional.
   Continua obrigatória para LAWYER do escritório. O painel Minhas OABs não muda.

7. Revisão geral: percorra Início, Clientes, Casos, Processos, Revisões, Parceiros,
   Financeiro (todas as abas), DG Brasil, Configurações e todas as telas do portal
   do parceiro (MetricsBoard variants portal-home e portal-finance) e confira: mesma altura entre blocos da mesma linha; bordas e margens alinhadas;
   espaçamento regular; nenhum buraco na grade; nenhum bloco muito maior que os
   vizinhos; textos sem corte.

Aceite: prints em 1440 e 1920 px de cada tela, antes e depois, em
docs/qa/roadmap-2.0/estetica/, testando com muitas linhas (o DEV tem 260+ escritórios)
e com poucas. Rode typecheck, lint, testes unitários e build. Não aplique migration
destrutiva.
```
