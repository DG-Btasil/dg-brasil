# Agentes clonados do DG Brasil: relatório da validação

**Guia:** [docs/mcp/clones-validacao.md](../../mcp/clones-validacao.md) · **Plano:**
[docs/agentes/clonagem](../../agentes/clonagem/README.md)
**Quando:** 12/11/2026, das 01:40 às 03:25 e das 21:38 às 22:50 (a sessão caiu às 03:25,
ver "Interrupção") · **Onde:** computador principal do escritório, banco de teste (DEV) ·
**Quem:** Claude, pelo site (navegador automático) e pelo PowerShell, com as
permissões dadas pela Barbara · **Conector:** 1.3.0 e depois 1.3.1

Só dados fictícios: cliente "DG Teste - José da Silva Fictício", documentos e autos de
`docs/mcp/pilotos/documentos/` (sete processos fictícios gerados para esta validação).

## Resultado

**APROVADO NO DEV, COM RESSALVAS.** Os clones fazem o trabalho jurídico pelo caminho
inteiro do DG Brasil:

1. o Porteiro confere os arquivos;
2. o Arquivista monta a pasta do cliente com o nome dele;
3. o clone trabalha e grava a minuta e a ficha de revisão;
4. o Mensageiro leva tudo para Revisões e cada item a completar ou decidir vira pendência.

Ninguém precisou responder pergunta no meio, nada foi enviado ao cliente e nada apareceu
no ChatJurídico ou na ADVBOX.

**Ressalvas:**
- nove defeitos apareceram na validação e foram corrigidos na hora (tabela "Achados");
- alguns testes ficaram para outra rodada (seção "O que não foi validado");
- o banco de teste avisou que está no limite de leitura e gravação de disco (seção
  "Supabase").

## Preparação

| Item | Resultado |
|---|---|
| Migrations 053, 054 e 055 | Aplicadas pela Barbara, sem erro |
| Kit no site | 13 clones e o orquestrador ativos em Agentes; "Análise Bancária" ligada à Clara do kit; os agentes antigos da ponte pausados |
| Campo "Forma de pagamento do contrato" | No formulário (Informações adicionais) e no detalhe do cliente; salvo "Parcelado no boleto" no cliente fictício |
| Conector | Reinstalado (1.3.0), chave do computador reaproveitada, diagnóstico "Tudo certo" |
| Instalador dos clones | 13 clones e 20 arquivos de scripts instalados, ponte e permissões ajustadas, cópia do anterior guardada |
| Quem assina | `C:\DGBrasil\agentes\escritorio.json` completo, menos o estado civil da advogada |
| Cópia de segurança dos clones | `G:\Meu Drive\DG BRASIL - BACKUP DOS AGENTES\kit-agentes-dg-2026-11-12.zip` |

## Itens conferidos em todo clone

| Item | Resultado |
|---|---|
| VC-PASTA | OK: `G:\Meu Drive\DG BRASIL\CLIENTE BANCÁRIO\DG TESTE - JOSE DA SILVA FICTICIO`, criada com o nome do cliente |
| VC-DADOS | OK: `DADOS DO CADASTRO.txt` com CPF, documento, nacionalidade, telefone, endereço e forma de pagamento; `DADOS DO ESCRITORIO.txt` com quem assina |
| VC-SAIDA | OK: minutas na raiz da pasta, com o nome `MINUTA_...` que o Mensageiro recolhe |
| VC-FICHA | OK em todos: GERADO, COMPLETAR, DECIDIR, CONFERIR, PRAZO e AVISOS |
| VC-REVISOES | OK: os arquivos, a ficha em PDF e uma pendência por item (ex.: 12 da Clara, 4 da primeira rodada) |
| VC-SEM-PARAR | OK: nenhuma sessão parou pedindo permissão |
| VC-SEM-FORA | OK: nada no ChatJurídico, na ADVBOX ou no e-mail |
| VC-ASSINA | OK: quem assina pelo cadastro; quando os autos mostram outra advogada, o clone avisa em DECIDIR |

## Clone por clone

