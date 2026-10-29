# DG Brasil — arquitetura

Sistema interno da Barbara Cardoso Advocacia: CRM próprio + fila de trabalhos para
os agentes de IA do escritório, acessado pela equipe e pelos escritórios parceiros
pelo navegador. Os agentes rodam no Claude Code do computador do escritório
(desde 2026-10-29; antes era um worker na nuvem — ver docs/mcp/).

Não é produto para venda nem SaaS multi-tenant: uma organização proprietária
(OWNER), escritórios parceiros (PARTNER) subordinados ao ecossistema, uma base,
Supabase Auth.

## As três camadas

```
┌──────────────────────────────────────────────────────────┐
│  PAINEL (Next.js, Vercel)                                │
│  A equipe trabalha aqui: contatos, casos, prazos,        │
│  documentos e — o centro de tudo — REVISÕES, a fila de   │
│  aprovação do que os agentes entregaram. Também expõe    │
│  /api/executor/v1 ao computador do escritório e          │
│  sincroniza o Google Drive (servidor).                   │
└───────────────────────────┬──────────────────────────────┘
                            │ SQL (JWT do usuário / dg_worker) + Storage
┌───────────────────────────▼──────────────────────────────┐
│  BANCO (Postgres/Supabase, São Paulo)                    │
│  Fonte da verdade do escritório. RLS por papel, gate     │
│  humano, ledger financeiro, auditoria por ator. Fila     │
│  (pgmq) agent_execution; manutenção no pg_cron.          │
└───────────────────────────▲──────────────────────────────┘
                            │ HTTPS (token do computador + token de reserva)
┌───────────────────────────┴──────────────────────────────┐
│  COMPUTADOR DO ESCRITÓRIO (Claude Code + MCP local)      │
│  Alguém abre o Claude Code e manda processar a fila. O   │
│  MCP "dg-brasil" (apps/executor) tem catálogo fechado:   │
│  ler o caso reservado, baixar documentos (checksum),     │
│  entregar ANÁLISE, MINUTA e PROPOSTA — tudo em revisão,  │
│  nada consumado. Agentes e skills ficam no Claude Code.  │
└──────────────────────────────────────────────────────────┘
```

## Backend de domínio (Etapa 4.2)

Dentro do próprio Next.js, sem segundo servidor: Server Action (sessão aal2 +
permissão + Zod) → service (regra e autorização contextual) → repository
(queries/RPCs com o JWT do usuário) → Postgres (RLS e funções como segunda
barreira). Operações compostas são funções transacionais no banco; a service
role só assina URLs do Storage que o banco autorizou e atende à Admin API do
Auth. Detalhes em [docs/backend.md](docs/backend.md).

## Identidade e acesso (Etapa 4.1)

Supabase Auth (convite, senha, MFA TOTP obrigatório). O proxy do Next só renova a
sessão; quem decide é o servidor (`getCurrentSession` lê papel, vínculo, escritório e
termos do banco a cada requisição) e, por baixo, a RLS — que desde a migration 022
exige sessão `aal2`. O navegador nunca é fonte de papel. Detalhes em
[docs/auth.md](docs/auth.md).

## A decisão que define o sistema: agente propõe, humano confirma

Nenhum agente escreve direto no que é irreversível — petição protocolada,
documento enviado ao cliente, prazo fechado, dinheiro lançado.

O agente grava uma linha em `agent_proposals`, com uma revisão pendente em
`reviews`. Ela aparece em Revisões com o resumo e o payload. Um advogado aprova
ou rejeita — e só pela operação `decide_review`: o status de uma revisão não muda
por UPDATE direto, nem para a service role. Só a aprovação aplica o efeito, e o
banco recusa aprovar proposta sem revisão humana aprovada. Proposta que muda a
configuração do próprio DG Brasil (agente, skill) só ADMIN aprova. Minuta de peça
segue o mesmo caminho como versão INTERNA de documento: a aprovação vale para
aquela versão, não para a próxima.

Isso não é excesso de zelo. É o desenho que já funciona no agente Lucas ("audita
antes de gerar") e é o que torna defensável usar IA sobre dados de idosos
vulneráveis: existe sempre um advogado responsável no registro.

Na V1 não há aprovação automática: toda proposta passa por revisão humana
("IA executa. Humano decide."). Se um dia fizer sentido aprovar sozinho algo
reversível, isso entra como regra explícita no banco, não como atalho no executor.

## Stack escolhida (você pediu que eu decidisse)

| Camada | Escolha | Por quê |
|---|---|---|
| Banco, arquivos, login | **Supabase Pro, região São Paulo (sa-east-1)** | Postgres de verdade (o domínio é relacional: cliente→caso→processo→prazo). RLS nativa dá permissão por papel. Storage privado para PDFs com o mesmo login. Dado de cliente não sai do Brasil. |
| Painel | **Next.js 16 na Vercel, região gru1** | Você já escreve Next.js — o `esteira-consignado` está em produção de fato. Zero infra para manter. |
| Execução dos agentes | **Claude Code do computador do escritório + MCP local** (2026-10-29) | Os agentes e skills do escritório já funcionam lá (Python, Word, pastas). Modo assistido: uma pessoa abre o Claude Code e processa a fila, dentro do uso normal da assinatura. Substituiu o worker no Fly.io, que nunca chegou a rodar. Ver docs/mcp/relatorio-diagnostico.md. |
| Fila | **Supabase Queues (pgmq), fila `agent_execution`** | Fila dentro do próprio Postgres: sem Redis nem SQS. Reserva atômica da execução e batimento que estende a invisibilidade: execução longa não roda em dobro, computador que parou de responder devolve o trabalho à fila. O registro auditável continua em `agent_runs`. |

**Custo estimado:** Supabase Pro US$25 + Vercel Pro US$20 ≈ **US$45/mês**, sem servidor de agentes.
O modo assistido usa a assinatura do Claude que o escritório já tem; um modo
automático (sem ninguém iniciando) exigiria chave de API da Anthropic, paga por uso.

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
| ChatJuridico | Ponte de WhatsApp na fase 4 |

## O que NÃO vamos construir

Anotado para não virar escopo por acidente:

- Multi-tenant, planos, cobrança SaaS, signup público — é uso interno, decisão sua.
- Integração, espelho ou importador de sistema de terceiros específico — a
  importação é genérica (CSV/XLSX), sem campo de fornecedor no schema.
- App móvel — o painel é responsivo, basta.
- Motor de assinatura eletrônica própria — integra ZapSign/Docusign.
- Captura própria de DJEN — usa o conector de publicações que já existe.
