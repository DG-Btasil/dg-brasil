-- 051 · Ponte entre o DG Brasil e os agentes da máquina (docs/ponte.md).
--
-- O computador do escritório passa a levar os documentos de um trabalho para a
-- pasta do cliente no Drive (G:\), onde os agentes do escritório (Clara,
-- Lucas...) trabalham do jeito de sempre, e a trazer o que eles geraram para
-- Revisões. O banco só precisa de três coisas novas:
--
--   1. executor_bridge_data: a pasta do Drive ligada ao cliente DO TRABALHO e
--      os dados do cadastro que os agentes leem no "DADOS DO CADASTRO.txt".
--      Só do cliente do trabalho reservado; registra o acesso a dado pessoal.
--   2. executor_fail aceita PORTEIRO_BLOQUEOU e SEM_PASTA_NO_DRIVE. O bloqueio
--      do Porteiro continua com o próprio código mesmo depois da pendência que
--      ele registra (não é "entrega parcial").
--   3. drive_match_existing: a sincronização diária não traz de volta, como
--      "Outro", o arquivo que o cliente já tem no DG Brasil (o HISCON que a
--      ponte copiou, o roteiro que já foi entregue): mesmo SHA-256 no mesmo
--      cliente vira só um registro de "já conhecido".

-- ═════════════════════════════ 1. dados da ponte ══════════════════════════

