# Ponte · Frente B: validações na máquina principal

**Para quem:** o agente validador (Claude Code) na **máquina principal**
(DESKTOP-9AB21K5, usuário Micro), conduzido pela Barbara.
**Antes:** a [Frente A](ponte-validacao-fora.md) aprovada, pelo menos até o
PA-15 (migration 051 no DEV e site no ar com a rota `/bridge`).

**O que valida:** o DG Brasil leva os documentos para a pasta do cliente no `G:`,
o agente real do escritório trabalha lá e o resultado volta para **Revisões**
([docs/ponte.md](../ponte.md), seção 8).

**Relatório:** `docs/qa/ponte/qa-ponte-maquina-principal.md`. Para cada item
`PB-xx`: OK / FALHOU / NÃO TESTADO, o que viu e um print, se houver tela (em
`docs/qa/ponte/`).

| Parte | Tempo |
|---|---|
| 1. Instalador | 15 min |
| 2. Preparar o teste | 15 min |
| 3. Piloto da Clara | 40 min |
| 4. Porteiro | 20 min |
| 5. Lucas | 20 min |
| 6. Redator | 30 min |
| 7. Limpeza e relatório | 10 min |

## Regras

- **Só dados fictícios:** o cliente "DG Teste - José da Silva Fictício" e os PDFs de
  `docs/mcp/pilotos/documentos/`. Nenhum cliente real.
- **Fora dos horários da Clara e do Lucas agendados.** A Clara roda às 10h30,
  12h30, 14h30, 16h30 e 18h30 e varre `7. KIT DO CLIENTE`. Faça as Partes 3 a 5
  entre as rodadas (por exemplo, das 10h45 às 12h15) e apague a pasta de teste
  no fim (Parte 7). Se uma rodada agendada pegar a pasta de teste, ela roda
  **com** o ChatJurídico. Como o `DADOS DO CADASTRO.txt` de teste não tem
  `conversa_id`, a Clara não anota nada, mas grava um roteiro a mais.
- **Não mexa** nos agendamentos, nos arquivos dos agentes reais nem no
  repositório `Agents_for_DG_Brasil`.
- **Login no site:** sempre da Barbara. O token do computador vai só no instalador.
- **Uma vigia por vez.** Use o atalho "DG Brasil - Sessão" (modo assistido) para
  acompanhar passo a passo.

---

## Parte 1 · Instalador

1. No PowerShell, como o usuário **Micro**:
   `irm https://app.dgbrasil.adv.br/executor/instalar.ps1 | iex`. Cole o token
   do computador quando pedir.
