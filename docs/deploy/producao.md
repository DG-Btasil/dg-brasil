# Produção: o que mudar quando o DG Brasil entrar em uso

Enquanto o DG Brasil está em teste e desenvolvimento, algumas coisas ficaram de
fora **de propósito**:
- planos pagos;
- automações que o plano gratuito não comporta;
- configurações que só fazem sentido com o sistema no ar e com dados reais.

Esta lista junta tudo isso, com o que fazer e onde mexer.

> **No dia de pôr em uso, siga o [checklist da virada](checklist-da-virada.md):**
> ele põe os passos desta lista (e os dos outros documentos) na ordem certa.

> **Lançamento (decisão de 10/11/2026):** o DG Brasil é lançado **completo**, não
> como beta: valem todos os itens desta lista, inclusive o Google Drive (2), a
> consulta de CPF na Receita (12) e os agentes do escritório pela ponte (14),
> estes dois últimos depois das validações que faltam. Ficam para depois só o
> item 13 (validação de formato, prioridade baixa) e o que está em
> [pos-mvp.md](pos-mvp.md) (domínio consignado e outros).

Os preços foram conferidos nas páginas oficiais em 2026-10-29. Confira de novo na
hora de contratar.

## Resumo

| # | O quê | Por que não agora | Custo |
|---|---|---|---|
| 1 | Vercel Pro | O plano gratuito (Hobby) é só para uso pessoal, não comercial | US$ 20 por mês por pessoa que publica |
| 2 | Google Drive a cada 15 minutos (**no lançamento, depois da validação do Drive**) | O Hobby só aceita agendamento uma vez por dia | Já vem com o Vercel Pro |
| 3 | Supabase de produção, no plano Pro | O gratuito pausa sem uso e não tem backup | A partir de US$ 25 por mês |
| 4 | Segurança do login | Recursos do Supabase Pro | Já vem com o Supabase Pro |
| 5 | E-mail de suporte e envio de e-mails | O envio que recebe e manda é pago | Plano pago do Zoho Mail |
| 6 | Domínios `app.` e `portal.dgbrasil.adv.br` (já no ar) | Falta só ligar ao Supabase de produção | Já pago |
| 7 | Claude com dados de clientes | Hoje só há dados fictícios | Plano Team ou Enterprise |
| 8 | Variáveis e chaves de produção | Hoje tudo aponta para o DEV | Sem custo |
| 9 | Conferências antes do primeiro dado real | Exigência para dado real | Sem custo |
| 10 | Integração judicial: mais buscas por dia | Hobby: 1 rodada por dia pela Vercel (os lotes saem do agendador do banco) | Já vem com o Vercel Pro |
| 11 | ~~Conferir as publicações com o APOGEU~~ | Removido em 2026-11-09: o APOGEU não será usado | — |
| 12 | Consulta de CPF na Receita (Serpro) (**no lançamento, só na produção**) | Paga por consulta; contrato do escritório | ~R$ 0,66 por consulta na 1ª faixa (tabela de 2024; conferir) |
| 13 | Validação de formato dos documentos (RG, CNH, OAB, dígitos) (**depois do lançamento, prioridade baixa**) | Pedido para a atualização final | Sem custo |
| 14 | Agentes do DG Brasil pela ponte ([ponte.md](../ponte.md)): os clones `-dg` da esteira bancária ([agentes/clonagem](../agentes/clonagem/README.md)) (**no lançamento**) | Ponte validada no DEV (Frente B); clones prontos, falta validar | Sem custo |
| 15 | Cópia de segurança dos documentos (os arquivos do Storage) | Falta decidir o destino e quem roda | Depende do destino escolhido |
| 16 | Monitoramento: monitor externo e destino dos erros | São contas de terceiros, a escolher | Há opções gratuitas; conferir |
| 17 | Procedimento para pedido de titular de dados | Falta definir quem atende | Sem custo |
| 18 | Prazos de guarda dos registros que hoje não têm limpeza | Decisão da dona do escritório | Sem custo |

---

## 1. Vercel Pro

- **Hoje:** plano Hobby, gratuito. A própria Vercel diz: "Our Hobby plan is for
  personal, non-commercial use". O DG Brasil em produção é uso comercial do
  escritório.
- **Na produção:** assinar o **Pro**.
  - US$ 20 por mês por pessoa que publica.
  - Quem só olha o painel da Vercel não paga.
- **O que mais libera:** agendamentos de até uma vez por minuto, com hora exata.
  Ver o item 2.

