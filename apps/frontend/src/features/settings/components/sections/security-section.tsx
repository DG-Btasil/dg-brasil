"use client";

import { useMemo, type ReactNode } from "react";
import { KeyRound, ShieldCheck, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { NotAvailable } from "@/components/ui/tooltip";
import { Callout } from "@/components/feedback/states";
import { useUserMap, useUserSessions } from "@/features/offices/hooks";
import { formatEventTime } from "@/lib/formatting";
import { SectionHeader } from "../section-header";
import { AuditLog } from "./audit-log";

export function SecuritySection() {
  const sessions = useUserSessions();
  const userMap = useUserMap();
  const sorted = useMemo(() => [...sessions].sort((a, b) => Number(b.current) - Number(a.current) || b.lastActiveAt.localeCompare(a.lastActiveAt)), [sessions]);

  return (
    <div className="space-y-5">
      <SectionHeader title="Segurança e auditoria" description="Sessões ativas, postura de segurança e registro de atividades do escritório." />

      <Callout tone="neutral" title="Protótipo de demonstração">
        Este protótipo não armazena dados reais. A conformidade com a LGPD será tratada no backend (criptografia, retenção, segregação por escritório).
      </Callout>

      <Panel>
        <PanelHeader title="Sessões ativas" description="Dispositivos com acesso recente ao escritório." />
        <Table caption="Sessões ativas">
          <THead>
            <tr>
              <Th>Usuário</Th>
              <Th>Dispositivo</Th>
              <Th>Localização</Th>
              <Th>Última atividade</Th>
              <Th>
                <span className="sr-only">Ações</span>
              </Th>
            </tr>
          </THead>
          <TBody>
            {sorted.map((s) => (
              <Tr key={s.id}>
                <Td className="text-foreground">{userMap.get(s.userId)?.name ?? "Usuário"}</Td>
                <Td>
                  <span className="text-foreground">{s.device}</span>
                  {s.current && (
                    <Badge tone="success" dot className="ml-2">
                      Sessão atual
                    </Badge>
                  )}
                </Td>
                <Td className="text-muted">{s.location}</Td>
                <Td className="tabular text-muted">{formatEventTime(s.lastActiveAt)}</Td>
                <Td className="text-right">
                  {!s.current && (
                    <NotAvailable>
                      <Button size="sm" variant="ghost">
                        Encerrar
                      </Button>
                    </NotAvailable>
                  )}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Panel>

      <Panel>
        <PanelHeader title="Postura de segurança" />
        <PanelBody>
          <ul className="divide-y divide-line">
            <PostureItem
              icon={Smartphone}
              title="Autenticação em dois fatores"
              description="Exigir segundo fator para todos os usuários do escritório."
              status={<Badge tone="neutral">Não configurado</Badge>}
              action={
                <NotAvailable>
                  <Button size="sm" variant="secondary">
                    Configurar
                  </Button>
                </NotAvailable>
              }
            />
            <PostureItem
              icon={KeyRound}
              title="Credenciais de integrações"
              description="Nunca armazenadas no navegador; ficarão criptografadas no backend."
              status={<Badge tone="navy">Planejado</Badge>}
            />
            <PostureItem
              icon={ShieldCheck}
              title="Controle de acesso por papel"
              description="Cada seção e ação exige permissão. No backend, a mesma regra valerá no servidor."
              status={<Badge tone="success" dot>Ativo na interface</Badge>}
            />
          </ul>
        </PanelBody>
      </Panel>

      <AuditLog />
    </div>
  );
}

function PostureItem({
  icon: Icon,
  title,
  description,
  status,
  action,
}: {
  icon: typeof ShieldCheck;
  title: string;
  description: string;
  status: ReactNode;
  action?: ReactNode;
}) {
  return (
    <li className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
      <Icon className="size-4 shrink-0 text-navy-700" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-foreground">{title}</p>
        <p className="text-[12px] text-muted">{description}</p>
      </div>
      {status}
      {action}
    </li>
  );
}
