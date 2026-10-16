# Auth — identidade, sessão, convites e MFA (Etapa 4.1)

Identidade real com **Supabase Auth**. O banco (RLS) e o servidor Next.js decidem
o acesso; o navegador só exibe. Os módulos jurídicos (Clientes, Casos, Processos,
Revisões, Financeiro) **ainda usam dados mock**, recortados pelo papel real, até a
Etapa 4.3.

## Regras

- Só os 5 papéis: `ADMIN`, `LAWYER`, `ASSISTANT` (escritório proprietário) e
  `PARTNER_ADMIN`, `PARTNER_USER` (escritórios parceiros).
- **Sem cadastro público.** Conta só por convite. Não há "criar escritório".
- E-mail + senha (mínimo 8, maiúsculas, minúsculas e números) + **MFA TOTP
  obrigatório para todos**. Sem OAuth, passkey, SSO, magic link como login principal.
- Papel, vínculo e escritório são lidos **do banco a cada requisição**. Mudou o
  papel, suspendeu, inativou: vale na próxima requisição, sem esperar o token.
- O papel **nunca** vem do navegador (nem Zustand, nem localStorage, nem cookie
  próprio). A sessão mock não é mais persistida.
- Service role só no servidor (`src/lib/supabase/admin.ts`, `server-only`), e só
  onde o Supabase Auth exige: enviar convite e remover fatores de MFA — **depois**
  de o banco autorizar o ator. Nunca em variável `NEXT_PUBLIC_*`.
- Nada de senha, OTP, segredo TOTP, access/refresh token, token de convite ou de
  recuperação em log (`sanitizeForLog`). O segredo TOTP fica só no Supabase Auth.

## Camadas

| Camada | Arquivo | Papel |
|---|---|---|
| Banco | `supabase/migrations/20261010000022_auth_sessions_invitations.sql` | `current_membership()` exige **aal2** (RLS inteira), `resolve_actor` recusa aal1, convites, aceite idempotente, troca de papel/status, último ADMIN, auditoria |
| Banco | `supabase/migrations/20261012000023_invitation_hardening.sql` | `create_invitation` só pelo servidor (service role + `p_actor`): o navegador não sonda quais e-mails têm conta; nome do convidado validado; devolve o id da conta existente ao servidor |
| Banco | `supabase/migrations/20261027000038_account_session_security.sql` | Sessão do JWT precisa existir em `auth.sessions` (RLS inteira), reset de MFA invalida sessões anteriores, `get_my_sessions()`, auditoria e avisos das ações da conta (Etapa 4.3.2) |
| Proxy | `apps/frontend/src/proxy.ts` | Renova a sessão (cookies SSR), manda quem não tem sessão para `/login?next=` (saneado). **Não** decide papel |
| Sessão | `src/server/auth/session.ts` | `getCurrentSession()` (1×/requisição): `getUser` + AAL + fatores + `get_my_session_context()` → `evaluateSession` |
| Guards | `requireAppSession`, `requirePermission`, `requireInternalUser`, `requireAdmin`, `requireLawyerOrAdmin`, `requirePartnerUser`, `requirePartnerAdmin`, `authorizeAction` | Páginas redirecionam; Server Actions lançam `AuthorizationError` |
| Páginas | `src/components/layout/server-guards.tsx` | `RequirePermission` / `AudienceSwitch` **de servidor** (o conteúdo negado nem é enviado) |
| Permissões | `src/lib/permissions/index.ts` | Matriz central `can(role, permission)` (testada em `permissions.test.ts`) |
| Cliente | `src/features/auth/session-context.tsx` | `AuthProvider` com o recorte `ClientSession` que o servidor validou |

`evaluateSession` (função pura, `src/lib/auth/evaluate.ts`) decide o estado:

```
ANONYMOUS → /login
SESSION_REVOKED (sessão encerrada ou anterior a reset de MFA) → /acesso?motivo=sessao-encerrada
PROFILE_MISSING | PROFILE_INACTIVE → /acesso?motivo=conta-inativa
NO_MEMBERSHIP | MEMBERSHIP_INACTIVE → /acesso?motivo=sem-acesso
ORGANIZATION_BLOCKED → /acesso?motivo=escritorio-suspenso
ORGANIZATION_PENDING → /acesso?motivo=escritorio-pendente
MFA_VERIFY (tem fator, sessão aal1) → /seguranca/verificar
LEGAL_PENDING (versão vigente não aceita) → /termos
MFA_ENROLL (sem fator) → /seguranca/mfa
READY → app
```

