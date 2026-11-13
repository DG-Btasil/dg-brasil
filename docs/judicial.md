# Integração judicial e prazos (Etapa 8)

Migration `20261101000043_judicial_monitoring.sql`; correções da revisão final em
`20261113000062_judicial_revisao_final.sql` (marcadas com "062" abaixo). Código do servidor em
`apps/frontend/src/server/integrations/judicial/` (DJEN, DataJud, rodada) e
`src/server/domain/judicial/` (telas). Telas em `src/features/judicial/`.

## Princípio

A integração **só atualiza processos que já estão no DG Brasil**. Ela não
importa clientes nem processos da OAB: o DG Brasil não é banco de dados de
cliente (decisão da Barbara, 2026-11-03).

1. O advogado protocola e cadastra o número CNJ no processo.
2. Daí em diante, o processo recebe sozinho:
   - as publicações do DJEN, pelas OABs acompanhadas;
   - os andamentos do DataJud, pelo número CNJ.
3. Publicação de processo que **não** está no DG Brasil não entra e nada dela
   é guardado, nem o número. Fica só a contagem do dia (prova de diligência).

A **OAB** é a chave de busca no DJEN: uma consulta por OAB traz as publicações
de todos os processos dela, e o servidor descarta na hora as de processos não
cadastrados. Buscar pelo número de cada processo também funciona (testado em
2026-11-04), mas seriam muitas consultas (uma por processo, com limite de 20
por minuto). A Barbara escolheu manter a OAB (2026-11-04).

## Fontes (oficiais e gratuitas)

| Fonte | O que traz | Como | Observações (conferidas em 2026-11-03) |
|---|---|---|---|
| **DJEN** — Comunica API do CNJ | Publicações e intimações por OAB | `GET comunicaapi.pje.jus.br/api/v1/comunicacao`, sem credencial | Ver lista abaixo |
| **DataJud** — API pública do CNJ | Dados do processo e movimentações | `POST api-publica.datajud.cnj.jus.br/api_publica_<tribunal>/_search`, chave pública | Ver lista abaixo |

**DJEN:**
- 20 consultas por minuto por IP. O servidor faz uma por vez, com 3 s de intervalo.
- Páginas de 100 itens.
- O texto chega puro, com `<br>` ou como HTML inteiro; o servidor converte para texto e limpa as entidades (`&emsp;`, `&nbsp;` e afins não sobram no teor).
- Parte das publicações sai com até 5 dias de atraso. Por isso cada busca revê os últimos 5 dias (configurável de 1 a 7): é a **janela normal**.
- **Dias antigos (062).** A janela fixa perdia publicação quando a captura ficava parada mais dias que a janela. Agora cada dia dos últimos 30 só é dado como lido quando foi conferido com sucesso "dias revistos" dias depois dele (a prova de diligência, `judicial_capture_days`). Faltando algum (captura parada, OAB nova, OAB pausada), a rodada lê primeiro a janela normal de todas as OABs e depois os dias antigos que faltam, em pedaços de até 7 dias, do mais antigo para o mais novo. A OAB com dia antigo por ler continua na fila dos lotes até ficar em dia. Uma OAB nova começa lendo os 30 dias.
- Uma comunicação pode ser cancelada depois. O DG Brasil registra o cancelamento e avisa a equipe.

**DataJud:**
- Um processo devolve vários documentos, um por grau.
- O movimento não tem identificador. A chave contra duplicata é um hash do documento, do código, da data/hora, dos complementos e do órgão.
- A cópia pública atrasa de 1 a 3 semanas, e algumas consultas levam de 30 a 50 s.
- O índice de cada tribunal sai do número CNJ (segmentos J.TR). O TRE-DF é `tre-df`; a wiki do CNJ diz `tre-dft`, que dá 404.
- O STF não tem índice público.
- Termos de uso: até 120 requisições por minuto, uso não comercial. O DG Brasil é sistema interno do escritório e não é vendido.
- A chave pública pode mudar; a variável `DATAJUD_API_KEY` sobrepõe a padrão.

**Por que não o APOGEU:**
- Ele faz o mesmo a partir das mesmas fontes, mas é pago, limitado a 30 OABs e está na conta do escritório.
- Os parceiros cadastram as próprias OABs, e as publicações deles passariam por essa conta.
- Decisão de 2026-11-09: o APOGEU **não será usado**, nem como segunda fonte.

