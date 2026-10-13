-- DG Brasil — 024: preferências do usuário também exigem MFA (aal2)
--
-- `user_preferences` (onde fica `tour_completed_at`, a introdução do produto
-- vista UMA vez por usuário, em qualquer navegador) e
-- `user_notification_preferences` filtravam só por `auth.uid()`: uma sessão só
-- com senha (aal1) lia e gravava as próprias preferências. Nada disso é
-- necessário antes do MFA (o onboarding de SEGURANÇA — convite, senha, termos,
-- MFA — não usa estas tabelas; o tour do produto só aparece com acesso
-- liberado), então elas passam a seguir a regra do resto do domínio (022).
--
-- `tour_completed_at` já existe desde a 010: o "onboarding concluído" do
-- produto reaproveita a coluna, sem tabela nova.
--
-- Pós-baseline: 001–023 não são alteradas.

drop policy if exists user_preferences_own on public.user_preferences;
create policy user_preferences_own on public.user_preferences for all to authenticated
  using (user_id = (select auth.uid()) and (select private.session_is_mfa_verified()))
  with check (user_id = (select auth.uid()) and (select private.session_is_mfa_verified()));

drop policy if exists user_notification_preferences_own on public.user_notification_preferences;
create policy user_notification_preferences_own on public.user_notification_preferences for all to authenticated
  using (user_id = (select auth.uid()) and (select private.session_is_mfa_verified()))
  with check (user_id = (select auth.uid()) and (select private.session_is_mfa_verified()));

comment on column public.user_preferences.tour_completed_at is
  'Introdução do produto concluída ou pulada (uma vez por usuário, vale em qualquer navegador). Rever a introdução não altera.';
