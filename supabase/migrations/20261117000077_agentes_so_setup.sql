-- 077 · O conteúdo dos agentes fica com quem vê o setup (decisão de 17/11/2026).
--
-- As orientações e a configuração de cada agente (agent_versions) são a parte
-- do escritório que o setup guarda. Até aqui todo ADMIN lia e editava. Agora
-- só quem vê o setup (a conta principal e quem recebeu acesso em "Adicionar
-- visibilidade", 072/076) lê, cria ou edita esse conteúdo. O ADMIN sem setup
-- continua vendo a lista de agentes (nome, descrição, situação, execuções),
-- pausando, ativando e executando; o Editar e o Criar agente não aparecem para
-- ele, e as orientações, a configuração e as versões também não.
--
--   1. agent_versions: ler e inserir só com can_use_office_setup (antes: is_admin);
--   2. agents: criar só com can_use_office_setup (editar o registro continua
--      por dg_save_agent_once, que agora confere o setup);
--   3. dg_save_agent_once (039) refeita: confere o setup antes de tudo.
--
-- O computador do escritório (executor) e o worker leem por funções próprias
-- (security definer / dg_worker) e não mudam.

-- ═════════════════════════════ 1 e 2. políticas ══════════════════════════

drop policy agent_versions_select_admin on public.agent_versions;
create policy agent_versions_select_setup on public.agent_versions for select to authenticated
  using ((select private.can_use_office_setup()));

drop policy agent_versions_insert_admin on public.agent_versions;
create policy agent_versions_insert_setup on public.agent_versions for insert to authenticated
  with check ((select private.can_use_office_setup()));

drop policy agents_insert_admin on public.agents;
create policy agents_insert_setup on public.agents for insert to authenticated
  with check ((select private.can_use_office_setup()));

-- ═════════════════════════════ 3. salvar agente ══════════════════════════

-- 039 refeita: só quem vê o setup cria ou edita agente.
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
  if not (select private.can_use_office_setup()) then
    raise exception 'Só quem vê o setup do escritório edita agentes' using errcode = '42501';
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
