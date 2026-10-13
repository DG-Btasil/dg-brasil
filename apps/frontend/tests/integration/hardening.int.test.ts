import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as cases from "@/server/domain/cases/service";
import { createCaseSchema, partnerSubmitCaseSchema } from "@/server/domain/cases/schemas";
import * as clients from "@/server/domain/clients/service";
import { createClientSchema } from "@/server/domain/clients/schemas";
import * as organizations from "@/server/domain/organizations/service";
import * as processes from "@/server/domain/processes/service";
import { createPartnerProcessSchema, createProcessSchema } from "@/server/domain/processes/schemas";
import { ctxFor, expectDomainError, fakeCnj, fakeCpf, serviceDb, world } from "./support/world";

/**
 * Etapa 4.2.1 no Supabase DEV: idempotência genérica (027) na criação de caso
 * e de processo — repetição, envio simultâneo (clique duplo), nova tentativa
 * após "timeout" e chave reaproveitada com outros dados — e a divisão do
 * próprio escritório para o administrador do parceiro.
 */

async function internalClient(): Promise<string> {
  const { id } = await clients.createClient(
    await ctxFor("LAWYER"),
    createClientSchema.parse({ kind: "INDIVIDUAL", cpf: fakeCpf(), fullName: "Cliente Hardening", originOfficeId: world.owner }),
  );
  return id;
}

const caseInput = (clientId: string, key: string, title = `Caso hardening ${world.run}`) =>
  createCaseSchema.parse({ idempotencyKey: key, clientId, area: "BANKING", title, originOrganizationId: world.owner, notes: "nota interna" });

const countCases = async (title: string) =>
  (await serviceDb().from("legal_cases").select("id", { count: "exact", head: true }).eq("title", title)).count;

describe("idempotência — criação de caso", () => {
  it("duas chamadas sequenciais com a mesma chave: um caso; a segunda é repetição", async () => {
    const lawyer = await ctxFor("LAWYER");
    const clientId = await internalClient();
    const key = randomUUID();
    const title = `Caso seq ${randomUUID()}`;
    const a = await cases.createCase(lawyer, caseInput(clientId, key, title));
    const b = await cases.createCase(lawyer, caseInput(clientId, key, title));
    expect([a.deduplicated, b.deduplicated, b.id]).toEqual([false, true, a.id]);
    expect(await countCases(title)).toBe(1);
  });

  it("duas chamadas CONCORRENTES (clique duplo) com a mesma chave: um caso", async () => {
    const lawyer = await ctxFor("LAWYER");
    const clientId = await internalClient();
    const key = randomUUID();
    const title = `Caso concorrente ${randomUUID()}`;
    const [a, b] = await Promise.all([cases.createCase(lawyer, caseInput(clientId, key, title)), cases.createCase(lawyer, caseInput(clientId, key, title))]);
    expect(a.id).toBe(b.id);
    expect([a.deduplicated, b.deduplicated].sort()).toEqual([false, true]);
    expect(await countCases(title)).toBe(1);
  });

  it("retry após timeout (a resposta se perdeu): mesma chave devolve o caso original", async () => {
    const clientId = await internalClient();
    const key = randomUUID();
    const title = `Caso retry ${randomUUID()}`;
    // A primeira chamada conclui no banco; o "cliente" descarta a resposta.
    await cases.createCase(await ctxFor("LAWYER"), caseInput(clientId, key, title));
    // Nova requisição (novo contexto, novo requestId), mesma chave.
    const retry = await cases.createCase(await ctxFor("LAWYER"), caseInput(clientId, key, title));
    expect(retry.deduplicated).toBe(true);
    expect(await countCases(title)).toBe(1);
  });

  it("mesma chave com dados diferentes: CONFLICT (não reaproveita o anterior)", async () => {
    const lawyer = await ctxFor("LAWYER");
    const clientId = await internalClient();
    const key = randomUUID();
    await cases.createCase(lawyer, caseInput(clientId, key, `Caso A ${randomUUID()}`));
    await expectDomainError(cases.createCase(lawyer, caseInput(clientId, key, `Caso B ${randomUUID()}`)), "CONFLICT", /já foi usada com outros dados/);
  });

  it("portal: envio repetido e simultâneo com a mesma chave cria um único cliente + caso", async () => {
    const pa = await ctxFor("PARTNER_ADMIN_A");
    const key = randomUUID();
    const title = `Caso portal hardening ${randomUUID()}`;
    const input = partnerSubmitCaseSchema.parse({
      idempotencyKey: key,
      client: { kind: "INDIVIDUAL", document: fakeCpf(), fullName: "Cliente Portal Hardening", origin: "OWN_OFFICE" },
      case: { area: "BANKING", title, origin: "OWN_OFFICE" },
    });
    const [a, b] = await Promise.all([cases.partnerSubmitCase(pa, input), cases.partnerSubmitCase(pa, input)]);
    expect([a.legalCaseId, a.clientId]).toEqual([b.legalCaseId, b.clientId]);
    const retry = await cases.partnerSubmitCase(await ctxFor("PARTNER_ADMIN_A"), input);
    expect(retry).toMatchObject({ legalCaseId: a.legalCaseId, deduplicated: true });
    expect(await countCases(title)).toBe(1);
  });
});

