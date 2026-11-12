-- 053 · Ponte: o cadastro completo do cliente e quem assina.
--
-- Os agentes do DG Brasil passaram a ser clones próprios da esteira bancária
-- (docs/agentes/clonagem). Eles trabalham em
-- G:\Meu Drive\DG BRASIL\CLIENTE BANCÁRIO\<NOME DO CLIENTE> e leem dois
-- arquivos que o conector grava ali:
--
--   DADOS DO CADASTRO.txt     o cadastro do cliente (agora com CPF, documento de
--                             identidade, nacionalidade, telefone e endereço);
--   DADOS DO ESCRITORIO.txt   quem assina (escritório, advogado, OAB, endereço).
--
-- Esta migration só AMPLIA o que executor_bridge_data devolve. Nada muda para o
-- conector antigo: os campos novos são opcionais. Continua valendo: só o
-- cliente DO TRABALHO RESERVADO, e o acesso ao dado pessoal fica registrado.
--
-- Quem assina: o escritório de origem do cliente, se ele tiver advogado
-- responsável no cadastro; senão, o escritório proprietário.

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
                   order by a.is_primary desc, (a.type = 'RESIDENTIAL') desc, a.created_at limit 1)),
    'pasta_drive', (select jsonb_build_object('id', l.external_folder_id, 'nome', l.folder_name_snapshot)
                    from public.external_folder_links l
                    where l.client_id = c.id and l.provider = 'GOOGLE_DRIVE' and l.unlinked_at is null
                    limit 1)
  ) into v_org, v_out
  from public.clients c
  left join public.individual_client_details i on i.client_id = c.id
  left join public.company_client_details co on co.client_id = c.id
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

comment on function private.executor_bridge_data(text, uuid, text) is
  'Ponte (docs/ponte.md, docs/agentes/clonagem): cadastro do cliente do trabalho reservado, a pasta do Drive ligada a ele e quem assina. Nunca de outro cliente.';

revoke all on function private.executor_bridge_data(text, uuid, text) from public, anon, authenticated, service_role;
grant execute on function private.executor_bridge_data(text, uuid, text) to dg_worker;
