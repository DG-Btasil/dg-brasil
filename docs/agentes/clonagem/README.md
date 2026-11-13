# Agentes clonados do DG Brasil (esteira bancária)

**Decisão de 11/11/2026.** Depois da validação da ponte no computador do
escritório ([Frente B](../../qa/ponte/qa-ponte-maquina-principal.md)), ficou
decidido que o DG Brasil **não chama mais os agentes reais do escritório**
dentro da esteira dele. A esteira do escritório é específica demais (fila do
kit, funil, ChatJurídico, ADVBOX) e misturar os dois gera confusão.

Em vez disso, os agentes da esteira bancária foram **clonados** para o DG
Brasil. O clone mantém o máximo do original e muda só o que sai da realidade do
DG Brasil. **Os agentes originais do escritório não foram alterados.**

- As regras de todo clone: [contrato-dos-clones.md](contrato-dos-clones.md).
- O que saiu, o que foi adaptado e o que ficou em cada agente: um arquivo por
  agente, nesta pasta (tabela abaixo).

> **O que está no GitHub e o que não está.** O repositório do DG Brasil é
> público. Por isso só este arquivo e o contrato dos clones vão para o GitHub.
> Os arquivos dos clones (`agentes/bancario/`), os scripts (`agentes/scripts/`)
> e os relatórios por agente desta pasta trazem o método do escritório e ficam
> **só no computador do escritório** (o `.gitignore` impede o envio por
> engano). Levá-los para dentro do DG Brasil, com um botão "Setup", é a
> prioridade do [pós-MVP](../../deploy/pos-mvp.md), item 6.

## Como fica

```
DG Brasil (site)                 Computador do escritório (sessão do DG Brasil)
────────────────                 ─────────────────────────────────────────────
Cliente, caso, documentos
Trabalho na fila  ────────────►  1. PORTEIRO     segurança e qualidade dos arquivos
                                 2. ARQUIVISTA   copia para a pasta do cliente:
                                                 G:\Meu Drive\DG BRASIL\CLIENTE BANCÁRIO\<NOME DO CLIENTE>
                                                 + DADOS DO CADASTRO.txt + DADOS DO ESCRITORIO.txt
                                 3. CLONE        (clara-hiscon-dg, alice-inicial-dg...)
                                                 trabalha na pasta e grava a ficha de revisão
                                 4. MENSAGEIRO   leva os arquivos e a ficha para o site
Revisões  ◄────────────────────     cada item a completar ou decidir vira pendência
(o advogado confere, edita, aprova)
```

## Os 13 agentes clonados

| Clone | O que faz | Relatório |
|---|---|---|
| `clara-hiscon-dg` | Análise do HISCON, roteiro de ações e teto normativo | [clara-hiscon.md](clara-hiscon.md) |
| `lucas-procuracao-dg` | Procuração, declarações e contrato de honorários | [lucas-procuracao.md](lucas-procuracao.md) |
| `alice-inicial-dg` | Petição inicial de fraude de consignado | [alice-inicial.md](alice-inicial.md) |
| `atlas-revisional-dg` | Petição inicial de revisional | [atlas-revisional.md](atlas-revisional.md) |
| `vicente-agregados-dg` | Inicial de seguro, conta e banco pagador | [vicente-agregados.md](vicente-agregados.md) |
| `murilo-replica-dg` | Réplica e impugnação à contestação | [murilo-replica.md](murilo-replica.md) |
| `pedro-provas-dg` | Manifestação em provas | [pedro-provas.md](pedro-provas.md) |
| `teresa-audiencia-dg` | Preparação da audiência de instrução | [teresa-audiencia.md](teresa-audiencia.md) |
| `laura-emenda-dg` | Emenda à inicial | [laura-emenda.md](laura-emenda.md) |
| `rafael-recurso-dg` | Recurso inominado, apelação e contrarrazões | [rafael-recurso.md](rafael-recurso.md) |
| `gabriel-embargos-dg` | Embargos de declaração | [gabriel-embargos.md](gabriel-embargos.md) |
| `paulo-agravo-dg` | Agravo de instrumento | [paulo-agravo.md](paulo-agravo.md) |
| `beatriz-cumprimento-dg` | Cumprimento e liquidação de sentença | [beatriz-cumprimento.md](beatriz-cumprimento.md) |

