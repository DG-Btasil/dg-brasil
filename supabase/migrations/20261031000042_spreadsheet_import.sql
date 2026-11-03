-- DG Brasil — 042: importação de planilhas CSV/XLSX (Etapa 7)
--
-- Sobre o schema da 013 (import_jobs, import_column_mappings,
-- import_row_results, import_conflicts), esta migration põe o fluxo para
-- funcionar de ponta a ponta. Toda etapa é uma operação controlada do banco
-- (ADMIN, JWT do usuário); a tela nunca escreve direto nas tabelas.
--
--   1. import_create_job          cria o job (UPLOADED) e devolve o caminho no
--                                 bucket `imports`; o servidor assina o upload
--                                 SÓ para esse caminho (mesmo padrão dos documentos).
--   2. import_authorize_file      devolve o caminho para o servidor ler o arquivo.
--      import_register_columns    cabeçalho, aba e checksum (aviso de arquivo
--                                 repetido) → COLUMNS_DETECTED. import_fail: arquivo
--                                 ilegível → FAILED.
--   3. import_save_mapping        coluna → campo + opções (área dos casos e advogado
--                                 padrão) → MAPPED.
--   4. import_stage_rows          SIMULAÇÃO. O servidor valida o formato de cada
--      import_finish_dry_run      linha e grava o resultado; o banco confronta com o
--                                 que já existe (CPF/CNPJ, CNJ, nome igual com outro
--                                 documento, cadastro excluído) e abre os conflitos
--                                 → VALIDATED | CONFLICTS_PENDING. Nada é gravado em
--                                 clientes, casos ou processos.
--   5. import_resolve_conflicts   decisão humana por conflito (ou por tipo).
--      get_import_plan            prévia: o que será criado, atualizado e ignorado —
--                                 calculada pela MESMA regra que grava
--                                 (private.import_row_actions).
--   6. import_confirm             → CONFIRMED (autor e hora, pelo gatilho da 013).
--   7. import_process_batch       grava em lotes curtos (cabe no statement_timeout
--                                 do usuário). Cada linha numa subtransação: a que
--                                 falha vira ERROR com o motivo e não derruba as
--                                 outras. PROCESSING → COMPLETED.
--   8. relatório                  import_row_results: status, erros, avisos e
--                                 `outcome` (ids do que a linha criou/atualizou).
--
-- Regras de negócio da importação:
--   - Todo processo pertence a um caso, e todo caso a um cliente: a linha com
--     processo cria cliente (ou usa o existente) + caso + processo. O caso nasce
--     IN_PROGRESS (ou CLOSED, se o processo está encerrado/arquivado), origem no
--     escritório proprietário, com o advogado da linha (ADMIN/LAWYER) ou o
--     advogado padrão escolhido no mapeamento.
--   - Mesmo CPF/CNPJ em várias linhas = UM cliente; vale a primeira linha.
--   - Linha de processo SEM CPF/CNPJ (ex.: relatório de processos do ADVBOX,
--     que só traz o nome do cliente): o processo é ligado ao cliente JÁ
--     cadastrado com o mesmo nome (sem acento/caixa) — exatamente um. Nenhum ou
--     mais de um homônimo: a linha fica de fora, com o motivo. O cadastro desse
--     cliente não muda (a decisão já nasce "Manter", e pode ser trocada).
--   - CPF/CNPJ já cadastrado: Atualizar (só os campos preenchidos na planilha) ou
--     Manter o cadastro (os processos da linha são vinculados a ele). Nunca cria
--     outro cliente (constraint da 013).
--   - CNJ já cadastrado: Atualizar (só campos preenchidos) ou Ignorar.
--   - Nome igual (sem acento/caixa) a cliente com OUTRO documento: possível
--     duplicata — Criar mesmo assim ou Ignorar as linhas desse cliente.
--   - Vencimento informado vira prazo só em processo NOVO (em processo existente
--     não, para não duplicar prazo).
--   - Linha com erro nunca é gravada; nada é gravado em silêncio.
--
-- Retenção: a linha original (raw_data) e a linha normalizada (payload) têm
-- dado pessoal e são apagadas 30 dias depois do fim do job; o arquivo no
-- Storage é apagado pelo servidor quando o job termina. Jobs abandonados antes
-- da confirmação são cancelados depois de 7 dias (private.import_housekeeping).
--
-- Pós-baseline: 001–041 não são alteradas. purge_import_raw_data (013) é
-- redefinida para apagar também o payload.

-- ═════════════════════════════ 1. colunas ════════════════════════════════

alter table public.import_jobs
  add column options jsonb not null default '{}'
    constraint import_jobs_options_object check (jsonb_typeof(options) = 'object'),
  add column source_file_deleted_at timestamptz;

comment on column public.import_jobs.options is
  'Opções da importação: legal_area_id (área dos casos criados) e lawyer_id (advogado padrão).';

alter table public.import_row_results
  add column payload jsonb
    constraint import_row_results_payload_object check (payload is null or jsonb_typeof(payload) = 'object'),
  add column outcome jsonb
    constraint import_row_results_outcome_object check (outcome is null or jsonb_typeof(outcome) = 'object');

comment on column public.import_row_results.payload is
  'Linha normalizada pelo servidor na simulação (cliente/processo). Dado pessoal: apagado com raw_data.';
comment on column public.import_row_results.outcome is
  'O que o processamento fez com a linha: ações e ids (cliente, caso, processo, prazo). Só ids.';

create index import_row_results_pending_idx on public.import_row_results (import_job_id, row_number)
  where status in ('VALID', 'WARNING') and outcome is null;

-- ═════════════════════════════ 2. apoio ══════════════════════════════════

-- Nome comparável: sem acento, sem pontuação, minúsculo, espaços simples.
create or replace function private.import_normalize_name(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(lower(translate(coalesce(p, ''),
    'ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
    'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')), '[^a-z0-9]+', ' ', 'g')), '')
$$;

create or replace function private.import_status_label(p_status text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'UPLOADED' then 'arquivo enviado'
    when 'COLUMNS_DETECTED' then 'colunas lidas'
    when 'MAPPED' then 'colunas mapeadas'
    when 'VALIDATED' then 'simulação concluída'
    when 'CONFLICTS_PENDING' then 'conflitos pendentes'
    when 'CONFIRMED' then 'confirmada'
    when 'PROCESSING' then 'gravando'
    when 'COMPLETED' then 'concluída'
    when 'FAILED' then 'falhou'
    when 'CANCELLED' then 'cancelada'
    else p_status end
$$;

-- Campos de destino aceitos no mapeamento (o servidor tem a mesma lista).
create or replace function private.import_target_fields()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'client.name', 'client.document', 'client.kind', 'client.email', 'client.phone',
    'client.zipCode', 'client.street', 'client.number', 'client.complement', 'client.district',
    'client.city', 'client.state', 'client.notes',
    'process.cnj', 'process.title', 'process.actionType', 'process.subject', 'process.court',
    'process.courtUnit', 'process.district', 'process.state', 'process.opposingParty',
    'process.clientSide', 'process.responsible', 'process.status', 'process.distributionDate',
    'process.caseValue', 'process.dueDate', 'process.notes']
$$;

