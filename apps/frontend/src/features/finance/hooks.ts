"use client";

import { useCallback, useMemo } from "react";
import { summarizeAgreement } from "@/lib/domain/finance";
import { repositories } from "@/repositories";
import { useAppStore } from "@/store/app-store";
import type { NewAgreementInput, NewFeeModelInput } from "@/store/types";
import { useToast } from "@/store/ui-store";
import type { Client, FeeModel, ID, Process } from "@/types";
import { agreementAppliesToProcess, clientLabel, type AgreementRow } from "./utils";

/* ------------------------------------------------------------------ */
/* Leitura                                                             */
/* ------------------------------------------------------------------ */

export function useFeeModels(): FeeModel[] {
  return useAppStore((s) => s.feeModels);
}

export function useFeeModel(id: ID | undefined): FeeModel | undefined {
  const models = useFeeModels();
  return useMemo(() => models.find((m) => m.id === id), [models, id]);
}

export function usePayments() {
  return useAppStore((s) => s.payments);
}

function useClients(): Client[] {
  return useAppStore((s) => s.clients);
}

function useProcesses(): Process[] {
  return useAppStore((s) => s.processes);
}

export function useClientOptions(): { value: ID; label: string }[] {
  const clients = useClients();
  return useMemo(
    () => clients.map((c) => ({ value: c.id, label: clientLabel(c) })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    [clients],
  );
}

/** Processos do cliente, para o seletor opcional de processo. */
export function useClientProcesses(clientId: ID | undefined): Process[] {
  const processes = useProcesses();
  return useMemo(() => (clientId ? processes.filter((p) => p.clientId === clientId) : []), [processes, clientId]);
}

export function useProcessForFinance(processId: ID | undefined): Process | undefined {
  const processes = useProcesses();
  return useMemo(() => processes.find((p) => p.id === processId), [processes, processId]);
}

/** Contratos consolidados (acordo + pagamentos + cliente + processo + modelo). */
export function useAgreementRows(): AgreementRow[] {
  const agreements = useAppStore((s) => s.agreements);
  const payments = usePayments();
  const clients = useClients();
  const processes = useProcesses();
  const feeModels = useFeeModels();
  return useMemo(() => {
    const clientMap = new Map(clients.map((c) => [c.id, c]));
    const processMap = new Map(processes.map((p) => [p.id, p]));
    const modelMap = new Map(feeModels.map((m) => [m.id, m]));
    return agreements.map((agreement) => ({
      ...summarizeAgreement(agreement, payments),
      clientName: clientLabel(clientMap.get(agreement.clientId)),
      process: agreement.processId ? processMap.get(agreement.processId) : undefined,
      feeModel: agreement.feeModelId ? modelMap.get(agreement.feeModelId) : undefined,
      payments: payments.filter((p) => p.agreementId === agreement.id).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    }));
  }, [agreements, payments, clients, processes, feeModels]);
}

/** Contratos aplicáveis a um processo (diretos ou do cliente inteiro). */
export function useProcessFinance(processId: ID) {
  const rows = useAgreementRows();
  const process = useProcessForFinance(processId);
  const clients = useClients();
  return useMemo(() => {
    const client = process ? clients.find((c) => c.id === process.clientId) : undefined;
    const applicable = process ? rows.filter((r) => agreementAppliesToProcess(r.agreement, process)) : [];
    return { process, clientName: clientLabel(client), rows: applicable };
  }, [rows, process, clients]);
}

/* ------------------------------------------------------------------ */
/* Ações (via repositórios, com feedback)                              */
/* ------------------------------------------------------------------ */

export function useFinanceActions() {
  const toast = useToast();

  const registerPayment = useCallback(
    async (paymentId: ID, description: string) => {
      try {
        await repositories.finance.registerPayment(paymentId);
        toast({ tone: "success", title: "Pagamento registrado", description });
      } catch {
        toast({ tone: "danger", title: "Não foi possível registrar o pagamento." });
      }
    },
    [toast],
  );

  const createAgreement = useCallback(
    async (input: NewAgreementInput): Promise<ID | null> => {
      try {
        const id = await repositories.finance.createAgreement(input);
        toast({ tone: "success", title: "Contrato de honorários criado", description: "O cronograma de pagamentos foi gerado." });
        return id;
      } catch {
        toast({ tone: "danger", title: "Não foi possível criar o contrato." });
        return null;
      }
    },
    [toast],
  );

  const saveFeeModel = useCallback(
    async (input: NewFeeModelInput, id?: ID): Promise<boolean> => {
      try {
        if (id) await repositories.finance.updateFeeModel(id, input);
        else await repositories.finance.createFeeModel(input);
        toast({ tone: "success", title: id ? "Modelo de honorários atualizado" : "Modelo de honorários criado", description: input.name });
        return true;
      } catch {
        toast({ tone: "danger", title: "Não foi possível salvar o modelo." });
        return false;
      }
    },
    [toast],
  );

  return { registerPayment, createAgreement, saveFeeModel };
}
