-- 071 · O prazo de "Corrigir e aprovar" nasce conferido por quem corrigiu.
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
-- O contrato do README continua inteiro: nada é aplicado por aqui; o prazo já
-- foi criado pelo aplicador, depois da decisão humana. Nenhuma função
-- existente é redefinida (o aplicador e o gatilho da 063 não mudam).
-- 001–070 não são alteradas. Rodar de novo não quebra nem duplica.

-- ═════════════════════════════ 1. o gatilho ═══════════════════════════════

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

-- ═════════════════════════════ 2. permissões ══════════════════════════════

-- Função de gatilho: ninguém chama direto.
revoke all on function private.agent_proposals_corrected_deadline_checked() from public, anon, authenticated, service_role;
