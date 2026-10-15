-- 034 — Edição manual de conteúdo durante a revisão (Etapa 4.3.1)
--
-- Regra fundamental: document_versions é imutável. Editar NUNCA altera a
-- versão revisada: cria a versão N+1 (source MANUAL_EDIT) e uma revisão nova
-- para ela; a versão N, as decisões dela e o arquivo dela ficam intactos.
--
-- Fluxo (o servidor da aplicação orquestra; o banco decide):
--   1. public.prepare_manual_revision(chave, revisão, versão base)
--        confere quem edita (ADMIN/LAWYER), revisão de documento ABERTA,
--        base = versão MAIS RECENTE do documento, formato de texto editável;
--        devolve o id da nova versão e o caminho EXATO do objeto no Storage
--        — ou, se a mesma chave já concluiu, o resultado anterior (o servidor
--        não sobe o arquivo de novo).
--   2. o servidor grava o texto nesse caminho (módulo de Storage existente,
--      o mesmo das assinaturas de upload/download — nenhum uso novo de
--      service role: ele só escreve no caminho que o banco autorizou);
--   3. public.commit_manual_revision_once(chave, ...) — numa transação:
--        versão N+1 MANUAL_EDIT; a revisão aberta da versão N recebe a decisão
--        REQUEST_CHANGES (append-only, pelo mesmo fluxo de decide_review: o
--        status dela muda só por decisão registrada); revisão NOVA (PENDING)
--        para N+1, com o mesmo responsável, prioridade e prazo; auditoria
--        DOCUMENT_MANUALLY_REVISED. Aprovação nunca é herdada (a view
--        document_version_approvals já deriva por versão).
--      Mesma chave → mesmo resultado (027). Duas edições simultâneas da mesma
--      base: o lock do documento serializa e a segunda é recusada (a base não
--      é mais a mais recente).
--
-- Arquivo enviado e commit recusado deixa um objeto órfão no Storage (como no
-- upload comum): nenhuma linha aponta para ele; nada é sobrescrito.
--
-- Futuro ("Solicitar alteração à IA"): o worker entrega com
-- worker_deliver_document, que JÁ cria versão nova + revisão nova — a mesma
-- garantia: a IA nunca edita uma versão existente.