## 2. Google Drive: sincronizar a cada 15 minutos

- **Hoje:**
  - `apps/frontend/vercel.json` agenda a rodada do Drive **uma vez por dia**, por
    volta das 6h de Brasília (`0 9 * * *`, em UTC).
  - Cada rodada envia até 5 documentos aprovados e confere até 5 pastas de
    cliente. O resto espera a rodada seguinte, ou alguém usa **Sincronizar
    agora** na ficha do cliente.
- **Por quê:** em 2026-10-29, o deploy foi recusado com o erro "Hobby accounts are
  limited to daily cron jobs". A rodada a cada 15 minutos virou diária só para o
  deploy passar. A rota, a proteção e o botão continuam iguais.
- **Na produção, com o Vercel Pro (item 1):**
  1. Em `apps/frontend/vercel.json`, trocar `"0 9 * * *"` por `"*/15 * * * *"`.
  2. Atualizar os textos que falam em "uma vez por dia":
     - o comentário de `apps/frontend/src/app/api/cron/drive-sync/route.ts`;
     - a seção 4 de [docs/mcp/google-drive.md](../mcp/google-drive.md);
     - a linha da rota agendada em [docs/mcp/relatorio-final.md](../mcp/relatorio-final.md).
  3. Conferir que o `CRON_SECRET` está nas variáveis de produção (item 8).
- **Se decidir não assinar o Vercel Pro:** o agendador do próprio Supabase
  (`pg_cron`, que já roda a manutenção do DG Brasil) pode chamar a rota a cada 15
  minutos.
  - Isso exige uma migration nova e guardar o `CRON_SECRET` no cofre do Supabase.
  - Pedir ao Claude quando chegar a hora.
- **Como conferir:**
  - na Vercel, em **Settings → Cron Jobs**, aparece `*/15 * * * *`;
  - no DG Brasil, em **DG Brasil → Integrações → Google Drive**, a última
    sincronização é recente.

## 3. Supabase de produção (projeto novo, no plano Pro)

- **Hoje:** só existe o projeto **DEV**, em São Paulo, no plano gratuito e com
  dados fictícios. O plano gratuito:
  - pausa o projeto depois de 1 semana sem uso;
  - não tem backup automático.
- **Na produção:**
  1. **Criar um projeto novo de produção**, também em São Paulo. Nunca
     reaproveitar o DEV: ele tem dados de teste e usuários de QA.
  2. **Plano Pro:**
     - a partir de US$ 25 por mês, com backup diário guardado por 7 dias;
     - voltar o banco a qualquer momento (PITR) é um adicional de US$ 100 por mês
       para 7 dias. Avaliar se vale para dado jurídico.
  3. **Aplicar todas as migrations** (`npx supabase db push`, com a CLI ligada ao
     projeto de produção). Se o `pg_cron` não ligar sozinho, ligar em **Database →
     Extensions**.
  4. **Criar a senha do login `dg_worker`**, como foi feito no DEV
     ([supabase/README.md](../../supabase/README.md)).
  5. **Configurar o Auth** como em [docs/auth.md](../auth.md), seção da configuração
     no projeto remoto: cadastro aberto desligado, MFA, política de senha,
     endereços e modelos de e-mail.
  6. **Criar a primeira administradora** ([supabase/README.md](../../supabase/README.md)).
- **Os scripts de teste não servem para a produção:** `validar:real`,
  `usuarios-qa`, `limpar:teste` e os testes de integração têm duas travas:
  recusam rodar fora de `DG_ENV=development` e recusam se algum endereço não
  for do projeto declarado em `DG_DEV_PROJECT_REF` (o identificador do projeto
  de desenvolvimento; [supabase/README.md](../../supabase/README.md)). Nunca
  ponha o identificador da produção nessa variável. Conferir a produção vai
  precisar de um roteiro próprio, sem dados fictícios. Pedir ao Claude quando
  chegar a hora.
- **Conexão do servidor com o banco:** no DEV, o `DG_WORKER_DB_URL` usa o pooler
  na porta 5432, que foi o testado. Na produção, avaliar a porta 6543 (pooler de
  transação), que é a recomendada para a Vercel, testando antes.

## 4. Segurança do login (recursos do Supabase Pro)

Ligar no projeto de produção, depois de assinar o Pro (item 3):

- **Proteção contra senha vazada:** recusa senhas que já apareceram em
  vazamentos. Está marcada como adiada em
  [supabase/README.md](../../supabase/README.md) (Supabase Advisors).