Os scripts que eles usam: [_scripts.md](_scripts.md). Os agentes comerciais e
de gestão que **não** foram clonados (Luísa, Otávio, Beto, Bruno, Helena, Sofia,
Carlos), e o que se aproveitou deles no Porteiro e no orquestrador:
[_comerciais-e-gestao.md](_comerciais-e-gestao.md).

## Agente de prazos (fora da ponte)

| Agente | O que faz | Relatório |
|---|---|---|
| `intimacao-dg` (no site: "Diana · Prazos das publicações") | Lê cada publicação nova do DJEN de um processo cadastrado, diz se abre prazo para o cliente e propõe o prazo (ou registra "Sem prazo"), com a contagem e o agente do kit que faz a peça | [intimacao.md](intimacao.md) |

Clone melhorado do agente de intimações, feito em 13/11/2026 a pedido da
Barbara ("preciso que um dos agentes proponha um prazo"). Diferenças para os 13
clones da esteira:

- **não passa pela ponte**: trabalha só com o pedido que o site monta (a
  publicação inteira, o lado do cliente e a lista de dias úteis). Não usa a
  pasta do cliente, por isso não entra no `ponte.json`; o instalador o copia da
  pasta `agentes/geral/` e o libera na sessão;
- **não gera documento**: a entrega é UMA proposta em Revisões. "Prazo" (com
  título, data e a contagem) ou "Sem prazo:" com o motivo. O prazo só existe
  depois que um advogado aprova;
- **confere a data duas vezes**: pela lista de dias úteis do pedido e pelo
  script de prazo. Se as duas divergirem, propõe a data mais cedo e avisa.

Quem escolhe o agente é o escritório, em DG Brasil → Integrações → "Agente que
propõe prazos". A migration 058 já o cadastra e, se esse campo estiver vazio, o
escolhe (ver "Publicações e andamentos para os agentes", abaixo).

## Decisões tomadas (Barbara, 11/11/2026)

1. **Pasta:** `G:\Meu Drive\DG BRASIL\CLIENTE BANCÁRIO\<NOME DO CLIENTE>`. O
   nome da pasta é o nome do cliente no cadastro (maiúsculas, sem acento). Outras
   áreas, no futuro, ganham outra subpasta de `DG BRASIL`.
2. **O que vai para a pasta:** os documentos do cadastro do cliente e os dois
   arquivos de dados (cadastro do cliente e quem assina).
3. **Conector DJEN:** fica nos clones. O DG Brasil terá esse conector.
4. **Perguntas viram pendências:** o clone não pergunta nem espera. O que
   depende do advogado vai para a ficha de revisão e aparece em Revisões.
5. **Dado que falta:** o clone escreve a peça com a lacuna marcada
   (`[COMPLETAR: ...]`) e lista o que falta. Não para.
6. **Quem assina:** vem do cadastro, nunca fixo no agente.
7. **Modelos e jurisprudência:** o clone lê os mesmos do escritório. A
   jurisprudência nova que ele conferir vai para a base do DG Brasil.
8. **Refazer:** gera a versão 2 e mantém a 1. O advogado também pode baixar e
   editar à mão em Revisões.
9. **Defeitos dos originais:** corrigidos só nos clones. A lista para a
   advogada do escritório está em cada relatório, na seção "Defeitos do
   original corrigidos no clone".
10. **Regras da Luísa, do Otávio e do Beto:** aplicadas no Porteiro
    (conferência de qualidade dos documentos) e no orquestrador (qual agente
    atende cada despacho).

## Sequência automática (decisão de 12/11/2026)

