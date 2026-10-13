-- DG Brasil — 025: suporte ao backend de domínio (Etapa 4.2)
--
--   1. Correlation ID na auditoria. A auditoria lê `dg.request_id`, que só dava
--      para declarar com SQL direto — o backend fala com o banco pelo PostgREST.
--      Uma função de pré-requisição do PostgREST copia o cabeçalho
--      `x-dg-request-id` para `dg.request_id`, SÓ se for um UUID (nada de texto
--      livre nem PII). Toda auditoria gravada na requisição leva o ID. Funções
--      congeladas (014) não mudam.
--   2. Cliente do parceiro sem vazamento (Portal do Parceiro). Parceiro não lê
--      nem cria cliente fora dos próprios relacionamentos (RLS), então:
--        partner_lookup_client  CPF/CNPJ → NOT_FOUND | ALREADY_RELATED (+id) |
--                               EXISTS (sem id, sem nome, sem outro escritório);
--        partner_submit_case    numa transação: cliente canônico (cria só se o
--                               CPF/CNPJ não existe; nunca sobrescreve) → caso
--                               SUBMITTED do próprio escritório (o trigger da 006
--                               cria o relacionamento). Auditado com o usuário.
--      Ambas exigem usuário de parceiro com sessão aal2 (current_membership).
--
-- Pós-baseline: 001–024 não são alteradas.

-- ───────────────────────────── 1. correlation ID ──────────────────────────

create or replace function public.dg_pre_request()
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_id text;
begin
  -- Nunca pode falhar: roda antes de TODA requisição da API.
  begin
    v_id := (nullif(current_setting('request.headers', true), '')::jsonb) ->> 'x-dg-request-id';
  exception when others then
    v_id := null;
  end;
  if v_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    perform set_config('dg.request_id', lower(v_id), true);
  end if;
end
$$;

comment on function public.dg_pre_request() is
  'Pré-requisição do PostgREST: copia x-dg-request-id (UUID) para dg.request_id (auditoria). Só define uma variável da transação.';

revoke all on function public.dg_pre_request() from public;
grant execute on function public.dg_pre_request() to anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute 'alter role authenticator set pgrst.db_pre_request = ''public.dg_pre_request''';
    perform pg_notify('pgrst', 'reload config');
  end if;
end
$$;

-- ───────────────────────────── 2. cliente do parceiro ─────────────────────

create or replace function private.partner_lookup_client(p_document text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_digits  text := regexp_replace(coalesce(p_document, ''), '\D', '', 'g');
  v_partner uuid := private.current_partner_organization_id();
  v_client  uuid;
begin
  if auth.uid() is null or not private.is_partner_user() or v_partner is null then
    raise exception 'Operação exclusiva do Portal do Parceiro' using errcode = '42501';
  end if;
  if length(v_digits) not in (11, 14) then
    raise exception 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos)' using errcode = '22023';
  end if;

  select c.id into v_client from public.clients c
  where (length(v_digits) = 11 and c.cpf = v_digits) or (length(v_digits) = 14 and c.cnpj = v_digits);

  if v_client is null then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;
  if private.can_access_client(v_client) then
    return jsonb_build_object('status', 'ALREADY_RELATED', 'client_id', v_client);
  end if;

  -- Registro interno de quem consultou; nada sobre o cliente volta ao parceiro.
  perform private.record_audit_event('CLIENT_DUPLICATE_DETECTED', 'clients', v_client,
    jsonb_build_object('organization_id', v_partner));
  return jsonb_build_object('status', 'EXISTS');
end
$$;