- **Tempo máximo de sessão e tempo de inatividade** (*Session timeouts*):
  - limitam quanto tempo vale o "Lembrar de mim";
  - ficam em `[auth.sessions]` no `supabase/config.toml` ou no painel;
  - ver [docs/auth.md](../auth.md) e
    [docs/etapa-4.3.2-relatorio.md](../etapa-4.3.2-relatorio.md).

## 5. E-mail de suporte e envio de e-mails do sistema

- **Hoje:**
  - Os e-mails do sistema (convite e redefinição de senha) saem pelo envio padrão
    do Supabase. Ele só entrega para os e-mails da equipe do projeto e tem limite
    baixo ([docs/auth.md](../auth.md), item 6).
  - O e-mail de suporte está vazio (`supportEmail` em
    `supabase/templates/email.config.json`), então os e-mails não mostram a quem
    pedir ajuda.
- **Por que não agora:** o Zoho Mail que recebe e envia é pago. O plano gratuito
  aceita o domínio próprio, mas não tem IMAP/POP, ou seja, não conecta a outros
  programas.
- **Na produção:**
  1. **Contratar o Zoho Mail** num plano pago (Mail Lite ou Mail Premium,
     cobrados por pessoa e por ano; a página anuncia "a partir de R$ 5").
     Confirmar na contratação que o plano permite **SMTP**: é o que deixa o
     Supabase mandar e-mail pela conta do escritório.
  2. **Criar o endereço de suporte** no domínio do escritório.
  3. **Configurar o DNS do domínio** com os registros que o Zoho mostrar (MX, SPF e
     DKIM). Sem eles, os e-mails caem no spam.
  4. **Ligar o envio no Supabase de produção:** em **Authentication → SMTP
     Settings**, preencher servidor, porta, usuário e senha de aplicativo do Zoho e
     o remetente.
  5. **Pôr o endereço nos e-mails do sistema:**
     - preencher `supportEmail` em `supabase/templates/email.config.json`;
     - rodar `npm run emails` na pasta `supabase`;
     - colar os modelos no painel ([docs/auth.md](../auth.md), "E-mails do Auth").
  6. **Testar:** convidar uma conta de teste e pedir redefinição de senha. Os dois
     e-mails devem chegar, fora do spam, com a seção de suporte.

## 6. Domínios (já no ar)

- **Hoje, já funcionando na Vercel:**
  - **`app.dgbrasil.adv.br`**, para a equipe;
  - **`portal.dgbrasil.adv.br`**, para os parceiros;
  - `dgbrasil.adv.br` e `www.dgbrasil.adv.br` redirecionam para o `app.`;
  - o site está ligado ao Supabase **DEV**.
- **No código:** desde 13/11/2026 o padrão é `app.dgbrasil.adv.br` e
  `portal.dgbrasil.adv.br` (`apps/frontend/src/lib/hosts.ts`). As variáveis
  `NEXT_PUBLIC_APP_HOST` e `NEXT_PUBLIC_PORTAL_HOST` só são necessárias se os
  domínios mudarem.
- **Na produção, os domínios ficam os mesmos.** Falta:
  1. **Supabase de produção (item 3):** em **Authentication → URL Configuration**,
     preencher:
     - Site URL: `https://app.dgbrasil.adv.br`;
     - Redirect URLs: `https://app.dgbrasil.adv.br/auth/confirm**` e
       `https://portal.dgbrasil.adv.br/auth/confirm**`
       ([docs/auth.md](../auth.md), item 4).

     Só esses dois: sem `localhost` e sem curinga no nome do site. Sem isso, o
     link do e-mail de convite quebra.
  2. **Computador do escritório:** o `url` do `executor.json` é
     `https://app.dgbrasil.adv.br`, sempre com o `app.` (item 8). O domínio sem
     `app.` redireciona, e o token do computador não vai junto no
     redirecionamento.

## 7. Claude com dados de clientes

- **Hoje:** o computador do escritório usa a assinatura do Claude, e o DG Brasil
  só tem dados fictícios.
- **Antes do primeiro caso real:**
  - em claude.ai → **Configurações → Privacidade**, conferir que o uso das
    conversas para treinamento está **desligado**;
  - para dados de clientes, o mais adequado é o plano **Team ou Enterprise**
    (termos comerciais). Conferir o preço na página da Anthropic;
  - fazer a revisão LGPD do provedor de IA.
- Ver o risco R3 em [docs/mcp/relatorio-final.md](../mcp/relatorio-final.md).

