-- 069 · Revisões: "Corrigir e aprovar" a proposta do agente.
--
-- Pedido da dona do escritório (13/11/2026): a proposta do agente está quase
-- certa, só muda uma coisa. Até a 068 a pessoa só podia aprovar ou rejeitar (a
-- 067 tirou o "solicitar alterações" das propostas, que não chegava a ninguém).
-- Agora quem decide a revisão pode corrigir os dados da proposta e aprovar a
-- versão corrigida, num passo só.
--
-- O contrato do README continua inteiro: o agente propõe, o humano confirma, só
-- a confirmação aplica. Corrigir é a própria decisão humana:
--
--   1. public.correct_and_approve_review(revisão, dados, comentário): numa
--      transação, confere quem decide (ADMIN ou advogado; proposta estrutural
--      só ADMIN, e ela nem se corrige), revisão em aberto, proposta PENDING de
--      um dos tipos CREATE_DEADLINE, REQUEST_DOCUMENT, UPDATE_CASE ou
--      CREATE_PROCESS (OTHER não tem efeito automático: não precisa); valida os
--      dados corrigidos; troca payload.data; e registra a aprovação pela
--      porta de sempre (private.decide_review). A aplicação continua sendo do
--      aplicador (private.worker_apply_next_proposal), só de proposta aprovada.
--   2. Validação dos dados (private.proposal_correction_data): as mesmas
--      regras do contrato do computador do escritório (PROPOSAL_DATA, em
--      apps/frontend/src/server/executor/contract.ts: chaves, tipos e tamanhos)
--      e as que o aplicador (063) exige para não recusar depois: vencimento com
--      data, hora e fuso e ainda não vencido; responsável usuário interno
--      ativo; caso e processo não excluídos e do mesmo caso; o processo do
--      prazo não muda na correção; caso ainda alterável pelo agente; CNJ
--      válido e sem outro processo ativo com o mesmo número.
--   3. O que o agente propôs nunca se perde: agent_proposals.original_payload
--      guarda o payload original na correção, com corrected_by e corrected_at.
--      Só a função da correção escreve essas colunas, e elas não mudam depois.
--   4. Auditoria AGENT_PROPOSAL_CORRECTED: quem (o ator da sessão), quando, a
--      revisão, a decisão e os NOMES dos campos que mudaram (nunca os valores:
--      os dois lados ficam na própria proposta).
--   5. Prazo de publicação: nada muda no gatilho da 062
--      (judicial_publications_follow_proposals). A proposta corrigida e
--      aprovada vira APPLIED pelo aplicador e fecha a publicação como hoje, com
--      quem corrigiu como quem tratou.
--
-- A decisão em conjunto (067) não muda: corrigir é sempre item a item.
--
-- 001–068 não são alteradas (agent_proposals ganha três colunas por ALTER).
-- Rodar de novo não quebra nem duplica.

-- ═════════════════════════════ 1. o original da proposta ═══════════════════

alter table public.agent_proposals
  add column if not exists original_payload jsonb,
  add column if not exists corrected_by uuid references public.profiles (id) on delete restrict,
  add column if not exists corrected_at timestamptz;

alter table public.agent_proposals drop constraint if exists agent_proposals_correction_complete;
alter table public.agent_proposals
  add constraint agent_proposals_correction_complete check (
    (original_payload is null) = (corrected_at is null) and (corrected_at is null) = (corrected_by is null));

comment on column public.agent_proposals.original_payload is
  'O payload que o agente propôs, guardado quando uma pessoa corrigiu a proposta em Revisões (069). Vazio = proposta não corrigida. Nunca muda depois.';
comment on column public.agent_proposals.corrected_by is
  'Quem corrigiu a proposta e a aprovou na mesma decisão (069).';
comment on column public.agent_proposals.corrected_at is
  'Quando a proposta foi corrigida e aprovada (069).';

-- Só a correção (marcada na transação) grava original, autor e data; depois de
-- gravados, não mudam.
create or replace function private.agent_proposals_correction_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.original_payload is not distinct from old.original_payload
     and new.corrected_by is not distinct from old.corrected_by
     and new.corrected_at is not distinct from old.corrected_at then
    return new;
  end if;
  if old.original_payload is not null or old.corrected_at is not null then
    raise exception 'A proposta original e a correção não mudam depois de gravadas' using errcode = '42501';
  end if;
  if coalesce(current_setting('dg.proposal_correction', true), '') <> new.id::text then
    raise exception 'A correção da proposta só se grava por "Corrigir e aprovar" (correct_and_approve_review)' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists agent_proposals_correction_guard on public.agent_proposals;