Pré-MFA (aal1) o banco só permite: ler o próprio contexto, aceitar convite,
registrar aceite de termos e atualizar o próprio perfil.

## Superfícies

`app.*` = equipe interna; `portal.*` = parceiros (`NEXT_PUBLIC_APP_HOST` /
`NEXT_PUBLIC_PORTAL_HOST`). **O papel decide**; o host só escolhe a porta. Papel
de parceiro em `app.*` é redirecionado para `portal.*` (e vice-versa). Em
`localhost` não há redirecionamento.

## Fluxos

**Login** (`/login`): `signInWithPassword` no navegador (o Auth vê o IP real →
limite de tentativas). Erro sempre "E-mail ou senha incorretos." Depois, `/`
decide no servidor.

**Convite** (Configurações → Equipe; Minha Conta para `PARTNER_ADMIN`):

1. Servidor gera `ref` aleatório (32 bytes), grava só o **SHA-256** em
   `user_invitations.token_hash` via `create_invitation`. Desde a 023 essa RPC só
   aceita a **service role com `p_actor`** (o navegador não chama: antes, um
   PARTNER_ADMIN podia descobrir pela API se um e-mail tinha conta). A
   autorização continua no banco, pelo papel do ator: ADMIN convida qualquer
   papel no escritório certo; PARTNER_ADMIN só `PARTNER_*` no próprio; convite
   pendente anterior é revogado. O **nome** do convidado é validado no banco e
   no servidor (só letras, espaço, apóstrofo, hífen e ponto de abreviação), porque
   aparece no e-mail com a nossa marca — sem isso daria para escrever um golpe
   ("Acesse www…") no campo nome.
2. `admin.inviteUserByEmail` (também no reenvio a conta ainda não confirmada;
   link de recuperação se a conta já foi confirmada no Auth) com
   `redirectTo = <host do papel>/auth/confirm?fluxo=convite&ref=<ref>`.
3. `/auth/confirm` valida o `token_hash` (`verifyOtp`) → `/primeiro-acesso?ref=`.
   Conta reconvidada que **já tem autenticador** confirma o código antes
   (`/seguranca/verificar?retorno=convite&ref=…`): o Auth só troca senha em aal2.
4. Nome + senha → `accept_invitation(sha256(ref))` (exige sessão do MESMO e-mail;
   idempotente; inválido/revogado/expirado/conflito → `/acesso?motivo=...`) →
   termos → cadastro do MFA → app. O 1º `PARTNER_ADMIN` ativa o parceiro `PENDING`.
   No aceite, os dados de e-mail do convite são apagados do `user_metadata`.

**`user_metadata` = só texto de e-mail.** `full_name`, `first_name`,
`invite_role`, `organization_name` e `invite_pending` existem para os templates.
O próprio usuário pode alterá-los (`auth.updateUser`) e eles vão no JWT, então
**nunca** decidem acesso: papel e escritório vêm de `organization_memberships`.
`invite_role`, `organization_name` e `invite_pending` são apagados no aceite. A
lista está em `src/lib/auth/invite-metadata.ts`; `metadata-guard.test.ts` falha
se front, worker ou migration passarem a ler esses campos, ou se um template
usar chave fora da lista.

Reenviar = novo convite (novo `ref`; o anterior é revogado). Cancelar = revogar.

**Recuperação** (`/recuperar-senha`): resposta sempre igual (não revela conta).
Link → `/auth/confirm?fluxo=recuperacao` → `/nova-senha`. Quem tem MFA verifica o
código antes (`/seguranca/verificar?retorno=senha`).

**MFA**: `/seguranca/mfa` (QR + chave manual, confirma com código) e
`/seguranca/verificar`. **Não existe "desativar MFA".** Celular perdido → ADMIN
usa "Redefinir verificação em duas etapas" (remove os fatores pela Admin API;
eventos `MFA_RESET_REQUESTED`/`MFA_RESET_COMPLETED` na auditoria; não vale para
si mesmo). No próximo acesso a pessoa cadastra um novo.

**Sessão e "Lembrar de mim"** (`src/lib/auth/session-cookies.ts`):

- A sessão é **só** a do Supabase Auth (cookies `sb-*`, gravados pelo
  `@supabase/ssr`; o proxy renova o token a cada requisição e a renovação
  mantém o nível `aal2`). Não há segundo sistema de sessão.
- **Marcado**: os cookies da sessão persistem (400 dias, renovados a cada
  uso). Fechar e reabrir o navegador mantém a MESMA sessão `aal2` → entra
  direto, sem senha nem código, enquanto o Supabase considerar a sessão válida.
