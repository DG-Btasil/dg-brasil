import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import * as audit from "@/server/domain/audit/service";
import { listAuditEventsSchema } from "@/server/domain/audit/schemas";
import * as cases from "@/server/domain/cases/service";
import { createCaseSchema } from "@/server/domain/cases/schemas";
import * as clients from "@/server/domain/clients/service";
import { createClientSchema } from "@/server/domain/clients/schemas";
import * as processes from "@/server/domain/processes/service";
import { createProcessSchema, listProcessesSchema } from "@/server/domain/processes/schemas";
import * as reviews from "@/server/domain/reviews/service";
import { listReviewsSchema } from "@/server/domain/reviews/schemas";
import { auditTimelineInput } from "@/features/audit/query";
import { ctxFor, expectDomainError, fakeCpf, serviceDb, world } from "./support/world";

/**
 * Etapa 4.3, Fase H — leituras novas no Supabase DEV real: filtro de prazo da
 * lista de processos (embed obrigatório dos prazos em aberto), resumo da
 * carteira, revisões por processo e linha do tempo de auditoria de um
 * registro. Dados fictícios.
 */

let caseId = "";
let processId = "";

beforeAll(async () => {
  const lawyer = await ctxFor("LAWYER");
  const { id: clientId } = await clients.createClient(lawyer, createClientSchema.parse({ kind: "INDIVIDUAL", cpf: fakeCpf(), fullName: `Cliente Fase H ${world.run}`, originOfficeId: world.owner }));
  caseId = (
    await cases.createCase(
      lawyer,
      createCaseSchema.parse({ idempotencyKey: randomUUID(), clientId, title: `Caso Fase H ${world.run}`, area: "BANKING", originOrganizationId: world.owner, submit: true }),
    )
  ).id;
  processId = (
    await processes.createProcess(
      lawyer,
      createProcessSchema.parse({
        idempotencyKey: randomUUID(),
        legalCaseId: caseId,
        title: `Processo Fase H ${world.run}`,
        clientPole: "ACTIVE",
        status: "PREPARING",
        phase: "PRELIMINARY",
        responsibleUserId: world.users.LAWYER.id,
        nextDeadline: { title: "Prazo futuro", dueDate: "2030-01-15" },
      }),
    )
  ).id;
  // Prazo VENCIDO (ontem), direto pela service role: o formulário não aceita data passada.
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  const { error } = await serviceDb().from("deadlines").insert({ legal_case_id: caseId, legal_process_id: processId, title: "Prazo vencido Fase H", due_at: yesterday });
  if (error) throw new Error(`prazo: ${error.message}`);
});

describe("processos — filtro de prazo e resumo (Fase H)", () => {
  it("OVERDUE e NEXT_5_DAYS trazem o processo; o total conta processo, não prazo", async () => {
    const lawyer = await ctxFor("LAWYER");
    for (const deadline of ["OVERDUE", "NEXT_5_DAYS"] as const) {
      const page = await processes.listProcesses(lawyer, listProcessesSchema.parse({ caseId, deadline }));
      expect(page.items.map((p) => p.id)).toEqual([processId]);
      expect(page.total).toBe(1);
    }
  });

  it("parceiro não filtra por prazo (ignorado: prazos são internos) e não lê o resumo", async () => {
    const page = await processes.listProcesses(await ctxFor("PARTNER_ADMIN_A"), listProcessesSchema.parse({ deadline: "OVERDUE" }));
    expect(page.items.some((p) => p.id === processId)).toBe(false);
    await expectDomainError(processes.getProcessSummary(await ctxFor("PARTNER_ADMIN_A")), "FORBIDDEN");
  });

  it("resumo conta no banco: ativo e com prazo em até 5 dias incluem o processo novo", async () => {
    const summary = await processes.getProcessSummary(await ctxFor("LAWYER"));
    expect(summary.active).toBeGreaterThanOrEqual(1);
    expect(summary.dueSoon).toBeGreaterThanOrEqual(1);
  });
});

describe("revisões por processo e auditoria por registro (Fase H)", () => {
  it("revisões filtradas por processo: só as do processo (aqui, nenhuma)", async () => {
    const page = await reviews.listReviews(await ctxFor("LAWYER"), listReviewsSchema.parse({ processId }));
    expect(page.items.every((r) => r.processId === processId)).toBe(true);
    expect(page.total).toBe(page.items.length);
  });

  it("linha do tempo do caso: eventos do registro, só ADMIN", async () => {
    const page = await audit.listAuditEvents(await ctxFor("ADMIN"), listAuditEventsSchema.parse(auditTimelineInput(caseId)));
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((e) => e.entityId === caseId)).toBe(true);
    expect(page.items.map((e) => e.action)).toContain("CASE_CREATED");
    await expectDomainError(audit.listAuditEvents(await ctxFor("LAWYER"), listAuditEventsSchema.parse(auditTimelineInput(caseId))), "FORBIDDEN");
  });
});
