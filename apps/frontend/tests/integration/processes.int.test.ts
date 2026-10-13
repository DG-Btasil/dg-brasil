import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as clients from "@/server/domain/clients/service";
import { createClientSchema } from "@/server/domain/clients/schemas";
import * as processes from "@/server/domain/processes/service";
import * as deadlines from "@/server/domain/processes/deadlines/service";
import { addPartySchema, createEventSchema, createPartnerProcessSchema, createProcessSchema, listEventsSchema, listPartiesSchema, listProcessesSchema } from "@/server/domain/processes/schemas";
import { createDeadlineSchema, listDeadlinesSchema, listOverdueSchema, listUpcomingSchema } from "@/server/domain/processes/deadlines/schemas";
import { ctxFor, expectDomainError, fakeCnj, fakeCpf, serviceDb, world } from "./support/world";

/**
 * Processos, partes, movimentações e prazos no Supabase DEV real: CNJ único,
 * ASSISTANT só leitura, isolamento parceiro A × B (IDOR), movimentação oficial
 * nunca digitada, prazo vencido derivado (view deadline_status).
 */

/** Caso interno (cliente do proprietário), criado pelo caminho real do LAWYER. */
async function internalCase(): Promise<{ caseId: string; clientId: string }> {
  const lawyer = await ctxFor("LAWYER");
  const { id: clientId } = await clients.createClient(
    lawyer,
    createClientSchema.parse({ kind: "INDIVIDUAL", cpf: fakeCpf(), fullName: "Cliente Processo Interno", originOfficeId: world.owner }),
  );
  const caseId = randomUUID();
  const { error } = await lawyer.db.from("legal_cases").insert({
    id: caseId,
    client_id: clientId,
    legal_area_id: world.bankingAreaId,
    title: `Caso interno ${world.run}`,
    origin_organization_id: world.owner,
    status: "DRAFT",
  });
  expect(error).toBeNull();
  return { caseId, clientId };
}

/** Caso do parceiro A, pelo caminho real (partner_submit_case). */
async function partnerACase(): Promise<{ caseId: string; clientId: string }> {
  const db = (await ctxFor("PARTNER_ADMIN_A")).db;
  const { data, error } = await db.rpc("partner_submit_case", {
    p_client: { document: fakeCpf(), kind: "INDIVIDUAL", origin_organization_id: world.partnerA, full_name: "Cliente Processo Parceiro A" },
    p_case: { legal_area_id: world.bankingAreaId, title: `Caso parceiro A ${world.run}`, origin_organization_id: world.partnerA },
  });
  expect(error).toBeNull();
  const r = data as { client_id: string; legal_case_id: string };
  return { caseId: r.legal_case_id, clientId: r.client_id };
}

const newProcess = (legalCaseId: string, extra: Record<string, unknown> = {}) =>
  createProcessSchema.parse({ legalCaseId, title: `Processo ${world.run}`, cnj: fakeCnj(), caseValue: 1234.56, ...extra });