-- p_client: { document, kind (INDIVIDUAL|COMPANY), origin_organization_id,
--             full_name | legal_name, trade_name?, birth_date?,
--             email?, phone?, address?: { postal_code, street, number,
--             complement, neighborhood, city, state } }
-- p_case:   { legal_area_id, case_type_id?, title, summary?, opposing_party?,
--             origin_organization_id, partner_notes? }
create or replace function private.partner_submit_case(p_client jsonb, p_case jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_partner  uuid := private.current_partner_organization_id();
  v_digits   text := regexp_replace(coalesce(p_client ->> 'document', ''), '\D', '', 'g');
  v_kind     public.client_kind;
  v_client   uuid;
  v_deleted  timestamptz;
  v_existed  boolean := false;
  v_case     uuid := gen_random_uuid();
  v_address  jsonb := p_client -> 'address';
begin
  if auth.uid() is null or not private.is_partner_user() or v_partner is null then
    raise exception 'Operação exclusiva do Portal do Parceiro' using errcode = '42501';
  end if;
  if length(v_digits) not in (11, 14) then
    raise exception 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos)' using errcode = '22023';
  end if;
  v_kind := case when length(v_digits) = 11 then 'INDIVIDUAL' else 'COMPANY' end;
  if (p_client ->> 'kind') is distinct from v_kind::text then
    raise exception 'O tipo do cliente não corresponde ao documento informado' using errcode = '22023';
  end if;

  select c.id, c.deleted_at into v_client, v_deleted from public.clients c
  where (v_kind = 'INDIVIDUAL' and c.cpf = v_digits) or (v_kind = 'COMPANY' and c.cnpj = v_digits);

  if v_client is not null then
    if v_deleted is not null then
      -- Não revela que o cadastro foi excluído: a equipe interna resolve.
      raise exception 'Não foi possível usar este CPF/CNPJ. Fale com o escritório Bárbara Cardoso.' using errcode = 'P0001';
    end if;
    -- Cliente canônico existente: nunca sobrescreve dados de outro escritório.
    v_existed := true;
    if not private.can_access_client(v_client) then
      perform private.record_audit_event('CLIENT_PARTNER_LINKED', 'clients', v_client,
        jsonb_build_object('organization_id', v_partner));
    end if;
  else
    insert into public.clients (kind, cpf, cnpj, origin_organization_id)
    values (v_kind,
            case when v_kind = 'INDIVIDUAL' then v_digits end,
            case when v_kind = 'COMPANY' then v_digits end,
            (p_client ->> 'origin_organization_id')::uuid)
    returning id into v_client;

    if v_kind = 'INDIVIDUAL' then
      insert into public.individual_client_details (client_id, full_name, birth_date)
      values (v_client, btrim(p_client ->> 'full_name'), nullif(p_client ->> 'birth_date', '')::date);
    else
      insert into public.company_client_details (client_id, legal_name, trade_name)
      values (v_client, btrim(p_client ->> 'legal_name'), nullif(btrim(coalesce(p_client ->> 'trade_name', '')), ''));
    end if;

    if nullif(btrim(coalesce(p_client ->> 'email', '')), '') is not null then
      insert into public.client_contacts (client_id, type, value, is_primary)
      values (v_client, 'EMAIL', lower(btrim(p_client ->> 'email')), true);
    end if;
    if nullif(btrim(coalesce(p_client ->> 'phone', '')), '') is not null then
      insert into public.client_contacts (client_id, type, value, is_primary)
      values (v_client, 'PHONE', regexp_replace(p_client ->> 'phone', '\D', '', 'g'), true);
    end if;
    if v_address is not null and jsonb_typeof(v_address) = 'object' then
      insert into public.client_addresses
        (client_id, postal_code, street, number, complement, neighborhood, city, state, is_primary)
      values (v_client,
              nullif(regexp_replace(coalesce(v_address ->> 'postal_code', ''), '\D', '', 'g'), ''),
              nullif(btrim(coalesce(v_address ->> 'street', '')), ''),
              nullif(btrim(coalesce(v_address ->> 'number', '')), ''),
              nullif(btrim(coalesce(v_address ->> 'complement', '')), ''),
              nullif(btrim(coalesce(v_address ->> 'neighborhood', '')), ''),
              nullif(btrim(coalesce(v_address ->> 'city', '')), ''),
              nullif(upper(btrim(coalesce(v_address ->> 'state', ''))), '')::public.uf_code,
              true);
    end if;
  end if;

  -- Caso do próprio escritório. Origem (parceiro ou proprietário), estado
  -- inicial e relacionamento são garantidos pelos triggers da 006.
  insert into public.legal_cases
    (id, client_id, legal_area_id, case_type_id, title, summary, opposing_party, status,
     partner_organization_id, origin_organization_id, partner_notes)
  values
    (v_case, v_client,
     (p_case ->> 'legal_area_id')::uuid,
     nullif(p_case ->> 'case_type_id', '')::uuid,
     btrim(p_case ->> 'title'),
     nullif(btrim(coalesce(p_case ->> 'summary', '')), ''),
     nullif(btrim(coalesce(p_case ->> 'opposing_party', '')), ''),
     'SUBMITTED',
     v_partner,
     (p_case ->> 'origin_organization_id')::uuid,
     nullif(btrim(coalesce(p_case ->> 'partner_notes', '')), ''));

  return jsonb_build_object('client_id', v_client, 'legal_case_id', v_case, 'client_existed', v_existed);
