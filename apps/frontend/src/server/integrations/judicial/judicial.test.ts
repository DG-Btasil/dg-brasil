import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@/server/core/logger";
import { camel } from "@/server/domain/judicial/service";
import { DatajudClient, normalizeDatajud } from "./datajud";
import { DjenClient, DjenError, normalizeDjenItem, type DjenItem } from "./djen";
import { runJudicialSync, type JudicialDbFunction, type JudicialSyncDeps } from "./sync";
import { addDays, datajudAlias, fixCase, formatCnj, htmlToText, isValidCnj, parseDatajudDate } from "./text";

vi.mock("server-only", () => ({}));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
// CNJ válido do TJSP (8.26), como no teste do banco.
function cnj(seq: number, ano = "2025", j = "8", tr = "26", origem = "0100") {
  const n = String(seq).padStart(7, "0");
  const dv = 98n - (BigInt(n + ano + j + tr + origem + "00") % 97n);
  return n + String(dv).padStart(2, "0") + ano + j + tr + origem;
}
const noSleep = async () => undefined;

describe("texto e número do processo", () => {
  it("HTML do DJEN vira texto: tira head/style, troca <br> por quebra, decodifica entidades", () => {
    const html = `<html><head><style>p{color:red}</style><title>x</title></head><body><article><p>Intima&ccedil;&atilde;o da parte autora</p>
      <p>Prazo:&nbsp;15&nbsp;dias<br />art. 350 do CPC &#8212; &#x41;</p></article></body></html>`;
    expect(htmlToText(html)).toBe("Intimação da parte autora\n\nPrazo: 15 dias\nart. 350 do CPC — A");
    expect(htmlToText("Linha 1<br />Linha 2")).toBe("Linha 1\nLinha 2");
    expect(htmlToText("texto puro, sem marcação")).toBe("texto puro, sem marcação");
    expect(htmlToText(null)).toBe("");
  });
  it("caixa estragada do DJEN é corrigida; caixa normal fica", () => {
    expect(fixCase("AçãO PENAL")).toBe("Ação penal");
    expect(fixCase("PROCEDIMENTO DO JUIZADO ESPECIAL CÍVEL")).toBe("Procedimento do juizado especial cível");
    expect(fixCase("Intimação")).toBe("Intimação");
    expect(fixCase("  ")).toBeNull();
  });
  it("CNJ: dígito verificador, máscara e índice do DataJud", () => {
    const c = cnj(1);
    expect(isValidCnj(c)).toBe(true);
    expect(isValidCnj(c.slice(0, 7) + "00" + c.slice(9))).toBe(c.slice(7, 9) === "00");
    expect(formatCnj(c)).toMatch(/^\d{7}-\d{2}\.2025\.8\.26\.0100$/);
    expect(datajudAlias(cnj(1, "2025", "8", "26"))).toBe("tjsp");
    expect(datajudAlias(cnj(1, "2025", "8", "19"))).toBe("tjrj");
    expect(datajudAlias(cnj(1, "2025", "8", "07"))).toBe("tjdft");
    expect(datajudAlias(cnj(1, "2025", "6", "07"))).toBe("tre-df");
    expect(datajudAlias(cnj(1, "2025", "6", "26"))).toBe("tre-sp");
    expect(datajudAlias(cnj(1, "2025", "6", "00"))).toBe("tse");
    expect(datajudAlias(cnj(1, "2025", "4", "03"))).toBe("trf3");
    expect(datajudAlias(cnj(1, "2025", "4", "07"))).toBeNull();
    expect(datajudAlias(cnj(1, "2025", "5", "01"))).toBe("trt1");
    expect(datajudAlias(cnj(1, "2025", "5", "00"))).toBe("tst");
    expect(datajudAlias(cnj(1, "2025", "9", "26"))).toBe("tjmsp");
    expect(datajudAlias(cnj(1, "2025", "3", "00"))).toBe("stj");
    expect(datajudAlias(cnj(1, "2025", "1", "00"))).toBeNull();
  });
  it("datas: dataAjuizamento yyyyMMddHHmmss e soma de dias", () => {
    expect(parseDatajudDate("20210611100531")).toBe("2021-06-11");
    expect(parseDatajudDate("2021-06-11T10:05:31Z")).toBe("2021-06-11");
    expect(parseDatajudDate("lixo")).toBeNull();
    expect(addDays("2026-11-03", -5)).toBe("2026-10-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

const rawDjen = (over: Record<string, unknown> = {}) => ({
  id: 504112233, data_disponibilizacao: "2026-10-30", siglaTribunal: "TJSP", tipoComunicacao: "Intimação",
  nomeOrgao: "1ª Vara do Juizado Especial Cível", texto: "Manifeste-se a parte autora<br />no prazo de 15 dias.",
  numero_processo: cnj(1), numeroprocessocommascara: formatCnj(cnj(1)), link: "https://esaj.tjsp.jus.br/x",
  nomeClasse: "PROCEDIMENTO DO JUIZADO ESPECIAL CÍVEL", hash: "Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op", ativo: true, status: "P",
  motivo_cancelamento: null, data_cancelamento: null, ...over,
});

describe("DJEN", () => {
  it("normaliza o item; descarta item sem id, processo ou data", () => {
    const n = normalizeDjenItem(rawDjen())!;
    expect(n).toMatchObject({ external_id: "504112233", cnj: cnj(1), court: "TJSP", available_on: "2026-10-30", cancelled: false,
      content: "Manifeste-se a parte autora\nno prazo de 15 dias.", class_name: "Procedimento do juizado especial cível", hash: "Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op" });
    expect(normalizeDjenItem(rawDjen({ id: null }))).toBeNull();
    expect(normalizeDjenItem(rawDjen({ numero_processo: "123", numeroprocessocommascara: null }))).toBeNull();
    expect(normalizeDjenItem(rawDjen({ data_disponibilizacao: null }))).toBeNull();
    expect(normalizeDjenItem(rawDjen({ link: "javascript:alert(1)" }))!.link).toBeNull();
  });
  it("comunicação cancelada pelo tribunal é marcada com o motivo", () => {
    const n = normalizeDjenItem(rawDjen({ ativo: false, data_cancelamento: "2026-10-31", motivo_cancelamento: "Publicada por engano" }))!;
    expect([n.cancelled, n.cancel_reason]).toEqual([true, "Publicada por engano"]);
  });
  it("pagina de 100 em 100 até vir menos; sem repetir; manda OAB, UF e período", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => rawDjen({ id: 1000 + i }));
    const page2 = [rawDjen({ id: 1099 }), rawDjen({ id: 2000 })];
    const urls: string[] = [];
    const f = vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url));
      return json({ status: "success", count: 100, items: urls.length === 1 ? page1 : page2 });
    });
    const items = await new DjenClient({ fetch: f as unknown as typeof fetch, sleep: noSleep }).byOab("225006", "rj", "2026-10-29", "2026-11-03");
    expect(items).toHaveLength(101);
    const u = new URL(urls[0]);
    expect(Object.fromEntries(u.searchParams)).toEqual({ numeroOab: "225006", ufOab: "RJ", dataDisponibilizacaoInicio: "2026-10-29",
      dataDisponibilizacaoFim: "2026-11-03", pagina: "1", itensPorPagina: "100" });
    expect(new URL(urls[1]).searchParams.get("pagina")).toBe("2");
  });
  it("429 vira erro de limite; HTTP 500 e resposta sem lista são erro", async () => {
    const c = (r: Response) => new DjenClient({ fetch: (async () => r) as unknown as typeof fetch, sleep: noSleep });
    await expect(c(new Response("", { status: 429 })).byOab("1", "SP", "2026-11-01", "2026-11-03")).rejects.toMatchObject({ rateLimited: true });
    await expect(c(new Response("", { status: 500 })).byOab("1", "SP", "2026-11-01", "2026-11-03")).rejects.toThrow(/HTTP 500/);
    await expect(c(json({ status: "success" })).byOab("1", "SP", "2026-11-01", "2026-11-03")).rejects.toThrow(/sem a lista/);
  });
  it("respeita o intervalo mínimo entre requisições", async () => {
    const sleeps: number[] = [];
    const f = (async () => json({ items: [] })) as unknown as typeof fetch;
    const c = new DjenClient({ fetch: f, sleep: async (ms) => void sleeps.push(ms), minIntervalMs: 1500 });
    await c.byOab("1", "SP", "2026-11-01", "2026-11-03");
    await c.byOab("2", "SP", "2026-11-01", "2026-11-03");
    expect(sleeps.length).toBe(1);
    expect(sleeps[0]).toBeGreaterThan(1000);
  });
});

