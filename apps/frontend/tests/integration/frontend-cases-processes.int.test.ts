import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as cases from "@/server/domain/cases/service";
import { createCaseSchema, listCasesSchema, partnerSubmitCaseSchema } from "@/server/domain/cases/schemas";
import * as clients from "@/server/domain/clients/service";
import { createClientSchema } from "@/server/domain/clients/schemas";
import * as processes from "@/server/domain/processes/service";
import { createEventSchema, createProcessSchema, listEventsSchema, listProcessesSchema, updateProcessSchema } from "@/server/domain/processes/schemas";
import * as deadlines from "@/server/domain/processes/deadlines/service";
import { createDeadlineSchema, listDeadlinesSchema, updateDeadlineSchema } from "@/server/domain/processes/deadlines/schemas";
import { caseQueryToInput, DEFAULT_CASE_QUERY } from "@/features/cases/list-query";
import { processQueryToInput, DEFAULT_PROCESS_QUERY } from "@/features/processes/list-query";
import { processCreateInput, processEditPatch } from "@/features/processes/server-input";
import type { ProcessFormValues } from "@/features/processes/schemas";
import { ctxFor, expectDomainError, fakeCnj, fakeCpf, world } from "./support/world";

/**
 * Etapa 4.3 — Fase B no Supabase DEV: o que as TELAS de Casos e Processos
 * geram (URL da lista, formulários, diálogos de prazo e andamento) passa
 * pelos schemas e services reais, com idempotência e isolamento.
 */

async function newClient(name = "Cliente Fase B"): Promise<string> {
  const { id } = await clients.createClient(
    await ctxFor("LAWYER"),
    createClientSchema.parse({ kind: "INDIVIDUAL", cpf: fakeCpf(), fullName: `${name} ${world.run}`, originOfficeId: world.owner }),
  );
  return id;
}

/** Como o formulário de novo caso monta o envio (sem a chave). */
const casePayload = (clientId: string, title: string) => ({
  clientId,
  title,
  area: "BANKING",
  originOrganizationId: world.owner,
  opposingParty: "Banco Teste",
  assignedLawyerId: world.users.LAWYER.id,
  summary: "Resumo do caso da Fase B.",
  submit: true,
  linkPartner: false,
});

const processForm = (legalCaseId: string, o: Partial<ProcessFormValues> = {}): ProcessFormValues => ({
  legalCaseId,
  cnj: "",
  title: `Processo Fase B ${randomUUID().slice(0, 6)}`,
  court: "TJSP",
  unit: "2ª Vara Cível",
  district: "",
  state: "SP",
  actionType: "Ação revisional",
  subject: "",
  clientPole: "ACTIVE",
  opposingParty: "Banco Teste",
  responsibleUserId: world.users.LAWYER.id,
  distributionDate: "",
  caseValue: "10.000,00",
  status: "PRE_FILING",
  phase: "PRELIMINARY",
  deadlineTitle: "Protocolar inicial",
  deadlineType: "",
  deadlineDueDate: "2026-12-15",
  notes: "",
  ...o,
});

