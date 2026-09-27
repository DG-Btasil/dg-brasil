"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Check, Compass, LogOut, RotateCcw, Settings, UserRoundCog } from "lucide-react";
import { cn } from "@/lib/cn";
import { ROLE_LABEL, ROLES, type Role } from "@/lib/permissions";
import { useDismiss } from "@/lib/hooks/use-dismiss";
import { useCurrentUser, usePermission, useSessionActions } from "@/features/auth/hooks";
import { useOffice } from "@/features/offices/hooks";
import { useToast, useUiStore } from "@/store/ui-store";
import { Avatar } from "@/components/ui/display";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

/** Ferramentas de simulação só aparecem no protótipo (desligáveis por env). */
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE !== "false";

export function UserMenu() {
  const user = useCurrentUser();
  const office = useOffice();
  const router = useRouter();
  const toast = useToast();
  const startTour = useUiStore((s) => s.startTour);
  const { simulateRole, resetDemo, logout } = useSessionActions();
  const canSettings = usePermission("settings.view");
  const canDemo = usePermission("demo.tools");
  const [open, setOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useDismiss(ref, open, (reason) => {
    setOpen(false);
    if (reason === "escape") buttonRef.current?.focus();
  });

  if (!user) return null;

  function onSimulate(role: Role) {
    simulateRole(role);
    setOpen(false);
    toast({ tone: "info", title: `Perfil simulado: ${ROLE_LABEL[role]}`, description: "A interface foi ajustada às permissões deste perfil." });
    router.push("/home");
  }

  const item = "flex w-full items-center gap-2.5 px-4 py-2 text-left text-[13px] text-foreground hover:bg-surface-muted focus:bg-surface-muted focus:outline-none";

  return (
    <div ref={ref} className="relative" data-tour="user-menu">
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Menu do usuário — ${user.name}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className={cn("flex items-center gap-2.5 rounded-md py-1 pl-1 pr-2.5 transition-colors hover:bg-white/10", open && "bg-white/10")}
      >
        <Avatar name={user.name} size="sm" tone="gold" />
        <span className="hidden text-left leading-tight xl:block">
          <span className="block text-[12.5px] font-medium text-white">{user.displayName}</span>
          <span className="block text-[11px] text-white/60">{ROLE_LABEL[user.role]}</span>
        </span>
      </button>

      {open && (
        <div role="menu" aria-label="Menu do usuário" className="absolute right-0 top-[calc(100%+10px)] z-50 w-[300px] overflow-hidden rounded-lg border border-line bg-surface text-foreground shadow-overlay animate-panel-down">
          <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
            <Avatar name={user.name} size="md" tone="navy" />
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-semibold">{user.name}</p>
              <p className="truncate text-[12px] text-muted">{user.email}</p>
              <p className="mt-0.5 truncate text-[11.5px] text-subtle">
                {ROLE_LABEL[user.role]} · {office.name}
              </p>
            </div>
          </div>
          <div className="py-1.5">
            {canSettings && (
              <Link role="menuitem" href="/configuracoes" className={item} onClick={() => setOpen(false)}>
                <Settings className="size-4 text-subtle" aria-hidden /> Configurações
              </Link>
            )}
            <button
              role="menuitem"
              type="button"
              className={item}
              onClick={() => {
                setOpen(false);
                router.push("/home");
                startTour();
              }}
            >
              <Compass className="size-4 text-subtle" aria-hidden /> Conhecer o DG Brasil
            </button>
          </div>

          {DEMO_MODE && canDemo && (
            <div className="border-t border-line bg-surface-muted/60 py-1.5">
              <p className="flex items-center gap-2 px-4 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-muted">
                <UserRoundCog className="size-3.5" aria-hidden /> Simular perfil
              </p>
              {ROLES.map((role) => (
                <button key={role} role="menuitemradio" aria-checked={user.role === role} type="button" className={item} onClick={() => onSimulate(role)}>
                  <span className="flex size-4 items-center justify-center">{user.role === role && <Check className="size-4 text-navy" aria-hidden />}</span>
                  {ROLE_LABEL[role]}
                </button>
              ))}
              <button
                role="menuitem"
                type="button"
                className={cn(item, "mt-1 border-t border-line pt-2.5")}
                onClick={() => {
                  setOpen(false);
                  setConfirmReset(true);
                }}
              >
                <RotateCcw className="size-4 text-subtle" aria-hidden /> Restaurar dados de demonstração
              </button>
            </div>
          )}

          <div className="border-t border-line py-1.5">
            <button
              role="menuitem"
              type="button"
              className={item}
              onClick={() => {
                logout();
                router.push("/login");
              }}
            >
              <LogOut className="size-4 text-subtle" aria-hidden /> Sair
            </button>
          </div>
        </div>
      )}

      <Dialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        size="sm"
        title="Restaurar dados de demonstração?"
        description="Todos os clientes, processos, revisões e configurações criados nesta demonstração serão substituídos pelos dados originais."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmReset(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                resetDemo();
                setConfirmReset(false);
                toast({ tone: "success", title: "Dados de demonstração restaurados" });
                router.push("/home");
              }}
            >
              Restaurar
            </Button>
          </>
        }
      />
    </div>
  );
}