const mov = (codigo: number, nome: string, dataHora: string, compl: unknown[] = []) => ({ codigo, nome, dataHora, complementosTabelados: compl, orgaoJulgador: { codigo: "123", nome: "Vara" } });
const hits = (c: string) => [
  { _id: `TJSP_G1_${c}`, _source: { numeroProcesso: c, grau: "G1", dataAjuizamento: "20250310093000", dataHoraUltimaAtualizacao: "2026-10-10T12:00:00Z",
      classe: { nome: "Procedimento do Juizado Especial Cível" }, orgaoJulgador: { nome: "1ª Vara do JEC de Santos" },
      assuntos: [{ nome: "Empréstimo consignado" }, { nome: "Indenização por dano moral" }],
      movimentos: [mov(26, "Distribuído por sorteio", "2025-03-10T09:30:00Z"), mov(26, "Distribuído por sorteio", "2025-03-10T09:30:00Z"),
        mov(970, "Audiência", "2025-05-01T13:00:00Z", [{ codigo: 2, nome: "designada", descricao: "situacao_da_audiencia", valor: 1 }]),
        mov(970, "Audiência", "2025-05-01T13:00:00Z", [{ codigo: 2, nome: "cancelada", descricao: "situacao_da_audiencia", valor: 2 }])] } },
  { _id: `TJSP_G2_${c}`, _source: { numeroProcesso: c, grau: "G2", dataAjuizamento: "20251001000000", dataHoraUltimaAtualizacao: "2026-10-13T12:00:00Z",
      movimentos: [mov(51, "Conclusos para julgamento", "2026-10-13T10:00:00Z")] } },
  { _id: `TJSP_10944_JE_10345_${c}`, _source: { numeroProcesso: c, grau: "JE" } },
  { _id: "outro", _source: { numeroProcesso: cnj(2) } },
];

