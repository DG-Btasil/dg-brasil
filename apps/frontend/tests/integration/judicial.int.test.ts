import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger } from "@/server/core/logger";
import { callPrivate } from "@/server/core/worker-db";
import * as clients from "@/server/domain/clients/service";
import { createClientSchema } from "@/server/domain/clients/schemas";
import * as judicial from "@/server/domain/judicial/service";
import {
  calendarDaySchema, createDeadlineSchema, decideSchema, listPublicationsSchema, previewSchema, saveMonitorSchema,
} from "@/server/domain/judicial/schemas";
import * as processes from "@/server/domain/processes/service";
import { createProcessSchema } from "@/server/domain/processes/schemas";
import { normalizeDatajud } from "@/server/integrations/judicial/datajud";
import { normalizeDjenItem, type DjenItem } from "@/server/integrations/judicial/djen";
import { JUDICIAL_DB_FUNCTIONS, runJudicialSync, type JudicialDbFunction } from "@/server/integrations/judicial/sync";
import { integrationEnv } from "./support/env";
import { ctxFor, dbFor, expectDomainError, fakeCnj, fakeCpf, serviceDb, world } from "./support/world";

/**
 * Integração judicial (migration 043) contra o Supabase DEV real. O DJEN e o
 * DataJud são SIMULADOS (nenhuma chamada externa); banco, login dg_worker,
 * RLS, avisos e services são os de verdade.
 *
 *   - processo com CNJ fica acompanhado; parceiro vê a situação sem detalhe técnico;
 *   - OABs: ADMIN (escritório) e administrador do parceiro (o próprio); usuário comum não;
 *   - publicação só entra em processo cadastrado; do resto, só o número; sem duplicar;
 *   - parceiro vê a movimentação do próprio processo (B não vê) e recebe o aviso;
 *   - prazo criado a partir da publicação; assistente não decide;
 *   - DataJud: linha de base sem aviso; movimentação nova avisa; nada duplica.
 *
 * Dados FICTÍCIOS. As OABs do teste ficam pausadas no fim (a busca diária não as consulta).
 */

integrationEnv();
if (!process.env.DG_WORKER_DB_URL) {
  throw new Error("Falta DG_WORKER_DB_URL em supabase/.env.real (login dg_worker pelo pooler IPv4 do Supabase).");
}

