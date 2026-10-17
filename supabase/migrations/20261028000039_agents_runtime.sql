-- DG Brasil — 039: execução real dos agentes (Etapa 5)
--
-- A infraestrutura de execução (fila, reserva, batimento, interrupção,
-- propostas, revisão) já existe (012, 018, 029, 033). Esta migration liga a
-- IA real a ela, sem arquitetura paralela:
--
--   1. Interruptor geral da IA (ai_runtime_settings): ADMIN liga/desliga; o
--      worker não reserva execução nova com a IA desligada. Nasce DESLIGADO.
--   2. Arquivos de skill (skill_version_files, bucket skill-files): uma skill
--      é texto + arquivos (scripts, modelos, referências), como no Claude Code.
--      Versão é append-only: arquivo novo = versão nova.
--      skill_provider_versions: qual versão do provedor (Skills API) carrega
--      cada versão de skill — gravada só pelo worker, com a reserva.
--   3. Resultado estruturado da análise (legal_analysis_results, append-only,
--      um por execução) e revisão apontando para o resultado EXATO
--      (reviews.legal_analysis_result_id). Decisão humana sobre a análise:
--      aprovar conclui; rejeitar ou pedir alterações devolve a análise para
--      novo envio — o resultado anterior nunca é editado.
--   4. Execução auditável: config_snapshot (versões de agente, skills, teses e
--      referências, hash das instruções, modelo, limites) e nova tentativa
--      ligada à anterior (retry_of_agent_run_id).
--   5. Execução só termina quando TODO o material dela foi decidido (propostas,
--      minutas e resultado de análise), não só as propostas.
--   6. Área DG Brasil real: criação/edição atômica e idempotente de agente,
--      skill (com arquivos), tese e referência, vínculo template → agente;
--      leitura de execução para a tela e uso da IA para o ADMIN.
--
-- Nada aqui chama IA. O worker continua sem SELECT em dado de cliente: tudo
-- por funções private.worker_* que exigem a reserva da execução.
--
-- Pós-baseline: 001–038 não são alteradas.

-- ═════════════════════════════ 1. interruptor geral ══════════════════════

create table public.ai_runtime_settings (
  id                boolean primary key default true constraint ai_runtime_settings_singleton check (id),
  execution_enabled boolean not null default false,
  reason            text check (reason is null or length(reason) <= 500),
  updated_by        uuid references public.profiles (id) on delete restrict,
  updated_at        timestamptz not null default now()
);

comment on table public.ai_runtime_settings is
  'Interruptor geral da execução de IA (linha única). Desligado: o worker não reserva execução nova; pedidos ficam na fila.';

insert into public.ai_runtime_settings (id) values (true) on conflict (id) do nothing;

alter table public.ai_runtime_settings enable row level security;
revoke all on public.ai_runtime_settings from public, anon, authenticated, service_role;

-- Situação do interruptor: qualquer usuário interno (a tela mostra o aviso).
create or replace function private.get_ai_runtime_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v record;
begin
  if auth.uid() is null or not exists (select 1 from private.current_membership()) then
    raise exception 'Sem sessão liberada' using errcode = '42501';
  end if;
  if not private.is_internal_user() then
    raise exception 'Somente a equipe interna' using errcode = '42501';
  end if;
  select s.execution_enabled, s.reason, s.updated_at, p.full_name into v
  from public.ai_runtime_settings s
  left join public.profiles p on p.id = s.updated_by
  where s.id;
  return jsonb_build_object(
    'execution_enabled', coalesce(v.execution_enabled, false),
    'reason', v.reason,
    'updated_at', v.updated_at,
    'updated_by_name', v.full_name);
end
$$;

create or replace function private.set_ai_execution_enabled(p_enabled boolean, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before boolean;
begin
  if auth.uid() is null or not exists (select 1 from private.current_membership()) then
    raise exception 'Sem sessão liberada' using errcode = '42501';
  end if;
  if not private.is_admin() then
    raise exception 'Somente ADMIN liga ou desliga a execução de IA' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'Informe ligar ou desligar' using errcode = '22023';
  end if;

  select s.execution_enabled into v_before from public.ai_runtime_settings s where s.id for update;
  update public.ai_runtime_settings
     set execution_enabled = p_enabled,
         reason = nullif(btrim(left(coalesce(p_reason, ''), 500)), ''),
         updated_by = auth.uid(),
         updated_at = now()
   where id;

  if v_before is distinct from p_enabled then
    perform private.record_audit_event(
      case when p_enabled then 'AI_EXECUTION_ENABLED' else 'AI_EXECUTION_DISABLED' end,
      'ai_runtime_settings', null, jsonb_build_object('from', v_before, 'to', p_enabled));
  end if;
  return private.get_ai_runtime_status();
end
$$;

-- O worker confere antes de ler a fila. Sem linha = desligado.
create or replace function private.worker_ai_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.execution_enabled from public.ai_runtime_settings s where s.id), false)
$$;

create or replace function public.get_ai_runtime_status()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.get_ai_runtime_status() $$;