| Clone | Resultado | O que se viu |
|---|---|---|
| Clara (CPF divergente) | OK | Os PDFs fictícios antigos tinham outro CPF: a Clara não analisou e deixou a decisão para o advogado (4 pendências) |
| Clara | OK | Roteiro (3 ações), teto normativo, análise com resumo por bloco em Revisões, 12 pendências |
| Porteiro (qualidade) | OK | Identidade só com um lado: pendência de qualidade, sem parar o trabalho |
| Lucas | OK | Procuração de 1 página, declaração, contrato com a forma de pagamento do cadastro; sem declaração de residência (comprovante no nome do cliente) |
| Alice | OK | Inicial de 20 páginas, jurisprudência conferida no portal do TJRJ, 4 lacunas; ações da segunda rodada não geradas (o pedido não autorizou), em DECIDIR |
| Murilo | OK, com achado | Réplica de 13 páginas, prazo 03/12/2026. Disse que a leitura das bases foi negada (achado 4) |
| Laura | OK, com achado | Emenda de 5 páginas, mapa do despacho, prazo 03/12/2026. A trava confundiu o kit com peça (achado 5); a entrega caiu (achado 2) |
| Paulo | OK | Agravo com efeito suspensivo, prazo 03/12/2026; gravou a jurisprudência conferida na base do DG Brasil |
| Pedro | 1ª tentativa bloqueada | Reserva órfã da execução que caiu com a sessão (achado 6); pedido de novo |
| Rafael | OK | Recurso inominado de 14 páginas, prazo 26/11/2026; apontou que cabem embargos antes |
| Beatriz | OK | Cumprimento com planilha de 64 parcelas pelo BACEN (a consulta pela internet funcionou), prazo 18/11/2026 |
| Teresa | OK | Orientações ao cliente e roteiro do advogado em PDF; perguntas a confirmar com o cliente |
| Atlas | OK | Inicial revisional pela taxa média do BACEN, com o cálculo; jurisprudência gravada na base do DG Brasil; a procuração do kit não cobre esta ação (avisou) |
| Clara sem viabilidade | OK, com ressalva | O script gerou o roteiro "sem viabilidade" e ele passou na conferência. Não foi gravado na pasta porque o mesmo cliente fictício já tinha outro roteiro e um extrato diferente: a Clara deixou a escolha para o advogado (efeito do teste, não do clone) |
| Vicente (1ª e 2ª) | Bloqueado | A trava casou a "Seguradora Fictícia" com a inicial do Atlas contra a "Financeira Fictícia" (achado 7, corrigido); pedido pela terceira vez |
| Orquestrador | OK | A tarefa "Réplica à contestação", sem agente escolhido, foi para o Murilo; a trava viu que a réplica já existia e não redigiu de novo; pendência "manter ou refazer" e o prazo em Revisões |
| Pedro (2ª) | OK | Com a reserva de 6 horas: especificação de provas (julgamento antecipado; subsidiariamente, perícia em prova digital), prazo 03/12/2026 |
| Gabriel (1ª) | Bloqueado | O Porteiro parou o trabalho por não ler a minuta .docx do Rafael no mesmo caso (achado 8) |
| Gabriel (2ª) | OK | Com o conector corrigido: minuta dos embargos de declaração |
| Vicente (5ª) | OK | Com a trava corrigida: inicial contra a Seguradora Fictícia, na Vara Cível |

## Achados (todos corrigidos)

| # | O que aconteceu | Correção |
|---|---|---|
| 1 | O Arquivista copiava de volta para a pasta do cliente os PDFs que os agentes já tinham entregado (roteiro, kit), duplicando arquivos e confundindo a trava de peça repetida | Conector 1.3.1: documento de origem "agente" não é copiado |
| 2 | Duas sessões no mesmo computador: a que abria apagava as pastas de trabalho da outra (a Laura perdeu a entrega). Aconteceu porque uma segunda sessão foi aberta para um teste | Conector: só apaga pasta de trabalho parada há mais de 24 horas |
| 3 | A sessão levou o contexto de um trabalho para o seguinte e a Clara gravou a ficha com `_v2` sem pedido de refazer | Roteiro da sessão: `_v2` só quando o pedido mandar refazer |
| 4 | O Murilo tentou ler as bases do Drive pelo terminal, que a sessão bloqueia (a leitura pela ferramenta de arquivos funciona: testado) | Regra "Como ler arquivos nesta sessão" em todos os clones e no contrato |
| 5 | A trava de peça repetida tratava a declaração de hipossuficiência do kit como emenda | `checar_peca.py`: produtos dos clones (kit, análises, fichas) nunca contam como peça; a emenda de verdade continua bloqueando (testado) |
| 6 | A reserva de peça valia 24 horas: a execução que caiu com a sessão travou o Pedro no dia seguinte | `checar_peca.py`: reserva vale 6 horas no DG Brasil |
| 7 | A trava compara o réu por palavras: "Seguradora Fictícia" ficava bloqueada pela inicial do Atlas contra a "Financeira Fictícia" (na vida real, "Bradesco Seguros" e "Banco Bradesco") | `checar_peca.py`: seguradora, previdência e capitalização são outra ré, e a palavra do ramo não conta como coincidência. Testado nos quatro sentidos; a mesma ré continua bloqueando. Na leitura do texto da peça, réu do ramo de seguros só casa com o nome inteiro. Documentos de prova (consulta SUSEP, apólice, contrato de empréstimo, cédula, boleto, Registrato) deixaram de ser "possível peça". Melhoria futura: comparar pelo CNPJ |
| 8 | O Porteiro parou o Gabriel porque não conseguiu ler a minuta .docx que o Rafael tinha entregado no mesmo caso | Conector: documento entregue por agente do DG Brasil sai como "DE AGENTE", não passa pela leitura do Porteiro e não é copiado; instrução nova no Porteiro |

