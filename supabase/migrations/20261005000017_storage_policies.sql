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
  ('imports', 'imports', false, 20971520, array[
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/json'
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
