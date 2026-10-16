"use client";

import { formatCNPJ, formatDate, formatPhone } from "@/lib/formatting";
import type { ActionResult } from "@/lib/actions/result";
import { ROLE_LABEL } from "@/lib/permissions";
import { Can, PageContainer } from "@/components/layout/guards";
import { Avatar, PageHeader } from "@/components/ui/display";
import { DefinitionGrid, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { ActionErrorState } from "@/components/feedback/action-error";
import type { MyPartnerSettingsDTO, PartnerDetailDTO } from "@/server/domain/organizations/dto";
import { useClientSession } from "@/features/auth/session-context";
import { AccountSecurity } from "@/features/account/components/account-security";
import { NotificationPreferences } from "@/features/notifications/components/notification-preferences";
import { UsersPanel } from "./portal-users";

/**
 * Minha Conta: dados da SESSÃO real (nunca do mock), o cadastro do próprio
 * escritório (getMyPartnerOfficeAction → PartnerOwnOfficeDTO, sem nota
 * interna) e, para o administrador do parceiro, a divisão padrão vigente
 * (getMyPartnerSettingsAction, 027), a gestão de usuários do escritório e
 * as preferências de aviso do próprio usuário (4.3.1) e a segurança da
 * própria conta — senha, MFA e sessões (4.3.2).
 */
export function PortalAccount({
  office,
  settings,
}: {
  office: ActionResult<PartnerDetailDTO>;
  /** Só PARTNER_ADMIN (partnerPortal.finance.view); ausente para PARTNER_USER. */
  settings?: ActionResult<MyPartnerSettingsDTO>;
}) {
  const session = useClientSession();
  if (!session) return null;
  const own = office.ok && office.data.access === "PARTNER" ? office.data.partner : undefined;
  return (
    <PageContainer>
      <PageHeader title="Minha Conta" description="Seus dados de acesso e as informações do seu escritório." />
      <div className="grid grid-cols-12 gap-5">
        <Panel className="col-span-12 xl:col-span-5">
          <PanelHeader title="Seus dados" />
          <PanelBody className="flex items-start gap-4">
            <Avatar name={session.fullName} size="lg" />
            <DefinitionGrid
              columns={2}
              className="flex-1"
              items={[
                { label: "Nome", value: session.fullName },
                { label: "E-mail", value: session.email },
                { label: "Papel", value: ROLE_LABEL[session.role] },
                { label: "Cargo", value: session.jobTitle ?? undefined },
              ]}
            />
          </PanelBody>
        </Panel>
        <Panel className="col-span-12 xl:col-span-7">
          <PanelHeader title="Escritório" description="Para alterar estes dados, fale com a Bárbara Cardoso Advocacia." />
          {!office.ok ? (
            <ActionErrorState error={office} title="Não foi possível carregar o escritório." />
          ) : (
            <PanelBody>
              <DefinitionGrid
                items={[
                  { label: "Escritório", value: own?.name ?? session.organizationName },
                  { label: "Razão social", value: own?.legalName },
                  { label: "CNPJ", value: own?.cnpj ? formatCNPJ(own.cnpj) : undefined },
                  { label: "E-mail", value: own?.email },
                  { label: "Telefone", value: own?.phone ? formatPhone(own.phone) : undefined },
                  { label: "Parceria desde", value: settings?.ok && settings.data.activatedAt ? formatDate(settings.data.activatedAt) : own ? formatDate(own.createdAt) : undefined },
                ]}
              />
            </PanelBody>
          )}
        </Panel>
        {settings && (
          <Panel className="col-span-12 xl:col-span-5">
            <PanelHeader title="Divisão padrão" description="Vale para novos casos. Casos já aceitos mantêm o acordo registrado no aceite." />
            {!settings.ok ? (
              <ActionErrorState error={settings} title="Não foi possível carregar a divisão." />
            ) : (
              <PanelBody>
                <DefinitionGrid
                  columns={2}
                  items={[
                    { label: "Seu escritório", value: `${settings.data.partnerPercentage}%` },
                    { label: "Bárbara Cardoso Advocacia", value: `${settings.data.ownerPercentage}%` },
                  ]}
                />
              </PanelBody>
            )}
          </Panel>
        )}
        <Can permission="partnerPortal.users.manage">
          <div className="col-span-12">
            <UsersPanel />
          </div>
        </Can>
        <section aria-labelledby="notification-preferences-title" className="col-span-12">
          <h2 id="notification-preferences-title" className="mb-3 text-[15px] font-semibold text-foreground">
            Notificações
          </h2>
          <NotificationPreferences />
        </section>
        <section aria-labelledby="account-security-title" className="col-span-12">
          <h2 id="account-security-title" className="mb-3 text-[15px] font-semibold text-foreground">
            Segurança da conta
          </h2>
          <AccountSecurity />
        </section>
      </div>
    </PageContainer>
  );
}