Achados menores, sem correção agora:
- "brasileira" para cliente homem na procuração: o cadastro não tem gênero;
- nomes de arquivo do kit com e sem acento;
- nome do roteiro com `__` quando o cadastro tem hífen;
- a nota do teto normativo explica mal por que os contratos ficaram como "dados atípicos";
- os documentos fictícios dos processos não batem com o HISCON (dado de teste): os clones perceberam e avisaram.

## Interrupção

Por volta de 03:25 a sessão do Claude Code e a Vigia foram encerradas juntas (computador
desligado ou em suspensão). A fila ficou intacta: o trabalho que estava reservado voltou
sozinho para a fila. A validação foi retomada às 21:38 com três sessões em paralelo, sem
conflito (cada uma reserva um trabalho).

**Lição:** validação longa sem ninguém no computador não é confiável; dividir em rodadas
curtas.

## Supabase (banco de teste)

O Supabase avisou que o projeto DEV está gastando o orçamento de leitura e gravação de
disco. Causas prováveis: o comando de espera da Vigia (consulta o banco a cada poucos
segundos), a sincronização do DataJud tentando de novo 285 processos com erro, e o volume
desta validação. Entrou no pós-MVP.

## Sequência automática (decisão de 12/11/2026)

Migration 056: quando o advogado aprova em Revisões a análise da Clara, o Lucas (kit) e a
Alice (iniciais da primeira rodada) entram na fila sozinhos. Testada no banco simulado (886
verificações) e **validada no DEV em 12/11/2026, 23:08**: aprovada a análise do caso 5, o Lucas
e a Alice entraram na fila, nessa ordem. As duas execuções foram interrompidas em seguida (o kit
e a inicial do caso já existiam). Falta só ver os dois rodarem depois da aprovação.

## Rodada curta (12/11/2026, 23:20 às 23:24, duas sessões em paralelo)

| Item | Resultado | O que se viu |
|---|---|---|
| Porteiro com documento malicioso | OK | Barrou a carta com instruções para a IA, registrou a pendência e parou o trabalho antes de qualquer agente |
| Refazer (Lucas) | OK | Procuração e declaração saíram como `_v2`; a versão 1 ficou na pasta |
| Lucas sem forma de pagamento | OK, com achado | Não gerou o contrato e deixou a decisão para o advogado. Achado 9: o arquivo de dados manteve a forma antiga depois que ela foi apagada no site |

| # | O que aconteceu | Correção |
|---|---|---|
| 9 | Campo apagado no site continuava no `DADOS DO CADASTRO.txt` (a regra de não perder o que a equipe completou à mão valia também para campos do site) | Conector: campo que o DG Brasil manda vale o do site, mesmo vazio; só o que o site não manda fica do arquivo (teste novo; 62 testes) |

Observação: como todos os casos de teste são do mesmo cliente, a pasta dele acumulou
documentos de vários casos (o Lucas usou o `HISCON (2).pdf` e o `COMPROVANTE DE
RESIDÊNCIA (2).pdf` vindos de outro caso). Na vida real é o comportamento esperado: o
documento mais novo do cliente vale. Para testes, usar um cliente fictício por cenário.

## DJEN, DataJud e agente de prazos (13/11/2026)

Com autorização da Barbara, UM processo real foi cadastrado no caso de teste 17
só para esta validação (a apagar depois). Rodada curta, de 00:05 a 00:35.

