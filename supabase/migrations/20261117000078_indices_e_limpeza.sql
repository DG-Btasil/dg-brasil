-- 078 · Ajustes da revisão do banco antes do lançamento (17/11/2026).
--
-- Nada aqui muda regra de negócio, permissão ou assinatura de função: são
-- índices, uma rotina de limpeza e acabamento.
--
--   1. Índices para as consultas por processo e pelo responsável, que hoje
--      leem a tabela inteira;
--   2. CPF de escritório parceiro passa a ser único, como o CNPJ já era;
--   3. updated_at automático nas quatro tabelas de configuração que só o
--      atualizavam quando a função lembrava;
--   4. Limpeza diária dos dados operacionais com mais de 120 dias
--      (private.operational_housekeeping, agendada como dg-limpeza-operacional).
--      A linha do tempo das execuções NÃO entra: é o histórico do trabalho;
--   5. Auditoria e acessos a dados pessoais (LGPD) ficam guardados por 5 anos
--      (private.audit_retention_housekeeping, na mesma rotina diária). Decisão
--      da dona do escritório em 17/11/2026;
--   6. Descrição (comment) nas tabelas que não tinham.

-- ═════════════════════════════ 1. índices ════════════════════════════════

-- Prazos do processo (tela do processo, agenda, agentes): só havia por caso.
create index if not exists deadlines_process_idx
  on public.deadlines (legal_process_id, due_at) where legal_process_id is not null;

-- Revisões filtradas por processo.
create index if not exists reviews_process_idx
  on public.reviews (legal_process_id) where legal_process_id is not null;

-- "Qual análise é desta execução?": perguntado a cada mudança de estado de
-- execução (gatilhos de sincronia e de aviso) e pelas portas do executor.
create index if not exists legal_analyses_agent_run_idx
  on public.legal_analyses (agent_run_id) where agent_run_id is not null;

-- Processos por responsável (filtro da lista de processos).
create index if not exists legal_processes_responsible_idx
  on public.legal_processes (responsible_user_id) where responsible_user_id is not null;

-- ═════════════════════════════ 2. CPF de parceiro único ══════════════════

-- Mesmo critério de organizations_cnpj_key. Se o banco já tiver dois
-- escritórios ativos com o mesmo CPF (dado de teste), a migration não falha:
-- avisa, e o índice fica para depois de corrigir o cadastro.
do $$
begin
  if exists (select 1 from public.organizations
              where cpf is not null and deleted_at is null
              group by cpf having count(*) > 1) then
    raise warning 'organizations_cpf_key NÃO foi criado: há escritórios ativos com o mesmo CPF. Corrija e rode: create unique index organizations_cpf_key on public.organizations (cpf) where cpf is not null and deleted_at is null;';
  else
    create unique index if not exists organizations_cpf_key
      on public.organizations (cpf) where cpf is not null and deleted_at is null;
  end if;
end
$$;

-- ═════════════════════════════ 3. updated_at automático ══════════════════

drop trigger if exists ai_runtime_settings_set_updated_at on public.ai_runtime_settings;
create trigger ai_runtime_settings_set_updated_at
  before update on public.ai_runtime_settings
  for each row execute function private.set_updated_at();

drop trigger if exists judicial_settings_set_updated_at on public.judicial_settings;
create trigger judicial_settings_set_updated_at
  before update on public.judicial_settings
  for each row execute function private.set_updated_at();

drop trigger if exists judicial_monitor_status_set_updated_at on public.judicial_monitor_status;
create trigger judicial_monitor_status_set_updated_at
  before update on public.judicial_monitor_status
  for each row execute function private.set_updated_at();

drop trigger if exists process_task_settings_set_updated_at on public.process_task_settings;
create trigger process_task_settings_set_updated_at
  before update on public.process_task_settings
  for each row execute function private.set_updated_at();

-- ═════════════════════════════ 4. guarda de 5 anos ═══════════════════════

-- audit_events e personal_data_access_events são só-acréscimo: o gatilho
-- private.prevent_mutation recusa DELETE de qualquer papel da API e só deixa
-- passar com dg.allow_physical_delete = 'on'. Esta função é a ÚNICA que liga a
-- chave, só enquanto apaga o que passou do prazo, e desliga em seguida.
-- O prazo nunca é menor que 5 anos, mesmo que alguém passe um intervalo menor.
-- Quando apaga alguma coisa, deixa o registro AUDIT_RETENTION_PURGED na própria
-- auditoria, só com as contagens e a data de corte.
create or replace function private.audit_retention_housekeeping(p_keep interval default interval '5 years')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cut    timestamptz := now() - greatest(coalesce(p_keep, interval '5 years'), interval '5 years');
  v_audit  bigint := 0;
  v_access bigint := 0;