- **Desmarcado**: os mesmos cookies, sem prazo → **cookies de navegador**,
  que somem ao fechar o navegador. Limitação: navegadores com "continuar de
  onde parou" podem restaurar cookies de sessão.
- A preferência é o cookie `dg-lembrar=1`. Ela **só muda a duração** dos
  cookies (aplicada nos três `setAll`: proxy, servidor, navegador — a
  biblioteca força 400 dias, então a duração é ajustada ali). Nunca é lida para
  decidir acesso: login novo é sempre senha + TOTP, e o nível vem do JWT
  assinado. `session-cookies.test.ts` trava isso.
- **Sair** revoga **só esta** sessão no Supabase (`scope: "local"`; o refresh
  token dela deixa de valer e, desde a 038, o access token dela também perde o
  banco), apaga os cookies e apaga `dg-lembrar`. Os outros dispositivos
  continuam — para eles, ver "Sessões e dispositivos".
- Produção: configurar no Supabase (plano Pro) *Time-box user sessions* e
  *Inactivity timeout* (`[auth.sessions]` no `config.toml`) para limitar a
  vida de uma sessão lembrada.
- **Step-up** (avaliado na 4.3.2, não implementado): toda ação sensível já
  exige `aal2` (senha + TOTP nesta sessão) e sessão válida no banco. As ações
  de sessão só **reduzem** acesso (encerrar sessões), então não pedem código de
  novo. Para ações que **ampliam** risco (no futuro: trocar e-mail, exportar
  dados), o JWT traz `amr` com o horário da última verificação TOTP — a ação
  pode exigir verificação recente (`challengeAndVerify` de novo) sem desfazer o
  "Lembrar de mim".

### Sessões e dispositivos (Etapa 4.3.2, migration 038)

**Onde:** Configurações → "Sua conta e sessões" (todo papel interno) e
Minha Conta → "Segurança da conta" (parceiros). Sempre a **própria** conta: o
ADMIN não vê sessões de outras pessoas.

**Modelo.** O Supabase Auth continua a fonte de verdade: uma sessão é uma linha
de `auth.sessions`, identificada pelo `session_id` do JWT (verificado). Não há
tabela paralela de sessões nem UUID inventado. `auth.sessions` **não** é
exposta pela Data API (sem grant para `authenticated`/`anon`); a lista sai de
`get_my_sessions()` (SECURITY DEFINER, `user_id = auth.uid()`, exige `aal2` e
vínculo ativo; nenhum parâmetro — o navegador não escolhe usuário).

