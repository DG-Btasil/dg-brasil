import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as cases from "@/server/domain/cases/service";
import { createCaseSchema, listCasesSchema, partnerSubmitCaseSchema } from "@/server/domain/cases/schemas";
import * as clients from "@/server/domain/clients/service";
import { createClientSchema } from "@/server/domain/clients/schemas";
import { ctxFor, expectDomainError, fakeCpf, serviceDb, world, type WorldRole } from "./support/world";

/**
 * Casos no Supabase DEV real: máquina de estados, aceite (advogado + snapshot
 * de parceria, idempotente), rejeição (motivo público × interno), origem ×
 * acesso do parceiro, isolamento A × B e DTO por superfície.
 */

const CLIENT_NAME = "Cliente Caso Integração";

async function newClient(): Promise<string> {
  const { id } = await clients.createClient(
    await ctxFor("LAWYER"),
    createClientSchema.parse({ kind: "INDIVIDUAL", cpf: fakeCpf(), fullName: CLIENT_NAME, originOfficeId: world.owner }),
  );
  return id;
}

/** Caso interno (rascunho por padrão, origem = proprietário, sem parceiro). */
async function newCase(role: WorldRole, over: Record<string, unknown> = {}): Promise<string> {
  const clientId = (over.clientId as string | undefined) ?? (await newClient());
  const input = createCaseSchema.parse({ idempotencyKey: randomUUID(), area: "BANKING", title: `Caso ${world.run}`, originOrganizationId: world.owner, ...over, clientId });
  return (await cases.createCase(await ctxFor(role), input)).id;
}

/** Caso enviado pelo Portal do Parceiro (cliente novo, caso SUBMITTED do próprio escritório). */
async function partnerCase(role: WorldRole, origin: "OWN_OFFICE" | "OWNER" = "OWN_OFFICE", title = `Caso parceiro ${world.run}`) {
  return cases.partnerSubmitCase(
    await ctxFor(role),
    partnerSubmitCaseSchema.parse({ idempotencyKey: randomUUID(),
      client: { kind: "INDIVIDUAL", document: fakeCpf(), fullName: "Cliente do Parceiro" },
      case: { area: "BANKING", title, origin, summary: "Resumo enviado pelo parceiro" },
    }),
  );
}

/** Snapshots de parceria ATIVOS do caso (conferência com a service role). */
async function activeAgreements(legalCaseId: string): Promise<number> {
  const { count, error } = await serviceDb()
    .from("case_partnership_agreements")
    .select("id", { count: "exact", head: true })
    .eq("legal_case_id", legalCaseId)
    .is("cancelled_at", null);
  expect(error).toBeNull();
  return count ?? 0;
}

async function statusInDb(legalCaseId: string): Promise<string | undefined> {
  const { data } = await serviceDb().from("legal_cases").select("status").eq("id", legalCaseId).single();
  return (data as { status: string } | null)?.status;
}

const INTERNAL_ONLY_FIELDS = ["rejectionReasonInternal", "notes", "acceptedBy", "createdBy", "createdByOrganizationId", "assignedLawyerId", "officeId"];

