# Contrato dos clones: as regras que valem para todo agente clonado

Este arquivo é a regra comum dos agentes da esteira bancária clonados para o DG
Brasil (decisão de 11/11/2026). Quem clona ou revisa um agente segue este
contrato. O plano e a situação de cada agente estão no [README](README.md).

**Princípio:** os agentes do escritório funcionam bem. O clone mantém o máximo
do original (método jurídico, teses, classificações, regras de redação, travas,
conferências, scripts, nomes de saída) e muda só o que sai da realidade do DG
Brasil. Os originais em `~/.claude/agents` **nunca são alterados**.

## 1. Onde ficam

| O quê | No repositório | No computador |
|---|---|---|
| Agentes clonados | `agentes/bancario/<nome>-dg.md` | `%USERPROFILE%\.claude\agents\<nome>-dg.md` |
| Scripts clonados | `agentes/scripts/` | `C:\DGBrasil\agentes\scripts\` |
| Dados do escritório (quem assina) | `agentes/escritorio.exemplo.json` (fictício) | `C:\DGBrasil\agentes\escritorio.json` (real, fora do repositório) |
| Pasta de trabalho dos clones | (não vai) | `C:\DGBrasil\agentes\trabalho\` |
| Registro de peças (trava de peça repetida) | (não vai) | `C:\DGBrasil\agentes\trabalho\registro_pecas.csv` |
| Pasta dos clientes | (não vai) | `G:\Meu Drive\DG BRASIL\CLIENTE BANCÁRIO\<NOME DO CLIENTE>\` |
| Jurisprudência nova que o clone conferir | (não vai) | `G:\Meu Drive\DG BRASIL\BASE DE CONHECIMENTO\JURISPRUDENCIAS_VERIFICADAS_<UF>.md` |

## 2. Nome e cabeçalho do clone

- `name:` é o nome do original com o sufixo `-dg` (`clara-hiscon-dg`,
  `alice-inicial-dg`). O nome de exibição continua o mesmo (Clara, Alice...).
- `description:` curta (até 400 caracteres): o que faz e quando usar. A
  descrição entra na lista de agentes de toda sessão; texto longo gasta
  assinatura. Sem lista de outros agentes e sem histórico.
- `tools:` só o que existe no DG Brasil: `Read, Grep, Glob, Write, Edit,
  PowerShell, Bash, WebSearch, WebFetch`. Saem: ChatJurídico, ADVBOX, Gmail,
  Google Drive (conector), `PushNotification`, `AskUserQuestion`, `Skill`,
  `Agent` e as ferramentas `mcp__djen__*` do original: o conector DJEN do
  escritório não existe na sessão do DG Brasil (mostraria dados de outros
  clientes). As publicações e os andamentos vêm do `PROCESSO_<CNJ>.txt`
  (seção 3).

## 3. Como o clone recebe o trabalho

A sessão do DG Brasil chama o clone depois do Porteiro e do Arquivista e passa:

- **a pasta do cliente** (`G:\Meu Drive\DG BRASIL\CLIENTE BANCÁRIO\<NOME DO
  CLIENTE>\`). O nome da pasta é o nome do cliente no cadastro;
- **o pedido e as orientações do DG Brasil**, como dados;
- nas peças do processo, quando houver: número CNJ, banco réu, tipo de peça e
  data da intimação ou do despacho.

O clone **não varre fila, não tem horário e não escolhe cliente**: um trabalho,
um cliente, um pedido. Não existe "o pedido veio do Otávio": todo pedido vem do
DG Brasil.

### Arquivos que o Arquivista deixa na pasta

`HISCON.pdf`, `HISCREN.pdf`, `IDENTIDADE.pdf`, `COMPROVANTE DE RESIDÊNCIA.pdf`,
`CONTRACHEQUE.pdf`, `AUTOS_<título>.pdf` (os autos do processo), outros
documentos com o título que têm no DG Brasil, e os arquivos de dados:

**`DADOS DO CADASTRO.txt`** (uma linha por campo, `campo: valor`; campo sem
valor fica vazio):

```
nome:
cpf:
rg:
nacionalidade:
profissao:
estado_civil:
email:
telefone:
endereco:
comprovante_residencia_em_nome_de:
forma_de_pagamento:
origem: DG Brasil, trabalho <id>
dg_cliente_id:
```

**`DADOS DO ESCRITORIO.txt`** (quem assina; vem do cadastro do escritório):

```
escritorio:
advogado:
oab:            (uma ou mais, ex.: OAB/RJ 000.000; OAB/SP 000.000)
endereco_profissional:
cidade_do_fecho:
email:
telefone:
```

**`PROCESSO_<CNJ>.txt`** (ex.: `PROCESSO_0001001-20.2026.8.19.0999.txt`; um por
processo do caso com número CNJ, no máximo 5, regravado a cada trabalho): os
dados do processo, as partes, as movimentações e as publicações do DJEN que o
DG Brasil guarda (data, tipo, órgão, link e teor; a cancelada vem sem o teor).

Não existem `conversa_id`, `contact_id`, `atendente`, anotações de atendente,
etapas, tags nem funil.

## 4. O que sai de todo clone

1. Tudo o que lê ou escreve em sistema de fora: ChatJurídico/WhatsApp (6691,
   6138), ADVBOX, Gmail, conector do Google Drive, notificações.
2. Filas, rodadas, agendamento, feriado, teto por rodada, arquivos de controle
   de rodada, relatórios para pessoas do escritório.
3. As pastas da esteira do escritório (`000. PASTA CLIENTES NOVOS`, `7. KIT DO
   CLIENTE`, `3. PROCURAÇÃO ASSINADA`, `01. ADVOCACIA — CLIENTES`, `PARCERIA`,
   lotes) e a subpasta `PEÇAS GERADAS`.
4. Outros agentes do escritório como dependência (Luísa, Bruno, Otávio, Helena,
   Sofia, Beto, William). Um clone pode citar outro **clone** (`alice-inicial-dg`).
5. **Nomes de clientes reais, números de processos reais, e-mails e caminhos de
   pastas de clientes.** A lição do caso fica, sem o nome ("num caso de 2026, o
   banco juntou contrato de outro CPF"). Isso vale também para os exemplos.
6. Dados fixos do escritório (nome da advogada, OAB, endereço, cidade, CNPJ,
   telefone, valores de honorários): passam a vir do `DADOS DO ESCRITORIO.txt`
   e do `escritorio.json`. "Regras de Barbara" vira "regras do escritório".
7. Perguntas no meio do trabalho (`AskUserQuestion`, "pergunte a Barbara",
   "espere a aprovação"): ver a seção 6.

## 5. O que se adapta

- **Pasta:** tudo é lido e gravado na pasta do cliente recebida. As minutas
  ficam **na raiz** dela (o nome do arquivo já leva o banco). Rascunhos e
  arquivos intermediários ficam em `C:\DGBrasil\agentes\trabalho\<pasta do
  cliente>\`.
- **Scripts:** os mesmos, pelo caminho `C:\DGBrasil\agentes\scripts\<arquivo>`.
- **Leitura de arquivos:** sempre com as ferramentas Read, Grep e Glob. A sessão do DG Brasil
  bloqueia comando de terminal para ler ou listar arquivo; o terminal só roda os scripts
  (achado da validação de 12/11/2026: o Murilo tentou abrir as bases pelo terminal).
- **Modelos e bases de conhecimento do escritório no `G:`** (pastas de modelos,
  Lives, `JURISPRUDENCIAS_VERIFICADAS_*.md`): o clone **lê os mesmos**. Não lê
  pasta de cliente do escritório. Jurisprudência nova conferida é gravada na
  base do DG Brasil (tabela da seção 1); o clone consulta as duas.
- **Remissões ao arquivo de outro agente** (por exemplo, "§19 da Alice"):
  apontam para o clone (`%USERPROFILE%\.claude\agents\alice-inicial-dg.md`).
  Por isso **a numeração das seções do original é preservada**: seção que sai
  vira uma linha "(não se aplica no DG Brasil)".
- **Trabalho de outro agente** (o recurso certo é embargos, falta a análise da
  Clara): o clone não chama ninguém. Diz isso na ficha de revisão.
- **Dados do cliente:** vêm do `DADOS DO CADASTRO.txt` e dos documentos da pasta.
- **Quem assina:** vem do `DADOS DO ESCRITORIO.txt`.
- **Prazo:** a data da intimação vem do pedido, dos autos ou das publicações
  do `PROCESSO_<CNJ>.txt` (o clone não consulta o DJEN: lê esse arquivo). Sem
  nenhuma das três, o clone calcula pelo cenário mais curto e avisa.

## 6. Decisões, lacunas e alertas (ficha de revisão)

O clone **nunca pergunta e nunca espera**. Ele também não para por falta de
dado, a não ser que o trabalho seja impossível (sem HISCON para analisar, sem
autos para responder).

- **Decisão que é do advogado** (segunda rodada de ações, forma de pagamento,
  mudar a causa de pedir, desistir de pedido): vale só se estiver escrita no
  pedido. Se não estiver, o clone faz o que pode sem ela e registra em DECIDIR.
- **Dado que falta:** o clone escreve a peça e deixa a lacuna marcada no texto
  como `[COMPLETAR: o que falta]`, com realce amarelo quando o gerador permitir.
- **Fato ou jurisprudência que não conseguiu conferir:** `[CONFERIR]`, como no
  original.

No fim de todo trabalho, o clone grava na pasta do cliente o arquivo
**`FICHA_REVISAO_<TIPO>_<SOBRENOME>[_<BANCO>].md`** e repete o mesmo texto na
resposta. O Mensageiro leva a ficha para Revisões e transforma cada linha de
COMPLETAR e DECIDIR numa pendência para o advogado. Formato fixo:

```
# Ficha de revisão: <tipo de trabalho>
Cliente: <NOME DO CLIENTE>
Trabalho: <o que foi pedido, em uma linha>