**O que a lista mostra** (DTO `AccountSessionDTO`): esta sessão marcada ("Este
dispositivo", pelo `session_id` do JWT — nunca comparando user agent), quando
entrou, última atividade **aproximada** (`refreshed_at`: o navegador renova o
token ~1×/hora enquanto aberto), se concluiu o MFA (`aal`), e
navegador / sistema / tipo de aparelho ("Chrome no Windows", "Safari no
iPhone"). O user agent é reduzido a famílias **dentro do banco**
(`private.ua_browser/ua_os/ua_device`); o texto cru, o IP, tokens e o id
completo da sessão não saem (só um prefixo de 8 caracteres, para a lista).
Sem fingerprinting: nada de canvas, fontes, hardware ou geolocalização.
Sessões abertas pelo link de convite/recuperação (rota `/auth/confirm`, no
servidor) podem aparecer como "Navegador desconhecido".

**Ações:**

| Botão | O que faz | Auditoria (antes de revogar) | Aviso (Segurança) |
|---|---|---|---|
| Sair deste dispositivo | `signOut({ scope: "local" })` | `SESSION_CURRENT_REVOKED` | — |
| Sair de todos os outros dispositivos | `signOut({ scope: "others" })`; esta continua | `OTHER_SESSIONS_REVOKED` | "Outras sessões encerradas" |
| Sair de todos os dispositivos | confirmação forte (digitar SAIR); `signOut({ scope: "global" })`; apaga `dg-lembrar`; volta ao login | `ALL_SESSIONS_REVOKED` | "Todas as sessões encerradas" |
| Alterar senha (`/nova-senha`) | `updateUser` + `signOut({ scope: "others" })`; esta continua | `PASSWORD_CHANGED` | "Sua senha foi alterada" |

A auditoria é gravada pelo próprio usuário (`record_account_security_event`,
lista fechada de ações, metadado só `aal`) **antes** da revogação, enquanto o
JWT ainda vale. Avisos de segurança não dependem de preferência e não
duplicam (`event_key`); não há aviso por renovação de token.

**Encerrar UMA sessão específica de outro aparelho: não suportado.** O
Supabase Auth não tem API oficial para revogar uma sessão por id
(`auth.admin.signOut` exige o JWT da própria sessão). Apagar linhas de
`auth.sessions` ou refresh tokens na mão não é feito. A tela não oferece o
botão; o caminho é "Sair de todos os outros dispositivos".

**Access token já emitido.** Revogar uma sessão impede o refresh, mas o JWT
de acesso continua assinado até expirar (~1 h). Desde a 038 isso **não dá
mais acesso a dados**: `private.current_membership()` — base de toda a RLS e
dos helpers de autorização — exige que o `session_id` do JWT exista em
`auth.sessions`, seja do usuário e não esteja vencido (`not_after`). O
servidor Next.js recebe `session_state` em `get_my_session_context()` (já
chamada a cada requisição) e manda para "Sessão encerrada". A checagem é uma
busca por chave primária + uma no índice de auditoria, uma vez por consulta
(as policies usam `(select private.…())`); `validar:real` mede (< 2 ms).
Chamadas sem `session_id` (service role, worker) seguem como antes.

**Reset de MFA pelo ADMIN** força nova autenticação: toda sessão criada antes
do último `MFA_RESET_COMPLETED` do usuário vira `REAUTH_REQUIRED` (sem dados,
fora da lista de sessões ativas). Sem isso, uma sessão antiga — talvez a de
quem pegou o celular — continuaria `aal2` e poderia cadastrar um autenticador
novo. A pessoa entra de novo (senha) e cadastra o novo fator. A possibilidade
de o ADMIN **encerrar as sessões de outra pessoa** (Admin API, por usuário)
fica para depois: hoje, suspender o vínculo ou inativar a conta já corta o
acesso na próxima requisição.

**Suspensão / inativação**: login novo é negado (estado do vínculo/perfil) e as
sessões existentes não continuam — cada requisição relê o vínculo no banco
(`get_my_session_context` + RLS via `current_membership()`), então o próximo
clique já vai para `/acesso`, com o JWT ainda válido ou não. As sessões ficam
em `auth.sessions` até expirar ou a pessoa sair; nada nelas dá acesso.

**Desempenho**: a existência da sessão é conferida no banco a cada consulta
(barata, acima). O servidor não faz chamada extra ao Auth por requisição além
do `getUser` que já existia.

**Limite de taxa**: encerrar sessões — 5 por minuto por usuário
(`enforceAccountSecurityLimit`, memória da instância; mesmo modelo
best-effort do limite de CPF/CNPJ). O login e o MFA seguem com os limites do
próprio Supabase Auth.

**Cookies**: `httpOnly` e `SameSite=Lax` (padrão do `@supabase/ssr`), `Secure`
quando a requisição é HTTPS (`withSessionLifetime`); em `localhost` (HTTP) sem
`Secure`, para o DEV funcionar. Renovação no SSR (proxy) preservada.
**Session fixation**: não se aplica — o id de sessão é criado pelo Supabase no
login (`signInWithPassword` no navegador / `verifyOtp` no servidor) e o cookie
só é gravado com a sessão nova; não há id de sessão aceito por URL ou formulário.

**Erros**: mensagens amigáveis com código de referência (`requestId`); nunca o
erro cru do Auth/SQL nem o `session_id`.

**Introdução do produto (tour)** — separada do onboarding de segurança
(convite → senha → termos → MFA): aparece **uma vez por usuário**, na Home,
depois do acesso liberado. O estado é `user_preferences.tour_completed_at` no
banco (RLS: só o próprio usuário, com `aal2` — migration 024), lido pelo
servidor em `(app)/layout.tsx`; vale em qualquer navegador. Concluir ou
"Pular introdução" grava a data (`completeProductTour`, idempotente). Fechar o
convite (Esc) só adia até a próxima visita. Rever: menu do usuário →
"Conhecer o DG Brasil" (não altera a data). Contas já existentes sem data veem
a introdução uma vez. O portal do parceiro não tem tour.

**Gestão**: troca de papel, suspender/reativar/remover vínculo (ADMIN e
PARTNER_ADMIN no próprio escritório), inativar conta (só ADMIN). O banco impede:
alterar o próprio acesso, remover o último ADMIN ativo, suspender/excluir o
escritório proprietário, mudar o tipo de organização.

**Termos** (`/termos`): `src/lib/auth/legal-documents.ts` tem a versão vigente.
**Os textos são provisórios** ("Documento jurídico provisório — revisar antes da
produção.") e precisam ser substituídos pelos definitivos aprovados. Mudar
`version` força novo aceite de todos. Aceite é append-only, com IP e navegador.

## Configuração

### Front (`apps/frontend/.env.local`, ver `.env.example`)

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` (secreta, só servidor), `NEXT_PUBLIC_APP_HOST`,
`NEXT_PUBLIC_PORTAL_HOST`. **Somente o projeto Supabase de DESENVOLVIMENTO.**

### Supabase Auth (painel do projeto DEV)

`supabase/config.toml` já traz a configuração local; no projeto remoto confira no
painel (ou `npx supabase config push`, que sobrescreve o painel com o arquivo):

1. **Authentication → Sign In / Providers**: *Allow new users to sign up* **desligado**;
   e-mail habilitado; *Secure password change* ligado.
2. **Authentication → Policies (Password)**: mínimo **8**, *lowercase, uppercase,
   digits*. *Leaked password protection* (HaveIBeenPwned) quando o plano permitir.
3. **Authentication → Multi-Factor**: **TOTP habilitado** (enroll + verify).
4. **Authentication → URL Configuration**: Site URL `http://localhost:3000` (DEV);
   Redirect URLs `http://localhost:3000/auth/confirm**` (e, em produção,
   `https://app.barbaracardoso.adv.br/auth/confirm**` e
   `https://portal.barbaracardoso.adv.br/auth/confirm**`). Se o destino não estiver
   na lista, o Auth cai na Site URL e o link do e-mail quebra.
5. **Authentication → Email Templates**: *Invite user* e *Reset password* com o
   conteúdo de `supabase/templates/invite.html` e `recovery.html` (links com
   `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=...`). Os templates padrão
   (fluxo implícito) **não funcionam** com o login SSR. Ver "E-mails do Auth" abaixo.
6. **SMTP**: o SMTP padrão do Supabase só entrega para e-mails da equipe do
   projeto e tem limite baixo. Para testes use contas fictícias e o harness
   (`generateLink`). Produção exige SMTP próprio.
7. Validade do link do e-mail: *Email OTP expiration* (padrão 1 h). O convite em
   si vale 7 dias; se o link expirar, o administrador reenvia.

### E-mails do Auth (convite e redefinição de senha)

`supabase/templates/invite.html` e `recovery.html` são **gerados** por
`supabase/templates/build.mjs` (layout único, CSS inline, sem imagens externas:
o logotipo é tipográfico, como no app). Não edite os `.html` à mão.

```bash
cd supabase
npm run emails           # regera os dois .html
npm run emails:check     # CI: falha se estiverem desatualizados ou com link alterado
npm run emails:preview   # pré-visualização em supabase/.preview-emails/index.html
```

- **Saudação**: `Olá, {{ .Data.first_name }}!` → `Olá, {{ .Data.full_name }}!` →
  `Olá!`. O `first_name` é gravado em `user_metadata` no convite
  (`firstNameOf`, em `src/lib/auth/first-name.ts`); o template do Supabase
  (`html/template` do Go, sem funções extras) não consegue recortar o nome.
  Contas criadas antes disso ou pelo painel caem no nome completo ou em "Olá!".
- **Suporte**: preencha `supportEmail` em `supabase/templates/email.config.json`
  e rode `npm run emails`. Vazio = a seção não aparece. Domínios de exemplo
  (`.test`, `.exemplo`, `example.com`…) são recusados.
- **Aplicar no projeto remoto** (manual): Authentication → Email Templates →
  *Invite user*: assunto `Seu convite para o DG Brasil | Bárbara Cardoso Advocacia`
  e o conteúdo de `invite.html`; *Reset password*: assunto
  `Redefinição de senha | DG Brasil` e o conteúdo de `recovery.html`. (Ou
  `npx supabase config push`, que sobrescreve o painel inteiro com o `config.toml`.)
- **Convite por público**: `user_metadata.invite_role` e `organization_name`
  (gravados por `inviteUser`) escolhem o texto: equipe da Bárbara Cardoso
  Advocacia (`ADMIN`/`LAWYER`/`ASSISTANT`), administrador(a) de escritório
  parceiro (`PARTNER_ADMIN`, que depois convida a própria equipe) e integrante
  do parceiro (`PARTNER_USER`), com o cartão "Escritório / Perfil de acesso".
  Sem esses dados (convites antigos), texto genérico de parceria. O resumo de
  cada perfil (`ROLE_COPY` no gerador) acompanha `ROLE_DESCRIPTION`.
- **Reenvio**: conta ainda não confirmada recebe de novo o **convite** (o
  banco devolve o id da conta ao servidor → atualiza papel/escritório →
  `inviteUserByEmail`). Conta **confirmada** (ex.: acesso removido e
  reconvidado) recebe o e-mail de **recuperação** — o Auth não aceita convite
  para ela — com `invite_pending` marcado, e o template troca o texto para
  "Seu acesso ao DG Brasil / Acessar o DG Brasil". A marca é apagada no aceite.
  Se o convite for cancelado sem aceite, a marca fica; essa conta não tem acesso
  ativo, então o efeito é só o texto de um eventual e-mail de recuperação.
- O Go template remove comentários HTML: nada de `<!--[if mso]>`. Botões são
  tabelas com `bgcolor`.

### Primeiro ADMIN (DEV, fictício)

1. Painel → Authentication → **Add user** (ex.: `admin@dgbrasil.test`, senha forte,
   *auto confirm*).
2. SQL Editor (postgres): `select private.bootstrap_owner_admin('<uuid>');`
   (só funciona sem ADMIN ativo — usuários do harness de validação contam).
3. Entrar em `/login` → termos → cadastrar MFA → app. Daí em diante, convites.

## Testes

- `apps/frontend`: `npm test` (vitest) — matriz de permissões por papel,
  `evaluateSession`, anti open-redirect (`safeNextPath`), superfície por host,
  política de senha, mensagens de login e redação de logs.
- `supabase/tests`: `npm run verificar` (PGlite) — seção "Auth (022)": aal1 não vê
  nada, RPCs exigem MFA, convites (inclusive IDOR entre escritórios), aceite
  idempotente/revogado/expirado, troca de papel imediata, último ADMIN, escritório
  proprietário protegido.
- `npm run validar:real` (Supabase DEV, `.env.real`) — login com MFA (TOTP real)
  nos 5 papéis, convite ponta a ponta via `generateLink` + `verifyOtp` + aceite,
  IDOR do parceiro, troca de papel com efeito imediato.
- **Manual (navegador)**: roteiro em "QA manual" abaixo. E2E automatizado
  (Playwright) não foi incluído: exigiria credenciais e TOTP reais no CI.

### QA manual (DEV, contas fictícias)

1. `/home` sem sessão → `/login?next=%2Fhome`.
2. Senha errada e e-mail inexistente → mesma mensagem.
3. Primeiro login do ADMIN → termos → MFA (QR) → home; sair e entrar → pede código.
4. Convidar `LAWYER` (`*@dgbrasil.test`, link via harness ou SMTP) → primeiro acesso
   → termos → MFA → home sem Financeiro/DG Brasil.
5. Trocar o papel do LAWYER para ASSISTANT → na próxima navegação, Revisões some.
6. Suspender o usuário → próxima navegação vai para `/acesso`.
7. `PARTNER_ADMIN` em `localhost`: portal; convite só de `PARTNER_*`.
8. Redefinir MFA de um usuário → ele cadastra novo autenticador no login seguinte.
   Se ele tinha uma sessão aberta, o próximo clique dela vai para "Sessão encerrada" (4.3.2).
9. `/login?next=https://evil.com` → após login fica no app.
10. **Sessões (4.3.2)**, mesmo usuário em dois navegadores A (Chrome) e B (Firefox
    ou celular): Configurações → "Sua conta e sessões" (parceiro: Minha Conta)
    lista as duas, A marcada como "Este dispositivo", nomes amigáveis.
11. Em A: "Sair de todos os outros dispositivos" → B, no próximo clique, vai para
    "Sessão encerrada"; A continua; aviso "Outras sessões encerradas" no sino.
12. Entrar de novo em B; em A, "Sair de todos os dispositivos" (digitar SAIR) →
    A vai para o login ("Você saiu de todos os dispositivos"); B cai no próximo clique.
13. "Sair deste dispositivo" em A → só A sai; B continua.
14. "Lembrar de mim" marcado em A, "Sair de todos" em B → reabrir A pede senha e código.
15. Trocar a senha em A → B cai; A continua; aviso "Sua senha foi alterada".
16. Suspender o usuário com A aberto → próximo clique em A vai para `/acesso`.
17. Nenhuma tela mostra IP, user agent completo, token ou id completo de sessão.
