# Etapa 4.3 — Guia único de validação (Fases A–H)

Valida de uma vez tudo o que foi feito na 4.3: Front V1 ligado ao backend
real, migrations **028, 029, 030 e 031** e os testes novos. Tudo no
**Supabase DEV**, com dados **fictícios** (`@dgbrasil.test`, CPF `999…`).
Nunca em produção.

Commits da etapa (em `master`): `bc308f9` (A), `1501505` (028), `a36360e`,
`9779f41` (B), `5ac5647` (C), `cfe100b` (D1), `373cfbb` (D2), `bf6d974`
(E, 029), `30df2c5` (F, 030), `f0d49e6` (G, 031), `e34a681` (H).

> **Antes de tudo: deixe o worker de agentes PARADO** (`apps/agentes`) durante
> toda a validação. As Fases E e G enfileiram execuções de agente de verdade;
> com o worker ligado elas chamariam a IA. Nesta etapa nada deve executar IA.

---

## 1. Atualizar o código

```bash
git pull origin master
cd supabase && npm install
cd ../apps/frontend && npm install
```

## 2. Verificações locais (sem banco real)

```bash
# Banco simulado (PGlite) — esperado: "481 verificações, todas passaram."
cd supabase
npm run verificar

# Front — esperado: lint sem erros, typecheck limpo, 388 testes, build ok
cd ../apps/frontend
npm run lint
npm run typecheck   # gera os tipos de rota (next typegen) e roda o tsc
npm test
npm run build
```

Cole aqui a última linha do `verificar`, o resumo do `npm test` e o fim do
`build`.

## 3. Migrations no Supabase DEV

```bash
cd supabase
npx supabase migration list      # 028, 029, 030 e 031 devem aparecer só em "Local"
npx supabase db push             # aplica as quatro, em ordem
npx supabase migration list      # agora as quatro também em "Remote"
```

| Migration | Fase | O que faz |
|---|---|---|
| `20261017000028_company_people_replace` | A | edição atômica de representantes e sócios de PJ |
| `20261018000029_atomic_analysis_start` | E | criar/enviar análise ao agente numa transação, idempotente |
| `20261019000030_financial_agreement_lifecycle` | F | ciclo de vida do acordo financeiro garantido no banco |
| `20261020000031_agent_run_summaries_page` | G | resumos de execução de agente paginados e filtráveis |

Nenhuma migration antiga foi alterada. Se o `db push` falhar, **pare** e me
mande a saída inteira.

## 4. Validação real (Auth, PostgREST, Storage, filas)

```bash
cd supabase
npm run validar:real
```

## 5. Testes de integração (Supabase DEV)

```bash
cd apps/frontend
npm run test:integration
```

Esperado: todos passam (≈172 casos em 20 arquivos). Novos nesta etapa:

- `frontend-clients`, `company-people` (A), `frontend-cases-processes` (B),
  `frontend-documents` (C);
- `frontend-analyses` (E — análise + execução numa transação, idempotência,
  corrida, falha sem resto gravado);
- `frontend-finance` (F — ciclo de vida pelo service **e direto no banco**);
- `frontend-agent-runs` (G — paginação, filtros, isolamento);
- `frontend-phase-h` (H — filtro de prazo, resumo, auditoria por registro).

Os testes criam agentes/templates **fictícios** pela service role só no setup
e cancelam as execuções enfileiradas ao final de cada teste.

## 6. Preparação para o QA manual

### 6.1 Usuários para o QA

Os usuários das rodadas automáticas têm senha aleatória que nunca é gravada
(não dá para recuperar). Para o QA, crie um conjunto fixo, com uma senha que
você escolhe (mesma regra do app: mínimo 8 caracteres, com maiúscula, minúscula e número):

```powershell
cd supabase
$env:QA_SENHA = 'sua-senha-de-teste'
npm run usuarios:qa
```

| Usuário | Papel | Escritório |
|---|---|---|
| o seu ADMIN (`adm@dgbrasil.com`) | ADMIN | escritório proprietário |
| `qa.advogado@dgbrasil.test` | LAWYER | escritório proprietário |
| `qa.assistente@dgbrasil.test` | ASSISTANT | escritório proprietário |
| `qa.parceiro-a.admin@dgbrasil.test` | PARTNER_ADMIN | Parceiro QA A |
| `qa.parceiro-a.usuario@dgbrasil.test` | PARTNER_USER | Parceiro QA A |
| `qa.parceiro-b.admin@dgbrasil.test` | PARTNER_ADMIN | Parceiro QA B |
| `qa.parceiro-b.usuario@dgbrasil.test` | PARTNER_USER | Parceiro QA B |

No primeiro login de cada um o app pede os termos e o cadastro do MFA (QR
code no autenticador), como para um usuário de verdade. Rodar o comando de
novo só redefine a senha. Os outros escritórios "Parceiro A/B …" e usuários
`r…`/`i…@dgbrasil.test` são das rodadas automáticas: ignore-os no QA.

### 6.2 Agente e modelo de análise fictícios (para a Fase E)

O modelo "Análise Bancária" do seed **não tem agente** (de propósito: dá para
testar "criar sem enviar"). Para testar o envio, rode **só este bloco** no SQL
Editor do DEV **antes** do QA. "Success. No rows returned" é o normal.

