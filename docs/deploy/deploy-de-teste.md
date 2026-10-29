# Passo a passo: pôr no ar a versão de teste (Claude Code + Google Drive)

Pendências e riscos do deploy de 2026-10-29. Vale para a fase de **teste**:
Supabase DEV e dados fictícios. A produção está em [producao.md](producao.md).

## Onde estamos

| O quê | Situação |
|---|---|
| Site na Vercel | Ainda na versão `5609165` ("Favicon"), de **antes** da troca para o Claude Code. Os deploys seguintes foram recusados pelo agendamento do Drive a cada 15 minutos. |
| Correção | Agendamento do Drive passado para uma vez por dia (`apps/frontend/vercel.json`), no commit `fix(vercel): run Drive sync cron daily to fit the Hobby plan`. |
| Banco DEV | Ainda **sem** as migrations 040 (computador do escritório) e 041 (Google Drive). |
| Validação | O agente da outra máquina valida tudo no computador dele (`localhost`), **sem depender** da Vercel. |

**Quem faz cada passo:**
- **Você:** a Barbara;
- **Validador:** o agente da outra máquina;
- **Claude:** a sessão do Claude Code neste repositório.

## Passo 1: migrations no DEV (Validador)

Mande para o agente da outra máquina:

> Faça `git pull` e siga `docs/mcp/validacao.md` do começo ao fim. Avise assim
> que terminar a **Parte 1** (migrations 040 e 041 no DEV) e depois devolva o
> relatório no formato que o arquivo pede.

- A Parte 1 aplica a 040 e a 041 no DEV e confere o `pg_cron`.
- Assim que ele avisar que a Parte 1 passou, siga para o Passo 3. Ele continua as
  outras partes sozinho.

**Pode correr ao mesmo tempo que o Passo 2.**

## Passo 2: variáveis na Vercel (Você)

No projeto do DG Brasil na Vercel: **Settings → Environment Variables**,
ambiente **Production**. A variável só passa a valer no deploy seguinte, por isso
este passo vem antes do Passo 3.

| Variável | Valor | Para quê |
|---|---|---|
| `DG_WORKER_DB_URL` | O mesmo valor do `supabase/.env.real` da máquina do validador, que é o já testado | É como o servidor fala com o banco na API do computador do escritório e no Drive |
| `CRON_SECRET` | Um texto aleatório novo, com 32 caracteres ou mais | Senha da rodada agendada do Drive. A Vercel envia esse valor sozinha. |

Sobre o `DG_WORKER_DB_URL`:
- É o login `dg_worker` do DEV, pelo pooler:
  `postgresql://dg_worker.<ref>:<senha>@aws-1-sa-east-1.pooler.supabase.com:5432/postgres`.
- Se não quiser copiar da outra máquina, monte o endereço: no painel do Supabase,
  em **Connect → Session pooler**, troque o usuário por `dg_worker.<ref>` e use a
  senha do `dg_worker`.

Para gerar o `CRON_SECRET`, rode num terminal:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Cuidados:
- **Não** grave as variáveis do Google agora. Elas entram quando a credencial
  existir ([docs/mcp/google-drive.md](../mcp/google-drive.md)).
- As duas variáveis são **só do servidor**. Nunca com o prefixo `NEXT_PUBLIC_`.
- Não as cole em conversa, e-mail ou relatório.

## Passo 3: enviar ao GitHub (Você autoriza)

O commit da correção já está feito, mas ainda não foi para o GitHub. Ao enviar,
a Vercel faz o deploy sozinha.

- Diga ao Claude "pode fazer o push", ou rode `git push origin master`.
- **Faça depois do Passo 1.** O site novo precisa da 040 e da 041.
  - **Antes delas,** as telas Computador do escritório e Google Drive dão erro.
    Não estraga nada, mas confunde.
  - **No sentido contrário não há problema:** a versão antiga do site continua
    funcionando com o banco novo. A 040 e a 041 só acrescentam.

## Passo 4: conferir o deploy (Você, ou peça ao Claude)

Troque `<site>` pelo endereço do DG Brasil na Vercel.

1. **Vercel → Deployments:** o último deploy está **Ready**, com o commit `fix(vercel): …`.
2. **Vercel → Settings → Cron Jobs:** aparece `/api/cron/drive-sync` com `0 9 * * *`.
3. **No site, entre como ADMIN:**
   - **Configurações → Computador do escritório** abre e mostra que não há
     computador conectado. Isso prova que o site novo e a 040 estão no ar.
   - **Configurações → Integrações → Google Drive** mostra que o Drive não está
     configurado. É o esperado por enquanto.
4. **A rota agendada está protegida.** No PowerShell:

   ```powershell
   curl.exe -i https://<site>/api/cron/drive-sync
   ```

   Esperado: **401**. Com a senha:

   ```powershell
   curl.exe -i -H "Authorization: Bearer <CRON_SECRET>" https://<site>/api/cron/drive-sync
   ```

   Esperado: `{"skipped":"drive não configurado"}`.
5. **O servidor alcança o banco** (prova o `DG_WORKER_DB_URL`). Use um token de
   mentira, no formato certo:

   ```powershell
   curl.exe -i -H "Authorization: Bearer dgx_teste_que_nao_existe_000000" https://<site>/api/executor/v1/me
   ```

   | Resposta | O que significa |
   |---|---|
   | **403**, "Acesso do computador inválido ou revogado" | Certo: o banco foi consultado e recusou o token |
   | **500**, "Erro interno" | `DG_WORKER_DB_URL` faltando ou errada. Confira o Passo 2 e faça **Redeploy** na Vercel. |

## Passo 5: resto da validação (Validador)

- O agente termina as Partes 2 a 8 de [docs/mcp/validacao.md](../mcp/validacao.md)
  e grava o relatório em `docs/qa/mcp/`.
- A **Parte 6** precisa de uma pessoa no computador do escritório com o Claude
  Code aberto.
- A **Parte 7** (Google Drive) fica pendente até existir a credencial do Google.
- Com o relatório em mãos, peça ao Claude para corrigir o que ele apontar.

## Riscos desta fase

| Risco | O que acontece | O que fazer |
|---|---|---|
| Push antes das migrations (Passo 3 antes do 1) | Telas novas com erro até a 040 e a 041 entrarem no DEV | Seguir a ordem. Se acontecer, basta terminar o Passo 1. |
| `DG_WORKER_DB_URL` faltando ou errada | A API do computador do escritório e o Drive respondem "Erro interno". Nada é exposto. | Passo 4, item 5 |
| `CRON_SECRET` faltando | A rodada diária é recusada (401) e aparece como falha nos logs da Vercel. É seguro: a rota não roda sem a senha. | Passo 2 |
| Rodada do Drive uma vez por dia | Na hora marcada ou até 59 minutos depois; até 5 envios e 5 pastas por rodada | **Sincronizar agora** na ficha do cliente. A frequência volta na produção ([producao.md](producao.md), item 2). |
| Supabase DEV gratuito | Pausa depois de 1 semana sem uso. Pausado, nada roda, nem o `pg_cron`. | Painel do Supabase → **Restore project** |
| Vercel Hobby | Só uso pessoal, não comercial. Serve para teste. | Vercel Pro na produção ([producao.md](producao.md), item 1) |
| Dados reais | Nesta fase, **só dados fictícios** | Antes do primeiro cliente de verdade: [producao.md](producao.md), itens 7 e 9 |
