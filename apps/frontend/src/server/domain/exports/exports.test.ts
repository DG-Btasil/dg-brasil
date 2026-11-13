import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { AppSession } from "@/lib/auth/types";
import { createServiceContext } from "@/server/core/context";
import { DomainError } from "@/server/core/errors";
import { buildCsv, csvDate, csvDateTime, csvMoney, csvNumber, type CsvColumn } from "./csv";
import { EXPORT_MAX_ROWS, auditFilters, chunked, collectForExport, exportCsv, mapChunks } from "./service";

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code: string; message: string } | null }>;
const auditOk: Rpc = async () => ({ data: "audit-id", error: null });

const ctxOf = (role: AppSession["role"], rpc = vi.fn<Rpc>(auditOk)) => ({
  rpc,
  ctx: createServiceContext({
    db: { rpc } as unknown as SupabaseClient,
    requestId: "55555555-5555-4555-8555-555555555555",
    session: { userId: "66666666-6666-4666-8666-666666666666", organizationId: "o1", role, surface: role.startsWith("PARTNER") ? "PARTNER" : "INTERNAL" } as AppSession,
  }),
});

interface Row {
  name: string;
  amount: number | null;
  note?: string;
}
const columns: CsvColumn<Row>[] = [
  { header: "Nome", value: (r) => r.name },
  { header: "Valor", value: (r) => csvMoney(r.amount) },
  { header: "Observação", value: (r) => r.note },
];

describe("CSV para o Excel brasileiro", () => {
  it("separador ponto e vírgula, linhas CRLF, títulos na primeira linha e linha final", () => {
    expect(buildCsv(columns, [{ name: "Maria", amount: 1234.5 }])).toBe("Nome;Valor;Observação\r\nMaria;1234,50;\r\n");
    expect(buildCsv(columns, [])).toBe("Nome;Valor;Observação\r\n");
  });

  it("texto com ponto e vírgula, aspas, quebra de linha ou espaço na ponta vai entre aspas", () => {
    const csv = buildCsv(columns, [{ name: 'Silva; "Zé"', amount: null, note: "linha 1\nlinha 2" }, { name: " espaço ", amount: 0 }]);
    expect(csv).toBe('Nome;Valor;Observação\r\n"Silva; ""Zé""";;"linha 1\nlinha 2"\r\n" espaço ";0,00;\r\n');
  });

  it("texto que começaria uma fórmula ganha apóstrofo (o Excel não executa)", () => {
    const csv = buildCsv(columns, [
      { name: "=HYPERLINK(\"http://x\")", amount: null, note: "+55 11 99999-0000" },
      { name: "@comando", amount: null, note: "-1+1" },
    ]);
    expect(csv).toContain("\"'=HYPERLINK(\"\"http://x\"\")\";;'+55 11 99999-0000");
    expect(csv).toContain("'@comando;;'-1+1");
  });

  it("número de verdade não ganha apóstrofo nem ponto: vírgula decimal, sem milhar; booleano vira Sim/Não", () => {
    const cols: CsvColumn<{ n: number; ok: boolean }>[] = [
      { header: "N", value: (r) => r.n },
      { header: "Ok", value: (r) => r.ok },
    ];
    expect(buildCsv(cols, [{ n: -1234.56, ok: true }, { n: 10, ok: false }])).toBe("N;Ok\r\n-1234,56;Sim\r\n10;Não\r\n");
    expect([csvNumber(1234567.891), csvNumber(0.5, 2), csvNumber(null), csvNumber(Number.NaN), csvMoney(1000)]).toEqual(["1234567,891", "0,50", "", "", "1000,00"]);
  });

  it("datas dd/mm/aaaa: data sem hora não muda com o fuso; instante usa o fuso de São Paulo", () => {
    expect(csvDate("2026-11-13")).toBe("13/11/2026");
    // 01:30 UTC de 14/11 ainda é 22:30 de 13/11 em São Paulo.
    expect(csvDate("2026-11-14T01:30:00Z")).toBe("13/11/2026");
    expect(csvDateTime("2026-11-14T01:30:00Z")).toBe("13/11/2026 22:30");
    expect([csvDate(undefined), csvDate(null), csvDate("não é data"), csvDateTime("")]).toEqual(["", "", "", ""]);
  });
});

describe("filtros que vão para a auditoria", () => {
  it("texto de busca nunca é gravado (pode ser nome ou CPF): vira search: true; vazios saem", () => {
    expect(auditFilters({ q: "529.982.247-25", status: "ACTIVE", kind: undefined, page: 2, onlyMine: false, empty: "", nothing: null })).toEqual({
      search: true,
      status: "ACTIVE",
      page: 2,
      onlyMine: false,
    });
    expect(auditFilters({ search: "Maria" })).toEqual({ search: true });
    expect(auditFilters({})).toEqual({});
  });

  it("texto longo é cortado em 80 caracteres (o banco recusa mais que isso)", () => {
    expect(auditFilters({ court: "x".repeat(200) }).court).toHaveLength(80);
  });
});

