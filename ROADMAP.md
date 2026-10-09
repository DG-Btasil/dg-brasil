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
- Next.js server-side chamando as RPCs (`decide_review`, `request_agent_run`,
  `change_case_origin`...) com o JWT do usuário; service role só onde o contrato
  manda.
- Upload/download por signed URL, com registro de acesso a dado pessoal.

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