create trigger agent_proposals_correction_guard
  before update on public.agent_proposals
  for each row execute function private.agent_proposals_correction_guard();

-- ═════════════════════════════ 2. validar os dados corrigidos ══════════════

-- Texto opcional: nulo, ausente ou em branco = sem o campo; senão, até p_max.
create or replace function private.proposal_text(p_data jsonb, p_key text, p_label text, p_min integer, p_max integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text;
begin
  if not (p_data ? p_key) or jsonb_typeof(p_data -> p_key) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_data -> p_key) <> 'string' then
    raise exception '%: informe um texto', p_label using errcode = '22023';
  end if;
  v := nullif(btrim(p_data ->> p_key), '');
  if v is null then
    return null;
  end if;
  if length(v) < p_min then
    raise exception '%: no mínimo % caracteres', p_label, p_min using errcode = '22023';
  end if;
  if length(v) > p_max then
    raise exception '%: no máximo % caracteres', p_label, p_max using errcode = '22023';
  end if;
  return v;
end
$$;

-- Data e hora com fuso (ISO 8601), como o contrato do computador exige.
create or replace function private.proposal_instant(p_data jsonb, p_key text, p_label text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v text;
begin
  if not (p_data ? p_key) or jsonb_typeof(p_data -> p_key) = 'null' then
    return null;
  end if;
  v := case when jsonb_typeof(p_data -> p_key) = 'string' then btrim(p_data ->> p_key) end;
  if v is null or v !~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)$' then
    raise exception '%: informe data, hora e fuso (ex.: 2026-12-01T23:59:59-03:00)', p_label using errcode = '22023';
  end if;
  begin
    return v::timestamptz;
  exception when others then
    raise exception '%: data inválida', p_label using errcode = '22023';
  end;
end
$$;