## 8. Variáveis e chaves de produção

Na Vercel, em **Settings → Environment Variables**, ambiente *Production*. Tudo
apontando para o projeto Supabase **de produção**, nunca para o DEV.

Na subida, o servidor confere esta lista e registra no log uma linha `env.check`
para cada problema, com o nome da variável (`src/server/core/env-check.ts`).
Erro não derruba o site: aparece nos logs da Vercel e, se o aviso de erros
estiver ligado (item 16), chega por lá.

**Obrigatórias** (sem elas o sistema não funciona):

| Variável | O quê |
|---|---|
| `DG_ENV` | `production`, e só neste ambiente. Libera as chaves pagas do Serpro (item 12) e desliga a demonstração dele. No site de teste: `development` |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Do projeto de produção |
| `SUPABASE_SERVICE_ROLE_KEY` | Do projeto de produção. Só no servidor |
| `DG_WORKER_DB_URL` | Login `dg_worker` do projeto de produção, pelo pooler (item 3). Nunca `postgres` |
| `CRON_SECRET` | Um texto aleatório **novo** (16 caracteres ou mais), diferente do usado em teste. O mesmo valor vai no cofre do Supabase (item 10) |

**Opcionais** (cada uma liga uma parte):

| Variável | O quê |
|---|---|
| `NEXT_PUBLIC_APP_HOST`, `NEXT_PUBLIC_PORTAL_HOST` | Os domínios (item 6). O padrão do código já é `app.dgbrasil.adv.br` e `portal.dgbrasil.adv.br`; só preencher se mudarem. Sem `https://` |
| `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN` | Google Drive pela conta do escritório: as três juntas ([docs/mcp/google-drive.md](../mcp/google-drive.md)) |
| `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` | Alternativa às três acima (conta de serviço) |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | A pasta que contém as pastas dos clientes. Com o Drive ligado, é necessária: sem ela, só a administradora liga pasta |
| `SERPRO_CPF_CONSUMER_KEY`, `SERPRO_CPF_CONSUMER_SECRET`, `NEXT_PUBLIC_CPF_LOOKUP=1` | Consulta de CPF na Receita: as três juntas (item 12) |
| `SERPRO_CPF_BASE_URL` | Só se o Serpro indicar outro endereço |
| `DATAJUD_API_KEY` | Só se o CNJ trocar a chave pública do DataJud (item 10) |
| `ERROR_WEBHOOK_URL` | Para onde vão os erros do servidor (item 16). Recomendada |
| `PARTNER_TAX_ID_LIMIT_PER_USER`, `PARTNER_TAX_ID_LIMIT_PER_ORGANIZATION` | Limite de consultas de CPF/CNPJ por parceiro, por minuto. Padrão: 10 e 30 |

**Devem estar AUSENTES em produção:**

| Variável | Por quê |
|---|---|
| `SERPRO_CPF_TRIAL`, `SERPRO_CPF_TRIAL_TOKEN` | Demonstração do Serpro, com dados fictícios. O código já ignora as duas quando `DG_ENV=production`, mas não devem existir |
| `NEXT_PUBLIC_DEMO_MODE` | Não é mais lida (o protótipo de demonstração foi removido em 13/11/2026); pode ser apagada |
| `AUTH_FALLBACK_SITE_URL` | Só serve para endereço de prévia |

**Computador do escritório:**
1. No site de produção, em **Configurações → Computador do escritório**, gerar um
   token novo.
2. Revogar o token de teste.
3. No computador, rodar o instalador de novo e, quando ele perguntar se mantém
   ou troca o token guardado, escolher **trocar** e colar o token novo
   ([docs/mcp/instalacao.md](../mcp/instalacao.md)). O endereço é o mesmo do
   teste; por isso o instalador pergunta em vez de reaproveitar em silêncio.

## 9. Conferências antes do primeiro dado real

Não custam nada, mas precisam estar feitas antes de entrar o primeiro cliente de
verdade:

- **Textos jurídicos definitivos** dos termos de uso e da política de privacidade.
  Hoje são provisórios.
- **Revisão LGPD:** provedor de IA (item 7) e Google Drive.
- **Agendamentos atuais do computador do escritório**, que rodam com
  `--dangerously-skip-permissions`: decidir o que fazer (risco R1 em
  [docs/mcp/relatorio-final.md](../mcp/relatorio-final.md)).
- **Pendências de robustez** listadas em [docs/backend.md](../backend.md), seção
  "Hardening pendente por domínio". Exemplo: o ciclo de vida do acordo financeiro
  e o limite de consultas de CPF/CNPJ, que hoje vale por instância do servidor.
