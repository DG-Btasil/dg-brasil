-- DG Brasil — 028: edição do bloco societário de Cliente PJ (Etapa 4.3, Fase A)
--
-- Até aqui, representantes legais e sócios de uma PJ só eram gravados no
-- cadastro (private.save_client, 025: "edição tem tela própria depois") e não
-- havia política de DELETE nessas tabelas: a edição não tinha caminho seguro.
--
-- Esta migration cria UMA operação transacional para o bloco inteiro:
--
--   public.replace_company_people(p_client_id, p_representatives, p_shareholders)
--
-- Contrato "estado final" (replace-all): o servidor manda as DUAS listas
-- completas como devem ficar. O banco valida tudo e só então aplica, numa só
-- transação (a chamada RPC é uma transação; qualquer erro desfaz tudo — nada
-- é removido nem gravado pela metade).
--
-- Identidade das linhas: um item pode trazer o `id` de uma linha EXISTENTE do
-- mesmo cliente (então é atualizado no lugar, preservando created_at e o
-- histórico natural da linha); item sem `id` é inserido; linha existente que
-- não aparece na lista é removida. `id` desconhecido, de outro cliente ou
-- repetido → erro (nada é aplicado). O navegador não faz CRUD linha a linha:
-- não há política nova de INSERT/UPDATE/DELETE para o cliente da API.
--
-- Autorização (no banco, nunca a partir do input):
--   - auth.uid() + vínculo ativo + aal2 (private.current_membership, 022);
--   - equipe interna (ADMIN/LAWYER/ASSISTANT — a mesma regra de edição de
--     cliente do save_client; a matriz do app dá clients.edit aos três);
--   - parceiro: recusado (bloco societário é cadastro interno do escritório);
--   - cliente existe, não excluído e é PJ.
--
-- Auditoria: os triggers de linha (014) registram as inserções e alterações
-- (CLIENT_UPDATED com tabela, operação e NOMES de campos, sem valores). Como
-- 014 não audita DELETE, a função grava também um evento-resumo
-- COMPANY_PEOPLE_REPLACED com contagens (incluídos/alterados/removidos/total)
-- de cada lista — sem nome, CPF, documento, e-mail ou telefone. Ator, escritório,
-- request_id (x-dg-request-id, 025) e data vêm de private.record_audit_event.
--
-- Histórico: V1 guarda o estado atual + a trilha de auditoria. Sem tabela
-- temporal de quadro societário.

