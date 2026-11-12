-- 055 · Cadastro do cliente: forma de pagamento do contrato de honorários.
--
-- O agente do kit do cliente (Lucas) gera o contrato de honorários, e a
-- cláusula do custo operacional inicial muda conforme a forma de pagamento que
-- o cliente escolheu. Esse dado não existia no cadastro: vinha escrito no
-- pedido ou completado à mão no DADOS DO CADASTRO.txt.
--
--   1. client_internal_details.contract_payment_method: a escolha do cliente.
--      Fica nos dados INTERNOS (é o que o escritório combinou com o cliente):
--      parceiro nunca lê nem grava. Opcional: nulo = ainda não combinado.
--      Os VALORES em reais não ficam aqui: são da configuração do escritório.
--   2. save_client (045) grava o campo, com as mesmas regras de PATCH dos
--      outros (chave ausente não mexe; vazio ou null apaga).
--   3. executor_bridge_data (053) devolve cliente.forma_de_pagamento com o
--      código que o gerador do contrato entende
--      (agentes/scripts/gerar_contrato_honorarios.py):
--
--        PIX_UPFRONT          a_vista             à vista no Pix
--        BOLETO_INSTALLMENTS  5x_boleto           parcelado no boleto
--        CARD_INSTALLMENTS    5x_cartao           parcelado no cartão
--        END_OF_CASE          final_do_processo   ao final da ação
--
--      A isenção do BPC/LOAS (bpc_loas) não é escolha do cadastro: o agente
--      deduz pela espécie do benefício.
--
-- 001–054 não são alteradas.

-- ═════════════════════════════ 1. a coluna ════════════════════════════════

alter table public.client_internal_details
  add column contract_payment_method text
    constraint client_internal_details_contract_payment_method_check
    check (contract_payment_method in ('PIX_UPFRONT', 'BOLETO_INSTALLMENTS', 'CARD_INSTALLMENTS', 'END_OF_CASE'));

comment on column public.client_internal_details.contract_payment_method is
  'Forma de pagamento do custo operacional inicial do contrato de honorários, escolhida pelo cliente. Nulo = ainda não combinado. Os valores ficam na configuração do escritório.';

-- ═════════════════════════════ 2. gravação do cliente ═════════════════════

-- Gravação do cliente (045) com a forma de pagamento do contrato nos dados
-- internos. Nada mais muda.
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

  -- Dados internos (observações, resumo jurídico, forma de pagamento do contrato).
  if v_internal and (p ?| array['notes', 'legal_summary', 'contract_payment_method']) then
    insert into public.client_internal_details (client_id) values (v_id) on conflict (client_id) do nothing;
    update public.client_internal_details d set
      notes                   = case when p ? 'notes' then nullif(btrim(p ->> 'notes'), '') else d.notes end,
      legal_summary           = case when p ? 'legal_summary' then nullif(btrim(p ->> 'legal_summary'), '') else d.legal_summary end,
      contract_payment_method = case when p ? 'contract_payment_method' then nullif(p ->> 'contract_payment_method', '') else d.contract_payment_method end
    where d.client_id = v_id;
  end if;

  return v_id;
end
$$;

-- ═════════════════════════════ 3. dados da ponte ══════════════════════════

-- Dados da ponte (053) com cliente.forma_de_pagamento. Nada mais muda.
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
  v_org    uuid;
  v_office jsonb;