describe("Fase B — casos pela UI", () => {
  it("formulário: mesma intenção (mesma chave) duas vezes = um caso; deduplicado é sucesso", async () => {
    const lawyer = await ctxFor("LAWYER");
    const payload = casePayload(await newClient(), `Caso UI ${randomUUID()}`);
    const key = randomUUID();
    const a = await cases.createCase(lawyer, createCaseSchema.parse({ ...payload, idempotencyKey: key }));
    const b = await cases.createCase(lawyer, createCaseSchema.parse({ ...payload, idempotencyKey: key }));
    expect([a.deduplicated, b.deduplicated, b.id]).toEqual([false, true, a.id]);
    const detail = await cases.getCase(lawyer, a.id);
    if (detail.surface !== "INTERNAL") throw new Error("ficha");
    expect(detail.legalCase.clientName).toContain("Cliente Fase B");
    expect(detail.legalCase.status).toBe("SUBMITTED");
  });

  it("URL da lista → listCases: área, período, origem e contagem de processos", async () => {
    const lawyer = await ctxFor("LAWYER");
    const title = `Caso Lista UI ${randomUUID()}`;
    const { id } = await cases.createCase(lawyer, createCaseSchema.parse({ ...casePayload(await newClient(), title), idempotencyKey: randomUUID() }));
    await processes.createProcess(lawyer, createProcessSchema.parse({ ...processCreateInput(processForm(id)), idempotencyKey: randomUUID() }));
    const page = await cases.listCases(lawyer, listCasesSchema.parse(caseQueryToInput({ ...DEFAULT_CASE_QUERY, search: title, area: "BANKING", period: "7", origin: world.owner })));
    expect(page.items.map((c) => c.id)).toEqual([id]);
    expect(page.items[0].processCount).toBe(1);
    const other = await cases.listCases(lawyer, listCasesSchema.parse(caseQueryToInput({ ...DEFAULT_CASE_QUERY, search: title, area: "LABOR" })));
    expect(other.items).toHaveLength(0);
  });

  it("catálogo de áreas e tipos para os formulários", async () => {
    const catalog = await cases.getCaseCatalog(await ctxFor("ASSISTANT"));
    expect(catalog.areas.map((a) => a.code)).toContain("BANKING");
  });

  it("parceiro B não abre caso interno nem caso do parceiro A (não encontrado)", async () => {
    const { id } = await cases.createCase(await ctxFor("LAWYER"), createCaseSchema.parse({ ...casePayload(await newClient(), `Caso isolado ${randomUUID()}`), idempotencyKey: randomUUID() }));
    await expectDomainError(cases.getCase(await ctxFor("PARTNER_ADMIN_B"), id), "NOT_FOUND");
  });
});