## Quando roda

| O quê | Quando | Quem chama |
|---|---|---|
| Lotes: publicações (DJEN) das OABs ainda não conferidas no dia e, no tempo que sobrar, andamentos (DataJud) | A cada 5 min, a partir das 05:00 de Brasília, até todas as OABs darem certo no dia | pg_cron `dg-judicial` → `private.judicial_cron_kick()` → pg_net → `/api/cron/judicial-sync` |
| Lotes só do DataJud | A cada 5 min, quando não há OAB pendente; sem processo vencido, nem chama | o mesmo, com `?only=datajud` |
| Reserva | 06:30 de Brasília (`30 9 * * *` UTC) | Vercel Cron → `/api/cron/judicial-sync` |
| Vigia (062): solta publicação presa com o agente e avisa se a captura do dia atrasou | A cada 15 min | pg_cron `dg-judicial-vigia` → `private.judicial_watchdog()` |
| "Buscar agora" (todas as OABs + DataJud) | Na tela, ADMIN | Server Action |
| "Buscar andamentos agora" (um processo) | Na tela, ADMIN ou advogado | Server Action |

- **Por que em lotes:** o DJEN aceita 20 consultas por minuto e o DataJud leva
  de 30 s a mais de 1 min por processo. Desde 13/11/2026 cada rodada agendada
  trabalha até 4 min (a função da Vercel pode rodar 5 min, com o Fluid
  Compute); antes eram 60 s, e o DataJud quase nunca cabia. Com as OABs do
  escritório e as dos parceiros (50, por exemplo), são poucos lotes: a
  conferência termina antes das 06:00.
- **OAB pendente no dia** (`private.judicial_djen_due`): a partir das 05:00, sem
  busca com sucesso naquele dia **desde as 05:00** (062: "Buscar agora" de
  madrugada não dá o dia por conferido, porque o caderno sai às 03:00), ou com
  dia antigo por ler. Depois de uma tentativa, espera 10 min. Cada OAB é
  consultada uma vez, mesmo que esteja em dois escritórios.
- **Limite por rodada:** a rodada agendada para de começar trabalho novo perto
  dos 4 min ("Buscar agora", na tela, perto dos 45 s) e deixa o resto para o
  próximo lote:
  - uma OAB só começa se ainda houver ~12 s;
  - uma OAB com páginas demais para uma rodada (mais de ~1.500 publicações em 5
    dias) fica com falha visível na tela; nesse caso, reduzir "Dias revistos" ou
    passar para o plano Pro (deploy/producao.md, item 10);
  - os processos lidos há mais tempo no DataJud vão primeiro.
- **Leitura do DataJud** (044): cada processo é lido no máximo uma vez a cada 20 h. Falha passageira (tempo esgotado, 429, 5xx, rede) volta em 1 h; "ainda não aparece no DataJud" volta em 20 h. Depois de 3 falhas passageiras, a rodada para de consultar o DataJud (o CNJ costuma estar instável).
- **Prazo de cada consulta:** nenhuma consulta ao DJEN ou ao DataJud passa do prazo da rodada (4 min na rota de 5 min), para a rodada sempre gravar o fim.
- **Paciência com o DataJud (13/11/2026):** cada consulta espera até 2 min pela resposta do CNJ (eram 45 s; nesse dia o CNJ levou 49 s e o site desistia antes). Quando o CNJ recusa por sobrecarga (429 ou 5xx), a consulta tenta até 3 vezes, esperando 4 s e depois 12 s. Quem chama a rota (pg_net, 60 s) desiste antes do fim; a função continua e grava o resultado.
- **Rodadas ao mesmo tempo:** duas rodadas não correm juntas; a segunda recebe "busy". Rodada sem fim gravado há 6 min vira "Interrompida" e avisa os ADMIN (062; mesma chave do aviso de falha, no máximo dois por dia).
- **Os lotes precisam de** `pg_net` e de dois segredos no Vault (`dg_app_url`,
  `dg_cron_secret`); ver [deploy/producao.md](deploy/producao.md), item 10.
  Sem eles, só a rodada das 06:30 roda, e nela cabem umas 5 OABs.

