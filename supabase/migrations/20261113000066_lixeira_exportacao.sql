-- 066 · Lixeira (restaurar o que foi excluído), número CNJ de processo excluído
--       e registro de exportação de planilha.
--
-- Achados da revisão final:
--   a) Excluir cliente, processo ou documento é exclusão lógica (deleted_at) e
--      não existia "restaurar" em lugar nenhum: o que saía não voltava.
--   b) O processo excluído continuava dono do número CNJ (índice único da 008):
--      cadastrado no caso errado e excluído, não dava para cadastrar de novo no
--      caso certo, e as publicações desse número passavam a contar como "fora do
--      DG Brasil" (043).
--   c) Não havia exportação nenhuma, logo nenhuma trilha de quem exportou o quê.
--
-- O que esta migration faz:
--
--   1. NÚMERO CNJ DE PROCESSO EXCLUÍDO. Os índices únicos NÃO viram parciais.
--      Motivo: funções de outros domínios supõem "no máximo UMA linha por
--      CPF/CNPJ e por CNJ, contando as excluídas" — a simulação e a gravação da
--      importação de planilhas (042: itens a, b e import_apply_row), a consulta
--      e o envio de caso do parceiro (025/045: partner_lookup_client e
--      partner_submit_case). Com índice parcial, um registro ativo e outro
--      excluído com o mesmo número fariam essas funções escolher uma linha ao
--      acaso (e a importação recusar o registro ativo com "restaure antes").
--      Em vez disso, a regra "uma linha por número" continua valendo e o número
--      MUDA DE LUGAR: quando alguém cadastra (ou corrige) um processo com o CNJ
--      de um processo EXCLUÍDO, o excluído solta o número (cnj_number vira NULL
--      e o número fica guardado em released_cnj_number, só para exibir e para
--      restaurar) e o acompanhamento no DataJud passa para o processo novo.
--      As funções da 008, 042 e 043 não mudam.
--        - As movimentações e publicações que o excluído já tinha ficam com ele
--          (são identificadas por um código único do tribunal e não são
--          copiadas): o cadastro novo recebe o que chegar dali em diante.
--        - CPF/CNPJ de cliente NÃO muda de lugar: "um CPF/CNPJ = um cliente"
--          (004) continua; o caminho é restaurar o cadastro (item 2).
--   2. RESTAURAR (só ADMIN, sessão liberada): restore_client, restore_process e
--      restore_document. Cada uma confere e recusa com frase clara:
--        - já existe outro registro ATIVO com o mesmo CPF/CNPJ ou número CNJ;
--        - o processo é de caso excluído ou de cliente que está na Lixeira;
--        - o documento é de cliente que está na Lixeira.
--      A exclusão não mexe em mais nada (casos, prazos, movimentações, versões
--      e arquivos ficam como estavam), então restaurar é só desfazer a marca:
--      prazos voltam às listas (deadline_status.scope_deleted, 026), o parceiro
--      volta a enxergar (RLS), a busca de publicações volta a achar o processo.
--      O processo que tinha soltado o número o recebe de volta, com o
--      acompanhamento no DataJud refeito.
--      Auditoria: CLIENT_RESTORED já sai do gatilho da 014; PROCESS_RESTORED e
--      DOCUMENT_RESTORED são gravados aqui (o gatilho só diz "atualizado").
--   3. LIXEIRA: trash_list devolve, para o ADMIN, os clientes, processos ou
--      documentos excluídos, com quem excluiu e quando (da auditoria), busca e
--      página no servidor, e o motivo quando não dá para restaurar.
--   4. EXPORTAÇÃO: record_data_export grava DATA_EXPORTED na auditoria (tipo da
--      lista, filtros e quantidade de linhas; nunca o conteúdo). Só ADMIN. Os
--      filtros são conferidos: nada de texto de busca, CPF/CNPJ ou e-mail.
--
-- Não há exclusão definitiva. Pode rodar de novo sem efeito.

-- ═════════════════════════════ 1. número CNJ de processo excluído ═════════

alter table public.legal_processes
  add column if not exists released_cnj_number public.cnj_digits;