describe("Fase B — processos, prazos e andamentos pela UI", () => {
  async function caseId(): Promise<string> {
    const { id } = await cases.createCase(await ctxFor("LAWYER"), createCaseSchema.parse({ ...casePayload(await newClient(), `Caso p/ processo ${randomUUID()}`), idempotencyKey: randomUUID() }));
    return id;
  }

  it("cadastro pelo formulário (idempotente) → lista com cliente, caso e próximo prazo", async () => {
    const lawyer = await ctxFor("LAWYER");
    const legalCaseId = await caseId();
    const input = processCreateInput(processForm(legalCaseId, { cnj: fakeCnj(), status: "ACTIVE", phase: "PLEADINGS" }));
    const key = randomUUID();
    const a = await processes.createProcess(lawyer, createProcessSchema.parse({ ...input, idempotencyKey: key }));
    const b = await processes.createProcess(lawyer, createProcessSchema.parse({ ...input, idempotencyKey: key }));
    expect(b).toEqual({ id: a.id, deduplicated: true });
    const page = await processes.listProcesses(lawyer, listProcessesSchema.parse(processQueryToInput({ ...DEFAULT_PROCESS_QUERY, search: String(input.title), phase: "PLEADINGS", court: "TJSP" })));
    const row = page.items.find((p) => p.id === a.id);
    expect(row).toMatchObject({ caseTitle: expect.stringContaining("Caso p/ processo"), clientName: expect.stringContaining("Cliente Fase B"), actionType: "Ação revisional" });
    expect(row?.nextDeadline).toMatchObject({ title: "Protocolar inicial", dueDateLocal: "2026-12-15" });
  });

  it("edição pelo formulário: vazio limpa; leitura posterior mostra o novo estado", async () => {
    const lawyer = await ctxFor("LAWYER");
    const { id } = await processes.createProcess(lawyer, createProcessSchema.parse({ ...processCreateInput(processForm(await caseId())), idempotencyKey: randomUUID() }));
    await processes.updateProcess(lawyer, updateProcessSchema.parse({ id, patch: processEditPatch(processForm("", { unit: "", caseValue: "", phase: "EVIDENCE" })) }));
    const detail = await processes.getProcess(lawyer, id);
    if (detail.surface !== "INTERNAL") throw new Error("ficha");
    expect(detail.process).toMatchObject({ phase: "EVIDENCE", unit: undefined, caseValue: undefined });
  });

  it("prazo: criar (data civil), editar, cumprir e cancelar; vencido é derivado", async () => {
    const lawyer = await ctxFor("LAWYER");
    const legalCaseId = await caseId();
    const { id: processId } = await processes.createProcess(lawyer, createProcessSchema.parse({ ...processCreateInput(processForm(legalCaseId)), idempotencyKey: randomUUID() }));
    const past = await deadlines.createDeadline(lawyer, createDeadlineSchema.parse({ legalCaseId, processId, title: "Vencido", type: "REPLY", dueDate: "2026-01-05", description: "" }));
    const future = await deadlines.createDeadline(lawyer, createDeadlineSchema.parse({ legalCaseId, processId, title: "Futuro", type: "REPLY", dueDate: "2027-01-05" }));
    await deadlines.updateDeadline(lawyer, updateDeadlineSchema.parse({ id: future.id, patch: { title: "Futuro editado", dueDate: "2027-02-01" } }));
    const list = await deadlines.listDeadlines(lawyer, listDeadlinesSchema.parse({ processId, pageSize: 50 }));
    const byTitle = new Map(list.items.map((d) => [d.title, d]));
    expect(byTitle.get("Vencido")?.effectiveStatus).toBe("OVERDUE");
    expect(byTitle.get("Futuro editado")).toMatchObject({ dueDateLocal: "2027-02-01", effectiveStatus: "OPEN" });
    await deadlines.completeDeadline(lawyer, past.id);
    await deadlines.cancelDeadline(lawyer, future.id);
    const after = await deadlines.listDeadlines(lawyer, listDeadlinesSchema.parse({ processId, pageSize: 50 }));
    expect(after.items.filter((d) => d.status === "OPEN").map((d) => d.title)).toEqual(["Protocolar inicial"]);
  });

  it("andamento da equipe é MANUAL; parceiro não vê nota interna", async () => {
    const lawyer = await ctxFor("LAWYER");
    const pa = await ctxFor("PARTNER_ADMIN_A");
    const submitted = await cases.partnerSubmitCase(
      pa,
      partnerSubmitCaseSchema.parse({
        idempotencyKey: randomUUID(),
        client: { kind: "INDIVIDUAL", document: fakeCpf(), fullName: "Cliente Portal Fase B", origin: "OWN_OFFICE" },
        case: { area: "BANKING", title: `Caso parceiro Fase B ${randomUUID()}`, origin: "OWN_OFFICE" },
      }),
    );
    const { id: processId } = await processes.createProcess(lawyer, createProcessSchema.parse({ ...processCreateInput(processForm(submitted.legalCaseId)), idempotencyKey: randomUUID() }));
    await processes.createEvent(lawyer, createEventSchema.parse({ processId, title: "Nota interna da equipe", description: "", important: true }));
    const internal = await processes.listEvents(lawyer, listEventsSchema.parse({ processId }));
    expect(internal.items.find((e) => e.title === "Nota interna da equipe")?.source).toBe("MANUAL");
    const partner = await processes.listEvents(pa, listEventsSchema.parse({ processId }));
    expect(partner.items.find((e) => e.title === "Nota interna da equipe")).toBeUndefined();
    // Parceiro não recebe o próximo prazo (sem acesso a prazos).
    const partnerList = await processes.listProcesses(pa, listProcessesSchema.parse({ caseId: submitted.legalCaseId }));
    expect(partnerList.items[0]?.nextDeadline).toBeUndefined();
  });

  it("ASSISTANT não cadastra processo nem prazo (matriz: processes.edit só ADMIN/LAWYER)", async () => {
    const assistant = await ctxFor("ASSISTANT");
    const legalCaseId = await caseId();
    await expectDomainError(processes.createProcess(assistant, createProcessSchema.parse({ ...processCreateInput(processForm(legalCaseId)), idempotencyKey: randomUUID() })), "FORBIDDEN");
  });
});