- **Prazos em dupla:** enquanto os prazos também forem controlados fora do DG
  Brasil, conferir item a item por um ciclo completo antes de o DG Brasil virar a
  fonte única ([ROADMAP.md](../../ROADMAP.md), "Onde o risco realmente mora").

## 10. Integração judicial (DJEN e DataJud): frequência

- **Hoje:**
  - o pg_cron do Supabase (`dg-judicial`, a cada 5 min, migration 043) chama a
    rota `/api/cron/judicial-sync` em lotes:
    - a partir das 05:00 de Brasília, enquanto houver OAB não conferida no dia,
      busca as publicações do DJEN dessas OABs (revendo os últimos 5 dias);
    - depois, só os andamentos do DataJud (cada processo uma vez a cada 20 h);
    - sem nada pendente, nem chama a rota;
  - cada lote pode rodar até 5 minutos e trabalha 4 (`maxDuration = 300` e
    `WORK_MS` em `apps/frontend/src/app/api/cron/judicial-sync/route.ts`, desde
    13/11/2026); o DJEN aceita 20 consultas por minuto;
  - a Vercel Cron às 06:30 (`30 9 * * *` em `apps/frontend/vercel.json`) fica
    como reserva.
- **Obrigatório para os lotes** (DEV e produção), no projeto Supabase. Sem isto,
  só a rodada das 06:30 roda, e nela cabem umas 5 OABs por dia:
  1. **Database → Extensions:** ligar `pg_net`.
  2. **SQL Editor**, com o mesmo `CRON_SECRET` da Vercel daquele ambiente:

     ```sql
     select vault.create_secret('https://app.dgbrasil.adv.br', 'dg_app_url');
     select vault.create_secret('<CRON_SECRET>', 'dg_cron_secret');
     select private.judicial_cron_kick();   -- 'chamado: publicações', 'chamado: andamentos' ou 'nada a ler'
     ```

  Para trocar um segredo depois: `select vault.update_secret(id, '<novo>') from
  vault.secrets where name = 'dg_cron_secret';`.
- **Na produção, com o Vercel Pro (item 1):**
  1. Mais conferências de publicações por dia, se o escritório quiser: trocar a
     regra "uma vez com sucesso por dia" de `private.judicial_djen_due()` (por
     exemplo, também à tarde).
  2. O tempo da rota já foi aumentado (300 s, 240 s de trabalho): **nada a
     mudar no código**. Só conferir, no painel da Vercel, que a função
     `/api/cron/judicial-sync` não está limitada a menos de 300 s.
  3. Se mudar a frequência (passo 1), atualizar os textos em `route.ts`, em
     [docs/judicial.md](../judicial.md) e nas telas (DG Brasil → Integrações).
- **Chave do DataJud:** é a pública da wiki do CNJ e pode mudar. Se a tela
  mostrar "DataJud recusou a chave pública", pôr a nova em `DATAJUD_API_KEY`
  na Vercel.

---

## 11. (Removido) Conferência das publicações com o APOGEU

Removido em 2026-11-09, por decisão da Barbara: o APOGEU não será usado. O
número fica reservado para não mudar as referências aos itens 12 e 13. A
conferência das publicações antes de o DG Brasil virar a fonte única continua no
ciclo de conferência em dupla ([docs/judicial.md](../judicial.md)), comparando com
o controle atual do escritório.

---

## Como acrescentar um item

Sempre que algo for deixado para a produção (plano pago, automação, configuração),
acrescente:
1. uma linha no **Resumo**;
2. uma seção com:
   - **Hoje:** como está e onde fica no código;
   - **Por que não agora;**
   - **Na produção:** os passos;
   - **Como conferir.**

---

## 12. Consulta de CPF na Receita (Serpro) — no lançamento

- **Decisão de Barbara (10/11/2026):** entra no lançamento, e **só na produção**
  (nos testes nada é cobrado).
- **Como funciona (Consulta CPF v3 do Serpro):** a Receita confere o **CPF junto
  com a data de nascimento**. Quando os dois estão preenchidos no cadastro
  (equipe e portal dos parceiros), o DG Brasil consulta e preenche o **nome
  completo** e o **nome social**, se houver. A pessoa sempre confere e pode
  corrigir.
  - Só com o CPF, o campo pede: "Informe a data de nascimento para buscar o nome
    na Receita Federal."
  - Nascimento que não confere com o da Receita: "A data de nascimento não confere
    com a da Receita. Confira o CPF e a data."
  - A versão antiga (v1, só o CPF) foi desativada pelo Serpro em 02/10/2026; o
    código usa a v3 desde 10/11/2026.