end
$$;

create or replace function public.partner_lookup_client(p_document text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.partner_lookup_client(p_document) $$;

create or replace function public.partner_submit_case(p_client jsonb, p_case jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.partner_submit_case(p_client, p_case) $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'private.partner_lookup_client(text)', 'public.partner_lookup_client(text)',
    'private.partner_submit_case(jsonb, jsonb)', 'public.partner_submit_case(jsonb, jsonb)']
  loop
    execute format('revoke all on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end
$$;

-- ───────────────────────────── 3. clientes: busca e gravação ──────────────
--
-- client_directory: listagem/busca paginada (nome, CPF/CNPJ, status, origem,
-- responsável) sem juntar tabelas no navegador. security_invoker: herda a RLS
-- de clients e dos detalhes (parceiro só vê os próprios relacionamentos).
create view public.client_directory
with (security_invoker = true) as
select c.id,
       c.kind,
       coalesce(i.full_name, co.legal_name) as display_name,
       co.trade_name,
       c.cpf,
       c.cnpj,
       c.status,
       c.origin_organization_id,
       c.responsible_user_id,
       c.created_at,
       c.updated_at,
       c.deleted_at
from public.clients c
left join public.individual_client_details i on i.client_id = c.id
left join public.company_client_details co on co.client_id = c.id;

comment on view public.client_directory is
  'Listagem/busca de clientes (security_invoker: mesma visibilidade de clients). Sem dados internos.';

revoke all on public.client_directory from public, anon;
grant select on public.client_directory to authenticated, service_role;

-- Grava um cliente (p_id nulo = cria) numa transação: cadastro, dados PF/PJ,
-- contatos principais, endereço principal, representantes/sócios (só na
-- criação) e dados internos. PATCH: chave ausente = não mexe; null = limpa.
--   Interno (ADMIN/LAWYER/ASSISTANT): tudo (CPF/CNPJ só ADMIN — trigger 004).
--   Parceiro: só `contact` e `address` de cliente que acessa.
-- Duplicidade de CPF/CNPJ cai na unique (clients_cpf_key/clients_cnpj_key).
create or replace function private.save_client(p_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_internal boolean := private.is_internal_user();
  v_partner  boolean := private.is_partner_user();
  v_id       uuid := p_id;
  v_kind     public.client_kind;
  v_contact  jsonb := p -> 'contact';
  v_address  jsonb := p -> 'address';
  v_key      text;
  v_type     text;
  v_value    text;
  v_has      boolean;
begin
  if auth.uid() is null or not (v_internal or v_partner) then
    raise exception 'Sem permissão para cadastrar clientes' using errcode = '42501';
  end if;

  if v_partner then
    if p_id is null then
      raise exception 'Parceiro cadastra cliente pelo envio de caso' using errcode = '42501';
    end if;
    for v_key in select jsonb_object_keys(p) loop
      if v_key not in ('contact', 'address') then
        raise exception 'Parceiro só altera contato e endereço do cliente' using errcode = '42501';
      end if;
    end loop;
    if not private.can_access_client(p_id) then
      raise exception 'Cliente não encontrado' using errcode = '42501';
    end if;
  end if;

  if v_id is null then
    v_kind := (p ->> 'kind')::public.client_kind;
    insert into public.clients (kind, cpf, cnpj, origin_organization_id, responsible_user_id)
    values (v_kind,
            case when v_kind = 'INDIVIDUAL' then regexp_replace(p ->> 'document', '\D', '', 'g') end,
            case when v_kind = 'COMPANY' then regexp_replace(p ->> 'document', '\D', '', 'g') end,
            (p ->> 'origin_organization_id')::uuid,
            nullif(p ->> 'responsible_user_id', '')::uuid)
    returning id into v_id;
    if v_kind = 'INDIVIDUAL' then
      insert into public.individual_client_details (client_id, full_name) values (v_id, btrim(p ->> 'full_name'));
    else
      insert into public.company_client_details (client_id, legal_name) values (v_id, btrim(p ->> 'legal_name'));
    end if;
  else
    select c.kind into v_kind from public.clients c where c.id = v_id and c.deleted_at is null;
    if v_kind is null then
      raise exception 'Cliente não encontrado' using errcode = '42501';
    end if;
    update public.clients c set
      origin_organization_id = case when p ? 'origin_organization_id' then (p ->> 'origin_organization_id')::uuid else c.origin_organization_id end,
      responsible_user_id    = case when p ? 'responsible_user_id' then nullif(p ->> 'responsible_user_id', '')::uuid else c.responsible_user_id end,
      cpf  = case when v_kind = 'INDIVIDUAL' and p ? 'document' then regexp_replace(p ->> 'document', '\D', '', 'g') else c.cpf end,
      cnpj = case when v_kind = 'COMPANY' and p ? 'document' then regexp_replace(p ->> 'document', '\D', '', 'g') else c.cnpj end
    where c.id = v_id
      and (p ? 'origin_organization_id' or p ? 'responsible_user_id' or p ? 'document');
  end if;

  -- Dados PF/PJ (só interno chega aqui com essas chaves).
  if v_kind = 'INDIVIDUAL' then
    update public.individual_client_details d set
      full_name      = case when p ? 'full_name' then btrim(p ->> 'full_name') else d.full_name end,
      social_name    = case when p ? 'social_name' then nullif(btrim(p ->> 'social_name'), '') else d.social_name end,
      birth_date     = case when p ? 'birth_date' then nullif(p ->> 'birth_date', '')::date else d.birth_date end,
      gender         = case when p ? 'gender' then nullif(p ->> 'gender', '') else d.gender end,
      nationality    = case when p ? 'nationality' then nullif(btrim(p ->> 'nationality'), '') else d.nationality end,
      birthplace     = case when p ? 'birthplace' then nullif(btrim(p ->> 'birthplace'), '') else d.birthplace end,
      marital_status = case when p ? 'marital_status' then nullif(p ->> 'marital_status', '') else d.marital_status end,
      stable_union   = case when p ? 'stable_union' then (p ->> 'stable_union')::boolean else d.stable_union end,
      profession     = case when p ? 'profession' then nullif(btrim(p ->> 'profession'), '') else d.profession end,
      identity_document_type   = case when p ? 'identity_document' then nullif(p -> 'identity_document' ->> 'type', '') else d.identity_document_type end,
      identity_document_number = case when p ? 'identity_document' then nullif(btrim(p -> 'identity_document' ->> 'number'), '') else d.identity_document_number end,
      identity_document_issuer = case when p ? 'identity_document' then nullif(btrim(p -> 'identity_document' ->> 'issuer'), '') else d.identity_document_issuer end,
      identity_document_state  = case when p ? 'identity_document' then nullif(upper(p -> 'identity_document' ->> 'state'), '')::public.uf_code else d.identity_document_state end
    where d.client_id = v_id
      and (p ?| array['full_name', 'social_name', 'birth_date', 'gender', 'nationality', 'birthplace',
                      'marital_status', 'stable_union', 'profession', 'identity_document']);
  else
    update public.company_client_details d set
      legal_name          = case when p ? 'legal_name' then btrim(p ->> 'legal_name') else d.legal_name end,
      trade_name          = case when p ? 'trade_name' then nullif(btrim(p ->> 'trade_name'), '') else d.trade_name end,
      registration_status = case when p ? 'registration_status' then nullif(btrim(p ->> 'registration_status'), '') else d.registration_status end,
      opening_date        = case when p ? 'opening_date' then nullif(p ->> 'opening_date', '')::date else d.opening_date end,
      legal_nature        = case when p ? 'legal_nature' then nullif(btrim(p ->> 'legal_nature'), '') else d.legal_nature end,
      main_cnae           = case when p ? 'main_cnae' then nullif(p ->> 'main_cnae', '') else d.main_cnae end,
      secondary_cnaes     = case when p ? 'secondary_cnaes'
                                 then coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'secondary_cnaes') x), '{}')
                                 else d.secondary_cnaes end
    where d.client_id = v_id
      and (p ?| array['legal_name', 'trade_name', 'registration_status', 'opening_date', 'legal_nature', 'main_cnae', 'secondary_cnaes']);

    -- Representantes e sócios: só na criação (edição tem tela própria depois).
    if p_id is null and jsonb_typeof(p -> 'representatives') = 'array' then
      insert into public.company_representatives (client_id, full_name, cpf, role_title, email, phone, primary_representative)
      select v_id, btrim(r ->> 'name'), nullif(regexp_replace(coalesce(r ->> 'cpf', ''), '\D', '', 'g'), ''),
             nullif(btrim(r ->> 'role'), ''), nullif(lower(btrim(r ->> 'email')), ''), nullif(r ->> 'phone', ''),
             coalesce((r ->> 'is_primary')::boolean, false)
      from jsonb_array_elements(p -> 'representatives') r;
    end if;
    if p_id is null and jsonb_typeof(p -> 'shareholders') = 'array' then
      insert into public.company_shareholders (client_id, name, document_number, qualification, share_percentage)
      select v_id, btrim(s ->> 'name'), nullif(regexp_replace(coalesce(s ->> 'document', ''), '\D', '', 'g'), ''),
             nullif(btrim(s ->> 'qualification'), ''), nullif(s ->> 'share_percentage', '')::numeric
      from jsonb_array_elements(p -> 'shareholders') s;
    end if;
  end if;

  -- Contatos principais: e-mail, telefone, telefone secundário (PHONE não
  -- principal), site. Valor vazio/null apaga; ausente não mexe.
  if v_contact is not null and jsonb_typeof(v_contact) = 'object' then
    for v_key, v_type, v_has in
      select k, t, primario from (values ('email', 'EMAIL', true), ('phone', 'PHONE', true),
                                         ('secondary_phone', 'PHONE', false), ('website', 'WEBSITE', true)) x(k, t, primario)
    loop
      continue when not (v_contact ? v_key);
      v_value := nullif(btrim(coalesce(v_contact ->> v_key, '')), '');
      if v_type = 'EMAIL' then v_value := lower(v_value); end if;
      if v_type = 'PHONE' then v_value := nullif(regexp_replace(coalesce(v_value, ''), '\D', '', 'g'), ''); end if;
      if v_value is null then
        delete from public.client_contacts cc where cc.client_id = v_id and cc.type = v_type and cc.is_primary = v_has;
      elsif exists (select 1 from public.client_contacts cc where cc.client_id = v_id and cc.type = v_type and cc.is_primary = v_has) then
        update public.client_contacts cc set value = v_value
        where cc.client_id = v_id and cc.type = v_type and cc.is_primary = v_has and cc.value is distinct from v_value;
      else
        insert into public.client_contacts (client_id, type, value, is_primary) values (v_id, v_type, v_value, v_has);
      end if;
    end loop;
  end if;

  -- Endereço principal. null = apaga; objeto = grava (upsert).
  if p ? 'address' then
    if v_address is null or jsonb_typeof(v_address) <> 'object' then
      delete from public.client_addresses a where a.client_id = v_id and a.is_primary;
    else
      if not exists (select 1 from public.client_addresses a where a.client_id = v_id and a.is_primary) then
        insert into public.client_addresses (client_id, is_primary) values (v_id, true);
      end if;
      update public.client_addresses a set
        postal_code  = nullif(regexp_replace(coalesce(v_address ->> 'postal_code', ''), '\D', '', 'g'), ''),
        street       = nullif(btrim(coalesce(v_address ->> 'street', '')), ''),
        number       = nullif(btrim(coalesce(v_address ->> 'number', '')), ''),
        complement   = nullif(btrim(coalesce(v_address ->> 'complement', '')), ''),
        neighborhood = nullif(btrim(coalesce(v_address ->> 'neighborhood', '')), ''),
        city         = nullif(btrim(coalesce(v_address ->> 'city', '')), ''),
        state        = nullif(upper(btrim(coalesce(v_address ->> 'state', ''))), '')::public.uf_code,
        country      = coalesce(nullif(upper(btrim(coalesce(v_address ->> 'country', ''))), ''), 'BR')
      where a.client_id = v_id and a.is_primary;
    end if;
  end if;

  -- Dados internos (observações, resumo jurídico).
  if v_internal and (p ? 'notes' or p ? 'legal_summary') then
    insert into public.client_internal_details (client_id) values (v_id) on conflict (client_id) do nothing;
    update public.client_internal_details d set
      notes         = case when p ? 'notes' then nullif(btrim(p ->> 'notes'), '') else d.notes end,
      legal_summary = case when p ? 'legal_summary' then nullif(btrim(p ->> 'legal_summary'), '') else d.legal_summary end
    where d.client_id = v_id;
  end if;

  return v_id;