```sql
-- ANTES do QA. Agente FICTÍCIO (não executa nada enquanto o worker estiver parado).
-- Três comandos separados: numa CTE única o UPDATE não enxerga a versão
-- inserida no mesmo comando (QA 4.3, BUG-03).
insert into public.agents (slug, name, description, status)
values ('qa-analise-43', 'Agente QA 4.3', 'Fictício — não executar', 'DRAFT')
on conflict (slug) do nothing;

insert into public.agent_versions (agent_id, instructions)
select a.id, 'Agente fictício de QA. Não executar.'
from public.agents a
where a.slug = 'qa-analise-43'
  and not exists (select 1 from public.agent_versions v where v.agent_id = a.id);

update public.agents a
set current_version_id = (select v.id from public.agent_versions v where v.agent_id = a.id order by v.created_at desc limit 1),
    status = 'ACTIVE'
where a.slug = 'qa-analise-43';

insert into public.analysis_templates (legal_area_id, name, description, primary_agent_id)
select la.id, 'QA 4.3 — com agente', 'Modelo fictício de QA', ag.id
from public.legal_areas la, public.agents ag
where la.code = 'BANKING' and ag.slug = 'qa-analise-43'
  and not exists (select 1 from public.analysis_templates t where t.name = 'QA 4.3 — com agente');

-- (Re)ativa, caso a limpeza já tenha sido rodada antes.
update public.analysis_templates set active = true where name = 'QA 4.3 — com agente';

-- Conferência: 1 linha, agente ACTIVE, COM versão atual, modelo ativo.
select ag.status as agente, ag.current_version_id is not null as tem_versao, t.active as modelo_ativo
from public.analysis_templates t join public.agents ag on ag.id = t.primary_agent_id
where t.name = 'QA 4.3 — com agente';
```

**Só DEPOIS de terminar o QA** (este bloco desliga o agente e o modelo):

```sql
update public.agent_runs set status = 'CANCELLED'
where status = 'QUEUED' and agent_id = (select id from public.agents where slug = 'qa-analise-43');
update public.analysis_templates set active = false where name = 'QA 4.3 — com agente';
update public.agents set status = 'INACTIVE' where slug = 'qa-analise-43';
```

### 6.3 Notificação de teste (Fase H)

Ainda não há regra que gere notificações; para ver o sino funcionando (o
Supabase guarda o e-mail em minúsculas — o `lower` evita a diferença):

```sql
insert into public.notifications (user_id, type, title, message, severity, legal_case_id)
select u.id, 'CASE_UPDATE', 'Aviso de QA 4.3', 'Notificação fictícia de teste', 'WARNING', null
from auth.users u where lower(u.email) = lower('ADM@DGBrasil.com')
returning id;
```

Deve voltar **1 linha** (o id). Se voltar 0, o e-mail não confere com o do
login. Depois **recarregue a página** do app: o sino lê as notificações ao
carregar.

## 7. QA manual por fase

O checklist detalhado de cada fase está em
[`docs/frontend-integration.md`](frontend-integration.md), nas seções
**"QA manual — Fase A" … "Fase H"**. Faça na ordem A → H; cada seção diz o
papel a usar.

### 7.1 Verificações transversais (todas as fases)

- [ ] **Rota direta:** colar a URL de uma ficha (cliente, caso, processo,
      revisão, parceiro) em outra aba e recarregar — abre igual.
- [ ] **Permissão por rota:** ASSISTANT em `/revisoes`, `/financeiro`,
      `/dg-brasil/execucoes`, `/casos/<id>/analise/nova` → acesso negado;
      PARTNER_USER em `/financeiro` → acesso negado; parceiro em `/parceiros`
      → acesso negado.
- [ ] **Parceiro A × B:** com o PARTNER_ADMIN do A, abrir
      `/clientes|casos|processos/<id do parceiro B>` → "não encontrado".
- [ ] **IDOR:** trocar o id da URL por um uuid inventado ou de outro
      escritório → "não encontrado" (nunca "sem permissão" revelando que existe).
- [ ] **Idempotência pela UI:** clique duplo rápido em cada "criar/enviar"
      (cliente, caso, processo, envio de caso do parceiro, análise, contrato,
      obrigação, recebimento, repasse) → um registro só.
- [ ] **Estados:** desligar a rede e mudar um filtro → erro com "Tentar
      novamente"; religar e tentar → volta. Listas vazias mostram a mensagem
      de vazio; enquanto carrega, a lista fica esmaecida.
- [ ] **CPF/CNPJ fora da URL:** buscar por CPF em Clientes/Processos → a URL
      não mostra os dígitos.
- [ ] **Sem dado de demonstração na área jurídica:** clientes, casos,
      processos, documentos, solicitações, revisões, análises, financeiro,
      execuções, notificações, auditoria e Início mostram só dados do DEV.

### 7.2 Áreas que continuam de demonstração (esperado)

Configuração da área DG Brasil (agentes, skills, teses, referências,
histórico), Integrações, Importação de dados, Configurações → IA e
preferências de notificação. Ficaram fora da 4.3 de propósito (ver relatório).

## 8. O que me mandar

1. Saída final do `verificar`, `npm test` e `build`.
2. `migration list` antes e depois do `db push` (ou o erro inteiro).
3. Resumo do `validar:real`.
4. Resumo do `test:integration` (e a saída completa de qualquer falha).
5. Itens do QA que falharam (fase, papel, o que fez, o que viu).
