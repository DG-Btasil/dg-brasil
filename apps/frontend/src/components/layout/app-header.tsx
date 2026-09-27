"use client";

import Link from "next/link";
import { Settings } from "lucide-react";
import { usePermission } from "@/features/auth/hooks";
import { HomeMenu } from "@/components/navigation/home-menu";
import { NotificationCenter } from "./notification-center";
import { DEMO_MODE, UserMenu } from "./user-menu";
import { Wordmark } from "./wordmark";

/** Header global persistente. Navegação no topo — sem sidebar. */
export function AppHeader() {
  const canSettings = usePermission("settings.view");
  return (
    <header className="sticky top-0 z-40 h-[var(--header-height)] bg-navy text-white shadow-[0_1px_0_rgb(0_0_0/0.2)]">
      <div className="mx-auto grid h-full max-w-[1600px] grid-cols-[1fr_auto_1fr] items-center px-8">
        <div className="flex items-center gap-4">
          <Link href="/home" aria-label="DG Brasil — ir para a Home" className="rounded-sm">
            <Wordmark />
          </Link>
          {DEMO_MODE && (
            <span className="hidden rounded-xs border border-gold/40 px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-gold-300 lg:inline">
              Demonstração
            </span>
          )}
        </div>

        <HomeMenu />

        <div className="flex items-center justify-end gap-1">
          <NotificationCenter />
          {canSettings && (
            <Link
              href="/configuracoes"
              aria-label="Configurações"
              title="Configurações"
              data-tour="settings"
              className="inline-flex size-9 items-center justify-center rounded-md text-white/75 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Settings className="size-[18px]" aria-hidden />
            </Link>
          )}
          <span aria-hidden className="mx-2 h-6 w-px bg-white/15" />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
