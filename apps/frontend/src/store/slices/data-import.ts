import { nowISO } from "@/lib/clock";
import { createId } from "@/lib/ids";
import type { Client, Deadline, Notification, Process, ProcessEvent } from "@/types";
import { actorOf, auditEvent, integrityNotification, type GetState, type SetState } from "../helpers";
import type { ImportActions, ImportResult } from "../types";
import { clientName } from "./clients-analyses";

/** Remove chaves com valor indefinido/vazio, para que atualização não apague dados existentes. */
function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== "")) as Partial<T>;
}

/**
 * Aplica um plano de importação já validado. Uma única importação pode criar
 * ou atualizar clientes, criar ou atualizar processos e vincular um ao outro.
 * Linhas com erro nunca chegam aqui; conflitos já foram resolvidos pelo usuário.
 * No backend: import job transacional com relatório e rollback (ver BACKEND_HANDOFF).
 */
export function createImportSlice(set: SetState, get: GetState): ImportActions {
  return {
    importData: (plan) => {
      const s = get();
      const at = nowISO();
      const actor = actorOf(s);
      const refToId = new Map<string, string>();
      let clients = [...s.clients];
      let processes = [...s.processes];
      const newEvents: ProcessEvent[] = [];
      const newDeadlines: Deadline[] = [];
      const notifications: Notification[] = [];
      const result: ImportResult = {
        clientsCreated: 0,
        clientsUpdated: 0,
        processesCreated: 0,
        processesUpdated: 0,
        linksCreated: 0,
        ignoredRows: plan.ignoredRows,
        errorRows: plan.errorRows,
        processesWithoutResponsible: 0,
      };

      for (const op of plan.clients) {
        if (op.action === "UPDATE" && op.existingId) {
          // Atualização não troca responsável nem observações internas do cadastro existente.
          const { responsibleUserId: _r, notes: _n, ...incoming } = op.input;
          void _r;
          void _n;
          clients = clients.map((c) =>
            c.id === op.existingId
              ? ({
                  ...c,
                  ...definedOnly(incoming),
                  kind: c.kind,
                  status: c.status,
                  contact: { ...c.contact, ...definedOnly(op.input.contact) },
                  address: op.input.address ? { ...c.address, ...op.input.address } : c.address,
                  updatedAt: at,
                } as Client)
              : c,
          );
          refToId.set(op.ref, op.existingId);
          result.clientsUpdated += 1;
        } else {
          const id = createId("cli");
          // Importação interna: origem informada na planilha ou, na falta, o escritório proprietário.
          clients = [
            { ...op.input, originOfficeId: op.input.originOfficeId ?? s.office.id, createdByOfficeId: s.office.id, id, officeId: s.office.id, createdAt: at, updatedAt: at } as Client,
            ...clients,
          ];
          refToId.set(op.ref, id);
          result.clientsCreated += 1;
        }
      }

      for (const op of plan.processes) {
        const clientId = (op.clientRef ? refToId.get(op.clientRef) : undefined) ?? op.clientId ?? "";
        const pendingLink = !clientId;
        if (op.action === "UPDATE") {
          const existing = processes.find((p) => p.id === op.existingId);
          processes = processes.map((p) =>
            p.id === op.existingId
              ? {
                  ...p,
                  ...definedOnly(op.patch),
                  ...(clientId ? { clientId, clientLinkStatus: undefined, removedClientName: undefined } : {}),
                  updatedAt: at,
                }
              : p,
          );
          if (clientId && existing?.clientId !== clientId) result.linksCreated += 1;
          newEvents.push({ id: createId("mov"), officeId: s.office.id, processId: op.existingId, at, title: "Dados atualizados por importação", description: `Arquivo ${plan.fileName}.`, source: "SYSTEM", important: false });
          result.processesUpdated += 1;
          continue;
        }
        const id = createId("prc");
        const { nextDeadline, ...data } = op.input;
        if (nextDeadline) {
          newDeadlines.push({
            id: createId("dl"),
            officeId: s.office.id,
            processId: id,
            clientId,
            title: nextDeadline.title,
            type: nextDeadline.type,
            dueDate: nextDeadline.dueDate,
            responsibleUserId: data.responsibleUserId,
            status: "OPEN",
            createdAt: at,
          });
        }
        const process: Process = {
          ...data,
          id,
          officeId: s.office.id,
          clientId,
          origin: "IMPORT",
          relationshipOrigin: "INTERNAL",
          clientLinkStatus: pendingLink ? "PENDING_LINK" : undefined,
          createdAt: at,
          updatedAt: at,
          lastMovementAt: at,
        };
        processes = [process, ...processes];
        newEvents.push({ id: createId("mov"), officeId: s.office.id, processId: id, at, title: "Processo criado por importação", description: `Arquivo ${plan.fileName}, importado por ${actor.name}.`, source: "SYSTEM", important: false });
        result.processesCreated += 1;
        if (clientId) result.linksCreated += 1;
        if (pendingLink) {
          notifications.push(
            integrityNotification(s, {
              severity: "warning",
              title: "Processo sem cliente ativo",
              description: `${process.title}: importado sem cliente associado. Vincule um cliente.`,
              processId: id,
              cta: { label: "Vincular cliente", href: `/processos/${id}` },
              requiredPermission: "processes.view",
            }),
          );
        }
        if (op.missingResponsible) {
          result.processesWithoutResponsible += 1;
          notifications.push(
            integrityNotification(s, {
              severity: "info",
              title: "Processo importado sem responsável",
              description: `${process.title}${clientId ? ` — ${clientName(clients.find((c) => c.id === clientId))}` : ""}. Defina o advogado responsável.`,
              processId: id,
              cta: { label: "Abrir processo", href: `/processos/${id}` },
              requiredPermission: "processes.view",
            }),
          );
        }
      }

      if (plan.errorRows > 0) {
        notifications.push(
          integrityNotification(s, {
            severity: "warning",
            title: "Importação incompleta",
            description: `${plan.errorRows} linha(s) de ${plan.fileName} não foram importadas por conter erros. Corrija o arquivo e importe novamente.`,
            cta: { label: "Abrir importação", href: "/configuracoes?secao=integracoes" },
            requiredPermission: "settings.integrations.manage",
          }),
        );
      }

      set({
        clients,
        processes,
        processEvents: [...newEvents, ...s.processEvents],
        deadlines: [...newDeadlines, ...s.deadlines],
        notifications: [...notifications, ...s.notifications],
        auditEvents: [
          auditEvent(s, "DATA_IMPORTED", "import", createId("imp"), `Importação de ${plan.fileName} concluída.`, actor, [
            { label: "Clientes criados", value: String(result.clientsCreated) },
            { label: "Clientes atualizados", value: String(result.clientsUpdated) },
            { label: "Processos criados", value: String(result.processesCreated) },
            { label: "Processos atualizados", value: String(result.processesUpdated) },
            { label: "Vínculos cliente ↔ processo", value: String(result.linksCreated) },
            { label: "Linhas ignoradas", value: String(result.ignoredRows) },
            { label: "Linhas com erro (não importadas)", value: String(result.errorRows) },
          ]),
          ...s.auditEvents,
        ],
      });
      return result;
    },
  };
}
