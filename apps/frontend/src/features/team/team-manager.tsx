"use client";

import { useEffect, useState, type FormEvent } from "react";
import { UserPlus } from "lucide-react";
import { Callout, ErrorState, SkeletonRows } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Avatar } from "@/components/ui/display";
import { Field, Input, Select } from "@/components/ui/form";
import { MenuButton, type MenuItem } from "@/components/ui/menu";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { formatDate, formatEventTime } from "@/lib/formatting";
import { PARTNER_ROLES, ROLES, ROLE_DESCRIPTION, ROLE_LABEL, type Role } from "@/lib/permissions";
import {
  changeMemberRole,
  getTeamData,
  inviteUser,
  resendInvitation,
  resetUserMfa,
  revokeInvitation,
  setMemberStatus,
  setUserActive,
  type TeamData,
  type TeamMember,
} from "@/server/auth/team-actions";
import { useToast } from "@/store/ui-store";

/**
 * Gestão REAL de usuários (Supabase). O navegador só pede; quem decide é o
 * servidor (authorizeAction) e o banco (funções da migration 022: escopo do
 * escritório, último ADMIN, próprio acesso, auditoria).
 */

type Confirm = { title: string; description: string; label: string; danger?: boolean; run: () => Promise<{ ok: boolean; error?: string }>; success: string };

const STATUS_LABEL: Record<TeamMember["membershipStatus"], string> = {
  ACTIVE: "Ativo",
  SUSPENDED: "Suspenso",
  REMOVED: "Removido",
  INVITED: "Convidado",
};

function rolesFor(orgType: "OWNER" | "PARTNER"): readonly Role[] {
  return orgType === "OWNER" ? ROLES : PARTNER_ROLES;
}