-- Os dados corrigidos de uma proposta → os dados como serão aplicados. Recusa
-- (22023/23514, com mensagem para a pessoa) o que o computador do escritório
-- não poderia propor ou o que o aplicador recusaria depois.
--   p_old  os dados atuais da proposta (payload.data)
--   p_case, p_process  caso e processo da proposta
create or replace function private.proposal_correction_data(
  p_type text, p_old jsonb, p_new jsonb, p_case uuid, p_process uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_old     jsonb := case when jsonb_typeof(p_old) = 'object' then p_old else '{}'::jsonb end;
  v_allowed text[];
  v_extra   text;
  v_out     jsonb := '{}'::jsonb;
  v_text    text;
  v_due     timestamptz;
  v_uuid    uuid;
  v_process uuid;
  v_status  text;
begin
  if p_new is null or jsonb_typeof(p_new) <> 'object' then
    raise exception 'Dados da correção inválidos' using errcode = '22023';
  end if;
  if pg_column_size(p_new) > 65536 then
    raise exception 'Dados da correção grandes demais' using errcode = '22023';
  end if;
  if p_case is null or not exists (select 1 from public.legal_cases c where c.id = p_case and c.deleted_at is null) then
    raise exception 'O caso desta proposta foi excluído: rejeite a proposta' using errcode = '23514';
  end if;

  v_allowed := case p_type
    when 'CREATE_DEADLINE'  then array['title', 'description', 'due_at', 'priority', 'deadline_type', 'legal_process_id', 'responsible_user_id']
    when 'REQUEST_DOCUMENT' then array['category', 'label', 'required', 'message_to_partner', 'due_at']
    when 'UPDATE_CASE'      then array['title', 'summary', 'status']
    when 'CREATE_PROCESS'   then array['cnj_number', 'court', 'court_unit', 'district', 'state', 'legal_class', 'subject',
                                       'client_side', 'adverse_party_summary', 'case_value']
  end;
  if v_allowed is null then
    raise exception 'Esta proposta não se corrige: aprove ou rejeite' using errcode = '23514';
  end if;
  select k into v_extra from jsonb_object_keys(p_new) k where k <> all (v_allowed) limit 1;
  if v_extra is not null then
    raise exception 'Campo % não existe neste tipo de proposta', v_extra using errcode = '22023';
  end if;

  case p_type
  when 'CREATE_DEADLINE' then
    v_text := private.proposal_text(p_new, 'title', 'Título', 3, 200);
    if v_text is null then
      raise exception 'Informe o título do prazo' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('title', v_text);
    v_text := private.proposal_text(p_new, 'description', 'Descrição', 0, 4000);
    if v_text is not null then
      v_out := v_out || jsonb_build_object('description', v_text);
    end if;
    v_due := private.proposal_instant(p_new, 'due_at', 'Vencimento');
    if v_due is null then
      raise exception 'Informe o vencimento do prazo' using errcode = '22023';
    end if;
    if v_due <= now() then
      raise exception 'O vencimento (%) já passou', to_char(v_due at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
        using errcode = '23514';
    end if;
    v_out := v_out || jsonb_build_object('due_at', btrim(p_new ->> 'due_at'));
    v_text := coalesce(nullif(p_new ->> 'priority', ''), 'NORMAL');
    if v_text not in ('LOW', 'NORMAL', 'HIGH', 'URGENT') then
      raise exception 'Prioridade inválida' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('priority', v_text);
    v_text := nullif(p_new ->> 'deadline_type', '');
    if v_text is not null then
      if v_text not in ('MANIFESTATION', 'REPLY', 'APPEAL', 'HEARING', 'DOCUMENT_DELIVERY', 'FILING', 'INTERNAL') then
        raise exception 'Tipo de prazo inválido' using errcode = '22023';
      end if;
      v_out := v_out || jsonb_build_object('deadline_type', v_text);
    end if;
    -- O processo do prazo é o da proposta (numa publicação, o da publicação):
    -- não muda na correção.
    v_process := coalesce(nullif(v_old ->> 'legal_process_id', '')::uuid, p_process);
    if nullif(p_new ->> 'legal_process_id', '') is not null
       and nullif(p_new ->> 'legal_process_id', '') is distinct from v_process::text then
      raise exception 'O processo do prazo não muda na correção. Para outro processo, rejeite e crie o prazo à mão'
        using errcode = '23514';
    end if;
    if nullif(v_old ->> 'legal_process_id', '') is not null then
      v_out := v_out || jsonb_build_object('legal_process_id', v_old ->> 'legal_process_id');
    end if;
    if v_process is not null and not exists (
         select 1 from public.legal_processes lp
         where lp.id = v_process and lp.legal_case_id = p_case and lp.deleted_at is null) then
      raise exception 'O processo deste prazo foi excluído ou não é deste caso: rejeite a proposta' using errcode = '23514';
    end if;
    if nullif(p_new ->> 'responsible_user_id', '') is not null then
      begin
        v_uuid := (p_new ->> 'responsible_user_id')::uuid;
      exception when others then
        raise exception 'Responsável inválido' using errcode = '22023';
      end;
      if not private.is_active_internal_user(v_uuid) then
        raise exception 'O responsável precisa ser uma pessoa ativa da equipe do escritório' using errcode = '23514';
      end if;
      v_out := v_out || jsonb_build_object('responsible_user_id', v_uuid);
    end if;

  when 'REQUEST_DOCUMENT' then
    v_text := nullif(btrim(coalesce(p_new ->> 'category', '')), '');
    if v_text is null or jsonb_typeof(p_new -> 'category') <> 'string' or v_text !~ '^[A-Z][A-Z0-9_]{1,63}$' then
      raise exception 'Categoria do documento inválida (CAIXA_ALTA, ex.: BENEFIT_STATEMENT)' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('category', v_text);
    v_text := private.proposal_text(p_new, 'label', 'Documento', 3, 200);
    if v_text is null then
      raise exception 'Informe o documento pedido' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('label', v_text);
    if p_new ? 'required' and jsonb_typeof(p_new -> 'required') <> 'null' then
      if jsonb_typeof(p_new -> 'required') <> 'boolean' then
        raise exception 'Obrigatório: informe sim ou não' using errcode = '22023';
      end if;
      v_out := v_out || jsonb_build_object('required', (p_new ->> 'required')::boolean);
    else
      v_out := v_out || jsonb_build_object('required', true);
    end if;
    v_text := private.proposal_text(p_new, 'message_to_partner', 'Mensagem ao parceiro', 0, 2000);
    if v_text is not null then
      v_out := v_out || jsonb_build_object('message_to_partner', v_text);
    end if;
    v_due := private.proposal_instant(p_new, 'due_at', 'Prazo para o parceiro');
    if v_due is not null then
      if v_due <= now() then
        raise exception 'O prazo para o parceiro já passou' using errcode = '23514';
      end if;
      v_out := v_out || jsonb_build_object('due_at', p_new ->> 'due_at');
    end if;

  when 'UPDATE_CASE' then
    v_text := private.proposal_text(p_new, 'title', 'Título do caso', 3, 200);
    if v_text is not null then
      v_out := v_out || jsonb_build_object('title', v_text);
    end if;
    v_text := private.proposal_text(p_new, 'summary', 'Resumo do caso', 0, 8000);
    if v_text is not null then
      v_out := v_out || jsonb_build_object('summary', v_text);
    end if;
    v_text := nullif(p_new ->> 'status', '');
    if v_text is not null then
      if v_text not in ('WAITING_DOCUMENTS', 'READY_FOR_ANALYSIS', 'ANALYZING', 'WAITING_REVIEW') then
        raise exception 'O agente não põe o caso nessa situação' using errcode = '23514';
      end if;
      v_out := v_out || jsonb_build_object('status', v_text);
    end if;
    if v_out = '{}'::jsonb then
      raise exception 'Informe ao menos um campo do caso' using errcode = '22023';
    end if;
    select c.status into v_status from public.legal_cases c where c.id = p_case;
    if v_status not in ('DRAFT', 'SUBMITTED', 'WAITING_DOCUMENTS', 'READY_FOR_ANALYSIS', 'ANALYZING', 'WAITING_REVIEW') then
      raise exception 'O caso já foi decidido: o agente não altera caso aceito, rejeitado ou encerrado. Rejeite a proposta'
        using errcode = '23514';
    end if;

  when 'CREATE_PROCESS' then
    v_text := nullif(btrim(coalesce(p_new ->> 'cnj_number', '')), '');
    if v_text is not null then
      v_text := regexp_replace(v_text, '\D', '', 'g');
      if not private.is_valid_cnj(v_text) then
        raise exception 'Número CNJ inválido (confira os 20 dígitos)' using errcode = '22023';
      end if;
      if exists (select 1 from public.legal_processes lp where lp.cnj_number = v_text and lp.deleted_at is null) then
        raise exception 'Já existe processo cadastrado com este número CNJ' using errcode = '23505';
      end if;
      v_out := v_out || jsonb_build_object('cnj_number', v_text);
    end if;
    v_out := v_out || jsonb_strip_nulls(jsonb_build_object(
      'court', private.proposal_text(p_new, 'court', 'Tribunal', 0, 200),
      'court_unit', private.proposal_text(p_new, 'court_unit', 'Vara', 0, 200),
      'district', private.proposal_text(p_new, 'district', 'Comarca', 0, 200),
      'legal_class', private.proposal_text(p_new, 'legal_class', 'Classe', 0, 200),
      'subject', private.proposal_text(p_new, 'subject', 'Assunto', 0, 500),
      'adverse_party_summary', private.proposal_text(p_new, 'adverse_party_summary', 'Parte contrária', 0, 2000)));
    v_text := nullif(btrim(coalesce(p_new ->> 'state', '')), '');
    if v_text is not null then
      if v_text !~ '^[A-Z]{2}$' then
        raise exception 'UF inválida (duas letras maiúsculas)' using errcode = '22023';
      end if;
      v_out := v_out || jsonb_build_object('state', v_text);
    end if;
    v_text := nullif(p_new ->> 'client_side', '');
    if v_text is not null then
      if v_text not in ('ACTIVE', 'PASSIVE', 'THIRD_PARTY') then
        raise exception 'Polo do cliente inválido' using errcode = '22023';
      end if;
      v_out := v_out || jsonb_build_object('client_side', v_text);
    end if;
    if p_new ? 'case_value' and jsonb_typeof(p_new -> 'case_value') <> 'null' then
      if jsonb_typeof(p_new -> 'case_value') <> 'number' then
        raise exception 'Valor da causa inválido' using errcode = '22023';
      end if;
      if (p_new ->> 'case_value')::numeric < 0 or (p_new ->> 'case_value')::numeric > 999999999999 then
        raise exception 'Valor da causa inválido' using errcode = '22023';
      end if;
      v_out := v_out || jsonb_build_object('case_value', (p_new -> 'case_value'));
    end if;
  end case;

  return v_out;
end
$$;

-- ═════════════════════════════ 3. corrigir e aprovar ═══════════════════════

-- Uma decisão humana: corrige os dados da proposta e aprova a revisão, na mesma
-- transação. Devolve a decisão e os nomes dos campos que mudaram.
create or replace function private.correct_and_approve_review(p_review_id uuid, p_data jsonb, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := private.resolve_actor(null);
  v_role     public.membership_role := private.user_internal_role(v_actor);
  v_rv       record;
  v_p        record;
  v_old      jsonb;
  v_new      jsonb;
  v_fields   text[];
  v_decision uuid;
begin
  if v_role is null or v_role not in ('ADMIN', 'LAWYER') then
    raise exception 'Só ADMIN ou advogado do escritório corrige e aprova proposta do agente' using errcode = '42501';
  end if;

  select r.id, r.status, r.legal_case_id, r.agent_proposal_id into v_rv
  from public.reviews r where r.id = p_review_id
  for update;
  if not found or (v_rv.legal_case_id is not null and not private.can_access_case(v_rv.legal_case_id)) then
    raise exception 'Revisão não encontrada' using errcode = 'P0002';
  end if;
  if v_rv.agent_proposal_id is null then
    raise exception 'Só proposta do agente se corrige e aprova. Documento e análise têm as próprias ações' using errcode = '23514';
  end if;

  select p.id, p.proposal_type, p.payload, p.status, p.requires_human_review, p.legal_case_id, p.legal_process_id
    into v_p
  from public.agent_proposals p where p.id = v_rv.agent_proposal_id
  for update;

  if private.proposal_requires_admin(v_p.proposal_type) and v_role <> 'ADMIN' then
    raise exception 'Somente ADMIN decide proposta % (configuração estrutural do DG Brasil)', v_p.proposal_type using errcode = '42501';
  end if;
  if v_p.proposal_type not in ('CREATE_DEADLINE', 'REQUEST_DOCUMENT', 'UPDATE_CASE', 'CREATE_PROCESS') then
    raise exception 'Esta proposta não se corrige: aprove ou rejeite' using errcode = '23514';
  end if;
  if v_rv.status not in ('PENDING', 'REOPENED') then
    raise exception 'Esta revisão já foi decidida' using errcode = '23514';
  end if;
  if v_p.status <> 'PENDING' or not v_p.requires_human_review then
    raise exception 'Esta proposta já foi decidida' using errcode = '23514';
  end if;

  v_old := case when jsonb_typeof(v_p.payload -> 'data') = 'object' then v_p.payload -> 'data' else '{}'::jsonb end;
  v_new := private.proposal_correction_data(v_p.proposal_type, v_old, p_data, v_p.legal_case_id, v_p.legal_process_id);

  select coalesce(array_agg(k order by k), '{}') into v_fields
  from (select jsonb_object_keys(v_old) k union select jsonb_object_keys(v_new)) x
  where v_old -> k is distinct from v_new -> k;
  if cardinality(v_fields) = 0 then
    raise exception 'Nada foi alterado. Para aprovar a proposta como está, use "Aprovar"' using errcode = '23514';
  end if;

  perform set_config('dg.proposal_correction', v_p.id::text, true);
  update public.agent_proposals
     set original_payload = v_p.payload,
         payload = jsonb_set(case when jsonb_typeof(v_p.payload) = 'object' then v_p.payload else '{}'::jsonb end, '{data}', v_new),
         corrected_by = v_actor,
         corrected_at = now()
   where id = v_p.id;
  perform set_config('dg.proposal_correction', '', true);

  -- A aprovação pela porta de sempre: decisão (append-only) → revisão → proposta.
  v_decision := private.decide_review(p_review_id, 'APPROVE', nullif(btrim(coalesce(p_notes, '')), ''), null);

  perform private.record_audit_event('AGENT_PROPOSAL_CORRECTED', 'agent_proposals', v_p.id,
    jsonb_build_object('review_id', p_review_id, 'review_decision_id', v_decision,
                       'proposal_type', v_p.proposal_type, 'legal_case_id', v_p.legal_case_id,
                       'fields', to_jsonb(v_fields)));

  return jsonb_build_object('review_id', p_review_id, 'decision_id', v_decision, 'proposal_id', v_p.id,
                            'fields', to_jsonb(v_fields));
end
$$;

create or replace function public.correct_and_approve_review(p_review_id uuid, p_data jsonb, p_notes text default null)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.correct_and_approve_review(p_review_id, p_data, p_notes) $$;

-- ═════════════════════════════ 4. permissões ══════════════════════════════

-- Blocos internos e função de gatilho: ninguém chama direto.
revoke all on function private.agent_proposals_correction_guard() from public, anon, authenticated, service_role;
revoke all on function private.proposal_text(jsonb, text, text, integer, integer) from public, anon, authenticated, service_role;
revoke all on function private.proposal_instant(jsonb, text, text) from public, anon, authenticated, service_role;
revoke all on function private.proposal_correction_data(text, jsonb, jsonb, uuid, uuid) from public, anon, authenticated, service_role;
-- Tela: pública (invoker) → privada (definer); a privada confere o papel.
revoke all on function private.correct_and_approve_review(uuid, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.correct_and_approve_review(uuid, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function private.correct_and_approve_review(uuid, jsonb, text) to authenticated;
grant execute on function public.correct_and_approve_review(uuid, jsonb, text) to authenticated;
