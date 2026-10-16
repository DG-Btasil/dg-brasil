# Etapa 4.3.2 — Auth & Session Security Hardening — Relatório

## 1. Status

**AUTH & SESSION SECURITY READY FOR DEV VALIDATION**

Código, migration 038, testes do banco (PGlite) e unitários prontos e
passando. A migration **ainda não foi aplicada no Supabase DEV** e os testes
de integração e o `validar:real` novos **ainda não rodaram contra o DEV**
(as credenciais `supabase/.env.real` ficam na outra máquina). Comandos na
seção 19.

## 2. Modelo de sessão do Supabase

- Fonte de verdade: Supabase Auth. Uma sessão = uma linha de `auth.sessions`
  (`id`, `user_id`, `created_at`, `refreshed_at`, `not_after`, `aal`,
  `user_agent`, `ip`). O JWT de acesso carrega `session_id`, `aal`, `amr`.
- Nenhuma tabela paralela, nenhum UUID inventado, nenhum metadado auxiliar
  gravado: tudo é lido de `auth.sessions` por funções SECURITY DEFINER.
- `auth.sessions` continua **fora da Data API** (sem grant para
  `authenticated`/`anon`; conferido no verificador e no `validar:real`).
- Access token ~1 h; refresh token gira a cada renovação (já validado em 024).

## 3. Lista de sessões

`public.get_my_sessions()` (sem parâmetros): só `user_id = auth.uid()`, exige
sessão liberada (aal2, vínculo/escritório/perfil ativos, sessão válida),
filtra vencidas (`not_after`) e anteriores a reset de MFA. Devolve id, se é a
atual, criação, última renovação, `aal`, navegador, sistema e classe de
aparelho. O servidor converte em `AccountSessionDTO` — o navegador recebe só
um prefixo de 8 caracteres do id.

Tela: Configurações → **Sua conta e sessões** (ADMIN, LAWYER, ASSISTANT) e
Minha Conta → **Segurança da conta** (PARTNER_ADMIN, PARTNER_USER).

## 4. Metadados de dispositivo

O user agent é reduzido **dentro do banco** a famílias: navegador (Chrome,
Edge, Firefox, Safari, Opera, Samsung Internet), sistema (Windows, macOS,
Linux, ChromeOS, Android, iPhone, iPad) e classe (DESKTOP, MOBILE, TABLET).
Desconhecido → nulo → "Navegador desconhecido" (sem palpite). User agent cru,
versão exata e IP **não saem do banco**. Sem fingerprinting (nada de canvas,
fontes, hardware, geolocalização). O login acontece no navegador, então o
user agent é o do navegador real; sessões abertas pelo link de
convite/recuperação (`/auth/confirm`, no servidor) podem aparecer como
"Navegador desconhecido". "Última atividade" = `refreshed_at`, rotulada como
aproximada (o navegador renova ~1×/hora enquanto aberto).

## 5. Sessão atual

Determinada pelo `session_id` do **JWT verificado** (`private.jwt_session_id()`),
nunca comparando user agent. Marcada como "Este dispositivo" e listada primeiro.

## 6. Logout da sessão atual

"Sair" / "Sair deste dispositivo": `signOut({ scope: "local" })` — só esta
sessão (os outros dispositivos continuam), apaga cookies e `dg-lembrar`.
Com a sessão liberada, audita `SESSION_CURRENT_REVOKED` antes.

## 7. Logout das outras sessões

"Sair de todos os outros dispositivos": `signOut({ scope: "others" })` com o
JWT do usuário; esta continua. Audita `OTHER_SESSIONS_REVOKED`; aviso
"Outras sessões encerradas". Confirmação em diálogo.

## 8. Logout global

"Sair de todos os dispositivos": confirmação forte (digitar **SAIR**),
auditoria `ALL_SESSIONS_REVOKED` **antes** (o JWT ainda vale), depois
`signOut({ scope: "global" })`, apaga `dg-lembrar` e vai para
`/login?aviso=saiu-todos`. Aviso "Todas as sessões encerradas".

## 9. Revogação individual

**Não suportada.** O Supabase Auth não tem API oficial para revogar uma
sessão por id — `auth.admin.signOut(jwt, scope)` exige o JWT da própria
sessão. Não se apaga linha de `auth.sessions` nem refresh token na mão. A tela
não mostra botão por sessão; o caminho é "Sair de todos os outros
dispositivos".

**Access token já emitido:** revogar impede o refresh, e o JWT continuaria
assinado até expirar (~1 h). A 038 fecha isso no banco:
`private.current_membership()` (base de toda a RLS e dos helpers) exige que a
sessão do JWT exista, seja do usuário e não esteja vencida. O token antigo
deixa de ver ou gravar qualquer dado **na hora**; o servidor recebe
`session_state` e manda para "Sessão encerrada".

## 10. Lembrar de mim

Sem mudança: o cookie `dg-lembrar` só define a duração dos cookies. Login
novo é sempre senha + TOTP. "Sair de todos" também apaga a preferência; um
navegador com "Lembrar de mim" cuja sessão foi encerrada em outro lugar cai em
"Sessão encerrada" no próximo clique e, ao entrar de novo, pede senha e código.

## 11. MFA

Status na tela (aplicativo autenticador, nome e data de ativação; sem
segredo, sem "desativar"). Toda ação de conta exige `aal2`. **Step-up**
avaliado: as ações de sessão só **reduzem** acesso e não pedem código de
novo; ações futuras que ampliem risco podem exigir verificação recente pelo
`amr` do JWT, sem novo sistema de auth (documentado em `docs/auth.md`).

## 12. Suspensão