- **O que a Receita devolve:** nome, nome social, nascimento e situação cadastral.
  Endereço vem do CEP (gratuito); profissão, estado civil e contatos continuam à
  mão.
- **Quanto custa:** pós-pago, por consulta, mais barato quanto maior o volume. A
  tabela que a Loja Serpro publicou (junho de 2024) começa em cerca de
  **R$ 0,66 por consulta** na faixa de 1.000 a 9.999 consultas no mês e cai até
  cerca de R$ 0,02 em volumes muito grandes. **Conferir a tabela atual** na
  [página da Consulta CPF](https://www.loja.serpro.gov.br/consultacpf) antes de
  contratar. São cobradas as respostas "encontrado" (200), "parcial" (206) e
  "não encontrado" (404); erros (400, 401, 403, 500, 504) não. Exemplo: 300
  clientes novos por mês ≈ R$ 200, pela tabela de 2024.
- **Para não pagar à toa (já no código):**
  - CPF com dígito verificador errado **não** vai à Receita: o campo avisa
    "CPF com dígito verificador errado. Confira o número.";
  - o mesmo CPF e nascimento de novo em 10 minutos não pagam outra consulta
    (vale também para "não encontrado" e "nascimento não confere");
  - limite de 15 consultas por minuto por pessoa;
  - **as chaves pagas só funcionam com `DG_ENV=production`**: no DEV, mesmo que
    alguém ponha as chaves, nenhuma consulta é feita;
  - situação diferente de "Regular" (suspensa, cancelada, titular falecido)
    aparece como aviso embaixo do campo;
  - a chave do Serpro fica só no servidor; o CPF consultado não vai para log nem
    para o banco (só o que for salvo no cadastro).
- **Para ligar:**
  1. contratar a **Consulta CPF** na [Loja Serpro](https://www.loja.serpro.gov.br/consultacpf)
     (precisa do certificado digital e-CNPJ do escritório; contratação online,
     sem taxa de instalação);
  2. pegar a Consumer Key e a Consumer Secret na
     [Área do Cliente](https://cliente.serpro.gov.br);
  3. na Vercel, **só no ambiente de produção**:
     - `DG_ENV=production`;
     - `SERPRO_CPF_CONSUMER_KEY` e `SERPRO_CPF_CONSUMER_SECRET`;
     - `NEXT_PUBLIC_CPF_LOOKUP=1` (sem ela, a tela não chama a Receita);
  4. novo deploy (as variáveis `NEXT_PUBLIC_` entram no build).
- **Testar sem pagar (DEV), opcional:** a demonstração do Serpro usa dados
  fictícios. Pôr `SERPRO_CPF_TRIAL=1`, `SERPRO_CPF_TRIAL_TOKEN` (o token da
  página de demonstração da
  [documentação](https://apicenter.estaleiro.serpro.gov.br/documentacao/consulta-cpf/pt/quick_start/))
  e `NEXT_PUBLIC_CPF_LOOKUP=1`. CPFs de teste: 404.428.201-35 com 14/11/1970
  (regular), 405.321.768-71 com 22/03/1982 (suspensa), 051.375.187-43 com
  05/07/1965 (titular falecido). **Nunca** testar no endereço de produção: lá
  toda chamada é cobrada.
- **Como conferir (na produção, com um cliente real):** novo cliente PF → CPF e
  data de nascimento → o nome aparece com o aviso "Dados preenchidos pela Receita
  Federal"; o mesmo CPF com o último número trocado → aviso de dígito errado, sem
  consulta.

## 13. Validação de formato dos documentos — Roadmap 2.0

- **Hoje:** CPF e CNPJ conferem tamanho e dígitos repetidos; RG/CNH/OAB só o
  básico. O número do documento de identidade é opcional.
- **Por que não agora:** prioridade baixa (decisão de 10/11/2026): com a consulta
  à Receita, o CPF já é conferido na fonte, e o dígito verificador do CPF já é
  conferido antes da consulta (item 12).
- **Na produção:** dígito verificador de CPF/CNPJ, formato de RG por estado,
  CNH (11 dígitos com verificador), OAB por seccional, CNJ com verificador em
  todos os campos — no formulário e no servidor.
- **Como conferir:** tentar cadastrar documentos com dígito errado e ver a recusa.

## 14. Agentes reais pelo DG Brasil (ponte)

- **Mudança de 11/11/2026:** a ponte foi validada no DEV com os agentes reais
  (Frente B), mas o DG Brasil passa a usar **clones** deles, com o sufixo `-dg`,
  numa pasta só dele: `G:\Meu Drive\DG BRASIL\CLIENTE BANCÁRIO\<NOME DO
  CLIENTE>` ([docs/agentes/clonagem](../agentes/clonagem/README.md)). Os
  agentes do escritório não são alterados e continuam fora do DG Brasil.
- **Por que não agora:** falta validar os clones com dados fictícios, um agente
  por vez, começando pela Clara.
- **Na produção:**
  1. aplicar **todas as migrations, em ordem** (`supabase db push`) no projeto
     de produção, **antes** de publicar o site. O que cada uma faz está no
     cabeçalho do arquivo e na tabela de
     [supabase/README.md](../../supabase/README.md);
  2. rodar o instalador do conector de novo na máquina principal (versão
     1.3.4), **antes** do instalador dos clones: conector mais antigo não
     entende a pasta com a origem, e desde 13/11/2026 o site recusa conector
     abaixo da 1.3.4 com a instrução de rodar o instalador;
  3. rodar o instalador dos clones a partir da pasta local `agentes/`
     ([instalacao.md](../mcp/instalacao.md), seção 5.0) e preencher o
     `C:\DGBrasil\agentes\escritorio.json` (quem assina);
  4. em DG Brasil → Agentes, conferir que a "Análise Bancária" usa a Clara do kit.
  Os clones não precisam de pasta do Drive ligada ao cliente: a pasta leva o
  nome do cliente no cadastro.
- **Como conferir:** cada clone entrega em Revisões os arquivos e a ficha de
  revisão; os itens a completar e a decidir viram pendências; a vigia não para
  pedindo confirmação; nada aparece no ChatJurídico.
- **Distribuição dos clones:** no lançamento, os arquivos ficam só no
  computador do escritório, fora do GitHub (o repositório é público). Levá-los
  para dentro do DG Brasil, com um botão "Setup", é a prioridade do
  [pós-MVP](pos-mvp.md), item 6.

## 15. Cópia de segurança dos documentos

- **Hoje:** o backup do Supabase cobre o banco, não os arquivos do Storage
  (`legal-documents`, `reference-materials`, `imports`, `skill-files`). O script
  `supabase/scripts/backup-documentos.mjs` espelha os buckets para uma pasta, só
  o que é novo ou mudou, e restaura o que faltar. Testado com um Storage
  simulado; **ainda não rodou contra o Supabase de verdade**.
- **Por que não agora:** falta decidir o destino (outro fornecedor, disco) e
  quem roda. É decisão da dona do escritório.
- **Na produção:**
  1. decidir o destino, a frequência e o responsável;
  2. fazer o ensaio no DEV: copiar, apagar um arquivo de teste, restaurar;
  3. criar o arquivo de chaves com as chaves de produção e fazer a primeira
     cópia, começando pela simulação;
  4. decidir se contrata o PITR do banco (item 3).
- **Como conferir:** o relatório termina com "Terminou sem falhas." e um
  documento apagado de propósito no DEV volta a abrir depois da restauração.
- Passo a passo: [restauracao-dos-documentos.md](restauracao-dos-documentos.md).

## 16. Monitoramento: alguém ser avisado quando algo quebra

- **Hoje (no código desde a revisão final de 13/11/2026):**
  - **`GET /api/health`**: pública, sem segredo e sem dado. Responde 200 quando
    o site e o banco respondem, e 503 quando o banco não responde. É o endereço
    para um monitor externo.
  - **Aviso de erros (`ERROR_WEBHOOK_URL`):** com um endereço nessa variável,
    todo erro que o servidor registra vira um POST para ele, já sem dado pessoal
    (os mesmos campos do log), no máximo 5 por minuto por instância. Serve um
    webhook de chat (Slack, Teams, Discord) ou de um serviço de alertas. Sem a
    variável, nada muda.
  - **Conferência das variáveis na subida** (item 8): o que falta vira erro no
    log e, com o aviso ligado, chega ao webhook.
  - **Vigia diária no banco** (migration 065, `dg-vigia-da-plataforma`, 08:30
    de Brasília em dia útil): avisa as administradoras, no sino do site, quando
    um agendamento do banco falhou, quando há trabalho de agente parado na fila
    há mais de 24 h ou quando nenhum computador do escritório faz contato há
    mais de 3 dias (os dois últimos só com a execução ligada). Um aviso por
    motivo por dia. É aviso de segurança: não dá para desligar nas preferências.
  - A rota agendada do Google Drive deixou de responder "skipped" em silêncio:
    sem configuração, registra erro e responde 503.
- **Por que não está tudo ligado:** o monitor externo e o destino dos erros são
  contas de terceiros. Escolher e contratar é decisão da dona do escritório.
- **Na produção:**
  1. **Monitor externo** (qualquer serviço de monitoramento de site): consultar
     `https://app.dgbrasil.adv.br/api/health` a cada 5 minutos e avisar por
     e-mail ou celular quando a resposta não for 200. É o único aviso que
     funciona com o site inteiro fora do ar: a vigia do banco avisa **dentro**
     do site.
  2. **Destino dos erros:** criar o webhook, pôr em `ERROR_WEBHOOK_URL` (só em
     Production) e publicar de novo.
  3. **Vigia:** depois do `db push`, conferir que `dg-vigia-da-plataforma` e
     `dg-expurgo-de-pedidos` estão em `cron.job`.
- **Como conferir:**
  - `/api/health` responde `"status":"ok"`;
  - `select private.platform_watch();` no SQL Editor devolve o resumo do dia
    (falhas do agendador, fila parada, computador calado, quantos avisos saíram);
  - nos logs da Vercel, depois de um deploy, aparece `env.ok` e nenhuma linha
    `env.check` com `"level":"error"`.
- **Sentry (ou outro serviço de erros), quando o escritório quiser:** é uma
  dependência nova e uma conta nova, por isso ficou fora. O lugar já existe:
  1. instalar o SDK do serviço para Next.js;
  2. em `apps/frontend/src/instrumentation.ts`, chamar o `init` do SDK dentro de
     `register()` e trocar o `onRequestError` pelo do SDK (no Sentry:
     `export const onRequestError = Sentry.captureRequestError`);
  3. para os erros que o próprio sistema registra (`log.error`), registrar um
     destino com `setLogSink` em `src/server/core/startup.ts`, como o do webhook
     (`error-webhook.ts`): ele já recebe os campos sanitizados;
  4. manter a regra: nada de CPF, nome, e-mail ou conteúdo de documento no que
     sai para o serviço. Desligar no SDK o envio do corpo das requisições.
- **O que isto não cobre:** e-mail que não chega (conferir no item 5), tribunal
  fora do ar (a tela de Integrações mostra) e o computador do escritório
  desligado no meio do dia (a vigia só confere de manhã).

## 17. Pedido de titular de dados (LGPD)

- **Hoje:** o sistema registra quem acessou o cadastro e os documentos de cada
  cliente, toda alteração e o aceite dos termos pelos usuários. Não há tela
  para exportar os dados de um titular nem função para anonimizar.
- **Por que não agora:** tela e anonimização ficam para depois do lançamento.
- **Na produção, antes do primeiro dado real:** definir quem atende e por onde o
  pedido chega, e ler o procedimento:
  [pedido-de-titular.md](pedido-de-titular.md).
- **Como conferir:** a tabela "Quem atende" do procedimento está preenchida.

## 18. Prazos de guarda (decisão pendente)

- **Hoje:**
  - com prazo e limpeza automática: o texto do pedido ao agente (180 dias,
    `dg-expurgo-de-pedidos`, agendado na 065: a função existia desde a 012 e
    nunca rodava), o histórico do agendador (7 dias, 057) e as linhas brutas de
    importação (042);
  - **sem prazo, crescendo para sempre:** os avisos (`notifications`), o
    histórico das buscas judiciais (`judicial_sync_runs`), a fila arquivada dos
    agentes, os registros de acesso a dado pessoal
    (`personal_data_access_events`) e a auditoria (`audit_events`).
- **Por que não agora:** por quanto tempo guardar cada um é decisão da dona do
  escritório. A revisão final não definiu nenhum prazo novo.
- **Na produção:** decidir e pedir a migration. Recomendação técnica, para
  decidir: avisos lidos, 12 meses; histórico das buscas judiciais, 90 dias; fila
  arquivada, 90 dias; auditoria e acessos a dado pessoal, **não apagar** sem
  orientação jurídica (são o registro de quem fez e de quem viu).
- **Como conferir:** `select jobname from cron.job order by 1;` mostra um
  agendamento de limpeza para cada tabela com prazo definido.
