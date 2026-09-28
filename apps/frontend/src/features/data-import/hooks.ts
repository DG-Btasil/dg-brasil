"use client";

import { useCallback, useMemo } from "react";
import { repositories } from "@/repositories";
import { useAppStore } from "@/store/app-store";
import { useScopedStore } from "@/store/scope";
import type { ImportPlan, ImportResult } from "@/store/types";
import { useToast } from "@/store/ui-store";
import type { AuditEvent } from "@/types";
import type { AnalysisContext } from "./analyze";

/** Dados existentes usados para detectar conflitos (CPF/CNPJ, CNJ) e casar responsáveis. */
export function useImportContext(): AnalysisContext & { currentUserId: string } {
  const clients = useScopedStore((s) => s.clients);
  const processes = useScopedStore((s) => s.processes);
  const users = useScopedStore((s) => s.users);
  const currentUserId = useAppStore((s) => s.session.currentUserId);
  return useMemo(() => ({ clients, processes, users: users.filter((u) => u.status === "ACTIVE"), currentUserId }), [clients, processes, users, currentUserId]);
}

/** Última importação registrada na auditoria. */
export function useLastImport(): AuditEvent | undefined {
  const audit = useScopedStore((s) => s.auditEvents);
  return useMemo(() => audit.find((e) => e.action === "DATA_IMPORTED"), [audit]);
}

export function useRunImport() {
  const toast = useToast();
  return useCallback(
    async (plan: ImportPlan): Promise<ImportResult | null> => {
      try {
        const result = await repositories.imports.run(plan);
        toast({ tone: "success", title: "Importação concluída", description: `${plan.fileName} · registrada na auditoria.` });
        return result;
      } catch {
        toast({ tone: "danger", title: "Não foi possível concluir a importação.", description: "Nenhum dado foi alterado." });
        return null;
      }
    },
    [toast],
  );
}