describe("processos — equipe interna", () => {
  it("LAWYER cria com CNJ; ficha interna traz dados internos; CNJ duplicado → CONFLICT", async () => {
    const lawyer = await ctxFor("LAWYER");
    const { caseId, clientId } = await internalCase();
    const cnj = fakeCnj();
    const { id } = await processes.createProcess(lawyer, newProcess(caseId, { cnj, notes: "nota interna do processo", summary: "resumo interno" }));

    const detail = await processes.getProcess(lawyer, id);
    expect(detail.surface).toBe("INTERNAL");
    if (detail.surface !== "INTERNAL") throw new Error("ficha");
    expect(detail.process).toMatchObject({ cnj, legalCaseId: caseId, clientId, caseValue: 1234.56, notes: "nota interna do processo", origin: "MANUAL" });
    expect(detail.process.responsibleUserId).toBe(world.users.LAWYER.id);

    await expectDomainError(processes.createProcess(lawyer, newProcess(caseId, { cnj })), "CONFLICT", /CNJ/);
    const { count } = await serviceDb().from("legal_processes").select("id", { count: "exact", head: true }).eq("cnj_number", cnj);
    expect(count).toBe(1);
  });

  it("sem caso acessível não há processo (nunca órfão)", async () => {
    await expectDomainError(processes.createProcess(await ctxFor("LAWYER"), newProcess(randomUUID())), "NOT_FOUND");
  });

  it("busca por CNJ (prefixo) e por título; listagem do caso", async () => {
    const lawyer = await ctxFor("LAWYER");
    const { caseId } = await internalCase();
    const cnj = fakeCnj();
    const title = `Busca Processo ${world.run} Ímpar`;
    const { id } = await processes.createProcess(lawyer, newProcess(caseId, { cnj, title }));
    const byCnj = await processes.listProcesses(lawyer, listProcessesSchema.parse({ q: cnj.slice(0, 15) }));
    expect(byCnj.items.map((p) => p.id)).toContain(id);
    const byTitle = await processes.listProcesses(lawyer, listProcessesSchema.parse({ q: `busca processo ${world.run}`, pageSize: 5 }));
    expect(byTitle.items.map((p) => p.id)).toContain(id);
    const ofCase = await processes.listCaseProcesses(lawyer, { caseId, page: 1, pageSize: 10 });
    expect(ofCase.items.map((p) => p.id)).toEqual([id]);
  });

  it("ASSISTANT só lê processos e prazos (service e RLS)", async () => {
    const lawyer = await ctxFor("LAWYER");
    const { caseId } = await internalCase();
    const { id } = await processes.createProcess(lawyer, newProcess(caseId));
    const { id: deadlineId } = await deadlines.createDeadline(lawyer, createDeadlineSchema.parse({ legalCaseId: caseId, title: "Prazo", dueDate: "2030-01-10" }));

    const assistant = await ctxFor("ASSISTANT");
    expect((await processes.getProcess(assistant, id)).surface).toBe("INTERNAL");
    expect((await deadlines.getDeadline(assistant, deadlineId)).id).toBe(deadlineId);
    await expectDomainError(processes.createProcess(assistant, newProcess(caseId)), "FORBIDDEN");
    await expectDomainError(processes.updateProcess(assistant, { id, patch: { title: "x" } }), "FORBIDDEN");
    await expectDomainError(deadlines.createDeadline(assistant, createDeadlineSchema.parse({ legalCaseId: caseId, title: "x", dueDate: "2030-01-10" })), "FORBIDDEN");
    await expectDomainError(deadlines.completeDeadline(assistant, deadlineId), "FORBIDDEN");

    // Segunda barreira: a RLS recusa a escrita direta.
    const { error } = await assistant.db.from("legal_processes").insert({ legal_case_id: caseId, title: "direto" });
    expect(error).not.toBeNull();
    const { count } = await assistant.db.from("deadlines").update({ status: "COMPLETED" }, { count: "exact" }).eq("id", deadlineId);
    expect(count ?? 0).toBe(0);
  });

  it("excluir é só ADMIN (lógica); excluído some", async () => {
    const lawyer = await ctxFor("LAWYER");
    const { caseId } = await internalCase();
    const { id } = await processes.createProcess(lawyer, newProcess(caseId));
    await expectDomainError(processes.removeProcess(lawyer, id), "FORBIDDEN");
    await processes.removeProcess(await ctxFor("ADMIN"), id);
    await expectDomainError(processes.getProcess(lawyer, id), "NOT_FOUND");
    const { data } = await serviceDb().from("legal_processes").select("deleted_at").eq("id", id).single();
    expect(data?.deleted_at).not.toBeNull();
  });
});

