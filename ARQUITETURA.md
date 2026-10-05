# DG Brasil — arquitetura

Sistema interno da Barbara Cardoso Advocacia: CRM próprio + motor de agentes de IA
na nuvem, acessado pela equipe pelo navegador.

Substitui a ADVBOX ao final da migração. Não é produto para venda: um escritório,
uma base, autenticação simples.

## As três camadas

```
┌──────────────────────────────────────────────────────────┐
│  PAINEL (Next.js)                                        │
│  A equipe trabalha aqui: contatos, casos, prazos,        │
│  documentos, WhatsApp e — o centro de tudo — a           │
│  FILA DE APROVAÇÃO do que os agentes propuseram.         │
└───────────────────────────┬──────────────────────────────┘
                            │ SQL + Storage
┌───────────────────────────▼──────────────────────────────┐
│  BANCO (Postgres/Supabase, São Paulo)                    │
│  Fonte da verdade do escritório. A fila (pgmq)           │
│  `agent_execution` leva só o id de `agent_runs`.         │
└───────────────────────────▲──────────────────────────────┘
                            │ claim / update
┌───────────────────────────┴──────────────────────────────┐
│  MOTOR DE AGENTES (worker Node, Claude Agent SDK)        │
│  Processo longo, fora do serverless. Lê a fila,          │
│  roda o agente com ferramentas restritas, grava          │
│  PROPOSTAS e MINUTAS em revisão — não fatos consumados.  │
└──────────────────────────────────────────────────────────┘
```

## A decisão que define o sistema: agente propõe, humano confirma

Nenhum agente escreve direto no que é irreversível — petição protocolada,
documento enviado ao cliente, prazo fechado, dinheiro lançado.

O agente grava uma linha em `agent_proposals`, com uma revisão pendente em
`reviews`. Ela aparece em Revisões com o resumo e o payload. Um advogado aprova
ou rejeita. Só a aprovação aplica o efeito, e o banco recusa aprovar proposta
sem revisão humana aprovada. Minuta de peça segue o mesmo caminho como versão
INTERNA de documento: a aprovação vale para aquela versão, não para a próxima.

Isso não é excesso de zelo. É o desenho que já funciona no agente Lucas ("audita
antes de gerar") e é o que torna defensável usar IA sobre dados de idosos
vulneráveis: existe sempre um advogado responsável no registro.

Na V1 não há aprovação automática: toda proposta passa por revisão humana
("IA executa. Humano decide."). Se um dia fizer sentido aprovar sozinho algo
reversível, isso entra como regra explícita no banco, não como atalho no worker.

## Stack escolhida (você pediu que eu decidisse)

| Camada | Escolha | Por quê |
|---|---|---|
| Banco, arquivos, login | **Supabase Pro, região São Paulo (sa-east-1)** | Postgres de verdade (o domínio é relacional: caso→processo→prazo). RLS nativa dá permissão por papel sem código. Storage para PDFs com o mesmo login. Dado de cliente não sai do Brasil. |
| Painel | **Next.js 16 na Vercel, região gru1** | Você já escreve Next.js — o `esteira-consignado` está em produção de fato. Zero infra para manter. |
| Motor de agentes | **Worker Node no Fly.io, região gru** | Gerar uma petição leva minutos; função serverless morre no timeout. Worker é processo contínuo, com retry e log. Fly tem São Paulo. |
| Fila | **Supabase Queues (pgmq), fila `agent_execution`** | Fila dentro do próprio Postgres: sem Redis nem SQS. Mensagem lida fica invisível e reaparece se o worker morrer. O registro auditável continua em `agent_runs`. |

**Custo estimado:** Supabase Pro US$25 + Vercel Pro US$20 + Fly ~US$10 ≈ **US$55/mês (~R$ 300)**,
mais o consumo da API da Anthropic, que varia com o volume de peças.

**Alternativa mais barata, se o orçamento apertar:** tudo numa VPS Hetzner com
Coolify (~R$ 150/mês, Postgres e worker no mesmo host). Troca dinheiro por
alguém que cuide de backup e atualização de servidor. Não recomendo começar por
aí — recomendo migrar para lá depois, se fizer sentido.

## Reaproveitamento do que já existe

| O que você já tem | Entra como |
|---|---|
| `esteira-consignado/src/dominio/*` | `packages/dominio` — o motor de classificação puro, com os 41 testes, vira biblioteca compartilhada entre painel e worker. Não se reescreve. |
| `esteira-consignado/src/hiscon/importar.ts` | Importador do extrato, chamado pelo worker |
| Agente `lucas.md` | Primeiro agente do motor (`agente.slug = 'lucas'`) |
| Skills de petição/réplica | Prompt e roteiro dos agentes de peça |
| Conector ADVBOX (MCP) | Ferramenta de **leitura** do worker durante a migração |
| ChatJuridico | Ponte de WhatsApp na fase 4 |

## O que NÃO vamos construir

Anotado para não virar escopo por acidente:

- Multi-tenant, planos, cobrança — é uso interno, decisão sua.
- App móvel — o painel é responsivo, basta.
- Motor de assinatura eletrônica própria — integra ZapSign/Docusign.
- Captura própria de DJEN — usa o conector de publicações que já existe.
