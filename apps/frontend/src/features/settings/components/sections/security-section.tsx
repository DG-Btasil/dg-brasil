"use client";

import { type ReactNode } from "react";
import { KeyRound, ShieldCheck, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { SectionHeader } from "../section-header";
import { AuditLog } from "./audit-log";

/**
 * Segurança e auditoria (ADMIN): postura REAL da plataforma e o registro de
 * auditoria do banco. Sessões não são listadas aqui (o Supabase Auth não as
 * expõe pela API do produto); cada usuário encerra a própria sessão ao sair.
 */
export function SecuritySection() {
  return (
    <div className="space-y-5">
      <SectionHeader title="Segurança e auditoria" description="Postura de segurança e registro de atividades do escritório." />

      <Panel>
        <PanelHeader title="Postura de segurança" />
        <PanelBody>
          <ul className="divide-y divide-line">
            <PostureItem
              icon={Smartphone}
              title="Autenticação em dois fatores"
              description="Obrigatória para todos os usuários (aplicativo autenticador). Sem MFA, nenhuma tela nem dado é liberado."
              status={<Badge tone="success" dot>Ativo</Badge>}
            />
            <PostureItem
              icon={ShieldCheck}
              title="Controle de acesso por papel"
              description="Cada ação passa pela permissão no servidor e pela segurança de linha (RLS) no banco; parceiros só veem o próprio escritório."
              status={<Badge tone="success" dot>Ativo</Badge>}
            />
            <PostureItem
              icon={KeyRound}
              title="Credenciais"
              description="Nenhuma chave de serviço chega ao navegador; operações privilegiadas ficam no servidor."
              status={<Badge tone="success" dot>Ativo</Badge>}
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
