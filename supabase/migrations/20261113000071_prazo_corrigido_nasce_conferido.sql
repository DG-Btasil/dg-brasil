-- 071 · O prazo de "Corrigir e aprovar" nasce conferido por quem corrigiu; e a
--       exportação de planilha entra no registro de acesso a dado pessoal.
--
-- Achado dos testes ao vivo (13/11/2026): o prazo criado por uma proposta que
-- uma pessoa corrigiu e aprovou (069) aparecia na agenda como "Agente, sem
-- conferência". Não faz sentido: uma pessoa já leu a proposta, corrigiu a data
-- (ou o que fosse) e aprovou. Decisão da sessão principal: esse prazo nasce
-- conferido por quem corrigiu, na hora da correção.
--
--   1. Gatilho em agent_proposals (depois de mudar a situação): proposta
--      CREATE_DEADLINE que vira APPLIED com o prazo criado E que foi corrigida
--      (corrected_by preenchido, 069) grava a conferência do prazo:
--      checked_by = quem corrigiu, checked_at = quando corrigiu. Proposta só
--      aprovada (sem correção) continua como antes: o prazo nasce "sem
--      conferência" até alguém clicar em "Conferido" (063). O prazo direto da
--      059 nunca é corrigido: continua sem conferência.
--   2. A gravação passa pelo gatilho de sempre (deadlines_transition_guard,
--      063): conferência uma vez só, só em prazo do agente. Prazo já conferido
--      não muda.
--   3. Auditoria DEADLINE_CHECKED (a mesma da 063), com "via" = correção, a
--      proposta e quem corrigiu.
--
--   4. Exportação (achado C2 dos testes, LGPD): a planilha de clientes leva o
--      CPF completo, mas só aparecia na auditoria ("Planilha exportada",
--      DATA_EXPORTED da 066), não em "Acessos a dados pessoais". Agora
--      public.record_personal_data_export(exportação, tipo, clientes) grava UM
--      acesso "Exportou · Exportação de dados" para cada cliente da planilha,
--      ligado ao registro da exportação (resource_id = id do DATA_EXPORTED).
--      Só ADMIN (quem exporta), no máximo 5000 clientes por planilha (o limite
--      da exportação), cliente repetido conta uma vez, id que não é cliente é
--      ignorado. O painel LGPD já lê essa tabela: nada muda nele.
--
-- O contrato do README continua inteiro: nada é aplicado por aqui; o prazo já
-- foi criado pelo aplicador, depois da decisão humana. Nenhuma função
-- existente é redefinida (o aplicador, o gatilho da 063 e a record_data_export
-- da 066 não mudam). 001–070 não são alteradas. Rodar de novo não quebra nem
-- duplica.

-- ═════════════════════════════ 1. o gatilho do prazo ══════════════════════

create or replace function private.agent_proposals_corrected_deadline_checked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_d record;
begin
  -- checked_at fica com a hora da correção: o gatilho da 063 grava now(); a
  -- hora exata da correção está na proposta (corrected_at) e na auditoria.
  update public.deadlines d
     set checked_at = coalesce(new.corrected_at, now()), checked_by = new.corrected_by
   where d.id = new.applied_entity_id
     and d.source = 'AGENT'
     and d.checked_at is null
  returning d.id, d.legal_case_id, d.legal_process_id, d.checked_by into v_d;
  if v_d.id is not null then
    perform private.record_audit_event('DEADLINE_CHECKED', 'deadlines', v_d.id,
      jsonb_build_object('legal_case_id', v_d.legal_case_id, 'legal_process_id', v_d.legal_process_id, 'source', 'AGENT',
                         'via', 'PROPOSAL_CORRECTED', 'agent_proposal_id', new.id, 'checked_by', v_d.checked_by));
  end if;
  return null;
end
$$;

drop trigger if exists agent_proposals_corrected_deadline_checked on public.agent_proposals;
create trigger agent_proposals_corrected_deadline_checked
  after update of status on public.agent_proposals
  for each row
  when (new.status = 'APPLIED' and old.status is distinct from new.status and new.proposal_type = 'CREATE_DEADLINE'
        and new.applied_entity_type = 'deadlines' and new.applied_entity_id is not null and new.corrected_by is not null)
  execute function private.agent_proposals_corrected_deadline_checked();

-- ═════════════════════════════ 2. exportação como acesso a dado pessoal ═════

create or replace function private.record_personal_data_export(p_export_id uuid, p_kind text, p_client_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_n     integer;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Somente o administrador exporta planilhas' using errcode = '42501';
  end if;
  if p_export_id is null or not exists (
       select 1 from public.audit_events a
       where a.id = p_export_id and a.action = 'DATA_EXPORTED' and a.actor_user_id = auth.uid()) then
    raise exception 'Exportação não encontrada' using errcode = '22023';
  end if;
  if coalesce(p_kind, '') !~ '^[a-z][a-z0-9_]{1,39}$' then
    raise exception 'Tipo de exportação inválido' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_client_ids), 0) > 5000 then
    raise exception 'No máximo 5000 clientes por planilha' using errcode = '22023';
  end if;
  select * into v_actor from private.current_actor();
  insert into public.personal_data_access_events
    (actor_type, actor_user_id, organization_id, agent_run_id, client_id,
     resource_type, resource_id, action, purpose, request_id)
  select v_actor.actor_type, v_actor.actor_user_id, v_actor.actor_organization_id, v_actor.agent_run_id, c.id,
         'EXPORT', p_export_id, 'EXPORT', 'Planilha exportada (' || p_kind || ')', nullif(current_setting('dg.request_id', true), '')
  from public.clients c
  where c.id = any (coalesce(p_client_ids, '{}'))
    and not exists (select 1 from public.personal_data_access_events e
                    where e.resource_id = p_export_id and e.action = 'EXPORT' and e.client_id = c.id);
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

create or replace function public.record_personal_data_export(p_export_id uuid, p_kind text, p_client_ids uuid[])
returns integer
language sql
security invoker
set search_path = ''
as $$ select private.record_personal_data_export(p_export_id, p_kind, p_client_ids) $$;

-- ═════════════════════════════ 3. permissões ══════════════════════════════

-- Função de gatilho: ninguém chama direto.
revoke all on function private.agent_proposals_corrected_deadline_checked() from public, anon, authenticated, service_role;
-- Exportação: pública (invoker) → privada (definer); a privada confere o papel.
revoke all on function private.record_personal_data_export(uuid, text, uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.record_personal_data_export(uuid, text, uuid[]) from public, anon, service_role;
grant execute on function private.record_personal_data_export(uuid, text, uuid[]) to authenticated;
grant execute on function public.record_personal_data_export(uuid, text, uuid[]) to authenticated;
