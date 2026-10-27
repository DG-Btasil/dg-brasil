# QA 5 — Execução (Agents Runtime & Claude Integration)

Guia: [`docs/etapa-5-validacoes.md`](../../etapa-5-validacoes.md). Supabase DEV (`hcoi…db`), dados fictícios.
Código: `master` em `d137342` (igual a `origin/master`). Data: 2026-10-20.

## Resumo

| Parte | Status |
|---|---|
| 0 — Contas (Anthropic, Fly.io) | **PENDENTE**: ainda não há chave da Anthropic nem `flyctl` nesta máquina |
| 1 — Migration 039 | **PASS** |
| 2 — `verificar` | **PASS** (634/634) |
| 2 — `validar:real` | **PASS com ressalva**: com o `.env.real` como está, falha na seção 25–30 (`dg_worker` sem IPv6, ver ENV-01); com o `dg_worker` pelo pooler IPv4, **139/139** e 41e com 5 ✓ |
| 3 — Worker | **PASS** (typecheck limpo; 54/54) |
| 4 — `npm test` / `lint` / `tsc` | **PASS** (451/451; lint e tsc sem erro) |
| 4 — `build` | **PASS com ressalva**: falha no caminho com "Programação", compila no caminho só-ASCII (ver ENV-02) |
| 4 — `etapa5-dg-runtime.int.test.ts` | **PASS** (11/11) |
| 4 — `test:integration` completo | **PASS**: 27 arquivos, 213/213; sem "Cliente já cadastrado" (TEST-04 resolvido) |
| 5 — Smoke Claude real (pago) | **PENDENTE**: sem chave |
| 6.1 — Telas DG Brasil (ADMIN) | **PENDENTE**: sem login ADMIN |
| 6.1 — LAWYER não vê DG Brasil | **PASS** |
| 6.2–6.6 — Ponta a ponta (pago) | **PENDENTE**: sem chave e sem ADMIN |
| 7 — Fly.io DEV | **PENDENTE**: `flyctl` não instalado |
| 8 — Fechamento | **N/A**: a IA não foi ligada em nenhum momento (nem no processo, nem na tela) |

## Parte 1 — Migration 039

`db push --dry-run` listou só `20261028000039_agents_runtime.sql`; `db push --yes` aplicou sem erro
(`"migrations":["20261028000039_agents_runtime.sql"], "message":"Finished supabase db push."`).

## Parte 2

- `npm run verificar`: **"634 verificações, todas passaram."** (inclui "Catálogo: funções da Etapa 5 [039]").
- `npm run validar:real`: pré-flight confirma "todas as migrations do repositório aplicadas, e nenhuma a mais" (39).
  Seções 1–31/32 todas ✓. Na seção **25–30 (Worker real)**:

  ```
  ✗ dg_worker conecta pelo método de produção (dois clientes)
    connect ETIMEDOUT 2600:1f1e:90b:a700:eda7:1bbb:b7af:a729:5432
  ✗ dg_worker sem SELECT em dado de cliente, financeiro, auditoria, usuários
    Connection terminated unexpectedly
  ```

### ENV-01 — `DG_WORKER_DB_URL` usa o host direto (só IPv6)

O host direto `db.<ref>.supabase.co` resolve só para IPv6, e esta rede não tem rota IPv6 (timeout).
**Confirmado:** rodada repetida com `DG_WORKER_DB_URL` trocada só em memória (o `.env.real` não foi alterado)
para o **pooler de sessão** IPv4 (`dg_worker.<ref>@aws-1-sa-east-1.pooler.supabase.com:5432`):
**"139 verificações reais, todas passaram." (rodada `rmvgyva7v`)**. Seção 25–30 inteira ✓ (conexão de produção,
sem SELECT em dado sensível, claim simultâneo, heartbeat/set_vt, escopo, idempotência).

**41e — 5 ✓:**

```
✓ interruptor geral: nasce/fica DESLIGADO; ADMIN liga e desliga pelo PostgREST; LAWYER não
✓ bucket skill-files privado; navegador não envia direto; o servidor assina e o envio funciona
✓ ADMIN salva agente pela RPC atômica (versão + configuração); configuração com shell é recusada
✓ dg_worker (login de produção): lê o interruptor e arquivos de skill; não lê resultado de análise
✓ detalhe da execução: LAWYER vê sem uso/custo/configuração; ADMIN vê
```

Sugestão: usar o pooler de sessão em `DG_WORKER_DB_URL` (no `.env.real` e no `apps/agentes/.env`) em redes sem IPv6.
Para a Parte 7, o Fly.io tem IPv6 e aceita os dois formatos; o pooler é o mais seguro.

## Parte 3 — Worker

`npm run typecheck` sem erro; `npm test`: **54 passed (54)**.

## Parte 4 — Front

| Verificação | Esperado | Resultado |
|---|---|---|
| `npm test` | 451 | **PASS**: 40 arquivos, 451/451 |
| `lint`, `tsc --noEmit` | sem erro | **PASS** |
| `build` | sem erro | ver ENV-02 |
| `etapa5-dg-runtime.int.test.ts` | 11 | **PASS**: 11/11 |
| `test:integration` | todos | **PASS**: 27 arquivos, **213/213**, sem TEST-04 |

### ENV-02 — `next build` (Turbopack) falha no caminho com acento

No caminho `…\Programação\…\apps\frontend`, o build quebra com 24 erros iguais:

```
Error: Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'
Error while looking up import map: next/font/google queries have exactly one entry
```

A rede para `fonts.gstatic.com` funciona. A mesma árvore copiada para um caminho só-ASCII (scratchpad), com
`npm ci` próprio, compila: **"✓ Compiled successfully in 9.5s"**, `build=0`. Conclusão: bug do Turbopack com
caracteres não-ASCII no caminho, não defeito da Etapa 5. Contorno: clonar o repositório num caminho sem acento.

## Parte 6 — Telas

O app foi servido em `http://localhost:3100` a partir da cópia só-ASCII (mesmo `.env.local`, DEV).
Login do `qa.advogado@dgbrasil.test` (LAWYER) com senha + código do autenticador digitado pelo Miguel: **OK**.

**LAWYER não vê a área DG Brasil — PASS:**
- o menu principal só tem `/home /clientes /casos /processos /revisoes /parceiros /configuracoes` (nenhum link `/dg-brasil`);
- acesso direto a `/dg-brasil` e `/dg-brasil/execucoes` → "Acesso restrito · Seu perfil não tem permissão para acessar esta área."

## Roteiro do que falta (para você fazer depois)

1. **Chave da Anthropic** (Parte 0): Console → workspace "DG Brasil DEV" → chave → limite mensal (US$ 20).
   Crie `apps/agentes/.env` com os valores do guia (Parte 0).
2. **Parte 5**: `AI_SMOKE_CONFIRMO=sim` no `.env`, `npm run test:ai:real` em `apps/agentes`, anote custo e
   `SMOKE_SKILL_ID`, remova a linha.
3. **Parte 6**: login ADMIN (Barbara) + `qa.advogado` (com o código do autenticador); siga 6.1–6.6 do guia.
4. **Parte 7**: instale o `flyctl`, `fly auth login`, siga o guia.
5. **Parte 8**: IA desligada na tela e no `.env`/Fly; sem execução `QUEUED`/`RUNNING`; anote o custo.

## Custo

US$ 0,00 — nenhuma chamada paga foi feita.
