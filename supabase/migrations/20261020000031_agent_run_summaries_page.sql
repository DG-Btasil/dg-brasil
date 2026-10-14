-- DG Brasil — 031: resumos de execução de agente PAGINADOS (Etapa 4.3, Fase G)
--
-- get_agent_run_summaries (016/022) devolve só "as N mais recentes": sem
-- deslocamento, sem total e sem filtro de situação — não serve a uma lista
-- paginada. Antes de ligar a tela de execuções, esta migration acrescenta
-- get_agent_run_summaries_page, com as MESMAS regras de acesso da versão
-- vigente (022: sessão, MFA aal2, só ADMIN e LAWYER; LAWYER só execuções de
-- casos que acessa; ADMIN todas) e as MESMAS colunas fixas — nada de
-- metadata, pedido em texto, tokens, custo, modelo nem mensagem de erro bruta.
--
--   filtros: caso, situação, agente;
--   página:  p_offset + p_limit (1..100), mais recentes primeiro (created_at,
--            id como desempate estável);
--   total:   coluna total_count (count(*) over () — o mesmo valor em todas as
--            linhas da página; página vazia = total implícito 0).
--
-- A função antiga continua existindo e intacta (quem a usa não muda).
--
-- Pós-baseline: 001–030 não são alteradas.

create or replace function private.get_agent_run_summaries_page(
  p_legal_case_id uuid default null,
  p_status        text default null,
  p_agent_id      uuid default null,
  p_offset        integer default 0,
  p_limit         integer default 25
)
returns table (
  id               uuid,
  agent_id         uuid,
  agent_slug       text,
  agent_name       text,
  legal_case_id    uuid,
  legal_process_id uuid,
  status           text,
  operation        text,
  requested_by     uuid,
  attempt          integer,
  error_code       text,
  created_at       timestamptz,
  started_at       timestamptz,
  completed_at     timestamptz,
  proposal_count   bigint,
  total_count      bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.membership_role;
begin
  if auth.uid() is null then
    raise exception 'Sem sessão' using errcode = '42501';
  end if;
  if not private.session_is_mfa_verified() then
    raise exception 'Verificação em duas etapas obrigatória' using errcode = '42501';
  end if;
  v_role := private.user_internal_role(auth.uid());
  if v_role is null or v_role not in ('ADMIN', 'LAWYER') then
    raise exception 'Execuções de agente são visíveis só a ADMIN e LAWYER' using errcode = '42501';
  end if;
  if p_legal_case_id is not null and not private.can_access_case(p_legal_case_id) then
    raise exception 'Sem acesso a este caso' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('QUEUED', 'RUNNING', 'WAITING_HUMAN', 'COMPLETED', 'FAILED', 'CANCELLED') then
    raise exception 'Situação de execução inválida' using errcode = '22023';
  end if;

  return query
  select r.id, r.agent_id, a.slug, a.name, r.legal_case_id, r.legal_process_id, r.status, r.operation,
         r.requested_by, r.attempt, r.error_code, r.created_at, r.started_at, r.completed_at,
         (select count(*) from public.agent_proposals p where p.agent_run_id = r.id),
         count(*) over ()
  from public.agent_runs r
  join public.agents a on a.id = r.agent_id
  where (p_legal_case_id is null or r.legal_case_id = p_legal_case_id)
    and (p_status is null or r.status = p_status)
    and (p_agent_id is null or r.agent_id = p_agent_id)
    and (v_role = 'ADMIN'
         or (r.legal_case_id is not null and private.can_access_case(r.legal_case_id)))
  order by r.created_at desc, r.id desc
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
end
$$;

create or replace function public.get_agent_run_summaries_page(
  p_legal_case_id uuid default null,
  p_status        text default null,
  p_agent_id      uuid default null,
  p_offset        integer default 0,
  p_limit         integer default 25
)
returns table (
  id uuid, agent_id uuid, agent_slug text, agent_name text, legal_case_id uuid, legal_process_id uuid,
  status text, operation text, requested_by uuid, attempt integer, error_code text,
  created_at timestamptz, started_at timestamptz, completed_at timestamptz, proposal_count bigint, total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.get_agent_run_summaries_page(p_legal_case_id, p_status, p_agent_id, p_offset, p_limit) $$;

revoke all on function private.get_agent_run_summaries_page(uuid, text, uuid, integer, integer) from public, anon, service_role;
revoke all on function public.get_agent_run_summaries_page(uuid, text, uuid, integer, integer) from public, anon, service_role;
grant execute on function private.get_agent_run_summaries_page(uuid, text, uuid, integer, integer) to authenticated;
grant execute on function public.get_agent_run_summaries_page(uuid, text, uuid, integer, integer) to authenticated;
