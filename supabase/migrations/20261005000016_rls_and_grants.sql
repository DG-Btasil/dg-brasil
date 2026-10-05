-- DG Brasil — 016: grants e Row Level Security
--
-- Duas barreiras: o Next.js autoriza; a RLS confere de novo no banco.
-- RLS não substitui a autorização do backend.
--
-- Regras gerais:
--   * anon não recebe nada.
--   * authenticated recebe só SELECT/INSERT/UPDATE explícitos, tabela a tabela.
--     DELETE nunca: "excluir" é soft delete (UPDATE de deleted_at).
--   * Sem política = sem acesso. Toda tabela de public tem RLS ligada.
--   * service_role ignora RLS (worker, tarefas server-side). Mesmo assim não
--     altera tabelas append-only.
--
-- Abreviações nos comentários: I = interno (ADMIN/LAWYER/ASSISTANT),
-- A = ADMIN, AL = ADMIN ou LAWYER, P = usuário de parceiro, PA = PARTNER_ADMIN.

-- ───────────────────────────── limpeza de grants ──────────────────────────

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon;

-- Tabelas futuras não nascem abertas: cada migration concede o que precisar.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon;

-- RLS em toda tabela de public.
do $$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end
$$;

-- ───────────────────────────── grants para authenticated ──────────────────

grant select on all tables in schema public to authenticated;

grant insert, update on
  public.organizations, public.partner_office_settings,
  public.clients, public.individual_client_details, public.company_client_details,
  public.company_representatives, public.client_contacts, public.client_addresses,
  public.client_organization_relationships,
  public.legal_areas, public.case_types, public.analysis_templates, public.analysis_template_requirements,
  public.legal_cases, public.legal_case_internal_details, public.case_document_requirements,
  public.documents,
  public.legal_processes, public.process_parties, public.process_events, public.deadlines,
  public.legal_analyses, public.reviews, public.partner_requests,
  public.fee_models, public.financial_agreements, public.payments, public.partner_transfers,
  public.agents, public.skills, public.legal_theses, public.reference_materials,
  public.agent_skill_bindings, public.agent_thesis_bindings, public.agent_reference_bindings,
  public.skill_reference_bindings, public.thesis_reference_bindings,
  public.agent_runs, public.integration_connections, public.judicial_monitors, public.import_jobs
to authenticated;

-- Só inserção (append-only ou vínculos).
grant insert on
  public.user_legal_acceptances, public.document_versions, public.case_documents,
  public.process_documents, public.review_decisions, public.partner_request_messages,
  public.partner_revenue_allocations, public.partner_transfer_items,
  public.agent_versions, public.skill_versions, public.legal_thesis_versions,
  public.reference_material_versions
to authenticated;

-- Só atualização.
grant update on public.case_partnership_agreements, public.agent_proposals to authenticated;

-- Colunas que o próprio usuário pode mudar. active, OAB e vínculo são do backend.
grant update (full_name, preferred_name, phone, avatar_url) on public.profiles to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- service_role: tudo, menos alterar histórico.
grant all on all tables in schema public to service_role;
revoke update, delete, truncate on
  public.audit_events, public.review_decisions, public.document_versions,
  public.agent_versions, public.skill_versions, public.legal_thesis_versions,
  public.reference_material_versions, public.user_legal_acceptances,
  public.partner_request_messages
from service_role;

-- ═════════════════════════════ POLÍTICAS ═════════════════════════════════

-- ───────────────────────────── organizações e usuários ────────────────────

-- I: todas. P: a própria e a do proprietário (nunca outro parceiro).
create policy organizations_select on public.organizations for select to authenticated
  using (
    (select private.is_internal_user())
    or ((select private.is_partner_user())
        and (id = (select private.current_partner_organization_id()) or type = 'OWNER'))
  );
create policy organizations_insert_admin on public.organizations for insert to authenticated
  with check ((select private.is_admin()));
create policy organizations_update_admin on public.organizations for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- Divisão padrão e notas internas do parceiro: só ADMIN.
create policy partner_office_settings_admin_select on public.partner_office_settings for select to authenticated
  using ((select private.is_admin()));
create policy partner_office_settings_admin_insert on public.partner_office_settings for insert to authenticated
  with check ((select private.is_admin()));