| O que | Como | Resultado |
|---|---|---|
| Busca do DJEN pelas OABs | Integrações → "Buscar agora", com as duas buscas ligadas | **Passou.** 565 publicações achadas; guardou só a do processo cadastrado (1) e descartou 564 de quem não é cliente |
| Publicação na tela | Publicações → "Todas a tratar" | **Passou.** Intimação de 10/11/2026, com órgão, classe, teor e os botões "Criar prazo" e "Não há prazo" |
| Andamentos do DataJud | Lotes automáticos e consulta direta à API do CNJ | **Pendente por lentidão do CNJ.** A API pública respondeu à consulta direta (37 andamentos do processo), mas levou 49 s e recusou duas tentativas por sobrecarga; o site espera 45 s e marcou "DataJud não respondeu". O site tenta de novo sozinho a cada hora. A cópia pública do CNJ estava atualizada só até julho de 2026 |
| Agente de prazos cadastrado e escolhido | Agentes → Criar agente; Integrações → "Agente que propõe prazos" | **Passou.** Salvo e conferido ao reabrir a tela |
| Publicação real → proposta | Pedido igual ao que o banco monta, execução ligada, uma sessão | **Passou.** Proposta "Sem prazo:" em Revisões: o despacho manda o cartório fazer o sequestro e expedir a ordem de pagamento, sem prazo para o cliente. O agente ainda apontou que o nome da parte no teor não era o do cliente do cadastro (verdade: o caso de teste usa o cliente fictício) |
| Publicação fictícia de réplica → proposta | Idem, com um ato ordinatório fictício de 15 dias | **Passou.** "Proposta de prazo" em Revisões: Réplica à contestação, vencimento 03/12/2026 às 23:59, prioridade alta, contagem conferida de duas formas (lista do pedido e script), agente indicado para a peça |
| Testes em memória | `npm run verificar` e testes do conector | **Passou.** 907 verificações no banco; 71 testes no conector |

Depois da migration 058 aplicada no banco de teste (13/11/2026, 01:00):

| O que | Como | Resultado |
|---|---|---|
| Conector publicado | Comparação do pacote instalado com o do site | **Passou.** O 1.3.2 deste computador é idêntico ao que o site entrega |
| `ver_processo` com as publicações | Sessão curta num trabalho do caso 17 | **Passou.** O processo veio com a publicação e o teor |
| `PROCESSO_<CNJ>.txt` na pasta do cliente | A mesma sessão, parada de propósito depois do Arquivista | **Passou.** Arquivo gravado na pasta do cliente com cabeçalho, dados do processo, andamentos e a publicação (disponibilizada, publicada, tipo, órgão, link e teor). Apagado em seguida, por ter dado real |

Achado: **caso sem nenhum documento não passa pela ponte.** O Porteiro não tem
o que conferir, não grava a liberação e o Arquivista recusa a cópia. Na
primeira tentativa o caso 17 não tinha documento; com um documento fictício
anexado, passou. Na prática todo caso tem documento, mas a mensagem ao
advogado deveria dizer "anexe os documentos do caso" (pós-MVP, item 5).

**Mudanças de 13/11/2026, manhã (migrations 060 e 061, conector 1.3.4):**

- **Pasta do cliente com a origem (060):** `G:\Meu Drive\DG BRASIL\<ORIGEM>\
  CLIENTE BANCÁRIO\<CLIENTE>`, onde a origem é o escritório de origem do
  cadastro do cliente (o escritório ou o parceiro). Testes: 951 verificações
  no banco e 83 no conector. **Ao vivo, depende de aplicar a 060.**
- **Word + PDF na pasta do cliente:** ao trazer uma minuta em Word, o conector
  gera o PDF com o Word do computador e grava ao lado, só na pasta do cliente
  (para o site vai o Word). Conversão real testada neste computador: 14 s, sem
  Word aberto no fim.
- **Anexar documento na revisão:** botão na tela da revisão que abre o mesmo
  envio da aba Documentos do caso. Testes do site: 688, build ok.
- **O prazo vira tarefa (061):** prazo do agente de prazos cria a tarefa do
  processo e a manda ao orquestrador; sem os autos, a tarefa fica aberta.
  Testado em memória; **ao vivo, depende de aplicar a 061**.

**Validação ao vivo depois das migrations 060 e 061 (13/11/2026, 02:27 a 02:40):**
um trabalho de verdade da Laura (refazer a emenda fictícia, caso de teste 17),
pela ponte inteira.