describe("juntar as páginas da lista até o limite", () => {
  const source = (total: number) => async ({ page, pageSize }: { page: number; pageSize: number }) => {
    const from = (page - 1) * pageSize;
    return { rows: Array.from({ length: Math.max(0, Math.min(pageSize, total - from)) }, (_, i) => from + i), total };
  };

  it("lista menor que o limite: tudo, sem corte", async () => {
    const r = await collectForExport(source(7), 10, 3);
    expect([r.rows, r.total, r.truncated]).toEqual([[0, 1, 2, 3, 4, 5, 6], 7, false]);
  });

  it("lista maior que o limite: só as primeiras, com o total real e o aviso de corte", async () => {
    const fetch = vi.fn(source(25));
    const r = await collectForExport(fetch, 10, 4);
    expect([r.rows.length, r.rows[9], r.total, r.truncated]).toEqual([10, 9, 25, true]);
    // 3 consultas de 4 já passam de 10: não busca a lista inteira.
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("lista vazia e lista do tamanho exato do limite", async () => {
    expect(await collectForExport(source(0), 10, 3)).toEqual({ rows: [], total: 0, truncated: false });
    const exact = await collectForExport(source(10), 10, 5);
    expect([exact.rows.length, exact.truncated]).toEqual([10, false]);
  });

  it("o limite padrão é o anunciado na tela; blocos de ids", () => {
    expect(EXPORT_MAX_ROWS).toBe(5000);
    expect(chunked([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunked([], 2)).toEqual([]);
  });
});

describe("consulta auxiliar em blocos", () => {
  it("parte os ids em blocos, mantém a ordem e nunca passa do número de chamadas simultâneas", async () => {
    let running = 0;
    let peak = 0;
    const fn = vi.fn(async (chunk: number[]) => {
      peak = Math.max(peak, ++running);
      await new Promise((r) => setTimeout(r, 1));
      running--;
      return chunk.map((n) => n * 10);
    });
    const ids = Array.from({ length: 23 }, (_, i) => i);
    expect(await mapChunks(ids, 5, fn, 2)).toEqual(ids.map((n) => n * 10));
    expect([fn.mock.calls.length, peak]).toEqual([5, 2]);
    expect(await mapChunks([], 5, fn)).toEqual([]);
  });
});

describe("exportCsv", () => {
  const rows: Row[] = [
    { name: "Maria", amount: 10 },
    { name: "João", amount: 20 },
  ];
  const now = new Date("2026-11-13T15:00:00Z");

  it("ADMIN: registra na auditoria (tipo, filtros sem a busca, quantidade) e devolve o arquivo com a data no nome", async () => {
    const { ctx, rpc } = ctxOf("ADMIN");
    const file = await exportCsv(ctx, { kind: "clients", fileName: "clientes", columns, rows, filters: { q: "Maria", status: "ACTIVE" }, total: 2, truncated: false }, now);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("record_data_export", { p_kind: "clients", p_filters: { search: true, status: "ACTIVE" }, p_row_count: 2, p_truncated: false });
    expect(file).toEqual({ fileName: "clientes-2026-11-13.csv", content: "Nome;Valor;Observação\r\nMaria;10,00;\r\nJoão;20,00;\r\n", rowCount: 2, total: 2, truncated: false, limit: EXPORT_MAX_ROWS });
    // O conteúdo exportado não vai para a auditoria.
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("João");
  });

  it("planilha cortada: avisa e registra o corte", async () => {
    const { ctx, rpc } = ctxOf("ADMIN");
    const file = await exportCsv(ctx, { kind: "processes", fileName: "processos", columns, rows, filters: {}, total: 9000, truncated: true }, now);
    expect([file.rowCount, file.total, file.truncated]).toEqual([2, 9000, true]);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_truncated: true, p_row_count: 2 });
  });

  it("quem não é ADMIN não exporta, e nada é registrado", async () => {
    for (const role of ["LAWYER", "ASSISTANT", "PARTNER_ADMIN", "PARTNER_USER"] as const) {
      const { ctx, rpc } = ctxOf(role);
      await expect(exportCsv(ctx, { kind: "clients", fileName: "clientes", columns, rows, filters: {} })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(rpc).not.toHaveBeenCalled();
    }
  });

  it("se o registro na auditoria falha, não há arquivo", async () => {
    const { ctx } = ctxOf("ADMIN", vi.fn<Rpc>(async () => ({ data: null, error: { code: "42501", message: "Somente o administrador exporta planilhas" } })));
    const error = await exportCsv(ctx, { kind: "clients", fileName: "clientes", columns, rows, filters: {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).publicMessage).toBe("Somente o administrador exporta planilhas");
  });
});