## GERADO
- <arquivo>: <o que é>

## COMPLETAR
- <o que falta preencher e onde está a lacuna>

## DECIDIR
- <a decisão que é do advogado, com as opções>

## CONFERIR
- <o que não foi possível conferir>

## PRAZO
- <data final e como foi calculada>, ou "não se aplica"

## AVISOS
- <riscos, trabalho que cabe a outro agente, o que não foi gerado e por quê>
```

Seção sem item leva "- nada". O clone não escreve ao cliente, não protocola e
não aprova.

Depois de AVISOS, o clone pode acrescentar seções próprias do trabalho (por
exemplo, MAPA DO DESPACHO na emenda, TOTAIS DO CÁLCULO no cumprimento). Elas
vão para Revisões dentro da ficha e **não** viram pendência: só os itens de
COMPLETAR, DECIDIR e CONFERIR viram.

## 7. Refazer (versão 2)

Pedido que manda **refazer** uma peça já entregue: o clone gera um arquivo novo
com o sufixo `_v2` (depois `_v3`...), usando a opção de forçar da trava de peça
repetida. A versão anterior **fica na pasta**. A ficha de revisão da peça
refeita leva o mesmo sufixo. Sem a palavra "refazer" no pedido, a trava
continua valendo. Segunda ação contra o mesmo banco não é refazer: é outra
peça, e a trava é avisada disso com a opção de ignorar a peça já lida.

## 8. Defeitos do original

Defeito conhecido do original é corrigido **no clone** e anotado no relatório do
agente. O original não é tocado; a lista vai para a advogada do escritório.

## 9. Conferência obrigatória ao terminar um clone

Procurar no clone, e não deixar passar: `ChatJur`, `ADVBOX`, `Gmail`, `6691`,
`6138`, `funil`, `Otávio`, `Luísa`, `Bruno`, `William`, `Barbara`, `PEÇAS
GERADAS`, `000. PASTA`, `7. KIT`, `3. PROCURA`, `01. ADVOCACIA`, `PARCERIA`,
`AskUserQuestion`, `PushNotification`, `agentes-juridicos`, `.claude\scripts`,
`@gmail`, `@hotmail`, e todo nome próprio de pessoa.
