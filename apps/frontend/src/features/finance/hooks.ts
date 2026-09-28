"use client";

import { useCallback, useMemo } from "react";
import { todayISO } from "@/lib/clock";
import { summarizeAgreement, toPaymentView } from "@/lib/domain/finance";
import { repositories } from "@/repositories";
import { useScopedStore } from "@/store/scope";
import type { NewAgreementInput, NewFeeModelInput } from "@/store/types";
import { useToast } from "@/store/ui-store";
import type { Client, FeeModel, ID, Process } from "@/types";
import { agreementAppliesToProcess, clientLabel, type AgreementRow } from "./utils";

/* ------------------------------------------------------------------ */
/* Leitura                                                             */
/* ------------------------------------------------------------------ */

export function useFeeModels(): FeeModel[] {
  return useScopedStore((s) => s.feeModels);
}

export function useFeeModel(id: ID | undefined): FeeModel | undefined {
  const models = useFeeModels();
  return useMemo(() => models.find((m) => m.id === id), [models, id]);
}

export function usePayments() {
  return useScopedStore((s) => s.payments);
}

function useClients(): Client[] {
  return useScopedStore((s) => s.clients);
}

function useProcesses(): Process[] {
  return useScopedStore((s) => s.processes);
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

/**
 * Contratos consolidados (acordo + pagamentos + cliente + processo + modelo).
 * Status de parcela e de contrato são DERIVADOS aqui, a partir dos mesmos
 * arrays do store (fonte única). Tabela, drawer, KPIs e gráficos usam estas
 * linhas, então todos mudam juntos quando um pagamento é registrado.
 */
export function useAgreementRows(): AgreementRow[] {
  const agreements = useScopedStore((s) => s.agreements);
  const payments = usePayments();
  const clients = useClients();
  const processes = useProcesses();
  const feeModels = useFeeModels();
  const removedClients = useScopedStore((s) => s.removedClients);
  return useMemo(() => {
    const clientMap = new Map(clients.map((c) => [c.id, c]));
    // Contrato de cliente excluído continua visível (histórico financeiro), identificado.
    const removedMap = new Map(removedClients.map((r) => [r.id, `${r.name} (cliente removido)`]));
    const processMap = new Map(processes.map((p) => [p.id, p]));
    const modelMap = new Map(feeModels.map((m) => [m.id, m]));
    const today = todayISO();
    return agreements.map((agreement) => ({
      ...summarizeAgreement(agreement, payments, today),
      clientName: removedMap.get(agreement.clientId) ?? clientLabel(clientMap.get(agreement.clientId)),
      process: agreement.processId ? processMap.get(agreement.processId) : undefined,
      feeModel: agreement.feeModelId ? modelMap.get(agreement.feeModelId) : undefined,
      payments: payments
        .filter((p) => p.agreementId === agreement.id)
        .map((p) => toPaymentView(p, today))
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    }));
  }, [agreements, payments, clients, processes, feeModels, removedClients]);
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

  /** Sem `amount`, quita o saldo da parcela; com `amount`, registra recebimento parcial. */
  const registerPayment = useCallback(
    async (paymentId: ID, description: string, amount?: number) => {
      try {
        await repositories.finance.registerPayment(paymentId, { amount });
        toast({ tone: "success", title: "Pagamento registrado", description });
      } catch {
        toast({ tone: "danger", title: "Não foi possível registrar o pagamento." });
      }
    },
    [toast],
  );

  const updatePaymentAmount = useCallback(
    async (paymentId: ID, paidAmount: number) => {
      try {
        await repositories.finance.updatePaymentAmount(paymentId, paidAmount);
        toast({ tone: "success", title: "Valor recebido alterado", description: "A alteração ficou registrada na auditoria." });
      } catch {
        toast({ tone: "danger", title: "Não foi possível alterar o pagamento." });
      }
    },
    [toast],
  );

  const reversePayment = useCallback(
    async (paymentId: ID) => {
      try {
        await repositories.finance.reversePayment(paymentId);
        toast({ tone: "info", title: "Pagamento estornado", description: "A parcela voltou a ficar em aberto." });
      } catch {
        toast({ tone: "danger", title: "Não foi possível estornar o pagamento." });
      }
    },
    [toast],
  );

  const updatePaymentDueDate = useCallback(
    async (paymentId: ID, dueDate: string) => {
      try {
        await repositories.finance.updatePaymentDueDate(paymentId, dueDate);
        toast({ tone: "success", title: "Vencimento alterado" });
      } catch {
        toast({ tone: "danger", title: "Não foi possível alterar o vencimento." });
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

  return { registerPayment, updatePaymentAmount, reversePayment, updatePaymentDueDate, createAgreement, saveFeeModel };
}