comment on column public.legal_processes.released_cnj_number is
  'Número CNJ que este processo EXCLUÍDO tinha e soltou para outro cadastro (066). Só em processo excluído e sem cnj_number; volta para cnj_number ao restaurar.';

-- Processo de fonte oficial sempre tem CNJ (008); o excluído que soltou o
-- número continua válido porque o número está guardado.
alter table public.legal_processes drop constraint if exists legal_processes_official_has_cnj;
alter table public.legal_processes add constraint legal_processes_official_has_cnj check (
  technical_origin not in ('INTEGRATION', 'IMPORT') or cnj_number is not null
  or (deleted_at is not null and released_cnj_number is not null)
);

alter table public.legal_processes drop constraint if exists legal_processes_released_cnj_only_deleted;
alter table public.legal_processes add constraint legal_processes_released_cnj_only_deleted check (
  released_cnj_number is null or (deleted_at is not null and cnj_number is null)
);

-- Antes de gravar um processo ATIVO com CNJ: o processo EXCLUÍDO que ainda
-- segura esse número o solta. Dispara no cadastro, na troca de CNJ e na
-- restauração de quem tinha soltado o número. A referência do DataJud do
-- excluído sai (a chave dela é o número): o gatilho da 043 cria a do novo.
create or replace function private.legal_processes_cnj_release()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old record;
begin
  -- O número guardado só muda por aqui e por private.restore_process.
  if coalesce(current_setting('dg.cnj_release', true), '') <> '1'
     and ((tg_op = 'INSERT' and new.released_cnj_number is not null)
       or (tg_op = 'UPDATE' and new.released_cnj_number is distinct from old.released_cnj_number)) then
    raise exception 'O número guardado de um processo excluído não é editável' using errcode = '42501';
  end if;

  if new.cnj_number is null or new.deleted_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.cnj_number is not distinct from old.cnj_number then
    return new;
  end if;

  for v_old in
    select p.id from public.legal_processes p
    where p.cnj_number = new.cnj_number and p.deleted_at is not null and p.id <> new.id
    for update
  loop
    perform set_config('dg.cnj_release', '1', true);
    delete from public.process_external_refs r where r.legal_process_id = v_old.id and r.provider = 'DATAJUD';
    update public.legal_processes p
       set released_cnj_number = p.cnj_number, cnj_number = null
     where p.id = v_old.id;
    perform set_config('dg.cnj_release', '', true);
    perform private.record_audit_event('PROCESS_CNJ_RELEASED', 'legal_processes', v_old.id,
      jsonb_build_object('legal_process_id', new.id));
  end loop;
  return new;
end
$$;

drop trigger if exists legal_processes_cnj_release on public.legal_processes;
create trigger legal_processes_cnj_release
  before insert or update on public.legal_processes
  for each row execute function private.legal_processes_cnj_release();

-- ═════════════════════════════ 2. restaurar ═══════════════════════════════

create or replace function private.restore_client(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Somente o administrador restaura registros excluídos' using errcode = '42501';
  end if;
  select c.id, c.cpf, c.cnpj, c.deleted_at into v from public.clients c where c.id = p_id for update;
  if v.id is null then
    raise exception 'Cliente não encontrado' using errcode = 'P0002';
  end if;
  if v.deleted_at is null then
    raise exception 'Este cliente não está excluído' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.clients o
             where o.id <> p_id and o.deleted_at is null
               and ((v.cpf is not null and o.cpf = v.cpf) or (v.cnpj is not null and o.cnpj = v.cnpj))) then
    raise exception 'Já existe outro cliente ativo com este CPF/CNPJ. Use o cadastro ativo.' using errcode = '23505';
  end if;

  -- O gatilho da 014 grava CLIENT_RESTORED.
  update public.clients c set deleted_at = null where c.id = p_id;

  return jsonb_build_object(
    'id', p_id,
    'cases', (select count(*) from public.legal_cases k where k.client_id = p_id and k.deleted_at is null),
    'processes', (select count(*) from public.legal_processes p
                  join public.legal_cases k on k.id = p.legal_case_id
                  where k.client_id = p_id and k.deleted_at is null and p.deleted_at is null),
    'documents', (select count(*) from public.documents d where d.client_id = p_id and d.deleted_at is null),
    -- O que continua na Lixeira (foi excluído à parte, antes ou depois do cliente).
    'trashed_processes', (select count(*) from public.legal_processes p
                          join public.legal_cases k on k.id = p.legal_case_id
                          where k.client_id = p_id and p.deleted_at is not null),
    'trashed_documents', (select count(*) from public.documents d where d.client_id = p_id and d.deleted_at is not null));
