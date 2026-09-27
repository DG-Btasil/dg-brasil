"use client";

import { useMemo, useState } from "react";
import { UserPlus } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Avatar } from "@/components/ui/display";
import { Select } from "@/components/ui/form";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { useCurrentUser } from "@/features/auth/hooks";
import { useInvitations, useUsers } from "@/features/offices/hooks";
import { USER_STATUS_LABEL, USER_STATUS_TONE } from "@/lib/constants/status";
import { formatDate, formatEventTime } from "@/lib/formatting";
import { ROLES, ROLE_DESCRIPTION, ROLE_LABEL, type Role } from "@/lib/permissions";
import type { User } from "@/types";
import { useSettingsActions } from "../../hooks";
import { SectionHeader } from "../section-header";
import { CopyInviteButton, InviteDialog } from "./invite-dialog";
import { PermissionMatrix } from "./permission-matrix";

const ROLE_OPTIONS = ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }));

export function TeamSection() {
  const users = useUsers();
  const invitations = useInvitations();
  const me = useCurrentUser();
  const { changeRole } = useSettingsActions();
  const [inviting, setInviting] = useState(false);
  const [pending, setPending] = useState<{ user: User; role: Role } | null>(null);
  const [saving, setSaving] = useState(false);

  const openInvites = useMemo(() => invitations.filter((i) => !i.acceptedAt), [invitations]);

  async function confirmRole() {
    if (!pending) return;
    setSaving(true);
    await changeRole(pending.user.id, pending.role, pending.user.name);
    setSaving(false);
    setPending(null);
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Equipe e permissões"
        description="Usuários do escritório e seus papéis. O papel define o que cada pessoa vê e faz."
        actions={
          <Button icon={<UserPlus className="size-4" aria-hidden />} onClick={() => setInviting(true)}>
            Convidar usuário
          </Button>
        }
      />

      <Panel>
        <PanelHeader title="Usuários" actions={<span className="text-[12px] text-muted tabular">{users.length} usuários</span>} />
        <Table caption="Usuários do escritório">
          <THead>
            <tr>
              <Th>Nome</Th>
              <Th>E-mail</Th>
              <Th className="w-[190px]">Papel</Th>
              <Th>Status</Th>
              <Th>Último acesso</Th>
            </tr>
          </THead>
          <TBody>
            {users.map((u) => {
              const isMe = u.id === me?.id;
              return (
                <Tr key={u.id}>
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={u.name} size="sm" tone={u.status === "ACTIVE" ? "navy" : "neutral"} />
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">
                          {u.name}
                          {isMe && <span className="ml-1.5 text-[11.5px] font-normal text-muted">(você)</span>}
                        </p>
                        {u.title && <p className="text-[12px] text-muted">{u.title}</p>}
                      </div>
                    </div>
                  </Td>
                  <Td className="text-muted">{u.email}</Td>
                  <Td>
                    {isMe ? (
                      <span title="Você não pode alterar o próprio papel">{ROLE_LABEL[u.role]}</span>
                    ) : (
                      <label>
                        <span className="sr-only">Papel de {u.name}</span>
                        <Select
                          value={u.role}
                          options={ROLE_OPTIONS}
                          className="h-8"
                          onChange={(e) => {
                            const role = e.target.value as Role;
                            if (role !== u.role) setPending({ user: u, role });
                          }}
                        />
                      </label>
                    )}
                  </Td>
                  <Td>
                    <StatusBadge status={u.status} labels={USER_STATUS_LABEL} tones={USER_STATUS_TONE} />
                  </Td>
                  <Td className="tabular text-muted">{u.lastAccessAt ? formatEventTime(u.lastAccessAt) : "Nunca acessou"}</Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </Panel>

      {openInvites.length > 0 && (
        <Panel>
          <PanelHeader title="Convites pendentes" description="Links ainda não utilizados." />
          <ul className="divide-y divide-line">
            {openInvites.map((inv) => (
              <li key={inv.id} className="flex items-center gap-4 px-5 py-3 text-[13px]">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground">{inv.name ?? inv.email}</p>
                  <p className="text-[12px] text-muted">
                    {inv.email} · {ROLE_LABEL[inv.role]} · criado em {formatDate(inv.createdAt)}
                  </p>
                </div>
                <code className="rounded-xs bg-surface-sunken px-1.5 py-0.5 text-[12px] text-muted">/convite/{inv.token}</code>
                <CopyInviteButton token={inv.token} size="sm" />
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <PermissionMatrix />

      <InviteDialog open={inviting} onOpenChange={setInviting} />

      <Dialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        size="sm"
        title="Alterar papel"
        description={pending ? `${pending.user.name}: ${ROLE_LABEL[pending.user.role]} → ${ROLE_LABEL[pending.role]}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancelar
            </Button>
            <Button loading={saving} onClick={confirmRole}>
              Confirmar alteração
            </Button>
          </>
        }
      >
        {pending && (
          <p className="text-[13px] leading-relaxed text-muted">
            {ROLE_DESCRIPTION[pending.role]} A alteração vale imediatamente e fica registrada na auditoria.
          </p>
        )}
      </Dialog>
    </div>
  );
}
