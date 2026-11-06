-- DG Brasil — 045: Roadmap 2.0, bloco 2 — cadastros
--
-- Pedido da Barbara em 2026-11-06 (docs/roadmap-2.0.md):
--   1. Cliente e caso: CANAL de aquisição (como o cliente chegou: indicação,
--      Google Ads, ...), separado do escritório de origem que já existe
--      (origin_organization_id: escritório principal ou parceiro).
--   2. Cliente: sai o "responsável" (advogado não é responsável por cliente,
--      só por caso/processo) e sai a "união estável" (redundante).
--   3. Processo: status de condução e fases novos; honorários do processo nos
--      dados INTERNOS (parceiro nunca lê).
--   4. Análise: caixa de informações adicionais para os agentes, guardada na
--      análise e entregue ao agente junto com o pedido.
--   5. Contagem de processos por status numa consulta só (Início e menu).
--
-- 001–044 não são alteradas.

-- ───────────────────────────── 1. canal de aquisição ─────────────────────

-- A mesma lista está nos CHECKs (por extenso, sem depender de função) e no
-- servidor (lib/constants/legal.ts → ACQUISITION_CHANNELS).
create or replace function private.is_acquisition_channel(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p in ('REFERRAL', 'GOOGLE_ADS', 'META_ADS', 'OTHER_PAID_TRAFFIC', 'SOCIAL_MEDIA',
               'WEBSITE_SEARCH', 'WHATSAPP', 'RETURNING_CLIENT', 'EVENT', 'OTHER')
$$;

alter table public.clients
  add column acquisition_channel text
    constraint clients_acquisition_channel_check check (acquisition_channel in ('REFERRAL', 'GOOGLE_ADS', 'META_ADS', 'OTHER_PAID_TRAFFIC', 'SOCIAL_MEDIA', 'WEBSITE_SEARCH', 'WHATSAPP', 'RETURNING_CLIENT', 'EVENT', 'OTHER')),
  add column acquisition_detail text
    constraint clients_acquisition_detail_check check (acquisition_detail is null or length(acquisition_detail) <= 300);

comment on column public.clients.acquisition_channel is
  'Como o cliente chegou (marketing): indicação, Google Ads, Meta Ads, ... Não confundir com origin_organization_id (escritório de origem).';
comment on column public.clients.acquisition_detail is
  'Detalhe livre do canal: quem indicou, nome da campanha, evento.';

alter table public.legal_cases
  add column acquisition_channel text
    constraint legal_cases_acquisition_channel_check check (acquisition_channel in ('REFERRAL', 'GOOGLE_ADS', 'META_ADS', 'OTHER_PAID_TRAFFIC', 'SOCIAL_MEDIA', 'WEBSITE_SEARCH', 'WHATSAPP', 'RETURNING_CLIENT', 'EVENT', 'OTHER')),
  add column acquisition_detail text
    constraint legal_cases_acquisition_detail_check check (acquisition_detail is null or length(acquisition_detail) <= 300);

comment on column public.legal_cases.acquisition_channel is
  'Canal de aquisição do caso. Na criação, sem valor explícito, herda o do cliente.';

create index clients_acquisition_channel_idx on public.clients (acquisition_channel) where deleted_at is null;
create index legal_cases_acquisition_channel_idx on public.legal_cases (acquisition_channel) where deleted_at is null;

-- O caso herda o canal do cliente quando ninguém informou outro.
create or replace function private.legal_cases_default_channel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.acquisition_channel is null then
    select c.acquisition_channel, coalesce(new.acquisition_detail, c.acquisition_detail)
      into new.acquisition_channel, new.acquisition_detail
    from public.clients c where c.id = new.client_id;
  end if;
  return new;
end
$$;

create trigger legal_cases_default_channel
  before insert on public.legal_cases
  for each row execute function private.legal_cases_default_channel();

-- ───────────────────────────── 2. cliente sem responsável ────────────────

drop view public.client_directory;

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
       c.acquisition_channel,
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

-- Mesmo guarda da 004, sem a regra do responsável (a coluna sai).
create or replace function private.clients_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origin record;
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
  else
    if new.kind is distinct from old.kind then
      raise exception 'O tipo do cliente (PF/PJ) não pode ser alterado' using errcode = '23514';
    end if;
    if (new.cpf is distinct from old.cpf or new.cnpj is distinct from old.cnpj)
       and auth.uid() is not null and not private.is_admin() then
      raise exception 'Somente ADMIN interno pode corrigir CPF/CNPJ' using errcode = '42501';
    end if;
  end if;

  -- Excluir (soft delete) ou restaurar cliente é decisão de ADMIN.
  if tg_op = 'UPDATE' and new.deleted_at is distinct from old.deleted_at
     and auth.uid() is not null and not private.is_admin() then
    raise exception 'Somente ADMIN interno exclui ou restaura cliente' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' or new.origin_organization_id is distinct from old.origin_organization_id then
    select o.type, o.status, o.deleted_at into v_origin
    from public.organizations o where o.id = new.origin_organization_id;

    if v_origin.deleted_at is not null then
      raise exception 'Organização de origem excluída' using errcode = '23514';
    end if;
    if v_origin.type = 'PARTNER' and v_origin.status <> 'ACTIVE' then
      raise exception 'Origem só pode ser parceiro ATIVO' using errcode = '23514';
    end if;
    -- Parceiro só atribui a origem a si mesmo ou ao escritório proprietário.
    if private.is_partner_user()
       and new.origin_organization_id is distinct from private.current_partner_organization_id()
       and v_origin.type <> 'OWNER' then
      raise exception 'Parceiro só pode atribuir origem ao próprio escritório ou ao escritório proprietário'
        using errcode = '42501';
    end if;
  end if;

  return new;
end
$$;

-- Gravação do cliente (025) sem responsável e sem união estável, com o canal.
-- Chaves desconhecidas (ex.: "responsible_user_id" de uma importação antiga)
-- são ignoradas, como antes.
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

  if p ? 'acquisition_channel' and nullif(p ->> 'acquisition_channel', '') is not null
     and not private.is_acquisition_channel(p ->> 'acquisition_channel') then
    raise exception 'Canal de aquisição inválido' using errcode = '22023';
  end if;

  if v_id is null then
    v_kind := (p ->> 'kind')::public.client_kind;
    insert into public.clients (kind, cpf, cnpj, origin_organization_id, acquisition_channel, acquisition_detail)
    values (v_kind,
            case when v_kind = 'INDIVIDUAL' then regexp_replace(p ->> 'document', '\D', '', 'g') end,
            case when v_kind = 'COMPANY' then regexp_replace(p ->> 'document', '\D', '', 'g') end,
            (p ->> 'origin_organization_id')::uuid,
            nullif(p ->> 'acquisition_channel', ''),
            nullif(btrim(coalesce(p ->> 'acquisition_detail', '')), ''))
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
      acquisition_channel    = case when p ? 'acquisition_channel' then nullif(p ->> 'acquisition_channel', '') else c.acquisition_channel end,
      acquisition_detail     = case when p ? 'acquisition_detail' then nullif(btrim(coalesce(p ->> 'acquisition_detail', '')), '') else c.acquisition_detail end,
      cpf  = case when v_kind = 'INDIVIDUAL' and p ? 'document' then regexp_replace(p ->> 'document', '\D', '', 'g') else c.cpf end,
      cnpj = case when v_kind = 'COMPANY' and p ? 'document' then regexp_replace(p ->> 'document', '\D', '', 'g') else c.cnpj end
    where c.id = v_id
      and (p ?| array['origin_organization_id', 'acquisition_channel', 'acquisition_detail', 'document']);
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
      profession     = case when p ? 'profession' then nullif(btrim(p ->> 'profession'), '') else d.profession end,
      identity_document_type   = case when p ? 'identity_document' then nullif(p -> 'identity_document' ->> 'type', '') else d.identity_document_type end,
      identity_document_number = case when p ? 'identity_document' then nullif(btrim(p -> 'identity_document' ->> 'number'), '') else d.identity_document_number end,
      identity_document_issuer = case when p ? 'identity_document' then nullif(btrim(p -> 'identity_document' ->> 'issuer'), '') else d.identity_document_issuer end,
      identity_document_state  = case when p ? 'identity_document' then nullif(upper(p -> 'identity_document' ->> 'state'), '')::public.uf_code else d.identity_document_state end
    where d.client_id = v_id
      and (p ?| array['full_name', 'social_name', 'birth_date', 'gender', 'nationality', 'birthplace',
                      'marital_status', 'profession', 'identity_document']);
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

alter table public.clients drop column responsible_user_id;
alter table public.individual_client_details drop column stable_union;

-- Envio de caso pelo portal (025) com os dados de qualificação que agora são
-- obrigatórios no cadastro (nacionalidade, estado civil, profissão) e o canal.
-- Cliente que já existe continua sem ser sobrescrito.
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
  v_channel  text := nullif(coalesce(p_case ->> 'acquisition_channel', p_client ->> 'acquisition_channel'), '');
begin
  if auth.uid() is null or not private.is_partner_user() or v_partner is null then
    raise exception 'Operação exclusiva do Portal do Parceiro' using errcode = '42501';
  end if;
  if length(v_digits) not in (11, 14) then
    raise exception 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos)' using errcode = '22023';
  end if;
  if v_channel is not null and not private.is_acquisition_channel(v_channel) then
    raise exception 'Canal de aquisição inválido' using errcode = '22023';
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
    insert into public.clients (kind, cpf, cnpj, origin_organization_id, acquisition_channel, acquisition_detail)
    values (v_kind,
            case when v_kind = 'INDIVIDUAL' then v_digits end,
            case when v_kind = 'COMPANY' then v_digits end,
            (p_client ->> 'origin_organization_id')::uuid,
            nullif(p_client ->> 'acquisition_channel', ''),
            nullif(btrim(coalesce(p_client ->> 'acquisition_detail', '')), ''))
    returning id into v_client;

    if v_kind = 'INDIVIDUAL' then
      insert into public.individual_client_details (client_id, full_name, birth_date, nationality, marital_status, profession)
      values (v_client, btrim(p_client ->> 'full_name'), nullif(p_client ->> 'birth_date', '')::date,
              nullif(btrim(coalesce(p_client ->> 'nationality', '')), ''),
              nullif(p_client ->> 'marital_status', ''),
              nullif(btrim(coalesce(p_client ->> 'profession', '')), ''));
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
  -- inicial e relacionamento são garantidos pelos triggers da 006. O canal
  -- vazio herda o do cliente (trigger desta migration).
  insert into public.legal_cases
    (id, client_id, legal_area_id, case_type_id, title, summary, opposing_party, status,
     partner_organization_id, origin_organization_id, partner_notes, acquisition_channel, acquisition_detail)
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
     nullif(btrim(coalesce(p_case ->> 'partner_notes', '')), ''),
     v_channel,
     nullif(btrim(coalesce(p_case ->> 'acquisition_detail', p_client ->> 'acquisition_detail', '')), ''));

  return jsonb_build_object('client_id', v_client, 'legal_case_id', v_case, 'client_existed', v_existed);