A dona pediu menos cliques: "concordo com qualquer decisão que deixe a esteira
mais automática, desde que documentada". Desde a migration 056
(`supabase/migrations/20261112000056_sequencia_automatica.sql`, **escrita e
testada, não aplicada**), o caminho fica assim.

**O que acontece sozinho:**

1. **Análise iniciada → Clara.** Quem inicia a Análise Bancária no caso já põe
   a Clara para trabalhar.
2. **Tarefa do processo → orquestrador.** A tarefa escrita na lista de afazeres
   do processo vai para o orquestrador, que escolhe o agente.
3. **Análise aprovada → Lucas e Alice.** Quando o advogado aprova em Revisões a
   análise da Clara, o Lucas (kit do cliente: procuração, declaração de
   hipossuficiência e contrato de honorários) e a Alice (petições iniciais da
   primeira rodada, a partir do roteiro da Clara) entram na fila do mesmo caso,
   nessa ordem, em nome de quem aprovou. Um não espera o outro terminar.

**Regras:**

- Dispara mesmo quando a análise conclui que não há ação: o resultado não traz
  um campo seguro de "sem viabilidade". O Lucas e a Alice registram o "sem
  ação" na ficha de revisão, e o advogado decide em Revisões, como sempre.
- Aprovar de novo a mesma análise (reabrir e aprovar) não repete o trabalho.
- Rejeitar ou pedir alterações não chama ninguém.
- Agente pausado não recebe o trabalho, e isso fica anotado na aba Atividade
  do caso.
- A aprovação nunca falha por causa da sequência. Se der erro ao pôr um agente
  na fila, a aprovação vale, o erro fica na aba Atividade do caso e os
  administradores recebem um aviso para pedir à mão em "Executar em um caso".
  Reabrir e aprovar de novo também tenta outra vez.

**O que continua manual:** iniciar a análise no caso; aprovar, editar ou
rejeitar tudo em Revisões; a segunda rodada de iniciais da Alice (só sai com
pedido expresso); escrever as tarefas do processo (réplica, provas, recurso
etc.); mandar o kit para o cliente assinar e protocolar qualquer peça.

**Como mudar a sequência:** por enquanto, só pelo banco (peça ao suporte
técnico). Cada modelo de análise guarda a lista de agentes, na ordem, e o
pedido em texto de cada um (`next_agent_ids` e `next_agent_requests` em
`analysis_templates`). Lista vazia = nada acontece depois da aprovação. A tela
para configurar isso está no [pós-MVP](../../deploy/pos-mvp.md), item 5.

## Publicações e andamentos para os agentes (decisão de 13/11/2026)

A integração judicial do site (DJEN pelas OABs do escritório, DataJud pelo
número CNJ) já guardava as publicações e os andamentos dos processos
cadastrados. Faltava isso chegar aos agentes. Ficou assim:

1. **Prazo de cada publicação, sozinho.** Publicação nova de processo
   cadastrado vira um trabalho do agente de prazos, sem ninguém pedir; a
   proposta chega em Revisões. Com a migration 058, o agente de prazos do kit
   passa a ser o escolhido quando o escritório ainda não escolheu nenhum
   (decisão de deixar a esteira mais automática). Para desligar: Integrações →
   "Agente que propõe prazos" → "Nenhum (a equipe trata)".
2. **O pedido diz de que lado o cliente está.** O texto que o site manda ao
   agente ganhou as linhas "Nosso cliente: … · polo …" e "Parte contrária: …",
   tiradas do cadastro do processo (058).
3. **`PROCESSO_<CNJ>.txt` na pasta do cliente.** Quando o trabalho é de um
   processo cadastrado, o conector (1.3.2) grava na pasta do cliente um arquivo
   com os dados do processo, as partes, os andamentos e as publicações do DJEN
   (formato no [contrato](contrato-dos-clones.md)). Os clones leem esse
   arquivo: **nenhum clone consulta o DJEN ou o DataJud por conta própria**
   (a sessão do DG Brasil nunca carregou esse conector; as consultas saíram
   dos 11 clones que as citavam). Os índices do BACEN continuam vindo dos
   scripts.

