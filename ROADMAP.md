# Roadmap — DG Brasil

Etapas em ordem. Cada uma entrega algo verificável e nenhuma depende de a
seguinte existir. Nenhuma etapa começa sem autorização da anterior.

---

### Etapa 0–2 — Fundação e front-end V1 ✅

- Repositório, arquitetura, front-end V1 navegável (dados fictícios):
  escritório proprietário, portal do parceiro, Client → LegalCase → LegalProcess,
  Revisões, DG Brasil.
- Motor de agentes: fila, executor com Claude Agent SDK, ferramentas, aplicador.

### Etapa 3.1–3.2 — Banco V1 auditado e consolidado ✅

- 19 migrations (`supabase/migrations`), 248 verificações em Postgres real (PGlite).
- Gate humano fechado no banco, máquina de estados do caso, histórico de
  parceria, ledger financeiro, verificação de documento por versão, pedido de
  execução controlado, `dg_worker` sem bypass de RLS, reserva e batimento na
  fila, idempotência de propostas, auditoria por ator, acesso LGPD, importação
  genérica CSV/XLSX.
- Worker migrado (29 testes como `dg_worker`); contratos do front alinhados.

---

### Etapa 3.3 — Validação em Supabase real (desenvolvimento) ✅

Projeto Supabase de desenvolvimento em São Paulo, `db push`, e conferência do
que o PGlite não cobre: Auth (trigger em `auth.users`, JWT real nas RPCs),
Storage (políticas, signed URLs, buckets privados), pgmq real (grants do
`dg_worker` nas tabelas da fila), login do `dg_worker` direto e pelo pooler.

**Você ganha:** a certeza de que o banco funciona onde vai rodar, antes de
qualquer dado real.

---

### Etapa 4 — Auth e backend

- **4.1 ✅ (código pronto; validar no Supabase DEV)** — Login com Supabase Auth,
  convites (token de uso único com expiração), aceite dos termos, MFA TOTP
  obrigatório, sessão e autorização no servidor, gestão de equipe. Ver
  [docs/auth.md](docs/auth.md).
- **4.2 ✅ (validado no Supabase DEV: 107 testes de integração, 2026-10-13)** — Backend de domínio no
  Next.js: Server Actions → services → repositories, com o JWT do usuário (RLS
  como segunda barreira), Zod, erros normalizados, paginação, DTO por
  superfície, correlation ID na auditoria; Storage por signed URL autorizada
  pelo banco. Migrations 025–026. Ver [docs/backend.md](docs/backend.md).
- **4.2.1** — hardening antes da 4.3: idempotência genérica na criação de caso
  e processo, divisão do próprio escritório para o administrador do parceiro,
  rate limit best-effort na aplicação para CPF/CNPJ do parceiro (migration 027).
- **4.3** — telas trocam os mocks pelas Server Actions, domínio a domínio
  (andamento em `docs/frontend-integration.md`; Fases A — diretório e Clientes — B — Casos, Processos, Prazos, Movimentações —, C — Documentos e Pendências —, D — Parceiros, Solicitações e Portal do Parceiro —, E — Revisões e Análises, com a migration 029 —, F — Financeiro, com a migration 030 —, G — Execuções de agente, com a migration 031 — e H — Notificações, Auditoria e Início — concluídas; validadas no DEV e no QA manual de 2026-10-15, com correções em `56a76b8` e a migration 032).
- **4.3.1** — restauração de funcionalidades com backend real (migrations
  033–037): produtor de notificações e preferências, edição manual na
  revisão (versão N+1), interromper análise/execução, cronograma de parcelas,
  valores da parceria (só leitura), "contratado por modelo", histórico do
  caso e contagens por cliente no portal. Validada no DEV e no QA manual
  (2026-10-16); resumo em `docs/etapa-4.3-resumo.md`.
- **4.3.2 — Auth & Session Security Hardening (código pronto; validar no
  DEV)** — migration 038: sessão revogada perde o banco na hora (RLS confere
  o `session_id` do JWT em `auth.sessions`), reset de MFA força novo login,
  lista das próprias sessões com navegador/sistema amigáveis (sem user agent
  cru nem IP), sair deste / dos outros / de todos os dispositivos, troca de
  senha encerra as outras sessões, auditoria e avisos de segurança. Encerrar
  uma sessão específica não é suportado pelo Supabase (documentado). Ver
  [docs/auth.md](docs/auth.md) e `docs/etapa-4.3.2-relatorio.md`. Próxima:
  Agents/worker/IA reais — não iniciada.

### Etapa 5 — Front-end conectado

`repositories/api` no lugar dos mocks, usando os mapeamentos de
`src/repositories/api/db-mappings.ts`. A equipe começa a usar com dados reais.

### Etapa 6 — Primeiro agente na nuvem

- Deploy do worker no Fly.io (região gru), conectado como `dg_worker`.
- Primeiro agente em produção, com a fila de Revisões como tela central.
- Despachante de gatilhos (horário/evento) chamando `request_agent_run`.

### Etapa 7 — Importação

Parser CSV/XLSX no backend sobre o schema já pronto: colunas → mapeamento →
validação → dry-run → conflitos → confirmação → processamento → relatório.

### Etapa 8 — Integrações judiciais e prazos

Monitoramento por OAB (DJEN/DataJud), movimentações com deduplicação, agente que
propõe prazos — sempre para revisão humana.

### Etapa 9 — Domínio consignado

Benefício INSS, extrato HISCON, contratos e a esteira de classificação
(`packages/dominio`), como migrations `020+`, depois de especificados.

---

## Onde o risco realmente mora

Não é no código — é no **prazo**. Enquanto prazos ainda forem controlados também
fora do DG Brasil, cada prazo aberto aqui deve ser conferido em dupla. Só quando
a conferência bater item a item por um ciclo completo o DG Brasil vira a fonte
única. Se a conferência não bater, a resposta certa é adiar, não explicar a
diferença.