const svc = serviceDb();
// As tabelas judiciais não abrem nem para o service_role (043); a conferência lê como postgres.
async function adminRows<T extends pg.QueryResultRow>(sql: string, params: unknown[]): Promise<T[]> {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    return (await c.query<T>(sql, params)).rows;
  } finally {
    await c.end();
  }
}
const db = <T>(fn: JudicialDbFunction, args: unknown[]) => callPrivate<T>(JUDICIAL_DB_FUNCTIONS, fn, args);
const fakeOab = () => `9${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;
const state = {
  oabOffice: fakeOab(), oabPartner: fakeOab(),
  partnerCase: "", partnerProcess: "", partnerCnj: fakeCnj(),
  internalCase: "", internalProcess: "", internalCnj: fakeCnj(),
  monitors: [] as string[], publication: "", calendarDay: "", deadlineAgent: undefined as string | undefined,
};
const djenId = () => String(Math.floor(Math.random() * 9e11) + 1e11);

const raw = (cnj: string, id = djenId(), over: Record<string, unknown> = {}) => ({
  id, data_disponibilizacao: "2026-11-03", siglaTribunal: "TJSP", tipoComunicacao: "Intimação", nomeOrgao: "Vara FICTÍCIA",
  texto: `<p>Intimação FICTÍCIA ${world.run}: manifeste-se em 15 dias.</p>`, numero_processo: cnj, link: "https://exemplo.invalid/x",
  nomeClasse: "PROCEDIMENTO COMUM CÍVEL", hash: `H${id}abcdef`, ativo: true, status: "P", ...over,
});

async function ingest(oab: string, items: DjenItem[]) {
  const begin = await db<{ busy: boolean; run_id: string }>("judicial_sync_begin", ["MANUAL", world.users.ADMIN.id, null, false]);
  if (begin.busy) throw new Error("Há uma busca judicial em andamento no DEV; rode o teste de novo em alguns minutos.");
  try {
    return await db<{ ok: boolean; found: number; matched: number; new: number; duplicates: number; unmatched: number }>(
      "judicial_ingest_djen", [begin.run_id, oab, "AC", "2026-11-01", "2026-11-03", true, null, items]);
  } finally {
    await db("judicial_sync_finish", [begin.run_id, "COMPLETED", { test: 1 }, null]);
  }
}

beforeAll(async () => {
  // Com agente de prazos configurado no DEV, cada publicação viraria trabalho real
  // na fila do computador do escritório: o teste desliga e devolve no fim.
  const admin = await ctxFor("ADMIN");
  state.deadlineAgent = (await judicial.getOverview(admin)).settings.deadlineAgentId;
  if (state.deadlineAgent) await judicial.saveSettings(admin, { deadlineAgentId: null });
  const lawyer = await ctxFor("LAWYER");
  const pa = (await (await ctxFor("PARTNER_ADMIN_A")).db.rpc("partner_submit_case", {
    p_client: { document: fakeCpf(), kind: "INDIVIDUAL", origin_organization_id: world.partnerA, full_name: "Cliente Judicial Parceiro A" },
    p_case: { legal_area_id: world.bankingAreaId, title: `Caso judicial A ${world.run}`, origin_organization_id: world.partnerA },
  })).data as { legal_case_id: string };
  state.partnerCase = pa.legal_case_id;
  state.partnerProcess = (await processes.createProcess(lawyer, createProcessSchema.parse({
    idempotencyKey: randomUUID(), legalCaseId: state.partnerCase, title: `Processo judicial A ${world.run}`, cnj: state.partnerCnj,
  }))).id;

  const { id: clientId } = await clients.createClient(lawyer, createClientSchema.parse({ kind: "INDIVIDUAL", cpf: fakeCpf(), fullName: "Cliente Judicial Interno", originOfficeId: world.owner }));
  state.internalCase = randomUUID();
  const ins = await lawyer.db.from("legal_cases").insert({ id: state.internalCase, client_id: clientId, legal_area_id: world.bankingAreaId,
    title: `Caso judicial interno ${world.run}`, origin_organization_id: world.owner, status: "DRAFT", assigned_lawyer_id: world.users.LAWYER.id });
  if (ins.error) throw new Error(ins.error.message);
  state.internalProcess = (await processes.createProcess(lawyer, createProcessSchema.parse({
    idempotencyKey: randomUUID(), legalCaseId: state.internalCase, title: `Processo judicial interno ${world.run}`, cnj: state.internalCnj,
  }))).id;
});

afterAll(async () => {
  if (state.deadlineAgent) await judicial.saveSettings(await ctxFor("ADMIN"), { deadlineAgentId: state.deadlineAgent }).catch(() => undefined);
  for (const id of state.monitors) await judicial.setMonitorActive(await ctxFor("ADMIN"), id, false).catch(() => undefined);
  if (state.calendarDay) await judicial.deleteCalendarDay(await ctxFor("ADMIN"), state.calendarDay).catch(() => undefined);
});

describe("Integração judicial no banco real (043), DJEN e DataJud simulados", () => {
  it("processo com CNJ fica acompanhado; parceiro vê a situação sem detalhe técnico", async () => {
    const s = await judicial.getProcessStatus(await ctxFor("LAWYER"), state.partnerProcess);
    expect([s.hasCnj, s.tracked, s.canManage]).toEqual([true, true, true]);
    const p = await judicial.getProcessStatus(await ctxFor("PARTNER_USER_A"), state.partnerProcess);
    expect([p.tracked, p.lastError, p.publications]).toEqual([true, undefined, undefined]);
    await expect(judicial.getProcessStatus(await ctxFor("PARTNER_USER_B"), state.partnerProcess)).rejects.toThrow();
  });

  it("OABs: ADMIN cadastra a do escritório, administrador do parceiro a própria; usuário comum e advogado não", async () => {
    const a = await judicial.saveMonitor(await ctxFor("ADMIN"), saveMonitorSchema.parse({ oabNumber: state.oabOffice, oabState: "AC", lawyerName: "Advogada FICTÍCIA" }));
    const b = await judicial.saveMonitor(await ctxFor("PARTNER_ADMIN_A"), saveMonitorSchema.parse({ oabNumber: state.oabPartner, oabState: "AC" }));
    state.monitors.push(a.id, b.id);
    await expectDomainError(judicial.saveMonitor(await ctxFor("PARTNER_USER_A"), saveMonitorSchema.parse({ oabNumber: "123", oabState: "AC" })), "FORBIDDEN");
    await expectDomainError(judicial.saveMonitor(await ctxFor("LAWYER"), saveMonitorSchema.parse({ oabNumber: "123", oabState: "AC" })), "FORBIDDEN");
    const mineA = await judicial.getMyMonitors(await ctxFor("PARTNER_USER_A"));
    expect(mineA.monitors.some((m) => m.id === b.id) && !mineA.monitors.some((m) => m.id === a.id)).toBe(true);
    const mineB = await judicial.getMyMonitors(await ctxFor("PARTNER_ADMIN_B"));
    expect(mineB.monitors.some((m) => m.id === b.id)).toBe(false);
    await expect(judicial.setMonitorActive(await ctxFor("PARTNER_ADMIN_B"), b.id, false)).rejects.toThrow(/não encontrada/);
    const o = await judicial.getOverview(await ctxFor("LAWYER"));
    expect(o.monitors.find((m) => m.id === b.id)?.organizationType).toBe("PARTNER");
    expect(o.canManage).toBe(false);
  });

  it("DJEN: só entra publicação de processo cadastrado; do resto só a contagem (nem o número); repetida não duplica", async () => {
    const outside = fakeCnj();
    const sameId = djenId();
    const items = [raw(state.partnerCnj, sameId), raw(state.internalCnj), raw(outside)].map((r) => normalizeDjenItem(r)!);
    const r = await ingest(state.oabOffice, items);
    expect([r.found, r.matched, r.new, r.unmatched]).toEqual([3, 2, 2, 1]);
    const again = await ingest(state.oabPartner, [normalizeDjenItem(raw(state.partnerCnj, sameId))!]);
    expect([again.new, again.duplicates]).toEqual([0, 1]);

    const pubs = await adminRows<{ id: string; legal_process_id: string; found_by: string[]; content: string }>(
      "select id, legal_process_id, found_by, content from public.judicial_publications where legal_process_id = any($1::uuid[])",
      [[state.partnerProcess, state.internalProcess]]);
    expect(pubs.length).toBe(2);
    const pa = pubs.find((p) => p.legal_process_id === state.partnerProcess)!;
    expect(pa.found_by).toEqual([`AC ${state.oabOffice}`, `AC ${state.oabPartner}`]);
    expect(pa.content).not.toMatch(/<p>/);
    expect((await adminRows("select id from public.judicial_publications where cnj_number = $1", [outside])).length).toBe(0);
    const st = (await judicial.getOverview(await ctxFor("ADMIN"))).monitors.find((m) => m.id === state.monitors[0])!;
    expect([st.lastFound, st.lastMatched]).toEqual([3, 2]);
    expect(JSON.stringify(st)).not.toContain(outside);
    state.publication = pubs.find((p) => p.legal_process_id === state.internalProcess)!.id;
  });

  it("parceiro A vê a publicação do próprio processo e recebe o aviso; parceiro B não vê; nenhum parceiro lê a triagem", async () => {
    const a = await dbFor("PARTNER_USER_A").from("process_events").select("event_type, source").eq("legal_process_id", state.partnerProcess);
    expect(a.data?.map((e) => [e.event_type, e.source])).toContainEqual(["PUBLICATION", "JUDICIAL_INTEGRATION"]);
    const b = await dbFor("PARTNER_USER_B").from("process_events").select("id").eq("legal_process_id", state.partnerProcess);
    expect(b.data ?? []).toEqual([]);
    const n = await svc.from("notifications").select("user_id").eq("type", "PUBLICATION_RECEIVED").eq("legal_process_id", state.partnerProcess);
    expect(n.data!.map((x) => x.user_id)).toEqual(expect.arrayContaining([world.users.PARTNER_ADMIN_A.id, world.users.PARTNER_USER_A.id]));
    expect(n.data!.map((x) => x.user_id)).not.toContain(world.users.PARTNER_ADMIN_B.id);
    expect((await dbFor("PARTNER_USER_A").from("judicial_publications").select("id")).error).not.toBeNull();
  });

  it("triagem: lista, detalhe com contagem; advogado cria o prazo; assistente não decide; sem prazo exige motivo", async () => {
    const lawyer = await ctxFor("LAWYER");
    const page = await judicial.listPublications(lawyer, listPublicationsSchema.parse({ status: "OPEN", processId: state.internalProcess }));
    expect(page.items.map((x) => x.id)).toEqual([state.publication]);
    const d = await judicial.getPublication(await ctxFor("ASSISTANT"), state.publication);
    expect([d.suggestion.publishedOn, d.suggestion.businessDays]).toEqual(["2026-11-04", 15]);
    await expectDomainError(judicial.createDeadline(await ctxFor("ASSISTANT"), createDeadlineSchema.parse({ id: state.publication, title: "x", dueOn: "2026-11-25" })), "FORBIDDEN");
    await expect(judicial.decidePublication(lawyer, decideSchema.parse({ id: state.publication, action: "NO_DEADLINE" }))).rejects.toThrow(/por que/);
    const r = await judicial.createDeadline(lawyer, createDeadlineSchema.parse({ id: state.publication, title: `Manifestação ${world.run}`, dueOn: d.suggestion.dueOn, deadlineType: "MANIFESTATION" }));
    const { data: dl } = await svc.from("deadlines").select("source, legal_process_id, responsible_user_id").eq("id", r.deadline_id).single();
    expect([dl!.source, dl!.legal_process_id, dl!.responsible_user_id]).toEqual(["JUDICIAL_INTEGRATION", state.internalProcess, world.users.LAWYER.id]);
    const after = await judicial.getPublication(lawyer, state.publication);
    expect([after.triageStatus, after.triageOutcome, after.deadline?.id]).toEqual(["DONE", "DEADLINE", r.deadline_id]);
  });

  it("DataJud (processo pedido na tela): linha de base sem aviso; movimentação nova avisa; nada duplica", async () => {
    const mov = (codigo: number, nome: string, dataHora: string) => ({ codigo, nome, dataHora, orgaoJulgador: { codigo: "1" } });
    let movimentos = [mov(26, "Distribuído por sorteio", "2026-03-10T12:00:00Z"), mov(51, "Conclusos", "2026-04-01T12:00:00Z")];
    const fake = { process: async (c: string) => normalizeDatajud("tjsp", c, [{ _id: `TJSP_G1_${c}`, _source: { numeroProcesso: c, grau: "G1", classe: { nome: "Procedimento Comum Cível" }, orgaoJulgador: { nome: "Vara FICTÍCIA" }, movimentos } }]) };
    const deps = () => ({ db, djen: { byOab: async () => [] }, datajud: fake, log: createLogger({ test: "judicial" }) });
    const r1 = await runJudicialSync(deps(), { trigger: "MANUAL", requestedBy: world.users.LAWYER.id, processId: state.internalProcess });
    if (r1.busy || r1.idle) throw new Error("busy");
    expect([r1.status, r1.stats.processesRead, r1.stats.movementsNew]).toEqual(["COMPLETED", 1, 2]);
    const silent = await svc.from("notifications").select("id").eq("type", "PROCESS_MOVEMENT").eq("legal_process_id", state.internalProcess);
    expect(silent.data).toEqual([]);

    movimentos = [...movimentos, mov(193, "Julgado procedente", "2026-11-02T12:00:00Z")];
    const r2 = await runJudicialSync(deps(), { trigger: "MANUAL", requestedBy: world.users.LAWYER.id, processId: state.internalProcess });
    if (r2.busy || r2.idle) throw new Error("busy");
    expect(r2.stats.movementsNew).toBe(1);
    const ev = await svc.from("process_events").select("id").eq("legal_process_id", state.internalProcess).eq("external_provider", "DATAJUD");
    expect(ev.data!.length).toBe(3);
    const n = await svc.from("notifications").select("user_id, message").eq("type", "PROCESS_MOVEMENT").eq("legal_process_id", state.internalProcess);
    expect(n.data).toEqual([{ user_id: world.users.LAWYER.id, message: "Julgado procedente" }]);
    const p = await svc.from("legal_processes").select("legal_class").eq("id", state.internalProcess).single();
    expect(p.data!.legal_class).toBe("Procedimento Comum Cível");
  });

  it("calendário: ADMIN cadastra feriado do tribunal e a contagem pula o dia; advogado não cadastra", async () => {
    await expectDomainError(judicial.saveCalendarDay(await ctxFor("LAWYER"), calendarDaySchema.parse({ court: "TJAC", day: "2099-03-02", kind: "HOLIDAY", description: "x" })), "FORBIDDEN");
    const before = await judicial.previewDeadline(await ctxFor("LAWYER"), previewSchema.parse({ availableOn: "2099-02-26", court: "TJAC", businessDays: 1 }));
    const r = await judicial.saveCalendarDay(await ctxFor("ADMIN"), calendarDaySchema.parse({ court: "TJAC", day: before.dueOn, kind: "HOLIDAY", description: `Feriado FICTÍCIO ${world.run}` }));
    state.calendarDay = r.id;
    const after = await judicial.previewDeadline(await ctxFor("LAWYER"), previewSchema.parse({ availableOn: "2099-02-26", court: "TJAC", businessDays: 1 }));
    expect(after.dueOn > before.dueOn).toBe(true);
    expect(after.skipped.map((s) => s.day)).toContain(before.dueOn);
  });
});