create or replace function private.executor_bridge_data(p_token_hash text, p_agent_run_id uuid, p_lease_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_by     text := private.executor_lease(p_token_hash, p_agent_run_id, p_lease_hash, 'case.read');
  v_scope  record;
  v_out    jsonb;
begin
  select * into v_scope from private.worker_scope(p_agent_run_id, v_by);
  if v_scope.client_id is null then
    return jsonb_build_object('cliente', null, 'pasta_drive', null);
  end if;

  select jsonb_build_object(
    'cliente', jsonb_build_object(
      'id', c.id,
      'tipo', c.kind,
      'nome', coalesce(i.full_name, co.legal_name),
      'profissao', i.profession,
      'estado_civil', case i.marital_status
                        when 'SINGLE' then 'solteiro(a)' when 'MARRIED' then 'casado(a)'
                        when 'DIVORCED' then 'divorciado(a)' when 'WIDOWED' then 'viúvo(a)'
                        when 'SEPARATED' then 'separado(a)' end,
      'email', (select ct.value from public.client_contacts ct
                where ct.client_id = c.id and ct.type = 'EMAIL'
                order by ct.is_primary desc, ct.created_at limit 1)),
    'pasta_drive', (select jsonb_build_object('id', l.external_folder_id, 'nome', l.folder_name_snapshot)
                    from public.external_folder_links l
                    where l.client_id = c.id and l.provider = 'GOOGLE_DRIVE' and l.unlinked_at is null
                    limit 1)
  ) into v_out
  from public.clients c
  left join public.individual_client_details i on i.client_id = c.id
  left join public.company_client_details co on co.client_id = c.id
  where c.id = v_scope.client_id and c.deleted_at is null;

  if v_out is null then
    return jsonb_build_object('cliente', null, 'pasta_drive', null);
  end if;
  perform private.record_personal_data_access(v_scope.client_id,
    case when v_scope.legal_case_id is not null then 'LEGAL_CASE' else 'CLIENT' end,
    coalesce(v_scope.legal_case_id, v_scope.client_id),
    'VIEW_DETAIL', 'Ponte com os agentes do computador do escritório');
  return v_out;
end
$$;

comment on function private.executor_bridge_data(text, uuid, text) is
  'Ponte (docs/ponte.md): pasta do Drive ligada ao cliente do trabalho reservado e os dados do cadastro. Nunca de outro cliente.';

-- ═════════════════════════════ 2. códigos de falha ════════════════════════

create or replace function private.executor_fail(
  p_token_hash text, p_agent_run_id uuid, p_lease_hash text, p_error_code text, p_message text,
  p_retryable boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_by     text := private.executor_lease(p_token_hash, p_agent_run_id, p_lease_hash, 'jobs.claim');
  v_run    record;
  v_status text;
  v_code   text;
  v_partial boolean;
begin
  if p_error_code not in ('MISSING_INPUT', 'DOCUMENT_CHECKSUM_MISMATCH', 'DOCUMENT_UNREADABLE', 'INVALID_OUTPUT',
                          'TOOL_ERROR', 'AGENT_NOT_FOUND', 'AGENT_ERROR', 'CONFIGURATION_ERROR', 'INTERRUPTED',
                          'INTERNAL_ERROR', 'PORTEIRO_BLOQUEOU', 'SEM_PASTA_NO_DRIVE') then
    raise exception 'Código de erro desconhecido: %', p_error_code using errcode = '22023';
  end if;
  select r.queue_msg_id, r.attempt, r.cancel_requested_at,
         exists (select 1 from public.agent_proposals p where p.agent_run_id = r.id)
           or exists (select 1 from public.legal_analysis_results x where x.agent_run_id = r.id)
           or jsonb_array_length(coalesce(r.metadata -> 'documents', '[]'::jsonb)) > 0 as has_output
    into v_run
  from public.agent_runs r where r.id = p_agent_run_id;

  -- O Porteiro registra a pendência ANTES de encerrar: isso não é resultado
  -- parcial do agente. Bloqueio nunca volta sozinho para a fila.
  v_partial := v_run.has_output and p_error_code <> 'PORTEIRO_BLOQUEOU';

  if v_run.cancel_requested_at is not null then
    perform private.worker_finish_run(p_agent_run_id, v_by, 'CANCELLED');
    v_status := 'CANCELLED';
  elsif coalesce(p_retryable, false) and not v_run.has_output and v_run.attempt < 3
        and p_error_code not in ('PORTEIRO_BLOQUEOU', 'SEM_PASTA_NO_DRIVE') then
    update public.agent_runs
       set status = 'QUEUED', claimed_by = null, lease_token_hash = null,
           error_code = p_error_code, error_message = left(p_message, 2000),
           progress_message = 'De volta à fila', progress_at = now()
     where id = p_agent_run_id;
    if v_run.queue_msg_id is not null then
      perform pgmq.set_vt('agent_execution', v_run.queue_msg_id, 30);
    end if;
    return jsonb_build_object('status', 'QUEUED', 'error_code', p_error_code);
  else
    v_code := case when v_partial then 'PARTIAL_OUTPUT' else p_error_code end;
    perform private.worker_finish_run(p_agent_run_id, v_by, 'FAILED', v_code,
      case when v_partial then 'Falhou depois de entregar parte do resultado: ' else '' end || left(p_message, 1800));
    v_status := 'FAILED';
  end if;

  update public.agent_runs set lease_token_hash = null, progress_at = now(),
         progress_message = case v_status when 'CANCELLED' then 'Interrompido a pedido'
                                          when 'FAILED' then case p_error_code when 'PORTEIRO_BLOQUEOU' then 'Parado pelo Porteiro'
                                                                               else 'Falhou' end end
   where id = p_agent_run_id;
  if v_run.queue_msg_id is not null then
    perform pgmq.archive('agent_execution', v_run.queue_msg_id);
  end if;
  return jsonb_build_object('status', v_status, 'error_code', v_code);
end
$$;

-- ═════════════════════════════ 3. Drive sem duplicata ═════════════════════

-- Arquivo da pasta do cliente com o MESMO conteúdo (SHA-256) de uma versão que
-- o cliente já tem no DG Brasil: registra o arquivo do Drive como conhecido,
-- apontando para essa versão, e não importa de novo. Só versões do cliente da
-- própria ligação.
create or replace function private.drive_match_existing(
  p_link_id uuid, p_file_id text, p_md5 text, p_name text, p_modified_at timestamptz, p_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client  uuid;
  v_version uuid;
begin
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'SHA-256 inválido' using errcode = '22023';
  end if;
  select l.client_id into v_client from public.external_folder_links l where l.id = p_link_id and l.unlinked_at is null;
  if v_client is null then
    raise exception 'Ligação de pasta inexistente ou desligada' using errcode = 'P0002';
  end if;
  select v.id into v_version
  from public.document_versions v
  join public.documents d on d.id = v.document_id and d.deleted_at is null
  where d.client_id = v_client and v.checksum_sha256 = p_sha256
  order by v.created_at desc
  limit 1;
  if v_version is null then
    return jsonb_build_object('matched', false);
  end if;
  insert into public.external_document_imports
    (folder_link_id, external_file_id, external_md5, external_name, external_modified_at, document_version_id)
  values (p_link_id, p_file_id, p_md5, left(p_name, 300), p_modified_at, v_version)
  on conflict (provider, external_file_id, external_md5) do nothing;
  return jsonb_build_object('matched', true, 'document_version_id', v_version);
end
$$;

-- ═════════════════════════════ grants ═════════════════════════════════════

revoke all on function private.executor_bridge_data(text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.executor_fail(text, uuid, text, text, text, boolean) from public, anon, authenticated, service_role;
revoke all on function private.drive_match_existing(uuid, text, text, text, timestamptz, text) from public, anon, authenticated, service_role;
grant execute on function private.executor_bridge_data(text, uuid, text) to dg_worker;
grant execute on function private.executor_fail(text, uuid, text, text, text, boolean) to dg_worker;
grant execute on function private.drive_match_existing(uuid, text, text, text, timestamptz, text) to dg_worker;