Já valia por requisição e agora está testado com sessão real: vínculo
suspenso, perfil inativo ou escritório suspenso → `get_my_session_context`
devolve o estado e a RLS (`current_membership`) não devolve nada — o próximo
clique vai para `/acesso`, com o JWT ainda válido. Login novo cai no mesmo
bloqueio. As linhas de `auth.sessions` ficam até expirar ou a pessoa sair, sem
dar acesso. Encerrar as sessões de outra pessoa pelo ADMIN (Admin API) ficou
documentado como possibilidade futura.

## 13. Reset de MFA

Endurecido: sessão criada **antes** do último `MFA_RESET_COMPLETED` do
usuário vira `REAUTH_REQUIRED` — sem dados, fora da lista, tela "Sessão
encerrada". Antes, uma sessão antiga `aal2` (talvez de quem ficou com o
celular) continuava e poderia cadastrar um autenticador novo. A pessoa entra
de novo (senha) e cadastra o novo fator. O fluxo do ADMIN não mudou.

## 14. Auditoria e notificações

| Ação | Evento | Aviso para a própria pessoa |
|---|---|---|
| Sair deste dispositivo | `SESSION_CURRENT_REVOKED` | — |
| Sair dos outros | `OTHER_SESSIONS_REVOKED` | "Outras sessões encerradas" |
| Sair de todos | `ALL_SESSIONS_REVOKED` | "Todas as sessões encerradas" |
| Senha alterada | `PASSWORD_CHANGED` | "Sua senha foi alterada" |
| MFA redefinido (ADMIN) | `MFA_RESET_COMPLETED` (já existia) | texto atualizado: sessões anteriores encerradas |

`record_account_security_event` aceita só essas quatro ações, com o
próprio usuário como autor e metadado só `aal` — nunca token, OTP, segredo,
senha, JWT ou id de outra sessão. Avisos na categoria Segurança (não
desliga), sem duplicar (`event_key`), sem aviso por renovação de token.
Troca de senha agora também encerra as **outras** sessões (esta continua).

## 15. Migration

`supabase/migrations/20261027000038_account_session_security.sql` — a única
desta etapa; 001–037 intactas. Conteúdo: trava de leitura de `auth.sessions`
(falha ao aplicar em vez de quebrar a RLS), `jwt_session_id`,
`jwt_session_state`, `current_membership` e `get_my_session_context`
redefinidas (mesmo corpo da 022 + sessão), parser de user agent,
`get_my_sessions`, `record_account_security_event`, gatilho de avisos de
segurança ampliado. Toda função SECURITY DEFINER com `search_path` vazio, sem
EXECUTE para `anon`; parser e gatilho fora do alcance de `authenticated`.

## 16. Service role

**Nenhum uso novo.** Listar e encerrar as próprias sessões usa o JWT do
usuário (`auth.signOut` com escopo + RPCs da 038). O inventário em
`docs/backend.md` segue igual (team-actions e Storage assinado).

## 17. Testes

| Suíte | Resultado (nesta máquina) |
|---|---|
| `supabase: npm run verificar` | **598/598** (+19: seções `[038]` — sessão revogada/vencida/forjada sem dados, reset de MFA, suspensão, lista só das próprias, parser, aal1 recusado, `auth.sessions` fechada, auditoria e avisos, catálogo) |
| `frontend: npm test` | **436/436** (+11: `security.test.ts` — DTO sem id/UA/IP/segredo, ordem auditoria → revogação, falha do Auth amigável, limite de taxa, `SESSION_REVOKED`) |
| `frontend: lint`, `tsc`, `build` | limpos |
| `frontend: test:integration` — `account-sessions.int.test.ts` (9 casos, conta própria com várias sessões reais) | **não executado** (sem `.env.real` aqui) |
| `supabase: validar:real` — seção 41d (5 verificações, inclusive custo < 2 ms) | **não executado** (idem) |

## 18. Limitações conhecidas

- Sem revogação de uma sessão específica (seção 9).
- "Última atividade" é a última renovação do token, não o último clique.
- Sessões criadas pela rota `/auth/confirm` podem aparecer sem navegador.
- Limite de taxa das ações de conta é em memória da instância (best-effort,
  como o de CPF/CNPJ).
- Linhas de `auth.sessions` de usuário suspenso ficam até expirar (sem acesso).
- Produção: configurar *Time-box user sessions* e *Inactivity timeout* no
  Supabase (plano Pro) continua pendente.
- O texto "Sessão encerrada" é o mesmo para revogação e reset de MFA (cita os
  dois motivos).

## 19. Comandos exatos de validação

Na máquina com `supabase/.env.real` (DEV, `DG_ENV=development`):

```bash
# 1. Aplicar a 038 no DEV
cd supabase
npx supabase db push

# 2. Banco local e Supabase real
npm run verificar
npm run validar:real            # inclui a seção 41d [038]

# 3. Front
cd ../apps/frontend
npm test && npm run lint && npx tsc --noEmit && npm run build
npx vitest run --config vitest.integration.config.mts tests/integration/account-sessions.int.test.ts
npm run test:integration        # suíte inteira (garante que nada mais quebrou)
```

QA manual: itens 10–17 de "QA manual" em `docs/auth.md` (dois navegadores,
sair dos outros / de todos / deste, Lembrar de mim, troca de senha,
suspensão, nada sensível na tela).

Se a 038 falhar no `db push` com erro de permissão em `auth.sessions`, nada
foi aplicado (trava no início da migration) — avisar antes de qualquer
contorno.

## 20. Próximo passo

Agents / worker / IA reais. **Não iniciado.**
