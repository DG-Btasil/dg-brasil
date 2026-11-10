# Ponte com os agentes da máquina: validação

**Para quem:** o agente validador (Claude Code), conduzido pela Barbara.
**O que valida:** a ponte de [docs/ponte.md](../ponte.md) (seção 8 = o que foi
implementado): o DG Brasil leva os documentos para a pasta do cliente no `G:`,
o agente real do escritório trabalha lá, e o resultado volta para **Revisões**.

**Relatório:** `docs/qa/ponte/qa-ponte.md`. Para cada item `PT-xx`: OK / FALHOU /
NÃO TESTADO, o que viu e um print, se houver tela (em `docs/qa/ponte/`).

| Parte | Onde | Tempo |
|---|---|---|
| 0. Banco e site | máquina com o Supabase CLI ligado ao DEV | 15 min |
| 1. Instalador | máquina principal (DESKTOP-9AB21K5, usuário Micro) | 15 min |
| 2. Preparar o teste | máquina principal + site | 15 min |
| 3. Piloto da Clara | máquina principal + site | 40 min |
| 4. Porteiro | máquina principal + site | 20 min |
| 5. Lucas | máquina principal + site | 20 min |
| 6. Redator (opcional) | máquina principal + site | 30 min |
| 7. Limpeza e relatório | | 10 min |

## Regras

- **Só dados fictícios:** o cliente "DG Teste - José da Silva Fictício" e os PDFs de
  `docs/mcp/pilotos/documentos/`. Nenhum cliente real.
- **Fora dos horários da Clara e do Lucas agendados** (a Clara roda 10h30, 12h30,
  14h30, 16h30 e 18h30 e varre `7. KIT DO CLIENTE`): faça as Partes 3 a 5 entre
  as rodadas, por exemplo das 10h45 às 12h15, e apague a pasta de teste no fim
  (Parte 7). Uma rodada agendada que pegar a pasta de teste roda **com** o
  ChatJurídico; como o `DADOS DO CADASTRO.txt` de teste não tem `conversa_id`, a
  Clara não anota nada, mas grava um roteiro a mais.
- **Não mexa** nos agendamentos, nos arquivos dos agentes reais nem no
  repositório `Agents_for_DG_Brasil`.
- **Login no site:** sempre da Barbara. O token do computador só no instalador.
- **Uma vigia por vez.** Pode usar o atalho "DG Brasil - Sessão" (modo
  assistido) para acompanhar passo a passo.

---

## Parte 0 · Banco e site (máquina com o Supabase CLI do DEV)

1. `git pull` no `master`.
2. Verificador local: `cd supabase && npm install && npm run verificar`.
   - [ ] **PT-01** todas passam (846 ou mais), inclusive a seção `[051]`.
3. Aplicar no DEV: `supabase db push` (a única pendente deve ser
   `20261110000051_ponte_agentes.sql`). Depois, `supabase db push --dry-run`.
   - [ ] **PT-02** "Remote database is up to date".
4. Conferir o deploy do site (Vercel) do mesmo commit e a rota nova, sem token:
   ```powershell
   curl.exe -s -o NUL -w "%{http_code}" https://app.dgbrasil.adv.br/api/executor/v1/jobs/11111111-2222-4333-8444-555555555555/bridge
   ```
   - [ ] **PT-03** responde `401` (e não `404`).
5. Testes do site e do conector:
   `cd apps/frontend && npm test -- src/server/executor src/server/integrations/google-drive` e
   `cd apps/executor && npm test`.
   - [ ] **PT-04** tudo passa.

## Parte 1 · Instalador (máquina principal)

1. PowerShell como o usuário **Micro**:
   `irm https://app.dgbrasil.adv.br/executor/instalar.ps1 | iex` (cole o token
   do computador quando pedir, o mesmo de antes ou um novo).
