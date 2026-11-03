import { describe, expect, it } from "vitest";
import * as imports from "@/server/domain/imports/service";
import type { ImportJobDTO } from "@/server/domain/imports/dto";
import { buildXlsx } from "@/server/domain/imports/test-xlsx";
import { ctxFor, dbFor, expectDomainError, fakeCnj, fakeCpf, serviceDb, world } from "./support/world";

/**
 * Importação de planilhas (Etapa 7, migration 042) contra o Supabase DEV real:
 * Storage `imports` (upload por URL assinada, leitura e remoção pelo
 * servidor), operações import_* com o JWT aal2 do ADMIN, RLS e gatilhos reais.
 *
 *   1. CSV: envio → colunas → simulação (nada gravado) → confirmação →
 *      gravação em lotes → relatório; arquivo apagado no fim.
 *   2. XLSX com o MESMO cliente e o MESMO processo: conflitos CPF e CNJ,
 *      decisão, prévia = resultado.
 *   3. Arquivo ilegível → FAILED; cancelamento apaga o arquivo.
 *   4. Advogado e assistente não importam (servidor e banco).
 *
 * Dados FICTÍCIOS (CPF 999…, CNJ com DV válido).
 */

const svc = serviceDb();
const tag = `imp-${world.run}`;
const enc = (s: string) => new TextEncoder().encode(s);

async function upload(fileName: string, bytes: Uint8Array) {
  const ctx = await ctxFor("ADMIN");
  const started = await imports.startImport(ctx, { fileName, sizeBytes: bytes.byteLength });
  // Como o navegador: só a URL assinada, sem sessão.
  const { error } = await svc.storage.from(started.bucket).uploadToSignedUrl(started.path, started.token, bytes, { contentType: started.contentType, upsert: false });
  if (error) throw new Error(`upload: ${error.message}`);
  return started;
}

async function processAll(jobId: string) {
  const ctx = await ctxFor("ADMIN");
  let r = await imports.processBatch(ctx, jobId);
  for (let i = 0; r.status !== "COMPLETED" && i < 100; i++) r = await imports.processBatch(ctx, jobId);
  return r;
}

const state = { cpfA: fakeCpf(), cpfB: fakeCpf(), cnjA: fakeCnj(), cnjB: fakeCnj(), jobCsv: "", jobXlsx: "" };
const lawyerId = world.users.LAWYER.id;

