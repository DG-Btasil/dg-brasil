-- DG Brasil — 020: snapshot de parceria também quando accepted_at é preenchido pelo banco
--
-- Primeira migration pós-baseline (001–019 aplicadas no Supabase real de
-- desenvolvimento em 2026-10-08). Encontrado na validação real (Etapa 3.3).
--
-- Problema: o trigger legal_cases_partnership_snapshot era
--   AFTER INSERT OR UPDATE OF accepted_at, origin_organization_id
-- e o aceite preenche accepted_at no trigger BEFORE (legal_cases_guard), sem
-- que a coluna esteja no SET do UPDATE. "UPDATE OF coluna" só dispara para
-- colunas listadas no comando, então o aceite pelo caminho normal (PostgREST,
-- só status + advogado) não criava o snapshot da parceria.
--
-- Correção: o trigger dispara em todo UPDATE; a própria função já decide se é
-- aceite (old.accepted_at nulo → novo preenchido) ou troca de origem, e não faz
-- nada nos demais casos.

drop trigger legal_cases_partnership_snapshot on public.legal_cases;

create trigger legal_cases_partnership_snapshot
  after insert or update on public.legal_cases
  for each row execute function private.legal_cases_partnership_snapshot();
