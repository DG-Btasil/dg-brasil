import { afterEach, describe, expect, it } from "vitest";
import { fromDbError, isOurDbMessage } from "./db-errors";
import { DomainError, failure } from "./errors";
import { createLogger, redact, sanitizeFields, setLogSink, type LogFields } from "./logger";
import { pageInputSchema, sortSchema, toPage, toRange } from "./pagination";
import { zCnj, zCpf, zIsoDate, zMoney, zOptionalText, zTaxId } from "./validation";

describe("erros do banco → erro de domínio (mensagem segura)", () => {
  it("unique de CPF/CNPJ vira DUPLICATE_CLIENT com a mensagem combinada", () => {
    const e = fromDbError({ code: "23505", message: 'duplicate key value violates unique constraint "clients_cpf_key"' });
    expect(e.code).toBe("DUPLICATE_CLIENT");
    expect(e.publicMessage).toBe("Cliente já cadastrado no sistema.");
    expect(e.publicMessage).not.toMatch(/clients_cpf_key|duplicate/);
  });
  it("CNJ duplicado vira CONFLICT amigável", () => {
    const e = fromDbError({ code: "23505", message: 'duplicate key value violates unique constraint "legal_processes_cnj_key"' });
    expect([e.code, e.publicMessage]).toEqual(["CONFLICT", "Já existe um processo com este número CNJ."]);
  });
  it("RLS da plataforma nunca vaza nome de tabela", () => {
    const e = fromDbError({ code: "42501", message: 'new row violates row-level security policy for table "legal_cases"' });
    expect(e.code).toBe("FORBIDDEN");
    expect(e.publicMessage).not.toMatch(/legal_cases|row-level/);
  });
  it("mensagem escrita por nós no banco passa adiante", () => {
    const e = fromDbError({ code: "23514", message: "Transição de caso inválida: DRAFT → ACCEPTED" });
    expect([e.code, e.publicMessage]).toEqual(["INVALID_STATE", "Transição de caso inválida: DRAFT → ACCEPTED"]);
    expect(fromDbError({ code: "42501", message: "Somente ADMIN interno pode corrigir CPF/CNPJ" }).publicMessage).toBe("Somente ADMIN interno pode corrigir CPF/CNPJ");
  });
  it("código interno em maiúsculas não vira texto para o usuário", () => {
    expect(isOurDbMessage("EMAIL_ALREADY_HAS_ACCESS")).toBe(false);
    expect(fromDbError({ code: "23505", message: "EMAIL_ALREADY_HAS_ACCESS" }).publicMessage).toBe("Já existe um registro com estes dados.");
  });
  it("PGRST116 → NOT_FOUND; desconhecido → INTERNAL genérico", () => {
    expect(fromDbError({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" }).code).toBe("NOT_FOUND");
    const e = fromDbError({ code: "XX000", message: "internal error at relation \"x\"" });
    expect([e.code, e.publicMessage]).toEqual(["INTERNAL", "Não foi possível concluir agora. Tente novamente em instantes."]);
  });
  it("resultado de falha só carrega código, mensagem e campos", () => {
    const r = failure(new DomainError("VALIDATION", undefined, { fieldErrors: { cpf: ["x"] }, technicalCode: "22P02" }), "rid");
    expect(r).toEqual({ ok: false, error: { code: "VALIDATION", message: "Confira os dados informados.", fieldErrors: { cpf: ["x"] } }, requestId: "rid" });
  });
});

describe("logs sem PII", () => {
  afterEach(() => setLogSink(null));
  it("redige CPF, CNPJ, e-mail, JWT e parâmetros secretos", () => {
    const text = redact("cpf 123.456.789-09 cnpj 11222333000181 maria@x.com eyJa.eyJb.sig token=abc ref=xyz");
    for (const leak of ["123.456.789-09", "11222333000181", "maria@x.com", "eyJa.eyJb.sig", "abc", "xyz"]) expect(text).not.toContain(leak);
  });
  it("campos com nome sensível são ocultados; *_id passa", () => {
    expect(sanitizeFields({ cpf: "1", fullName: "Ana", email: "a@b.c", clientId: "c1", prompt: "x", requestId: "r" })).toEqual({
      cpf: "[oculto]",
      fullName: "[oculto]",
      email: "[oculto]",
      clientId: "c1",
      prompt: "[oculto]",
      requestId: "r",
    });
  });
  it("logger aplica a sanitização e herda o contexto", () => {
    const events: [string, LogFields][] = [];
    setLogSink((_, event, fields) => events.push([event, fields]));
    createLogger({ requestId: "r1" }).child({ action: "a" }).info("x", { clientId: "c", name: "Fulano" });
    expect(events).toEqual([["x", { requestId: "r1", action: "a", clientId: "c", name: "[oculto]" }]]);
  });
});

describe("paginação e ordenação por whitelist", () => {
  it("padrões, limite e intervalo", () => {
    expect(pageInputSchema.parse({})).toEqual({ page: 1, pageSize: 25 });
    expect(pageInputSchema.safeParse({ pageSize: 500 }).success).toBe(false);
    expect(toRange({ page: 3, pageSize: 20 })).toEqual({ from: 40, to: 59 });
    expect(toPage([1, 2], 45, { page: 2, pageSize: 20 })).toMatchObject({ total: 45, hasMore: true });
  });
  it("só campos permitidos; nome de coluna arbitrário é recusado", () => {
    const s = sortSchema({ name: "display_name", createdAt: "created_at" }, "createdAt");
    expect(s.parse({})).toEqual({ column: "created_at", ascending: false });
    expect(s.parse({ sortBy: "name", sortDirection: "asc" })).toEqual({ column: "display_name", ascending: true });
    expect(s.safeParse({ sortBy: "cpf; drop table clients" }).success).toBe(false);
  });
});

describe("validação de entrada", () => {
  it("CPF/CNPJ/CNJ normalizados para dígitos", () => {
    expect(zCpf().parse("999.000.111-22")).toBe("99900011122");
    expect(zCpf().safeParse("111.111.111-11").success).toBe(false);
    expect(zTaxId().parse("99.900.011/1222-33")).toBe("99900011122233");
    expect(zCnj().parse("0001234-03.2026.8.26.0100")).toBe("00012340320268260100");
    expect(zCnj().safeParse("123").success).toBe(false);
    // Dígito verificador errado (mesma regra do domínio cnj_digits do banco).
    expect(zCnj().safeParse("0001234-56.2026.8.26.0100").success).toBe(false);
  });
  it("dinheiro: não negativo, 2 casas", () => {
    expect(zMoney().parse(10.5)).toBe(10.5);
    expect(zMoney().safeParse(-1).success).toBe(false);
    expect(zMoney().safeParse(1.234).success).toBe(false);
  });
  it("datas e textos opcionais", () => {
    expect(zIsoDate().safeParse("2026-02-28").success).toBe(true);
    expect(zIsoDate().safeParse("2026-02-30").success).toBe(false);
    expect(zIsoDate().safeParse("30/01/2026").success).toBe(false);
    expect(zOptionalText().parse("  ")).toBeUndefined();
  });
});
