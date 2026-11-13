-- 058 · Publicações e andamentos do processo para os agentes; agente de prazos
--       no kit.
--
-- O DG Brasil busca sozinho, todo dia, as publicações do DJEN e os andamentos
-- do DataJud de cada processo cadastrado (043). Os agentes do computador do
-- escritório não recebiam nada disso: liam só os documentos do caso e o
-- cadastro. O conector de publicações do escritório não serve aqui (mostraria
-- dados de outros clientes). Agora o que o DG Brasil já guarda chega ao agente
-- pela porta de sempre, presa ao caso do trabalho:
--
--   1. private.worker_get_process (018) devolve também "publicacoes": as
--      publicações do DJEN DAQUELE processo (judicial_publications, 043), da
--      mais nova para a mais antiga, no máximo 10. Cada uma com:
--        disponibilizada_em  data de disponibilização no DJEN;
--        publicada_em        data da publicação. A tabela não guarda essa data:
--                            é CALCULADA como na 043 (1º dia útil depois da
--                            disponibilização, private.next_business_day), com
--                            a mesma ressalva: feriado local não cadastrado em
--                            court_calendar_days não é descontado;
--        tipo, orgao, link;
--        teor                cortado em 6.000 caracteres (a íntegra fica no link);
--        teor_cortado        true quando o teor foi cortado;
--        cancelada           true quando o tribunal cancelou a comunicação.
--                            Publicação cancelada vai SEM o teor (teor nulo):
--                            o agente só fica sabendo que ela foi cancelada.
--      Nada mais muda na função: o processo continua tendo de ser do caso da
--      execução, e as movimentações (process_events, onde entram os andamentos
--      do DataJud) saem como antes. private.executor_get_process (040), a porta
--      do computador do escritório, chama esta função e não precisa mudar. O
--      conector (1.3.2) grava isso na pasta do cliente, em PROCESSO_<CNJ>.txt.
--   2. Kit (054): o agente de prazos entra cadastrado, como os outros:
--      intimacao-dg, "Diana · Prazos das publicações". Nunca sobrescreve: se o
--      identificador (slug) já existe, fica como está.
--   3. AUTOMÁTICO (decisão da dona: deixar a esteira mais automática): se a
--      integração judicial ainda não tem "agente que propõe prazos"
--      (judicial_settings.deadline_agent_id, 043), ele passa a ser a Diana do
--      kit. A partir daí toda publicação nova de processo cadastrado vira, sem
--      ninguém pedir, um trabalho para ela (private.judicial_request_deadline_proposal,
--      043), e a proposta de prazo chega em Revisões: o prazo só existe depois
--      que um advogado aprova.
--        - já havia um agente escolhido: não mexe;
--        - a Diana não está ativa (alguém pausou ou arquivou o agente desse
--          identificador): não mexe;
--        - quem "pede" o trabalho continua sendo o responsável do processo ou
--          o advogado do caso (043). Como esta escolha não foi feita por uma
--          pessoa, judicial_settings.updated_by fica como estava: processo sem
--          advogado ativo continua na triagem da equipe;
--        - o trabalho só roda com a execução ligada e o computador do
--          escritório com o agente intimacao-dg instalado; sem isso, fica na fila;
--        - para desligar: DG Brasil → Integrações → Agente que propõe prazos →
--          "Nenhum (a equipe trata)".
--   4. O pedido que o banco monta para o agente de prazos
--      (private.judicial_request_deadline_proposal, 043) não dizia de que lado
--      o cliente está, e sem isso não dá para dizer se a publicação abre prazo
--      PARA O NOSSO CLIENTE. Logo depois da linha do tipo, o pedido ganha:
--        Nosso cliente: <nome> · polo <ativo|passivo|terceiro> (do cadastro do processo)
--        Parte contrária: <nome>          (só quando o processo tem)
--      O nome é o do cliente do caso; o polo é legal_processes.client_side e a
--      parte contrária é legal_processes.adverse_party_summary (cada um em uma
--      linha, até 100 caracteres). Processo sem polo no cadastro: "polo não
--      informado". Nada mais muda na função.
--
-- 001–057 não são alteradas.