describe("DataJud", () => {
  it("junta os graus, preenche os dados pelo 1º grau, deduplica movimento idêntico e mantém o que difere no complemento", () => {
    const r = normalizeDatajud("tjsp", cnj(1), hits(cnj(1)));
    if (r.kind !== "ok") throw new Error(r.kind);
    expect(r.meta).toMatchObject({ court: "TJSP", court_unit: "1ª Vara do JEC de Santos", legal_class: "Procedimento do Juizado Especial Cível",
      subject: "Empréstimo consignado; Indenização por dano moral", distribution_date: "2025-03-10", graus: ["G1", "G2", "JE"],
      source_updated_at: "2026-10-13T12:00:00Z" });
    expect(r.movements.map((m) => m.description)).toEqual([
      "Distribuído por sorteio", "Audiência — situacao_da_audiencia: designada", "Audiência — situacao_da_audiencia: cancelada", "Conclusos para julgamento"]);
    expect(new Set(r.movements.map((m) => m.external_id)).size).toBe(4);
    // Determinístico: a mesma leitura gera as mesmas chaves (o banco não duplica).
    const again = normalizeDatajud("tjsp", cnj(1), hits(cnj(1)));
    expect(again.kind === "ok" && again.movements.map((m) => m.external_id)).toEqual(r.movements.map((m) => m.external_id));
  });
  it("sem documento do processo: não encontrado", () => {
    expect(normalizeDatajud("tjsp", cnj(1), []).kind).toBe("not_found");
  });
  it("chama o índice certo com a chave; 404 = sem índice; 401 = chave trocada; 429 tenta de novo uma vez", async () => {
    const calls: { url: string; auth: string }[] = [];
    let n = 0;
    const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), auth: (init?.headers as Record<string, string>).Authorization });
      n++;
      return n === 1 ? new Response("", { status: 429 }) : json({ hits: { hits: hits(cnj(1)) } });
    });
    const c = new DatajudClient({ fetch: f as unknown as typeof fetch, apiKey: "chave", sleep: noSleep });
    expect((await c.process(cnj(1))).kind).toBe("ok");
    expect(calls.map((x) => x.url)).toEqual(Array(2).fill("https://api-publica.datajud.cnj.jus.br/api_publica_tjsp/_search"));
    expect(calls[0].auth).toBe("APIKey chave");
    const c404 = new DatajudClient({ fetch: (async () => new Response("", { status: 404 })) as unknown as typeof fetch, sleep: noSleep });
    expect((await c404.process(cnj(1))).kind).toBe("unsupported");
    const c401 = new DatajudClient({ fetch: (async () => new Response("", { status: 401 })) as unknown as typeof fetch, sleep: noSleep });
    await expect(c401.process(cnj(1))).rejects.toThrow(/DATAJUD_API_KEY/);
    expect((await c404.process(cnj(1, "2025", "1", "00"))).kind).toBe("unsupported");
  });
});