Validação em 13/11/2026: [qa-clones.md](../../qa/clones/qa-clones.md), seção
"DJEN, DataJud e agente de prazos".

## O que foi feito

| Parte | Onde | Situação |
|---|---|---|
| Pasta dos clientes e base de conhecimento | `G:\Meu Drive\DG BRASIL\` | criadas |
| 13 clones | `agentes/bancario/` (só neste computador, fora do GitHub) | escritos; conferidos contra a lista do contrato (seção 9) |
| Scripts dos clones | `agentes/scripts/` (só neste computador, fora do GitHub) | copiados, adaptados e testados com dados fictícios |
| Dados do escritório (quem assina) | `C:\DGBrasil\agentes\escritorio.json` | criado neste computador, fora do repositório |
| Conector: pasta pelo nome do cliente, cadastro completo, quem assina, ficha de revisão | `apps/executor/src/` (versão 1.3.0) | feito; testes automáticos passando |
| Porteiro (qualidade), Arquivista, Mensageiro (ficha), orquestrador (regras) | `docs/mcp/pilotos/agentes/` | feito |
| Banco: cadastro completo e quem assina | `supabase/migrations/20261112000053_ponte_cadastro_completo.sql` | **escrita e testada, não aplicada** |
| Banco: kit básico (os 13 clones e o orquestrador já cadastrados no site, ativos; Análise Bancária com a Clara do kit se ainda não tiver agente) | `supabase/migrations/20261112000054_kit_basico_agentes.sql` | **escrita e testada, não aplicada** |
| Banco e site: campo "Forma de pagamento do contrato" no cadastro do cliente (pessoa física), que vai para o `DADOS DO CADASTRO.txt` e o Lucas usa no contrato | `supabase/migrations/20261112000055_forma_pagamento_contrato.sql`, `apps/frontend` | **escrito e testado, não aplicado** |
| Roteiro sem ação: o gerador da Clara produz o roteiro "sem viabilidade" (opção `--sem-viabilidade`) | `agentes/scripts/gerar_roteiro_consignado.py` | feito e testado |
| Instalador dos clones | `apps/executor/scripts/instalar-agentes-bancario.ps1` | **escrito, não rodado** |

## O que falta (validação)

O passo a passo, com o que a Barbara faz à mão e o que o Claude valida, está em
[mcp/clones-validacao.md](../../mcp/clones-validacao.md). Em resumo: aplicar
as migrations 053, 054 e 055 no banco de teste, reinstalar o conector 1.3.0,
rodar o instalador dos clones, conferir quem assina e validar cada clone com o
cliente fictício.

## Pendências conhecidas

- **Publicação que chegou antes de haver agente de prazos escolhido** não vai
  para o agente depois (só as novas vão). A equipe trata na tela Publicações
  ("Criar prazo" ou "Não há prazo"). Melhoria no [pós-MVP](../../deploy/pos-mvp.md), item 5.
- **Distribuição dos clones (decisão de 12/11/2026):** ficam só no computador
  do escritório, fora do GitHub, e são instalados a partir da pasta local. No
  site fica só o cadastro (kit básico, migration 054). O botão "Setup" no site
  é a prioridade do [pós-MVP](../../deploy/pos-mvp.md), item 6. **Enquanto
  isso, não há cópia dos clones fora desse computador.**
- **Titular do comprovante de residência:** o site não tem esse campo; o Lucas
  compara o nome do comprovante com o do cliente (pós-MVP, item 7).
- **Procuração do Lucas:** cobre só a revisional de consignado do INSS. O Atlas
  e o Vicente fazem ações que esse texto não cobre (também no pós-MVP, item 6).
- O que cada clone ainda depende de fora dele está na seção "O que falta fora
  do clone para funcionar" do relatório de cada agente.
