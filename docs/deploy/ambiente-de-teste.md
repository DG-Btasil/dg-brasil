# Ambiente de teste depois da virada: como montar e manter

Hoje `app.dgbrasil.adv.br` é o site de teste, ligado ao Supabase **DEV**. Na virada, o
mesmo endereço passa a ser o site de uso real, ligado a um Supabase **de produção** novo
([checklist-da-virada.md](checklist-da-virada.md)). Este guia diz como ficar com um lugar
de teste separado depois disso, como mantê-lo e como apagar o DEV antigo.

**Primeiro, a decisão.** Sem ambiente de teste, toda correção e toda migration nova vão
direto para os clientes, e os scripts de conferência (`validar:real`, `usuarios:qa`,
testes de integração) não têm onde rodar: eles recusam a produção de propósito. Com
ambiente de teste, cada mudança é vista primeiro num site com dados fictícios. Se mesmo
assim decidir não ter, pule para a parte 9.

## Como fica

| | Uso real | Teste |
|---|---|---|
| Site da equipe | `app.dgbrasil.adv.br` | `app.teste.dgbrasil.adv.br` |
| Portal do parceiro | `portal.dgbrasil.adv.br` | `portal.teste.dgbrasil.adv.br` |
| Ramo do GitHub | `master` | `teste` |
| Vercel | ambiente *Production* | ambiente *Preview*, só o ramo `teste` |
| Supabase | projeto de produção, plano Pro | projeto "DG Brasil - teste", plano gratuito |
| Dados | reais | só fictícios |
| Computador do escritório | ligado aqui | não ligado (ver parte 8) |

Os endereços de teste começam com `app.` e `portal.` de propósito: o site reconhece qual
é qual pelo começo do endereço.

**Custo:** zero, se o projeto de teste ficar numa **organização gratuita** do Supabase,
separada da organização paga da produção. O projeto gratuito pausa depois de 1 semana sem
uso; para voltar, é só abrir o painel e clicar em *Restore*. Se ficar dentro da
organização paga, custa cerca de US$ 10 por mês.

> **Cuidado na hora de contratar o Pro:** se você passar para Pro a organização onde o DEV
> está hoje, o projeto de teste passa a ser cobrado. Crie a produção numa organização nova
> ("DG Brasil - Produção") e assine o Pro só nela.

---

## Parte 1. Criar o projeto de teste no Supabase (uns 30 minutos)

Pode ser feito **antes da virada**, e é o melhor momento: aplicar todas as migrations num
projeto vazio é exatamente o ensaio do checklist, passo 5, sem risco nenhum.

