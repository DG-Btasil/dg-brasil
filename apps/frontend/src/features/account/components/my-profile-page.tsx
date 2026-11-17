"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { PageContainer } from "@/components/layout/guards";
import { ErrorState } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { Avatar, PageHeader } from "@/components/ui/display";
import { DefinitionGrid, Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { useClientSession } from "@/features/auth/session-context";
import type { ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { ROLE_LABEL } from "@/lib/permissions";
import type { MyProfileDTO } from "@/server/domain/account/profile";
import { useToast } from "@/store/ui-store";
import { MyOabsPanel } from "./my-oabs-panel";
import { PersonalProfileFields } from "./personal-profile-fields";
import { usePersonalProfileForm } from "./use-personal-profile-form";

/**
 * "Meu perfil" (079): a pessoa vê e edita os PRÓPRIOS dados pessoais e as
 * OABs, na equipe e no portal do parceiro. O mesmo formulário da etapa
 * obrigatória. E-mail, papel e escritório são só leitura: quem muda é a
 * administração.
 */
export function MyProfilePage({ initialResult }: { initialResult: ActionResult<MyProfileDTO> }) {
  return (
    <PageContainer className="max-w-[1100px]">
      <PageHeader title="Meu perfil" description="Seus dados pessoais no DG Brasil. Só você altera estas informações." />
      {initialResult.ok ? <ProfileEditor data={initialResult.data} /> : <ErrorState description={initialResult.error.message} />}
    </PageContainer>
  );
}

function ProfileEditor({ data }: { data: MyProfileDTO }) {
  const session = useClientSession();
  const router = useRouter();
  const toast = useToast();
  const failed = useActionFeedback();
  const form = usePersonalProfileForm(data.profile);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const result = await form.submit();
    if (!result) return;
    if (!result.ok) return failed(result, "Não foi possível salvar o perfil.");
    toast({ tone: "success", title: "Perfil atualizado" });
    // O nome e o cargo aparecem no cabeçalho: o servidor relê a sessão.
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <Panel>
        <PanelBody className="flex flex-wrap items-center gap-4">
          <Avatar name={form.value.fullName || data.profile.fullName} size="lg" />
          <DefinitionGrid
            columns={3}
            className="min-w-[260px] flex-1"
            items={[
              { label: "E-mail", value: data.email },
              { label: "Papel", value: session ? ROLE_LABEL[session.role] : undefined },
              { label: "Escritório", value: session?.organizationName },
            ]}
          />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Dados pessoais" description="Nome completo e cidade de trabalho são obrigatórios. O restante é opcional." />
        <form onSubmit={onSubmit} noValidate>
          <PanelBody className="max-w-[720px]">
            <PersonalProfileFields value={form.value} errors={form.errors} onChange={form.onChange} disabled={form.submitting} />
          </PanelBody>
          <PanelFooter>
            <Button type="submit" loading={form.submitting}>
              Salvar alterações
            </Button>
          </PanelFooter>
        </form>
      </Panel>

      <MyOabsPanel />
    </div>
  );
}
