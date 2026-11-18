-- 082 · Importação de planilha com o escritório PARCEIRO de origem.
--
-- Caso real (18/11/2026): um parceiro anterior ao DG Brasil entra com uns 150
-- clientes e 300 processos já em andamento, que não passam pela esteira. A
-- importação (042) já cria um caso "em andamento" para cada processo, mas
-- gravava tudo como do escritório: o parceiro não enxergava nada.
--
-- Agora o mapeamento aceita a opção partner_organization_id (parceiro ATIVO,
-- com a configuração de parceria). Com ela, nesta importação:
--
--   · cliente NOVO nasce com origem no parceiro (clients.origin_organization_id,
--     a origem histórica, que também decide a pasta da ponte, 060) e já
--     relacionado ao parceiro (client_organization_relationships), para ele ver
--     o cadastro mesmo sem processo na linha;
--   · caso NOVO nasce com origem no parceiro (atribuição comercial: o gatilho de
--     sempre grava a divisão da parceria pelo percentual do parceiro) e ligado
--     a ele (partner_organization_id: visibilidade, RLS). O gatilho da 006 cria
--     o relacionamento do cliente com o parceiro;
--   · cliente que JÁ existia não muda de origem (a origem é histórica): ele
--     passa a ser visto pelo parceiro só pelo caso novo da linha;
--   · processo que já existia (CNJ cadastrado, "Atualizar") não muda de caso
--     nem de parceiro.
--
-- Sem a opção, tudo segue como na 042. get_import_reference_data devolve
-- também os parceiros ativos. Assinaturas iguais: as permissões da 042 valem.
-- 001–081 não são alteradas.

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
  v_partner uuid;
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

  -- (082) Parceiro de origem: opcional; vale para clientes e casos novos.
  if nullif(p_options ->> 'partner_organization_id', '') is not null then
    if (p_options ->> 'partner_organization_id') !~ v_uuid then
      raise exception 'Parceiro de origem inválido' using errcode = '22023';
    end if;
    v_partner := (p_options ->> 'partner_organization_id')::uuid;
    if not exists (select 1 from public.organizations o
                   where o.id = v_partner and o.type = 'PARTNER' and o.status = 'ACTIVE' and o.deleted_at is null) then
      raise exception 'O parceiro de origem precisa ser um escritório parceiro ativo' using errcode = '22023';
    end if;
    if not exists (select 1 from public.partner_office_settings s where s.organization_id = v_partner) then
      raise exception 'Este parceiro ainda não tem a configuração de parceria (percentuais). Configure em Parceiros antes de importar.'
        using errcode = '22023';
    end if;
    v_opts := v_opts || jsonb_build_object('partner_organization_id', v_partner);
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
                       where m.status = 'ACTIVE' and private.is_active_internal_user(m.user_id)), '[]'::jsonb),
    -- (082) Parceiros que podem ser a origem de uma importação.
    'partners', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name,
                                                              'configured', s.organization_id is not null) order by o.name)
                          from public.organizations o
                          left join public.partner_office_settings s on s.organization_id = o.id
                          where o.type = 'PARTNER' and o.status = 'ACTIVE' and o.deleted_at is null), '[]'::jsonb));
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
      'origin_organization_id', coalesce(nullif(p_job.options ->> 'partner_organization_id', '')::uuid, p_job.organization_id),
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
  v_partner  uuid := nullif(p_job.options ->> 'partner_organization_id', '')::uuid;
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
    -- (082) Cliente novo de um parceiro: ele vê o cadastro mesmo sem processo na linha.
    if v_partner is not null then
      insert into public.client_organization_relationships (client_id, organization_id, created_by)
      values (v_client, v_partner, auth.uid())
      on conflict (client_id, organization_id) do update
        set status = 'ACTIVE', ended_at = null
        where public.client_organization_relationships.status <> 'ACTIVE';
    end if;
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

    -- (082) Com parceiro: origem (divisão da parceria) e visibilidade no parceiro.
    insert into public.legal_cases (client_id, legal_area_id, title, opposing_party, status, origin_organization_id,
                                    partner_organization_id, assigned_lawyer_id)
    values (v_client, (p_job.options ->> 'legal_area_id')::uuid,
            left(coalesce(nullif(btrim(pr ->> 'title'), ''), nullif(btrim(pr ->> 'legal_class'), ''),
                          'Processo ' || coalesce(v_cnj, 'importado')), 300),
            nullif(btrim(coalesce(pr ->> 'adverse_party', '')), ''),
            'IN_PROGRESS', coalesce(v_partner, p_job.organization_id), v_partner, v_lawyer)
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
