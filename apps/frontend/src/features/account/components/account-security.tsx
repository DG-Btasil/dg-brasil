"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { KeyRound, LogOut, Monitor, Smartphone, Tablet } from "lucide-react";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { AUTH_ROUTES } from "@/lib/auth/redirects";
import { formatDate, formatDateTime } from "@/lib/formatting";
import { ActionErrorState } from "@/components/feedback/action-error";
import { Callout, SkeletonRows } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { hardNavigate } from "@/features/auth/components/navigation";
import { signOut } from "@/server/auth/actions";
import { getAccountSecurityAction, signOutAllSessionsAction, signOutOtherSessionsAction } from "@/server/domain/account/actions";
import type { AccountSecurityDTO, AccountSessionDTO } from "@/server/domain/account/security";
import { useToast } from "@/store/ui-store";

const CONFIRM_WORD = "SAIR";

/**
 * Segurança da PRÓPRIA conta (4.3.2), para todos os papéis: senha, verificação
 * em duas etapas e sessões abertas. Encerrar uma sessão ESPECÍFICA de outro
 * aparelho não é oferecido: o Supabase Auth não tem API oficial para isso.
 */
export function AccountSecurity() {
  const [result, setResult] = useState<ActionResult<AccountSecurityDTO> | null>(null);
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);

  useEffect(() => {
    let alive = true;
    callAction(() => getAccountSecurityAction()).then((r) => alive && setResult(r));
    return () => {
      alive = false;
    };
  }, [version]);

  return (
    <div className="space-y-5">
      <Panel>
        <PanelHeader title="Senha e verificação em duas etapas" />
        <PanelBody>
          <ul className="divide-y divide-line">
            <li className="flex items-center gap-4 py-3 first:pt-0">
              <KeyRound className="size-4 shrink-0 text-navy-700" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-foreground">Senha</p>
                <p className="text-[12px] text-muted">Ao trocar a senha, os outros dispositivos saem da conta; este continua.</p>
              </div>
              <Link href={AUTH_ROUTES.newPassword} className="text-[13px] font-medium text-navy-700 underline-offset-4 hover:underline">
                Alterar senha
              </Link>
            </li>
            <li className="flex items-center gap-4 py-3 last:pb-0">
              <Smartphone className="size-4 shrink-0 text-navy-700" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-foreground">Verificação em duas etapas</p>
                <p className="text-[12px] text-muted">
                  {result?.ok && result.data.mfa.factors[0]
                    ? `Aplicativo autenticador${result.data.mfa.factors[0].name ? ` (${result.data.mfa.factors[0].name})` : ""}, ativo desde ${formatDate(result.data.mfa.factors[0].createdAt)}.`
                    : "Aplicativo autenticador (obrigatório)."}{" "}
                  Para trocar de aparelho, peça ao administrador do escritório que redefina a verificação.
                </p>
              </div>
              {result?.ok && (result.data.mfa.enabled ? <Badge tone="success" dot>Ativa</Badge> : <Badge tone="warning" dot>Pendente</Badge>)}
            </li>
          </ul>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Sessões e dispositivos" description="Onde sua conta está aberta agora." />
        {!result ? (
          <SkeletonRows rows={3} />
        ) : !result.ok ? (
          <ActionErrorState error={result} onRetry={reload} title="Não foi possível carregar as sessões." />
        ) : (
          <SessionsPanel sessions={result.data.sessions} onChanged={reload} />
        )}
      </Panel>
    </div>
  );
}