describe("importação de planilhas (042) — Supabase DEV", () => {
  it("CSV: colunas lidas do Storage, sugestão de mapeamento e aviso de arquivo repetido só no segundo envio", async () => {
    const csv = [
      "Nome;CPF;Telefone;Processo;Ação;Responsável;Vencimento;Valor da causa",
      `Ana ${tag};${state.cpfA};(11) 98888-0001;${state.cnjA};Revisional de consignado;;31/12/2099;R$ 1.500,00`,
      `Ana ${tag};${state.cpfA};;${state.cnjB};Repetição de indébito;;;`,
      `Bruno ${tag};${state.cpfB};;;;;;`,
      `Sem CPF ${tag};;;;;;;`,
    ].join("\r\n");
    const s = await upload(`clientes-${tag}.csv`, enc(csv));
    state.jobCsv = s.jobId;
    const ctx = await ctxFor("ADMIN");
    const cols = await imports.readColumns(ctx, { jobId: s.jobId });
    expect(cols.headers).toEqual(["Nome", "CPF", "Telefone", "Processo", "Ação", "Responsável", "Vencimento", "Valor da causa"]);
    expect(cols.totalRows).toBe(4);
    expect(cols.suggestedMapping).toMatchObject({ Nome: "client.name", CPF: "client.document", Processo: "process.cnj", "Valor da causa": "process.caseValue" });
    expect(cols.sameFileJobs).toEqual([]);
    const job = await imports.getJob(ctx, s.jobId);
    expect(job.status).toBe("COLUMNS_DETECTED");
  });

  it("simulação: erros por linha, nada gravado em clientes/processos, prévia coerente", async () => {
    const ctx = await ctxFor("ADMIN");
    const antes = await svc.from("clients").select("id", { count: "exact", head: true }).in("cpf", [state.cpfA, state.cpfB]);
    const job = await imports.simulate(ctx, {
      jobId: state.jobCsv,
      mapping: [
        { sourceColumn: "Nome", targetField: "client.name" },
        { sourceColumn: "CPF", targetField: "client.document" },
        { sourceColumn: "Telefone", targetField: "client.phone" },
        { sourceColumn: "Processo", targetField: "process.cnj" },
        { sourceColumn: "Ação", targetField: "process.actionType" },
        { sourceColumn: "Responsável", targetField: "process.responsible" },
        { sourceColumn: "Vencimento", targetField: "process.dueDate" },
        { sourceColumn: "Valor da causa", targetField: "process.caseValue" },
      ],
      options: { legalAreaId: world.bankingAreaId, lawyerId },
    });
    expect(job.status).toBe("VALIDATED");
    expect(job.failedRows).toBe(1);
    expect(job.plan).toMatchObject({ rowsTotal: 4, rowsError: 1, clientsCreate: 2, processesCreate: 2, casesCreate: 2, deadlinesCreate: 1, rowsToImport: 3 });
    const depois = await svc.from("clients").select("id", { count: "exact", head: true }).in("cpf", [state.cpfA, state.cpfB]);
    expect(depois.count).toBe(antes.count);
    const rows = await imports.listRows(ctx, { jobId: state.jobCsv, filter: "errors", page: 1, pageSize: 50 });
    expect(rows.items.map((r) => r.rowNumber)).toEqual([5]);
    expect(rows.items[0]!.errors[0]).toMatch(/CPF\/CNPJ do cliente vazio/);
  });

  it("confirma e grava em lotes: cliente, caso em andamento, processo IMPORT, prazo, linha do tempo; arquivo apagado", async () => {
    const ctx = await ctxFor("ADMIN");
    const confirmed = await imports.confirmImport(ctx, state.jobCsv);
    expect(confirmed.status).toBe("CONFIRMED");
    const r = await processAll(state.jobCsv);
    expect(r).toMatchObject({ status: "COMPLETED", imported: 3, failed: 1, failedOnSave: 0, clientsCreated: 2, processesCreated: 2, deadlinesCreated: 1 });

    const { data: client } = await svc.from("clients").select("id, responsible_user_id").eq("cpf", state.cpfA).single();
    const { data: procs } = await svc
      .from("legal_processes")
      .select("id, technical_origin, cnj_number, responsible_user_id, legal_cases!inner(client_id, status, assigned_lawyer_id, origin_organization_id)")
      .in("cnj_number", [state.cnjA, state.cnjB]);
    expect(procs).toHaveLength(2);
    for (const p of procs ?? []) {
      const lc = (Array.isArray(p.legal_cases) ? p.legal_cases[0] : p.legal_cases) as { client_id: string; status: string; assigned_lawyer_id: string; origin_organization_id: string };
      expect([p.technical_origin, lc.client_id, lc.status, lc.origin_organization_id]).toEqual(["IMPORT", client!.id, "IN_PROGRESS", world.owner]);
      expect(lc.assigned_lawyer_id).toBe(lawyerId);
    }
    const { data: ev } = await svc.from("process_events").select("source").eq("legal_process_id", procs![0]!.id).eq("source", "IMPORT");
    expect(ev).toHaveLength(1);

    const job = await imports.getJob(ctx, state.jobCsv);
    expect(job.status).toBe("COMPLETED");
    expect(job.result).toMatchObject({ imported: 3, failed: 1 });
    expect(job.fileAvailable).toBe(false);
    const { data: jr } = await svc.from("import_jobs").select("source_file_deleted_at, storage_object_name").eq("id", state.jobCsv).single();
    expect(jr!.source_file_deleted_at).not.toBeNull();
    const dl = await svc.storage.from("imports").download(jr!.storage_object_name!);
    expect(dl.error).not.toBeNull();

    const report = await imports.buildReport(ctx, { jobId: state.jobCsv, only: "all" });
    expect(report.rows).toBe(4);
    expect(report.csv).toContain("Importada");
    expect(report.csv).toContain("Não importada (erro)");
  });

  it("XLSX com o mesmo cliente e o mesmo processo: conflitos CPF e CNJ, decisão e resultado igual à prévia", async () => {
    const bytes = buildXlsx([
      {
        name: "Processos",
        rows: [
          ["Nome", "CPF", "Processo", "Vara", "Status"],
          [`Ana ${tag} Atualizada`, state.cpfA, state.cnjA, `3ª Vara ${tag}`, "Suspenso"],
          [`Carla ${tag}`, fakeCpf(), fakeCnj(), null, "Arquivado"],
        ],
      },
    ]);
    const s = await upload(`processos-${tag}.xlsx`, bytes);
    state.jobXlsx = s.jobId;
    const ctx = await ctxFor("ADMIN");
    const cols = await imports.readColumns(ctx, { jobId: s.jobId });
    expect(cols.sheetName).toBe("Processos");
    let job: ImportJobDTO = await imports.simulate(ctx, {
      jobId: s.jobId,
      mapping: [
        { sourceColumn: "Nome", targetField: "client.name" },
        { sourceColumn: "CPF", targetField: "client.document" },
        { sourceColumn: "Processo", targetField: "process.cnj" },
        { sourceColumn: "Vara", targetField: "process.courtUnit" },
        { sourceColumn: "Status", targetField: "process.status" },
      ],
      options: { legalAreaId: world.bankingAreaId, lawyerId },
    });
    expect(job.status).toBe("CONFLICTS_PENDING");
    const conflicts = await imports.getConflicts(ctx, { jobId: s.jobId, offset: 0, limit: 100 });
    expect(conflicts.items.map((c) => c.kind).sort()).toEqual(["CLIENT_DOCUMENT", "PROCESS_CNJ"]);
    const cd = conflicts.items.find((c) => c.kind === "CLIENT_DOCUMENT")!;
    expect(cd.existingLabel).toBe(`Ana ${tag}`);
    await expectDomainError(imports.confirmImport(ctx, s.jobId), "INVALID_STATE", /outra etapa/);

    // Mantém o cliente como está; atualiza o processo.
    await imports.resolveConflicts(ctx, { jobId: s.jobId, items: [{ conflictId: cd.id, resolution: "IGNORE" }, { kind: "PROCESS_CNJ", resolution: "UPDATE" }] });
    job = await imports.getJob(ctx, s.jobId);
    expect(job.status).toBe("VALIDATED");
    const plan = job.plan!;
    expect(plan).toMatchObject({ clientsCreate: 1, clientsUpdate: 0, clientsKeep: 1, processesCreate: 1, processesUpdate: 1 });

    await imports.confirmImport(ctx, s.jobId);
    const r = await processAll(s.jobId);
    expect([r.clientsCreated, r.clientsUpdated, r.processesCreated, r.processesUpdated, r.failed]).toEqual([plan.clientsCreate, plan.clientsUpdate, plan.processesCreate, plan.processesUpdate, 0]);

    const { data: ana } = await svc.from("individual_client_details").select("full_name, clients!inner(cpf)").eq("clients.cpf", state.cpfA).single();
    expect(ana!.full_name).toBe(`Ana ${tag}`); // mantido
    const { data: p } = await svc.from("legal_processes").select("court_unit, status").eq("cnj_number", state.cnjA).single();
    expect(p).toEqual({ court_unit: `3ª Vara ${tag}`, status: "SUSPENDED" });
  });

  it("relatório de processos sem CPF (como o do ADVBOX): processo ligado ao cliente já cadastrado pelo nome", async () => {
    const cnjNovo = fakeCnj();
    const csv = ["Nome do cliente;Número do processo;Tipo de ação", `ANA ${tag.toUpperCase()};${cnjNovo};Revisional`, `Ninguém ${tag};${fakeCnj()};Revisional`].join("\n");
    const s = await upload(`advbox-processos-${tag}.csv`, enc(csv));
    const ctx = await ctxFor("ADMIN");
    const cols = await imports.readColumns(ctx, { jobId: s.jobId });
    expect(cols.suggestedMapping).toMatchObject({ "Nome do cliente": "client.name", "Número do processo": "process.cnj" });
    const job = await imports.simulate(ctx, {
      jobId: s.jobId,
      mapping: Object.entries(cols.suggestedMapping)
        .filter(([, f]) => f)
        .map(([sourceColumn, targetField]) => ({ sourceColumn, targetField: targetField as Exclude<typeof targetField, ""> })),
      options: { legalAreaId: world.bankingAreaId, lawyerId },
    });
    expect(job.status).toBe("VALIDATED");
    expect(job.plan).toMatchObject({ clientsCreate: 0, clientsKeep: 1, processesCreate: 1, rowsError: 1 });
    await imports.confirmImport(ctx, s.jobId);
    const r = await processAll(s.jobId);
    expect([r.imported, r.clientsCreated, r.processesCreated, r.failed]).toEqual([1, 0, 1, 1]);
    const { data: ana } = await svc.from("clients").select("id").eq("cpf", state.cpfA).single();
    const { data: p } = await svc.from("legal_processes").select("legal_cases!inner(client_id)").eq("cnj_number", cnjNovo).single();
    const lc = (Array.isArray(p!.legal_cases) ? p!.legal_cases[0] : p!.legal_cases) as { client_id: string };
    expect(lc.client_id).toBe(ana!.id);
  });

  it("arquivo ilegível vira FAILED com o motivo; cancelamento apaga o arquivo", async () => {
    const ctx = await ctxFor("ADMIN");
    const bad = await upload(`quebrado-${tag}.xlsx`, enc("isto não é um xlsx"));
    await expectDomainError(imports.readColumns(ctx, { jobId: bad.jobId }), "VALIDATION", /xlsx/);
    const failed = await imports.getJob(ctx, bad.jobId);
    expect([failed.status, failed.errorMessage]).toEqual(["FAILED", expect.stringMatching(/xlsx/)]);

    const c = await upload(`cancelar-${tag}.csv`, enc("Nome;CPF\nX;12345678901\n"));
    await imports.cancelImport(ctx, c.jobId);
    const { data } = await svc.from("import_jobs").select("status, source_file_deleted_at").eq("id", c.jobId).single();
    expect(data!.status).toBe("CANCELLED");
    expect(data!.source_file_deleted_at).not.toBeNull();
    // A lista também limpa arquivos de jobs encerrados que ficaram para trás (FAILED acima).
    await imports.listJobs(ctx, { page: 1, pageSize: 25 });
    const { data: f } = await svc.from("import_jobs").select("source_file_deleted_at").eq("id", bad.jobId).single();
    expect(f!.source_file_deleted_at).not.toBeNull();
  });

  it("advogado e assistente não importam (servidor e banco)", async () => {
    for (const role of ["LAWYER", "ASSISTANT"] as const) {
      await expectDomainError(imports.startImport(await ctxFor(role), { fileName: "x.csv", sizeBytes: 10 }), "FORBIDDEN");
      const { error } = await dbFor(role).rpc("import_create_job", { p_file_name: "x.csv", p_file_type: "CSV" });
      expect(error?.message).toMatch(/administrador/);
      const { data } = await dbFor(role).from("import_jobs").select("id").eq("id", state.jobCsv);
      expect(data ?? []).toEqual([]);
    }
  });
});