## Se a captura não rodar (062)

Antes, só havia aviso quando uma rodada terminava com falha. Se nenhuma rodada
começasse (rota sem `DG_WORKER_DB_URL`, segredo errado, agendador sem os
segredos do Vault), ninguém ficava sabendo.

- **Vigia** (`private.judicial_watchdog`, a cada 15 min): em dia útil, depois das
  08:00 de Brasília, com o DJEN ligado, se existe OAB ativa sem busca concluída
  no dia, avisa os ADMIN ativos. Uma vez por dia por motivo: "nenhuma busca
  começou hoje" ou "há OAB sem conferência". Agendador sem configuração (pg_net,
  Vault ou os segredos) tem aviso próprio, também uma vez por dia.
- **Na tela:** faixa de alerta na Home (ADMIN e advogado) e no topo de DG Brasil →
  Integrações. O estado vem de `private.judicial_capture_health`
  (`get_judicial_overview.capture` e `get_judicial_capture_alert`).
- **Na rota:** sem `DG_WORKER_DB_URL` responde 500 e registra
  `judicial.cron_misconfigured` no log; segredo errado registra
  `judicial.cron_unauthorized`. Nada mais responde "skipped" em silêncio.
- "Última busca completa" vem de `last_full_run`, não das 10 últimas rodadas.

## OABs acompanhadas

- **ADMIN:** cadastra as OABs do escritório em Configurações → Integrações → Integração judicial. Vê e pode pausar as dos parceiros.
- **Administrador do parceiro:** cadastra as do próprio escritório em Minha Conta → OABs acompanhadas. Os demais usuários do parceiro só veem.
- **Parceiro:** nunca vê OAB de outro escritório.
- **A mesma OAB em dois escritórios:** o DJEN é consultado uma vez só.
- **Limite:** 50 OABs ativas por escritório.
- **Prova de diligência** (botão "Cobertura"): mostra, dia a dia, se o DJEN foi conferido com sucesso e quantas publicações havia. "Assentado" quer dizer conferido de novo a partir de D+2.

## Publicações e prazos

Cada publicação de processo cadastrado:
1. vira movimentação do processo (o parceiro do caso também vê);
2. avisa o responsável do processo, o advogado do caso e a equipe do parceiro. Sem ninguém interno, avisa os ADMIN;
3. entra na caixa **Publicações** (`/publicacoes`, só a equipe interna) como **"A tratar"**.

A triagem é humana, com uma exceção desde 13/11/2026: o **prazo direto** do
agente de prazos (abaixo). Na tela:
- **Criar prazo:** já vem a contagem em dias úteis, editável. O prazo nasce com a origem "integração judicial" e o processo, o responsável e a descrição da contagem.
- **Não há prazo:** exige o motivo.
- **Reabrir:** devolve a publicação para "A tratar".

**Contagem** (`private.judicial_deadline_dates`, Lei 11.419/2006, art. 4º, §§ 3º e 4º; CPC, art. 219):
1. A publicação é o 1º dia útil depois da disponibilização.
2. O prazo começa no dia útil seguinte e conta só dias úteis.
3. Não contam:
   - fins de semana;
   - feriados nacionais, incluindo 20/11;
   - a Sexta-feira Santa;
   - o recesso de 20/12 a 20/01 (art. 220 do CPC);
   - os dias cadastrados em **Calendário de prazos**, por tribunal ou para todos.
4. **O calendário só aceita dia que vale para o tribunal inteiro** (feriado estadual, suspensão por ato do tribunal). O dia cadastrado para um tribunal vale para todos os processos dele: um feriado municipal cadastrado ali adiaria o prazo das outras comarcas, e a data sairia **depois** da real (o lado perigoso). Por isso a tela pede só feriado e suspensão do tribunal inteiro (062); o feriado da cidade do fórum se ajusta na data, na hora de criar o prazo.
5. **Para que lado a conta erra:** dia que falta no calendário faz a data sair antes da real (lado seguro). Dia cadastrado a mais, ou no tribunal errado, faz a data sair depois. A frase antiga ("pode sair antes, nunca depois") só vale enquanto o calendário não tem dia indevido. Toda contagem feita na tela é conferida por uma pessoa.