function SessionsPanel({ sessions, onChanged }: { sessions: AccountSessionDTO[]; onChanged: () => void }) {
  const others = sessions.filter((s) => !s.current);
  const [confirm, setConfirm] = useState<"others" | "all" | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [leaving, startLeaving] = useTransition();
  const toast = useToast();
  const failed = useActionFeedback();

  function close() {
    setConfirm(null);
    setTyped("");
  }

  async function run() {
    setBusy(true);
    if (confirm === "others") {
      const r = await callAction(() => signOutOtherSessionsAction());
      setBusy(false);
      if (!r.ok) return failed(r, "Não foi possível encerrar as outras sessões.");
      close();
      toast({ tone: "success", title: "Outras sessões encerradas", description: "Os outros dispositivos precisarão entrar de novo." });
      onChanged();
    } else {
      const r = await callAction(() => signOutAllSessionsAction());
      if (!r.ok) {
        setBusy(false);
        return failed(r, "Não foi possível sair de todos os dispositivos.");
      }
      hardNavigate(`${AUTH_ROUTES.login}?aviso=saiu-todos`);
    }
  }

  return (
    <PanelBody className="space-y-4">
      <ul className="divide-y divide-line">
        {sessions.map((s) => (
          <SessionItem key={s.ref} session={s} />
        ))}
      </ul>
      <p className="text-[12px] text-muted">
        &ldquo;Última atividade&rdquo; é aproximada: o navegador renova o acesso cerca de uma vez por hora enquanto está aberto. Não guardamos IP nem identificamos o aparelho além do
        navegador e do sistema.
      </p>
      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <Button variant="secondary" icon={<LogOut className="size-4" />} loading={leaving} onClick={() => startLeaving(() => signOut())}>
          Sair deste dispositivo
        </Button>
        <Button variant="secondary" disabled={!others.length} onClick={() => setConfirm("others")}>
          Sair de todos os outros dispositivos
        </Button>
        <Button variant="danger" onClick={() => setConfirm("all")}>
          Sair de todos os dispositivos
        </Button>
      </div>
      {!others.length && <p className="text-[12px] text-muted">Nenhum outro dispositivo com a sua conta aberta.</p>}

      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => !open && !busy && close()}
        size="sm"
        title={confirm === "all" ? "Sair de todos os dispositivos?" : "Sair dos outros dispositivos?"}
        description={
          confirm === "all"
            ? "Todas as sessões serão encerradas, inclusive esta. Você volta para o login e precisará da senha e do código do autenticador."
            : `${others.length === 1 ? "A outra sessão será encerrada" : `As ${others.length} outras sessões serão encerradas`}. Este dispositivo continua conectado.`
        }
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={close}>
              Cancelar
            </Button>
            <Button variant="danger" loading={busy} disabled={confirm === "all" && typed.trim().toUpperCase() !== CONFIRM_WORD} onClick={run}>
              {confirm === "all" ? "Sair de todos" : "Encerrar outras sessões"}
            </Button>
          </>
        }
      >
        {confirm === "all" ? (
          <Field label={`Digite ${CONFIRM_WORD} para confirmar`}>
            {(field) => <Input {...field} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoFocus />}
          </Field>
        ) : (
          <Callout tone="info">Um acesso já aberto em outro aparelho perde o acesso aos dados na hora; a tela dele pede para entrar de novo.</Callout>
        )}
      </Dialog>
    </PanelBody>
  );
}

const DEVICE_ICON = { DESKTOP: Monitor, MOBILE: Smartphone, TABLET: Tablet } as const;

function SessionItem({ session: s }: { session: AccountSessionDTO }) {
  const Icon = DEVICE_ICON[s.device ?? "DESKTOP"];
  return (
    <li className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
      <Icon className="size-4 shrink-0 text-navy-700" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-foreground">
          {s.label}
          {s.current && (
            <Badge tone="success" dot className="ml-2 align-middle">
              Este dispositivo
            </Badge>
          )}
        </p>
        <p className="text-[12px] text-muted">
          Entrou em {formatDateTime(s.createdAt)}
          {s.lastActivityAt && ` · Última atividade ${formatDateTime(s.lastActivityAt)}`}
          {!s.mfaVerified && " · Sem verificação em duas etapas concluída"}
        </p>
      </div>
    </li>
  );
}