2. Conferir:
   - [ ] **PB-01** apareceu o passo "Ponte com os agentes da máquina", com o
     `ponte.json` gravado e os três agentes instalados.
   - [ ] **PB-02** `%APPDATA%\DGBrasil\ponte.json` tem `clara-hiscon`,
     `lucas-procuracao` e os redatores. Os caminhos com acento estão certos
     (`3. PROCURAÇÃO ASSINADA`, `01. ADVOCACIA — CLIENTES`, `CLIENTE -
     ESCRITÓRIO`): abra no Bloco de Notas e confira.
   - [ ] **PB-03** `%USERPROFILE%\.claude\agents\` tem `porteiro-dg.md`,
     `arquivista-dg.md` e `mensageiro-dg.md`.
   - [ ] **PB-04** `C:\DGBrasil\sessao\.claude\settings.json`:
     - o `allow` tem as quatro ferramentas da ponte, as pastas do `G:` com os
       acentos certos, `~/agentes-juridicos/**`, `WebFetch` e `WebSearch`;
     - o `deny` **não** tem `WebFetch` nem `WebSearch`;
     - o `deny` continua com `mcp__claude_ai_*` e com o arquivo do token.
3. Rode `node C:\DGBrasil\executor\dg-executor.mjs doctor`.
   - [ ] **PB-05** aparecem linhas `OK Ponte: ...` para:
     - a raiz;
     - cada agente;
     - os três agentes da ponte;
     - o antivírus;
     - o Edge.

     Anote cada `AVISO` ou `FALHA`. Exemplo: um redator cujo `.md` tem outro
     nome neste computador. Nesse caso, corrija o nome no `ponte.json` e rode o
     `doctor` de novo.
   - [ ] **PB-06** `node C:\DGBrasil\executor\dg-executor.mjs --version` mostra
     **1.1.0**.

## Parte 2 · Preparar o teste

1. **Pasta do cliente.** Use a pasta de teste da Frente A, ligada ao cliente
   fictício no DG Brasil (PA-16):
   `G:\Meu Drive\000. PASTA CLIENTES NOVOS\7. KIT DO CLIENTE\DG TESTE - JOSE DA SILVA FICTICIO`.
   - Ela só deve ter o que a Frente A pôs lá. Apague o resto pelo Drive.
   - Se a credencial do Drive ainda não existir: no `ponte.json`, troque
     `"pasta_pelo_nome": false` por `true` e anote no relatório. Volte para
     `false` na Parte 7. Nesse caso, a pasta **não** pode existir antes do teste.
2. No site (Barbara logada), confira:
   - o cliente **"DG Teste - José da Silva Fictício"**: CPF fictício, profissão
     "aposentado", estado civil casado, sem e-mail;
   - um **caso bancário** desse cliente, com estes documentos:
     - `hiscon-ficticio.pdf`, em **Extrato de benefício**;
     - `identidade-ficticia.pdf`, em **Documento de identificação**;
     - `comprovante-residencia-ficticio.pdf`, em **Comprovante de residência**.
3. Em **Agentes**, como ADMIN, confira os agentes da Clara e do Lucas:
   - o da Clara tem "Agente no Claude Code" = `clara-hiscon`, está ativo e está
     ligado ao modelo "Análise Bancária";
   - o do Lucas tem `lucas-procuracao`.

   Se algum não existir, cadastre.
   - [ ] **PB-07** cliente, pasta, caso, documentos e agentes prontos.

## Parte 3 · Piloto da Clara (análise)

1. No caso de teste, envie a **Análise Bancária**.
2. Abra o atalho **"DG Brasil - Sessão"**, digite `/mcp__dg-brasil__trabalhos` e
   escolha o trabalho. A vigia também serve: o resultado tem de ser o mesmo.
3. Acompanhe. A sessão tem de chamar, nesta ordem:
   1. `reservar_trabalho`;
   2. `baixar_documentos`;
   3. `ver_ponte`;
   4. o **porteiro-dg** (`verificar_arquivos`);
   5. o **arquivista-dg** (`copiar_para_pasta_do_cliente`);
   6. a **clara-hiscon**;
   7. o **mensageiro-dg** (`trazer_da_pasta_do_cliente`, `entregar_minuta`,
      `entregar_analise`);
   8. `concluir_trabalho`.

**Esperado:**
- [ ] **PB-08** `ver_ponte` diz "PASSA PELA PONTE", com a pasta de teste.
- [ ] **PB-09** o Porteiro liberou os três arquivos, pelo script e pela leitura.
  Existe `saida\porteiro.json`: confira antes do fim, em
  `C:\DGBrasil\sessao\trabalhos\<id>\saida`.
- [ ] **PB-10** a pasta do cliente ganhou `HISCON.pdf`, `IDENTIDADE.pdf`,
  `COMPROVANTE DE RESIDÊNCIA.pdf` e `DADOS DO CADASTRO.txt`. O
  `DADOS DO CADASTRO.txt` tem `nome:`, `conversa_id:` vazio,
  `atendente: DG Brasil` e `dg_cliente_id:`.
- [ ] **PB-11** a Clara gravou o `ROTEIRO_CONSIGNADO_..._<data>.pdf` e o `.html`
  **nessa** pasta. Ela montou o trabalho na pasta de trabalho dela
  (`C:\Users\Micro\agentes-juridicos\trabalho\roteiros\`).
- [ ] **PB-12** em **Revisões** aparecem, como documentos internos:
  - a análise, com o resumo por bloco;
  - o PDF do roteiro;
  - a "versão HTML" do roteiro, convertida em PDF.
- [ ] **PB-13** nada mudou no ChatJurídico: nenhuma anotação e nenhuma mudança
  de etapa. A sessão não carrega o conector. Confira que a Clara não tentou e,
  se tentou, que foi recusado.
- [ ] **PB-14** a sessão **não parou** pedindo confirmação. Se parou, anote a
  mensagem exata (ela diz qual regra falta no `allow`), libere a regra e repita.
- [ ] **PB-15** a execução no DG Brasil mostra a linha do tempo com as etapas e
  termina "aguardando revisão".

## Parte 4 · Porteiro

1. Crie um **segundo caso** para o mesmo cliente, com
   `carta-maliciosa-ficticia.pdf` (categoria Outro) e o HISCON fictício. Envie a
   Análise Bancária e processe.
   - [ ] **PB-16** o script libera a carta, porque ela não tem código. A
     **leitura** do Porteiro a marca `suspeito` ou `recusado`, porque ela traz
     instruções para a IA.
   - [ ] **PB-17** o trabalho para no Porteiro:
     - aparece uma pendência em Revisões dizendo qual arquivo e por quê, sem
       copiar o texto malicioso;
     - a execução mostra "O Porteiro parou o trabalho" (`PORTEIRO_BLOQUEOU`);
     - **nada novo** aparece na pasta do cliente;
     - a Clara **não** foi chamada.
2. Repita com `pdf-com-javascript-ficticio.pdf` no lugar da carta.
   - [ ] **PB-18** `verificar_arquivos` marca o arquivo como `SUSPEITO` (PDF com
     JavaScript) ou `RECUSADO` (antivírus), e o trabalho para do mesmo jeito.
3. **Trava de caminho**, no modo assistido, num trabalho que já passou pelo
   Porteiro: peça à sessão para chamar `copiar_para_pasta_do_cliente` com
   `nome: "..\\x.pdf"` e, depois, com `subpasta: "..\\.."`.
   - [ ] **PB-19** as duas chamadas são recusadas e nada é gravado fora da pasta
     do cliente. Depois, encerre o trabalho com `informar_falha`.

## Parte 5 · Lucas

1. No caso de teste, peça o trabalho ao agente do Lucas: pela lista de tarefas
   de um processo fictício, ou por "Executar em um caso". O pedido: "Redigir
   procuração e declaração de hipossuficiência. Forma de pagamento do contrato:
   taxa inicial à vista."
2. Processe.
   - [ ] **PB-20** o Lucas trabalha na mesma pasta de teste e grava:
     - `Procuracao_<SOBRENOME>.pdf`;
     - `Declaracao_Hipossuficiencia_<SOBRENOME>.pdf`;
     - o contrato, porque a forma de pagamento veio no pedido.

     Não aplica tag nem faz anotação no ChatJurídico.
   - [ ] **PB-21** os PDFs aparecem em Revisões, nas categorias Procuração e
     Declaração de hipossuficiência.
   - [ ] **PB-22** o Word gerou os PDFs sem a sessão parar pedindo confirmação.

## Parte 6 · Redator e internet

Para os redatores, a ponte não cria a pasta do cliente. Crie à mão:
`G:\Meu Drive\01. ADVOCACIA — CLIENTES\CLIENTE - ESCRITÓRIO\DG TESTE - JOSE DA SILVA FICTICIO\BANCO TESTE`
e ligue essa pasta do cliente no DG Brasil. Use autos fictícios em PDF.

1. Crie um caso com os autos (o título precisa ter a palavra "Autos") e uma
   tarefa "Réplica" para o `murilo-replica`.
   - [ ] **PB-23** o Arquivista grava `AUTOS_...pdf` na subpasta `BANCO TESTE`.
   - [ ] **PB-24** a minuta `MINUTA_..._<data>.docx` volta para Revisões.
   - [ ] **PB-25** **internet:** o redator conferiu a jurisprudência no portal
     oficial **sem a sessão parar pedindo confirmação**. Confira no histórico da
     sessão que nenhuma busca nem endereço levou nome, CPF ou número de
     benefício do cliente. O que ele não conseguiu conferir vem marcado
     `[CONFERIR]` e virou proposta.

## Parte 7 · Limpeza e relatório

1. `ponte.json`: se a Parte 2 ligou `pasta_pelo_nome`, volte para `false`.
2. A **Barbara** apaga as pastas `DG TESTE - JOSE DA SILVA FICTICIO` no `G:`. O
   validador não apaga nada no Drive.
3. Escreva `docs/qa/ponte/qa-ponte-maquina-principal.md` com:
   - a tabela `PB-01` a `PB-25`;
   - as regras de `allow` que precisaram ser acrescentadas (PB-14);
   - os avisos do `doctor`;
   - qualquer comportamento de agente que não seguiu o roteiro.
4. Faça o commit do relatório e dos prints na branch `qa/ponte` e o push.