create policy partner_office_settings_admin_update on public.partner_office_settings for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- Próprio perfil; I vê todos; P vê só colegas do mesmo escritório.
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (select private.is_internal_user())
    or private.shares_partner_organization(id)
  );
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Vínculos: o próprio; I todos; P os do próprio escritório. Escrita só pelo backend.
create policy organization_memberships_select on public.organization_memberships for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.is_internal_user())
    or organization_id = (select private.current_partner_organization_id())
  );

-- Convites: A todos; PA os do próprio escritório. Criação pelo backend (hash do token).
create policy user_invitations_select on public.user_invitations for select to authenticated
  using (
    (select private.is_admin())
    or ((select private.is_partner_admin())
        and organization_id = (select private.current_partner_organization_id()))
  );

create policy user_legal_acceptances_select on public.user_legal_acceptances for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));
create policy user_legal_acceptances_insert_self on public.user_legal_acceptances for insert to authenticated
  with check (user_id = (select auth.uid()));

-- ───────────────────────────── clientes ───────────────────────────────────
-- P cria cliente pelo backend (deduplicação sem vazamento de CPF/CNPJ).

create policy clients_select on public.clients for select to authenticated
  using (
    (select private.is_internal_user())
    or ((select private.is_partner_user()) and deleted_at is null and private.can_access_client(id))
  );
create policy clients_insert_internal on public.clients for insert to authenticated
  with check ((select private.is_internal_user()));
create policy clients_update_internal on public.clients for update to authenticated
  using ((select private.is_internal_user())) with check ((select private.is_internal_user()));

-- Detalhes PF/PJ e representantes: leitura com o cliente; escrita interna.
create policy individual_client_details_select on public.individual_client_details for select to authenticated
  using (private.can_access_client(client_id));
create policy individual_client_details_insert on public.individual_client_details for insert to authenticated
  with check ((select private.is_internal_user()));
create policy individual_client_details_update on public.individual_client_details for update to authenticated
  using ((select private.is_internal_user())) with check ((select private.is_internal_user()));

create policy company_client_details_select on public.company_client_details for select to authenticated
  using (private.can_access_client(client_id));
create policy company_client_details_insert on public.company_client_details for insert to authenticated
  with check ((select private.is_internal_user()));
create policy company_client_details_update on public.company_client_details for update to authenticated
  using ((select private.is_internal_user())) with check ((select private.is_internal_user()));

create policy company_representatives_select on public.company_representatives for select to authenticated
  using (private.can_access_client(client_id));
create policy company_representatives_insert on public.company_representatives for insert to authenticated
  with check ((select private.is_internal_user()));
create policy company_representatives_update on public.company_representatives for update to authenticated
  using ((select private.is_internal_user())) with check ((select private.is_internal_user()));

-- Contatos e endereços: P também edita, nos clientes que acessa (auditado).
create policy client_contacts_select on public.client_contacts for select to authenticated
  using (private.can_access_client(client_id));
create policy client_contacts_insert on public.client_contacts for insert to authenticated
  with check (private.can_access_client(client_id));
create policy client_contacts_update on public.client_contacts for update to authenticated
  using (private.can_access_client(client_id)) with check (private.can_access_client(client_id));

create policy client_addresses_select on public.client_addresses for select to authenticated
  using (private.can_access_client(client_id));
create policy client_addresses_insert on public.client_addresses for insert to authenticated
  with check (private.can_access_client(client_id));
create policy client_addresses_update on public.client_addresses for update to authenticated
  using (private.can_access_client(client_id)) with check (private.can_access_client(client_id));

-- P vê só o PRÓPRIO relacionamento: nunca descobre outro escritório do mesmo cliente.
create policy client_organization_relationships_select on public.client_organization_relationships
  for select to authenticated
  using (
    (select private.is_internal_user())
    or organization_id = (select private.current_partner_organization_id())
  );
create policy client_organization_relationships_insert on public.client_organization_relationships
  for insert to authenticated with check ((select private.is_internal_user()));
create policy client_organization_relationships_update on public.client_organization_relationships
  for update to authenticated
  using ((select private.is_internal_user())) with check ((select private.is_internal_user()));