describe("idempotência — criação de processo", () => {
  async function caseId(): Promise<string> {
    const { id } = await cases.createCase(await ctxFor("LAWYER"), caseInput(await internalClient(), randomUUID(), `Caso p/ processo ${randomUUID()}`));
    return id;
  }
  const processInput = (legalCaseId: string, key: string, title: string, extra: Record<string, unknown> = {}) =>
    createProcessSchema.parse({ idempotencyKey: key, legalCaseId, title, ...extra });
  const countProcesses = async (title: string) =>
    (await serviceDb().from("legal_processes").select("id", { count: "exact", head: true }).eq("title", title)).count;

  it("sequencial, com prazo inicial: um processo e um prazo", async () => {
    const lawyer = await ctxFor("LAWYER");
    const legalCaseId = await caseId();
    const key = randomUUID();
    const title = `Processo seq ${randomUUID()}`;
    const input = processInput(legalCaseId, key, title, { cnj: fakeCnj(), nextDeadline: { title: "Contestação", type: "REPLY", dueDate: "2026-12-15" } });
    const a = await processes.createProcess(lawyer, input);
    const b = await processes.createProcess(lawyer, input);
    expect([a.deduplicated, b.deduplicated, b.id]).toEqual([false, true, a.id]);
    expect(await countProcesses(title)).toBe(1);
    const { count } = await serviceDb().from("deadlines").select("id", { count: "exact", head: true }).eq("legal_process_id", a.id);
    expect(count).toBe(1);
  });

  it("concorrente (clique duplo), sem CNJ: um processo", async () => {
    const lawyer = await ctxFor("LAWYER");
    const legalCaseId = await caseId();
    const key = randomUUID();
    const title = `Processo concorrente ${randomUUID()}`;
    const input = processInput(legalCaseId, key, title);
    const [a, b] = await Promise.all([processes.createProcess(lawyer, input), processes.createProcess(lawyer, input)]);
    expect(a.id).toBe(b.id);
    expect(await countProcesses(title)).toBe(1);
  });

  it("retry após timeout devolve o original; chave com outros dados → CONFLICT", async () => {
    const legalCaseId = await caseId();
    const key = randomUUID();
    const title = `Processo retry ${randomUUID()}`;
    const first = await processes.createProcess(await ctxFor("LAWYER"), processInput(legalCaseId, key, title));
    const retry = await processes.createProcess(await ctxFor("LAWYER"), processInput(legalCaseId, key, title));
    expect(retry).toEqual({ id: first.id, deduplicated: true });
    await expectDomainError(processes.createProcess(await ctxFor("LAWYER"), processInput(legalCaseId, key, `${title} (outro)`)), "CONFLICT");
    expect(await countProcesses(title)).toBe(1);
  });

  it("parceiro: processo no próprio caso é idempotente", async () => {
    const pa = await ctxFor("PARTNER_ADMIN_A");
    const submitted = await cases.partnerSubmitCase(
      pa,
      partnerSubmitCaseSchema.parse({
        idempotencyKey: randomUUID(),
        client: { kind: "INDIVIDUAL", document: fakeCpf(), fullName: "Cliente Processo Hardening", origin: "OWN_OFFICE" },
        case: { area: "BANKING", title: `Caso parceiro p/ processo ${randomUUID()}`, origin: "OWN_OFFICE" },
      }),
    );
    const key = randomUUID();
    const input = createPartnerProcessSchema.parse({ idempotencyKey: key, legalCaseId: submitted.legalCaseId, title: `Processo parceiro ${randomUUID()}` });
    const [a, b] = await Promise.all([processes.createPartnerProcess(pa, input), processes.createPartnerProcess(pa, input)]);
    expect(a.id).toBe(b.id);
  });
});

describe("divisão do próprio escritório (administrador do parceiro)", () => {
  it("PARTNER_ADMIN A recebe só a de A, com os campos permitidos", async () => {
    const s = await organizations.getMyPartnerSettings(await ctxFor("PARTNER_ADMIN_A"));
    expect(Object.keys(s).sort()).toEqual(["activatedAt", "organizationId", "organizationName", "ownerPercentage", "partnerPercentage"]);
    expect(s.organizationId).toBe(world.partnerA);
    expect(s.partnerPercentage + s.ownerPercentage).toBe(100);
  });

  it("PARTNER_ADMIN B recebe a de B; A nunca vê a de B (não há parâmetro)", async () => {
    expect((await organizations.getMyPartnerSettings(await ctxFor("PARTNER_ADMIN_B"))).organizationId).toBe(world.partnerB);
    // Tentativa indireta: chamar a RPC com argumento → recusada pela API (sem parâmetro).
    const { error } = await (await ctxFor("PARTNER_ADMIN_A")).db.rpc("get_my_partner_settings", { p_organization_id: world.partnerB });
    expect(error).not.toBeNull();
  });

  it("PARTNER_USER e equipe interna: FORBIDDEN", async () => {
    await expectDomainError(organizations.getMyPartnerSettings(await ctxFor("PARTNER_USER_A")), "FORBIDDEN");
    await expectDomainError(organizations.getMyPartnerSettings(await ctxFor("ADMIN")), "FORBIDDEN");
  });

  it("parceiro continua sem SELECT em partner_office_settings", async () => {
    const { data } = await (await ctxFor("PARTNER_ADMIN_A")).db.from("partner_office_settings").select("organization_id");
    expect(data ?? []).toEqual([]);
  });
});