describe("processos — Portal do Parceiro (A × B)", () => {
  it("A cadastra processo no próprio caso; ficha do parceiro sem dado interno; B não acessa (IDOR)", async () => {
    const { caseId, clientId } = await partnerACase();
    const pa = await ctxFor("PARTNER_ADMIN_A");
    const { id } = await processes.createPartnerProcess(
      pa,
      createPartnerProcessSchema.parse({ legalCaseId: caseId, title: `Processo do parceiro ${world.run}`, cnj: fakeCnj(), caseValue: 500 }),
    );
    const { data: stored } = await serviceDb().from("legal_processes").select("technical_origin, created_by, status").eq("id", id).single();
    expect(stored).toMatchObject({ technical_origin: "MANUAL", created_by: world.users.PARTNER_ADMIN_A.id });

    // Equipe interna escreve dado interno no mesmo processo.
    await processes.updateProcess(await ctxFor("LAWYER"), { id, patch: { notes: "não pode vazar", responsibleUserId: world.users.LAWYER.id } });

    const ua = await ctxFor("PARTNER_USER_A");
    const detail = await processes.getProcess(ua, id);
    expect(detail.surface).toBe("PARTNER");
    expect(detail.process).toMatchObject({ id, legalCaseId: caseId, clientId, caseValue: 500 });
    const json = JSON.stringify(detail);
    expect(json).not.toContain("não pode vazar");
    expect(json).not.toContain(world.users.LAWYER.id);
    for (const field of ["notes", "summary", "responsibleUserId", "createdBy", "operationalDueAt"]) expect(detail.process).not.toHaveProperty(field);

    const listA = await processes.listProcesses(ua, listProcessesSchema.parse({ q: `processo do parceiro ${world.run}` }));
    expect(listA.items.map((p) => p.id)).toContain(id);

    const b = await ctxFor("PARTNER_USER_B");
    await expectDomainError(processes.getProcess(b, id), "NOT_FOUND");
    await expectDomainError(processes.listParties(b, listPartiesSchema.parse({ processId: id })), "NOT_FOUND");
    await expectDomainError(processes.listEvents(b, listEventsSchema.parse({ processId: id })), "NOT_FOUND");
    await expectDomainError(processes.listCaseProcesses(b, { caseId, page: 1, pageSize: 10 }), "NOT_FOUND");
    const listB = await processes.listProcesses(b, listProcessesSchema.parse({ pageSize: 50, caseId }));
    expect(listB.items).toHaveLength(0);
    const pb = await ctxFor("PARTNER_ADMIN_B");
    await expectDomainError(processes.createPartnerProcess(pb, createPartnerProcessSchema.parse({ legalCaseId: caseId, title: "Invasão" })), "NOT_FOUND");
    await expectDomainError(processes.addParty(pb, addPartySchema.parse({ processId: id, type: "OTHER", name: "Invasor" })), "NOT_FOUND");
  });

  it("parceiro não vê processo de caso interno nem cria processo por fora do portal", async () => {
    const { caseId } = await internalCase();
    const { id } = await processes.createProcess(await ctxFor("LAWYER"), newProcess(caseId));
    const ua = await ctxFor("PARTNER_USER_A");
    await expectDomainError(processes.getProcess(ua, id), "NOT_FOUND");
    await expectDomainError(processes.createProcess(await ctxFor("PARTNER_ADMIN_A"), newProcess(caseId)), "FORBIDDEN");
    await expectDomainError(processes.createPartnerProcess(await ctxFor("PARTNER_ADMIN_A"), createPartnerProcessSchema.parse({ legalCaseId: caseId, title: "x" })), "NOT_FOUND");
  });

  it("partes: interno e parceiro A adicionam; só interno edita", async () => {
    const { caseId } = await partnerACase();
    const pa = await ctxFor("PARTNER_ADMIN_A");
    const { id } = await processes.createPartnerProcess(pa, createPartnerProcessSchema.parse({ legalCaseId: caseId, title: "Processo partes" }));
    const lawyer = await ctxFor("LAWYER");
    const { id: defendant } = await processes.addParty(lawyer, addPartySchema.parse({ processId: id, type: "DEFENDANT", name: "Banco Fictício S.A.", document: "99999999000199" }));
    await processes.addParty(pa, addPartySchema.parse({ processId: id, type: "PLAINTIFF", name: "Autor Fictício" }));
    const parties = await processes.listParties(pa, listPartiesSchema.parse({ processId: id }));
    expect(parties.items.map((p) => p.name).sort()).toEqual(["Autor Fictício", "Banco Fictício S.A."]);
    await expectDomainError(processes.updateParty(pa, { id: defendant, patch: { name: "Outro" } }), "FORBIDDEN");
    await processes.updateParty(lawyer, { id: defendant, patch: { type: "INTERESTED" } });
    const after = await processes.listParties(lawyer, listPartiesSchema.parse({ processId: id }));
    expect(after.items.find((p) => p.id === defendant)?.type).toBe("INTERESTED");
  });
});