| O que | Resultado |
|---|---|
| Origem informada pelo banco (060) | **Passou.** `ver_ponte`: "Origem do cliente: Bárbara Cardoso Advocacia (escritório)" |
| Pasta com a origem | **Passou.** Trabalho feito em `G:\Meu Drive\DG BRASIL\BARBARA CARDOSO ADVOCACIA\CLIENTE BANCÁRIO\DG TESTE - JOSE DA SILVA FICTICIO`. A pasta de teste antiga foi movida para lá antes; a pasta `DG BRASIL\CLIENTE BANCÁRIO` ficou vazia e foi removida |
| Linha da origem no cadastro | **Passou.** `DADOS DO CADASTRO.txt` com `escritorio_de_origem: Bárbara Cardoso Advocacia (escritório)` |
| Refazer na pasta nova | **Passou.** Minuta e ficha `_v2` geradas; a versão anterior ficou intacta |
| PDF da minuta em Word | **Passou.** PDF válido ao lado do Word, com o mesmo nome; não foi para o site |
| Entrega em Revisões | **Passou.** Minuta em Word, ficha em PDF e as propostas dos itens da ficha |
| Opções na tela de Integrações (059 e 061) | **Passou.** "Prazo entra direto na agenda" e "Prazo vira tarefa para os agentes" aparecem ligadas |
| Anexar documento na revisão | **Passou.** Documento fictício anexado pela tela da revisão; apareceu na lista e nos documentos do caso |

Ainda só em memória (dependem de uma publicação nova de processo real
cadastrado): o prazo direto e a tarefa criada a partir do prazo.

**Mudanças de 13/11/2026, madrugada (pedidas pela dona depois da rodada):**

- **Prazo direto (migration 059, conector 1.3.3):** o prazo do agente de prazos
  entra na agenda sem Revisões. Testado em memória (928 verificações no banco);
  **ao vivo, depende de aplicar a 059 no banco de teste**.
- **DataJud com mais paciência:** cada consulta espera até 2 min e insiste 3
  vezes na recusa; a rodada agendada trabalha 4 min; o botão "Buscar
  andamentos agora" do processo também espera 2 min. **Validado no site
  (01:20):** a busca do processo de teste levou cerca de 1 minuto e trouxe 36
  andamentos, a vara e o assunto. Com os 45 s de antes, tinha falhado em
  todas as tentativas da noite.
- **Prévia do arquivo em Revisões:** a tela da revisão mostra a primeira página
  de PDF e de Word e a imagem; o botão diz o formato ("Baixar em Word",
  "Baixar em PDF"). Não há conversão entre Word e PDF. **Validado no site:**
  procuração do Lucas (PDF) e minuta do recurso do Rafael (Word) aparecem na
  tela da revisão, sem baixar nada.
- **Processo real de teste:** excluído do site em 13/11/2026, 01:25, depois das
  validações (exclusão lógica, registrada na auditoria). O caso de teste 17
  fica para a limpeza dos casos de teste.

Ainda não visto ao vivo: a publicação nova virar trabalho do agente
**sozinha** (nesta rodada a publicação já estava guardada quando o agente foi
escolhido, então o pedido foi criado à mão, com o mesmo texto). Coberto pelos
testes em memória.

Aprovar a proposta de prazo (para ver o prazo nascer no caso) ficou para uma
pessoa: é a decisão humana que a esteira exige.

Achados desta rodada:

- o teor de algumas publicações aparece com `&emsp;` escrito (pós-MVP, item 5);
- publicação que chega antes de haver agente escolhido não vai para ele depois
  (pós-MVP, item 5);
- os 9 processos fictícios dos casos de teste contam como "processos com
  aviso" na tela de Integrações, porque o DataJud nunca os acha. Some com a
  limpeza dos casos de teste.

## O que ainda não foi validado

- Os agentes rodando sozinhos depois da aprovação (a sequência 056 põe os dois na fila:
  validado).
- Conector DJEN na sessão do DG Brasil (os clones seguem pelos autos e avisam).

## Pode ligar na produção?

**Ainda não.** Falta:
1. publicar o conector com as correções (vai junto deste commit; o site publica sozinho) e
   reinstalar nos computadores;
2. aplicar na produção as migrations 051 e 053 a 056 (o roteiro está em
   [deploy/producao.md](../../deploy/producao.md), item 14);
3. decidir a distribuição dos clones (pós-MVP, item 6), porque hoje eles existem só neste
   computador.

## Limpeza

- Desligar a execução no site quando não for usar.
- A pasta de teste `DG BRASIL\CLIENTE BANCÁRIO\DG TESTE - JOSE DA SILVA FICTICIO` e os
  casos "DG Teste - caso 4" a "caso 15" podem ser apagados ou arquivados depois da revisão.