create or replace function private.manual_revision_editable_mime(p_mime text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(split_part(lower(p_mime), ';', 1) in ('text/plain', 'text/markdown'), false)
$$;

-- Conferências comuns ao preparo e ao commit. Devolve a linha da base.
create or replace function private.manual_revision_check(p_review_id uuid, p_base_version_id uuid, p_lock boolean)
returns table (
  review_status text, legal_case_id uuid, legal_process_id uuid, priority text, assigned_reviewer_id uuid, due_at timestamptz,
  document_id uuid, client_id uuid, base_number integer, original_filename text, mime_type text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review record;
  v_base   record;
  v_latest integer;
begin
  if auth.uid() is null or not exists (select 1 from private.current_membership()) then
    raise exception 'Sem sessão liberada' using errcode = '42501';
  end if;
  if not private.has_internal_role('ADMIN', 'LAWYER') then
    raise exception 'Somente ADMIN ou advogado edita conteúdo em revisão' using errcode = '42501';
  end if;

  select r.status, r.legal_case_id, r.legal_process_id, r.priority, r.assigned_reviewer_id, r.due_at, r.document_version_id
    into v_review
  from public.reviews r where r.id = p_review_id;
  if not found or (v_review.legal_case_id is not null and not private.can_access_case(v_review.legal_case_id)) then
    raise exception 'Revisão não encontrada' using errcode = 'P0002';
  end if;
  if v_review.document_version_id is null then
    raise exception 'Só revisão de documento tem conteúdo editável' using errcode = '23514';
  end if;
  if v_review.document_version_id <> p_base_version_id then
    raise exception 'A versão informada não é a desta revisão' using errcode = '23514';
  end if;
  if v_review.status not in ('PENDING', 'REOPENED', 'CHANGES_REQUESTED') then
    raise exception 'Revisão já decidida: reabra antes de editar' using errcode = '23514';
  end if;

  select v.document_id, v.version_number, v.original_filename, v.mime_type, d.client_id, d.status, d.deleted_at
    into v_base
  from public.document_versions v
  join public.documents d on d.id = v.document_id
  where v.id = p_base_version_id;
  if v_base.deleted_at is not null then
    raise exception 'Documento excluído' using errcode = '23514';
  end if;
  if v_base.status <> 'ACTIVE' then
    raise exception 'Documento arquivado não recebe nova versão' using errcode = '23514';
  end if;
  if not private.manual_revision_editable_mime(v_base.mime_type) then
    raise exception 'Este formato não é editável aqui: envie uma nova versão do arquivo' using errcode = '23514';
  end if;

  if p_lock then
    -- Serializa edições do mesmo documento (duas abas, clique duplo com chaves diferentes).
    perform 1 from public.documents d where d.id = v_base.document_id for update;
  end if;
  select max(v.version_number) into v_latest from public.document_versions v where v.document_id = v_base.document_id;
  if v_latest <> v_base.version_number then
    raise exception 'Existe uma versão mais nova deste documento: abra a revisão dela' using errcode = '23514';
  end if;

  return query select v_review.status, v_review.legal_case_id, v_review.legal_process_id, v_review.priority,
                      v_review.assigned_reviewer_id, v_review.due_at, v_base.document_id, v_base.client_id,
                      v_base.version_number, v_base.original_filename, v_base.mime_type;
end
$$;

revoke all on function private.manual_revision_check(uuid, uuid, boolean) from public, anon, authenticated, service_role;

-- ───────────────────────────── 1. preparo ─────────────────────────────────

create or replace function private.prepare_manual_revision(p_key uuid, p_review_id uuid, p_base_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done    record;
  v_chk     record;
  v_version uuid := gen_random_uuid();
  v_name    text;
begin
  if p_key is null then
    raise exception 'Chave de envio obrigatória' using errcode = '22023';
  end if;
  -- Mesma chave já concluída: o servidor não sobe nada de novo.
  select o.response into v_done
  from private.idempotency_operations o
  where o.actor_user_id = auth.uid() and o.operation = 'review.manual_revision' and o.idempotency_key = p_key
    and o.resource_id is not null;
  if found then
    return v_done.response || jsonb_build_object('deduplicated', true);
  end if;

  select * into v_chk from private.manual_revision_check(p_review_id, p_base_version_id, false);
  v_name := private.legal_document_object_name(v_chk.client_id, v_chk.document_id, v_version,
                                                coalesce(v_chk.original_filename, 'documento.txt'));
  return jsonb_build_object(
    'deduplicated', false,
    'document_version_id', v_version,
    'object_name', v_name,
    'mime_type', split_part(v_chk.mime_type, ';', 1),
    'base_version_number', v_chk.base_number);
end
$$;

-- ───────────────────────────── 3. commit ──────────────────────────────────

create or replace function private.commit_manual_revision_once(
  p_key             uuid,
  p_review_id       uuid,
  p_base_version_id uuid,
  p_new_version_id  uuid,
  p_object_name     text,
  p_file_size       bigint,
  p_checksum        text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev     jsonb;
  v_chk      record;
  v_actor    uuid := auth.uid();
  v_number   integer;
  v_review   uuid;
  v_response jsonb;
begin
  -- O id da versão e o caminho ficam FORA do hash: a nova tentativa com a
  -- mesma chave e o mesmo conteúdo devolve a versão já criada.
  v_prev := private.idempotency_begin('review.manual_revision', p_key,
    jsonb_build_object('review_id', p_review_id, 'base_version_id', p_base_version_id, 'checksum', p_checksum));
  if v_prev is not null then
    return (v_prev -> 'response') || jsonb_build_object('deduplicated', true);
  end if;

  if p_file_size is null or p_file_size <= 0 then
    raise exception 'Conteúdo vazio' using errcode = '22023';
  end if;
  if p_checksum is null or p_checksum !~ '^[0-9a-f]{64}$' then
    raise exception 'Checksum inválido' using errcode = '22023';
  end if;

  select * into v_chk from private.manual_revision_check(p_review_id, p_base_version_id, true);
  if p_object_name <> private.legal_document_object_name(v_chk.client_id, v_chk.document_id, p_new_version_id,
                                                         coalesce(v_chk.original_filename, 'documento.txt')) then
    raise exception 'Caminho do arquivo não confere com o autorizado' using errcode = '42501';
  end if;

  insert into public.document_versions
    (id, document_id, storage_object_name, original_filename, mime_type, file_size, checksum_sha256, source, created_by)
  values
    (p_new_version_id, v_chk.document_id, p_object_name, v_chk.original_filename, v_chk.mime_type,
     p_file_size, p_checksum, 'MANUAL_EDIT', v_actor)
  returning version_number into v_number;

  -- A revisão da versão N recebe a decisão dela (append-only). Já com
  -- "alterações pedidas", não precisa de outra.
  if v_chk.review_status in ('PENDING', 'REOPENED') then
    perform private.decide_review(p_review_id, 'REQUEST_CHANGES',
      format('Conteúdo editado manualmente: a versão %s seguiu para revisão.', v_number), v_actor);
  end if;

  insert into public.reviews (legal_case_id, legal_process_id, document_version_id, priority, assigned_reviewer_id, due_at)
  values (v_chk.legal_case_id, v_chk.legal_process_id, p_new_version_id, v_chk.priority, v_chk.assigned_reviewer_id, v_chk.due_at)
  returning id into v_review;

  perform private.record_audit_event('DOCUMENT_MANUALLY_REVISED', 'document_versions', p_new_version_id,
    jsonb_build_object('document_id', v_chk.document_id, 'base_version_id', p_base_version_id,
                       'base_version_number', v_chk.base_number, 'version_number', v_number,
                       'previous_review_id', p_review_id, 'review_id', v_review));

  v_response := jsonb_build_object('document_version_id', p_new_version_id, 'version_number', v_number,
                                   'review_id', v_review, 'previous_review_id', p_review_id,
                                   'document_id', v_chk.document_id);
  perform private.idempotency_complete('review.manual_revision', p_key, 'document_versions', p_new_version_id, v_response);
  return v_response || jsonb_build_object('deduplicated', false);
end
$$;

create or replace function public.prepare_manual_revision(p_key uuid, p_review_id uuid, p_base_version_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.prepare_manual_revision(p_key, p_review_id, p_base_version_id) $$;

create or replace function public.commit_manual_revision_once(
  p_key uuid, p_review_id uuid, p_base_version_id uuid, p_new_version_id uuid,
  p_object_name text, p_file_size bigint, p_checksum text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.commit_manual_revision_once(p_key, p_review_id, p_base_version_id, p_new_version_id,
                                              p_object_name, p_file_size, p_checksum)
$$;

revoke all on function private.manual_revision_editable_mime(text) from public, anon, service_role;
grant execute on function private.manual_revision_editable_mime(text) to authenticated;
revoke all on function private.prepare_manual_revision(uuid, uuid, uuid) from public, anon, service_role;
revoke all on function private.commit_manual_revision_once(uuid, uuid, uuid, uuid, text, bigint, text) from public, anon, service_role;
grant execute on function private.prepare_manual_revision(uuid, uuid, uuid) to authenticated;
grant execute on function private.commit_manual_revision_once(uuid, uuid, uuid, uuid, text, bigint, text) to authenticated;
revoke all on function public.prepare_manual_revision(uuid, uuid, uuid) from public, anon;
revoke all on function public.commit_manual_revision_once(uuid, uuid, uuid, uuid, text, bigint, text) from public, anon;
grant execute on function public.prepare_manual_revision(uuid, uuid, uuid) to authenticated;
grant execute on function public.commit_manual_revision_once(uuid, uuid, uuid, uuid, text, bigint, text) to authenticated;
