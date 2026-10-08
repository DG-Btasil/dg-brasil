-- DG Brasil — 017: Storage
--
-- Buckets privados. O navegador não acessa o bucket diretamente:
--
--   download:  browser → Next.js (valida sessão e permissão, grava
--              DOCUMENT_DOWNLOADED) → signed URL de curta duração → browser
--   upload:    browser → Next.js (valida) → signed upload URL para o caminho
--              clients/{client_id}/documents/{document_id}/{version_id}/{arquivo}
--              → Next.js insere document_versions
--
-- O caminho não é mecanismo de segurança. Ver private.legal_document_object_name
-- (007) e a validação de caminho em document_versions.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('legal-documents', 'legal-documents', false, 52428800, array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv',
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/tiff'
  ]),
  ('reference-materials', 'reference-materials', false, 52428800, array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain', 'text/markdown'
  ]),
  -- Importação V1: CSV e XLSX. (application/vnd.ms-excel é como navegadores no
  -- Windows rotulam .csv quando o Excel está instalado; o formato aceito
  -- continua sendo só CSV/XLSX — import_jobs.file_type.)
  ('imports', 'imports', false, 20971520, array[
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ])
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Sem política permissiva para anon/authenticated nesses buckets = sem acesso.
-- A política RESTRICTIVE abaixo garante que, mesmo se alguém criar no futuro
-- uma política permissiva genérica em storage.objects, ela não abra estes
-- buckets ao navegador. A service role (Next.js, worker) ignora RLS.
create policy dg_private_buckets_no_direct_access on storage.objects
  as restrictive
  for all
  to anon, authenticated
  using (bucket_id not in ('legal-documents', 'reference-materials', 'imports'))
  with check (bucket_id not in ('legal-documents', 'reference-materials', 'imports'));

-- ───────────────────────────── objetos órfãos ─────────────────────────────
-- Upload concluído + insert da versão que falhou deixa um objeto sem linha no
-- banco. Esta função só DETECTA (nada é apagado automaticamente): lista objetos
-- dos buckets jurídicos sem versão correspondente, mais velhos que a margem
-- (para não pegar upload em andamento). A limpeza é decisão humana/rotina
-- revisada, pela API do Storage.
create or replace function private.find_orphan_storage_objects(p_older_than interval default interval '24 hours')
returns table (bucket_id text, object_name text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select o.bucket_id, o.name, o.created_at
  from storage.objects o
  where o.created_at < now() - p_older_than
    and (
      (o.bucket_id = 'legal-documents'
       and not exists (select 1 from public.document_versions v where v.storage_object_name = o.name))
      or
      (o.bucket_id = 'reference-materials'
       and not exists (select 1 from public.reference_material_versions v where v.storage_object_name = o.name))
      or
      (o.bucket_id = 'imports'
       and not exists (select 1 from public.import_jobs j where j.storage_object_name = o.name))
    )
  order by o.created_at
$$;

revoke all on function private.find_orphan_storage_objects(interval) from public, anon, authenticated;
grant execute on function private.find_orphan_storage_objects(interval) to service_role;
