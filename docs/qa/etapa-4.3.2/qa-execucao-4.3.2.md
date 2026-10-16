# QA 4.3.2 — Execução (segurança de conta e sessões)

Guia: [`docs/etapa-4.3.2-validacoes.md`](../../etapa-4.3.2-validacoes.md). Supabase DEV, dados fictícios.
Código: `master` em `b7b366a` (merge de `origin/master` até `5ffb6f4` com o commit local `af752a4`).
Data: 2026-10-16.

## Resumo

| Parte | Status |
|---|---|
| 1 — Migration 038 | **PASS** |
| 2 — `verificar` / `validar:real` | **PASS** |
| 3 — Testes do front e integração | **PASS** (4 falhas de dados de teste na suíte completa, ver TEST-04) |
| 4.1 — Tela existe para todos | **PASS** |
| 4.2–4.10 — QA manual com dois navegadores | **PENDENTE**: exige logins da conta de teste por você (roteiro pronto; ver abaixo) |

## Parte 1 — Migration 038

`db push --dry-run` listou só `20261027000038_account_session_security`; `db push` aplicou sem erro
(sem o erro de permissão em `auth.sessions` previsto no guia).

## Parte 2

| Verificação | Esperado | Resultado |
|---|---|---|
| `npm run verificar` | 598 | **PASS**: "598 verificações, todas passaram." |
| `npm run validar:real` | todas (≈ +5) | **PASS**: 134/134 (antes 129), rodada `rmvb99xf1` |
| §41d (5 itens) | 5 ✓ | **PASS**: colunas de `auth.sessions` e leitura bloqueada para authenticated/anon; duas sessões reais (só dele, atual marcada, "Chrome/Windows" e "Safari/iPhone", sem user agent cru); sair dos outros (o JWT do celular perde o banco na hora); sair de todos (auditado antes, nenhuma sessão sobra); custo |
| Custo ("200 chamadas") | < 400 ms | **PASS**: **13,3 ms** |

## Parte 3

| Verificação | Esperado | Resultado |
|---|---|---|
| `npm test` | 436 | **PASS**: 39 arquivos, 436/436 |
| `lint`, `tsc --noEmit`, `build` | sem erro | **PASS** |
| `account-sessions.int.test.ts` | 9 | **PASS**: **10/10** (o arquivo tem 10 casos; o guia diz 9) |
| `test:integration` completo | 192 + novos | 198/202 na 1ª rodada. As 4 falhas (`cases.int`, `frontend-cases-processes.int`) foram todas "Cliente já cadastrado no sistema." ao criar o cliente fictício. **Reexecutados os 2 arquivos: 24/24 PASS.** Ver TEST-04. |

### TEST-04 — CPF de teste colide com clientes acumulados no DEV (teste instável)

`tests/integration/support/world.ts:16-20`: `fakeCpf()` parte de um aleatório em [0, 100.000) e soma 1,
gerando `999` + 8 dígitos sempre na faixa `99900000000–99900199999`. O DEV já tem **899 clientes** nessa
faixa (das rodadas anteriores), e a chance de colisão cresce a cada execução. Não é defeito da 4.3.2.
Sugestão: sortear o início em toda a faixa de 8 dígitos (ou incluir o `world.run` no CPF) e tratar
`DUPLICATE_CLIENT` com nova tentativa no helper.

## 4.1 — A tela existe para todos: PASS

| Papel | Onde | Conteúdo |
|---|---|---|
| ADMIN, LAWYER, ASSISTANT | Configurações → "Sua conta e sessões" | "Alterar senha"; "Verificação em duas etapas · Aplicativo autenticador (…), ativo desde …"; "Sessões e dispositivos" com "Este dispositivo"; aviso "Não guardamos IP nem identificamos o aparelho além do navegador e do sistema"; botões "Sair deste dispositivo" e "Sair de todos os outros dispositivos" |
| PARTNER_ADMIN, PARTNER_USER | Minha Conta → "Segurança da conta" (fim da página) | idem |

Nenhum IP, user agent cru, token ou id longo de sessão na tela. Capturas: `evidencias/432-4.1-*.png`
(em `../etapa-4.3/evidencias/fase-H/`).

**Observação:** sessões abertas **antes** da migration 038 aparecem como "Navegador desconhecido"
(esperado: o nome amigável depende de dados que a 038 passou a ler). As sessões novas devem mostrar
"Chrome no Windows" / "Edge no Windows": será conferido no 4.2.

## 4.2–4.10 — Pendente (precisa de você)

Roteiro automatizado pronto: janela **A = Chrome** e **B = Microsoft Edge**, conta
**`qa.assistente@dgbrasil.test`**. Uma faixa amarela no topo da janela diz o que fazer (login, "Lembrar de
mim", nova senha no 4.7, novo autenticador no 4.8). Cliques, verificações na tela e no banco e as ações de
ADMIN (redefinir MFA, suspender, reativar) são automáticas. A 1ª tentativa (16/10, 14:48) expirou às
15:00 sem login; nada foi alterado na conta.