**Agente que propõe prazos** (opcional, Configurações → Integrações):
1. Cada publicação nova vira um trabalho do agente no computador do escritório.
2. O pedido leva o teor, a data de publicação, o lado do cliente e a lista dos 30 primeiros dias úteis.
3. O agente usa a ferramenta `propor` com `CREATE_DEADLINE` (há prazo) ou `OTHER` começando com "Sem prazo:".
4. **Prazo direto** (migration 059, decisão da dona em 13/11/2026: "o agente dá o prazo e pronto"). Com a opção "Prazo entra direto na agenda" ligada (é o padrão), o prazo do agente **nasce na agenda do processo na hora, sem passar por Revisões**, a publicação fica tratada e o responsável é avisado ("Prazo criado pelo agente"). O banco só aceita direto quando:
   - o trabalho é mesmo o daquela publicação, ela não foi cancelada, ainda está com o agente e não tem prazo;
   - a data vem com hora e fuso, não passou e **é um dos dias úteis da lista que o próprio banco calculou** para a publicação;
   - é a única proposta de prazo do trabalho;
   - o processo tem responsável (ou o caso tem advogado) ativo.
   Falhou qualquer conferência: a proposta vai para Revisões, como antes, e o motivo fica no histórico do trabalho.
5. **"Sem prazo" nunca é direto**: vai para Revisões e a publicação volta para "A tratar". Um "sem prazo" errado é o erro mais caro; continua com a equipe.
6. Opção desligada (Integrações → "Prazo entra direto na agenda"): todo prazo do agente vira proposta em Revisões e só a aprovação cria o prazo.
7. A equipe também pode criar o prazo na tela da publicação; se o agente já lançou o dele, confira para não ficarem dois.
8. **"Com o agente" tem validade (062).** A publicação espera o agente por um tempo configurável (Integrações → "Tempo de espera pelo agente", padrão 4 horas corridas, de 1 a 72). A vigia devolve para "A tratar", com o motivo, e avisa o responsável do processo e os ADMIN (uma vez por publicação) quando:
   - passou o tempo de espera sem prazo nem proposta (computador do escritório desligado, por exemplo);
   - o trabalho do agente terminou sem proposta de prazo;
   - a revisão da proposta terminou sem criar prazo ("alterações solicitadas": a proposta de agente não se reabre e ficaria pendente para sempre).

   Com a proposta em Revisões e a revisão em aberto, a publicação continua "Com o agente" (está esperando uma pessoa em Revisões).
9. **O trabalho que ficou na fila não é cancelado.** Se o agente responder depois, a proposta **cai em Revisões**, nunca direto na agenda (o prazo direto só vale para publicação que ainda está com o agente). Aprovada, cria o prazo e fecha a publicação que estava "A tratar". Se a equipe já tinha tratado a publicação, a proposta chega em Revisões com o motivo "a publicação já foi tratada": rejeite, para não ficarem dois prazos.
10. **"Tratar eu mesmo"** (tela da publicação): tira a publicação do agente por decisão de uma pessoa. A tela mostra há quanto tempo ela está com o agente e avisa quando a execução está desligada ou o computador do escritório não está conectado.
11. **Teor cortado não entra direto (062).** O pedido ao agente cabe em 20 mil caracteres. Publicação maior vai com o começo e o fim do teor (o meio é marcado como cortado), o agente é avisado para ler a íntegra pelo link, e o prazo proposto vai para Revisões.

**O prazo vira tarefa** (migration 061, decisão da dona em 13/11/2026). Todo
prazo que nasce de uma proposta do agente de prazos (direto ou aprovado em
Revisões) cria sozinho uma tarefa na lista do processo, "Preparar: <título do
prazo>", com o vencimento, os dados da publicação e a análise do agente. A
tarefa vai para o orquestrador, que chama o agente da peça; a minuta chega em
Revisões como qualquer outra (aqui a regra geral vale: nada sai sem aprovação).
A tarefa nasce **aberta**, esperando uma pessoa enviar, quando:

- o caso não tem nenhum documento próprio (só material de agente não conta):
  "Anexe os autos do processo e envie a tarefa.";
- a descrição do prazo começa com "CONFERIR:" (prazo duvidoso);
- não há orquestrador em vigor, o vencimento já passou ou não há advogado
  ativo no processo.