1. Em [supabase.com/dashboard](https://supabase.com/dashboard), na organização
   **gratuita**, **New project**: nome "DG Brasil - teste", região **São Paulo**
   (`sa-east-1`), senha do banco gerada na hora (guarde num cofre de senhas).
2. Anote o **identificador do projeto**: as letras do endereço
   `https://<identificador>.supabase.co`.
3. **Database → Extensions:** ligue `pgmq`, `pg_cron` e `pg_net`.
4. No computador onde você aplica as migrations, na pasta `supabase` do repositório:
   ```bash
   npx supabase link --project-ref <identificador do TESTE>
   npx supabase db push
   ```
   Se parar no meio: anote a mensagem e a migration. Não conserte migration antiga; como o
   projeto está vazio, dá para apagar o projeto e começar de novo depois da correção.
5. **SQL Editor**, conferir os agendamentos:
   ```sql
   select jobname, schedule from cron.job order by jobname;
   ```
   A lista esperada está no checklist, passo 14.
6. **Senha do servidor** (`dg_worker`), no SQL Editor, com uma senha nova:
   ```sql
   alter role dg_worker with login password '<senha forte nova>';
   ```
7. **Cofre** (para a busca judicial do banco chamar o site de teste), no SQL Editor:
   ```sql
   select vault.create_secret('https://app.teste.dgbrasil.adv.br', 'dg_app_url');
   select vault.create_secret('<CRON_SECRET do teste>', 'dg_cron_secret');
   ```
   O `CRON_SECRET` do teste é um texto aleatório de 16 caracteres ou mais, **diferente**
   do da produção.

## Parte 2. Configurar o login (Auth) do projeto de teste

Como em [docs/auth.md](../auth.md), seção "Supabase Auth", com estas diferenças:

- **URL Configuration:** Site URL `https://app.teste.dgbrasil.adv.br`; Redirect URLs
  `https://app.teste.dgbrasil.adv.br/auth/confirm**` e
  `https://portal.teste.dgbrasil.adv.br/auth/confirm**`.
- **E-mail:** o plano gratuito usa o envio padrão do Supabase, com limite de poucos e-mails
  por hora. Para teste basta. Cole os modelos (`npm run emails` na pasta `supabase`) como
  na produção.
- Cadastro aberto **desligado**, TOTP ligado, senha de 8 caracteres ou mais.

## Parte 3. Ligar o site de teste na Vercel

1. **Ramo `teste` no GitHub**, a partir do `master`:
   ```bash
   git checkout master && git pull
   git checkout -b teste && git push -u origin teste
   ```
2. **Variáveis**, no projeto do DG Brasil na Vercel: **Settings → Environment Variables**.
   Para cada uma, marque **só *Preview*** e, em "Git branch", escolha **`teste`**:

   | Variável | Valor |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | do projeto de teste (Project Settings → API) |
   | `SUPABASE_SERVICE_ROLE_KEY` | do projeto de teste |
   | `DG_WORKER_DB_URL` | login `dg_worker` do teste, pelo pooler (porta 5432) |
   | `CRON_SECRET` | o mesmo do cofre do teste (parte 1, passo 7) |
   | `DG_ENV` | `development` |
   | `NEXT_PUBLIC_APP_HOST` | `app.teste.dgbrasil.adv.br` |
   | `NEXT_PUBLIC_PORTAL_HOST` | `portal.teste.dgbrasil.adv.br` |

   **Não** ponha no teste as chaves pagas do Serpro nem as do Google Drive da produção.
3. **Domínios:** **Settings → Domains → Add**: `app.teste.dgbrasil.adv.br`. Na tela do
   domínio, em "Git branch", escolha `teste`. Repita para `portal.teste.dgbrasil.adv.br`.
   Se o domínio `dgbrasil.adv.br` usa os servidores de nome da Vercel, o endereço passa a
   funcionar sozinho; senão, a Vercel mostra um registro `CNAME` para criar onde o domínio
   foi registrado.
4. **Proteção das prévias:** em **Settings → Deployment Protection**, a Vercel pode exigir
   login da Vercel para abrir qualquer prévia. Com ela ligada, o site de teste só abre para
   quem tem conta na Vercel, e a busca judicial do banco não consegue chamar o site. Para
   um teste completo, desligue a proteção das prévias (os dados são fictícios e o site
   tem login próprio com duas etapas).
5. **Publicar:** qualquer `git push` no ramo `teste` gera um deploy novo. Para o
   primeiro, em **Deployments**, use **Redeploy** no último deploy do ramo `teste`.
6. **Conferir:** `https://app.teste.dgbrasil.adv.br/api/health` responde
   `{"status":"ok","database":"ok"}`.

## Parte 4. Primeiro acesso e dados fictícios

1. Criar a primeira administradora do teste ([supabase/README.md](../../supabase/README.md),
   "Primeira administradora"). Use um e-mail de teste ou o mesmo da produção; são contas
   separadas, em bancos separados.
2. Entrar, aceitar os termos e cadastrar a verificação em duas etapas. No aplicativo
   autenticador, dê um nome que deixe claro que é o **teste**.
3. Atualizar `supabase/.env.real` (fica fora do Git) com as chaves do projeto de teste e
   `DG_DEV_PROJECT_REF=<identificador do TESTE>`. Nunca o identificador da produção.
4. Usuários de QA: `npm run usuarios:qa` na pasta `supabase`.
5. Conferência completa: `npm run validar:real` e, em `apps/frontend`,
   `npm run test:integration`.

## Parte 5. O dia a dia: como testar uma mudança

1. A mudança é feita num ramo próprio (ex.: `fix/alguma-coisa`).
2. **Se tiver migration nova:** aplique **primeiro no teste**:
   ```bash
   npx supabase link --project-ref <identificador do TESTE>
   npx supabase db push
   ```
3. Junte o ramo no `teste` e envie (`git checkout teste && git merge fix/alguma-coisa &&
   git push`). Em 1 a 3 minutos o site de teste está com a mudança.
4. Confira no `app.teste.dgbrasil.adv.br`.
5. Deu certo: aplique a migration na **produção** e só depois junte no `master`:
   ```bash
   npx supabase link --project-ref <identificador da PRODUÇÃO>
   npx supabase db push
   git checkout master && git merge fix/alguma-coisa && git push
   ```
   **Banco sempre antes do site**, nos dois ambientes.
6. De tempos em tempos, traga o `master` para o `teste` (`git checkout teste && git merge
   master && git push`), para os dois não se afastarem.

> **O erro mais perigoso:** o `supabase link` lembra o último projeto ligado. Antes de todo
> `db push`, confira para onde ele vai: `npx supabase projects list` marca o projeto
> ligado. Na dúvida, rode o `link` de novo.

## Parte 6. Regras do ambiente de teste

- **Só dados fictícios.** Nada de cliente, CPF ou processo real.
- **Não cadastre a OAB real** do escritório nas OABs acompanhadas do teste, ou deixe o
  DJEN desligado: senão o teste passa a guardar publicações reais. Para testar a busca
  judicial, cadastre a OAB, teste e pause na mesma hora.
- **Google Drive e Serpro** ficam desligados no teste.
- O projeto gratuito **pausa** depois de 1 semana sem uso. Ao voltar, clique em *Restore*
  no painel e espere uns minutos antes de abrir o site.

## Parte 7. Quando algo der errado no teste

- Site mostra erro geral: abra `/api/health`. `database` diferente de `ok` = projeto
  pausado ou senha do `dg_worker` errada.
- Login não chega por e-mail: limite de envio do plano gratuito; espere uma hora ou crie a
  conta pelo painel do Supabase.
- O teste ficou bagunçado demais: apague o projeto de teste e refaça a parte 1. Ele não
  guarda nada que importe.

## Parte 8. O computador do escritório e o teste

O conector do computador do escritório fala com **um endereço só**, e depois da virada ele
fica ligado à produção. Para testar agentes no ambiente de teste é preciso trocar o token
(rodar o instalador e responder **T** com um token do teste), e enquanto isso a produção
fica sem o computador. Por isso: teste de agente só fora do horário de trabalho, e no fim
volte o token da produção. Uma alternativa futura é um segundo computador ou outra conta do
Windows só para teste.

## Parte 9. Apagar o DEV antigo (e, se decidir, ficar sem teste)

**Quando:** 1 a 2 semanas depois da virada, com a produção estável e a primeira cópia de
segurança conferida.

1. Confira que nada aponta mais para o DEV antigo:
   - na Vercel, nenhuma variável com o endereço dele (Settings → Environment Variables,
     procure o identificador);
   - `supabase/.env.real` com o identificador do teste novo (ou apagado, se não houver teste);
   - neste computador, `%APPDATA%\DGBrasil\executor.json` com o token da produção.
2. Se quiser guardar alguma coisa do DEV antigo (não é necessário: tudo nele é fictício),
   baixe o backup em Database → Backups.
3. No painel do Supabase: projeto DEV antigo → **Project Settings → General → Delete
   project**. Não tem volta.
4. No Google Authenticator, apague a entrada do DEV antigo.

**Se decidir ficar sem ambiente de teste:** faça só esta parte 9 e não crie o projeto
novo. A partir daí, toda migration vai direto para a produção, então: leia o cabeçalho da
migration antes, rode `npm run verificar` (o simulador local continua funcionando) e
aplique fora do horário de trabalho.