describe("casos — equipe interna", () => {
  it("LAWYER cria rascunho, envia e aceita; origem OWNER não cria snapshot; segundo clique é idempotente", async () => {
    const lawyer = await ctxFor("LAWYER");
    const id = await newCase("LAWYER", { notes: "nota interna do caso" });
    let detail = await cases.getCase(lawyer, id);
    if (detail.surface !== "INTERNAL") throw new Error("ficha interna");
    expect(detail.legalCase).toMatchObject({
      status: "DRAFT",
      area: "BANKING",
      partnerOrganizationId: null,
      originOrganizationId: world.owner,
      createdByOrganizationId: world.owner,
      createdBy: world.users.LAWYER.id,
      notes: "nota interna do caso",
    });

    await cases.submitCase(lawyer, id);
    expect(await cases.acceptCase(lawyer, { id, lawyerId: world.users.LAWYER.id })).toEqual({ alreadyAccepted: false });
    // Duplo clique: nada muda (nem o advogado).
    expect(await cases.acceptCase(lawyer, { id, lawyerId: world.users.ADMIN.id })).toEqual({ alreadyAccepted: true });

    detail = await cases.getCase(lawyer, id);
    if (detail.surface !== "INTERNAL") throw new Error("ficha interna");
    expect(detail.legalCase).toMatchObject({ status: "ACCEPTED", assignedLawyerId: world.users.LAWYER.id, acceptedBy: world.users.LAWYER.id });
    expect(detail.legalCase.acceptedAt).toBeTruthy();
    expect(detail.legalCase.submittedAt).toBeTruthy();
    expect(await activeAgreements(id)).toBe(0);
  });

  it("aceite exige advogado ADMIN/LAWYER (o banco recusa; erro mapeado)", async () => {
    const lawyer = await ctxFor("LAWYER");
    const id = await newCase("LAWYER", { submit: true });
    await expectDomainError(cases.acceptCase(lawyer, { id }), "VALIDATION", /advogado/i);
    await expectDomainError(cases.acceptCase(lawyer, { id, lawyerId: world.users.ASSISTANT.id }), "VALIDATION", /advogado/i);
    expect(await statusInDb(id)).toBe("SUBMITTED");
  });

  it("origem parceiro: aceite simultâneo cria UM snapshot; origem não dá acesso ao parceiro", async () => {
    const id = await newCase("LAWYER", { submit: true, originOrganizationId: world.partnerA });
    const [first, second] = await Promise.all([ctxFor("LAWYER"), ctxFor("ADMIN")]);
    const results = await Promise.allSettled([
      cases.acceptCase(first, { id, lawyerId: world.users.LAWYER.id }),
      cases.acceptCase(second, { id, lawyerId: world.users.LAWYER.id }),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    const fresh = results.filter((r) => r.status === "fulfilled" && !r.value.alreadyAccepted);
    expect(fresh).toHaveLength(1);
    expect(await activeAgreements(id)).toBe(1);
    // Sem linkPartner o caso é interno: o parceiro de origem não o vê.
    await expectDomainError(cases.getCase(await ctxFor("PARTNER_USER_A"), id), "NOT_FOUND");
  });

  it("vínculo do parceiro só por opt-in explícito (linkPartner)", async () => {
    const id = await newCase("LAWYER", { originOrganizationId: world.partnerA, linkPartner: true });
    const detail = await cases.getCase(await ctxFor("PARTNER_USER_A"), id);
    expect(detail.surface).toBe("PARTNER");
    expect(detail.legalCase).toMatchObject({ partnerOrganizationId: world.partnerA, originOrganizationId: world.partnerA, status: "DRAFT" });
    await expectDomainError(cases.getCase(await ctxFor("PARTNER_USER_B"), id), "NOT_FOUND");
    // linkPartner com origem própria não vincula ninguém.
    const own = await newCase("LAWYER", { linkPartner: true });
    const d = await cases.getCase(await ctxFor("LAWYER"), own);
    expect(d.legalCase.partnerOrganizationId).toBeNull();
  });

  it("ASSISTANT cadastra, envia e pede documentos, mas não aceita, rejeita nem encerra", async () => {
    const assistant = await ctxFor("ASSISTANT");
    const id = await newCase("ASSISTANT", { submit: true });
    await expectDomainError(cases.acceptCase(assistant, { id, lawyerId: world.users.LAWYER.id }), "FORBIDDEN");
    await expectDomainError(cases.rejectCase(assistant, { id, publicReason: "Sem interesse" }), "FORBIDDEN");
    await expectDomainError(cases.closeCase(assistant, id), "FORBIDDEN");
    // Segunda barreira: direto no banco, a RLS recusa o aceite do ASSISTANT.
    const { error } = await assistant.db.from("legal_cases").update({ status: "ACCEPTED", assigned_lawyer_id: world.users.LAWYER.id }).eq("id", id);
    expect(error).not.toBeNull();
    expect(await statusInDb(id)).toBe("SUBMITTED");
    await cases.requestCaseDocuments(assistant, id);
    expect(await statusInDb(id)).toBe("WAITING_DOCUMENTS");
    // Depois do aceite, o ASSISTANT não altera mais o caso.
    await cases.acceptCase(await ctxFor("LAWYER"), { id, lawyerId: world.users.LAWYER.id });
    await expectDomainError(cases.updateCase(assistant, { id, patch: { title: "Alterado" } }), "FORBIDDEN");
  });

  it("transição fora da máquina de estados → INVALID_STATE; o caminho normal passa", async () => {
    const lawyer = await ctxFor("LAWYER");
    const id = await newCase("LAWYER");
    await expectDomainError(cases.closeCase(lawyer, id), "INVALID_STATE");
    await expectDomainError(cases.acceptCase(lawyer, { id, lawyerId: world.users.LAWYER.id }), "INVALID_STATE"); // DRAFT → ACCEPTED
    await cases.submitCase(lawyer, id);
    await cases.acceptCase(lawyer, { id, lawyerId: world.users.LAWYER.id });
    await expectDomainError(cases.submitCase(lawyer, id), "INVALID_STATE"); // ACCEPTED → SUBMITTED
    await expectDomainError(cases.archiveCase(lawyer, id), "INVALID_STATE"); // ACCEPTED → ARCHIVED
    await cases.startCase(lawyer, id);
    await cases.closeCase(lawyer, id);
    await cases.archiveCase(lawyer, id);
    expect(await statusInDb(id)).toBe("ARCHIVED");
    // Nem ADMIN tira um caso do arquivo.
    await expectDomainError(cases.overrideCaseStatus(await ctxFor("ADMIN"), { id, status: "IN_PROGRESS", reason: "Tentativa" }), "INVALID_STATE");
  });

  it("exceção de status: só ADMIN reconsidera rejeição", async () => {
    const lawyer = await ctxFor("LAWYER");
    const id = await newCase("LAWYER", { submit: true });
    await cases.rejectCase(lawyer, { id, publicReason: "Fora do escopo" });
    await expectDomainError(cases.overrideCaseStatus(lawyer, { id, status: "SUBMITTED", reason: "Novos documentos" }), "FORBIDDEN");
    const admin = await ctxFor("ADMIN");
    await cases.overrideCaseStatus(admin, { id, status: "SUBMITTED", reason: "Novos documentos" });
    const detail = await cases.getCase(admin, id);
    expect(detail.legalCase.status).toBe("SUBMITTED");
    expect(detail.legalCase.rejectionReasonPublic).toBeUndefined();
  });

  it("troca de origem: livre para a equipe antes do aceite; depois, só ADMIN com motivo; nunca concede acesso", async () => {
    const lawyer = await ctxFor("LAWYER");
    const id = await newCase("LAWYER", { submit: true });
    await cases.changeCaseOrigin(lawyer, { id, originOrganizationId: world.partnerA, linkPartner: false });
    let detail = await cases.getCase(lawyer, id);
    expect(detail.legalCase).toMatchObject({ originOrganizationId: world.partnerA, partnerOrganizationId: null });
    await cases.changeCaseOrigin(lawyer, { id, originOrganizationId: world.owner, linkPartner: false });

    await cases.acceptCase(lawyer, { id, lawyerId: world.users.LAWYER.id });
    expect(await activeAgreements(id)).toBe(0);
    await expectDomainError(cases.changeCaseOrigin(lawyer, { id, originOrganizationId: world.partnerA, reason: "Indicação", linkPartner: false }), "FORBIDDEN");

    const admin = await ctxFor("ADMIN");
    await expectDomainError(cases.changeCaseOrigin(admin, { id, originOrganizationId: world.partnerA, linkPartner: false }), "INVALID_STATE", /motivo/i);
    await cases.changeCaseOrigin(admin, { id, originOrganizationId: world.partnerA, reason: "Indicação confirmada pelo parceiro", linkPartner: false });
    expect(await activeAgreements(id)).toBe(1);
    detail = await cases.getCase(admin, id);
    expect(detail.legalCase).toMatchObject({ originOrganizationId: world.partnerA, partnerOrganizationId: null });
    await expectDomainError(cases.getCase(await ctxFor("PARTNER_USER_A"), id), "NOT_FOUND");
  });

  it("listagem paginada com filtros (cliente, status, título) e ordenação da whitelist", async () => {
    const lawyer = await ctxFor("LAWYER");
    const clientId = await newClient();
    const title = `Lista ${world.run} Ímpar`;
    const draft = await newCase("LAWYER", { clientId, title });
    const sent = await newCase("LAWYER", { clientId, title, submit: true });

    const page1 = await cases.listCases(lawyer, listCasesSchema.parse({ clientId, pageSize: 1, sortBy: "createdAt", sortDirection: "asc" }));
    expect(page1).toMatchObject({ total: 2, pageSize: 1, hasMore: true });
    expect(page1.items.map((c) => c.id)).toEqual([draft]);
    expect(page1.items[0]).toMatchObject({ clientName: CLIENT_NAME, area: "BANKING", status: "DRAFT" });

    const submitted = await cases.listCases(lawyer, listCasesSchema.parse({ clientId, status: "SUBMITTED" }));
    expect(submitted.items.map((c) => c.id)).toEqual([sent]);

    const byTitle = await cases.listCases(lawyer, listCasesSchema.parse({ q: `lista ${world.run}`, pageSize: 50 }));
    expect(byTitle.items.map((c) => c.id)).toEqual(expect.arrayContaining([draft, sent]));
    const wildcard = await cases.listCases(lawyer, listCasesSchema.parse({ q: "%", pageSize: 5 }));
    expect(wildcard.items.every((c) => c.title.includes("%"))).toBe(true);
  });
});

describe("casos — Portal do Parceiro (A × B)", () => {
  it("parceiro A vê o caso do próprio escritório mesmo com origem OWNER; aceite não cria snapshot", async () => {
    const title = `Origem proprietário ${world.run}`;
    const { legalCaseId: id, clientId, clientExisted } = await partnerCase("PARTNER_ADMIN_A", "OWNER", title);
    expect(clientExisted).toBe(false);

    const pu = await ctxFor("PARTNER_USER_A");
    const detail = await cases.getCase(pu, id);
    expect(detail.surface).toBe("PARTNER");
    expect(detail.legalCase).toMatchObject({ status: "SUBMITTED", clientId, originOrganizationId: world.owner, partnerOrganizationId: world.partnerA, area: "BANKING" });
    const list = await cases.listCases(pu, listCasesSchema.parse({ q: title, pageSize: 50 }));
    expect(list.items.map((c) => c.id)).toContain(id);
    expect(list.items.find((c) => c.id === id)?.assignedLawyerId).toBeUndefined();

    await cases.acceptCase(await ctxFor("LAWYER"), { id, lawyerId: world.users.LAWYER.id });
    expect(await activeAgreements(id)).toBe(0);
    const after = await cases.getCase(pu, id);
    expect(after.legalCase.status).toBe("ACCEPTED");
    for (const field of INTERNAL_ONLY_FIELDS) expect(after.legalCase).not.toHaveProperty(field);
  });

  it("origem do próprio parceiro: aceite cria o snapshot da parceria", async () => {
    const { legalCaseId: id } = await partnerCase("PARTNER_USER_A");
    await cases.acceptCase(await ctxFor("LAWYER"), { id, lawyerId: world.users.LAWYER.id });
    expect(await activeAgreements(id)).toBe(1);
  });

  it("rejeição: parceiro recebe só o motivo público", async () => {
    const { legalCaseId: id } = await partnerCase("PARTNER_ADMIN_A");
    const lawyer = await ctxFor("LAWYER");
    expect(await cases.rejectCase(lawyer, { id, publicReason: "Documentação insuficiente", internalNote: "não pode vazar: risco alto" })).toEqual({
      alreadyRejected: false,
    });
    expect(await cases.rejectCase(lawyer, { id, publicReason: "Outro motivo" })).toEqual({ alreadyRejected: true });

    const internal = await cases.getCase(lawyer, id);
    expect(internal.legalCase).toMatchObject({ status: "REJECTED", rejectionReasonPublic: "Documentação insuficiente", rejectionReasonInternal: "não pode vazar: risco alto" });

    const pa = await ctxFor("PARTNER_ADMIN_A");
    const partner = await cases.getCase(pa, id);
    expect(partner.surface).toBe("PARTNER");
    expect(partner.legalCase).toMatchObject({ status: "REJECTED", rejectionReasonPublic: "Documentação insuficiente" });
    expect(JSON.stringify(partner)).not.toContain("não pode vazar");
    for (const field of INTERNAL_ONLY_FIELDS) expect(partner.legalCase).not.toHaveProperty(field);
    // Nem direto no banco o parceiro lê os dados internos do caso.
    const { data } = await pa.db.from("legal_case_internal_details").select("rejection_reason_internal").eq("legal_case_id", id);
    expect(data ?? []).toEqual([]);
  });

  it("parceiro B não lê, não lista e não altera caso de A (IDOR); A não altera caso já enviado", async () => {
    const { legalCaseId: id } = await partnerCase("PARTNER_ADMIN_A");
    const b = await ctxFor("PARTNER_ADMIN_B");
    await expectDomainError(cases.getCase(b, id), "NOT_FOUND");
    const list = await cases.listCases(b, listCasesSchema.parse({ pageSize: 50, partnerOrganizationId: world.partnerA }));
    expect(list.items.map((c) => c.id)).not.toContain(id);
    await expectDomainError(cases.updateCase(b, { id, patch: { title: "Invadido" } }), "NOT_FOUND");
    await expectDomainError(cases.submitCase(b, id), "NOT_FOUND");
    // Direto no banco: a RLS não alcança a linha.
    const { count } = await b.db.from("legal_cases").update({ title: "Invadido" }, { count: "exact" }).eq("id", id);
    expect(count ?? 0).toBe(0);

    const a = await ctxFor("PARTNER_ADMIN_A");
    await expectDomainError(cases.updateCase(a, { id, patch: { title: "Mudou" } }), "INVALID_STATE");
    await expectDomainError(cases.acceptCase(a, { id, lawyerId: world.users.LAWYER.id }), "FORBIDDEN");
    const { data } = await serviceDb().from("legal_cases").select("title, status").eq("id", id).single();
    expect(data).toMatchObject({ title: `Caso parceiro ${world.run}`, status: "SUBMITTED" });
  });

  it("parceiro edita e envia o próprio rascunho; nota interna é recusada", async () => {
    const { clientId } = await partnerCase("PARTNER_ADMIN_A");
    // Rascunho do parceiro preparado com a service role (o portal só cria casos já enviados).
    const draftId = randomUUID();
    const { error } = await serviceDb().from("legal_cases").insert({
      id: draftId,
      client_id: clientId,
      legal_area_id: world.bankingAreaId,
      title: "Rascunho do parceiro",
      status: "DRAFT",
      partner_organization_id: world.partnerA,
      origin_organization_id: world.partnerA,
      created_by_organization_id: world.partnerA,
    });
    expect(error).toBeNull();

    const pa = await ctxFor("PARTNER_ADMIN_A");
    await cases.updateCase(pa, { id: draftId, patch: { title: "Rascunho editado", partnerNotes: "Cliente prefere contato à tarde" } });
    await expectDomainError(cases.updateCase(pa, { id: draftId, patch: { notes: "interna" } }), "FORBIDDEN");
    await cases.submitCase(pa, draftId);
    const detail = await cases.getCase(pa, draftId);
    expect(detail.legalCase).toMatchObject({ title: "Rascunho editado", partnerNotes: "Cliente prefere contato à tarde", status: "SUBMITTED" });
    await expectDomainError(cases.updateCase(await ctxFor("PARTNER_USER_B"), { id: draftId, patch: { title: "B" } }), "NOT_FOUND");
  });

  it("equipe interna não usa o envio do portal; parceiro não usa o cadastro interno", async () => {
    await expectDomainError(partnerCase("LAWYER"), "FORBIDDEN");
    const clientId = (await partnerCase("PARTNER_ADMIN_A")).clientId;
    await expectDomainError(
      cases.createCase(await ctxFor("PARTNER_ADMIN_A"), createCaseSchema.parse({ idempotencyKey: randomUUID(), clientId, area: "BANKING", title: "X", originOrganizationId: world.partnerA })),
      "FORBIDDEN",
    );
  });
});