describe("movimentações", () => {
  it("interno registra nota MANUAL; parceiro não registra (nem oficial) e só vê as oficiais", async () => {
    const { caseId } = await partnerACase();
    const pa = await ctxFor("PARTNER_ADMIN_A");
    const { id } = await processes.createPartnerProcess(pa, createPartnerProcessSchema.parse({ legalCaseId: caseId, title: "Processo movimentações" }));

    const lawyer = await ctxFor("LAWYER");
    const { id: manualId } = await processes.createEvent(lawyer, createEventSchema.parse({ processId: id, title: "Ligação com o cliente", source: "JUDICIAL_INTEGRATION" }));
    const { data: manual } = await serviceDb().from("process_events").select("source").eq("id", manualId).single();
    expect(manual?.source).toBe("MANUAL");

    // Movimentação oficial só pela integração (aqui: preparo com service role).
    const officialId = randomUUID();
    const { error: setupError } = await serviceDb().from("process_events").insert({
      id: officialId,
      legal_process_id: id,
      event_type: "SENTENCE",
      title: "Sentença publicada",
      description: "Sentença publicada no diário",
      occurred_at: new Date().toISOString(),
      source: "JUDICIAL_INTEGRATION",
    });
    expect(setupError).toBeNull();

    // Parceiro: service recusa; RLS recusa a inserção direta de movimentação oficial.
    await expectDomainError(processes.createEvent(pa, createEventSchema.parse({ processId: id, title: "Tentativa" })), "FORBIDDEN");
    const { error: rlsError } = await pa.db.from("process_events").insert({
      legal_process_id: id,
      event_type: "SENTENCE",
      description: "falsa",
      occurred_at: new Date().toISOString(),
      source: "JUDICIAL_INTEGRATION",
    });
    expect(rlsError).not.toBeNull();

    const internalList = await processes.listEvents(lawyer, listEventsSchema.parse({ processId: id }));
    expect(internalList.items.map((e) => e.id).sort()).toEqual([manualId, officialId].sort());
    const partnerList = await processes.listEvents(await ctxFor("PARTNER_USER_A"), listEventsSchema.parse({ processId: id }));
    expect(partnerList.items.map((e) => e.id)).toEqual([officialId]);
    expect(partnerList.items[0]).not.toHaveProperty("externalProvider");
  });
});

