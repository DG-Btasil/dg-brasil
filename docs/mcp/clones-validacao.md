# Agentes clonados: o que falta fazer e como validar

**Para:** Barbara. **Situação em 12/11/2026, 22h:** a Parte A foi feita (053, 054
e 055 aplicadas pela Barbara; instalação, cliente fictício e execução pelo Claude) e
a Parte B rodou: resultado em [qa/clones/qa-clones.md](../qa/clones/qa-clones.md).
**Falta:** aplicar a **056** (sequência automática) no DEV e a rodada curta do que
ficou de fora (seção "O que não foi validado" do relatório).

> **056 (sequência automática):** aplicar no DEV do mesmo jeito das outras. Depois
> dela, aprovar a análise da Clara em Revisões põe o Lucas e a Alice na fila
> sozinhos. Não muda nenhuma tela; o site funciona com ou sem ela.

Este guia tem duas partes:

| Parte | Quem | O quê |
|---|---|---|
| **A** | Barbara, à mão | Banco, site, instalação e conferências que só você pode fazer |
| **B** | Claude, com você no computador | A validação de cada clone, com dados fictícios |

**Regras da validação:** só dados fictícios (cliente "DG Teste - José da Silva
Fictício" e os PDFs de `docs/mcp/pilotos/documentos/`); não mexer nos agentes
nem nos agendamentos do escritório; nenhuma senha nem chave no chat; nada é
protocolado nem enviado a cliente.

---

## Parte A · O que a Barbara faz

Na ordem. Os três primeiros são urgentes: o site de teste já foi publicado com
o campo novo.

### A1. Aplicar as migrations no banco de teste (urgente)

Aplicar no Supabase **DEV**, nesta ordem: **053**, **054** e **055**
(`supabase/migrations/20261112000053…`, `…054…` e `…055…`), do mesmo jeito das
anteriores (`npx supabase db push`, na pasta `supabase`).

- **053:** o cadastro completo do cliente e quem assina vão para a pasta do
  cliente.
- **054:** os 13 agentes e o orquestrador aparecem cadastrados em Agentes.
- **055:** o campo "Forma de pagamento do contrato" no cadastro do cliente.

> **Enquanto a 055 não entrar, a tela de cliente do site de teste dá erro**
> (o site já procura o campo novo). Aplicada a migration, volta ao normal.

- [ ] **A1** as três aplicadas sem erro.

### A2. Conferir o site de teste

1. Vercel → Deployments: o último deploy está **Ready**.
2. No site, como ADMIN:
   - **Agentes:** aparecem os 13 do kit (nomes como "Clara · Análise do HISCON")
     e o "Orquestrador", todos ativos;
   - **Clientes → um cliente pessoa física → Editar:** em "Informações
     adicionais" aparece "Forma de pagamento do contrato". Salve uma opção e
     veja-a no detalhe do cliente, na coluna da direita.
- [ ] **A2** kit em Agentes e campo novo funcionando.

### A3. Trocar a Clara da Análise Bancária

No banco de teste, a "Análise Bancária" ainda aponta para a Clara da validação
da ponte. Em **Agentes → "Clara · Análise do HISCON" → Visão geral**, ligue-a
ao modelo "Análise Bancária". Depois, arquive os dois agentes antigos, "Clara
(ponte)" e "Lucas (ponte)".

- [ ] **A3** Análise Bancária com a Clara do kit.

### A4. Reinstalar o conector (versão 1.3.0)

No PowerShell do computador do escritório, com a janela da Vigia fechada:

```powershell
irm https://app.dgbrasil.adv.br/executor/instalar.ps1 | iex
```

- [ ] **A4** o instalador terminou sem erro (`node C:\DGBrasil\executor\dg-executor.mjs doctor` mostra a versão 1.3.0).

### A5. Instalar os clones

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Projetos\dg-brasil\apps\executor\scripts\instalar-agentes-bancario.ps1
```

Ele copia os 13 clones e os scripts, põe os clones na configuração da ponte e
libera as pastas deles na sessão do DG Brasil. Guarda cópia do que alterar
(arquivos com o final `.anterior`). Não toca nos agentes do escritório. Para
só ver o que ele faria, acrescente ` -Simular` no fim.

Se preferir, diga "pode rodar o instalador dos clones" e o Claude roda.

- [ ] **A5** o instalador terminou com "Pronto".

### A6. Conferir quem assina

Abra `C:\DGBrasil\agentes\escritorio.json` e confira: nome do escritório,
advogada, OABs, endereço profissional, cidade do fecho, e-mail, telefones e as
condições do contrato (percentuais de honorários e valores do custo inicial).
O arquivo foi montado com os dados que estavam nos scripts do escritório. O
endereço foi reescrito sem travessão: confira se ficou certo.

- [ ] **A6** dados conferidos.

### A7. Guardar uma cópia dos clones

Os clones existem **só neste computador** (pasta `C:\Projetos\dg-brasil\agentes`
e os relatórios em `docs\agentes\clonagem`). Até o "Setup" do site ficar pronto
(pós-MVP, item 6), guarde uma cópia num lugar privado seu, por exemplo uma
pasta do Drive que só você acessa. Não é para pôr no GitHub.

- [ ] **A7** cópia guardada.

### A8. Preparar a validação

1. No site: **DG Brasil → Computador do escritório → Ligar a execução**.
2. No cliente fictício "DG Teste - José da Silva Fictício": preencher CPF,
   documento, telefone, endereço e a **forma de pagamento do contrato**.
3. Abrir o atalho **"DG Brasil - Vigia"** e avisar o Claude: "pode validar os
   clones".

- [ ] **A8** execução ligada, cadastro fictício completo e Vigia aberta.

### A9. Depois da validação

- Desligar a execução, se não for continuar.
- Apagar pelo Drive a pasta de teste da Frente B
  (`000. PASTA CLIENTES NOVOS\7. KIT DO CLIENTE\DG TESTE - JOSE DA SILVA FICTICIO`)
  e a pasta de teste nova, em `DG BRASIL\CLIENTE BANCÁRIO`.
- Avisar a advogada do escritório dos defeitos achados nos agentes originais
  (lista na seção "Defeitos do original corrigidos no clone" de cada relatório,
  em `docs\agentes\clonagem`). Os originais não foram alterados.

---

## Parte B · O que o Claude valida

Com a Parte A feita e você no computador. O Claude dispara os trabalhos pelo
site, acompanha a Vigia e confere as telas e as pastas. Um agente por vez.

### B0. Preparação (Claude)

- Conferir a instalação: os 13 clones e os scripts no lugar, a ponte listando
  os clones, a sessão com as pastas liberadas.
- Criar os **autos fictícios** que os redatores precisam (contestação,
  despacho de emenda, decisão interlocutória, sentença e título), em PDF, e
  cadastrá-los nos casos do cliente fictício.
- Criar um HISCON fictício **sem ação**, para o caso sem viabilidade.

### B1. O que se confere em todo clone

| Item | O que tem de acontecer |
|---|---|
| VC-PASTA | A pasta `DG BRASIL\CLIENTE BANCÁRIO\DG TESTE - JOSE DA SILVA FICTICIO` é criada com o nome do cliente |
| VC-DADOS | `DADOS DO CADASTRO.txt` com CPF, documento, telefone, endereço e forma de pagamento; `DADOS DO ESCRITORIO.txt` com quem assina |
| VC-SAIDA | Os arquivos do agente aparecem na raiz da pasta do cliente, com o nome certo |
| VC-FICHA | A ficha de revisão existe e diz o que foi gerado, o que falta completar, o que decidir, o prazo e os avisos |
| VC-REVISOES | Em Revisões: os arquivos, a ficha em PDF e uma pendência para cada item a completar, decidir ou conferir |
| VC-SEM-PARAR | A Vigia não para pedindo permissão (anotar a regra que faltar) |
| VC-SEM-FORA | Nada aparece no ChatJurídico nem na ADVBOX; nenhum e-mail sai |
| VC-ASSINA | A peça ou o documento traz quem assina pelo cadastro, sem dado fixo |

### B2. A ordem dos clones

| # | Clone | O que o Claude dispara | O que confere a mais |
|---|---|---|---|
| 1 | Clara | Análise Bancária no caso 1 | Roteiro, teto normativo e a análise em Revisões, com o resumo por bloco |
| 2 | Clara, sem viabilidade | Análise com o HISCON sem ação | Roteiro "sem viabilidade" e a análise dizendo isso |
| 3 | Porteiro | Caso com a carta maliciosa; caso com boleto no lugar do comprovante | O primeiro **para** o trabalho; o segundo **segue**, com pendência de qualidade |
| 4 | Lucas | Kit do cliente | Procuração de 1 página, declarações e o contrato com a forma de pagamento do cadastro |
| 5 | Lucas, sem forma de pagamento | Kit com o campo vazio | Sai tudo menos o contrato; pendência "Decidir: forma de pagamento" |
| 6 | Alice | Inicial a partir do roteiro da Clara | Minuta com 15 páginas ou mais; lacunas marcadas; segunda rodada só se o pedido mandar |
| 7 | Refazer | Pedir "refazer" a inicial | Sai a versão 2 e a versão 1 continua na pasta |
| 8 | Murilo | Réplica, com a contestação fictícia | Análise pelos autos; prazo na ficha |
| 9 | Pedro | Provas | No Juizado, nenhuma perícia |
| 10 | Laura | Emenda, com o despacho fictício | Mapa do despacho na ficha |
| 11 | Gabriel | Embargos | Prazo de 5 dias úteis na ficha |
| 12 | Rafael | Recurso, com a sentença fictícia | Lacunas no lugar das perguntas |
| 13 | Paulo | Agravo | Aviso da comunicação do art. 1.018 |
| 14 | Beatriz | Cumprimento | Planilha de cálculo; consulta ao BACEN funcionando |
| 15 | Teresa | Audiência | Os dois PDFs; nada enviado ao cliente |
| 16 | Atlas | Revisional | Cálculo pela taxa do BACEN |
| 17 | Vicente | Seguro sem contratação | Minuta contra a seguradora |
| 18 | Orquestrador | Três tarefas na lista de afazeres de um processo | Cada uma vai para o clone certo; peça sem os autos não é distribuída |

Os redatores (8 a 17) dependem dos autos fictícios da preparação. Se a rodada
ficar longa, ela pode ser dividida em dias: os itens 1 a 7 primeiro.

### B3. O relatório

No fim, o Claude escreve `docs/qa/clones/qa-clones.md` com a tabela dos itens,
os achados, as regras de permissão que faltaram e a resposta: os clones podem
ser ligados na produção?

---

## O que ficou para depois

Está em [deploy/pos-mvp.md](../deploy/pos-mvp.md):
- **item 6 (prioridade):** levar os agentes para dentro do DG Brasil, com o
  botão "Setup" na tela de autorizar o computador;
- **item 7:** o titular do comprovante de residência no cadastro do cliente.

Também ficam para depois: o conector DJEN na sessão do DG Brasil (os clones já
consultam; por enquanto seguem pelos autos) e a procuração do Lucas para ações
que não são de consignado do INSS.
