# Organização pré-produção: banco de dados

Revisão do banco antes do lançamento, feita em 2026-11-12 a partir do alerta de
"Disk IO Budget" que o Supabase mandou sobre o projeto **DEV**. Responde a três
perguntas: o que é o alerta e como resolver sem pagar agora, se as migrations
precisam de arrumação, e o que dá para tirar do DEV.

A medição foi feita só com leitura: estatísticas do Postgres, métricas de
sistema do projeto e os arquivos do repositório. As medidas aplicadas depois
estão na primeira seção.

> **Atualização de 13/11/2026.** Este documento é a foto da revisão de
> 12/11/2026: onde ele conta 55 ou 57 migrations, é a contagem daquele dia.
> Depois dele entraram a 058 a 061 (aplicadas no DEV: 61 no total) e as da
> revisão final, 062 a 067 (ainda não aplicadas em nenhum Supabase). As
> **instruções** abaixo foram trocadas para "todas as migrations"; os números
> das medições ficaram como estavam. A ordem do dia da produção está no
> [checklist da virada](checklist-da-virada.md).

## Resumo

1. **Não é falta de espaço em disco.** O banco tem 131 MB e os discos têm folga.
   O alerta é de **Disk IO**: quantidade de leitura e escrita por segundo.
2. **A causa é falta de memória.** A máquina do plano gratuito tem cerca de
   0,4 GB de RAM e estava com 680 a 750 MB em swap. Quando a memória acaba, o
   sistema usa o disco como memória, e é isso que gasta o orçamento de IO. O
   disco do banco em si quase não trabalha.
