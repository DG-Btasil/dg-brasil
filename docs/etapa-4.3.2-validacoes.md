# Etapa 4.3.2 — Validações

Roteiro para validar a segurança de sessões na **máquina que tem o
`supabase/.env.real`** (Supabase DEV). Faça na ordem. Se algo falhar, pare e
cole a saída inteira na conversa.

Antes de começar, na pasta do projeto:

```bash
git pull
```

---

## Parte 1 — Aplicar a migration 038 no DEV

```bash
cd supabase
npx supabase db push
```

- [ ] Aparece a migration `20261027000038_account_session_security` e termina sem erro.

> Se der erro de **permissão em `auth.sessions`**: nada foi aplicado (a
> migration tem uma trava no início). Não tente contornar; cole o erro.

## Parte 2 — Testes automáticos do banco

Ainda na pasta `supabase`:

```bash
npm run verificar
```

- [ ] Final: **598 verificações, todas passaram.**

```bash
npm run validar:real
```

- [ ] Final: **todas passaram** (o total sobe uns 5 em relação à última vez).
- [ ] Na seção **41d. Sessões e dispositivos no Auth real [038]** aparecem 5 itens com ✓.
- [ ] No item de "custo", o tempo mostrado ("200 chamadas: X ms") fica abaixo de 400 ms.

## Parte 3 — Testes automáticos do front

```bash
cd ../apps/frontend
npm test
npm run lint
npx tsc --noEmit
npm run build
```

- [ ] `npm test`: **436 testes passaram**.
- [ ] `lint`, `tsc` e `build` terminam sem erro.

Teste novo de integração (sessões reais no DEV; demora alguns minutos por
causa dos códigos do autenticador):

```bash
npx vitest run --config vitest.integration.config.mts tests/integration/account-sessions.int.test.ts
```

- [ ] **9 testes passaram.**

Suíte de integração inteira (garante que nada antigo quebrou):

```bash
npm run test:integration
```

- [ ] Todos passaram (eram 192 + os 9 novos).

---

## Parte 4 — QA manual no navegador

Use **uma conta de teste** (ex.: uma das de `npm run usuarios:qa`) e **dois
navegadores diferentes**: A = Chrome, B = Edge ou Firefox (ou o celular).
Suba o front normalmente (`npm run dev` em `apps/frontend`).

### 4.1 — A tela existe para todos

- [ ] Equipe interna (ADMIN, LAWYER, ASSISTANT): **Configurações → "Sua conta e sessões"** aparece no menu da esquerda.
- [ ] Parceiro (PARTNER_ADMIN, PARTNER_USER): **Minha Conta → "Segurança da conta"** aparece no fim da página.
- [ ] Mostra: Senha ("Alterar senha"), Verificação em duas etapas ("Ativa", com a data) e "Sessões e dispositivos".

### 4.2 — Lista de sessões

Entre com a mesma conta em A e em B.

- [ ] Em A, a lista mostra as duas sessões.
- [ ] A sessão de A aparece primeiro, com a etiqueta **"Este dispositivo"**.
- [ ] Os nomes são amigáveis (ex.: "Chrome no Windows", "Edge no Windows", "Safari no iPhone").
- [ ] Nenhuma tela mostra IP, texto técnico do navegador ("Mozilla/5.0…"), token ou código longo de sessão.

### 4.3 — Sair dos outros dispositivos

- [ ] Em A: "Sair de todos os outros dispositivos" → abre confirmação → confirmar.
- [ ] Aparece "Outras sessões encerradas"; a lista em A fica só com "Este dispositivo".
- [ ] Em B, clicar em qualquer coisa → vai para a tela **"Sessão encerrada"**, com botão para sair e voltar ao login.
- [ ] A continua funcionando normalmente.
- [ ] O sino de A tem o aviso **"Outras sessões encerradas"**.

### 4.4 — Sair só deste dispositivo

Entre de novo em B.

- [ ] Em A: "Sair deste dispositivo" → A vai para o login ("Você saiu da sua conta").
- [ ] B continua funcionando.

### 4.5 — Sair de todos os dispositivos

Entre de novo em A (A e B abertos).

- [ ] Em A: "Sair de todos os dispositivos" → o botão de confirmar só libera depois de digitar **SAIR**.
- [ ] Confirmando: A vai para o login com a mensagem "Você saiu de todos os dispositivos…".
- [ ] Em B, o próximo clique vai para "Sessão encerrada".
- [ ] Ao entrar de novo, pede **senha e código** do autenticador.

### 4.6 — "Lembrar de mim"

- [ ] Em A, entrar com "Lembrar de mim" marcado. Em B, entrar e usar "Sair de todos os dispositivos".
- [ ] Fechar e reabrir o navegador A → **não entra direto**: pede senha e código.

### 4.7 — Troca de senha

Conta aberta em A e B.

- [ ] Em A: "Alterar senha" → definir nova senha → volta ao app, **A continua logado**.
- [ ] Em B, o próximo clique vai para "Sessão encerrada".
- [ ] O sino de A tem o aviso **"Sua senha foi alterada"**.
- [ ] Entrar em B com a senha **antiga** não funciona; com a nova funciona.

### 4.8 — Redefinição da verificação em duas etapas (ADMIN)

Conta de teste aberta em B; ADMIN logado em A (outra conta).

- [ ] ADMIN, em Configurações → Equipe: "Redefinir verificação em duas etapas" da conta de teste.
- [ ] Em B, o próximo clique vai para "Sessão encerrada".
- [ ] Entrando de novo em B: pede senha e depois **cadastrar um novo autenticador** (QR code).

### 4.9 — Suspensão

Conta de teste aberta em B; ADMIN em A.

- [ ] ADMIN suspende o usuário de teste.
- [ ] Em B, o próximo clique vai para a tela de **acesso bloqueado** ("Acesso não liberado").
- [ ] Tentar entrar de novo com a conta suspensa → também cai no bloqueio.
- [ ] ADMIN reativa → a conta volta a entrar normalmente.

### 4.10 — Auditoria (ADMIN)

- [ ] Em Configurações → Segurança e auditoria, aparecem os eventos das ações acima (sessões encerradas, senha alterada, MFA redefinido), com a própria pessoa como autora (exceto o MFA, que é o ADMIN).
- [ ] Nenhum evento mostra senha, código, token ou dado técnico de sessão.

---

## Ao terminar

- Tudo marcado: me avise ("4.3.2 validada") e eu fecho a etapa.
- Algo falhou: cole a saída do terminal ou descreva o passo (número do item,
  navegador, papel da conta) e, se possível, um print.