describe("prazos", () => {
  it("vencido é derivado (view), nunca gravado; cumprir tira da lista de vencidos", async () => {
    const lawyer = await ctxFor("LAWYER");
    const { caseId } = await internalCase();
    const { id: processId } = await processes.createProcess(lawyer, newProcess(caseId));
    const past = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const { id } = await deadlines.createDeadline(lawyer, createDeadlineSchema.parse({ legalCaseId: caseId, processId, title: "Réplica", type: "REPLY", dueAt: past }));

    const overdue = await deadlines.listOverdueDeadlines(lawyer, listOverdueSchema.parse({ caseId }));
    expect(overdue.items.map((d) => d.id)).toEqual([id]);
    expect(overdue.items[0]).toMatchObject({ status: "OPEN", effectiveStatus: "OVERDUE", processId, source: "MANUAL" });
    const { data: stored } = await serviceDb().from("deadlines").select("status").eq("id", id).single();
    expect(stored?.status).toBe("OPEN");
    const upcomingNone = await deadlines.listUpcomingDeadlines(lawyer, listUpcomingSchema.parse({ caseId }));
    expect(upcomingNone.items.map((d) => d.id)).not.toContain(id);

    await deadlines.completeDeadline(lawyer, id);
    const done = await deadlines.getDeadline(await ctxFor("ASSISTANT"), id);
    expect(done).toMatchObject({ status: "COMPLETED", effectiveStatus: "COMPLETED" });
    expect(done.completedAt).toBeTruthy();
    expect((await deadlines.listOverdueDeadlines(lawyer, listOverdueSchema.parse({ caseId }))).items).toHaveLength(0);
    await expectDomainError(deadlines.completeDeadline(lawyer, id), "INVALID_STATE");
    await expectDomainError(deadlines.cancelDeadline(lawyer, id), "INVALID_STATE");
  });

  it("próximos prazos, cancelamento e processo de outro caso recusado", async () => {
    const lawyer = await ctxFor("LAWYER");
    const { caseId } = await internalCase();
    const other = await internalCase();
    const { id: otherProcess } = await processes.createProcess(lawyer, newProcess(other.caseId));
    await expectDomainError(
      deadlines.createDeadline(lawyer, createDeadlineSchema.parse({ legalCaseId: caseId, processId: otherProcess, title: "x", dueDate: "2030-01-01" })),
      "VALIDATION",
    );
    await expectDomainError(deadlines.createDeadline(lawyer, createDeadlineSchema.parse({ legalCaseId: randomUUID(), title: "x", dueDate: "2030-01-01" })), "NOT_FOUND");

    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const { id } = await deadlines.createDeadline(lawyer, createDeadlineSchema.parse({ legalCaseId: caseId, title: "Audiência", type: "HEARING", dueAt: soon }));
    const upcoming = await deadlines.listUpcomingDeadlines(lawyer, listUpcomingSchema.parse({ caseId, days: 7 }));
    expect(upcoming.items.map((d) => d.id)).toEqual([id]);
    expect(upcoming.items[0].effectiveStatus).toBe("OPEN");

    await deadlines.cancelDeadline(lawyer, id);
    const all = await deadlines.listDeadlines(lawyer, listDeadlinesSchema.parse({ caseId }));
    expect(all.items.map((d) => [d.id, d.effectiveStatus])).toEqual([[id, "CANCELLED"]]);
    expect((await deadlines.listUpcomingDeadlines(lawyer, listUpcomingSchema.parse({ caseId, days: 7 }))).items).toHaveLength(0);
  });

  it("filtro de responsável (\"me\") e prazo de processo excluído some das listagens", async () => {
    const lawyer = await ctxFor("LAWYER");
    const { caseId } = await internalCase();
    const { id: processId } = await processes.createProcess(lawyer, newProcess(caseId));
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const { id: mine } = await deadlines.createDeadline(lawyer, createDeadlineSchema.parse({ legalCaseId: caseId, processId, title: "Meu prazo", dueAt: past }));
    const { id: theirs } = await deadlines.createDeadline(
      lawyer,
      createDeadlineSchema.parse({ legalCaseId: caseId, title: "Prazo do ADMIN", dueAt: past, responsibleUserId: world.users.ADMIN.id }),
    );

    const onlyMine = await deadlines.listOverdueDeadlines(lawyer, listOverdueSchema.parse({ caseId, responsibleUserId: "me" }));
    expect(onlyMine.items.map((d) => d.id)).toEqual([mine]);
    const admins = await deadlines.listDeadlines(lawyer, listDeadlinesSchema.parse({ caseId, responsibleUserId: world.users.ADMIN.id }));
    expect(admins.items.map((d) => d.id)).toEqual([theirs]);

    await processes.removeProcess(await ctxFor("ADMIN"), processId);
    const after = await deadlines.listOverdueDeadlines(lawyer, listOverdueSchema.parse({ caseId }));
    expect(after.items.map((d) => d.id)).toEqual([theirs]);
    const all = await deadlines.listDeadlines(lawyer, listDeadlinesSchema.parse({ caseId }));
    expect(all.items.map((d) => d.id)).not.toContain(mine);
    await expectDomainError(deadlines.getDeadline(lawyer, mine), "NOT_FOUND");
    expect((await deadlines.getDeadline(lawyer, theirs)).id).toBe(theirs);
  });

  it("parceiro não acessa prazos", async () => {
    await expectDomainError(deadlines.listDeadlines(await ctxFor("PARTNER_ADMIN_A"), listDeadlinesSchema.parse({})), "FORBIDDEN");
    await expectDomainError(deadlines.listOverdueDeadlines(await ctxFor("PARTNER_USER_B"), listOverdueSchema.parse({})), "FORBIDDEN");
  });
});
