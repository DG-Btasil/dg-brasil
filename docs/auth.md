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
| Proxy | `apps/frontend/src/proxy.ts` | Renova a sessão (cookies SSR), manda quem não tem sessão para `/login?next=` (saneado). **Não** decide papel |
| Sessão | `src/server/auth/session.ts` | `getCurrentSession()` (1×/requisição): `getUser` + AAL + fatores + `get_my_session_context()` → `evaluateSession` |
| Guards | `requireAppSession`, `requirePermission`, `requireInternalUser`, `requireAdmin`, `requireLawyerOrAdmin`, `requirePartnerUser`, `requirePartnerAdmin`, `authorizeAction` | Páginas redirecionam; Server Actions lançam `AuthorizationError` |
| Páginas | `src/components/layout/server-guards.tsx` | `RequirePermission` / `AudienceSwitch` **de servidor** (o conteúdo negado nem é enviado) |
| Permissões | `src/lib/permissions/index.ts` | Matriz central `can(role, permission)` (testada em `permissions.test.ts`) |
| Cliente | `src/features/auth/session-context.tsx` | `AuthProvider` com o recorte `ClientSession` que o servidor validou |

`evaluateSession` (função pura, `src/lib/auth/evaluate.ts`) decide o estado:

```
ANONYMOUS → /login
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
   `user_invitations.token_hash` via `create_invitation` (com o JWT de quem convida —
   o banco aplica: ADMIN convida qualquer papel no escritório certo; PARTNER_ADMIN
   só `PARTNER_*` no próprio; convite pendente anterior é revogado).
2. `admin.inviteUserByEmail` (ou link de recuperação, se o e-mail já existe no
   Auth) com `redirectTo = <host do papel>/auth/confirm?fluxo=convite&ref=<ref>`.
3. `/auth/confirm` valida o `token_hash` (`verifyOtp`) → `/primeiro-acesso?ref=`.
4. Nome + senha → `accept_invitation(sha256(ref))` (exige sessão do MESMO e-mail;
   idempotente; inválido/revogado/expirado/conflito → `/acesso?motivo=...`) →
   termos → cadastro do MFA → app. O 1º `PARTNER_ADMIN` ativa o parceiro `PENDING`.

Reenviar = novo convite (novo `ref`; o anterior é revogado). Cancelar = revogar.

**Recuperação** (`/recuperar-senha`): resposta sempre igual (não revela conta).
Link → `/auth/confirm?fluxo=recuperacao` → `/nova-senha`. Quem tem MFA verifica o
código antes (`/seguranca/verificar?retorno=senha`).

**MFA**: `/seguranca/mfa` (QR + chave manual, confirma com código) e
`/seguranca/verificar`. **Não existe "desativar MFA".** Celular perdido → ADMIN
usa "Redefinir verificação em duas etapas" (remove os fatores pela Admin API;
eventos `MFA_RESET_REQUESTED`/`MFA_RESET_COMPLETED` na auditoria; não vale para
si mesmo). No próximo acesso a pessoa cadastra um novo.

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
   (fluxo implícito) **não funcionam** com o login SSR.
6. **SMTP**: o SMTP padrão do Supabase só entrega para e-mails da equipe do
   projeto e tem limite baixo. Para testes use contas fictícias e o harness
   (`generateLink`). Produção exige SMTP próprio.
7. Validade do link do e-mail: *Email OTP expiration* (padrão 1 h). O convite em
   si vale 7 dias; se o link expirar, o administrador reenvia.

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
9. `/login?next=https://evil.com` → após login fica no app.