create or replace function private.replace_company_people(
  p_client_id       uuid,
  p_representatives jsonb,
  p_shareholders    jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind        public.client_kind;
  v_ids         uuid[];
  v_unknown     int;
  v_primaries   int;
  r_added   int := 0; r_updated int := 0; r_removed int := 0;
  s_added   int := 0; s_updated int := 0; s_removed int := 0;
  v_n       int;
begin
  if auth.uid() is null or not private.is_internal_user() then
    raise exception 'Somente a equipe interna altera representantes e sócios' using errcode = '42501';
  end if;

  select c.kind into v_kind from public.clients c where c.id = p_client_id and c.deleted_at is null;
  if v_kind is null or not private.can_access_client(p_client_id) then
    raise exception 'Cliente não encontrado' using errcode = '42501';
  end if;
  if v_kind <> 'COMPANY' then
    raise exception 'Representantes e sócios existem só para pessoa jurídica' using errcode = '22023';
  end if;

  -- ── forma das listas ────────────────────────────────────────────────────
  if p_representatives is null or jsonb_typeof(p_representatives) <> 'array'
     or p_shareholders is null or jsonb_typeof(p_shareholders) <> 'array' then
    raise exception 'Envie as listas completas de representantes e sócios' using errcode = '22023';
  end if;
  if jsonb_array_length(p_representatives) > 20 or jsonb_array_length(p_shareholders) > 50 then
    raise exception 'Limite de itens excedido (20 representantes, 50 sócios)' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_representatives) x where jsonb_typeof(x) <> 'object')
     or exists (select 1 from jsonb_array_elements(p_shareholders) x where jsonb_typeof(x) <> 'object') then
    raise exception 'Item inválido na lista' using errcode = '22023';
  end if;

  -- Representante principal: exatamente um quando há representantes.
  select count(*) filter (where coalesce((x ->> 'is_primary')::boolean, false))
    into v_primaries from jsonb_array_elements(p_representatives) x;
  if jsonb_array_length(p_representatives) > 0 and v_primaries <> 1 then
    raise exception 'Marque exatamente um representante como principal' using errcode = '22023';
  end if;

  -- ── ids: só linhas existentes deste cliente, sem repetição ──────────────
  select array_agg((x ->> 'id')::uuid) into v_ids
  from jsonb_array_elements(p_representatives) x where nullif(x ->> 'id', '') is not null;
  if v_ids is not null then
    if cardinality(v_ids) <> (select count(distinct u) from unnest(v_ids) u) then
      raise exception 'Representante repetido na lista' using errcode = '22023';
    end if;
    select count(*) into v_unknown from unnest(v_ids) u
    where not exists (select 1 from public.company_representatives r where r.id = u and r.client_id = p_client_id);
    if v_unknown > 0 then
      raise exception 'Representante não pertence a este cliente' using errcode = '22023';
    end if;
  end if;

  select array_agg((x ->> 'id')::uuid) into v_ids
  from jsonb_array_elements(p_shareholders) x where nullif(x ->> 'id', '') is not null;
  if v_ids is not null then
    if cardinality(v_ids) <> (select count(distinct u) from unnest(v_ids) u) then
      raise exception 'Sócio repetido na lista' using errcode = '22023';
    end if;
    select count(*) into v_unknown from unnest(v_ids) u
    where not exists (select 1 from public.company_shareholders s where s.id = u and s.client_id = p_client_id);
    if v_unknown > 0 then
      raise exception 'Sócio não pertence a este cliente' using errcode = '22023';
    end if;
  end if;

  -- ── representantes ───────────────────────────────────────────────────────
  -- Ordem pensada para o índice único do principal (não diferível):
  -- remove → atualiza não principais → atualiza o principal → insere.
  delete from public.company_representatives r
  where r.client_id = p_client_id
    and r.id not in (select (x ->> 'id')::uuid from jsonb_array_elements(p_representatives) x
                     where nullif(x ->> 'id', '') is not null);
  get diagnostics r_removed = row_count;

  with src as (
    select (x ->> 'id')::uuid id,
           btrim(coalesce(x ->> 'name', '')) full_name,
           nullif(regexp_replace(coalesce(x ->> 'cpf', ''), '\D', '', 'g'), '') cpf,
           nullif(btrim(coalesce(x ->> 'role', '')), '') role_title,
           nullif(lower(btrim(coalesce(x ->> 'email', ''))), '') email,
           nullif(btrim(coalesce(x ->> 'phone', '')), '') phone,
           coalesce((x ->> 'is_primary')::boolean, false) is_primary,
           ord
    from jsonb_array_elements(p_representatives) with ordinality t(x, ord)
    where nullif(x ->> 'id', '') is not null
  ), upd as (
    update public.company_representatives r set
      full_name = s.full_name, cpf = s.cpf, role_title = s.role_title, email = s.email, phone = s.phone,
      primary_representative = false
    from src s
    where r.id = s.id and not s.is_primary
      and (r.full_name, r.cpf, r.role_title, r.email, r.phone, r.primary_representative)
          is distinct from (s.full_name, s.cpf::public.cpf_digits, s.role_title, s.email, s.phone, false)
    returning 1
  )
  select count(*) into v_n from upd;
  r_updated := r_updated + v_n;

  with src as (
    select (x ->> 'id')::uuid id,
           btrim(coalesce(x ->> 'name', '')) full_name,
           nullif(regexp_replace(coalesce(x ->> 'cpf', ''), '\D', '', 'g'), '') cpf,
           nullif(btrim(coalesce(x ->> 'role', '')), '') role_title,
           nullif(lower(btrim(coalesce(x ->> 'email', ''))), '') email,
           nullif(btrim(coalesce(x ->> 'phone', '')), '') phone
    from jsonb_array_elements(p_representatives) x
    where nullif(x ->> 'id', '') is not null and coalesce((x ->> 'is_primary')::boolean, false)
  ), upd as (
    update public.company_representatives r set
      full_name = s.full_name, cpf = s.cpf, role_title = s.role_title, email = s.email, phone = s.phone,
      primary_representative = true
    from src s
    where r.id = s.id
      and (r.full_name, r.cpf, r.role_title, r.email, r.phone, r.primary_representative)
          is distinct from (s.full_name, s.cpf::public.cpf_digits, s.role_title, s.email, s.phone, true)
    returning 1
  )
  select count(*) into v_n from upd;
  r_updated := r_updated + v_n;

  -- Novo principal só depois que nenhum existente ficou marcado (inserção do principal por último).
  insert into public.company_representatives (client_id, full_name, cpf, role_title, email, phone, primary_representative)
  select p_client_id,
         btrim(coalesce(x ->> 'name', '')),
         nullif(regexp_replace(coalesce(x ->> 'cpf', ''), '\D', '', 'g'), ''),
         nullif(btrim(coalesce(x ->> 'role', '')), ''),
         nullif(lower(btrim(coalesce(x ->> 'email', ''))), ''),
         nullif(btrim(coalesce(x ->> 'phone', '')), ''),
         coalesce((x ->> 'is_primary')::boolean, false)
  from jsonb_array_elements(p_representatives) with ordinality t(x, ord)
  where nullif(x ->> 'id', '') is null
  order by coalesce((x ->> 'is_primary')::boolean, false), ord;
  get diagnostics r_added = row_count;

  -- ── sócios ──────────────────────────────────────────────────────────────
  delete from public.company_shareholders s
  where s.client_id = p_client_id
    and s.id not in (select (x ->> 'id')::uuid from jsonb_array_elements(p_shareholders) x
                     where nullif(x ->> 'id', '') is not null);
  get diagnostics s_removed = row_count;

  with src as (
    select (x ->> 'id')::uuid id,
           btrim(coalesce(x ->> 'name', '')) name,
           nullif(regexp_replace(coalesce(x ->> 'document', ''), '\D', '', 'g'), '') document_number,
           nullif(btrim(coalesce(x ->> 'qualification', '')), '') qualification,
           nullif(x ->> 'share_percentage', '')::numeric share_percentage
    from jsonb_array_elements(p_shareholders) x
    where nullif(x ->> 'id', '') is not null
  ), upd as (
    update public.company_shareholders t set
      name = s.name, document_number = s.document_number, qualification = s.qualification,
      share_percentage = s.share_percentage
    from src s
    where t.id = s.id
      and (t.name, t.document_number, t.qualification, t.share_percentage::numeric)
          is distinct from (s.name, s.document_number, s.qualification, s.share_percentage)
    returning 1
  )
  select count(*) into v_n from upd;
  s_updated := v_n;

  insert into public.company_shareholders (client_id, name, document_number, qualification, share_percentage)
  select p_client_id,
         btrim(coalesce(x ->> 'name', '')),
         nullif(regexp_replace(coalesce(x ->> 'document', ''), '\D', '', 'g'), ''),
         nullif(btrim(coalesce(x ->> 'qualification', '')), ''),
         nullif(x ->> 'share_percentage', '')::numeric
  from jsonb_array_elements(p_shareholders) with ordinality t(x, ord)
  where nullif(x ->> 'id', '') is null
  order by ord;
  get diagnostics s_added = row_count;

  -- A lista de clientes ordena por "atualizado": o cadastro reflete a mudança.
  if r_added + r_updated + r_removed + s_added + s_updated + s_removed > 0 then
    update public.clients c set updated_at = now() where c.id = p_client_id;

    -- Resumo (DELETE não passa pelo trigger de linha da 014). Só contagens.
    perform private.record_audit_event('COMPANY_PEOPLE_REPLACED', 'clients', p_client_id, jsonb_build_object(
      'representatives', jsonb_build_object('added', r_added, 'updated', r_updated, 'removed', r_removed,
                                            'total', jsonb_array_length(p_representatives)),
      'shareholders', jsonb_build_object('added', s_added, 'updated', s_updated, 'removed', s_removed,
                                         'total', jsonb_array_length(p_shareholders))));
  end if;

  return jsonb_build_object(
    'representatives', jsonb_build_object('added', r_added, 'updated', r_updated, 'removed', r_removed),
    'shareholders', jsonb_build_object('added', s_added, 'updated', s_updated, 'removed', s_removed));
end
$$;

comment on function private.replace_company_people(uuid, jsonb, jsonb) is
  'Substitui (estado final, atômico) representantes e sócios de Cliente PJ. Equipe interna, aal2. Audita com contagens, sem PII.';

create or replace function public.replace_company_people(p_client_id uuid, p_representatives jsonb, p_shareholders jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.replace_company_people(p_client_id, p_representatives, p_shareholders) $$;

revoke all on function private.replace_company_people(uuid, jsonb, jsonb) from public, anon, service_role;
revoke all on function public.replace_company_people(uuid, jsonb, jsonb) from public, anon, service_role;
grant execute on function private.replace_company_people(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.replace_company_people(uuid, jsonb, jsonb) to authenticated;