describe("rodada", () => {
  function deps(over: Partial<JudicialSyncDeps> = {}, begin: Record<string, unknown> = {}) {
    const calls: { fn: JudicialDbFunction; args: unknown[] }[] = [];
    const d: JudicialSyncDeps = {
      log: createLogger({ test: "judicial" }),
      db: (async (fn: JudicialDbFunction, args: unknown[]) => {
        calls.push({ fn, args });
        if (fn === "judicial_sync_begin") return { busy: false, run_id: "run-1", djen_enabled: true, datajud_enabled: true, lookback_days: 5, today: "2026-11-03",
          oabs: [{ oab_number: "225006", oab_state: "RJ" }, { oab_number: "548089", oab_state: "SP" }], ...begin };
        if (fn === "judicial_ingest_djen") return { ok: true, found: 2, new: 1, duplicates: 1, unmatched: 0 };
        if (fn === "judicial_datajud_queue") return [{ ref_id: "r1", legal_process_id: "p1", cnj: cnj(1), baseline: true }, { ref_id: "r2", legal_process_id: "p2", cnj: cnj(2), baseline: false }];
        if (fn === "judicial_ingest_datajud") return { ok: true, inserted: 3 };
        return null;
      }) as JudicialSyncDeps["db"],
      djen: { byOab: async () => [] as DjenItem[] },
      datajud: { process: async (c: string) => (c === cnj(1) ? normalizeDatajud("tjsp", c, hits(c)) : { kind: "not_found" as const, message: "ainda não aparece" }) },
      ...over,
    };
    return { d, calls };
  }

  it("DJEN na janela de 5 dias, DataJud da fila, fecha COMPLETED com as contagens", async () => {
    const byOab = vi.fn(async () => [] as DjenItem[]);
    const { d, calls } = deps({ djen: { byOab } });
    const r = await runJudicialSync(d, { trigger: "CRON" });
    expect(r.busy).toBe(false);
    if (r.busy || r.idle) return;
    expect(byOab.mock.calls).toEqual([["225006", "RJ", "2026-10-29", "2026-11-03"], ["548089", "SP", "2026-10-29", "2026-11-03"]]);
    expect([r.status, r.stats.oabsChecked, r.stats.publicationsNew, r.stats.processesRead, r.stats.processesNotFound, r.stats.movementsNew]).toEqual(["COMPLETED", 2, 2, 1, 1, 3]);
    const fin = calls.find((c) => c.fn === "judicial_sync_finish")!;
    expect(fin.args.slice(0, 2)).toEqual(["run-1", "COMPLETED"]);
    const notFound = calls.find((c) => c.fn === "judicial_ingest_datajud" && c.args[1] === "r2")!;
    expect(notFound.args.slice(2, 4)).toEqual([false, "ainda não aparece"]);
  });
  it("limite do DJEN: registra a falha, para o DJEN da rodada e segue para o DataJud; PARTIAL", async () => {
    const byOab = vi.fn(async () => {
      throw new DjenError("DJEN: limite", true);
    });
    const { d, calls } = deps({ djen: { byOab } });
    const r = await runJudicialSync(d, { trigger: "CRON" });
    if (r.busy || r.idle) throw new Error("busy");
    expect(byOab).toHaveBeenCalledTimes(1);
    expect([r.status, r.stats.djenErrors, r.stats.oabsLeftForNextRun, r.stats.processesRead]).toEqual(["PARTIAL", 1, 1, 1]);
    expect(calls.find((c) => c.fn === "judicial_ingest_djen")!.args.slice(5, 7)).toEqual([false, "DJEN: limite"]);
  });
  it("tempo esgotado: não começa trabalho novo, mas fecha a rodada", async () => {
    let t = 0;
    const { d, calls } = deps({ now: () => (t += 1000), deadline: 1500 });
    const r = await runJudicialSync(d, { trigger: "CRON" });
    if (r.busy || r.idle) throw new Error("busy");
    expect(r.stats.oabsLeftForNextRun).toBeGreaterThan(0);
    expect(calls.at(-1)!.fn).toBe("judicial_sync_finish");
  });
  it("DataJud só começa consulta que cabe no tempo da rodada", async () => {
    const process = vi.fn(async (c: string) => normalizeDatajud("tjsp", c, hits(c)));
    const { d } = deps({ datajud: { process }, now: () => 10_000, deadline: 40_000, datajudCallBudgetMs: 35_000 }, { djen_enabled: false, oabs: [] });
    const r = await runJudicialSync(d, { trigger: "CRON" });
    if (r.busy || r.idle) throw new Error("busy");
    expect(process).not.toHaveBeenCalled();
    expect(r.stats.processesLeftForNextRun).toBe(2);
  });
  it("busca manual de um processo: passa quem pediu e o processo; DJEN fica de fora", async () => {
    const byOab = vi.fn(async () => [] as DjenItem[]);
    const { d, calls } = deps({ djen: { byOab } }, { djen_enabled: false, oabs: [] });
    await runJudicialSync(d, { trigger: "MANUAL", requestedBy: "u1", processId: "p1" });
    expect(calls[0].args).toEqual(["MANUAL", "u1", "p1", false]);
    expect(calls.find((c) => c.fn === "judicial_datajud_queue")!.args).toEqual([150, "p1"]);
    expect(byOab).not.toHaveBeenCalled();
  });
  it("lote só do DataJud sem nada vencido: ocioso, sem rodada", async () => {
    const { d, calls } = deps({}, { idle: true, run_id: undefined });
    expect(await runJudicialSync(d, { trigger: "CRON", onlyDatajud: true })).toEqual({ busy: false, idle: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(["CRON", null, null, true]);
  });
  it("outra rodada em andamento: busy, sem fechar nada", async () => {
    const { d, calls } = deps({}, { busy: true, run_id: undefined });
    expect(await runJudicialSync(d, { trigger: "CRON" })).toEqual({ busy: true });
    expect(calls.map((c) => c.fn)).toEqual(["judicial_sync_begin"]);
  });
});

describe("DTO", () => {
  it("snake_case → camelCase, null some", () => {
    expect(camel({ last_ok_at: null, unmatched_cnjs: ["1"], a_b: { c_d: 1 } })).toEqual({ unmatchedCnjs: ["1"], aB: { cD: 1 } });
  });
});
