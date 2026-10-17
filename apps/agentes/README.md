# Worker de agentes (`apps/agentes`)

Processo contínuo que executa os agentes **cadastrados** na área DG Brasil.
Nenhum agente é programado aqui: o worker lê a configuração do banco e executa
dentro das mesmas regras para todos.

```
fila (pgmq) → reserva atômica → contexto da execução (só o caso dela)
  → skills no provedor (Skills API, versão fixada)
  → Claude API (loop com ferramentas do catálogo + ambiente isolado)
  → entregas em Revisões (proposta, minuta, resultado de análise)
  → fim da execução (WAITING_HUMAN / COMPLETED / FAILED / CANCELLED)
```

| Arquivo | Papel |
|---|---|
| `src/index.ts` | Laço, vagas de execução (`WORKER_CONCURRENCY`), interruptor, saúde, desligamento gracioso |
| `src/fila.ts` | Reserva, batimento, interrupção, novas tentativas, encerramento |
| `src/provedor/tipos.ts` | Contrato `AIProvider` (o domínio não conhece a Anthropic) |
| `src/provedor/anthropic.ts` | `ClaudeApiProvider`: Claude API oficial (`@anthropic-ai/sdk`) |
| `src/provedor/falso.ts` | `ProvedorFalso`: determinístico, para os testes |
| `src/ferramentas.ts` | Catálogo de ferramentas (a barreira real) |
| `src/prompt.ts` | Composição das instruções (versão + hash) |
| `src/carregar.ts` | Agente, skills e envio das skills ao provedor |
| `src/analise.ts` | Contrato do resultado estruturado de análise |
| `src/config.ts` / `erros.ts` / `log.ts` | Configuração central, categorias de erro, log sem conteúdo |
| `src/smoke-real.ts` | Teste PAGO contra o provedor real (opcional) |

## Rodar

```bash
cp ../../.env.example .env    # preencha; AI_EXECUTION_ENABLED fica false até testar
npm install
npm run typecheck
npm test                      # provedor falso + banco real em PGlite (sem custo)
npm run dev                   # worker local (lê o .env desta pasta)
```

Para executar IA de verdade, as **duas** chaves precisam estar ligadas:
`AI_EXECUTION_ENABLED=true` no processo **e** o interruptor do ADMIN em
Configurações → IA. Com qualquer uma desligada, as execuções ficam na fila.

## Teste contra o provedor real (pago)

```bash
# no .env (ou no ambiente): ANTHROPIC_API_KEY=... e AI_SMOKE_CONFIRMO=sim
npm run test:ai:real
```

Só dados fictícios; modelo padrão `claude-haiku-5-5` (`SMOKE_MODEL` muda).

## Fly.io (DEV)

`Dockerfile` (imagem mínima, usuário sem privilégio, sem segredo) e `fly.toml`
(app `dg-brasil-worker-dev`, região `gru`, uma máquina, sem porta pública,
verificação em `/health`). Segredos só por `fly secrets`. Passo a passo em
[docs/etapa-5-validacoes.md](../../docs/etapa-5-validacoes.md).