create or replace function private.import_allowed_resolutions(p_kind text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'CLIENT_DOCUMENT' then array['UPDATE', 'IGNORE']
    when 'PROCESS_CNJ' then array['UPDATE', 'IGNORE']
    when 'POSSIBLE_DUPLICATE' then array['CREATE_NEW', 'IGNORE']
    else array[]::text[] end
$$;

-- Job travado para a operação, conferindo ADMIN e a etapa.
create or replace function private.import_lock_job(p_job_id uuid, p_statuses text[])
returns public.import_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.import_jobs;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Somente o administrador opera importações' using errcode = '42501';
  end if;
  select * into v from public.import_jobs j where j.id = p_job_id for update;
  if v.id is null then
    raise exception 'Importação não encontrada' using errcode = 'P0002';
  end if;
  if p_statuses is not null and not (v.status = any (p_statuses)) then
    raise exception 'Esta importação está em outra etapa (%). Recarregue a página.', private.import_status_label(v.status)
      using errcode = 'P0001';
  end if;
  return v;
end
$$;

-- Mensagem de falha de uma linha no processamento: a nossa (português) passa;
-- a da plataforma vira texto genérico com o código.
create or replace function private.import_error_text(p_state text, p_message text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_state = '23505' then 'Registro duplicado: o CPF/CNPJ ou o número CNJ já existe no DG Brasil.'
    when p_message is null or length(p_message) > 240
      or p_message ~* '(violates|relation "|column "|constraint "|function |syntax|permission denied|does not exist|null value|invalid input|duplicate key)'
      then 'O banco recusou esta linha (código ' || coalesce(p_state, '?') || ').'
    else p_message end
$$;

-- Mapeamento só muda antes da confirmação.
create or replace function private.import_column_mappings_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select j.status into v_status from public.import_jobs j
  where j.id = coalesce(new.import_job_id, old.import_job_id);
  if v_status is not null and v_status not in ('COLUMNS_DETECTED', 'MAPPED', 'VALIDATED', 'CONFLICTS_PENDING') then
    raise exception 'O mapeamento desta importação não pode mais ser alterado (%)', private.import_status_label(v_status)
      using errcode = '23514';
  end if;
  return coalesce(new, old);
end
$$;

create trigger import_column_mappings_guard
  before insert or update or delete on public.import_column_mappings
  for each row execute function private.import_column_mappings_guard();

-- ═════════════════════════════ 3. arquivo e colunas ══════════════════════

create or replace function private.import_create_job(p_file_name text, p_file_type text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   uuid := gen_random_uuid();
  v_name text := btrim(coalesce(p_file_name, ''));
  v_type text := upper(btrim(coalesce(p_file_type, '')));
  v_org  uuid;
  v_path text;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Somente o administrador opera importações' using errcode = '42501';
  end if;
  if v_name = '' or length(v_name) > 200 then
    raise exception 'Nome de arquivo inválido' using errcode = '22023';
  end if;
  if v_type not in ('CSV', 'XLSX') then
    raise exception 'Formato não aceito: envie CSV ou Excel (.xlsx)' using errcode = '22023';
  end if;
  select o.id into v_org from public.organizations o where o.type = 'OWNER' and o.deleted_at is null;
  -- Caminho fixo, decidido aqui: o nome do arquivo do usuário nunca entra no caminho.
  v_path := 'jobs/' || v_id || '/source.' || lower(v_type);
  insert into public.import_jobs (id, organization_id, file_name, file_type, storage_object_name)
  values (v_id, v_org, v_name, v_type, v_path);
  return jsonb_build_object('import_job_id', v_id, 'storage_object_name', v_path, 'file_type', v_type);
end
$$;

create or replace function private.import_authorize_file(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.import_jobs;
begin
  v := private.import_lock_job(p_job_id, array['UPLOADED', 'COLUMNS_DETECTED', 'MAPPED', 'VALIDATED', 'CONFLICTS_PENDING']);
  if v.source_file_deleted_at is not null or v.storage_object_name is null then
    raise exception 'O arquivo desta importação não está mais disponível. Comece uma nova importação.' using errcode = 'P0001';
  end if;
  return jsonb_build_object('storage_object_name', v.storage_object_name, 'file_type', v.file_type,
                            'sheet_name', v.sheet_name, 'status', v.status);
end
$$;

create or replace function private.import_register_columns(
  p_job_id uuid, p_checksum text, p_sheet_name text, p_columns jsonb, p_total_rows integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v      public.import_jobs;
  v_n    integer;
  v_dups jsonb;
begin
  v := private.import_lock_job(p_job_id, array['UPLOADED', 'COLUMNS_DETECTED', 'MAPPED']);
  if p_columns is null or jsonb_typeof(p_columns) <> 'array' then
    raise exception 'Cabeçalho inválido' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_columns);
  if v_n = 0 or v_n > 200 then
    raise exception 'A planilha precisa ter de 1 a 200 colunas no cabeçalho' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_columns) c
             where jsonb_typeof(c) <> 'string' or btrim(c #>> '{}') = '' or length(c #>> '{}') > 200) then
    raise exception 'Toda coluna usada precisa de um nome no cabeçalho (até 200 caracteres)' using errcode = '22023';
  end if;
  if (select count(distinct c #>> '{}') from jsonb_array_elements(p_columns) c) <> v_n then
    raise exception 'Há colunas com o mesmo nome no cabeçalho' using errcode = '22023';
  end if;
  if p_total_rows is null or p_total_rows < 1 then
    raise exception 'A planilha não tem linhas de dados abaixo do cabeçalho' using errcode = '22023';
  end if;
  if p_total_rows > 5000 then
    raise exception 'A planilha tem % linhas; o limite é 5.000 por importação. Divida o arquivo.', p_total_rows using errcode = '22023';
  end if;
  if p_checksum is null or p_checksum !~ '^[0-9a-f]{64}$' then
    raise exception 'Checksum do arquivo inválido' using errcode = '22023';
  end if;

  -- (Re)leitura descarta mapeamento e simulação anteriores.
  delete from public.import_conflicts c where c.import_job_id = v.id;
  delete from public.import_row_results r where r.import_job_id = v.id;
  delete from public.import_column_mappings m where m.import_job_id = v.id;
  update public.import_jobs j set
    status = 'COLUMNS_DETECTED',
    detected_columns = p_columns,
    sheet_name = nullif(btrim(coalesce(p_sheet_name, '')), ''),
    file_checksum_sha256 = p_checksum,
    total_rows = p_total_rows,
    options = '{}',
    dry_run_at = null,
    successful_rows = 0, warning_rows = 0, failed_rows = 0,
    error_message = null
  where j.id = v.id;

  -- Mesmo arquivo já importado: aviso, não bloqueio.
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'file_name', x.file_name, 'status', x.status,
                                               'created_at', x.created_at) order by x.created_at desc), '[]'::jsonb)
    into v_dups
  from (select j.id, j.file_name, j.status, j.created_at from public.import_jobs j
        where j.file_checksum_sha256 = p_checksum and j.id <> v.id and j.status not in ('CANCELLED', 'FAILED')
        order by j.created_at desc limit 5) x;

  return jsonb_build_object('status', 'COLUMNS_DETECTED', 'same_file_jobs', v_dups);
end
$$;

create or replace function private.import_fail(p_job_id uuid, p_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.import_jobs;
begin
  v := private.import_lock_job(p_job_id, array['UPLOADED', 'COLUMNS_DETECTED', 'MAPPED']);
  update public.import_jobs j set
    status = 'FAILED',
    error_message = left(coalesce(nullif(btrim(p_message), ''), 'Não foi possível ler o arquivo.'), 500)
  where j.id = v.id;
end
$$;

-- ═════════════════════════════ 4. mapeamento ═════════════════════════════

create or replace function private.import_save_mapping(p_job_id uuid, p_mappings jsonb, p_options jsonb default '{}')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v         public.import_jobs;
  m         jsonb;
  v_cols    text[];
  v_targets text[] := '{}';
  v_target  text;
  v_process boolean;
  v_area    uuid;
  v_lawyer  uuid;
  v_opts    jsonb := '{}';
  v_uuid    constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  v := private.import_lock_job(p_job_id, array['COLUMNS_DETECTED', 'MAPPED', 'VALIDATED', 'CONFLICTS_PENDING']);
  if p_mappings is null or jsonb_typeof(p_mappings) <> 'array' or jsonb_array_length(p_mappings) = 0 then
    raise exception 'Escolha o campo de pelo menos uma coluna' using errcode = '22023';
  end if;
  select array_agg(c #>> '{}') into v_cols from jsonb_array_elements(v.detected_columns) c;

  for m in select * from jsonb_array_elements(p_mappings) loop
    v_target := m ->> 'target_field';
    if jsonb_typeof(m) <> 'object' or not ((m ->> 'source_column') = any (v_cols)) then
      raise exception 'Coluna que não existe no arquivo: %', coalesce(m ->> 'source_column', '?') using errcode = '22023';
    end if;
    if v_target is null or not (v_target = any (private.import_target_fields())) then
      raise exception 'Campo de destino desconhecido: %', coalesce(v_target, '?') using errcode = '22023';
    end if;
    if v_target = any (v_targets) then
      raise exception 'Cada campo só pode receber uma coluna (repetido: %)', v_target using errcode = '22023';
    end if;
    v_targets := v_targets || v_target;
  end loop;

  -- Todo processo pertence a um cliente: o nome é sempre necessário; o CPF/CNPJ
  -- também, exceto para ligar processos a clientes já cadastrados (pelo nome).
  v_process := exists (select 1 from unnest(v_targets) t where t like 'process.%' and t <> 'process.responsible');
  if not ('client.name' = any (v_targets)) then
    raise exception 'Mapeie a coluna do nome do cliente: é a base de toda linha importada' using errcode = '22023';
  end if;
  if not ('client.document' = any (v_targets)) and not v_process then
    raise exception 'Mapeie a coluna do CPF/CNPJ: sem ela só dá para importar processos de clientes já cadastrados' using errcode = '22023';
  end if;
  if v_process and not ('process.cnj' = any (v_targets) or 'process.title' = any (v_targets)
                        or 'process.actionType' = any (v_targets)) then
    raise exception 'Para importar processos, mapeie o número CNJ, o nome resumido ou o tipo de ação' using errcode = '22023';
  end if;

  if v_process then
    v_area := case when coalesce(p_options ->> 'legal_area_id', '') ~ v_uuid then (p_options ->> 'legal_area_id')::uuid end;
    if v_area is null or not exists (select 1 from public.legal_areas a where a.id = v_area and a.active) then
      raise exception 'Escolha a área jurídica dos casos que serão criados' using errcode = '22023';
    end if;
    v_lawyer := case when coalesce(p_options ->> 'lawyer_id', '') ~ v_uuid then (p_options ->> 'lawyer_id')::uuid end;
    if coalesce(private.user_internal_role(v_lawyer)::text, '') not in ('ADMIN', 'LAWYER') then
      raise exception 'Escolha o advogado responsável padrão (administrador ou advogado ativo)' using errcode = '22023';
    end if;
    v_opts := jsonb_build_object('legal_area_id', v_area, 'lawyer_id', v_lawyer);
  end if;

  delete from public.import_conflicts c where c.import_job_id = v.id;
  delete from public.import_row_results r where r.import_job_id = v.id;
  delete from public.import_column_mappings x where x.import_job_id = v.id;
  insert into public.import_column_mappings (import_job_id, source_column, target_field, transform)
  select v.id, x ->> 'source_column', x ->> 'target_field',
         case when jsonb_typeof(x -> 'transform') = 'object' then x -> 'transform' else '{}'::jsonb end
  from jsonb_array_elements(p_mappings) x;

  update public.import_jobs j set
    status = 'MAPPED', options = v_opts, dry_run_at = null,
    successful_rows = 0, warning_rows = 0, failed_rows = 0
  where j.id = v.id;
  return jsonb_build_object('status', 'MAPPED', 'has_processes', v_process);
end
$$;

-- ═════════════════════════════ 5. simulação ══════════════════════════════
-- p_rows: [{row_number, status VALID|WARNING|ERROR, errors[], warnings[], raw_data{}, payload{}}]
-- (até 1.000 por chamada; p_reset = true no primeiro lote).

create or replace function private.import_stage_rows(p_job_id uuid, p_rows jsonb, p_reset boolean default false)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.import_jobs;
  n integer;
begin
  v := private.import_lock_job(p_job_id, array['MAPPED']);
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'Lote de linhas inválido (até 1.000 por envio)' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) r
    where jsonb_typeof(r) <> 'object'
       or coalesce(r ->> 'row_number', '') !~ '^[0-9]{1,7}$'
       or (r ->> 'row_number')::integer < 1
       or coalesce(r ->> 'status', '') not in ('VALID', 'WARNING', 'ERROR')
       or (r ? 'errors' and jsonb_typeof(r -> 'errors') <> 'array')
       or (r ? 'warnings' and jsonb_typeof(r -> 'warnings') <> 'array')
       or (r ->> 'status' <> 'ERROR' and jsonb_typeof(r -> 'payload') is distinct from 'object')
       or (r ->> 'status' <> 'ERROR' and coalesce(r #>> '{payload,client,document}', '') !~ '^([0-9]{11}|[0-9]{14})$'
           and not (r #>> '{payload,client,by_name}' = 'true' and btrim(coalesce(r #>> '{payload,client,name}', '')) <> ''
                    and jsonb_typeof(r #> '{payload,process}') = 'object'))
  ) then
    raise exception 'Lote de linhas inválido: confira número, situação e conteúdo de cada linha' using errcode = '22023';
  end if;

  if p_reset then
    delete from public.import_conflicts c where c.import_job_id = v.id;
    delete from public.import_row_results r where r.import_job_id = v.id;
  end if;

  insert into public.import_row_results (import_job_id, row_number, status, errors, warnings, raw_data, payload)
  select v.id, (r ->> 'row_number')::integer, r ->> 'status',
         coalesce(r -> 'errors', '[]'::jsonb), coalesce(r -> 'warnings', '[]'::jsonb),
         case when jsonb_typeof(r -> 'raw_data') = 'object' then r -> 'raw_data' end,
         case when r ->> 'status' <> 'ERROR' then r -> 'payload' end
  from jsonb_array_elements(p_rows) r
  on conflict (import_job_id, row_number) do update set
    status = excluded.status, errors = excluded.errors, warnings = excluded.warnings,
    raw_data = excluded.raw_data, payload = excluded.payload,
    action = null, entity_type = null, entity_id = null, outcome = null;
  get diagnostics n = row_count;
  return n;
end
$$;

create or replace function private.import_finish_dry_run(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v      public.import_jobs;
  v_n    integer;
  v_open integer;
begin
  v := private.import_lock_job(p_job_id, array['MAPPED']);
  select count(*) into v_n from public.import_row_results r where r.import_job_id = v.id;
  if v_n <> coalesce(v.total_rows, -1) then
    raise exception 'Simulação incompleta: % de % linhas recebidas. Refaça a simulação.', v_n, coalesce(v.total_rows, 0)
      using errcode = 'P0001';
  end if;
  delete from public.import_conflicts c where c.import_job_id = v.id;

  -- 0) Linha sem CPF/CNPJ: acha o cliente JÁ cadastrado pelo nome (exatamente um).
  with m as (
    select r.row_number, count(e.id) n, min(e.doc) doc
    from public.import_row_results r
    left join (select c.id, coalesce(c.cpf::text, c.cnpj::text) doc,
                      private.import_normalize_name(coalesce(i.full_name, k.legal_name)) nname
               from public.clients c
               left join public.individual_client_details i on i.client_id = c.id
               left join public.company_client_details k on k.client_id = c.id
               where c.deleted_at is null) e
      on e.nname = private.import_normalize_name(r.payload #>> '{client,name}')
    where r.import_job_id = v.id and r.status in ('VALID', 'WARNING')
      and r.payload #>> '{client,by_name}' = 'true'
    group by r.row_number
  )
  update public.import_row_results r set
    status  = case when m.n = 1 then 'WARNING' else 'ERROR' end,
    payload = case when m.n = 1
                   then jsonb_set(jsonb_set(r.payload, '{client,document}', to_jsonb(m.doc)),
                                  '{client,kind}', to_jsonb(case when length(m.doc) = 11 then 'INDIVIDUAL' else 'COMPANY' end))
              end,
    warnings = case when m.n = 1
                    then r.warnings || jsonb_build_array('Cliente sem CPF/CNPJ na planilha: encontrado pelo nome no DG Brasil; o processo é ligado a ele.'::text)
                    else r.warnings end,
    errors = case when m.n = 0
                  then r.errors || jsonb_build_array('Cliente sem CPF/CNPJ e não encontrado pelo nome no DG Brasil. Importe antes a planilha de clientes (com CPF/CNPJ) ou inclua a coluna de CPF/CNPJ.'::text)
                  when m.n > 1
                  then r.errors || jsonb_build_array(format('Cliente sem CPF/CNPJ e há %s clientes com este nome no DG Brasil: inclua o CPF/CNPJ para saber qual é.', m.n))
                  else r.errors end
  from m
  where r.import_job_id = v.id and r.row_number = m.row_number;

  -- a) CPF/CNPJ de cliente EXCLUÍDO: não dá para importar por cima.
  update public.import_row_results r set
    status = 'ERROR', payload = null,
    errors = r.errors || jsonb_build_array('O CPF/CNPJ pertence a um cliente excluído do DG Brasil. Restaure o cadastro antes de importar.'::text)
  from public.clients c
  where r.import_job_id = v.id and r.status in ('VALID', 'WARNING')
    and (c.cpf = r.payload #>> '{client,document}' or c.cnpj = r.payload #>> '{client,document}')
    and c.deleted_at is not null;

  -- b) CNJ de processo EXCLUÍDO.
  update public.import_row_results r set
    status = 'ERROR', payload = null,
    errors = r.errors || jsonb_build_array('O número CNJ pertence a um processo excluído do DG Brasil. Restaure o processo antes de importar.'::text)
  from public.legal_processes lp
  where r.import_job_id = v.id and r.status in ('VALID', 'WARNING')
    and lp.cnj_number = r.payload #>> '{process,cnj}'
    and lp.deleted_at is not null;

  -- c) CPF/CNPJ já cadastrado: UM conflito por cliente, na primeira linha em que aparece.
  insert into public.import_conflicts (import_job_id, row_number, conflict_kind, existing_entity_type, existing_entity_id)
  select v.id, g.first_row, 'CLIENT_DOCUMENT', 'clients', c.id
  from (select r.payload #>> '{client,document}' doc, min(r.row_number) first_row
        from public.import_row_results r
        where r.import_job_id = v.id and r.status in ('VALID', 'WARNING')
        group by 1) g
  join public.clients c on (c.cpf = g.doc or c.cnpj = g.doc) and c.deleted_at is null;

  -- Cliente achado pelo nome (sem CPF/CNPJ na planilha): a decisão já nasce
  -- "Manter o cadastro" — só o vínculo; a pessoa pode trocar.
  update public.import_conflicts x set resolution = 'IGNORE', resolved_at = now(), resolved_by = auth.uid()
  from public.import_row_results r
  where x.import_job_id = v.id and x.conflict_kind = 'CLIENT_DOCUMENT'
    and r.import_job_id = v.id and r.row_number = x.row_number
    and r.payload #>> '{client,by_name}' = 'true';

  -- d) Nome igual a cliente com OUTRO documento: possível duplicata (só para cliente novo).
  insert into public.import_conflicts (import_job_id, row_number, conflict_kind, existing_entity_type, existing_entity_id)
  select distinct on (g.doc) v.id, g.first_row, 'POSSIBLE_DUPLICATE', 'clients', e.id
  from (select r.payload #>> '{client,document}' doc, min(r.row_number) first_row,
               private.import_normalize_name((array_agg(r.payload #>> '{client,name}' order by r.row_number))[1]) nname
        from public.import_row_results r
        where r.import_job_id = v.id and r.status in ('VALID', 'WARNING')
        group by 1) g
  join (select c.id, coalesce(c.cpf::text, c.cnpj::text) doc,
               private.import_normalize_name(coalesce(i.full_name, k.legal_name)) nname
        from public.clients c
        left join public.individual_client_details i on i.client_id = c.id
        left join public.company_client_details k on k.client_id = c.id
        where c.deleted_at is null) e
    on e.nname = g.nname and e.doc <> g.doc
  where g.nname is not null
    and not exists (select 1 from public.import_conflicts x
                    where x.import_job_id = v.id and x.row_number = g.first_row and x.conflict_kind = 'CLIENT_DOCUMENT')
  order by g.doc, e.id;

  -- e) CNJ já cadastrado: um conflito por linha (CNJ repetido no arquivo já é erro da validação).
  insert into public.import_conflicts (import_job_id, row_number, conflict_kind, existing_entity_type, existing_entity_id)
  select v.id, r.row_number, 'PROCESS_CNJ', 'legal_processes', lp.id
  from public.import_row_results r
  join public.legal_processes lp on lp.cnj_number = r.payload #>> '{process,cnj}' and lp.deleted_at is null
  where r.import_job_id = v.id and r.status in ('VALID', 'WARNING');

  -- Processo existente de OUTRO cliente: a importação não troca o cliente (aviso).
  update public.import_row_results r set
    status = 'WARNING',
    warnings = r.warnings || jsonb_build_array('O processo com este CNJ já está cadastrado para outro cliente; a importação não muda o cliente do processo.'::text)
  from public.import_conflicts x
  join public.legal_processes lp on lp.id = x.existing_entity_id
  join public.legal_cases lc on lc.id = lp.legal_case_id
  join public.clients c on c.id = lc.client_id
  where x.import_job_id = v.id and x.conflict_kind = 'PROCESS_CNJ'
    and r.import_job_id = v.id and r.row_number = x.row_number
    and coalesce(c.cpf::text, c.cnpj::text) is distinct from r.payload #>> '{client,document}';

  select count(*) into v_open from public.import_conflicts c where c.import_job_id = v.id and c.resolution is null;
  update public.import_jobs j set
    status = case when v_open > 0 then 'CONFLICTS_PENDING' else 'VALIDATED' end,
    dry_run_at = now(),
    successful_rows = (select count(*) from public.import_row_results r where r.import_job_id = v.id and r.status = 'VALID'),
    warning_rows    = (select count(*) from public.import_row_results r where r.import_job_id = v.id and r.status = 'WARNING'),
    failed_rows     = (select count(*) from public.import_row_results r where r.import_job_id = v.id and r.status = 'ERROR')
  where j.id = v.id;

  return jsonb_build_object('status', case when v_open > 0 then 'CONFLICTS_PENDING' else 'VALIDATED' end,
                            'open_conflicts', v_open);
end
$$;

-- ═════════════════════════════ 6. conflitos ══════════════════════════════
-- p_items: [{conflict_id, resolution}] ou [{kind, resolution}] (todos do tipo).
-- resolution null desfaz a decisão.

create or replace function private.import_resolve_conflicts(p_job_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v      public.import_jobs;
  it     jsonb;
  v_res  text;
  v_kind text;
  v_open integer;
begin
  v := private.import_lock_job(p_job_id, array['CONFLICTS_PENDING', 'VALIDATED']);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 5000 then
    raise exception 'Nenhuma decisão enviada' using errcode = '22023';
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    v_res := nullif(it ->> 'resolution', '');
    if it ? 'conflict_id' then
      select c.conflict_kind into v_kind from public.import_conflicts c
      where c.import_job_id = v.id and c.id::text = it ->> 'conflict_id';
      if v_kind is null then
        raise exception 'Conflito não encontrado nesta importação' using errcode = 'P0002';
      end if;
    else
      v_kind := it ->> 'kind';
    end if;
    if v_res is not null and not (v_res = any (private.import_allowed_resolutions(v_kind))) then
      raise exception 'Decisão não permitida para este tipo de conflito' using errcode = '22023';
    end if;
    update public.import_conflicts c set
      resolution  = v_res,
      resolved_at = case when v_res is null then null else now() end,
      resolved_by = case when v_res is null then null else auth.uid() end
    where c.import_job_id = v.id
      and (case when it ? 'conflict_id' then c.id::text = it ->> 'conflict_id' else c.conflict_kind = v_kind end)
      and c.resolution is distinct from v_res;
  end loop;

  select count(*) into v_open from public.import_conflicts c where c.import_job_id = v.id and c.resolution is null;
  if v_open = 0 and v.status = 'CONFLICTS_PENDING' then
    update public.import_jobs j set status = 'VALIDATED' where j.id = v.id;
  elsif v_open > 0 and v.status = 'VALIDATED' then
    update public.import_jobs j set status = 'CONFLICTS_PENDING' where j.id = v.id;
  end if;
  return jsonb_build_object('open_conflicts', v_open, 'status', case when v_open = 0 then 'VALIDATED' else 'CONFLICTS_PENDING' end);
end
$$;

-- ═════════════════════════════ 7. plano (uma regra só) ═══════════════════
-- O que cada linha fará. Usado pela prévia E pelo processamento: a prévia não
-- tem regra própria. Linhas consideradas: as válidas da simulação (inclusive
-- as já processadas, para o "primeira linha do cliente" não mudar no meio).
--   cliente:  CREATE (primeira linha de documento novo), LINK (linhas seguintes
--             desse documento), UPDATE (primeira linha de documento existente,
--             decisão Atualizar), KEEP (documento existente: decisão Manter, ou
--             linhas seguintes), SKIP (possível duplicata: decisão Ignorar).
--   processo: CREATE, UPDATE / KEEP (CNJ existente), SKIP (cliente ignorado).

create or replace function private.import_row_actions(p_job_id uuid)
returns table (
  row_number integer, client_document text, first_client_row integer,
  client_action text, client_existing_id uuid,
  process_action text, process_existing_id uuid, has_due_date boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with r as (
    select x.row_number, x.payload #>> '{client,document}' doc,
           jsonb_typeof(x.payload -> 'process') = 'object' has_proc,
           nullif(x.payload #>> '{process,due_date}', '') is not null due
    from public.import_row_results x
    where x.import_job_id = p_job_id
      and (x.status in ('VALID', 'WARNING') or x.outcome is not null)
      and x.payload is not null
  ), g as (
    select r.doc, min(r.row_number) first_row from r group by r.doc
  ), gc as (
    select g.doc, g.first_row, cd.id cd_conflict, cd.existing_entity_id cd_id, cd.resolution cd_res, pd.resolution pd_res
    from g
    left join public.import_conflicts cd
      on cd.import_job_id = p_job_id and cd.row_number = g.first_row and cd.conflict_kind = 'CLIENT_DOCUMENT'
    left join public.import_conflicts pd
      on pd.import_job_id = p_job_id and pd.row_number = g.first_row and pd.conflict_kind = 'POSSIBLE_DUPLICATE'
  )
  select r.row_number, r.doc, gc.first_row,
         case when gc.pd_res = 'IGNORE' then 'SKIP'
              when gc.cd_conflict is not null and gc.cd_res = 'UPDATE' and r.row_number = gc.first_row then 'UPDATE'
              when gc.cd_conflict is not null then 'KEEP'
              when r.row_number = gc.first_row then 'CREATE'
              else 'LINK' end,
         gc.cd_id,
         case when not coalesce(r.has_proc, false) then null
              when gc.pd_res = 'IGNORE' then 'SKIP'
              when pc.id is not null then case when pc.resolution = 'UPDATE' then 'UPDATE' else 'KEEP' end
              else 'CREATE' end,
         pc.existing_entity_id,
         coalesce(r.due, false)
  from r
  join gc on gc.doc = r.doc
  left join public.import_conflicts pc
    on pc.import_job_id = p_job_id and pc.row_number = r.row_number and pc.conflict_kind = 'PROCESS_CNJ'
$$;

create or replace function private.get_import_plan(p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Somente o administrador opera importações' using errcode = '42501';
  end if;
  if not exists (select 1 from public.import_jobs j where j.id = p_job_id) then
    raise exception 'Importação não encontrada' using errcode = 'P0002';
  end if;
  select jsonb_build_object(
    'rows_total',        (select count(*) from public.import_row_results r where r.import_job_id = p_job_id),
    'rows_error',        (select count(*) from public.import_row_results r where r.import_job_id = p_job_id and r.status = 'ERROR' and r.outcome is null),
    'rows_to_import',    count(*) filter (where a.client_action in ('CREATE', 'UPDATE') or a.process_action in ('CREATE', 'UPDATE')),
    'rows_to_skip',      count(*) filter (where not (a.client_action in ('CREATE', 'UPDATE') or coalesce(a.process_action, '') in ('CREATE', 'UPDATE'))),
    'clients_create',    count(*) filter (where a.client_action = 'CREATE'),
    'clients_update',    count(*) filter (where a.client_action = 'UPDATE'),
    'clients_keep',      count(distinct a.client_document) filter (where a.client_action = 'KEEP'),
    'clients_skip',      count(distinct a.client_document) filter (where a.client_action = 'SKIP'),
    'processes_create',  count(*) filter (where a.process_action = 'CREATE'),
    'processes_update',  count(*) filter (where a.process_action = 'UPDATE'),
    'processes_keep',    count(*) filter (where a.process_action = 'KEEP'),
    'processes_skip',    count(*) filter (where a.process_action = 'SKIP'),
    'cases_create',      count(*) filter (where a.process_action = 'CREATE'),
    'deadlines_create',  count(*) filter (where a.process_action = 'CREATE' and a.has_due_date))
  into v_out
  from private.import_row_actions(p_job_id) a;
  return v_out;
end
$$;

-- Conflitos com o que já existe, para a tela decidir.
create or replace function private.get_import_conflicts(p_job_id uuid, p_offset integer default 0, p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Somente o administrador opera importações' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'total', (select count(*) from public.import_conflicts c where c.import_job_id = p_job_id),
    'open',  (select count(*) from public.import_conflicts c where c.import_job_id = p_job_id and c.resolution is null),
    'by_kind', coalesce((select jsonb_object_agg(k.conflict_kind, k.n) from (
                 select c.conflict_kind, count(*) n from public.import_conflicts c
                 where c.import_job_id = p_job_id group by 1) k), '{}'::jsonb),
    'items', coalesce(jsonb_agg(x.item order by x.row_number, x.kind_order), '[]'::jsonb))
  into v_out
  from (
    select c.row_number,
           case c.conflict_kind when 'CLIENT_DOCUMENT' then 1 when 'POSSIBLE_DUPLICATE' then 2 else 3 end kind_order,
           jsonb_build_object(
             'id', c.id, 'row_number', c.row_number, 'kind', c.conflict_kind, 'resolution', c.resolution,
             'existing_id', c.existing_entity_id,
             'row_client_name', r.payload #>> '{client,name}',
             'row_client_document', r.payload #>> '{client,document}',
             'row_process_cnj', r.payload #>> '{process,cnj}',
             'existing_label', case
               when c.existing_entity_type = 'clients' then
                 (select coalesce(i.full_name, k.legal_name) from public.clients cl
                  left join public.individual_client_details i on i.client_id = cl.id
                  left join public.company_client_details k on k.client_id = cl.id where cl.id = c.existing_entity_id)
               else (select coalesce(lp.title, lc.title) from public.legal_processes lp
                     join public.legal_cases lc on lc.id = lp.legal_case_id where lp.id = c.existing_entity_id) end,
             'existing_document', case when c.existing_entity_type = 'clients' then
                 (select coalesce(cl.cpf::text, cl.cnpj::text) from public.clients cl where cl.id = c.existing_entity_id) end,
             'existing_client_name', case when c.existing_entity_type = 'legal_processes' then
                 (select coalesce(i.full_name, k.legal_name) from public.legal_processes lp
                  join public.legal_cases lc on lc.id = lp.legal_case_id
                  left join public.individual_client_details i on i.client_id = lc.client_id
                  left join public.company_client_details k on k.client_id = lc.client_id
                  where lp.id = c.existing_entity_id) end,
             'rows_with_same_client', case when c.conflict_kind <> 'PROCESS_CNJ' then
                 (select count(*) from public.import_row_results y
                  where y.import_job_id = p_job_id and y.status in ('VALID', 'WARNING')
                    and y.payload #>> '{client,document}' = r.payload #>> '{client,document}') end
           ) item
    from public.import_conflicts c
    join public.import_row_results r on r.import_job_id = c.import_job_id and r.row_number = c.row_number
    where c.import_job_id = p_job_id
    order by c.row_number, kind_order
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
  ) x;
  return v_out;
end
$$;

-- Áreas e equipe para o mapeamento (opções e casamento do "Responsável").
create or replace function private.get_import_reference_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Somente o administrador opera importações' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'areas', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'name', a.name) order by a.name)
                       from public.legal_areas a where a.active), '[]'::jsonb),
    'users', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'preferred_name', p.preferred_name,
                                                           'role', m.role) order by p.full_name)
                       from public.organization_memberships m
                       join public.organizations o on o.id = m.organization_id and o.type = 'OWNER' and o.deleted_at is null
                       join public.profiles p on p.id = m.user_id
                       where m.status = 'ACTIVE' and private.is_active_internal_user(m.user_id)), '[]'::jsonb));
end
$$;

-- ═════════════════════════════ 8. confirmação e gravação ═════════════════

create or replace function private.import_confirm(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v      public.import_jobs;
  v_plan jsonb;
begin
  v := private.import_lock_job(p_job_id, array['VALIDATED']);
  v_plan := private.get_import_plan(v.id);
  if coalesce((v_plan ->> 'rows_to_import')::integer, 0) = 0 then
    raise exception 'Nada para gravar: todas as linhas têm erro ou foram ignoradas' using errcode = 'P0001';
  end if;
  update public.import_jobs j set status = 'CONFIRMED' where j.id = v.id;  -- autor e hora: gatilho da 013
  return v_plan;
end
$$;

-- Dados do cliente para save_client (025). Criação: tudo. Atualização: só o
-- que veio preenchido (chave ausente = save_client não mexe); endereço é
-- mesclado com o atual; observações internas não são sobrescritas.
create or replace function private.import_client_patch(c jsonb, p_job public.import_jobs, p_row integer, p_existing uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_kind    text := c ->> 'kind';
  v_address jsonb := case when jsonb_typeof(c -> 'address') = 'object' then jsonb_strip_nulls(c -> 'address') end;
  v_current jsonb;
  v_contact jsonb := jsonb_strip_nulls(jsonb_build_object('email', c ->> 'email', 'phone', c ->> 'phone'));
  v_out     jsonb;
begin
  if p_existing is not null and v_address is not null then
    select jsonb_strip_nulls(jsonb_build_object('postal_code', a.postal_code, 'street', a.street, 'number', a.number,
             'complement', a.complement, 'neighborhood', a.neighborhood, 'city', a.city, 'state', a.state))
      into v_current
    from public.client_addresses a where a.client_id = p_existing and a.is_primary;
    v_address := coalesce(v_current, '{}'::jsonb) || v_address;
  end if;

  v_out := jsonb_build_object(
    case when v_kind = 'COMPANY' then 'legal_name' else 'full_name' end, btrim(c ->> 'name'));
  if v_contact <> '{}'::jsonb then v_out := v_out || jsonb_build_object('contact', v_contact); end if;
  if v_address is not null and v_address <> '{}'::jsonb then v_out := v_out || jsonb_build_object('address', v_address); end if;
  if nullif(c ->> 'responsible_user_id', '') is not null then
    v_out := v_out || jsonb_build_object('responsible_user_id', c ->> 'responsible_user_id');
  end if;

  if p_existing is null then
    v_out := v_out || jsonb_build_object(
      'kind', v_kind,
      'document', c ->> 'document',
      'origin_organization_id', p_job.organization_id,
      'notes', concat_ws(E'\n', nullif(btrim(coalesce(c ->> 'notes', '')), ''),
                         'Cadastrado pela importação da planilha "' || p_job.file_name || '" (linha ' || p_row || ').'));
  end if;
  return v_out;
end
$$;

-- Aplica UMA linha. Chamada só por import_process_batch, dentro de uma
-- subtransação: qualquer exceção desfaz só esta linha.
create or replace function private.import_apply_row(
  p_job public.import_jobs, p_row integer, p jsonb,
  p_client_action text, p_client_existing uuid, p_first_row integer,
  p_process_action text, p_process_existing uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c          jsonb := p -> 'client';
  pr         jsonb := p -> 'process';
  v_doc      text := p #>> '{client,document}';
  v_cnj      text := nullif(p #>> '{process,cnj}', '');
  v_found    uuid;
  v_client   uuid;
  v_case     uuid;
  v_process  uuid;
  v_deadline uuid;
  v_resp     uuid := case when nullif(p #>> '{process,responsible_user_id}', '') is not null
                          then (p #>> '{process,responsible_user_id}')::uuid end;
  v_lawyer   uuid;
  v_status   text;
  v_origin   text := 'Cadastrado pela importação da planilha "' || p_job.file_name || '" (linha ' || p_row || ').';
  v_out      jsonb := jsonb_build_object('client_action', p_client_action, 'process_action', p_process_action);
begin
  if p_client_action = 'SKIP' then
    return v_out || jsonb_build_object('result', 'SKIPPED',
      'reason', 'Possível cliente duplicado: ignorado por decisão na importação.');
  end if;
  if v_doc is null or c is null then
    raise exception 'Linha sem cliente' using errcode = '22023';
  end if;

  select cl.id into v_found from public.clients cl where cl.cpf = v_doc or cl.cnpj = v_doc;

  -- ── cliente ─────────────────────────────────────────────────────────────
  if p_client_action = 'CREATE' then
    if v_found is not null then
      raise exception 'O CPF/CNPJ foi cadastrado no DG Brasil depois da simulação. Faça uma nova importação para decidir sobre este cliente.'
        using errcode = 'P0001';
    end if;
    v_client := private.save_client(null, private.import_client_patch(c, p_job, p_row, null));
  elsif p_client_action in ('UPDATE', 'KEEP') then
    if p_client_existing is null or v_found is distinct from p_client_existing then
      raise exception 'O cadastro do cliente mudou desde a simulação. Faça uma nova importação para esta linha.' using errcode = 'P0001';
    end if;
    v_client := p_client_existing;
    if p_client_action = 'UPDATE' then
      perform private.save_client(v_client, private.import_client_patch(c, p_job, p_row, v_client));
    end if;
  elsif p_client_action = 'LINK' then
    select (r.outcome ->> 'client_id')::uuid into v_client
    from public.import_row_results r
    where r.import_job_id = p_job.id and r.row_number = p_first_row and r.status = 'IMPORTED';
    if v_client is null or v_found is distinct from v_client then
      raise exception 'O cliente desta linha não foi gravado (veja a linha %), então esta linha também não foi.', p_first_row
        using errcode = 'P0001';
    end if;
  else
    raise exception 'Ação de cliente inválida' using errcode = '22023';
  end if;
  v_out := v_out || jsonb_build_object('client_id', v_client);

  -- ── processo ────────────────────────────────────────────────────────────
  if p_process_action = 'CREATE' then
    if v_cnj is not null and exists (select 1 from public.legal_processes lp where lp.cnj_number = v_cnj) then
      raise exception 'O número CNJ foi cadastrado no DG Brasil depois da simulação. Faça uma nova importação para decidir sobre este processo.'
        using errcode = 'P0001';
    end if;
    v_lawyer := case when coalesce(private.user_internal_role(v_resp)::text, '') in ('ADMIN', 'LAWYER') then v_resp
                     else (p_job.options ->> 'lawyer_id')::uuid end;
    v_status := coalesce(nullif(pr ->> 'status', ''), case when v_cnj is not null then 'ACTIVE' else 'PREPARING' end);

    insert into public.legal_cases (client_id, legal_area_id, title, opposing_party, status, origin_organization_id, assigned_lawyer_id)
    values (v_client, (p_job.options ->> 'legal_area_id')::uuid,
            left(coalesce(nullif(btrim(pr ->> 'title'), ''), nullif(btrim(pr ->> 'legal_class'), ''),
                          'Processo ' || coalesce(v_cnj, 'importado')), 300),
            nullif(btrim(coalesce(pr ->> 'adverse_party', '')), ''),
            'IN_PROGRESS', p_job.organization_id, v_lawyer)
    returning id into v_case;
    if v_status in ('CLOSED', 'ARCHIVED') then
      update public.legal_cases lc set status = 'CLOSED' where lc.id = v_case;
    end if;
    insert into public.legal_case_internal_details (legal_case_id, internal_notes)
    values (v_case, v_origin)
    on conflict (legal_case_id) do update set internal_notes = excluded.internal_notes;

    insert into public.legal_processes
      (legal_case_id, technical_origin, title, cnj_number, court, court_unit, district, state, legal_class, subject,
       client_side, adverse_party_summary, distribution_date, case_value, status, phase, responsible_user_id)
    values
      (v_case, case when v_cnj is not null then 'IMPORT' else 'MANUAL' end,
       nullif(btrim(coalesce(pr ->> 'title', '')), ''), v_cnj,
       nullif(btrim(coalesce(pr ->> 'court', '')), ''), nullif(btrim(coalesce(pr ->> 'court_unit', '')), ''),
       nullif(btrim(coalesce(pr ->> 'district', '')), ''), nullif(pr ->> 'state', '')::public.uf_code,
       nullif(btrim(coalesce(pr ->> 'legal_class', '')), ''), nullif(btrim(coalesce(pr ->> 'subject', '')), ''),
       coalesce(nullif(pr ->> 'client_side', ''), 'ACTIVE'), nullif(btrim(coalesce(pr ->> 'adverse_party', '')), ''),
       nullif(pr ->> 'distribution_date', '')::date, nullif(pr ->> 'case_value', '')::numeric,
       v_status, nullif(pr ->> 'phase', ''), coalesce(v_resp, v_lawyer))
    returning id into v_process;

    insert into public.legal_process_internal_details (legal_process_id, notes)
    values (v_process, concat_ws(E'\n', nullif(btrim(coalesce(pr ->> 'notes', '')), ''), v_origin));

    if nullif(pr ->> 'due_date', '') is not null then
      insert into public.deadlines
        (legal_case_id, legal_process_id, title, deadline_type, description, due_at, priority, responsible_user_id, source)
      values
        (v_case, v_process, 'Prazo importado da planilha', 'INTERNAL',
         'Vencimento informado na planilha "' || p_job.file_name || '" (linha ' || p_row || '). Confira o prazo.',
         ((pr ->> 'due_date')::date + time '18:00') at time zone 'America/Sao_Paulo', 'NORMAL', coalesce(v_resp, v_lawyer), 'MANUAL')
      returning id into v_deadline;
    end if;

    insert into public.process_events (legal_process_id, event_type, title, description, occurred_at, source)
    values (v_process, 'IMPORT', 'Cadastro por importação', v_origin, now(), 'IMPORT');

    v_out := v_out || jsonb_build_object('legal_case_id', v_case, 'legal_process_id', v_process, 'deadline_id', v_deadline);

  elsif p_process_action = 'UPDATE' then
    if not exists (select 1 from public.legal_processes lp
                   where lp.id = p_process_existing and lp.deleted_at is null and lp.cnj_number = v_cnj) then
      raise exception 'O processo existente mudou desde a simulação. Faça uma nova importação para esta linha.' using errcode = 'P0001';
    end if;
    update public.legal_processes lp set
      title                 = coalesce(nullif(btrim(coalesce(pr ->> 'title', '')), ''), lp.title),
      court                 = coalesce(nullif(btrim(coalesce(pr ->> 'court', '')), ''), lp.court),
      court_unit            = coalesce(nullif(btrim(coalesce(pr ->> 'court_unit', '')), ''), lp.court_unit),
      district              = coalesce(nullif(btrim(coalesce(pr ->> 'district', '')), ''), lp.district),
      state                 = coalesce(nullif(pr ->> 'state', '')::public.uf_code, lp.state),
      legal_class           = coalesce(nullif(btrim(coalesce(pr ->> 'legal_class', '')), ''), lp.legal_class),
      subject               = coalesce(nullif(btrim(coalesce(pr ->> 'subject', '')), ''), lp.subject),
      client_side           = coalesce(nullif(pr ->> 'client_side', ''), lp.client_side),
      adverse_party_summary = coalesce(nullif(btrim(coalesce(pr ->> 'adverse_party', '')), ''), lp.adverse_party_summary),
      distribution_date     = coalesce(nullif(pr ->> 'distribution_date', '')::date, lp.distribution_date),
      case_value            = coalesce(nullif(pr ->> 'case_value', '')::numeric, lp.case_value),
      status                = coalesce(nullif(pr ->> 'status', ''), lp.status),
      phase                 = coalesce(nullif(pr ->> 'phase', ''), lp.phase),
      responsible_user_id   = coalesce(v_resp, lp.responsible_user_id)
    where lp.id = p_process_existing;
    insert into public.process_events (legal_process_id, event_type, title, description, occurred_at, source)
    values (p_process_existing, 'IMPORT', 'Dados atualizados por importação',
            'Dados atualizados pela importação da planilha "' || p_job.file_name || '" (linha ' || p_row || ').', now(), 'IMPORT');
    v_process := p_process_existing;
    v_out := v_out || jsonb_build_object('legal_process_id', v_process);

  elsif p_process_action = 'KEEP' then
    v_out := v_out || jsonb_build_object('legal_process_id', p_process_existing);
  end if;

  return v_out || jsonb_build_object('result',
    case when p_client_action in ('CREATE', 'UPDATE') or coalesce(p_process_action, '') in ('CREATE', 'UPDATE')
         then 'IMPORTED' else 'SKIPPED' end,
    'reason', case when not (p_client_action in ('CREATE', 'UPDATE') or coalesce(p_process_action, '') in ('CREATE', 'UPDATE'))
                   then 'Nada novo nesta linha: o cliente já existia ou foi gravado em outra linha, e não há processo novo.' end);
end
$$;

-- Grava até p_limit linhas pendentes (padrão 50, máx. 200) e devolve o progresso.
-- Chamado em sequência pela tela até `remaining` = 0. Seguro para repetir:
-- linha gravada não é gravada de novo; duas chamadas simultâneas se enfileiram
-- pela trava do job.
create or replace function private.import_process_batch(p_job_id uuid, p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v       public.import_jobs;
  a       record;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_done  integer := 0;
  v_left  integer;
  v_out   jsonb;
  v_state text;
  v_msg   text;
  v_counts jsonb;
begin
  v := private.import_lock_job(p_job_id, array['CONFIRMED', 'PROCESSING', 'COMPLETED']);
  if v.status = 'COMPLETED' then
    v_left := 0;
  else
    if v.status = 'CONFIRMED' then
      update public.import_jobs j set status = 'PROCESSING' where j.id = v.id;
    end if;

    for a in
      select x.*, r.payload
      from private.import_row_actions(v.id) x
      join public.import_row_results r on r.import_job_id = v.id and r.row_number = x.row_number
      where r.status in ('VALID', 'WARNING') and r.outcome is null
      order by x.row_number
      limit v_limit
    loop
      begin
        v_out := private.import_apply_row(v, a.row_number, a.payload, a.client_action, a.client_existing_id,
                                          a.first_client_row, a.process_action, a.process_existing_id);
        update public.import_row_results r set
          status = v_out ->> 'result',
          action = case when v_out ->> 'result' = 'SKIPPED' then 'SKIP'
                        when a.process_action = 'CREATE' or (a.process_action is distinct from 'UPDATE' and a.client_action = 'CREATE') then 'CREATE'
                        else 'UPDATE' end,
          entity_type = case when v_out ->> 'result' = 'SKIPPED' then null
                             when a.process_action in ('CREATE', 'UPDATE') then 'legal_processes' else 'clients' end,
          entity_id = case when v_out ->> 'result' = 'SKIPPED' then null
                           when a.process_action in ('CREATE', 'UPDATE') then (v_out ->> 'legal_process_id')::uuid
                           else (v_out ->> 'client_id')::uuid end,
          outcome = v_out
        where r.import_job_id = v.id and r.row_number = a.row_number;
      exception when others then
        get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
        update public.import_row_results r set
          status = 'ERROR',
          errors = r.errors || to_jsonb(private.import_error_text(v_state, v_msg)),
          outcome = jsonb_build_object('result', 'ERROR', 'client_action', a.client_action,
                                       'process_action', a.process_action, 'sqlstate', v_state)
        where r.import_job_id = v.id and r.row_number = a.row_number;
      end;
      v_done := v_done + 1;
    end loop;

    select count(*) into v_left from public.import_row_results r
    where r.import_job_id = v.id and r.status in ('VALID', 'WARNING') and r.outcome is null;
  end if;

  select jsonb_build_object(
    'imported', count(*) filter (where r.status = 'IMPORTED'),
    'imported_with_warnings', count(*) filter (where r.status = 'IMPORTED' and r.warnings <> '[]'::jsonb),
    'skipped',  count(*) filter (where r.status = 'SKIPPED'),
    'failed',   count(*) filter (where r.status = 'ERROR'),
    'failed_on_save', count(*) filter (where r.status = 'ERROR' and r.outcome is not null),
    'clients_created',   count(*) filter (where r.outcome ->> 'client_action' = 'CREATE' and r.status = 'IMPORTED'),
    'clients_updated',   count(*) filter (where r.outcome ->> 'client_action' = 'UPDATE' and r.status = 'IMPORTED'),
    'processes_created', count(*) filter (where r.outcome ->> 'process_action' = 'CREATE' and r.status = 'IMPORTED'),
    'processes_updated', count(*) filter (where r.outcome ->> 'process_action' = 'UPDATE' and r.status = 'IMPORTED'),
    'deadlines_created', count(*) filter (where r.outcome ->> 'deadline_id' is not null and r.status = 'IMPORTED'))
  into v_counts
  from public.import_row_results r where r.import_job_id = v.id;

  if v.status <> 'COMPLETED' then
    update public.import_jobs j set
      status = case when v_left = 0 then 'COMPLETED' else 'PROCESSING' end,
      successful_rows = (v_counts ->> 'imported')::integer,
      warning_rows = (v_counts ->> 'imported_with_warnings')::integer,
      failed_rows = (v_counts ->> 'failed')::integer
    where j.id = v.id;
    if v_left = 0 then
      perform private.record_audit_event('IMPORT_JOB_SUMMARY', 'import_jobs', v.id, v_counts);
    end if;
  end if;

  return jsonb_build_object('status', case when v_left = 0 then 'COMPLETED' else 'PROCESSING' end,
                            'processed', v_done, 'remaining', v_left) || v_counts;
end
$$;

create or replace function private.import_cancel(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.import_jobs;
begin
  v := private.import_lock_job(p_job_id, array['UPLOADED', 'COLUMNS_DETECTED', 'MAPPED', 'VALIDATED', 'CONFLICTS_PENDING', 'CONFIRMED']);
  update public.import_jobs j set status = 'CANCELLED', completed_at = now() where j.id = v.id;
end
$$;

-- ═════════════════════════════ 9. arquivo no Storage ═════════════════════
-- O servidor apaga o arquivo quando o job termina (concluído, cancelado,
-- falhou) e marca aqui. A lista abaixo também pega os que ficaram para trás.

create or replace function private.import_files_to_delete(p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Somente o administrador opera importações' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'storage_object_name', x.storage_object_name))
    from (select j.id, j.storage_object_name from public.import_jobs j
          where j.status in ('COMPLETED', 'FAILED', 'CANCELLED')
            and j.storage_object_name is not null and j.source_file_deleted_at is null
          order by j.updated_at
          limit least(greatest(coalesce(p_limit, 20), 1), 100)) x), '[]'::jsonb);
end
$$;

create or replace function private.import_mark_file_deleted(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.import_jobs;
begin
  v := private.import_lock_job(p_job_id, array['COMPLETED', 'FAILED', 'CANCELLED']);
  update public.import_jobs j set source_file_deleted_at = coalesce(j.source_file_deleted_at, now()) where j.id = v.id;
end
$$;

-- ═════════════════════════════ 10. retenção ══════════════════════════════

-- (013, redefinida) Apaga a linha original E a normalizada; a procedência fica.
create or replace function private.purge_import_raw_data(p_older_than interval default interval '30 days')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.import_row_results r
     set raw_data = null, payload = null
    from public.import_jobs j
   where j.id = r.import_job_id
     and (r.raw_data is not null or r.payload is not null)
     and j.status in ('COMPLETED', 'FAILED', 'CANCELLED')
     and coalesce(j.completed_at, j.updated_at) < now() - p_older_than;
  get diagnostics n = row_count;
  return n;
end
$$;

revoke all on function private.purge_import_raw_data(interval) from public, anon, authenticated;
grant execute on function private.purge_import_raw_data(interval) to service_role;

-- Diária: expurgo de 30 dias e cancelamento de importação abandonada (antes da
-- confirmação, parada há 7 dias).
create or replace function private.import_housekeeping()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cancelled integer;
begin
  update public.import_jobs j set status = 'CANCELLED', completed_at = now(),
         error_message = 'Cancelada automaticamente: parada por mais de 7 dias antes da confirmação.'
  where j.status in ('UPLOADED', 'COLUMNS_DETECTED', 'MAPPED', 'VALIDATED', 'CONFLICTS_PENDING')
    and j.updated_at < now() - interval '7 days';
  get diagnostics v_cancelled = row_count;
  return jsonb_build_object('cancelled', v_cancelled, 'purged_rows', private.purge_import_raw_data(interval '30 days'));
end
$$;

do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('dg-importacoes', '17 6 * * *', 'select private.import_housekeeping()');
  else
    raise notice 'pg_cron indisponível: agende private.import_housekeeping() uma vez por dia';
  end if;
end
$$;

-- ═════════════════════════════ 11. API (public) ══════════════════════════

create or replace function public.import_create_job(p_file_name text, p_file_type text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.import_create_job(p_file_name, p_file_type) $$;

create or replace function public.import_authorize_file(p_job_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.import_authorize_file(p_job_id) $$;

create or replace function public.import_register_columns(p_job_id uuid, p_checksum text, p_sheet_name text, p_columns jsonb, p_total_rows integer)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.import_register_columns(p_job_id, p_checksum, p_sheet_name, p_columns, p_total_rows) $$;

create or replace function public.import_fail(p_job_id uuid, p_message text)
returns void language sql security invoker set search_path = ''
as $$ select private.import_fail(p_job_id, p_message) $$;

create or replace function public.import_save_mapping(p_job_id uuid, p_mappings jsonb, p_options jsonb default '{}')
returns jsonb language sql security invoker set search_path = ''
as $$ select private.import_save_mapping(p_job_id, p_mappings, p_options) $$;

create or replace function public.import_stage_rows(p_job_id uuid, p_rows jsonb, p_reset boolean default false)
returns integer language sql security invoker set search_path = ''
as $$ select private.import_stage_rows(p_job_id, p_rows, p_reset) $$;

create or replace function public.import_finish_dry_run(p_job_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.import_finish_dry_run(p_job_id) $$;

create or replace function public.import_resolve_conflicts(p_job_id uuid, p_items jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.import_resolve_conflicts(p_job_id, p_items) $$;

create or replace function public.get_import_plan(p_job_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.get_import_plan(p_job_id) $$;

create or replace function public.get_import_conflicts(p_job_id uuid, p_offset integer default 0, p_limit integer default 100)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.get_import_conflicts(p_job_id, p_offset, p_limit) $$;

create or replace function public.get_import_reference_data()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.get_import_reference_data() $$;

create or replace function public.import_confirm(p_job_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.import_confirm(p_job_id) $$;

create or replace function public.import_process_batch(p_job_id uuid, p_limit integer default 50)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.import_process_batch(p_job_id, p_limit) $$;

create or replace function public.import_cancel(p_job_id uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.import_cancel(p_job_id) $$;

create or replace function public.import_files_to_delete(p_limit integer default 20)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.import_files_to_delete(p_limit) $$;

create or replace function public.import_mark_file_deleted(p_job_id uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.import_mark_file_deleted(p_job_id) $$;

-- ═════════════════════════════ 12. grants ════════════════════════════════

do $$
declare
  f regprocedure;
begin
  -- Fechadas para todos; abertas abaixo só para quem precisa.
  for f in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'private' and p.proname in (
             'import_normalize_name', 'import_status_label', 'import_target_fields', 'import_allowed_resolutions',
             'import_lock_job', 'import_error_text', 'import_column_mappings_guard', 'import_create_job',
             'import_authorize_file', 'import_register_columns', 'import_fail', 'import_save_mapping',
             'import_stage_rows', 'import_finish_dry_run', 'import_resolve_conflicts', 'import_row_actions',
             'get_import_plan', 'get_import_conflicts', 'get_import_reference_data', 'import_confirm',
             'import_client_patch', 'import_apply_row', 'import_process_batch', 'import_cancel',
             'import_files_to_delete', 'import_mark_file_deleted', 'import_housekeeping'))
       or (n.nspname = 'public' and p.proname in (
             'import_create_job', 'import_authorize_file', 'import_register_columns', 'import_fail',
             'import_save_mapping', 'import_stage_rows', 'import_finish_dry_run', 'import_resolve_conflicts',
             'get_import_plan', 'get_import_conflicts', 'get_import_reference_data', 'import_confirm',
             'import_process_batch', 'import_cancel', 'import_files_to_delete', 'import_mark_file_deleted'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;

  -- Operações da tela: o usuário logado chama a pública (invoker), que chama a
  -- privada (definer) — cada uma confere ADMIN. As internas (aplicar linha,
  -- montar cadastro, trava) não são abertas a ninguém.
  for f in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('private', 'public') and p.proname in (
             'import_create_job', 'import_authorize_file', 'import_register_columns', 'import_fail',
             'import_save_mapping', 'import_stage_rows', 'import_finish_dry_run', 'import_resolve_conflicts',
             'get_import_plan', 'get_import_conflicts', 'get_import_reference_data', 'import_confirm',
             'import_process_batch', 'import_cancel', 'import_files_to_delete', 'import_mark_file_deleted')
  loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end
$$;