3. **Dá para ganhar tempo sem pagar:** reiniciar o projeto, desligar a busca
   judicial no DEV enquanto ela não está em teste e apagar as notificações de
   lixo ([seção 2](#2-o-que-fazer-agora-sem-pagar)).
4. **As migrations estão em ordem.** As 55 aplicadas no DEV são idênticas aos 55
   arquivos do repositório. Não é preciso juntar nem reescrever nada antes de
   lançar ([seção 4](#4-migrations)).
5. **A investigação achou um defeito que iria para a produção:** a busca
   judicial avisa todos os administradores a cada rodada com falha, de 5 em 5
   minutos ([seção 6](#6-achados-que-valem-para-a-produção)).

## Situação depois das medidas (2026-11-12, noite)

Feito no DEV, com autorização do Miguel:

| Medida | Resultado |
|---|---|
| Migrations 056 e 057 aplicadas | 57 migrations no DEV; `verificar` com 893 conferências |
| Contas das rodadas automáticas apagadas (`npm run limpar:teste`) | 484 contas e 298 escritórios parceiros a menos. Ficaram 14 contas e 11 escritórios |
| Avisos de falha da busca judicial apagados | Notificações: de 143.906 para 84 |
| DJEN e DataJud desligados no DEV | O agendador responde "nada a ler". Religar em Configurações → Integrações para testar |
| Histórico do agendador limpo | 11.622 execuções antigas apagadas |

| Medida | Antes | Depois |
|---|---|---|
| Tamanho do banco | 131 MB | 52 MB |
| Administradores ativos (recebem cada aviso) | 64 | 3 |
| Carga da máquina (load) | 14 | 0,7 |
| Swap em uso | 680 a 750 MB | 521 MB |

**Falta o reinício do projeto** (seção 2, item 1), que só o dono faz pelo painel:
é ele que zera o swap que sobrou.

Contas que ficaram: `adm@dgbrasil.com`, a conta Gmail do Miguel, as seis `qa.*`,
cinco contas das rodadas de QA das etapas 7 e 8 (`qa7…` e `qa8…`) e uma conta
`qa.r2.retrynjte` sem vínculo. As seis últimas não são usadas por nenhum
roteiro atual; saem com um pedido.

A limpeza levou junto um acordo de parceria e um pagamento que a conta `adm`
tinha lançado em casos criados pelas rodadas automáticas. Os dados da validação
dos clones (cliente "DG Teste - José da Silva Fictício") e o computador
principal não foram tocados.

Não foram limpos: os 452 arquivos de teste no Storage (6 MB) e as 2.027 rodadas
antigas em `judicial_sync_runs`.

## 1. O alerta do Supabase

### O que o e-mail diz

Cada tamanho de máquina do Supabase aguenta um ritmo fixo de leitura e escrita
em disco. Acima desse ritmo, o projeto gasta um saldo de rajada ("Disk IO
Budget"). Quando o saldo acaba, o disco fica limitado ao ritmo básico: as
respostas ficam lentas e o projeto pode parar de responder por um tempo. Não há
perda de dados, e o saldo volta quando o uso cai.

### O que foi medido

Momento da medição: 2026-11-12, por volta das 22h (Brasília), com a máquina
ligada há 17,4 dias.

| Medida | Valor |
|---|---|
| Tamanho do banco | 131 MB |
| Espaço livre no disco do banco | 1,6 GB de 2 GB |
| Memória RAM da máquina | cerca de 0,4 GB |
| Swap em uso | 680 a 750 MB, de 1 GB |
| Disco do banco, no momento | 8 leituras por segundo |
| Disco do sistema (onde fica o swap), no momento | 1.800 leituras e 1.300 escritas por segundo |
| Disco do sistema, média dos 17 dias | 68 leituras e 19 escritas por segundo |
| Tempo parado esperando disco, no momento | 88% |
| Lido do disco do sistema em 17 dias | 2.280 GB |
| Falhas do agendador por "job startup timeout", últimos 3 dias | 33 |

Leitura dos números:

- O Postgres leu só 52 MB do disco do banco em 17 dias: os dados cabem inteiros
  na memória. O IO não vem de consulta pesada nem de tabela grande.
- O disco que trabalha é o do sistema, com troca de memória (swap) nos dois
  sentidos. É o comportamento de máquina sem RAM suficiente.
- As consultas de diagnóstico somaram alguma carga na hora da medição. As 33
  falhas do agendador nos dias anteriores mostram que o travamento já vinha
  acontecendo.

### O que consome a memória

A máquina gratuita roda, em 0,4 GB, o Postgres e todos os serviços do Supabase
(API, login, arquivos, pooler). Em cima disso, o DEV tem carga constante que a
produção não terá:

| Carga no DEV | Tamanho | Observação |
|---|---|---|
| Busca judicial a cada 5 minutos, dia e noite | 2.043 rodadas desde 04/11 | 1.816 terminaram "com falhas": o DataJud não responde ou recusa (429) para os processos de teste, e a fila tenta de novo no lote seguinte |
| Aviso de falha para cada administrador, a cada rodada | cerca de 91 mil notificações | O DEV tem 64 administradores de teste ativos. Essa função sozinha gerou 939 MB dos 1.265 MB de log de escrita do banco |
| Tabela de notificações | 143 mil linhas, 70 MB | Mais da metade do banco |
| Testes contra o DEV (`test:integration`, `validar:real`) | cerca de 50 usuários e 600 clientes por dia de teste | Não apagam o que criam |
| Agendamentos do banco | 1 por minuto, 1 a cada 5 min, 1 a cada 15 min | Cada execução abre uma conexão nova |

## 2. O que fazer agora, sem pagar

Na ordem. Os itens 1 a 3 resolvem a maior parte.

| # | Ação | Onde | Efeito |
|---|---|---|---|
| 1 | **Reiniciar o projeto DEV** | Painel do Supabase → Project Settings → General → Restart project | Zera o swap acumulado. O DEV fica fora do ar por 1 a 2 minutos |
| 2 | **Desligar DJEN e DataJud no DEV** enquanto a integração judicial não estiver em teste | DG Brasil → Configurações → Integrações | Para o ciclo de 5 em 5 minutos: a chamada à Vercel, as gravações no banco e as 64 notificações por rodada. Religar quando for testar |
| 3 | **Apagar as notificações de lixo** | SQL Editor do Supabase, um comando por vez (abaixo) | Tira cerca de 140 mil linhas e 65 MB, metade do banco |
| 4 | **Rodar os testes contra o DEV só quando necessário**, um conjunto por vez | — | `test:integration` e `validar:real` são os picos de carga. O `verificar` roda local e não toca no DEV |
| 5 | Fechar abas do DG Brasil que não estão em uso | — | Algumas telas consultam o banco a cada 20 segundos |

Comandos do item 3, depois do reinício:

```sql
delete from public.notifications
 where type in ('JUDICIAL_SYNC_FAILED', 'CASE_SUBMITTED');

vacuum (full, analyze) public.notifications;
```

As duas categorias são avisos gerados por teste. O `vacuum full` devolve o
espaço e trava a tabela por alguns segundos.

**O que não adianta:** contratar mais disco, apagar migrations ou juntar
migrations. Nada disso mexe na memória.

**Se o saldo zerar antes das medidas:** o DEV fica lento ou sem resposta por um
tempo, e o site publicado sente, porque hoje ele usa o DEV. Nenhum dado se
perde.

## 3. O que muda ao contratar

- **Produção é um projeto novo no plano Pro**, como já está em
  [producao.md](producao.md), item 3. O Pro inclui a máquina **Micro**, com 1 GB
  de RAM: o dobro da atual.
- **Recomendação:** avaliar a máquina **Small** (2 GB) para a produção. O
  esquema do DG Brasil é grande (99 tabelas, 435 funções) e a Micro deixa pouca
  folga. Pela tabela que eu conheço, a diferença fica em torno de US$ 5 por mês
  depois do crédito do plano. **Conferir o preço no painel na hora de
  contratar.**
- **Acompanhar memória e swap** nas primeiras semanas (painel → Reports →
  Database). Swap crescendo de forma contínua é o sinal para subir a máquina.
- **O DEV continua gratuito** e com a mesma limitação. Com as medidas da seção 2
  ele aguenta. Passar o DEV para a organização paga custa uma máquina a mais por
  mês e só vale se ele continuar travando.

## 4. Migrations

### Estado

- 55 arquivos, 1,1 MB de SQL, de `20261005000001` a `20261112000055`.
- **As 55 estão aplicadas no DEV, e o conteúdo aplicado é igual ao dos
  arquivos.** A conferência comparou cada comando gravado pelo Supabase com o
  arquivo local: nenhuma divergência.
- O `verificar` roda as 55 do zero a cada execução (870 conferências em
  2026-11-12), no computador e no GitHub Actions.

### Migrations que foram editadas depois de criadas

O histórico do Git mostra 22 arquivos com mais de um commit:

| Arquivos | Quando | Situação |
|---|---|---|
| 001 a 019 | Até 2026-10-09 | Editadas antes do primeiro envio ao Supabase real, como a regra do [README do banco](../../supabase/README.md) previa |
| 033 e 037 | 2026-10-15 | Editadas no dia em que foram criadas |
| 043 | 2026-11-04 | Idem |
| 047 | 2026-11-09 | Idem |

Como o DEV bate com os arquivos, nenhuma dessas edições deixou o banco diferente
do repositório.

### Recomendação: não juntar as migrations antes de lançar

- A quantidade de migrations não pesa no banco em uso. Elas rodam uma vez, na
  criação.
- A sequência atual é a que os testes cobrem. Um arquivo único novo seria SQL
  sem teste, escrito na véspera do lançamento.
- A produção ainda não existe: ela vai receber todas em ordem, no mesmo caminho
  que o `verificar` exercita todo dia.

### Ensaio que falta

Do zero, as migrations só rodaram no simulador local (PGlite). No Supabase real
elas entraram aos poucos, ao longo de cinco semanas. Antes de criar a produção,
vale **aplicar todas num projeto vazio** (o plano gratuito permite um segundo
projeto) e apagar o projeto depois. É a única forma de ver o caminho da produção
antes do dia.

Ponto conhecido desse caminho: a migration 037 agenda `dg-deadline-reminders` se
o `pg_cron` já estiver ligado, e a 040 agenda `dg-lembretes-de-prazo` para a
mesma função sem remover o anterior. No DEV existe só o segundo. Num projeto
novo podem ficar os dois ([seção 7](#7-conferência-do-banco-no-dia-da-produção)).

## 5. Dados de teste no DEV

### Inventário

| O quê | Quantidade | Origem |
|---|---|---|
| Usuários | 498, sendo 496 `@dgbrasil.test` | Testes de integração (prefixo `i…`) e `validar:real` (prefixo `r…`). Os outros 2 são contas reais |
| Escritórios parceiros | 308 | "Parceiro Int…", "Parceiro Auditoria…" |
| Vínculos ativos na organização principal | 64 administradores, 85 advogados, 82 assistentes | Cada evento avisa os 64 administradores |
| Clientes | 2.520, sendo 604 dos últimos 7 dias | Testes |
| Casos | 2.139 | Testes |
| Notificações | 143 mil | Seção 1 |
| Eventos de auditoria | 31 mil, 13 MB | Testes |
| Arquivos | 452 objetos, 6 MB | Testes |
| Esquema `pgmq_orfao_20261009212804` | 2 tabelas vazias | Sobra do primeiro envio, em 2026-10-09 |

### Precisa de tudo isso?

Não. Cada rodada de teste cria usuários e escritórios com um prefixo novo e não
reaproveita os antigos. O que os testes e o QA usam de fato:

- os usuários fixos do `usuarios-qa` (LAWYER, ASSISTANT, Parceiro QA A e B);
- as duas contas reais;
- os dados da rodada de QA em andamento (ponte, clones).

### Como limpar

| Opção | O que faz | Quando |
|---|---|---|
| **A. Apagar as notificações de lixo** | Seção 2, item 3 | Agora. Sem risco |
| **B. Script de limpeza das contas de teste** | `npm run limpar:teste` (em `supabase/`): remove as contas das rodadas automáticas, os escritórios delas e o que criaram, preservando as contas reais e as de QA. Sem `-- --executar`, só simula | Escrito em 2026-11-12 e ensaiado no simulador local. Decisão do Miguel: usar este |
| **C. Recriar o DEV do zero** | `supabase db reset --linked`: apaga tudo e reaplica todas as migrations | Depois de fechar o QA em andamento. Exige refazer a senha do `dg_worker`, os segredos do cofre, a administradora e os usuários de QA |

Decisão (2026-11-12): **A e B**, depois que a validação em andamento terminar.
A opção C continua valendo como ensaio da seção 4, quando o QA da ponte acabar.

Para o lixo não voltar: os testes deveriam apagar o que criam ao terminar. Fica
como melhoria para depois do lançamento.

## 6. Achados que valem para a produção

| # | Achado | Por que importa | Proposta |
|---|---|---|---|
| 1 | **Aviso de falha da busca judicial a cada rodada.** `private.judicial_sync_finish` notifica todos os administradores sempre que a rodada termina PARTIAL ou FAILED. A chave do aviso leva o número da rodada, então nunca é tratado como repetido | Com o DataJud instável, cada administradora recebe um aviso a cada 5 minutos, sem parar | **Migration 057:** no máximo dois avisos por dia por pessoa, o da primeira falha da manhã e o da primeira da tarde (decisão do Miguel) |
| 2 | **Processo que falha no DataJud volta para a fila no lote seguinte.** Nas rodadas observadas, os mesmos processos falham de 5 em 5 minutos | Chamadas à Vercel e ao DataJud sem fim, e mais recusas 429. Conclusão tirada dos números das rodadas, não da leitura completa do código | Espera crescente por processo depois de falha. Confirmar no código antes |
| 3 | **Histórico do agendador sem limpeza.** `cron.job_run_details` ganha cerca de 1.700 linhas por dia e nunca é esvaziada | Uns 600 mil registros por ano, sem uso | **Migration 057:** `dg-limpeza-do-agendador`, uma vez por dia, apaga o que tem mais de 7 dias |
| 4 | **Dois agendamentos para os lembretes de prazo** num projeto novo (037 e 040) | A mesma função rodaria em duplicidade | **Migration 057:** remove `dg-deadline-reminders` se existir |
| 5 | **Tabelas sem retenção:** `notifications`, `judicial_sync_runs` (uma linha por rodada) e o arquivo da fila `agent_execution` | Crescem para sempre. Lento, mas contínuo | Definir prazo de guarda para cada uma. `audit_events` fica fora: é registro legal. **Segue aberto:** decisão da dona do escritório ([producao.md](producao.md), item 18) |
| 6 | **README do banco desatualizado:** fala em "19 migrations ainda não aplicadas em nenhum Supabase real" | Quem ler vai achar que ainda pode editar migration antiga | Corrigir o texto: são 55, e nenhuma aplicada pode ser reescrita |

Os itens 1, 3 e 4 estão na migration 057
(`20261112000057_judicial_notice_cap_and_cron_history.sql`), com 6 conferências
novas no `verificar`. O item 6 foi corrigido. Os itens 2 e 5
seguem abertos.

### Observado, sem ação agora

- **Tabelas da família "skills" sem gravação desde 26/10** (`skills`,
  `skill_versions`, `skill_version_files`, `skill_provider_versions` e as
  tabelas de vínculo). Parecem herança da fase em que os agentes rodavam pela
  API. Vazias, não custam nada. Decidir depois do lançamento se saem.
- **67 de 280 índices nunca usados no DEV** (1,6 MB). Não remover: o uso do DEV
  não representa o uso real.
- **26 mensagens paradas na fila `agent_execution`.** Conferir se são de
  execuções de teste abandonadas.

## 7. Conferência do banco no dia da produção

Complementa o item 3 de [producao.md](producao.md).

1. Ensaio de todas as migrations em projeto vazio feito, sem erro (seção 4).
2. Extensões ligadas antes ou durante o `db push`: `pgmq`, `pg_cron`, `pg_net`.
3. Depois do `db push`, conferir os agendamentos:

   ```sql
   select jobname, schedule from cron.job order by jobname;
   ```

   Esperado: `dg-expurgo-de-pedidos` e `dg-vigia-da-plataforma` (065),
   `dg-importacoes`, `dg-judicial`, `dg-lembretes-de-prazo`,
   `dg-limpeza-do-agendador` e `dg-manutencao`, mais os que as outras
   migrations da revisão final criarem. A 057 remove
   `dg-deadline-reminders`; se ele ainda aparecer:
   `select cron.unschedule('dg-deadline-reminders');`
4. Segredos do cofre (`dg_app_url`, `dg_cron_secret`) criados com os valores de
   produção, e `select private.judicial_cron_kick();` respondendo como em
   [producao.md](producao.md), item 10.
5. Senha do `dg_worker` criada e primeira administradora criada.
6. Nenhum usuário `@dgbrasil.test` e nenhum escritório de teste:

   ```sql
   select count(*) from auth.users where email like '%@dgbrasil.test';
   select count(*) from public.organizations where type = 'PARTNER';
   ```

7. Correção do aviso judicial (seção 6, item 1) aplicada antes de ligar DJEN e
   DataJud.
8. Tamanho da máquina escolhido (seção 3) e gráfico de memória conferido na
   primeira semana.

## 8. O que esta revisão não cobriu

- Leitura linha a linha das 55 migrations em busca de função ou tabela
  substituída por outra mais nova. Foi feita a conferência de integridade (DEV
  igual ao repositório) e a busca por sobras visíveis no uso do banco.
- Quanto de memória cada serviço do Supabase ocupa. O painel não mostra por
  serviço; a conclusão vem do total de RAM, swap e IO.
- O gráfico de consumo do saldo de IO por hora. Ele fica no painel (Reports →
  Database) e vale olhar para ver em que horários o saldo cai.
- Segurança, RLS e desempenho de consultas com volume real. São outra revisão.

## Como repetir as medições

- **Métricas de sistema:** `GET <SUPABASE_URL>/customer/v1/privileged/metrics`,
  com autenticação básica `service_role:<chave service role>`. Olhar
  `node_memory_Swap*`, `node_vmstat_pswpin`, `node_vmstat_pswpout` e
  `node_disk_*`. O disco `nvme0n1` é o do sistema; `nvme1n1` é o do banco.
- **Postgres:** `pg_stat_database`, `pg_stat_statements` (ordenar por
  `wal_bytes` mostra quem mais grava), `pg_stat_user_tables` e
  `cron.job_run_details`.
- **Migrations:** comparar `supabase_migrations.schema_migrations.statements`
  com os arquivos de `supabase/migrations/`.