Prazo criado à mão pela equipe não gera tarefa. Uma tarefa por prazo. Para
desligar: Integrações → "Prazo vira tarefa para os agentes". A tarefa aberta
não é reenviada sozinha quando os autos chegam: alguém clica em "Enviar aos
agentes".

Risco assumido no prazo direto: ninguém confere a conta antes de o prazo
aparecer. As proteções são a lista de dias úteis do banco (a data nunca cai em
fim de semana, feriado nacional ou recesso), a regra do agente de, na dúvida,
lançar o prazo mais curto com "CONFERIR:" na descrição, e o fato de a conta sem
feriado local sair antes da data real. Essa última proteção depende do
calendário: um dia cadastrado a mais, ou no tribunal errado, faz o prazo direto
sair depois da data real (item 5 da contagem). Publicação com o teor cortado
nunca é prazo direto.

O agente local sugerido está em [mcp/pilotos/agentes/prazos-dg.md](mcp/pilotos/agentes/prazos-dg.md).

## Ciclo de conferência em dupla (antes de o DG Brasil virar a fonte única)

O risco do sistema é o prazo (ROADMAP, "Onde o risco realmente mora"). Por um
ciclo completo, de um mês com pelo menos uma publicação por semana em cada OAB:

1. **Toda manhã, captura:** compare o que o DG Brasil capturou com uma fonte independente.
   - Em Cobertura, veja o número de publicações por dia de cada OAB.
   - Compare com o controle atual do escritório (por exemplo, o ADVBOX) no mesmo dia.
   - Diferença: anote o dia, a OAB e o número do processo, e descubra o motivo antes de seguir. Os motivos possíveis são publicação atrasada, OAB pausada ou falha da rodada.
2. **Cada prazo criado pelo DG Brasil:** confira a data com o controle atual do escritório. Data diferente: anote e corrija.
3. **No fim do ciclo:** se tudo bateu item a item, o DG Brasil vira a fonte única de publicações e prazos. **Se não bateu, adie** (não explique a diferença) e repita o ciclo.

## Arquitetura

```
Vercel Cron 06:30 ─┐            ┌─ DJEN (por OAB: janela normal + dias antigos que faltam)
pg_cron 5 min ─────┼─► /api/cron/judicial-sync ─► runJudicialSync ─┤
Buscar agora ──────┘     (CRON_SECRET)              │             └─ DataJud (por CNJ, fila)
                                                    ▼
                               private.judicial_* (login dg_worker)
                    judicial_sync_begin → judicial_ingest_djen / judicial_ingest_datajud → judicial_sync_finish
                                                    ▼
          judicial_publications · process_events · judicial_capture_days · judicial_monitor_status · notifications
                                                    ▼
          agente de prazos (opcional) → agent_runs → deadlines (prazo direto) ou Revisões → deadlines
```

- O servidor fala com o banco só pelas 5 portas da busca, com o login `dg_worker`, que não lê tabela com dado de cliente.
- As telas usam RPCs com o JWT do usuário: `get_judicial_overview`, `get_judicial_capture_alert` (062), `save_judicial_monitor`, `list_judicial_publications`, `create_deadline_from_publication` e as demais, todas públicas (invoker) chamando as privadas (definer), cada uma conferindo o papel.
- A vigia (`private.judicial_watchdog`) roda só pelo pg_cron: ninguém a chama pela API.
- As tabelas novas são fechadas ao acesso direto.
- Não há uso novo da service role.

**Fica para depois (062):** processo recém-cadastrado não relê sozinho as
publicações dos 30 dias anteriores (as que chegaram antes do cadastro foram
descartadas, por princípio). Reler as OABs inteiras a cada processo novo custaria
centenas de consultas ao DJEN; o caminho certo é uma consulta por número do
processo, filtrando pelas OABs acompanhadas, que pede uma porta nova de entrada
no banco. Enquanto isso: ao cadastrar um processo já em andamento, confira as
publicações recentes dele no DJEN.

**Sem duplicar:**
- publicação: única por (DJEN, id da comunicação);
- movimentação: única por (fonte, chave), índice da 008;
- aviso: chave de evento por usuário (037).