begin
  perform set_config('dg.allow_physical_delete', 'on', true);
  begin
    delete from public.audit_events a where a.created_at < v_cut;
    get diagnostics v_audit = row_count;
    delete from public.personal_data_access_events e where e.created_at < v_cut;
    get diagnostics v_access = row_count;
  exception when others then
    perform set_config('dg.allow_physical_delete', 'off', true);
    raise;
  end;
  perform set_config('dg.allow_physical_delete', 'off', true);

  if v_audit + v_access > 0 then
    insert into public.audit_events (actor_type, action, entity_type, metadata)
    values ('SYSTEM', 'AUDIT_RETENTION_PURGED', 'audit_events',
            jsonb_build_object('cutoff', v_cut, 'audit_events', v_audit, 'personal_data_access_events', v_access));
  end if;
  return jsonb_build_object('cutoff', v_cut, 'audit_events', v_audit, 'personal_data_access_events', v_access);
end
$$;

comment on function private.audit_retention_housekeeping(interval) is
  'Guarda de 5 anos da auditoria e dos acessos a dados pessoais: apaga o que passou do prazo (nunca menos de 5 anos) e registra AUDIT_RETENTION_PURGED. Única função que apaga dessas tabelas.';

revoke all on function private.audit_retention_housekeeping(interval) from public, anon, authenticated, service_role;

-- ═════════════════════════════ 4b. limpeza operacional ═══════════════════

-- Apaga o que é operacional e já não serve a ninguém depois de 120 dias:
--   notifications            avisos do sino (lidos ou não);
--   idempotency_operations   chaves de "não repetir o mesmo comando";
--   executor_wake_requests   pedidos de "Verificar agora" já atendidos ou vencidos;
--   judicial_sync_runs       rodadas terminadas da busca judicial;
--   pgmq.a_agent_execution   arquivo morto da fila dos agentes.
-- Nunca menos de 30 dias, mesmo que alguém passe um intervalo menor. Cada
-- tabela é independente: falha numa não impede as outras, e o resumo devolvido
-- diz o que aconteceu. No fim chama a guarda de 5 anos da auditoria (seção 4),
-- que tem prazo próprio e não recebe o intervalo daqui.
create or replace function private.operational_housekeeping(p_keep interval default interval '120 days')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cut    timestamptz := now() - greatest(coalesce(p_keep, interval '120 days'), interval '30 days');
  v_n      bigint;
  v_result jsonb := jsonb_build_object('cutoff', v_cut);
  v_errors text[] := '{}';
begin
  begin
    delete from public.notifications n where n.created_at < v_cut;
    get diagnostics v_n = row_count;
    v_result := v_result || jsonb_build_object('notifications', v_n);
  exception when others then
    v_errors := v_errors || ('notifications: ' || left(sqlerrm, 200));
  end;

  begin
    delete from private.idempotency_operations o where o.created_at < v_cut;
    get diagnostics v_n = row_count;
    v_result := v_result || jsonb_build_object('idempotency_operations', v_n);
  exception when others then
    v_errors := v_errors || ('idempotency_operations: ' || left(sqlerrm, 200));
  end;

  begin
    delete from public.executor_wake_requests w where w.requested_at < v_cut and w.status <> 'PENDING';
    get diagnostics v_n = row_count;
    v_result := v_result || jsonb_build_object('executor_wake_requests', v_n);
  exception when others then
    v_errors := v_errors || ('executor_wake_requests: ' || left(sqlerrm, 200));
  end;

  begin
    delete from public.judicial_sync_runs r where r.started_at < v_cut and r.status <> 'RUNNING';
    get diagnostics v_n = row_count;
    v_result := v_result || jsonb_build_object('judicial_sync_runs', v_n);
  exception when others then
    v_errors := v_errors || ('judicial_sync_runs: ' || left(sqlerrm, 200));
  end;

  begin
    if to_regclass('pgmq.a_agent_execution') is not null then
      execute 'delete from pgmq.a_agent_execution where archived_at < $1' using v_cut;
      get diagnostics v_n = row_count;
      v_result := v_result || jsonb_build_object('queue_archive', v_n);
    end if;
  exception when others then
    v_errors := v_errors || ('queue_archive: ' || left(sqlerrm, 200));
  end;

  begin
    v_result := v_result || jsonb_build_object('audit_retention', private.audit_retention_housekeeping());
  exception when others then
    v_errors := v_errors || ('audit_retention: ' || left(sqlerrm, 200));
  end;

  if cardinality(v_errors) > 0 then
    v_result := v_result || jsonb_build_object('errors', to_jsonb(v_errors));
  end if;
  return v_result;
end
$$;

comment on function private.operational_housekeeping(interval) is
  'Limpeza diária dos dados operacionais com mais de 120 dias (avisos, idempotência, pedidos de "Verificar agora", rodadas judiciais, arquivo da fila). No fim chama a guarda de 5 anos da auditoria. Não toca a linha do tempo das execuções.';