end
$$;

create or replace function private.restore_process(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v     record;
  v_cnj text;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Somente o administrador restaura registros excluídos' using errcode = '42501';
  end if;
  select p.id, p.legal_case_id, p.cnj_number, p.released_cnj_number, p.deleted_at,
         k.deleted_at as case_deleted_at, c.deleted_at as client_deleted_at
    into v
  from public.legal_processes p
  join public.legal_cases k on k.id = p.legal_case_id
  join public.clients c on c.id = k.client_id
  where p.id = p_id
  for update of p;
  if v.id is null then
    raise exception 'Processo não encontrado' using errcode = 'P0002';
  end if;
  if v.deleted_at is null then
    raise exception 'Este processo não está excluído' using errcode = 'P0001';
  end if;
  if v.client_deleted_at is not null then
    raise exception 'O cliente deste processo está na Lixeira. Restaure primeiro o cliente.' using errcode = 'P0001';
  end if;
  if v.case_deleted_at is not null then
    raise exception 'O caso deste processo foi excluído. Não dá para restaurar só o processo.' using errcode = 'P0001';
  end if;
  v_cnj := coalesce(v.cnj_number::text, v.released_cnj_number::text);
  if v_cnj is not null and exists (select 1 from public.legal_processes o
                                   where o.id <> p_id and o.deleted_at is null and o.cnj_number = v_cnj) then
    raise exception 'Já existe outro processo ativo com este número CNJ. Use o processo ativo.' using errcode = '23505';
  end if;

  -- Volta com o número que tinha. Se outro EXCLUÍDO estiver com o número, o
  -- gatilho acima faz esse outro soltar.
  perform set_config('dg.cnj_release', '1', true);
  update public.legal_processes p
     set deleted_at = null, cnj_number = v_cnj, released_cnj_number = null
   where p.id = p_id;
  perform set_config('dg.cnj_release', '', true);

  -- Acompanhamento no DataJud: o gatilho da 043 recria a referência quando o
  -- número volta; isto cobre o caso em que ela faltava por outro motivo.
  if v_cnj is not null and not exists (select 1 from public.process_external_refs r
                                       where r.legal_process_id = p_id and r.provider = 'DATAJUD') then
    insert into public.process_external_refs (legal_process_id, provider, external_id)
    values (p_id, 'DATAJUD', v_cnj)
    on conflict (provider, external_id) do nothing;
  end if;

  perform private.record_audit_event('PROCESS_RESTORED', 'legal_processes', p_id,
    jsonb_build_object('legal_case_id', v.legal_case_id));

  return jsonb_build_object(
    'id', p_id,
    'legal_case_id', v.legal_case_id,
    'cnj_returned', v.cnj_number is null and v.released_cnj_number is not null,
    'open_deadlines', (select count(*) from public.deadlines d where d.legal_process_id = p_id and d.status = 'OPEN'));
end
$$;

create or replace function private.restore_document(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Somente o administrador restaura registros excluídos' using errcode = '42501';
  end if;
  select d.id, d.client_id, d.deleted_at, c.deleted_at as client_deleted_at into v
  from public.documents d
  join public.clients c on c.id = d.client_id
  where d.id = p_id
  for update of d;
  if v.id is null then
    raise exception 'Documento não encontrado' using errcode = 'P0002';
  end if;
  if v.deleted_at is null then
    raise exception 'Este documento não está excluído' using errcode = 'P0001';
  end if;
  if v.client_deleted_at is not null then
    raise exception 'O cliente deste documento está na Lixeira. Restaure primeiro o cliente.' using errcode = 'P0001';
  end if;

  update public.documents d set deleted_at = null where d.id = p_id;
  perform private.record_audit_event('DOCUMENT_RESTORED', 'documents', p_id,
    jsonb_build_object('client_id', v.client_id));

  return jsonb_build_object('id', p_id, 'client_id', v.client_id);
end
$$;

-- ═════════════════════════════ 3. lixeira ═════════════════════════════════

-- p_kind: CLIENT | PROCESS | DOCUMENT. p_search: nome/título; só dígitos (com
-- ou sem máscara, 3 ou mais) = CPF/CNPJ do cliente ou trecho do número CNJ.
-- blocked: por que "Restaurar" seria recusado agora (ou null).
create or replace function private.trash_list(
  p_kind text, p_search text default null, p_limit integer default 25, p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q       text := nullif(btrim(coalesce(p_search, '')), '');
  v_digits  text := regexp_replace(coalesce(p_search, ''), '\D', '', 'g');
  v_by_num  boolean;
  v_like    text;
  v_limit   integer := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_offset  integer := least(greatest(coalesce(p_offset, 0), 0), 500000);
  v_total   bigint;
  v_items   jsonb;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Somente o administrador abre a Lixeira' using errcode = '42501';
  end if;
  if v_q is not null and length(v_q) > 120 then
    raise exception 'Busca longa demais' using errcode = '22023';
  end if;
  v_by_num := v_q is not null and length(v_digits) >= 3 and v_q ~ '^[0-9\s./-]+$';
  v_like := '%' || replace(replace(replace(coalesce(v_q, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  if p_kind = 'CLIENT' then
    select count(*) into v_total
    from public.clients c
    left join public.individual_client_details i on i.client_id = c.id
    left join public.company_client_details co on co.client_id = c.id
    where c.deleted_at is not null
      and (v_q is null
        or (v_by_num and (c.cpf like v_digits || '%' or c.cnpj like v_digits || '%'))
        or (not v_by_num and coalesce(i.full_name, co.legal_name) ilike v_like));

    select coalesce(jsonb_agg(to_jsonb(x) order by x.deleted_at desc, x.id), '[]'::jsonb) into v_items
    from (
      select c.id, 'CLIENT'::text as kind, coalesce(i.full_name, co.legal_name) as title,
             c.kind as client_kind, coalesce(c.cpf::text, c.cnpj::text) as document,
             c.deleted_at, a.actor_user_id as deleted_by, pr.full_name as deleted_by_name,
             null::text as blocked
      from public.clients c
      left join public.individual_client_details i on i.client_id = c.id
      left join public.company_client_details co on co.client_id = c.id
      left join lateral (
        select e.actor_user_id from public.audit_events e
        where e.entity_type = 'clients' and e.entity_id = c.id and e.action = 'CLIENT_DELETED'
        order by e.created_at desc limit 1) a on true
      left join public.profiles pr on pr.id = a.actor_user_id
      where c.deleted_at is not null
        and (v_q is null
          or (v_by_num and (c.cpf like v_digits || '%' or c.cnpj like v_digits || '%'))
          or (not v_by_num and coalesce(i.full_name, co.legal_name) ilike v_like))
      order by c.deleted_at desc, c.id
      limit v_limit offset v_offset) x;

  elsif p_kind = 'PROCESS' then
    select count(*) into v_total
    from public.legal_processes p
    join public.legal_cases k on k.id = p.legal_case_id
    where p.deleted_at is not null
      and (v_q is null
        or (v_by_num and coalesce(p.cnj_number::text, p.released_cnj_number::text) like '%' || v_digits || '%')
        or (not v_by_num and (p.title ilike v_like or k.title ilike v_like)));

    select coalesce(jsonb_agg(to_jsonb(x) order by x.deleted_at desc, x.id), '[]'::jsonb) into v_items
    from (
      select p.id, 'PROCESS'::text as kind, coalesce(nullif(btrim(p.title), ''), k.title) as title,
             coalesce(p.cnj_number::text, p.released_cnj_number::text) as cnj,
             p.released_cnj_number is not null as cnj_released,
             k.id as legal_case_id, k.title as case_title,
             coalesce(i.full_name, co.legal_name) as client_name,
             p.deleted_at, a.actor_user_id as deleted_by, pr.full_name as deleted_by_name,
             case
               when c.deleted_at is not null then 'CLIENT_DELETED'
               when k.deleted_at is not null then 'CASE_DELETED'
               when exists (select 1 from public.legal_processes o
                            where o.id <> p.id and o.deleted_at is null
                              and o.cnj_number = coalesce(p.cnj_number::text, p.released_cnj_number::text)) then 'CNJ_IN_USE'
             end as blocked
      from public.legal_processes p
      join public.legal_cases k on k.id = p.legal_case_id
      join public.clients c on c.id = k.client_id
      left join public.individual_client_details i on i.client_id = c.id
      left join public.company_client_details co on co.client_id = c.id
      left join lateral (
        select e.actor_user_id from public.audit_events e
        where e.entity_type = 'legal_processes' and e.entity_id = p.id and e.action = 'PROCESS_DELETED'
        order by e.created_at desc limit 1) a on true
      left join public.profiles pr on pr.id = a.actor_user_id
      where p.deleted_at is not null
        and (v_q is null
          or (v_by_num and coalesce(p.cnj_number::text, p.released_cnj_number::text) like '%' || v_digits || '%')
          or (not v_by_num and (p.title ilike v_like or k.title ilike v_like)))
      order by p.deleted_at desc, p.id
      limit v_limit offset v_offset) x;

  elsif p_kind = 'DOCUMENT' then
    select count(*) into v_total
    from public.documents d
    join public.clients c on c.id = d.client_id
    left join public.individual_client_details i on i.client_id = c.id
    left join public.company_client_details co on co.client_id = c.id
    where d.deleted_at is not null
      and (v_q is null or d.title ilike v_like or coalesce(i.full_name, co.legal_name) ilike v_like);

    select coalesce(jsonb_agg(to_jsonb(x) order by x.deleted_at desc, x.id), '[]'::jsonb) into v_items
    from (
      select d.id, 'DOCUMENT'::text as kind, d.title, d.category::text as category, dc.label as category_label,
             d.client_id, coalesce(i.full_name, co.legal_name) as client_name,
             d.deleted_at, a.actor_user_id as deleted_by, pr.full_name as deleted_by_name,
             case when c.deleted_at is not null then 'CLIENT_DELETED' end as blocked
      from public.documents d
      join public.clients c on c.id = d.client_id
      left join public.document_categories dc on dc.code = d.category
      left join public.individual_client_details i on i.client_id = c.id
      left join public.company_client_details co on co.client_id = c.id
      -- O gatilho da 014 registra a exclusão do documento como "atualizado",
      -- com deleted_at entre os campos: o mais recente é a exclusão vigente.
      left join lateral (
        select e.actor_user_id from public.audit_events e
        where e.entity_type = 'documents' and e.entity_id = d.id and e.action = 'DOCUMENT_UPDATED'
          and e.metadata -> 'fields' ? 'deleted_at'
        order by e.created_at desc limit 1) a on true
      left join public.profiles pr on pr.id = a.actor_user_id
      where d.deleted_at is not null
        and (v_q is null or d.title ilike v_like or coalesce(i.full_name, co.legal_name) ilike v_like)
      order by d.deleted_at desc, d.id
      limit v_limit offset v_offset) x;

  else
    raise exception 'Tipo de registro inválido' using errcode = '22023';
  end if;

  return jsonb_build_object('total', v_total, 'items', v_items);
end
$$;

-- ═════════════════════════════ 4. registro de exportação ══════════════════

-- p_kind: nome da lista exportada (clients, processes, deadlines...).
-- p_filters: objeto raso com os filtros da tela. Só valores simples e curtos;
-- texto de busca não entra (use {"search": true}); CPF, CNPJ e e-mail são
-- recusados. O conteúdo exportado nunca é gravado.
create or replace function private.record_data_export(
  p_kind text, p_filters jsonb, p_row_count integer, p_truncated boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  f         record;
  v_text    text;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Somente o administrador exporta planilhas' using errcode = '42501';
  end if;
  if coalesce(p_kind, '') !~ '^[a-z][a-z0-9_]{1,39}$' then
    raise exception 'Tipo de exportação inválido' using errcode = '22023';
  end if;
  if p_row_count is null or p_row_count < 0 or p_row_count > 1000000 then
    raise exception 'Quantidade de linhas inválida' using errcode = '22023';
  end if;
  if jsonb_typeof(v_filters) <> 'object' or (select count(*) from jsonb_object_keys(v_filters)) > 30 then
    raise exception 'Filtros inválidos' using errcode = '22023';
  end if;
  for f in select key, value from jsonb_each(v_filters) loop
    if f.key !~ '^[a-zA-Z][a-zA-Z0-9_]{0,39}$' or jsonb_typeof(f.value) not in ('string', 'number', 'boolean', 'null') then
      raise exception 'Filtros inválidos' using errcode = '22023';
    end if;
    if jsonb_typeof(f.value) = 'string' then
      v_text := f.value #>> '{}';
      if length(v_text) > 80 or v_text ~ '@'
         or v_text ~ '^\s*\d{3}\.?\d{3}\.?\d{3}-?\d{2}\s*$'
         or v_text ~ '^\s*\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}\s*$' then
        raise exception 'Os filtros da exportação não podem levar dado pessoal' using errcode = '22023';
      end if;
    end if;
  end loop;

  return private.record_audit_event('DATA_EXPORTED', 'exports', null,
    jsonb_build_object('kind', p_kind, 'total_rows', p_row_count,
                       'truncated', coalesce(p_truncated, false), 'filters', v_filters));
end
$$;

-- ═════════════════════════════ 5. portas e permissões ═════════════════════

create or replace function public.restore_client(p_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.restore_client(p_id) $$;

create or replace function public.restore_process(p_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.restore_process(p_id) $$;

create or replace function public.restore_document(p_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.restore_document(p_id) $$;

create or replace function public.trash_list(
  p_kind text, p_search text default null, p_limit integer default 25, p_offset integer default 0
)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.trash_list(p_kind, p_search, p_limit, p_offset) $$;

create or replace function public.record_data_export(
  p_kind text, p_filters jsonb, p_row_count integer, p_truncated boolean default false
)
returns uuid language sql security invoker set search_path = ''
as $$ select private.record_data_export(p_kind, p_filters, p_row_count, p_truncated) $$;

revoke all on function private.legal_processes_cnj_release() from public, anon, authenticated, service_role;

do $$
declare
  f text;
begin
  foreach f in array array[
    'restore_client(uuid)', 'restore_process(uuid)', 'restore_document(uuid)',
    'trash_list(text, text, integer, integer)', 'record_data_export(text, jsonb, integer, boolean)']
  loop
    execute format('revoke all on function private.%s from public, anon, authenticated, service_role', f);
    execute format('revoke all on function public.%s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function private.%s to authenticated', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end
$$;

comment on function public.restore_client(uuid) is 'Lixeira (066): restaura cliente excluído. Só ADMIN; recusa se houver outro cliente ativo com o mesmo CPF/CNPJ.';
comment on function public.restore_process(uuid) is 'Lixeira (066): restaura processo excluído, com o número CNJ que tinha. Só ADMIN; recusa se houver outro processo ativo com o mesmo número, ou se o cliente/caso estiver excluído.';
comment on function public.restore_document(uuid) is 'Lixeira (066): restaura documento excluído. Só ADMIN; recusa se o cliente estiver na Lixeira.';
comment on function public.trash_list(text, text, integer, integer) is 'Lixeira (066): clientes, processos ou documentos excluídos, com quem excluiu e quando. Só ADMIN.';
comment on function public.record_data_export(text, jsonb, integer, boolean) is 'Exportação (066): grava DATA_EXPORTED na auditoria (tipo, filtros, quantidade de linhas). Só ADMIN; nunca o conteúdo.';