-- ═════════════════════════════ 1. o processo para o agente ════════════════

-- Um processo do caso da execução (018), agora com as publicações do DJEN.
-- Nada mais muda.
create or replace function private.worker_get_process(
  p_agent_run_id uuid, p_worker text, p_legal_process_id uuid, p_events integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope record;
begin
  select * into v_scope from private.worker_scope(p_agent_run_id, p_worker);
  if v_scope.legal_case_id is null then
    return null;
  end if;
  return (
    select jsonb_build_object(
      'id', p.id, 'legal_case_id', p.legal_case_id, 'cnj_number', p.cnj_number, 'status', p.status,
      'court', p.court, 'court_unit', p.court_unit, 'district', p.district, 'state', p.state,
      'legal_class', p.legal_class, 'subject', p.subject, 'client_side', p.client_side,
      'case_value', p.case_value, 'distribution_date', p.distribution_date,
      'partes', coalesce((select jsonb_agg(jsonb_build_object('tipo', pp.party_type, 'nome', pp.name))
                          from public.process_parties pp where pp.legal_process_id = p.id), '[]'::jsonb),
      'movimentacoes', coalesce((select jsonb_agg(e order by e.occurred_at desc)
                                 from (select ev.event_type, ev.description, ev.occurred_at, ev.source
                                       from public.process_events ev where ev.legal_process_id = p.id
                                       order by ev.occurred_at desc
                                       limit least(greatest(coalesce(p_events, 50), 1), 200)) e), '[]'::jsonb),
      'publicacoes', coalesce((select jsonb_agg(jsonb_build_object(
                                   'disponibilizada_em', pb.available_on,
                                   'publicada_em', private.next_business_day(pb.available_on, pb.court),
                                   'tipo', pb.communication_type, 'orgao', pb.organ, 'link', pb.link,
                                   'cancelada', pb.cancelled_at is not null,
                                   'teor', case when pb.cancelled_at is null then left(pb.content, 6000) end,
                                   'teor_cortado', pb.cancelled_at is null and length(pb.content) > 6000)
                                 order by pb.available_on desc, pb.captured_at desc, pb.id)
                               from (select jp.id, jp.available_on, jp.captured_at, jp.court, jp.communication_type,
                                            jp.organ, jp.link, jp.cancelled_at, jp.content
                                     from public.judicial_publications jp
                                     where jp.legal_process_id = p.id and jp.provider = 'DJEN'
                                     order by jp.available_on desc, jp.captured_at desc, jp.id
                                     limit 10) pb), '[]'::jsonb))
    from public.legal_processes p
    where p.id = p_legal_process_id and p.legal_case_id = v_scope.legal_case_id and p.deleted_at is null
  );
end
$$;

-- ═════════════════════════════ 2 e 3. agente de prazos ════════════════════

do $$
declare
  v_slug constant text := 'intimacao-dg';
  v_id uuid;
  v_version uuid;
  v_agent uuid;
begin
  -- Kit (054): nunca sobrescreve nem duplica. Fica como está o agente com o mesmo
  -- identificador e também o que alguém cadastrou pelo site apontando para o
  -- mesmo agente do computador (o site gera outro identificador a partir do nome).
  if not exists (select 1 from public.agents a
                 left join public.agent_versions v on v.id = a.current_version_id
                 where a.slug = v_slug
                    or (a.deleted_at is null and v.configuration ->> 'local_agent' = v_slug)) then
    v_id := gen_random_uuid();
    insert into public.agents (id, slug, name, description, purpose, status)
    values (v_id, v_slug, 'Diana · Prazos das publicações',
            'Lê cada publicação nova do DJEN, diz se abre prazo para o cliente e propõe o prazo, com a contagem e o agente que faz a peça.',
            'Nenhum prazo sem dono: toda publicação vira um prazo proposto ou um ''sem prazo'' para a equipe conferir.',
            'DRAFT');
    insert into public.agent_versions (agent_id, instructions, configuration)
    values (v_id,
            concat_ws(E'\n',
              'Como entregar no DG Brasil:',
              '- O agente termina a resposta com um bloco PROPOR (tipo, resumo, dados). Chame a ferramenta propor UMA vez, exatamente com esses dados.',
              '- Nunca escreva ao cliente nem diga que algo foi protocolado: o prazo só vale depois que um advogado aprovar em Revisões.'),
            jsonb_build_object('local_agent', v_slug))
    returning id into v_version;
    update public.agents set current_version_id = v_version, status = 'ACTIVE' where id = v_id;
    raise notice 'Agente de prazos cadastrado (%)', v_slug;
  end if;

  -- Integração judicial: a Diana do kit propõe os prazos, se ninguém foi
  -- escolhido ainda. Já havia um agente escolhido: não mexe.
  select a.id into v_agent
    from public.agents a
    left join public.agent_versions v on v.id = a.current_version_id
   where (a.slug = v_slug or v.configuration ->> 'local_agent' = v_slug)
     and a.status = 'ACTIVE' and a.deleted_at is null
   order by (a.slug = v_slug) desc, a.created_at
   limit 1;
  update public.judicial_settings s
     set deadline_agent_id = v_agent, updated_at = now()
   where s.id and s.deadline_agent_id is null and v_agent is not null;
  if found then
    raise notice 'Integração judicial: o agente % passa a propor os prazos das publicações', v_slug;
  end if;
end
$$;

-- ═════════════════════════════ 4. o pedido de prazo ═══════════════════════

-- Pedido de proposta de prazo de UMA publicação (043), agora dizendo quem é o
-- nosso cliente, o polo dele e a parte contrária. Nada mais muda.
create or replace function private.judicial_request_deadline_proposal(p_publication_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s     public.judicial_settings;
  v_p     public.judicial_publications;
  v_proc  record;
  v_actor uuid;
  v_run   uuid;
  v_dates jsonb;
  v_list  text;
  v_side  text;
begin
  select * into v_s from public.judicial_settings where id;
  if v_s.deadline_agent_id is null then
    return null;
  end if;
  select * into v_p from public.judicial_publications where id = p_publication_id;
  select lp.id, lp.legal_case_id, lp.title, lp.responsible_user_id, c.assigned_lawyer_id,
         lp.client_side, lp.adverse_party_summary,
         coalesce((select i.full_name from public.individual_client_details i where i.client_id = c.client_id),
                  (select co.legal_name from public.company_client_details co where co.client_id = c.client_id)) as client_name
    into v_proc
  from public.legal_processes lp join public.legal_cases c on c.id = lp.legal_case_id
  where lp.id = v_p.legal_process_id and lp.deleted_at is null and c.deleted_at is null;
  if v_proc.id is null then
    return null;
  end if;
  select u into v_actor from unnest(array[v_proc.responsible_user_id, v_proc.assigned_lawyer_id, v_s.updated_by]) with ordinality t(u, o)
  where u is not null and private.is_active_internal_user(u) and private.user_internal_role(u) in ('ADMIN', 'LAWYER')
  order by o limit 1;
  if v_actor is null then
    update public.judicial_publications set agent_error = 'Nenhum advogado ativo para pedir a proposta ao agente.' where id = p_publication_id;
    return null;
  end if;

  v_dates := private.judicial_deadline_dates(v_p.available_on, v_p.court, 15, 30);
  -- O executor mostra ao agente o TEXTO do pedido: a contagem vai nele.
  select string_agg('  dia ' || t.n || ': ' || to_char(t.d::date, 'DD/MM/YYYY'), E'\n' order by t.n) into v_list
  from jsonb_array_elements_text(v_dates -> 'list') with ordinality t(d, n);
  -- De que lado o cliente está (058): nome do cliente do caso, polo e parte
  -- contrária do cadastro do processo, cada um em uma linha.
  v_side := 'Nosso cliente: '
    || coalesce(nullif(left(btrim(regexp_replace(coalesce(v_proc.client_name, ''), '\s+', ' ', 'g')), 100), ''), 'sem nome no cadastro')
    || ' · ' || case v_proc.client_side when 'ACTIVE' then 'polo ativo' when 'PASSIVE' then 'polo passivo'
                                        when 'THIRD_PARTY' then 'polo terceiro' else 'polo não informado' end
    || ' (do cadastro do processo)'
    || coalesce(E'\nParte contrária: ' || nullif(left(btrim(regexp_replace(v_proc.adverse_party_summary, '\s+', ' ', 'g')), 100), ''), '');
  begin
    v_run := private.request_agent_run(
      v_s.deadline_agent_id, v_proc.legal_case_id, v_proc.id,
      -- agent_run_inputs aceita até 20 mil caracteres; teor maior vai cortado
      -- (o agente lê a íntegra pelo link, se precisar).
      left('Publicação do DJEN no processo ' || private.format_cnj(v_p.cnj_number)
        || ' (' || coalesce(v_p.court, 'tribunal não informado') || coalesce(' — ' || v_p.organ, '')
        || '), disponibilizada em ' || to_char(v_p.available_on, 'DD/MM/YYYY')
        || ', publicada em ' || to_char((v_dates ->> 'published_on')::date, 'DD/MM/YYYY')
        || '. Tipo: ' || coalesce(v_p.communication_type, '—') || E'.\n'
        || v_side || E'\n\n'
        || 'O QUE FAZER: leia o teor e diga se ele abre prazo para o nosso cliente. Se abrir, chame a ferramenta propor '
        || 'UMA vez, tipo CREATE_DEADLINE, dados {title, due_at (ISO 8601, fim do dia do vencimento, -03:00), description '
        || '(fundamento legal e a contagem: quantos dias úteis e por quê), priority}. Se não houver prazo, chame propor '
        || 'tipo OTHER, resumo começando com "Sem prazo:" e o motivo em dados.description — quem decide é a equipe.' || E'\n\n'
        || 'DIAS ÚTEIS a partir da publicação (dia 1 = primeiro dia do prazo; já descontados fins de semana, feriados nacionais, '
        || 'Sexta-feira Santa, recesso de 20/12 a 20/01 e os dias cadastrados para o tribunal; feriado local não cadastrado '
        || 'NÃO está descontado — avise na descrição se suspeitar de um):' || E'\n' || coalesce(v_list, '(indisponível)')
        || coalesce(E'\n\nÍntegra: ' || v_p.link, '') || E'\n\nTEOR:\n' || v_p.content, 20000),
      jsonb_build_object('kind', 'JUDICIAL_PUBLICATION', 'publication_id', v_p.id, 'cnj', v_p.cnj_number,
                         'content_truncated', length(v_p.content) > 18000,
                         'court', v_p.court, 'available_on', v_p.available_on,
                         'published_on', v_dates -> 'published_on', 'first_day', v_dates -> 'first_day',
                         'business_days', v_dates -> 'list', 'skipped_days', v_dates -> 'skipped',
                         'calendar_note', v_dates -> 'note'),
      'EXECUTE', v_actor);
    update public.judicial_publications set agent_run_id = v_run, triage_status = 'WITH_AGENT', agent_error = null
    where id = p_publication_id and triage_status = 'PENDING';
  exception when others then
    update public.judicial_publications set agent_error = left('Agente não acionado: ' || sqlerrm, 500) where id = p_publication_id;
    v_run := null;
  end;
  -- request_agent_run fixa o ator da transação: limpa para os próximos avisos.
  perform set_config('dg.actor_user_id', '', true);
  return v_run;
end
$$;