end
$$;

-- Inativar / reativar (interno). Motivo e nota ficam nos dados internos.
create or replace function private.set_client_status(p_id uuid, p_status text, p_reason text default null, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_internal_user() then
    raise exception 'Somente a equipe interna inativa ou reativa clientes' using errcode = '42501';
  end if;
  if p_status not in ('ACTIVE', 'INACTIVE') then
    raise exception 'Status de cliente inválido' using errcode = '22023';
  end if;
  update public.clients c set status = p_status where c.id = p_id and c.deleted_at is null;
  if not found then
    raise exception 'Cliente não encontrado' using errcode = '42501';
  end if;
  insert into public.client_internal_details (client_id) values (p_id) on conflict (client_id) do nothing;
  update public.client_internal_details d set
    inactivation_reason = case when p_status = 'INACTIVE' then p_reason end,
    inactivation_note   = case when p_status = 'INACTIVE' then nullif(btrim(coalesce(p_note, '')), '') end,
    inactivated_at      = case when p_status = 'INACTIVE' then now() end,
    inactivated_by      = case when p_status = 'INACTIVE' then auth.uid() end
  where d.client_id = p_id;
end
$$;

create or replace function public.save_client(p_id uuid, p jsonb)
returns uuid language sql security invoker set search_path = ''
as $$ select private.save_client(p_id, p) $$;

create or replace function public.set_client_status(p_id uuid, p_status text, p_reason text default null, p_note text default null)
returns void language sql security invoker set search_path = ''
as $$ select private.set_client_status(p_id, p_status, p_reason, p_note) $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'private.save_client(uuid, jsonb)', 'public.save_client(uuid, jsonb)',
    'private.set_client_status(uuid, text, text, text)', 'public.set_client_status(uuid, text, text, text)']
  loop
    execute format('revoke all on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end
$$;