-- ───────────────────────────── catálogo jurídico ──────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array['legal_areas', 'case_types', 'analysis_templates', 'analysis_template_requirements']
  loop
    execute format($p$
      create policy %1$I on public.%2$I for select to authenticated
        using ((select private.current_organization_id()) is not null)$p$, t || '_select_members', t);
    execute format($p$
      create policy %1$I on public.%2$I for insert to authenticated
        with check ((select private.is_admin()))$p$, t || '_insert_admin', t);
    execute format($p$
      create policy %1$I on public.%2$I for update to authenticated
        using ((select private.is_admin())) with check ((select private.is_admin()))$p$, t || '_update_admin', t);
  end loop;
end
$$;

-- ───────────────────────────── casos ──────────────────────────────────────
-- P: partner_organization_id = escritório do usuário. Nunca pela origem.

create policy legal_cases_select on public.legal_cases for select to authenticated
  using (
    (select private.is_internal_user())
    or (deleted_at is null
        and partner_organization_id = (select private.current_partner_organization_id()))
  );

-- AL: cria e decide.
create policy legal_cases_insert_lawyer on public.legal_cases for insert to authenticated
  with check ((select private.has_internal_role('ADMIN', 'LAWYER')));
create policy legal_cases_update_lawyer on public.legal_cases for update to authenticated
  using ((select private.has_internal_role('ADMIN', 'LAWYER')))
  with check ((select private.has_internal_role('ADMIN', 'LAWYER')));

-- ASSISTANT: cadastra e envia; não decide (aceitar/rejeitar/encerrar).
create policy legal_cases_insert_assistant on public.legal_cases for insert to authenticated
  with check (
    (select private.has_internal_role('ASSISTANT'))
    and status in ('DRAFT', 'SUBMITTED', 'WAITING_DOCUMENTS', 'READY_FOR_ANALYSIS')
    and accepted_at is null and rejected_at is null and closed_at is null
  );
create policy legal_cases_update_assistant on public.legal_cases for update to authenticated
  using (
    (select private.has_internal_role('ASSISTANT'))
    and status in ('DRAFT', 'SUBMITTED', 'WAITING_DOCUMENTS', 'READY_FOR_ANALYSIS')
  )
  with check (
    (select private.has_internal_role('ASSISTANT'))
    and status in ('DRAFT', 'SUBMITTED', 'WAITING_DOCUMENTS', 'READY_FOR_ANALYSIS')
    and accepted_at is null and rejected_at is null and closed_at is null
  );

-- P: cria rascunho ou envia; edita só rascunho. Origem validada no trigger.
create policy legal_cases_insert_partner on public.legal_cases for insert to authenticated
  with check (
    (select private.is_partner_user())
    and partner_organization_id = (select private.current_partner_organization_id())
    and status in ('DRAFT', 'SUBMITTED')
    and accepted_at is null and rejected_at is null and closed_at is null
    and assigned_lawyer_id is null and deleted_at is null
    and private.can_access_client(client_id)
  );
create policy legal_cases_update_partner on public.legal_cases for update to authenticated
  using (
    (select private.is_partner_user())
    and partner_organization_id = (select private.current_partner_organization_id())
    and status = 'DRAFT' and deleted_at is null
  )
  with check (
    partner_organization_id = (select private.current_partner_organization_id())
    and status in ('DRAFT', 'SUBMITTED')
    and accepted_at is null and rejected_at is null and closed_at is null
    and assigned_lawyer_id is null and deleted_at is null
  );

-- Notas internas: só equipe interna. Nenhuma política para parceiro.
create policy legal_case_internal_details_select on public.legal_case_internal_details for select to authenticated
  using ((select private.is_internal_user()));
create policy legal_case_internal_details_insert on public.legal_case_internal_details for insert to authenticated
  with check ((select private.is_internal_user()));
create policy legal_case_internal_details_update on public.legal_case_internal_details for update to authenticated
  using ((select private.is_internal_user())) with check ((select private.is_internal_user()));

-- Pendências de documento: P vê as dos próprios casos.
create policy case_document_requirements_select on public.case_document_requirements for select to authenticated
  using ((select private.is_internal_user()) or private.can_access_case(legal_case_id));
create policy case_document_requirements_insert on public.case_document_requirements for insert to authenticated
  with check ((select private.is_internal_user()));
create policy case_document_requirements_update on public.case_document_requirements for update to authenticated
  using ((select private.is_internal_user())) with check ((select private.is_internal_user()));

-- ───────────────────────────── documentos ─────────────────────────────────
-- P: só PARTNER_VISIBLE, ligado a caso/processo acessível. INTERNAL nunca.