revoke all on function private.operational_housekeeping(interval) from public, anon, authenticated, service_role;

-- 06:37 UTC = 03:37 de Brasília, todo dia (depois das outras limpezas).
do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('dg-limpeza-operacional', '37 6 * * *', 'select private.operational_housekeeping()');
  else
    raise notice 'pg_cron indisponível: agende private.operational_housekeeping() uma vez por dia';
  end if;
end
$$;

-- ═════════════════════════════ 6. descrição das tabelas ══════════════════

-- Organizações, pessoas e acesso
comment on table public.organization_memberships is 'Vínculo de uma pessoa com um escritório e o papel dela (ADMIN, LAWYER, ASSISTANT, PARTNER_ADMIN, PARTNER_USER). Base de toda a RLS.';
comment on table public.owner_office_settings is 'Dados próprios do escritório proprietário (advogada principal, OAB, estados de atuação, unidades).';
comment on table public.user_invitations is 'Convites para entrar no sistema. Criados só pelo servidor; aceite idempotente.';
comment on table public.user_legal_acceptances is 'Aceite dos termos por pessoa e versão. Só acrescenta.';
comment on table public.user_preferences is 'Preferências da pessoa na interface (inclui a introdução do produto já vista).';

-- Clientes
comment on table public.clients is 'Cliente (pessoa física ou jurídica). CPF e CNPJ únicos; os dados de cada tipo ficam em individual_client_details ou company_client_details.';
comment on table public.individual_client_details is 'Dados do cliente pessoa física (1:1 com clients).';
comment on table public.company_client_details is 'Dados do cliente pessoa jurídica (1:1 com clients).';
comment on table public.company_representatives is 'Representantes legais do cliente pessoa jurídica.';
comment on table public.company_shareholders is 'Sócios do cliente pessoa jurídica.';
comment on table public.client_contacts is 'Telefones e e-mails do cliente.';
comment on table public.client_addresses is 'Endereços do cliente.';
comment on table public.client_organization_relationships is 'Quais escritórios parceiros têm relacionamento com o cliente. É o que dá ao parceiro a leitura do cadastro.';

-- Catálogo jurídico
comment on table public.legal_areas is 'Catálogo: áreas do direito.';
comment on table public.case_types is 'Catálogo: tipos de caso dentro de cada área.';
comment on table public.document_categories is 'Catálogo: categorias de documento (vocabulário único com o painel).';
comment on table public.fee_models is 'Catálogo: modelos de honorários que servem de base aos contratos.';

-- Casos
comment on table public.legal_cases is 'Caso do cliente (o atendimento, antes e além do processo judicial). Status segue a máquina de estados do README.';
comment on table public.case_document_requirements is 'Documentos que o caso precisa e a situação de cada um (faltando, pedido, recebido, aprovado, recusado).';
comment on table public.case_documents is 'Vínculo documento ↔ caso. É o que torna o documento visível ao parceiro do caso.';
comment on table public.case_partnership_agreements is 'Retrato imutável da divisão com o parceiro, tirado no aceite do caso. Um ativo por caso.';

-- Documentos
comment on table public.documents is 'Documento lógico do cliente. O arquivo de cada versão fica no Storage (document_versions).';
comment on table public.document_versions is 'Versão de um documento: aponta o arquivo no Storage. Imutável.';
comment on table public.document_version_verifications is 'Conferência do arquivo de uma versão (VERIFIED/FAILED). Só acrescenta; versão nova nunca herda.';
comment on table public.process_documents is 'Vínculo documento ↔ processo.';

-- Processos
comment on table public.legal_processes is 'Processo judicial de um caso. CNJ único; case_value é o valor da causa, nunca honorário.';
comment on table public.process_parties is 'Partes do processo (polo e qualificação).';
comment on table public.process_events is 'Andamentos do processo, manuais ou vindos da integração judicial.';
comment on table public.process_external_refs is 'Identificação do processo nos sistemas externos (DataJud) e o estado da última consulta.';
comment on table public.deadlines is 'Prazos do caso ou do processo. "Atrasado" não é gravado: é OPEN com vencimento no passado (view deadline_status).';
comment on table public.court_calendar_days is 'Feriados e dias sem expediente, para a contagem de prazo em dias úteis.';

-- Análises e revisões
comment on table public.analysis_templates is 'Modelos de análise jurídica: o agente principal e a sequência dos próximos.';
comment on table public.analysis_template_fields is 'Campos que o modelo de análise pede a quem inicia.';
comment on table public.analysis_template_requirements is 'Documentos que o modelo de análise exige.';
comment on table public.analysis_template_skill_bindings is 'Skills ligadas ao modelo de análise.';
comment on table public.analysis_template_thesis_bindings is 'Teses ligadas ao modelo de análise.';
comment on table public.legal_analyses is 'Análise jurídica de um caso, feita por um agente a partir de um modelo.';
comment on table public.reviews is 'Fila de Revisões: o que o agente produziu e uma pessoa precisa decidir. O status só muda por review_decisions.';
comment on table public.review_decisions is 'Decisão humana sobre uma revisão. Só acrescenta; é a única porta que muda o status da revisão.';

