-- DG Brasil — 002: tipos estáveis e domínios
--
-- Enum só para o que não deve mudar: tipo de organização, papel, tipo de
-- cliente e visibilidade de documento. Status de workflow (caso, análise,
-- revisão...) usam text + CHECK, porque o produto ainda evolui rápido e enum
-- do Postgres não permite remover valor.

create type public.organization_type as enum ('OWNER', 'PARTNER');

-- Cinco papéis. OWNER: ADMIN, LAWYER, ASSISTANT. PARTNER: PARTNER_ADMIN, PARTNER_USER.
create type public.membership_role as enum (
  'ADMIN', 'LAWYER', 'ASSISTANT', 'PARTNER_ADMIN', 'PARTNER_USER'
);

create type public.client_kind as enum ('INDIVIDUAL', 'COMPANY');

create type public.document_visibility as enum ('INTERNAL', 'PARTNER_VISIBLE');

-- ───────────────────────────── domínios ───────────────────────────────────

-- Dinheiro: nunca float.
create domain public.money_amount as numeric(14,2)
  check (value >= 0);

create domain public.percentage as numeric(5,2)
  check (value >= 0 and value <= 100);

create domain public.currency_code as char(3)
  check (value ~ '^[A-Z]{3}$');

-- CPF/CNPJ/CNJ armazenados somente com dígitos. Formatação é da aplicação.
create domain public.cpf_digits as text
  check (value ~ '^[0-9]{11}$');

create domain public.cnpj_digits as text
  check (value ~ '^[0-9]{14}$');

create domain public.uf_code as char(2)
  check (value ~ '^[A-Z]{2}$');

-- Categoria de documento: código livre em CAIXA_ALTA, definido pelos templates
-- de análise (sem hardcode de categorias no banco).
create domain public.document_category as text
  check (value ~ '^[A-Z][A-Z0-9_]{1,63}$');

-- Número CNJ (Res. CNJ 65/2008): NNNNNNN DD AAAA J TR OOOO, 20 dígitos, com
-- dígito verificador módulo 97 (ISO 7064). Rejeita número digitado errado.
create or replace function private.is_valid_cnj(p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value ~ '^[0-9]{20}$'
     and (98 - ((substr(p_value, 1, 7) || substr(p_value, 10, 11) || '00')::numeric % 97))
         = substr(p_value, 8, 2)::numeric
$$;
grant execute on function private.is_valid_cnj(text) to authenticated, service_role;

create domain public.cnj_digits as text
  check (private.is_valid_cnj(value));