create policy documents_select on public.documents for select to authenticated
  using (
    (select private.is_internal_user())
    or ((select private.is_partner_user()) and visibility = 'PARTNER_VISIBLE' and private.can_access_document(id))
  );
create policy documents_insert_internal on public.documents for insert to authenticated
  with check ((select private.is_internal_user()));
-- Envio do parceiro: nasce PARTNER_VISIBLE, em nome do próprio usuário. O
-- backend insere sem RETURNING e vincula ao caso em seguida (case_documents).
create policy documents_insert_partner on public.documents for insert to authenticated
  with check (
    (select private.is_partner_user())
    and visibility = 'PARTNER_VISIBLE'
    and deleted_at is null
    and created_by = (select auth.uid())
    and private.can_access_client(client_id)
  );
create policy documents_update_internal on public.documents for update to authenticated
  using ((select private.is_internal_user())) with check ((select private.is_internal_user()));

create policy document_versions_select on public.document_versions for select to authenticated
  using ((select private.is_internal_user()) or private.can_access_document(document_id));
create policy document_versions_insert_internal on public.document_versions for insert to authenticated
  with check ((select private.is_internal_user()));
create policy document_versions_insert_partner on public.document_versions for insert to authenticated
  with check (
    (select private.is_partner_user()) and source = 'UPLOAD' and private.can_access_document(document_id)
  );

create policy case_documents_select on public.case_documents for select to authenticated
  using (
    (select private.is_internal_user())
    or (private.can_access_case(legal_case_id) and private.can_access_document(document_id))
  );
create policy case_documents_insert on public.case_documents for insert to authenticated
  with check (
    (select private.is_internal_user()) or private.partner_can_link_document(document_id, legal_case_id)
  );

create policy process_documents_select on public.process_documents for select to authenticated
  using (
    (select private.is_internal_user())
    or (private.can_access_process(legal_process_id) and private.can_access_document(document_id))
  );
create policy process_documents_insert on public.process_documents for insert to authenticated
  with check (
    (select private.is_internal_user())
    or private.partner_can_link_process_document(document_id, legal_process_id)
  );

-- ───────────────────────────── processos ──────────────────────────────────

create policy legal_processes_select on public.legal_processes for select to authenticated
  using (
    (select private.is_internal_user())
    or ((select private.is_partner_user()) and deleted_at is null and private.can_access_case(legal_case_id))
  );
create policy legal_processes_insert_lawyer on public.legal_processes for insert to authenticated
  with check ((select private.has_internal_role('ADMIN', 'LAWYER')));
create policy legal_processes_insert_partner on public.legal_processes for insert to authenticated
  with check (
    (select private.is_partner_user())
    and technical_origin = 'MANUAL' and deleted_at is null
    and private.can_access_case(legal_case_id)
  );
create policy legal_processes_update_lawyer on public.legal_processes for update to authenticated
  using ((select private.has_internal_role('ADMIN', 'LAWYER')))
  with check ((select private.has_internal_role('ADMIN', 'LAWYER')));

create policy process_parties_select on public.process_parties for select to authenticated
  using ((select private.is_internal_user()) or private.can_access_process(legal_process_id));
create policy process_parties_insert on public.process_parties for insert to authenticated
  with check (
    (select private.has_internal_role('ADMIN', 'LAWYER'))
    or ((select private.is_partner_user()) and private.can_access_process(legal_process_id))
  );
create policy process_parties_update on public.process_parties for update to authenticated
  using ((select private.has_internal_role('ADMIN', 'LAWYER')))
  with check ((select private.has_internal_role('ADMIN', 'LAWYER')));

-- P vê só movimentação oficial (tribunal/importação). Nota manual e registro de agente, não.
create policy process_events_select on public.process_events for select to authenticated
  using (
    (select private.is_internal_user())
    or (source in ('JUDICIAL_INTEGRATION', 'IMPORT') and private.can_access_process(legal_process_id))
  );
create policy process_events_insert on public.process_events for insert to authenticated
  with check ((select private.has_internal_role('ADMIN', 'LAWYER')));
create policy process_events_update on public.process_events for update to authenticated
  using ((select private.has_internal_role('ADMIN', 'LAWYER')))
  with check ((select private.has_internal_role('ADMIN', 'LAWYER')));

create policy deadlines_select on public.deadlines for select to authenticated
  using ((select private.is_internal_user()));