create or replace function public.set_ai_execution_enabled(p_enabled boolean, p_reason text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.set_ai_execution_enabled(p_enabled, p_reason) $$;

-- ═════════════════════════════ 2. arquivos de skill ══════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('skill-files', 'skill-files', false, 10485760, array[
  'text/plain', 'text/markdown', 'text/x-python', 'text/csv', 'text/html', 'text/css', 'text/xml',
  'application/json', 'application/xml', 'application/yaml',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png', 'image/jpeg', 'font/ttf', 'font/otf'
])
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- O bucket novo também fica fechado ao navegador (017).
drop policy dg_private_buckets_no_direct_access on storage.objects;
create policy dg_private_buckets_no_direct_access on storage.objects
  as restrictive
  for all
  to anon, authenticated
  using (bucket_id not in ('legal-documents', 'reference-materials', 'imports', 'skill-files'))
  with check (bucket_id not in ('legal-documents', 'reference-materials', 'imports', 'skill-files'));

-- Caminho relativo DENTRO da skill (ex.: scripts/gerar.py). Segmentos sem
-- ponto inicial: '..' e arquivos ocultos ficam de fora. SKILL.md é gerado
-- a partir das instruções da versão, nunca enviado como arquivo.
create table public.skill_version_files (
  id                  uuid primary key default gen_random_uuid(),
  skill_id            uuid not null,
  skill_version_id    uuid not null,
  path                text not null,
  -- Bucket skill-files: skills/{skill_id}/{version_id}/{path}. Arquivo mantido
  -- de uma versão anterior aponta para o objeto da versão em que entrou.
  storage_object_name text not null,
  mime_type           text not null,
  file_size           bigint not null check (file_size > 0 and file_size <= 10485760),
  checksum_sha256     text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  created_by          uuid references public.profiles (id) on delete restrict,
  created_at          timestamptz not null default now(),
  constraint skill_version_files_path_key unique (skill_version_id, path),
  constraint skill_version_files_version_fkey
    foreign key (skill_version_id, skill_id) references public.skill_versions (id, skill_id) on delete restrict,
  constraint skill_version_files_path_format check (
    length(path) between 1 and 200
    and path ~ '^[A-Za-z0-9_][A-Za-z0-9._-]*(/[A-Za-z0-9_][A-Za-z0-9._-]*)*$'
    and lower(path) <> 'skill.md'),
  constraint skill_version_files_object_prefix check (
    storage_object_name like 'skills/' || skill_id::text || '/%')
);

create index skill_version_files_version_idx on public.skill_version_files (skill_version_id);

create trigger skill_version_files_append_only
  before update or delete on public.skill_version_files
  for each row execute function private.prevent_mutation();

comment on table public.skill_version_files is
  'Arquivos de uma versão de skill (scripts, modelos, referências). Append-only: mudar arquivo = versão nova.';

-- Qual versão do provedor (Skills API da Anthropic) carrega cada versão de
-- skill. Gravada só pelo worker (worker_register_skill_upload), uma vez.
create table public.skill_provider_versions (
  skill_version_id    uuid primary key,
  skill_id            uuid not null,
  provider            text not null default 'ANTHROPIC' check (provider ~ '^[A-Z][A-Z_]{1,31}$'),
  provider_skill_id   text not null check (length(provider_skill_id) between 1 and 200),
  provider_skill_name text not null check (length(provider_skill_name) between 1 and 64),
  provider_version_id text not null check (length(provider_version_id) between 1 and 200),
  bundle_sha256       text not null check (bundle_sha256 ~ '^[0-9a-f]{64}$'),
  created_at          timestamptz not null default now(),
  constraint skill_provider_versions_version_fkey
    foreign key (skill_version_id, skill_id) references public.skill_versions (id, skill_id) on delete restrict
);

create index skill_provider_versions_skill_idx on public.skill_provider_versions (skill_id, created_at desc);

create trigger skill_provider_versions_append_only
  before update or delete on public.skill_provider_versions
  for each row execute function private.prevent_mutation();

alter table public.skill_version_files enable row level security;
alter table public.skill_provider_versions enable row level security;

revoke all on public.skill_version_files, public.skill_provider_versions from public, anon, authenticated;
grant select, insert on public.skill_version_files to authenticated;
grant select on public.skill_provider_versions to authenticated;
grant select on public.skill_version_files, public.skill_provider_versions to dg_worker;
grant all on public.skill_version_files, public.skill_provider_versions to service_role;
revoke update, delete, truncate on public.skill_version_files, public.skill_provider_versions from service_role;

create policy skill_version_files_select_admin on public.skill_version_files for select to authenticated
  using ((select private.is_admin()));
create policy skill_version_files_insert_admin on public.skill_version_files for insert to authenticated
  with check ((select private.is_admin()));
create policy skill_provider_versions_select_admin on public.skill_provider_versions for select to authenticated
  using ((select private.is_admin()));
-- Configuração de IA, sem dado de cliente: o worker lê (como as demais, 016).
create policy skill_version_files_worker_read on public.skill_version_files for select to dg_worker using (true);
create policy skill_provider_versions_worker_read on public.skill_provider_versions for select to dg_worker using (true);

-- Objeto existe no Storage? Só para os buckets de configuração e só para
-- ADMIN (não serve de sonda de nomes de documento de cliente).
create or replace function private.dg_storage_object_exists(p_bucket text, p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_bucket not in ('skill-files', 'reference-materials') or not private.is_admin() then
    return false;
  end if;
  return exists (select 1 from storage.objects o where o.bucket_id = p_bucket and o.name = p_name);
end
$$;

-- O worker registra o envio de uma versão de skill ao provedor. Só para
-- skill vinculada (e habilitada) ao agente da execução reservada, ou ao
-- template da análise dela. Idempotente: a primeira gravação vale.
create or replace function private.worker_register_skill_upload(
  p_agent_run_id        uuid,
  p_worker              text,
  p_skill_version_id    uuid,
  p_provider_skill_id   text,
  p_provider_skill_name text,
  p_provider_version_id text,
  p_bundle_sha256       text
)
returns table (provider_skill_id text, provider_version_id text, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope record;
  v_skill uuid;
  v_id    uuid;
begin
  select * into v_scope from private.worker_scope(p_agent_run_id, p_worker);

  select sv.skill_id into v_skill from public.skill_versions sv where sv.id = p_skill_version_id;
  if v_skill is null or not (
       exists (select 1 from public.agent_skill_bindings b
               where b.agent_id = v_scope.agent_id and b.skill_id = v_skill and b.enabled)
    or exists (select 1 from public.legal_analyses a
               join public.analysis_template_skill_bindings tb on tb.analysis_template_id = a.analysis_template_id
               where a.agent_run_id = p_agent_run_id and tb.skill_id = v_skill)
  ) then
    raise exception 'Skill não vinculada ao agente desta execução' using errcode = '42501';
  end if;

  insert into public.skill_provider_versions
    (skill_version_id, skill_id, provider_skill_id, provider_skill_name, provider_version_id, bundle_sha256)
  values
    (p_skill_version_id, v_skill, p_provider_skill_id, p_provider_skill_name, p_provider_version_id, p_bundle_sha256)
  on conflict (skill_version_id) do nothing
  returning skill_version_id into v_id;

  return query
  select s.provider_skill_id, s.provider_version_id, v_id is not null
  from public.skill_provider_versions s where s.skill_version_id = p_skill_version_id;
end
$$;

-- ═════════════════════════════ 3. resultado da análise ═══════════════════

create table public.legal_analysis_results (
  id                uuid primary key default gen_random_uuid(),
  legal_analysis_id uuid not null references public.legal_analyses (id) on delete restrict,
  legal_case_id     uuid not null references public.legal_cases (id) on delete restrict,
  agent_run_id      uuid not null references public.agent_runs (id) on delete restrict,
  schema_version    integer not null default 1 check (schema_version > 0),
  -- Síntese para quem revisa. Nunca chain-of-thought.
  summary           text not null check (length(btrim(summary)) between 1 and 4000),
  result            jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at        timestamptz not null default now(),
  -- Um resultado por execução: repetir a entrega não cria outro.
  constraint legal_analysis_results_run_key unique (agent_run_id)
);

create index legal_analysis_results_analysis_idx on public.legal_analysis_results (legal_analysis_id, created_at desc);

create trigger legal_analysis_results_append_only
  before update or delete on public.legal_analysis_results
  for each row execute function private.prevent_mutation();

comment on table public.legal_analysis_results is
  'Resultado estruturado de cada execução de uma análise. Append-only: nova tentativa = novo resultado; o anterior fica no histórico.';

alter table public.legal_analysis_results enable row level security;
revoke all on public.legal_analysis_results from public, anon, authenticated;
grant select on public.legal_analysis_results to authenticated;
grant select on public.legal_analysis_results to service_role;

create policy legal_analysis_results_select on public.legal_analysis_results for select to authenticated
  using ((select private.has_internal_role('ADMIN', 'LAWYER')));

-- A revisão de análise aponta para o resultado exato que está sendo revisado.
alter table public.reviews
  add column legal_analysis_result_id uuid references public.legal_analysis_results (id) on delete restrict;
alter table public.reviews
  add constraint reviews_analysis_result_needs_analysis
  check (legal_analysis_result_id is null or legal_analysis_id is not null);

create unique index reviews_one_per_analysis_result on public.reviews (legal_analysis_result_id)
  where legal_analysis_result_id is not null and status in ('PENDING', 'REOPENED');

create or replace function private.reviews_validate_analysis_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.legal_analysis_result_id is distinct from old.legal_analysis_result_id then
    raise exception 'O alvo de uma revisão não muda: abra outra revisão' using errcode = '23514';
  end if;
  if new.legal_analysis_result_id is not null and not exists (
    select 1 from public.legal_analysis_results r
    where r.id = new.legal_analysis_result_id and r.legal_analysis_id = new.legal_analysis_id
  ) then
    raise exception 'O resultado revisado não é desta análise' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger reviews_validate_analysis_result
  before insert or update on public.reviews
  for each row execute function private.reviews_validate_analysis_result();

-- Decisão humana sobre a análise. O resultado nunca é editado: aprovar
-- conclui; rejeitar ou pedir alterações devolve a análise para novo envio
-- (a próxima execução recebe o resultado anterior e as observações).
create or replace function private.reviews_sync_analysis()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.legal_analysis_id is null or new.status is not distinct from old.status then
    return null;
  end if;

  if new.status = 'APPROVED' then
    update public.legal_analyses
       set status = 'COMPLETED', completed_at = coalesce(completed_at, now()), interruption_reason = null
     where id = new.legal_analysis_id and status in ('RUNNING', 'WAITING_REVIEW');
  elsif new.status in ('REJECTED', 'CHANGES_REQUESTED') then
    update public.legal_analyses
       set status = 'PENDING',
           interruption_reason = case new.status
             when 'REJECTED' then 'O resultado foi rejeitado na revisão. Ajuste o pedido e envie de novo, se for o caso.'
             else 'Alterações pedidas na revisão. Envie de novo: o agente recebe as observações e gera um novo resultado.'
           end
     where id = new.legal_analysis_id and status in ('RUNNING', 'WAITING_REVIEW');
  elsif new.status = 'REOPENED' then
    update public.legal_analyses
       set status = 'WAITING_REVIEW'
     where id = new.legal_analysis_id and status in ('COMPLETED', 'PENDING');
  end if;
  return null;
end
$$;

create trigger reviews_sync_analysis
  after update of status on public.reviews
  for each row execute function private.reviews_sync_analysis();

-- O worker entrega o resultado da análise da execução reservada: resultado
-- (append-only), espelho em legal_analyses (summary/result_data, lidos pela
-- tela) e revisão PENDING apontando para ESTE resultado — numa transação.
-- Repetir (retry, agente que chama de novo) devolve o mesmo resultado.
create or replace function private.worker_submit_analysis_result(
  p_agent_run_id   uuid,
  p_worker         text,
  p_summary        text,
  p_result         jsonb,
  p_schema_version integer default 1
)
returns table (result_id uuid, review_id uuid, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope    record;
  v_analysis record;
  v_result   uuid;
  v_review   uuid;
begin
  select * into v_scope from private.worker_scope(p_agent_run_id, p_worker);

  select a.id, a.legal_case_id into v_analysis
  from public.legal_analyses a where a.agent_run_id = p_agent_run_id
  for update;
  if v_analysis.id is null then
    raise exception 'Esta execução não é de uma análise' using errcode = '23514';
  end if;
  if p_result is null or jsonb_typeof(p_result) <> 'object' then
    raise exception 'Resultado precisa ser um objeto' using errcode = '22023';
  end if;
  if pg_column_size(p_result) > 262144 then
    raise exception 'Resultado grande demais (máximo 256 KB)' using errcode = '22023';
  end if;

  select r.id into v_result from public.legal_analysis_results r where r.agent_run_id = p_agent_run_id;
  if v_result is not null then
    select rv.id into v_review from public.reviews rv where rv.legal_analysis_result_id = v_result
    order by rv.created_at desc limit 1;
    return query select v_result, v_review, false;
    return;
  end if;

  if exists (select 1 from public.reviews rv
             where rv.legal_analysis_id = v_analysis.id and rv.status in ('PENDING', 'REOPENED')) then
    raise exception 'Já existe revisão aberta para esta análise' using errcode = '23514';
  end if;

  insert into public.legal_analysis_results (legal_analysis_id, legal_case_id, agent_run_id, schema_version, summary, result)
  values (v_analysis.id, v_analysis.legal_case_id, p_agent_run_id, coalesce(p_schema_version, 1), btrim(p_summary), p_result)
  returning id into v_result;

  update public.legal_analyses
     set summary = btrim(p_summary),
         result_data = p_result || jsonb_build_object('result_id', v_result, 'schema_version', coalesce(p_schema_version, 1))
   where id = v_analysis.id;

  insert into public.reviews (legal_case_id, legal_process_id, legal_analysis_id, legal_analysis_result_id)
  values (v_analysis.legal_case_id, v_scope.legal_process_id, v_analysis.id, v_result)
  returning id into v_review;

  perform private.record_audit_event('ANALYSIS_RESULT_SUBMITTED', 'legal_analysis_results', v_result,
    jsonb_build_object('legal_analysis_id', v_analysis.id, 'review_id', v_review));
  return query select v_result, v_review, true;
end
$$;

-- ═════════════════════════════ 4. execução auditável ═════════════════════

alter table public.agent_runs
  add column config_snapshot jsonb not null default '{}'
    constraint agent_runs_config_snapshot_object check (jsonb_typeof(config_snapshot) = 'object'),
  add column retry_of_agent_run_id uuid references public.agent_runs (id) on delete restrict;

comment on column public.agent_runs.config_snapshot is
  'Configuração que produziu a execução: versões de agente/skills/teses/referências, hash das instruções, modelo, limites. Sem segredo nem conteúdo de cliente.';
comment on column public.agent_runs.retry_of_agent_run_id is
  'Nova tentativa: a execução anterior (falhou, foi interrompida ou teve o resultado devolvido na revisão).';

create index agent_runs_retry_of_idx on public.agent_runs (retry_of_agent_run_id) where retry_of_agent_run_id is not null;

create or replace function private.agent_runs_retry_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.retry_of_agent_run_id is not null and new.retry_of_agent_run_id is distinct from old.retry_of_agent_run_id then
    raise exception 'O vínculo com a tentativa anterior não muda' using errcode = '23514';
  end if;
  if new.retry_of_agent_run_id = new.id then
    raise exception 'Execução não é tentativa de si mesma' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger agent_runs_retry_guard
  before update on public.agent_runs
  for each row execute function private.agent_runs_retry_guard();

-- O worker registra a configuração usada, só com a reserva. Nada de
-- conteúdo de cliente nem segredo: só ids, versões, hashes e limites.
create or replace function private.worker_record_run_config(p_agent_run_id uuid, p_worker text, p_snapshot jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'Snapshot precisa ser objeto' using errcode = '22023';
  end if;
  if pg_column_size(p_snapshot) > 65536 then
    raise exception 'Snapshot grande demais' using errcode = '22023';
  end if;
  if p_snapshot ? 'input' or p_snapshot ? 'prompt' or p_snapshot ? 'instructions' then
    raise exception 'Snapshot não guarda entrada, prompt nem instruções (só versões e hashes)' using errcode = '22023';
  end if;
  perform set_config('dg.agent_run_id', p_agent_run_id::text, true);
  update public.agent_runs set config_snapshot = p_snapshot
   where id = p_agent_run_id and status = 'RUNNING' and claimed_by = p_worker;
  return found;
end
$$;

-- Versão de documento do caso para o agente abrir, com tipo e título. Mesmo
-- escopo de worker_get_document_version (018): só documento VINCULADO ao caso
-- da execução reservada, acesso registrado (LGPD) com ator AGENT.
create or replace function private.worker_open_document(p_agent_run_id uuid, p_worker text, p_document_version_id uuid)
returns table (
  storage_object_name text, original_filename text, file_size bigint, mime_type text,
  document_id uuid, title text, category text, version_number integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope record;
begin
  select * into v_scope from private.worker_scope(p_agent_run_id, p_worker);
  if v_scope.legal_case_id is null then
    return;
  end if;
  return query
  select v.storage_object_name, v.original_filename, v.file_size, v.mime_type,
         d.id, d.title, d.category::text, v.version_number
  from public.document_versions v
  join public.documents d on d.id = v.document_id and d.deleted_at is null
  join public.case_documents cd on cd.document_id = d.id and cd.legal_case_id = v_scope.legal_case_id
  where v.id = p_document_version_id;
  if found then
    perform private.record_personal_data_access(v_scope.client_id, 'DOCUMENT_VERSION', p_document_version_id,
                                                'DOWNLOAD', 'Execução de agente');
  end if;
end
$$;

-- Contexto da execução (018), agora com a análise: template, campos,
-- resultado anterior e a decisão humana sobre ele (para a nova tentativa
-- corrigir o que foi pedido). Mesma assinatura e mesmo escopo.
create or replace function private.worker_run_context(p_agent_run_id uuid, p_worker text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope    record;
  v_run      record;
  v_input    record;
  v_analysis jsonb;
begin
  select * into v_scope from private.worker_scope(p_agent_run_id, p_worker);
  select r.id, r.agent_id, r.agent_version_id, r.legal_case_id, r.legal_process_id, r.operation,
         r.requested_by, r.attempt, r.metadata, r.retry_of_agent_run_id
    into v_run
  from public.agent_runs r where r.id = p_agent_run_id;
  select i.request_text, i.parameters into v_input
  from public.agent_run_inputs i where i.agent_run_id = p_agent_run_id;

  select jsonb_build_object(
    'id', a.id,
    'template_id', t.id,
    'template_name', t.name,
    'template_description', t.description,
    'field_values', a.field_values,
    -- Skills e teses que o template da análise acrescenta às do agente.
    'template_skill_ids', coalesce((select jsonb_agg(b.skill_id) from public.analysis_template_skill_bindings b
                                    where b.analysis_template_id = t.id), '[]'::jsonb),
    'template_thesis_ids', coalesce((select jsonb_agg(b.legal_thesis_id) from public.analysis_template_thesis_bindings b
                                     where b.analysis_template_id = t.id), '[]'::jsonb),
    'fields', coalesce((select jsonb_agg(jsonb_build_object('key', f.key, 'label', f.label, 'type', f.field_type,
                                                             'help', f.help_text) order by f.sort_order, f.key)
                        from public.analysis_template_fields f where f.analysis_template_id = t.id), '[]'::jsonb),
    'previous', (
      select jsonb_build_object(
        'result_id', pr.id,
        'summary', pr.summary,
        'result', pr.result,
        'review_status', rv.status,
        'review_notes', (select d.notes from public.review_decisions d
                         where d.review_id = rv.id order by d.created_at desc limit 1))
      from public.legal_analysis_results pr
      left join lateral (select x.id, x.status from public.reviews x
                         where x.legal_analysis_result_id = pr.id order by x.created_at desc limit 1) rv on true
      where pr.legal_analysis_id = a.id and pr.agent_run_id <> p_agent_run_id
      order by pr.created_at desc limit 1)
  ) into v_analysis
  from public.legal_analyses a
  join public.analysis_templates t on t.id = a.analysis_template_id
  where a.agent_run_id = p_agent_run_id;

  return jsonb_build_object(
    'id', v_run.id,
    'agent_id', v_run.agent_id,
    'agent_version_id', v_run.agent_version_id,
    'legal_case_id', v_run.legal_case_id,
    'legal_process_id', v_run.legal_process_id,
    'client_id', v_scope.client_id,
    'operation', v_run.operation,
    'requested_by', v_run.requested_by,
    'attempt', v_run.attempt,
    'retry_of_agent_run_id', v_run.retry_of_agent_run_id,
    'previous_output',
      exists (select 1 from public.agent_proposals p where p.agent_run_id = p_agent_run_id)
      or exists (select 1 from public.legal_analysis_results r where r.agent_run_id = p_agent_run_id)
      or jsonb_array_length(coalesce(v_run.metadata -> 'documents', '[]'::jsonb)) > 0,
    'input', jsonb_build_object('request_text', v_input.request_text,
                                'parameters', coalesce(v_input.parameters, '{}'::jsonb)),
    'analysis', v_analysis
  );
end
$$;

-- Nova tentativa de execução avulsa (sem análise; a de análise é reenviada
-- pela própria análise). Cria OUTRA execução com a mesma entrada, ligada à
-- anterior. Idempotente por chave (027). ADMIN ou LAWYER do caso.
create or replace function private.retry_agent_run_once(p_key uuid, p_agent_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev  jsonb;
  v_run   record;
  v_input record;
  v_new   uuid;
begin
  if auth.uid() is null or not exists (select 1 from private.current_membership()) then
    raise exception 'Sem sessão liberada' using errcode = '42501';
  end if;
  if not private.has_internal_role('ADMIN', 'LAWYER') then
    raise exception 'Somente ADMIN ou advogado tenta de novo uma execução' using errcode = '42501';
  end if;

  select r.id, r.agent_id, r.legal_case_id, r.legal_process_id, r.status, r.operation into v_run
  from public.agent_runs r where r.id = p_agent_run_id;
  if v_run.id is null
     or (not private.is_admin() and (v_run.legal_case_id is null or not private.can_access_case(v_run.legal_case_id))) then
    raise exception 'Execução não encontrada' using errcode = 'P0002';
  end if;
  if v_run.status not in ('FAILED', 'CANCELLED') then
    raise exception 'Só se tenta de novo uma execução que falhou ou foi interrompida' using errcode = '23514';
  end if;
  if exists (select 1 from public.legal_analyses a where a.agent_run_id = p_agent_run_id) then
    raise exception 'Esta execução é de uma análise: envie a análise de novo pela tela do caso' using errcode = '23514';
  end if;

  v_prev := private.idempotency_begin('agent_run.retry', p_key, jsonb_build_object('agent_run_id', p_agent_run_id));
  if v_prev is not null then
    return jsonb_build_object('agent_run_id', v_prev ->> 'resource_id', 'retry_of_agent_run_id', p_agent_run_id, 'deduplicated', true);
  end if;

  select i.request_text, i.parameters into v_input from public.agent_run_inputs i where i.agent_run_id = p_agent_run_id;

  v_new := private.request_agent_run(v_run.agent_id, v_run.legal_case_id, v_run.legal_process_id,
                                     v_input.request_text, coalesce(v_input.parameters, '{}'::jsonb), v_run.operation, null);
  update public.agent_runs set retry_of_agent_run_id = p_agent_run_id where id = v_new;

  perform private.idempotency_complete('agent_run.retry', p_key, 'agent_runs', v_new,
    jsonb_build_object('agent_run_id', v_new));
  return jsonb_build_object('agent_run_id', v_new, 'retry_of_agent_run_id', p_agent_run_id, 'deduplicated', false);
end
$$;

create or replace function public.retry_agent_run_once(p_key uuid, p_agent_run_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.retry_agent_run_once(p_key, p_agent_run_id) $$;

-- Liga a execução recém-pedida pelo próprio usuário à execução anterior da
-- mesma análise. Estreita de propósito: o usuário não tem UPDATE em
-- agent_runs, e esta porta só grava o vínculo (uma vez).
create or replace function private.link_analysis_retry(p_new_run uuid, p_previous_run uuid, p_analysis_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.legal_analyses a where a.id = p_analysis_id and a.agent_run_id = p_previous_run) then
    raise exception 'A execução anterior não é desta análise' using errcode = '23514';
  end if;
  update public.agent_runs
     set retry_of_agent_run_id = p_previous_run
   where id = p_new_run and requested_by = auth.uid() and status = 'QUEUED' and retry_of_agent_run_id is null;
  if not found then
    raise exception 'Execução nova não encontrada' using errcode = 'P0002';
  end if;
end
$$;

-- Reenvio de análise (029): igual, mas a nova execução fica ligada à
-- anterior (retry_of_agent_run_id). Mesma assinatura.
create or replace function public.send_legal_analysis_once(
  p_key          uuid,
  p_analysis_id  uuid,
  p_request_text text default null,
  p_parameters   jsonb default '{}'
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prev  jsonb;
  v_a     record;
  v_agent uuid;
  v_run   uuid;
begin
  if not (select private.has_internal_role('ADMIN', 'LAWYER')) then
    raise exception 'Somente ADMIN ou advogado envia análise ao agente' using errcode = '42501';
  end if;

  v_prev := private.idempotency_begin('legal_analysis.send', p_key,
    jsonb_build_object('analysis_id', p_analysis_id, 'request_text', p_request_text));
  if v_prev is not null then
    return jsonb_build_object('analysis_id', p_analysis_id, 'agent_run_id', v_prev -> 'response' ->> 'agent_run_id', 'deduplicated', true);
  end if;

  select a.id, a.status, a.legal_case_id, a.analysis_template_id, a.agent_run_id into v_a
  from public.legal_analyses a
  where a.id = p_analysis_id
  for update;
  if v_a.id is null then
    raise exception 'Análise não encontrada' using errcode = '42501';
  end if;
  if v_a.status not in ('PENDING', 'WAITING_DOCUMENTS', 'FAILED', 'CANCELLED') then
    raise exception 'Esta análise já está com o agente ou foi concluída' using errcode = 'P0001';
  end if;

  select t.primary_agent_id into v_agent
  from public.analysis_templates t
  where t.id = v_a.analysis_template_id and t.active;
  if v_agent is null then
    raise exception 'O template desta análise não tem agente configurado' using errcode = '23514';
  end if;

  v_run := private.request_agent_run(v_agent, v_a.legal_case_id, null, p_request_text, coalesce(p_parameters, '{}'), 'EXECUTE', null);
  if v_a.agent_run_id is not null then
    perform private.link_analysis_retry(v_run, v_a.agent_run_id, p_analysis_id);
  end if;

  update public.legal_analyses
     set status = 'QUEUED', agent_run_id = v_run, started_by = auth.uid(), started_at = now(), interruption_reason = null
   where id = p_analysis_id;

  perform private.idempotency_complete('legal_analysis.send', p_key, 'agent_runs', v_run,
    jsonb_build_object('agent_run_id', v_run));
  return jsonb_build_object('analysis_id', p_analysis_id, 'agent_run_id', v_run, 'deduplicated', false);
end
$$;

-- ═════════════════════════════ 5. fim da execução ═══════════════════════
-- Execução que esperava humano só termina quando NADA do que ela entregou
-- está pendente: propostas, minutas (metadata.documents) e resultado de
-- análise. Antes (018) só as propostas contavam.

create or replace function private.agent_run_has_pending_outputs(p_agent_run_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.agent_proposals p
                 where p.agent_run_id = p_agent_run_id and p.status in ('PENDING', 'APPROVED'))
      or exists (select 1 from public.reviews rv
                 join public.legal_analysis_results lr on lr.id = rv.legal_analysis_result_id
                 where lr.agent_run_id = p_agent_run_id and rv.status in ('PENDING', 'REOPENED'))
      or exists (select 1 from public.agent_runs r
                 cross join lateral jsonb_array_elements_text(coalesce(r.metadata -> 'documents', '[]'::jsonb)) d(version_id)
                 join public.reviews rv on rv.document_version_id = d.version_id::uuid
                 where r.id = p_agent_run_id and rv.status in ('PENDING', 'REOPENED'))
$$;

create or replace function private.worker_close_run_if_decided(p_agent_run_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('dg.agent_run_id', p_agent_run_id::text, true);
  update public.agent_runs
     set status = 'COMPLETED', completed_at = now()
   where id = p_agent_run_id and status = 'WAITING_HUMAN'
     and not private.agent_run_has_pending_outputs(p_agent_run_id);
  return found;
end
$$;

create or replace function private.worker_close_decided_runs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select x.id from public.agent_runs x
    where x.status = 'WAITING_HUMAN' and not private.agent_run_has_pending_outputs(x.id)
    order by x.updated_at
    limit 50
  loop
    if private.worker_close_run_if_decided(r.id) then
      n := n + 1;
    end if;
  end loop;
  return n;
end
$$;

-- ═════════════════════════════ 6. área DG Brasil ════════════════════════
-- Criação/edição pelo ADMIN. Funções SECURITY INVOKER: a RLS (só ADMIN) de
-- agents/skills/teses/referências vale como sempre; idempotência pela chave
-- (027); auditoria pelos gatilhos de linha das tabelas (014). Versões são
-- append-only: mudar conteúdo cria versão nova e a torna corrente.

-- Configuração de execução do agente (agent_versions.configuration). O
-- worker revalida com o mesmo contrato; aqui o erro aparece na hora de salvar.
create or replace function private.dg_validate_agent_configuration(p_conf jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  k text;
begin
  if p_conf is null or jsonb_typeof(p_conf) <> 'object' then
    raise exception 'Configuração do agente precisa ser um objeto' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_conf) loop
    if k not in ('model', 'effort', 'max_turns', 'max_tool_calls', 'max_duration_seconds',
                 'max_budget_usd', 'code_execution', 'tools', 'max_output_tokens') then
      raise exception 'Configuração do agente: campo desconhecido "%"', k using errcode = '22023';
    end if;
  end loop;
  if p_conf ? 'model' and (jsonb_typeof(p_conf -> 'model') <> 'string' or p_conf ->> 'model' !~ '^claude-[a-z0-9-]{2,60}$') then
    raise exception 'Configuração do agente: modelo inválido' using errcode = '22023';
  end if;
  if p_conf ? 'effort' and p_conf ->> 'effort' not in ('low', 'medium', 'high', 'xhigh', 'max') then
    raise exception 'Configuração do agente: esforço inválido' using errcode = '22023';
  end if;
  if p_conf ? 'code_execution' and jsonb_typeof(p_conf -> 'code_execution') <> 'boolean' then
    raise exception 'Configuração do agente: code_execution precisa ser verdadeiro ou falso' using errcode = '22023';
  end if;
  if p_conf ? 'tools' and jsonb_typeof(p_conf -> 'tools') <> 'array' then
    raise exception 'Configuração do agente: tools precisa ser lista' using errcode = '22023';
  end if;
  if (p_conf ? 'max_turns' and ((p_conf ->> 'max_turns')::numeric not between 1 and 200))
     or (p_conf ? 'max_tool_calls' and ((p_conf ->> 'max_tool_calls')::numeric not between 1 and 500))
     or (p_conf ? 'max_duration_seconds' and ((p_conf ->> 'max_duration_seconds')::numeric not between 30 and 3600))
     or (p_conf ? 'max_budget_usd' and ((p_conf ->> 'max_budget_usd')::numeric <= 0 or (p_conf ->> 'max_budget_usd')::numeric > 50))
     or (p_conf ? 'max_output_tokens' and ((p_conf ->> 'max_output_tokens')::numeric not between 1024 and 128000)) then
    raise exception 'Configuração do agente: limite fora da faixa permitida' using errcode = '22023';
  end if;
end
$$;

-- Substitui o conjunto de vínculos habilitados (desabilita os que saíram;
-- linhas nunca são apagadas: o histórico de vínculo fica).
create or replace function private.dg_uuid_array(p_value jsonb)
returns uuid[]
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_value) <> 'array' then
    raise exception 'Lista de vínculos inválida' using errcode = '22023';
  end if;
  return coalesce((select array_agg(distinct x::uuid) from jsonb_array_elements_text(p_value) x), '{}'::uuid[]);
end
$$;

-- ───────────────────────────── agente ─────────────────────────────────────
-- p_agent: { id?, slug (só na criação), name, description, purpose, status,
--            instructions, configuration, skill_ids?, thesis_ids?, reference_ids? }
create or replace function public.dg_save_agent_once(p_key uuid, p_agent jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prev     jsonb;
  v_id       uuid;
  v_cur      record;
  v_version  uuid;
  v_number   integer;
  v_created  boolean := false;
  v_new      boolean := false;
  v_instr    text := btrim(coalesce(p_agent ->> 'instructions', ''));
  v_conf     jsonb := coalesce(p_agent -> 'configuration', '{}'::jsonb);
  v_status   text := coalesce(nullif(p_agent ->> 'status', ''), 'DRAFT');
  v_skills   uuid[];
  v_theses   uuid[];
  v_refs     uuid[];
  v_response jsonb;
begin
  if not (select private.is_admin()) then
    raise exception 'Somente ADMIN configura agentes' using errcode = '42501';
  end if;
  if p_agent is null or jsonb_typeof(p_agent) <> 'object' then
    raise exception 'Dados do agente inválidos' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_agent ->> 'name', '')), '') is null then
    raise exception 'Nome do agente é obrigatório' using errcode = '23514';
  end if;
  if v_instr = '' then
    raise exception 'Instruções do agente são obrigatórias' using errcode = '23514';
  end if;
  if length(v_instr) > 200000 then
    raise exception 'Instruções do agente: no máximo 200 mil caracteres' using errcode = '23514';
  end if;
  if v_status not in ('ACTIVE', 'INACTIVE', 'DRAFT') then
    raise exception 'Situação do agente inválida' using errcode = '22023';
  end if;
  perform private.dg_validate_agent_configuration(v_conf);
  v_skills := private.dg_uuid_array(p_agent -> 'skill_ids');
  v_theses := private.dg_uuid_array(p_agent -> 'thesis_ids');
  v_refs   := private.dg_uuid_array(p_agent -> 'reference_ids');
  -- O contêiner do provedor carrega no máximo 20 skills por execução.
  if v_skills is not null and cardinality(v_skills) > 20 then
    raise exception 'No máximo 20 skills por agente' using errcode = '23514';
  end if;

  v_prev := private.idempotency_begin('dg.agent.save', p_key, p_agent);
  if v_prev is not null then
    return coalesce(v_prev -> 'response', '{}'::jsonb) || jsonb_build_object('deduplicated', true);
  end if;

  if nullif(p_agent ->> 'id', '') is not null then
    v_id := (p_agent ->> 'id')::uuid;
    select a.id, a.slug, a.current_version_id, v.instructions, v.configuration, v.version_number into v_cur
    from public.agents a
    left join public.agent_versions v on v.id = a.current_version_id
    where a.id = v_id and a.deleted_at is null
    for update of a;
    if v_cur.id is null then
      raise exception 'Agente não encontrado' using errcode = 'P0002';
    end if;
    if nullif(p_agent ->> 'slug', '') is not null and p_agent ->> 'slug' <> v_cur.slug then
      raise exception 'O identificador do agente não muda depois de criado' using errcode = '23514';
    end if;
    if v_cur.current_version_id is null or v_cur.instructions is distinct from v_instr
       or v_cur.configuration is distinct from v_conf then
      insert into public.agent_versions (agent_id, instructions, configuration, created_by)
      values (v_id, v_instr, v_conf, auth.uid())
      returning id, version_number into v_version, v_number;
      v_created := true;
    else
      v_version := v_cur.current_version_id;
      v_number := v_cur.version_number;
    end if;
    update public.agents
       set name = btrim(p_agent ->> 'name'),
           description = nullif(btrim(coalesce(p_agent ->> 'description', '')), ''),
           purpose = nullif(btrim(coalesce(p_agent ->> 'purpose', '')), ''),
           current_version_id = v_version,
           status = v_status
     where id = v_id;
  else
    v_new := true;
    v_id := gen_random_uuid();
    if nullif(p_agent ->> 'slug', '') is null then
      raise exception 'Identificador do agente é obrigatório' using errcode = '23514';
    end if;
    if exists (select 1 from public.agents a where a.slug = p_agent ->> 'slug') then
      raise exception 'Já existe um agente com este identificador' using errcode = '23505';
    end if;
    insert into public.agents (id, slug, name, description, purpose, status)
    values (v_id, p_agent ->> 'slug', btrim(p_agent ->> 'name'),
            nullif(btrim(coalesce(p_agent ->> 'description', '')), ''),
            nullif(btrim(coalesce(p_agent ->> 'purpose', '')), ''), 'DRAFT');
    insert into public.agent_versions (agent_id, instructions, configuration, created_by)
    values (v_id, v_instr, v_conf, auth.uid())
    returning id, version_number into v_version, v_number;
    v_created := true;
    update public.agents set current_version_id = v_version, status = v_status where id = v_id;
  end if;

  if v_skills is not null then
    if exists (select 1 from unnest(v_skills) s
               where not exists (select 1 from public.skills k where k.id = s and k.deleted_at is null)) then
      raise exception 'Skill vinculada não existe' using errcode = '23503';
    end if;
    insert into public.agent_skill_bindings (agent_id, skill_id, enabled)
    select v_id, s, true from unnest(v_skills) s
    on conflict (agent_id, skill_id) do update set enabled = true where not public.agent_skill_bindings.enabled;
    update public.agent_skill_bindings set enabled = false
     where agent_id = v_id and enabled and not (skill_id = any (v_skills));
  end if;
  if v_theses is not null then
    if exists (select 1 from unnest(v_theses) s
               where not exists (select 1 from public.legal_theses t where t.id = s and t.deleted_at is null)) then
      raise exception 'Tese vinculada não existe' using errcode = '23503';
    end if;
    insert into public.agent_thesis_bindings (agent_id, legal_thesis_id, enabled)
    select v_id, s, true from unnest(v_theses) s
    on conflict (agent_id, legal_thesis_id) do update set enabled = true where not public.agent_thesis_bindings.enabled;
    update public.agent_thesis_bindings set enabled = false
     where agent_id = v_id and enabled and not (legal_thesis_id = any (v_theses));
  end if;
  if v_refs is not null then
    if exists (select 1 from unnest(v_refs) s
               where not exists (select 1 from public.reference_materials r where r.id = s and r.deleted_at is null)) then
      raise exception 'Referência vinculada não existe' using errcode = '23503';
    end if;
    insert into public.agent_reference_bindings (agent_id, reference_material_id, enabled)
    select v_id, s, true from unnest(v_refs) s
    on conflict (agent_id, reference_material_id) do update set enabled = true where not public.agent_reference_bindings.enabled;
    update public.agent_reference_bindings set enabled = false
     where agent_id = v_id and enabled and not (reference_material_id = any (v_refs));
  end if;

  v_response := jsonb_build_object('agent_id', v_id, 'version_id', v_version, 'version_number', v_number,
                                   'version_created', v_created, 'created', v_new);
  perform private.idempotency_complete('dg.agent.save', p_key, 'agents', v_id, v_response);
  return v_response || jsonb_build_object('deduplicated', false);
end
$$;

-- Ativar / desativar sem mexer na versão.
create or replace function public.dg_set_agent_status(p_agent_id uuid, p_status text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not (select private.is_admin()) then
    raise exception 'Somente ADMIN configura agentes' using errcode = '42501';
  end if;
  if p_status not in ('ACTIVE', 'INACTIVE', 'DRAFT') then
    raise exception 'Situação do agente inválida' using errcode = '22023';
  end if;
  update public.agents set status = p_status
   where id = p_agent_id and deleted_at is null
     and (p_status <> 'ACTIVE' or current_version_id is not null);
  if not found then
    raise exception 'Agente não encontrado ou sem versão' using errcode = 'P0002';
  end if;
  return jsonb_build_object('agent_id', p_agent_id, 'status', p_status);
end
$$;

-- ───────────────────────────── skill ──────────────────────────────────────
-- p_skill: { id, create (bool), version_id (uuid novo, se o conteúdo mudar),
--            slug (só na criação), name, description, status, instructions,
--            configuration, files: [{path, storage_object_name, mime_type,
--            file_size, checksum_sha256}], keep_paths: [paths da versão
--            corrente que continuam], agent_ids? }
-- Os arquivos novos já estão no Storage em skills/{id}/{version_id}/{path}
-- (o servidor sobe antes e chama esta função; o banco confere o objeto).
create or replace function public.dg_save_skill_once(p_key uuid, p_skill jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prev       jsonb;
  v_id         uuid;
  v_create     boolean := coalesce((p_skill ->> 'create')::boolean, false);
  v_cur        record;
  v_version    uuid;
  v_number     integer;
  v_changed    boolean := false;
  v_instr      text := btrim(coalesce(p_skill ->> 'instructions', ''));
  v_conf       jsonb := coalesce(p_skill -> 'configuration', '{}'::jsonb);
  v_status     text := coalesce(nullif(p_skill ->> 'status', ''), 'DRAFT');
  v_files      jsonb := coalesce(p_skill -> 'files', '[]'::jsonb);
  v_keep       text[];
  v_cur_paths  text[];
  v_agents     uuid[];
  f            jsonb;
  v_total      bigint;
  v_response   jsonb;
begin
  if not (select private.is_admin()) then
    raise exception 'Somente ADMIN configura skills' using errcode = '42501';
  end if;
  if p_skill is null or jsonb_typeof(p_skill) <> 'object' or nullif(p_skill ->> 'id', '') is null then
    raise exception 'Dados da skill inválidos' using errcode = '22023';
  end if;
  v_id := (p_skill ->> 'id')::uuid;
  if nullif(btrim(coalesce(p_skill ->> 'name', '')), '') is null then
    raise exception 'Nome da skill é obrigatório' using errcode = '23514';
  end if;
  if v_instr = '' then
    raise exception 'Instruções da skill são obrigatórias' using errcode = '23514';
  end if;
  if length(v_instr) > 200000 then
    raise exception 'Instruções da skill: no máximo 200 mil caracteres' using errcode = '23514';
  end if;
  if length(coalesce(p_skill ->> 'description', '')) > 1024 then
    raise exception 'Descrição da skill: no máximo 1.024 caracteres' using errcode = '23514';
  end if;
  if v_status not in ('ACTIVE', 'DRAFT', 'DEPRECATED') then
    raise exception 'Situação da skill inválida' using errcode = '22023';
  end if;
  if jsonb_typeof(v_conf) <> 'object' or pg_column_size(v_conf) > 16384 then
    raise exception 'Configuração da skill inválida' using errcode = '22023';
  end if;
  if jsonb_typeof(v_files) <> 'array' or jsonb_array_length(v_files) > 200 then
    raise exception 'Lista de arquivos inválida (no máximo 200)' using errcode = '22023';
  end if;
  v_agents := private.dg_uuid_array(p_skill -> 'agent_ids');
  if p_skill -> 'keep_paths' is not null and jsonb_typeof(p_skill -> 'keep_paths') = 'array' then
    v_keep := array(select jsonb_array_elements_text(p_skill -> 'keep_paths'));
  end if;

  v_prev := private.idempotency_begin('dg.skill.save', p_key, p_skill);
  if v_prev is not null then
    return coalesce(v_prev -> 'response', '{}'::jsonb) || jsonb_build_object('deduplicated', true);
  end if;

  if v_create then
    -- Nome reservado pelo provedor (Skills API): "anthropic" e "claude".
    if coalesce(p_skill ->> 'slug', '') ~ '(anthropic|claude)' then
      raise exception 'O identificador da skill não pode conter "anthropic" nem "claude"' using errcode = '23514';
    end if;
    if exists (select 1 from public.skills s where s.id = v_id or s.slug = p_skill ->> 'slug') then
      raise exception 'Já existe uma skill com este identificador' using errcode = '23505';
    end if;
    insert into public.skills (id, slug, name, description, status)
    values (v_id, p_skill ->> 'slug', btrim(p_skill ->> 'name'),
            nullif(btrim(coalesce(p_skill ->> 'description', '')), ''), 'DRAFT');
    v_changed := true;
    v_cur_paths := '{}';
  else
    select s.id, s.slug, s.current_version_id, sv.instructions, sv.configuration, sv.version_number into v_cur
    from public.skills s
    left join public.skill_versions sv on sv.id = s.current_version_id
    where s.id = v_id and s.deleted_at is null
    for update of s;
    if v_cur.id is null then
      raise exception 'Skill não encontrada' using errcode = 'P0002';
    end if;
    if nullif(p_skill ->> 'slug', '') is not null and p_skill ->> 'slug' <> v_cur.slug then
      raise exception 'O identificador da skill não muda depois de criado' using errcode = '23514';
    end if;
    v_cur_paths := coalesce((select array_agg(f2.path order by f2.path) from public.skill_version_files f2
                             where f2.skill_version_id = v_cur.current_version_id), '{}');
    if v_keep is null then
      v_keep := v_cur_paths;
    end if;
    if exists (select 1 from unnest(v_keep) k where not (k = any (v_cur_paths))) then
      raise exception 'Arquivo mantido não existe na versão atual' using errcode = '23514';
    end if;
    v_changed := v_cur.current_version_id is null
              or v_cur.instructions is distinct from v_instr
              or v_cur.configuration is distinct from v_conf
              or jsonb_array_length(v_files) > 0
              or cardinality(v_keep) <> cardinality(v_cur_paths);
  end if;

  if v_changed then
    if nullif(p_skill ->> 'version_id', '') is null then
      raise exception 'version_id é obrigatório para criar versão' using errcode = '22023';
    end if;
    v_version := (p_skill ->> 'version_id')::uuid;
    insert into public.skill_versions (id, skill_id, instructions, configuration, created_by)
    values (v_version, v_id, v_instr, v_conf, auth.uid())
    returning version_number into v_number;

    -- Arquivos mantidos: mesmas linhas da versão anterior (mesmo objeto).
    if not v_create and cardinality(v_keep) > 0 then
      insert into public.skill_version_files
        (skill_id, skill_version_id, path, storage_object_name, mime_type, file_size, checksum_sha256, created_by)
      select v_id, v_version, f2.path, f2.storage_object_name, f2.mime_type, f2.file_size, f2.checksum_sha256, auth.uid()
      from public.skill_version_files f2
      where f2.skill_version_id = v_cur.current_version_id and f2.path = any (v_keep);
    end if;

    for f in select * from jsonb_array_elements(v_files) loop
      if f ->> 'storage_object_name' is distinct from
         format('skills/%s/%s/%s', v_id, v_version, f ->> 'path') then
        raise exception 'Arquivo fora do caminho da versão: %', f ->> 'path' using errcode = '23514';
      end if;
      if not private.dg_storage_object_exists('skill-files', f ->> 'storage_object_name') then
        raise exception 'Arquivo não encontrado no Storage: %', f ->> 'path' using errcode = '23514';
      end if;
      insert into public.skill_version_files
        (skill_id, skill_version_id, path, storage_object_name, mime_type, file_size, checksum_sha256, created_by)
      values (v_id, v_version, f ->> 'path', f ->> 'storage_object_name', f ->> 'mime_type',
              (f ->> 'file_size')::bigint, f ->> 'checksum_sha256', auth.uid());
    end loop;

    select coalesce(sum(x.file_size), 0) into v_total from public.skill_version_files x where x.skill_version_id = v_version;
    -- Limite do provedor: 30 MB por skill (com o SKILL.md); folga para ele.
    if v_total > 26214400 then
      raise exception 'Arquivos da skill somam mais de 25 MB' using errcode = '23514';
    end if;
  else
    v_version := v_cur.current_version_id;
    v_number := v_cur.version_number;
  end if;

  update public.skills
     set name = btrim(p_skill ->> 'name'),
         description = nullif(btrim(coalesce(p_skill ->> 'description', '')), ''),
         current_version_id = v_version,
         status = v_status
   where id = v_id;

  if v_agents is not null then
    insert into public.agent_skill_bindings (agent_id, skill_id, enabled)
    select a, v_id, true from unnest(v_agents) a
    on conflict (agent_id, skill_id) do update set enabled = true where not public.agent_skill_bindings.enabled;
    update public.agent_skill_bindings set enabled = false
     where skill_id = v_id and enabled and not (agent_id = any (v_agents));
    if exists (select 1 from public.agent_skill_bindings b where b.skill_id = v_id and b.enabled
               group by b.agent_id having (select count(*) from public.agent_skill_bindings c
                                           where c.agent_id = b.agent_id and c.enabled) > 20) then
      raise exception 'Um agente ficaria com mais de 20 skills' using errcode = '23514';
    end if;
  end if;

  v_response := jsonb_build_object('skill_id', v_id, 'version_id', v_version, 'version_number', v_number,
                                   'version_created', v_changed, 'created', v_create);
  perform private.idempotency_complete('dg.skill.save', p_key, 'skills', v_id, v_response);
  return v_response || jsonb_build_object('deduplicated', false);
end
$$;

-- ───────────────────────────── tese ───────────────────────────────────────
-- p_thesis: { id?, slug (só na criação), title, description, legal_area_id,
--             status, foundations, application_criteria, exclusion_criteria,
--             notes, agent_ids?, skill_ids?, reference_ids? }
create or replace function public.dg_save_thesis_once(p_key uuid, p_thesis jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prev     jsonb;
  v_id       uuid;
  v_cur      record;
  v_version  uuid;
  v_number   integer;
  v_changed  boolean := false;
  v_new      boolean := false;
  v_status   text := coalesce(nullif(p_thesis ->> 'status', ''), 'DRAFT');
  v_agents   uuid[];
  v_skills   uuid[];
  v_refs     uuid[];
  v_response jsonb;
begin
  if not (select private.is_admin()) then
    raise exception 'Somente ADMIN configura teses' using errcode = '42501';
  end if;
  if p_thesis is null or jsonb_typeof(p_thesis) <> 'object' then
    raise exception 'Dados da tese inválidos' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_thesis ->> 'title', '')), '') is null then
    raise exception 'Título da tese é obrigatório' using errcode = '23514';
  end if;
  if v_status not in ('ACTIVE', 'IN_REVIEW', 'DRAFT', 'ARCHIVED') then
    raise exception 'Situação da tese inválida' using errcode = '22023';
  end if;
  v_agents := private.dg_uuid_array(p_thesis -> 'agent_ids');
  v_skills := private.dg_uuid_array(p_thesis -> 'skill_ids');
  v_refs   := private.dg_uuid_array(p_thesis -> 'reference_ids');

  v_prev := private.idempotency_begin('dg.thesis.save', p_key, p_thesis);
  if v_prev is not null then
    return coalesce(v_prev -> 'response', '{}'::jsonb) || jsonb_build_object('deduplicated', true);
  end if;

  if nullif(p_thesis ->> 'id', '') is not null then
    v_id := (p_thesis ->> 'id')::uuid;
    select t.id, t.slug, t.current_version_id, v.foundations, v.application_criteria, v.exclusion_criteria,
           v.notes, v.version_number into v_cur
    from public.legal_theses t
    left join public.legal_thesis_versions v on v.id = t.current_version_id
    where t.id = v_id and t.deleted_at is null
    for update of t;
    if v_cur.id is null then
      raise exception 'Tese não encontrada' using errcode = 'P0002';
    end if;
    if nullif(p_thesis ->> 'slug', '') is not null and p_thesis ->> 'slug' <> v_cur.slug then
      raise exception 'O identificador da tese não muda depois de criado' using errcode = '23514';
    end if;
    v_changed := v_cur.current_version_id is null
              or v_cur.foundations is distinct from nullif(p_thesis ->> 'foundations', '')
              or v_cur.application_criteria is distinct from nullif(p_thesis ->> 'application_criteria', '')
              or v_cur.exclusion_criteria is distinct from nullif(p_thesis ->> 'exclusion_criteria', '')
              or v_cur.notes is distinct from nullif(p_thesis ->> 'notes', '');
  else
    v_new := true;
    v_changed := true;
    v_id := gen_random_uuid();
    if nullif(p_thesis ->> 'slug', '') is null or nullif(p_thesis ->> 'legal_area_id', '') is null then
      raise exception 'Identificador e área da tese são obrigatórios' using errcode = '23514';
    end if;
    if exists (select 1 from public.legal_theses t where t.slug = p_thesis ->> 'slug') then
      raise exception 'Já existe uma tese com este identificador' using errcode = '23505';
    end if;
    insert into public.legal_theses (id, legal_area_id, slug, title, description, status)
    values (v_id, (p_thesis ->> 'legal_area_id')::uuid, p_thesis ->> 'slug', btrim(p_thesis ->> 'title'),
            nullif(btrim(coalesce(p_thesis ->> 'description', '')), ''), 'DRAFT');
  end if;

  if v_changed then
    insert into public.legal_thesis_versions (legal_thesis_id, foundations, application_criteria, exclusion_criteria, notes, created_by)
    values (v_id, nullif(p_thesis ->> 'foundations', ''), nullif(p_thesis ->> 'application_criteria', ''),
            nullif(p_thesis ->> 'exclusion_criteria', ''), nullif(p_thesis ->> 'notes', ''), auth.uid())
    returning id, version_number into v_version, v_number;
  else
    v_version := v_cur.current_version_id;
    v_number := v_cur.version_number;
  end if;

  update public.legal_theses
     set title = btrim(p_thesis ->> 'title'),
         description = nullif(btrim(coalesce(p_thesis ->> 'description', '')), ''),
         legal_area_id = coalesce(nullif(p_thesis ->> 'legal_area_id', '')::uuid, legal_area_id),
         current_version_id = v_version,
         status = v_status
   where id = v_id;

  if v_agents is not null then
    insert into public.agent_thesis_bindings (agent_id, legal_thesis_id, enabled)
    select a, v_id, true from unnest(v_agents) a
    on conflict (agent_id, legal_thesis_id) do update set enabled = true where not public.agent_thesis_bindings.enabled;
    update public.agent_thesis_bindings set enabled = false
     where legal_thesis_id = v_id and enabled and not (agent_id = any (v_agents));
  end if;
  if v_skills is not null then
    insert into public.thesis_skill_bindings (legal_thesis_id, skill_id, enabled)
    select v_id, s, true from unnest(v_skills) s
    on conflict (legal_thesis_id, skill_id) do update set enabled = true where not public.thesis_skill_bindings.enabled;
    update public.thesis_skill_bindings set enabled = false
     where legal_thesis_id = v_id and enabled and not (skill_id = any (v_skills));
  end if;
  if v_refs is not null then
    insert into public.thesis_reference_bindings (legal_thesis_id, reference_material_id, enabled)
    select v_id, r, true from unnest(v_refs) r
    on conflict (legal_thesis_id, reference_material_id) do update set enabled = true where not public.thesis_reference_bindings.enabled;
    update public.thesis_reference_bindings set enabled = false
     where legal_thesis_id = v_id and enabled and not (reference_material_id = any (v_refs));
  end if;

  v_response := jsonb_build_object('thesis_id', v_id, 'version_id', v_version, 'version_number', v_number,
                                   'version_created', v_changed, 'created', v_new);
  perform private.idempotency_complete('dg.thesis.save', p_key, 'legal_theses', v_id, v_response);
  return v_response || jsonb_build_object('deduplicated', false);
end
$$;

-- ───────────────────────────── referência ─────────────────────────────────
-- p_ref: { id, create (bool), version_id (se houver conteúdo novo), type,
--          title, description, legal_area_id, tags, status, content_text?,
--          storage_object_name? (references/{id}/{version_id}/{arquivo}),
--          original_filename?, agent_ids?, skill_ids?, thesis_ids? }
create or replace function public.dg_save_reference_once(p_key uuid, p_ref jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prev     jsonb;
  v_id       uuid;
  v_create   boolean := coalesce((p_ref ->> 'create')::boolean, false);
  v_version  uuid;
  v_number   integer;
  v_content  boolean := nullif(p_ref ->> 'content_text', '') is not null or nullif(p_ref ->> 'storage_object_name', '') is not null;
  v_status   text := coalesce(nullif(p_ref ->> 'status', ''), 'ACTIVE');
  v_tags     text[];
  v_agents   uuid[];
  v_skills   uuid[];
  v_theses   uuid[];
  v_response jsonb;
begin
  if not (select private.is_admin()) then
    raise exception 'Somente ADMIN configura referências' using errcode = '42501';
  end if;
  if p_ref is null or jsonb_typeof(p_ref) <> 'object' or nullif(p_ref ->> 'id', '') is null then
    raise exception 'Dados da referência inválidos' using errcode = '22023';
  end if;
  v_id := (p_ref ->> 'id')::uuid;
  if nullif(btrim(coalesce(p_ref ->> 'title', '')), '') is null then
    raise exception 'Título da referência é obrigatório' using errcode = '23514';
  end if;
  if v_status not in ('ACTIVE', 'DRAFT', 'ARCHIVED') then
    raise exception 'Situação da referência inválida' using errcode = '22023';
  end if;
  if length(coalesce(p_ref ->> 'content_text', '')) > 500000 then
    raise exception 'Texto da referência: no máximo 500 mil caracteres' using errcode = '23514';
  end if;
  v_tags := coalesce((select array_agg(distinct lower(btrim(t))) from jsonb_array_elements_text(coalesce(p_ref -> 'tags', '[]'::jsonb)) t
                      where btrim(t) <> ''), '{}');
  v_agents := private.dg_uuid_array(p_ref -> 'agent_ids');
  v_skills := private.dg_uuid_array(p_ref -> 'skill_ids');
  v_theses := private.dg_uuid_array(p_ref -> 'thesis_ids');

  v_prev := private.idempotency_begin('dg.reference.save', p_key, p_ref);
  if v_prev is not null then
    return coalesce(v_prev -> 'response', '{}'::jsonb) || jsonb_build_object('deduplicated', true);
  end if;

  if v_create then
    if not v_content then
      raise exception 'Referência precisa de texto ou arquivo' using errcode = '23514';
    end if;
    insert into public.reference_materials (id, type, title, description, legal_area_id, tags, status, created_by)
    values (v_id, coalesce(nullif(p_ref ->> 'type', ''), 'OTHER'), btrim(p_ref ->> 'title'),
            nullif(btrim(coalesce(p_ref ->> 'description', '')), ''),
            nullif(p_ref ->> 'legal_area_id', '')::uuid, v_tags, 'DRAFT', auth.uid());
  elsif not exists (select 1 from public.reference_materials r where r.id = v_id and r.deleted_at is null) then
    raise exception 'Referência não encontrada' using errcode = 'P0002';
  end if;

  if v_content then
    if nullif(p_ref ->> 'version_id', '') is null then
      raise exception 'version_id é obrigatório para conteúdo novo' using errcode = '22023';
    end if;
    v_version := (p_ref ->> 'version_id')::uuid;
    if nullif(p_ref ->> 'storage_object_name', '') is not null
       and not private.dg_storage_object_exists('reference-materials', p_ref ->> 'storage_object_name') then
      raise exception 'Arquivo da referência não encontrado no Storage' using errcode = '23514';
    end if;
    insert into public.reference_material_versions
      (id, reference_material_id, storage_object_name, content_text, metadata, created_by)
    values (v_version, v_id, nullif(p_ref ->> 'storage_object_name', ''), nullif(p_ref ->> 'content_text', ''),
            jsonb_strip_nulls(jsonb_build_object('original_filename', nullif(p_ref ->> 'original_filename', ''),
                                                 'mime_type', nullif(p_ref ->> 'mime_type', ''),
                                                 'file_size', nullif(p_ref ->> 'file_size', ''))),
            auth.uid())
    returning version_number into v_number;
  else
    select r.current_version_id, v.version_number into v_version, v_number
    from public.reference_materials r left join public.reference_material_versions v on v.id = r.current_version_id
    where r.id = v_id;
  end if;

  update public.reference_materials
     set type = coalesce(nullif(p_ref ->> 'type', ''), type),
         title = btrim(p_ref ->> 'title'),
         description = nullif(btrim(coalesce(p_ref ->> 'description', '')), ''),
         legal_area_id = nullif(p_ref ->> 'legal_area_id', '')::uuid,
         tags = v_tags,
         current_version_id = v_version,
         status = v_status
   where id = v_id;

  if v_agents is not null then
    insert into public.agent_reference_bindings (agent_id, reference_material_id, enabled)
    select a, v_id, true from unnest(v_agents) a
    on conflict (agent_id, reference_material_id) do update set enabled = true where not public.agent_reference_bindings.enabled;
    update public.agent_reference_bindings set enabled = false
     where reference_material_id = v_id and enabled and not (agent_id = any (v_agents));
  end if;
  if v_skills is not null then
    insert into public.skill_reference_bindings (skill_id, reference_material_id, enabled)
    select s, v_id, true from unnest(v_skills) s
    on conflict (skill_id, reference_material_id) do update set enabled = true where not public.skill_reference_bindings.enabled;
    update public.skill_reference_bindings set enabled = false
     where reference_material_id = v_id and enabled and not (skill_id = any (v_skills));
  end if;
  if v_theses is not null then
    insert into public.thesis_reference_bindings (legal_thesis_id, reference_material_id, enabled)
    select t, v_id, true from unnest(v_theses) t
    on conflict (legal_thesis_id, reference_material_id) do update set enabled = true where not public.thesis_reference_bindings.enabled;
    update public.thesis_reference_bindings set enabled = false
     where reference_material_id = v_id and enabled and not (legal_thesis_id = any (v_theses));
  end if;

  v_response := jsonb_build_object('reference_id', v_id, 'version_id', v_version, 'version_number', v_number,
                                   'version_created', v_content, 'created', v_create);
  perform private.idempotency_complete('dg.reference.save', p_key, 'reference_materials', v_id, v_response);
  return v_response || jsonb_build_object('deduplicated', false);
end
$$;

-- Template de análise → agente que a executa (029 usa primary_agent_id).
create or replace function public.dg_set_template_agent(p_template_id uuid, p_agent_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not (select private.is_admin()) then
    raise exception 'Somente ADMIN configura templates de análise' using errcode = '42501';
  end if;
  if p_agent_id is not null and not exists (select 1 from public.agents a where a.id = p_agent_id and a.deleted_at is null) then
    raise exception 'Agente não encontrado' using errcode = 'P0002';
  end if;
  update public.analysis_templates set primary_agent_id = p_agent_id where id = p_template_id;
  if not found then
    raise exception 'Template não encontrado' using errcode = 'P0002';
  end if;
  return jsonb_build_object('template_id', p_template_id, 'agent_id', p_agent_id);
end
$$;

-- ───────────────────────────── leitura para as telas ──────────────────────

-- Uma execução, para a tela: situação, o que ela entregou (com a revisão de
-- cada item) e as tentativas ligadas. Mesmo acesso das listas (031): ADMIN
-- todas; LAWYER as de casos que acessa. Uso, custo, modelo e configuração só
-- para ADMIN. Nunca entrada livre nem erro técnico bruto para LAWYER.
create or replace function private.get_agent_run_detail(p_agent_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin boolean;
  v_run   record;
begin
  if auth.uid() is null or not exists (select 1 from private.current_membership()) then
    raise exception 'Sem sessão liberada' using errcode = '42501';
  end if;
  if not private.has_internal_role('ADMIN', 'LAWYER') then
    raise exception 'Execuções de agente são visíveis só a ADMIN e LAWYER' using errcode = '42501';
  end if;
  v_admin := private.is_admin();

  select r.*, a.name as agent_name, a.slug as agent_slug into v_run
  from public.agent_runs r join public.agents a on a.id = r.agent_id
  where r.id = p_agent_run_id;
  if v_run.id is null
     or (not v_admin and (v_run.legal_case_id is null or not private.can_access_case(v_run.legal_case_id))) then
    raise exception 'Execução não encontrada' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'id', v_run.id,
    'agent', jsonb_build_object('id', v_run.agent_id, 'name', v_run.agent_name, 'slug', v_run.agent_slug),
    'status', v_run.status,
    'cancel_requested', v_run.cancel_requested_at is not null,
    'error_code', v_run.error_code,
    'attempt', v_run.attempt,
    'legal_case_id', v_run.legal_case_id,
    'legal_process_id', v_run.legal_process_id,
    'created_at', v_run.created_at,
    'started_at', v_run.started_at,
    'completed_at', v_run.completed_at,
    'retry_of_agent_run_id', v_run.retry_of_agent_run_id,
    'retried_by', coalesce((select jsonb_agg(x.id order by x.created_at) from public.agent_runs x
                            where x.retry_of_agent_run_id = v_run.id), '[]'::jsonb),
    'analysis_id', (select a.id from public.legal_analyses a where a.agent_run_id = v_run.id limit 1),
    'proposals', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'type', p.proposal_type, 'status', p.status, 'summary', p.payload ->> 'summary',
        'review_id', (select rv.id from public.reviews rv where rv.agent_proposal_id = p.id order by rv.created_at desc limit 1),
        'application_error', case when v_admin then p.application_error end) order by p.created_at)
      from public.agent_proposals p where p.agent_run_id = v_run.id), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(jsonb_build_object(
        'version_id', v.id, 'document_id', d.id, 'title', d.title, 'version_number', v.version_number,
        'review_id', rv.id, 'review_status', rv.status) order by v.created_at)
      from jsonb_array_elements_text(coalesce(v_run.metadata -> 'documents', '[]'::jsonb)) dv(version_id)
      join public.document_versions v on v.id = dv.version_id::uuid
      join public.documents d on d.id = v.document_id
      left join lateral (select x.id, x.status from public.reviews x where x.document_version_id = v.id
                         order by x.created_at desc limit 1) rv on true), '[]'::jsonb),
    'analysis_result', (select jsonb_build_object('id', lr.id, 'summary', lr.summary,
        'review_id', rv.id, 'review_status', rv.status)
      from public.legal_analysis_results lr
      left join lateral (select x.id, x.status from public.reviews x where x.legal_analysis_result_id = lr.id
                         order by x.created_at desc limit 1) rv on true
      where lr.agent_run_id = v_run.id),
    'usage', case when v_admin then jsonb_build_object(
        'provider', v_run.provider, 'model', v_run.model,
        'input_tokens', v_run.input_tokens, 'output_tokens', v_run.output_tokens,
        'estimated_cost', v_run.estimated_cost, 'currency', v_run.estimated_cost_currency,
        'details', v_run.metadata -> 'usage', 'tools_used', v_run.metadata -> 'tools_used',
        'error_message', v_run.error_message) end,
    'config', case when v_admin then v_run.config_snapshot end
  );
end
$$;

create or replace function public.get_agent_run_detail(p_agent_run_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.get_agent_run_detail(p_agent_run_id) $$;

-- Uso da IA (ADMIN): execuções, tokens e custo estimado por dia, agente e
-- modelo, no período. Só números agregados.
create or replace function private.get_ai_usage_summary(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_since timestamptz;
begin
  if auth.uid() is null or not exists (select 1 from private.current_membership()) then
    raise exception 'Sem sessão liberada' using errcode = '42501';
  end if;
  if not private.is_admin() then
    raise exception 'Somente ADMIN vê o uso da IA' using errcode = '42501';
  end if;
  v_since := date_trunc('day', now()) - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365) - 1);

  return jsonb_build_object(
    'since', v_since,
    'days', least(greatest(coalesce(p_days, 30), 1), 365),
    'totals', (select jsonb_build_object(
        'runs', count(*),
        'completed', count(*) filter (where r.status = 'COMPLETED'),
        'waiting_human', count(*) filter (where r.status = 'WAITING_HUMAN'),
        'failed', count(*) filter (where r.status = 'FAILED'),
        'cancelled', count(*) filter (where r.status = 'CANCELLED'),
        'active', count(*) filter (where r.status in ('QUEUED', 'RUNNING')),
        'input_tokens', coalesce(sum(r.input_tokens), 0),
        'output_tokens', coalesce(sum(r.output_tokens), 0),
        'estimated_cost', coalesce(sum(r.estimated_cost), 0))
      from public.agent_runs r where r.created_at >= v_since),
    'by_agent', coalesce((select jsonb_agg(x order by x ->> 'name') from (
        select jsonb_build_object('agent_id', a.id, 'name', a.name, 'runs', count(*),
               'failed', count(*) filter (where r.status = 'FAILED'),
               'input_tokens', coalesce(sum(r.input_tokens), 0), 'output_tokens', coalesce(sum(r.output_tokens), 0),
               'estimated_cost', coalesce(sum(r.estimated_cost), 0)) x
        from public.agent_runs r join public.agents a on a.id = r.agent_id
        where r.created_at >= v_since group by a.id, a.name) s), '[]'::jsonb),
    'by_day', coalesce((select jsonb_agg(x order by x ->> 'day') from (
        select jsonb_build_object('day', to_char(date_trunc('day', r.created_at), 'YYYY-MM-DD'), 'runs', count(*),
               'input_tokens', coalesce(sum(r.input_tokens), 0), 'output_tokens', coalesce(sum(r.output_tokens), 0),
               'estimated_cost', coalesce(sum(r.estimated_cost), 0)) x
        from public.agent_runs r where r.created_at >= v_since group by date_trunc('day', r.created_at)) s), '[]'::jsonb),
    'by_model', coalesce((select jsonb_agg(x order by x ->> 'model') from (
        select jsonb_build_object('model', coalesce(r.model, '—'), 'runs', count(*),
               'input_tokens', coalesce(sum(r.input_tokens), 0), 'output_tokens', coalesce(sum(r.output_tokens), 0),
               'estimated_cost', coalesce(sum(r.estimated_cost), 0)) x
        from public.agent_runs r where r.created_at >= v_since group by coalesce(r.model, '—')) s), '[]'::jsonb)
  );
end
$$;

create or replace function public.get_ai_usage_summary(p_days integer default 30)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.get_ai_usage_summary(p_days) $$;

-- ═════════════════════════════ 7. órfãos no Storage ══════════════════════

create or replace function private.find_orphan_storage_objects(p_older_than interval default interval '24 hours')
returns table (bucket_id text, object_name text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select o.bucket_id, o.name, o.created_at
  from storage.objects o
  where o.created_at < now() - p_older_than
    and (
      (o.bucket_id = 'legal-documents'
       and not exists (select 1 from public.document_versions v where v.storage_object_name = o.name))
      or
      (o.bucket_id = 'reference-materials'
       and not exists (select 1 from public.reference_material_versions v where v.storage_object_name = o.name))
      or
      (o.bucket_id = 'imports'
       and not exists (select 1 from public.import_jobs j where j.storage_object_name = o.name))
      or
      (o.bucket_id = 'skill-files'
       and not exists (select 1 from public.skill_version_files f where f.storage_object_name = o.name))
    )
  order by o.created_at
$$;

-- ═════════════════════════════ 8. grants ═════════════════════════════════

do $$
declare
  f regprocedure;
begin
  -- Fechadas para todos; abertas abaixo só para quem precisa.
  for f in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('get_ai_runtime_status', 'set_ai_execution_enabled', 'worker_ai_enabled',
                        'dg_storage_object_exists', 'worker_register_skill_upload',
                        'reviews_validate_analysis_result', 'reviews_sync_analysis', 'worker_submit_analysis_result',
                        'agent_runs_retry_guard', 'worker_record_run_config', 'worker_open_document',
                        'worker_run_context', 'retry_agent_run_once', 'link_analysis_retry',
                        'agent_run_has_pending_outputs', 'worker_close_run_if_decided', 'worker_close_decided_runs',
                        'dg_validate_agent_configuration', 'dg_uuid_array',
                        'get_agent_run_detail', 'get_ai_usage_summary', 'find_orphan_storage_objects')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;

  for f in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('get_ai_runtime_status', 'set_ai_execution_enabled', 'retry_agent_run_once',
                        'send_legal_analysis_once', 'dg_save_agent_once', 'dg_set_agent_status',
                        'dg_save_skill_once', 'dg_save_thesis_once', 'dg_save_reference_once',
                        'dg_set_template_agent', 'get_agent_run_detail', 'get_ai_usage_summary')
  loop
    execute format('revoke all on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end
$$;

-- Usuário logado: as portas privadas que as públicas (invoker) chamam.
grant execute on function private.get_ai_runtime_status() to authenticated;
grant execute on function private.set_ai_execution_enabled(boolean, text) to authenticated;
grant execute on function private.retry_agent_run_once(uuid, uuid) to authenticated;
grant execute on function private.link_analysis_retry(uuid, uuid, uuid) to authenticated;
grant execute on function private.get_agent_run_detail(uuid) to authenticated;
grant execute on function private.get_ai_usage_summary(integer) to authenticated;
grant execute on function private.dg_validate_agent_configuration(jsonb) to authenticated;
grant execute on function private.dg_uuid_array(jsonb) to authenticated;
grant execute on function private.dg_storage_object_exists(text, text) to authenticated;

-- Worker: só as portas de entrada, com a reserva.
grant execute on function private.worker_ai_enabled() to dg_worker;
grant execute on function private.worker_register_skill_upload(uuid, text, uuid, text, text, text, text) to dg_worker;
grant execute on function private.worker_submit_analysis_result(uuid, text, text, jsonb, integer) to dg_worker;
grant execute on function private.worker_record_run_config(uuid, text, jsonb) to dg_worker;
grant execute on function private.worker_open_document(uuid, text, uuid) to dg_worker;
grant execute on function private.worker_run_context(uuid, text) to dg_worker;
grant execute on function private.worker_close_decided_runs() to dg_worker;

grant execute on function private.find_orphan_storage_objects(interval) to service_role;