-- Parceiros
comment on table public.partner_requests is 'Pendências abertas pelo escritório para o parceiro resolver (documento, informação).';
comment on table public.partner_request_messages is 'Respostas trocadas numa pendência. Só acrescenta.';

-- Financeiro
comment on table public.financial_agreements is 'Contrato de honorários. Ciclo DRAFT → ACTIVE → COMPLETED/CANCELLED; os termos congelam ao ativar.';
comment on table public.payments is 'Parcela a receber (obrigação). Não guarda valor pago nem status: isso vem de payment_receipts.';
comment on table public.payment_receipts is 'Livro-razão dos recebimentos. Só acrescenta: recebimento (+), estorno (−) e ajuste. Corrigir é lançar de novo.';
comment on table public.partner_revenue_allocations is 'Divisão de cada lançamento entre escritório e parceiro, gerada pelo banco com o percentual congelado.';
comment on table public.partner_transfers is 'Repasses ao parceiro (PENDING → PAID/CANCELLED).';
comment on table public.partner_transfer_items is 'Quais divisões cada repasse quita.';

-- Agentes (DG Brasil)
comment on table public.agents is 'Agentes de IA cadastrados. O conteúdo de cada um fica em agent_versions.';
comment on table public.agent_versions is 'Versão de um agente: orientações e configuração. Só quem vê o setup lê.';
comment on table public.agent_skill_bindings is 'Skills que o agente usa.';
comment on table public.agent_thesis_bindings is 'Teses que o agente usa.';
comment on table public.agent_reference_bindings is 'Materiais de referência que o agente usa.';
comment on table public.skills is 'Skills (procedimentos) disponíveis para os agentes.';
comment on table public.skill_versions is 'Versão de uma skill.';
comment on table public.skill_provider_versions is 'Publicação de uma versão de skill no provedor de IA.';
comment on table public.skill_reference_bindings is 'Materiais de referência ligados à skill.';
comment on table public.legal_theses is 'Teses jurídicas do escritório.';
comment on table public.legal_thesis_versions is 'Versão de uma tese.';
comment on table public.thesis_skill_bindings is 'Skills ligadas à tese.';
comment on table public.thesis_reference_bindings is 'Materiais de referência ligados à tese.';
comment on table public.reference_materials is 'Materiais de referência (modelos, jurisprudência) usados pelos agentes.';
comment on table public.reference_material_versions is 'Versão de um material de referência; o arquivo fica no Storage.';
comment on table public.agent_runs is 'Execução de um agente: do pedido ao resultado. Entra só por request_agent_run.';
comment on table public.agent_proposals is 'O que o agente propõe mudar no sistema. Só é aplicado depois de aprovado em Revisões.';

-- Integrações e importação
comment on table public.integration_connections is 'Conexões com serviços externos (Google Drive, DJEN, DataJud). Segredo nunca fica aqui.';
comment on table public.external_document_imports is 'Arquivos trazidos da pasta externa do cliente, para não importar duas vezes.';
comment on table public.external_document_exports is 'Fila e registro do que foi enviado à pasta externa do cliente.';
comment on table public.judicial_monitors is 'OABs e termos acompanhados na busca de publicações.';
comment on table public.judicial_monitor_status is 'Estado da última leitura de cada acompanhamento judicial.';
comment on table public.judicial_sync_runs is 'Rodadas da busca judicial. As terminadas há mais de 120 dias são apagadas (private.operational_housekeeping).';
comment on table public.import_jobs is 'Importações de planilha, do envio à conclusão.';
comment on table public.import_column_mappings is 'De qual coluna da planilha vem cada campo.';
comment on table public.import_conflicts is 'Linhas que batem com cadastro existente e esperam decisão.';
comment on table public.import_row_results is 'Resultado da importação linha a linha. A linha bruta é apagada depois do job.';

-- Avisos, auditoria e LGPD
comment on table public.notifications is 'Avisos do sino, escritos só por private.notify. Apagados depois de 120 dias (private.operational_housekeeping).';
comment on table public.audit_events is 'Trilha de auditoria. Só acrescenta, gravada por gatilho na mesma transação. Guardada por 5 anos (private.audit_retention_housekeeping).';
comment on table public.personal_data_access_events is 'Quem acessou dado pessoal de qual titular (LGPD). Só acrescenta. Guardada por 5 anos (private.audit_retention_housekeeping).';