begin
  select * into v_scope from private.worker_scope(p_agent_run_id, v_by);
  if v_scope.client_id is null then
    return jsonb_build_object('cliente', null, 'pasta_drive', null, 'escritorio', null);
  end if;

  select c.origin_organization_id,
    jsonb_build_object(
    'cliente', jsonb_build_object(
      'id', c.id,
      'tipo', c.kind,
      'nome', coalesce(i.full_name, co.legal_name),
      'cpf', case when c.cpf is not null
                  then regexp_replace(c.cpf::text, '^(\d{3})(\d{3})(\d{3})(\d{2})$', '\1.\2.\3-\4') end,
      'rg', case when i.identity_document_number is not null
                 then concat_ws(' ',
                        case i.identity_document_type when 'RG' then 'RG' when 'CNH' then 'CNH'
                             when 'PASSPORT' then 'Passaporte' when 'RNM' then 'RNM' else 'Documento' end,
                        i.identity_document_number,
                        nullif(concat_ws('/', i.identity_document_issuer, i.identity_document_state::text), '')) end,
      'nacionalidade', i.nationality,
      'profissao', i.profession,
      'estado_civil', case i.marital_status
                        when 'SINGLE' then 'solteiro(a)' when 'MARRIED' then 'casado(a)'
                        when 'DIVORCED' then 'divorciado(a)' when 'WIDOWED' then 'viúvo(a)'
                        when 'SEPARATED' then 'separado(a)' end,
      'email', (select ct.value from public.client_contacts ct
                where ct.client_id = c.id and ct.type = 'EMAIL'
                order by ct.is_primary desc, ct.created_at limit 1),
      'telefone', (select ct.value from public.client_contacts ct
                   where ct.client_id = c.id and ct.type in ('PHONE', 'WHATSAPP')
                   order by ct.is_primary desc, (ct.type = 'PHONE') desc, ct.created_at limit 1),
      'endereco', (select nullif(concat_ws(', ',
                            nullif(btrim(a.street), ''), nullif(btrim(a.number), ''), nullif(btrim(a.complement), ''),
                            nullif(btrim(a.neighborhood), ''),
                            nullif(concat_ws('/', nullif(btrim(a.city), ''), a.state::text), ''),
                            case when a.postal_code is not null
                                 then 'CEP ' || regexp_replace(a.postal_code, '^(\d{5})(\d{3})$', '\1-\2') end), '')
                   from public.client_addresses a
                   where a.client_id = c.id
                   order by a.is_primary desc, (a.type = 'RESIDENTIAL') desc, a.created_at limit 1),
      'forma_de_pagamento', case ci.contract_payment_method
                              when 'PIX_UPFRONT' then 'a_vista' when 'BOLETO_INSTALLMENTS' then '5x_boleto'
                              when 'CARD_INSTALLMENTS' then '5x_cartao' when 'END_OF_CASE' then 'final_do_processo' end),
    'pasta_drive', (select jsonb_build_object('id', l.external_folder_id, 'nome', l.folder_name_snapshot)
                    from public.external_folder_links l
                    where l.client_id = c.id and l.provider = 'GOOGLE_DRIVE' and l.unlinked_at is null
                    limit 1)
  ) into v_org, v_out
  from public.clients c
  left join public.individual_client_details i on i.client_id = c.id
  left join public.company_client_details co on co.client_id = c.id
  left join public.client_internal_details ci on ci.client_id = c.id
  where c.id = v_scope.client_id and c.deleted_at is null;

  if v_out is null then
    return jsonb_build_object('cliente', null, 'pasta_drive', null, 'escritorio', null);
  end if;

  -- Quem assina: o escritório de origem com advogado no cadastro; senão, o proprietário.
  select jsonb_build_object(
           'nome', coalesce(nullif(btrim(o.trade_name), ''), o.name),
           'advogado', x.advogado,
           'oab', case when x.oab_numero is not null then 'OAB/' || x.oab_uf || ' ' || x.oab_numero end,
           'endereco', nullif(concat_ws(', ',
                         nullif(btrim(o.address_street), ''), nullif(btrim(o.address_number), ''),
                         nullif(btrim(o.address_complement), ''), nullif(btrim(o.address_neighborhood), ''),
                         nullif(concat_ws('/', nullif(btrim(o.address_city), ''), o.address_state::text), ''),
                         case when o.address_postal_code is not null
                              then 'CEP ' || regexp_replace(o.address_postal_code, '^(\d{5})(\d{3})$', '\1-\2') end), ''),
           'cidade', nullif(btrim(o.address_city), ''),
           'email', o.email,
           'telefone', o.phone)
    into v_office
  from public.organizations o
  join lateral (
    select coalesce(nullif(btrim(ow.principal_lawyer_name), ''), nullif(btrim(pa.responsible_name), '')) as advogado,
           coalesce(ow.principal_oab_number, pa.responsible_oab_number) as oab_numero,
           coalesce(ow.principal_oab_state, pa.responsible_oab_state)::text as oab_uf
    from (select 1) u
    left join public.owner_office_settings ow on ow.organization_id = o.id
    left join public.partner_office_settings pa on pa.organization_id = o.id
  ) x on true
  where o.deleted_at is null and (o.id = v_org or o.type = 'OWNER')
  order by (o.id = v_org and x.advogado is not null) desc, (o.type = 'OWNER') desc
  limit 1;

  perform private.record_personal_data_access(v_scope.client_id,
    case when v_scope.legal_case_id is not null then 'LEGAL_CASE' else 'CLIENT' end,
    coalesce(v_scope.legal_case_id, v_scope.client_id),
    'VIEW_DETAIL', 'Ponte com os agentes do computador do escritório');
  return v_out || jsonb_build_object('escritorio', v_office);
end
$$;

revoke all on function private.executor_bridge_data(text, uuid, text) from public, anon, authenticated, service_role;
grant execute on function private.executor_bridge_data(text, uuid, text) to dg_worker;