create policy deadlines_insert on public.deadlines for insert to authenticated
  with check ((select private.has_internal_role('ADMIN', 'LAWYER')));
create policy deadlines_update on public.deadlines for update to authenticated
  using ((select private.has_internal_role('ADMIN', 'LAWYER')))
  with check ((select private.has_internal_role('ADMIN', 'LAWYER')));

create policy process_external_refs_select on public.process_external_refs for select to authenticated
  using ((select private.is_internal_user()));

-- ───────────────────────────── análises e revisões ────────────────────────
-- Só AL. ASSISTANT e parceiros não têm nenhuma política aqui.

create policy legal_analyses_select on public.legal_analyses for select to authenticated
  using ((select private.has_internal_role('ADMIN', 'LAWYER')));
create policy legal_analyses_insert on public.legal_analyses for insert to authenticated
  with check ((select private.has_internal_role('ADMIN', 'LAWYER')));
create policy legal_analyses_update on public.legal_analyses for update to authenticated
  using ((select private.has_internal_role('ADMIN', 'LAWYER')))
  with check ((select private.has_internal_role('ADMIN', 'LAWYER')));

create policy reviews_select on public.reviews for select to authenticated
  using ((select private.has_internal_role('ADMIN', 'LAWYER')));
create policy reviews_insert on public.reviews for insert to authenticated
  with check ((select private.has_internal_role('ADMIN', 'LAWYER')));
create policy reviews_update on public.reviews for update to authenticated
  using ((select private.has_internal_role('ADMIN', 'LAWYER')))
  with check ((select private.has_internal_role('ADMIN', 'LAWYER')));

create policy review_decisions_select on public.review_decisions for select to authenticated
  using ((select private.has_internal_role('ADMIN', 'LAWYER')));
create policy review_decisions_insert on public.review_decisions for insert to authenticated
  with check ((select private.has_internal_role('ADMIN', 'LAWYER')) and decided_by = (select auth.uid()));

-- ───────────────────────────── parceiros: solicitações ────────────────────

create policy partner_requests_select on public.partner_requests for select to authenticated
  using (
    (select private.is_internal_user())
    or partner_organization_id = (select private.current_partner_organization_id())
  );
create policy partner_requests_insert on public.partner_requests for insert to authenticated
  with check ((select private.is_internal_user()));
create policy partner_requests_update_internal on public.partner_requests for update to authenticated
  using ((select private.is_internal_user())) with check ((select private.is_internal_user()));
-- P responde (OPEN → ANSWERED). Os demais campos são travados no trigger.
create policy partner_requests_update_partner on public.partner_requests for update to authenticated
  using (
    partner_organization_id = (select private.current_partner_organization_id()) and status = 'OPEN'
  )
  with check (
    partner_organization_id = (select private.current_partner_organization_id())
    and status in ('OPEN', 'ANSWERED')
  );

create policy partner_request_messages_select on public.partner_request_messages for select to authenticated
  using (private.can_access_partner_request(partner_request_id));
create policy partner_request_messages_insert on public.partner_request_messages for insert to authenticated
  with check (
    private.can_access_partner_request(partner_request_id)
    and author_id = (select auth.uid())
    and (document_id is null or private.can_access_document(document_id))
  );

-- ───────────────────────────── notificações ───────────────────────────────
-- Cada um vê e marca como lida só as próprias. Criação pelo backend.

create policy notifications_select_own on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ───────────────────────────── financeiro ─────────────────────────────────
-- A: completo. LAWYER e ASSISTANT: nada. PA: só a parceria do próprio
-- escritório. PARTNER_USER: nada.

do $$
declare
  t text;
begin
  foreach t in array array['fee_models', 'financial_agreements', 'payments']
  loop
    execute format($p$
      create policy %1$I on public.%2$I for select to authenticated
        using ((select private.is_admin()))$p$, t || '_select_admin', t);
    execute format($p$
      create policy %1$I on public.%2$I for insert to authenticated
        with check ((select private.is_admin()))$p$, t || '_insert_admin', t);
    execute format($p$
      create policy %1$I on public.%2$I for update to authenticated
        using ((select private.is_admin())) with check ((select private.is_admin()))$p$, t || '_update_admin', t);
  end loop;
end
$$;

create policy case_partnership_agreements_select on public.case_partnership_agreements for select to authenticated
  using (
    (select private.is_admin())
    or ((select private.is_partner_admin())
        and partner_organization_id = (select private.current_partner_organization_id()))
  );