end
$$;

-- Caso interno (027) aceitando o canal.
create or replace function public.create_legal_case_once(p_key uuid, p_case jsonb, p_internal jsonb default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prev jsonb;
  v_id   uuid := gen_random_uuid();
  v_c    public.legal_cases;
begin
  v_prev := private.idempotency_begin('legal_case.create', p_key,
    jsonb_build_object('case', p_case - 'id', 'internal', p_internal));
  if v_prev is not null then
    return jsonb_build_object('legal_case_id', v_prev ->> 'resource_id', 'deduplicated', true);
  end if;

  v_c := jsonb_populate_record(null::public.legal_cases, p_case - 'id');
  insert into public.legal_cases
    (id, client_id, legal_area_id, case_type_id, title, summary, opposing_party, status,
     origin_organization_id, partner_organization_id, assigned_lawyer_id, partner_notes,
     acquisition_channel, acquisition_detail)
  values
    (v_id, v_c.client_id, v_c.legal_area_id, v_c.case_type_id, v_c.title, v_c.summary, v_c.opposing_party,
     coalesce(v_c.status, 'DRAFT'), v_c.origin_organization_id, v_c.partner_organization_id,
     v_c.assigned_lawyer_id, v_c.partner_notes, v_c.acquisition_channel, v_c.acquisition_detail);

  if nullif(btrim(coalesce(p_internal ->> 'internal_notes', '')), '') is not null then
    insert into public.legal_case_internal_details (legal_case_id, internal_notes)
    values (v_id, btrim(p_internal ->> 'internal_notes'))
    on conflict (legal_case_id) do update set internal_notes = excluded.internal_notes;
  end if;

  perform private.idempotency_complete('legal_case.create', p_key, 'legal_cases', v_id, null);
  return jsonb_build_object('legal_case_id', v_id, 'deduplicated', false);
end
$$;

-- ───────────────────────────── 3. processo: status, fases, honorários ────
--
-- Condução (status), na ordem da tela: Pré-ajuizamento, Em preparação,
-- Distribuído, Em andamento, Com sentença, Recurso, Trânsito em julgado,
-- Execução, Recebido, Arquivado e, à parte, Suspenso.
-- Fase: Pré-processual, Processual, Recursal, Trânsito em julgado,
-- Cumprimento de sentença, Arquivado.
--
-- Valores antigos que ainda chegarem (importação simulada antes desta
-- migration, código antigo) são traduzidos pelo trigger, nunca recusados:
--   WAITING_CLIENT / WAITING_DEADLINE → ACTIVE;  CLOSED → ARCHIVED;
--   PLEADINGS / EVIDENCE / JUDGMENT → PROCEEDINGS.

create or replace function private.legal_processes_normalize_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.status := case new.status
    when 'WAITING_CLIENT' then 'ACTIVE'
    when 'WAITING_DEADLINE' then 'ACTIVE'
    when 'CLOSED' then 'ARCHIVED'
    else new.status end;
  new.phase := case new.phase
    when 'PLEADINGS' then 'PROCEEDINGS'
    when 'EVIDENCE' then 'PROCEEDINGS'
    when 'JUDGMENT' then 'PROCEEDINGS'
    else new.phase end;
  return new;
end
$$;

alter table public.legal_processes drop constraint legal_processes_status_check;
alter table public.legal_processes drop constraint legal_processes_phase_check;

update public.legal_processes set status = 'ACTIVE' where status in ('WAITING_CLIENT', 'WAITING_DEADLINE');
update public.legal_processes set status = 'ARCHIVED' where status = 'CLOSED';
update public.legal_processes set phase = 'PROCEEDINGS' where phase in ('PLEADINGS', 'EVIDENCE', 'JUDGMENT');

alter table public.legal_processes
  add constraint legal_processes_status_check check (status in (
    'PRE_FILING', 'PREPARING', 'FILED', 'ACTIVE', 'SENTENCED', 'APPEAL', 'FINAL_JUDGMENT',
    'ENFORCEMENT', 'RECEIVED', 'ARCHIVED', 'SUSPENDED')),
  add constraint legal_processes_phase_check check (phase in (
    'PRELIMINARY', 'PROCEEDINGS', 'APPEAL', 'FINAL_JUDGMENT', 'ENFORCEMENT', 'ARCHIVED'));

-- Roda antes dos outros triggers BEFORE (ordem alfabética: "legal_processes_a…").
create trigger legal_processes_a_normalize_status
  before insert or update of status, phase on public.legal_processes
  for each row execute function private.legal_processes_normalize_status();

-- Honorários do processo: dado INTERNO (a tabela nunca é lida por parceiro).
alter table public.legal_process_internal_details
  add column fee_amount public.money_amount,
  add column fee_percentage public.percentage;

comment on column public.legal_process_internal_details.fee_amount is
  'Honorários do processo em reais (valor contratado/esperado). Interno: parceiro nunca lê.';
comment on column public.legal_process_internal_details.fee_percentage is
  'Honorários de êxito do processo, em % do proveito. Interno.';

-- Criação do processo (027) com os honorários nos dados internos. O prazo
-- inicial (p_deadline) continua aceito, mas a tela não pede mais.
create or replace function public.create_legal_process_once(
  p_key uuid, p_process jsonb, p_internal jsonb default null, p_deadline jsonb default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prev jsonb;
  v_id   uuid := gen_random_uuid();
  v_p    public.legal_processes;
  v_d    public.deadlines;
  v_deadline uuid;
  v_summary text := nullif(btrim(coalesce(p_internal ->> 'summary', '')), '');
  v_notes   text := nullif(btrim(coalesce(p_internal ->> 'notes', '')), '');
  v_fee     numeric := nullif(p_internal ->> 'fee_amount', '')::numeric;
  v_fee_pct numeric := nullif(p_internal ->> 'fee_percentage', '')::numeric;
begin
  v_prev := private.idempotency_begin('legal_process.create', p_key,
    jsonb_build_object('process', p_process - 'id', 'internal', p_internal, 'deadline', p_deadline));
  if v_prev is not null then
    return (case when jsonb_typeof(v_prev -> 'response') = 'object' then v_prev -> 'response' else '{}'::jsonb end)
           || jsonb_build_object('legal_process_id', v_prev ->> 'resource_id', 'deduplicated', true);
  end if;

  v_p := jsonb_populate_record(null::public.legal_processes, p_process - 'id');
  -- Parceiro não define campo interno, nem chamando direto (o banco aplica os defaults).
  if private.is_partner_user() then
    v_p.status := null; v_p.phase := null; v_p.responsible_user_id := null; v_p.operational_due_at := null;
    v_fee := null; v_fee_pct := null;
  end if;
  insert into public.legal_processes
    (id, legal_case_id, technical_origin, title, cnj_number, court, court_unit, district, state,
     legal_class, subject, client_side, adverse_party_summary, distribution_date, case_value,
     status, phase, responsible_user_id, operational_due_at)
  values
    (v_id, v_p.legal_case_id, 'MANUAL', nullif(btrim(coalesce(v_p.title, '')), ''), v_p.cnj_number, v_p.court, v_p.court_unit, v_p.district, v_p.state,
     v_p.legal_class, v_p.subject, v_p.client_side, v_p.adverse_party_summary, v_p.distribution_date, v_p.case_value,
     coalesce(v_p.status, 'PREPARING'), v_p.phase, v_p.responsible_user_id, v_p.operational_due_at);

  if v_summary is not null or v_notes is not null or v_fee is not null or v_fee_pct is not null then
    insert into public.legal_process_internal_details (legal_process_id, summary, notes, fee_amount, fee_percentage)
    values (v_id, v_summary, v_notes, v_fee, v_fee_pct);
  end if;

  if p_deadline is not null and jsonb_typeof(p_deadline) = 'object' then
    v_d := jsonb_populate_record(null::public.deadlines, p_deadline - 'id' - 'legal_case_id' - 'legal_process_id');
    v_deadline := gen_random_uuid();
    insert into public.deadlines
      (id, legal_case_id, legal_process_id, title, deadline_type, description, due_at, priority, responsible_user_id, source)
    values
      (v_deadline, v_p.legal_case_id, v_id, v_d.title, coalesce(v_d.deadline_type, 'INTERNAL'), v_d.description,
       v_d.due_at, coalesce(v_d.priority, 'NORMAL'), v_d.responsible_user_id, 'MANUAL');
  end if;

  perform private.idempotency_complete('legal_process.create', p_key, 'legal_processes', v_id,
    case when v_deadline is not null then jsonb_build_object('deadline_id', v_deadline) end);
  return jsonb_build_object('legal_process_id', v_id, 'deadline_id', v_deadline, 'deduplicated', false);
end
$$;

-- ───────────────────────────── 4. análise: informações adicionais ────────

alter table public.legal_analyses
  add column additional_info text
    constraint legal_analyses_additional_info_check check (additional_info is null or length(additional_info) <= 10000);

comment on column public.legal_analyses.additional_info is
  'Informações livres da equipe para os agentes (contexto, o que observar). Vai junto com o pedido a cada envio.';

-- Texto que o agente recebe como "pedido": as informações adicionais da
-- análise e o pedido do envio, cada um com o seu título.
create or replace function private.compose_agent_request(p_info text, p_request text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(nullif(concat_ws(E'\n\n',
    case when nullif(btrim(coalesce(p_info, '')), '') is not null
         then 'Informações adicionais da equipe:' || E'\n' || btrim(p_info) end,
    case when nullif(btrim(coalesce(p_request, '')), '') is not null
         then case when nullif(btrim(coalesce(p_info, '')), '') is not null then 'Pedido:' || E'\n' else '' end || btrim(p_request) end
  ), ''), 20000)
$$;

drop function public.start_legal_analysis_once(uuid, uuid, uuid, jsonb, boolean, text, jsonb);

create function public.start_legal_analysis_once(
  p_key             uuid,
  p_legal_case_id   uuid,
  p_template_id     uuid,
  p_field_values    jsonb default '{}',
  p_send            boolean default false,
  p_request_text    text default null,
  -- Só correlação técnica (ex.: {"request_id": uuid}); fora do hash da chave.
  p_parameters      jsonb default '{}',
  p_additional_info text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prev     jsonb;
  v_id       uuid := gen_random_uuid();
  v_area     uuid;
  v_template record;
  v_run      uuid;
  v_send     boolean := coalesce(p_send, false);
  v_info     text := nullif(btrim(coalesce(p_additional_info, '')), '');
begin
  if not (select private.has_internal_role('ADMIN', 'LAWYER')) then
    raise exception 'Somente ADMIN ou advogado inicia análise jurídica' using errcode = '42501';
  end if;
  if p_field_values is null or jsonb_typeof(p_field_values) <> 'object' then
    raise exception 'Campos da análise inválidos' using errcode = '22023';
  end if;

  v_prev := private.idempotency_begin('legal_analysis.start', p_key, jsonb_build_object(
    'legal_case_id', p_legal_case_id, 'template_id', p_template_id, 'fields', p_field_values,
    'send', v_send, 'request_text', p_request_text, 'additional_info', v_info));
  if v_prev is not null then
    return jsonb_build_object(
      'analysis_id', v_prev ->> 'resource_id',
      'agent_run_id', v_prev -> 'response' ->> 'agent_run_id',
      'deduplicated', true);
  end if;

  select c.legal_area_id into v_area
  from public.legal_cases c
  where c.id = p_legal_case_id and c.deleted_at is null;
  if v_area is null then
    raise exception 'Caso não encontrado' using errcode = '42501';
  end if;

  select t.id, t.legal_area_id, t.active, t.primary_agent_id into v_template
  from public.analysis_templates t
  where t.id = p_template_id;
  if v_template.id is null or not v_template.active then
    raise exception 'Template de análise indisponível' using errcode = '23514';
  end if;
  if v_template.legal_area_id <> v_area then
    raise exception 'O template não é da área jurídica deste caso' using errcode = '23514';
  end if;

  if v_send then
    if v_template.primary_agent_id is null then
      raise exception 'O template desta análise não tem agente configurado' using errcode = '23514';
    end if;
    v_run := private.request_agent_run(v_template.primary_agent_id, p_legal_case_id, null,
      private.compose_agent_request(v_info, p_request_text), coalesce(p_parameters, '{}'), 'EXECUTE', null);
  end if;

  insert into public.legal_analyses
    (id, legal_case_id, analysis_template_id, status, field_values, additional_info, agent_run_id, started_by, started_at)
  values
    (v_id, p_legal_case_id, p_template_id,
     case when v_run is null then 'PENDING' else 'QUEUED' end,
     p_field_values, v_info, v_run, auth.uid(),
     case when v_run is null then null else now() end);

  perform private.idempotency_complete('legal_analysis.start', p_key, 'legal_analyses', v_id,
    jsonb_build_object('agent_run_id', v_run));
  return jsonb_build_object('analysis_id', v_id, 'agent_run_id', v_run, 'deduplicated', false);
end
$$;

comment on function public.start_legal_analysis_once(uuid, uuid, uuid, jsonb, boolean, text, jsonb, text) is
  'Cria a análise (com as informações adicionais para os agentes) e, opcionalmente, pede a execução — numa transação, idempotente.';

revoke all on function public.start_legal_analysis_once(uuid, uuid, uuid, jsonb, boolean, text, jsonb, text) from public, anon, service_role;
grant execute on function public.start_legal_analysis_once(uuid, uuid, uuid, jsonb, boolean, text, jsonb, text) to authenticated;

-- Envio posterior (última versão: 039, que liga a nova execução à anterior):
-- o agente recebe também as informações adicionais.
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

  -- Trava a análise: dois envios simultâneos (chaves diferentes) nunca geram duas execuções.
  select a.id, a.status, a.legal_case_id, a.analysis_template_id, a.agent_run_id, a.additional_info into v_a
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

  v_run := private.request_agent_run(v_agent, v_a.legal_case_id, null,
    private.compose_agent_request(v_a.additional_info, p_request_text), coalesce(p_parameters, '{}'), 'EXECUTE', null);
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

-- ───────────────────────────── 5. contagem por status ────────────────────
-- Antes: 8 consultas (uma por status) a cada abertura da Início. Agora uma,
-- com a RLS de quem pede (parceiro conta só os próprios processos).
create or replace function public.get_process_status_counts()
returns table (status text, total bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.status, count(*)::bigint
  from public.legal_processes p
  where p.deleted_at is null
  group by p.status
$$;

comment on function public.get_process_status_counts() is
  'Processos por status (condução), com a RLS de quem consulta. Início e menu.';

revoke all on function public.get_process_status_counts() from public, anon;
grant execute on function public.get_process_status_counts() to authenticated, service_role;

revoke all on function private.is_acquisition_channel(text) from public, anon;
revoke all on function private.compose_agent_request(text, text) from public, anon;
-- Chamada pelas funções SECURITY INVOKER de análise (rodam como o usuário).
grant execute on function private.compose_agent_request(text, text) to authenticated;
revoke all on function private.legal_cases_default_channel() from public, anon, authenticated;
revoke all on function private.legal_processes_normalize_status() from public, anon, authenticated;