export function TeamManager({ title = "Equipe e permissões", description }: { title?: string; description?: string }) {
  const toast = useToast();
  const [orgId, setOrgId] = useState<string | undefined>();
  const [data, setData] = useState<TeamData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  // Busca inicial, troca de escritório e recarga após cada ação: o estado
  // sempre vem da resposta do servidor.
  useEffect(() => {
    let cancelled = false;
    getTeamData(orgId).then((result) => {
      if (cancelled) return;
      if (result.ok && result.data) {
        setData(result.data);
        setError(null);
      } else if (!result.ok) {
        setError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [orgId, reloadKey]);

  async function runConfirm() {
    if (!confirm) return;
    setBusy(true);
    const result = await confirm.run();
    setBusy(false);
    if (!result.ok) {
      toast({ tone: "danger", title: result.error ?? "Não foi possível concluir." });
      return;
    }
    toast({ tone: "success", title: confirm.success });
    setConfirm(null);
    reload();
  }

  if (error && !data) return <ErrorState description={error} action={<Button variant="secondary" onClick={reload}>Tentar de novo</Button>} />;
  if (!data) return <SkeletonRows rows={4} />;

  const { organization, viewer } = data;
  const roles = rolesFor(organization.type);

  function memberActions(m: TeamMember): MenuItem[] {
    const items: MenuItem[] = [];
    if (m.membershipStatus === "ACTIVE") {
      items.push({
        key: "suspend",
        label: "Suspender acesso",
        description: "Bloqueia o acesso a este escritório na hora.",
        onSelect: () =>
          setConfirm({
            title: `Suspender ${m.fullName}?`,
            description: "A pessoa perde o acesso imediatamente (na próxima ação). Pode ser reativada depois.",
            label: "Suspender",
            danger: true,
            run: () => setMemberStatus(m.membershipId, "SUSPENDED"),
            success: "Acesso suspenso",
          }),
      });
    } else if (m.membershipStatus === "SUSPENDED") {
      items.push({
        key: "reactivate",
        label: "Reativar acesso",
        onSelect: () =>
          setConfirm({
            title: `Reativar ${m.fullName}?`,
            description: "O acesso volta com o mesmo papel.",
            label: "Reativar",
            run: () => setMemberStatus(m.membershipId, "ACTIVE"),
            success: "Acesso reativado",
          }),
      });
    }
    if (m.membershipStatus !== "REMOVED") {
      items.push({
        key: "remove",
        label: "Remover do escritório",
        onSelect: () =>
          setConfirm({
            title: `Remover ${m.fullName}?`,
            description: "O vínculo é encerrado. Para voltar, será preciso um novo convite.",
            label: "Remover",
            danger: true,
            run: () => setMemberStatus(m.membershipId, "REMOVED"),
            success: "Usuário removido do escritório",
          }),
      });
    }
    if (viewer.canDeactivateUsers) {
      items.push({
        key: "account",
        label: m.profileActive ? "Inativar conta" : "Reativar conta",
        description: m.profileActive ? "Bloqueia a conta em todos os escritórios." : undefined,
        onSelect: () =>
          setConfirm({
            title: m.profileActive ? `Inativar a conta de ${m.fullName}?` : `Reativar a conta de ${m.fullName}?`,
            description: m.profileActive
              ? "A conta fica bloqueada imediatamente, em qualquer escritório."
              : "A conta volta a poder entrar (os vínculos continuam como estão).",
            label: m.profileActive ? "Inativar" : "Reativar",
            danger: m.profileActive,
            run: () => setUserActive(m.userId, !m.profileActive),
            success: m.profileActive ? "Conta inativada" : "Conta reativada",
          }),
      });
    }
    if (viewer.canResetMfa && m.mfaEnabled) {
      items.push({
        key: "mfa",
        label: "Redefinir verificação em duas etapas",
        description: "Para celular perdido. Fica registrado na auditoria.",
        onSelect: () =>
          setConfirm({
            title: `Redefinir o MFA de ${m.fullName}?`,
            description:
              "Os autenticadores cadastrados serão removidos. No próximo acesso, a pessoa precisará cadastrar um novo — o MFA continua obrigatório. Confirme a identidade da pessoa por outro canal antes.",
            label: "Redefinir MFA",
            danger: true,
            run: () => resetUserMfa(m.userId),
            success: "MFA redefinido",
          }),
      });
    }
    return items;
  }

  return (
    <div className="space-y-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-foreground">{title}</h2>
          <p className="mt-1 max-w-[720px] text-[13px] text-muted">
            {description ?? "Usuários reais e seus papéis. O papel define o que cada pessoa vê e faz; mudanças valem na hora e ficam na auditoria."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {data.organizations.length > 1 && (
            <label className="flex items-center gap-2 text-[12.5px] text-muted">
              Escritório
              <Select
                className="h-9 min-w-[220px]"
                value={organization.id}
                options={data.organizations.map((o) => ({ value: o.id, label: o.type === "OWNER" ? `${o.name} (proprietário)` : o.name }))}
                onChange={(e) => {
                  setData(null);
                  setOrgId(e.target.value);
                }}
              />
            </label>
          )}
          <Button icon={<UserPlus className="size-4" aria-hidden />} onClick={() => setInviting(true)}>
            Convidar usuário
          </Button>
        </div>
      </div>

      {organization.status !== "ACTIVE" && (
        <Callout tone="warning" title={`Escritório com status ${organization.status}.`}>
          {organization.status === "PENDING"
            ? "O escritório é ativado quando o primeiro administrador do parceiro aceitar o convite."
            : "Usuários deste escritório não conseguem acessar enquanto o status não for ativo."}
        </Callout>
      )}

      <Panel>
        <PanelHeader title="Usuários" actions={<span className="text-[12px] text-muted tabular">{data.members.length} usuários</span>} />
        <Table caption={`Usuários de ${organization.name}`}>
          <THead>
            <tr>
              <Th>Nome</Th>
              <Th className="w-[200px]">Papel</Th>
              <Th>Status</Th>
              <Th>MFA</Th>
              <Th>Último acesso</Th>
              <Th className="w-[90px]">
                <span className="sr-only">Ações</span>
              </Th>
            </tr>
          </THead>
          <TBody>
            {data.members.map((m) => {
              const isMe = m.userId === viewer.userId;
              const editable = !isMe && m.membershipStatus !== "REMOVED";
              return (
                <Tr key={m.membershipId}>
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={m.fullName || m.email} size="sm" tone={m.membershipStatus === "ACTIVE" && m.profileActive ? "navy" : "neutral"} />
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">
                          {m.fullName}
                          {isMe && <span className="ml-1.5 text-[11.5px] font-normal text-muted">(você)</span>}
                        </p>
                        <p className="text-[12px] text-muted">{m.email}</p>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    {editable ? (
                      <label>
                        <span className="sr-only">Papel de {m.fullName}</span>
                        <Select
                          value={m.role}
                          className="h-8"
                          options={roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
                          onChange={(e) => {
                            const role = e.target.value as Role;
                            if (role === m.role) return;
                            setConfirm({
                              title: "Alterar papel",
                              description: `${m.fullName}: ${ROLE_LABEL[m.role]} → ${ROLE_LABEL[role]}. ${ROLE_DESCRIPTION[role]} Vale imediatamente e fica registrado na auditoria.`,
                              label: "Confirmar alteração",
                              run: () => changeMemberRole(m.membershipId, role),
                              success: "Papel alterado",
                            });
                          }}
                        />
                      </label>
                    ) : (
                      <span title={isMe ? "Você não pode alterar o próprio papel" : undefined}>{ROLE_LABEL[m.role]}</span>
                    )}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={m.membershipStatus === "ACTIVE" ? "success" : m.membershipStatus === "SUSPENDED" ? "warning" : "neutral"} dot>
                        {STATUS_LABEL[m.membershipStatus]}
                      </Badge>
                      {!m.profileActive && (
                        <Badge tone="danger" dot>
                          Conta inativa
                        </Badge>
                      )}
                    </div>
                  </Td>
                  <Td>
                    <Badge tone={m.mfaEnabled ? "success" : "warning"} dot>
                      {m.mfaEnabled ? "Ativo" : "Não cadastrado"}
                    </Badge>
                  </Td>
                  <Td className="tabular text-muted">{m.lastSignInAt ? formatEventTime(m.lastSignInAt) : "Nunca acessou"}</Td>
                  <Td>{editable && <MenuButton label="Ações" items={memberActions(m)} variant="ghost" />}</Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </Panel>

      {data.invitations.length > 0 && (
        <Panel>
          <PanelHeader title="Convites pendentes" description="O convite vale por 7 dias; o link do e-mail expira antes (1 hora, por segurança). Se expirar, reenvie: um link novo é gerado e o anterior deixa de valer." />
          <ul className="divide-y divide-line">
            {data.invitations.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-4 px-5 py-3 text-[13px]">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground">{inv.fullName ?? inv.email}</p>
                  <p className="text-[12px] text-muted">
                    {inv.email} · {ROLE_LABEL[inv.role]} · enviado em {formatDate(inv.createdAt)}
                  </p>
                </div>
                {inv.expired ? (
                  <Badge tone="warning" dot>
                    Expirado
                  </Badge>
                ) : (
                  <span className="text-[12px] text-muted">expira em {formatDate(inv.expiresAt)}</span>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setConfirm({
                      title: "Reenviar convite?",
                      description: `Um novo e-mail será enviado para ${inv.email}. O link anterior deixa de valer.`,
                      label: "Reenviar",
                      run: () => resendInvitation(inv.id),
                      success: "Convite reenviado",
                    })
                  }
                >
                  Reenviar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setConfirm({
                      title: "Cancelar convite?",
                      description: `O link enviado para ${inv.email} deixa de valer.`,
                      label: "Cancelar convite",
                      danger: true,
                      run: () => revokeInvitation(inv.id),
                      success: "Convite cancelado",
                    })
                  }
                >
                  Cancelar
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {inviting && (
        <InviteUserDialog
          organizationId={organization.id}
          organizationName={organization.name}
          roles={roles}
          onClose={() => setInviting(false)}
          onInvited={() => {
            setInviting(false);
            toast({ tone: "success", title: "Convite enviado", description: "A pessoa recebe o link por e-mail." });
            reload();
          }}
        />
      )}

      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => !open && !busy && setConfirm(null)}
        size="sm"
        title={confirm?.title ?? ""}
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirm(null)}>
              Voltar
            </Button>
            <Button variant={confirm?.danger ? "danger" : "primary"} loading={busy} onClick={runConfirm}>
              {confirm?.label}
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-muted">{confirm?.description}</p>
      </Dialog>
    </div>
  );
}

function InviteUserDialog({
  organizationId,
  organizationName,
  roles,
  onClose,
  onInvited,
}: {
  organizationId: string;
  organizationName: string;
  roles: readonly Role[];
  onClose: () => void;
  onInvited: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>(roles[roles.length - 1]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function onSubmit(event?: FormEvent) {
    event?.preventDefault();
    setSending(true);
    setError(null);
    const result = await inviteUser({ email, fullName, role, organizationId });
    setSending(false);
    if (!result.ok) return setError(result.error);
    onInvited();
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !sending && onClose()}
      title="Convidar usuário"
      description={`Para ${organizationName}. O acesso é pessoal; a pessoa define a senha, aceita os termos e cadastra o MFA no primeiro acesso.`}
      footer={
        <>
          <Button variant="ghost" disabled={sending} onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={sending} onClick={() => onSubmit()}>
            Enviar convite
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {error && <Callout tone="danger" title={error} />}
        <Field label="Nome completo" requirement="required">
          {(p) => <Input {...p} autoComplete="off" value={fullName} onChange={(e) => setFullName(e.target.value)} />}
        </Field>
        <Field label="E-mail" requirement="required">
          {(p) => <Input {...p} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label="Papel" requirement="required" hint={ROLE_DESCRIPTION[role]}>
          {(p) => (
            <Select {...p} value={role} options={roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} onChange={(e) => setRole(e.target.value as Role)} />
          )}
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