2. Conferir:
   - [ ] **PT-05** apareceu o passo "Ponte com os agentes da máquina", com
     `ponte.json` gravado e os três agentes instalados.
   - [ ] **PT-06** `%APPDATA%\DGBrasil\ponte.json` existe e tem `clara-hiscon`,
     `lucas-procuracao` e os redatores; os caminhos com acento estão certos
     (`3. PROCURAÇÃO ASSINADA`, `01. ADVOCACIA — CLIENTES`, `CLIENTE - ESCRITÓRIO`).
     Abra no Bloco de Notas e confira letra por letra.
   - [ ] **PT-07** `%USERPROFILE%\.claude\agents\` tem `porteiro-dg.md`,
     `arquivista-dg.md`, `mensageiro-dg.md`.
   - [ ] **PT-08** `C:\DGBrasil\sessao\.claude\settings.json`: o `allow` tem as
     quatro ferramentas da ponte (`mcp__dg-brasil__ver_ponte`...), as pastas do
     `G:` com o acento certo e `~/agentes-juridicos/**`; o `deny` continua com
     `WebFetch`, `WebSearch`, `mcp__claude_ai_*` e o arquivo do token.
3. `node C:\DGBrasil\executor\dg-executor.mjs doctor`:
   - [ ] **PT-09** linhas `OK Ponte: ...` para a raiz, cada agente, os três agentes
     da ponte, o antivírus e o Edge. Anote cada `AVISO` ou `FALHA` (ex.: um
     redator cujo `.md` tem outro nome neste computador: corrija o nome no
     `ponte.json` e rode o `doctor` de novo).
   - [ ] **PT-10** a versão do conector é **1.1.0** (`node C:\DGBrasil\executor\dg-executor.mjs --version`).

## Parte 2 · Preparar o teste

**Pasta do cliente.** A credencial do Drive ainda não existe, então nenhum
cliente consegue ter pasta ligada no DG Brasil. Para o piloto, use o nome do
cliente:

1. No `ponte.json`, troque `"pasta_pelo_nome": false` por `true` e salve
   (lembre de voltar no fim, Parte 7).
2. No site (Barbara logada), crie o cliente **"DG Teste - José da Silva
   Fictício"** (CPF fictício válido, profissão "aposentado", estado civil
   casado, sem e-mail) e um **caso bancário** para ele, com os documentos:
   - `hiscon-ficticio.pdf` na categoria **Extrato de benefício**;
   - `identidade-ficticia.pdf` em **Documento de identificação**;
   - `comprovante-residencia-ficticio.pdf` em **Comprovante de residência**.
3. Em **Agentes**: o agente da Clara cadastrado com "Agente no Claude Code" =
   `clara-hiscon`, ativo e ligado ao modelo "Análise Bancária". Se não existir,
   cadastre (como ADMIN). Idem o Lucas, com `lucas-procuracao`.
4. Confirme que **não existe** `G:\Meu Drive\000. PASTA CLIENTES NOVOS\7. KIT DO CLIENTE\DG TESTE - JOSE DA SILVA FICTICIO`
   nem pasta com esse nome em outra etapa do `000. PASTA CLIENTES NOVOS`.
   - [ ] **PT-11** cliente, caso, documentos e agentes prontos.

## Parte 3 · Piloto da Clara (análise)

1. No caso de teste, envie a **Análise Bancária**.
2. Abra o atalho **"DG Brasil - Sessão"** e digite `/mcp__dg-brasil__trabalhos`;
   escolha o trabalho. (Ou a vigia: o resultado tem de ser o mesmo.)
3. Acompanhe. A sessão tem de chamar, nesta ordem: `reservar_trabalho`,
   `baixar_documentos`, `ver_ponte`, o **porteiro-dg** (`verificar_arquivos`),
   o **arquivista-dg** (`copiar_para_pasta_do_cliente`), a **clara-hiscon**, o
   **mensageiro-dg** (`trazer_da_pasta_do_cliente`, `entregar_minuta`,
   `entregar_analise`) e `concluir_trabalho`.

**Esperado:**
- [ ] **PT-12** `ver_ponte` diz "PASSA PELA PONTE" com a pasta
  `...\7. KIT DO CLIENTE\DG TESTE - JOSE DA SILVA FICTICIO` e o aviso de
  `pasta_pelo_nome`.
- [ ] **PT-13** o Porteiro liberou os três arquivos (script e leitura); existe
  `saida\porteiro.json` (veja antes do fim, na pasta do trabalho em
  `C:\DGBrasil\sessao\trabalhos\<id>\saida`).
- [ ] **PT-14** a pasta do cliente foi criada com `HISCON.pdf`, `IDENTIDADE.pdf`,
  `COMPROVANTE DE RESIDÊNCIA.pdf` e `DADOS DO CADASTRO.txt` (com `nome:`,
  `conversa_id:` vazio, `atendente: DG Brasil`, `dg_cliente_id:`).
- [ ] **PT-15** a Clara gravou o `ROTEIRO_CONSIGNADO_..._<data>.pdf` e o `.html`
  **nessa** pasta, e trabalhou na pasta de trabalho dela
  (`C:\Users\Micro\agentes-juridicos\trabalho\roteiros\`).
- [ ] **PT-16** em **Revisões**: a análise (resumo por bloco) e os PDFs do
  roteiro (o PDF e a "versão HTML" convertida), como documentos internos.
- [ ] **PT-17** nenhuma anotação nem mudança de etapa no ChatJurídico (a sessão
  não carrega o conector; confira que a Clara não tentou e, se tentou, que foi
  recusado).
- [ ] **PT-18** a sessão **não parou** pedindo confirmação. Se parou, anote a
  mensagem exata (é a regra que falta no `allow`), libere e repita.
- [ ] **PT-19** a execução no DG Brasil mostra a linha do tempo com as etapas e
  termina "aguardando revisão".

## Parte 4 · Porteiro

1. Crie um **segundo caso** para o mesmo cliente com
   `carta-maliciosa-ficticia.pdf` (categoria Outro) e o HISCON fictício. Envie a
   Análise Bancária e processe.
   - [ ] **PT-20** o script libera a carta (ela não tem código), mas a **leitura**
     do Porteiro a marca `suspeito` ou `recusado` por trazer instruções para a IA.
   - [ ] **PT-21** o trabalho para no Porteiro: pendência em Revisões dizendo
     qual arquivo e por quê (sem copiar o texto malicioso), execução com
     "O Porteiro parou o trabalho" (`PORTEIRO_BLOQUEOU`), **nada novo** na pasta do
     cliente no `G:`, e a Clara **não** foi chamada.
2. Repita com `pdf-com-javascript-ficticio.pdf` no lugar da carta.
   - [ ] **PT-22** `verificar_arquivos` marca `SUSPEITO` (PDF com JavaScript) ou
     `RECUSADO` (antivírus); o trabalho para do mesmo jeito.
3. Trava de caminho, no modo assistido, num trabalho que já passou pelo
   Porteiro: peça à sessão para chamar `copiar_para_pasta_do_cliente` com
   `nome: "..\\x.pdf"` e, depois, com `subpasta: "..\\.."`.
   - [ ] **PT-23** as duas recusam e nada é gravado fora da pasta do cliente.
     (Depois, encerre o trabalho com `informar_falha`.)

## Parte 5 · Lucas

1. No caso de teste, na lista de tarefas de um processo fictício (ou "Executar
   em um caso" com o agente do Lucas), peça: "Redigir procuração e declaração
   de hipossuficiência. Forma de pagamento do contrato: taxa inicial à vista."
2. Processe.
   - [ ] **PT-24** o Lucas trabalha na mesma pasta de teste e grava
     `Procuracao_<SOBRENOME>.pdf` e `Declaracao_Hipossuficiencia_<SOBRENOME>.pdf`
     (e o contrato, porque a forma de pagamento veio no pedido), sem tag nem
     anotação no ChatJurídico.
   - [ ] **PT-25** os PDFs aparecem em Revisões com as categorias Procuração e
     Declaração de hipossuficiência.
   - [ ] **PT-26** o Word gerou os PDFs sem a sessão parar pedindo confirmação.

## Parte 6 · Redator (opcional)

Só se houver autos fictícios em PDF. Pasta de teste
`G:\Meu Drive\01. ADVOCACIA — CLIENTES\CLIENTE - ESCRITÓRIO\DG TESTE - JOSE DA SILVA FICTICIO\BANCO TESTE`
(crie à mão: para os redatores a ponte não cria a pasta do cliente).

1. Caso com os autos (título com a palavra "Autos"), tarefa "Réplica" para o
   `murilo-replica`.
   - [ ] **PT-27** o Arquivista grava `AUTOS_...pdf` na subpasta `BANCO TESTE`.
   - [ ] **PT-28** a minuta `MINUTA_..._<data>.docx` volta para Revisões; a
     jurisprudência não conferida vem marcada `[CONFERIR]` e vira proposta.

## Parte 7 · Limpeza e relatório

1. `ponte.json`: volte `"pasta_pelo_nome"` para `false`, a menos que a Barbara
   decida manter `true` até a credencial do Drive existir.
2. A **Barbara** apaga a pasta `DG TESTE - JOSE DA SILVA FICTICIO` no `G:`
   (o validador não apaga nada no Drive).
3. Escreva `docs/qa/ponte/qa-ponte.md`: a tabela `PT-01` a `PT-28`, as regras de
   `allow` que precisaram ser acrescentadas (Parte 3, PT-18), os avisos do
   `doctor` e qualquer comportamento de agente que não seguiu o roteiro.
4. Commit do relatório e dos prints numa branch `qa/ponte` e push.

### Fica para depois (não precisa testar agora)

- **Drive sem duplicata** (o HISCON copiado pela ponte e o roteiro já entregue não
  voltam como "Outro" na sincronização): só com a credencial do Drive. Os testes
  automáticos (PT-01 e PT-04) já cobrem a regra.
- Frente PMP e Fazenda Pública: entram no `ponte.json` depois de conferir os nomes.