create policy case_partnership_agreements_update_admin on public.case_partnership_agreements
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy partner_revenue_allocations_select on public.partner_revenue_allocations for select to authenticated
  using ((select private.is_admin()) or private.partner_admin_owns_agreement(case_partnership_agreement_id));
create policy partner_revenue_allocations_insert_admin on public.partner_revenue_allocations
  for insert to authenticated with check ((select private.is_admin()));

create policy partner_transfers_select on public.partner_transfers for select to authenticated
  using (
    (select private.is_admin())
    or ((select private.is_partner_admin())
        and partner_organization_id = (select private.current_partner_organization_id()))
  );
create policy partner_transfers_insert_admin on public.partner_transfers for insert to authenticated
  with check ((select private.is_admin()));
create policy partner_transfers_update_admin on public.partner_transfers for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy partner_transfer_items_select on public.partner_transfer_items for select to authenticated
  using ((select private.is_admin()) or private.partner_admin_owns_transfer(transfer_id));
create policy partner_transfer_items_insert_admin on public.partner_transfer_items for insert to authenticated
  with check ((select private.is_admin()));

-- ───────────────────────────── DG Brasil ──────────────────────────────────
-- Agentes, Skills, Teses, Referências e execuções: só ADMIN (e o worker, via
-- service role).

do $$
declare
  t text;
begin
  foreach t in array array[
    'agents', 'agent_versions', 'skills', 'skill_versions', 'agent_skill_bindings',
    'legal_theses', 'legal_thesis_versions', 'agent_thesis_bindings',
    'reference_materials', 'reference_material_versions',
    'agent_reference_bindings', 'skill_reference_bindings', 'thesis_reference_bindings',
    'agent_runs', 'import_jobs', 'import_row_results', 'audit_events']
  loop
    execute format($p$
      create policy %1$I on public.%2$I for select to authenticated
        using ((select private.is_admin()))$p$, t || '_select_admin', t);
  end loop;

  foreach t in array array[
    'agents', 'agent_versions', 'skills', 'skill_versions', 'agent_skill_bindings',
    'legal_theses', 'legal_thesis_versions', 'agent_thesis_bindings',
    'reference_materials', 'reference_material_versions',
    'agent_reference_bindings', 'skill_reference_bindings', 'thesis_reference_bindings',
    'agent_runs', 'import_jobs']
  loop
    execute format($p$
      create policy %1$I on public.%2$I for insert to authenticated
        with check ((select private.is_admin()))$p$, t || '_insert_admin', t);
  end loop;

  foreach t in array array[
    'agents', 'skills', 'agent_skill_bindings', 'legal_theses', 'agent_thesis_bindings',
    'reference_materials', 'agent_reference_bindings', 'skill_reference_bindings',
    'thesis_reference_bindings', 'agent_runs', 'import_jobs']
  loop
    execute format($p$
      create policy %1$I on public.%2$I for update to authenticated
        using ((select private.is_admin())) with check ((select private.is_admin()))$p$, t || '_update_admin', t);
  end loop;
end
$$;

-- Propostas: o advogado que revisa precisa ler. Aplicar é do backend/ADMIN.
create policy agent_proposals_select on public.agent_proposals for select to authenticated
  using ((select private.has_internal_role('ADMIN', 'LAWYER')));
create policy agent_proposals_update_admin on public.agent_proposals for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- ───────────────────────────── integrações ────────────────────────────────

create policy integration_connections_select on public.integration_connections for select to authenticated
  using ((select private.has_internal_role('ADMIN', 'LAWYER')));
create policy integration_connections_insert on public.integration_connections for insert to authenticated
  with check ((select private.is_admin()));
create policy integration_connections_update on public.integration_connections for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy judicial_monitors_select on public.judicial_monitors for select to authenticated
  using ((select private.has_internal_role('ADMIN', 'LAWYER')));
create policy judicial_monitors_insert on public.judicial_monitors for insert to authenticated
  with check ((select private.is_admin()));
create policy judicial_monitors_update on public.judicial_monitors for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy external_document_exports_select on public.external_document_exports for select to authenticated
  using ((select private.has_internal_role('ADMIN', 'LAWYER')));

-- A view de aprovação usa security_invoker: herda as políticas acima.
grant select on public.document_version_approvals to authenticated;
