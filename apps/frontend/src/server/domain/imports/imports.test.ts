import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IMPORT_FIELD_KEYS, mapsProcess, suggestMapping } from "@/lib/domain/import-fields";
import { buildReportCsv, toRow } from "./mappers";
import { isValidCnj, matchUser, normalizeRows, parseDate, parseMoney, parseStatus, parseUf, type ImportUser } from "./normalize";
import { ImportFileError, readSpreadsheet } from "./parse";
import { decodeText, detectDelimiter, parseCsv } from "./parse/csv";
import { columnIndex, decodeXml, excelSerialToIso, isDateFormat, numberText } from "./parse/xlsx";
import { buildXlsx } from "./test-xlsx";

const enc = (s: string) => new TextEncoder().encode(s);
// CNJ válido (DV módulo 97), como o banco exige.
function cnj(seq: number): string {
  const n = String(seq).padStart(7, "0");
  const rest = "2026826" + "0042";
  const dv = 98n - (BigInt(`${n}${rest}00`) % 97n);
  return `${n}${String(dv).padStart(2, "0")}${rest}`;
}

describe("campos: a lista do front é a mesma do banco (042)", () => {
  it("private.import_target_fields() == IMPORT_FIELD_KEYS", () => {
    const sql = readFileSync(new URL("../../../../../../supabase/migrations/20261031000042_spreadsheet_import.sql", import.meta.url), "utf8");
    const body = /function private\.import_target_fields\(\)[\s\S]*?array\[([\s\S]*?)\]/.exec(sql)?.[1] ?? "";
    const fromSql = [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(fromSql).toEqual([...IMPORT_FIELD_KEYS]);
  });

  it("sugere pelo cabeçalho sem repetir campo e ignora acento/caixa", () => {
    const s = suggestMapping(["NOME COMPLETO", "CPF/CNPJ", "Nº Processo", "Vara", "Vencimento", "Observações", "Coluna estranha", "Nome"]);
    expect(s["NOME COMPLETO"]).toBe("client.name");
    expect(s["CPF/CNPJ"]).toBe("client.document");
    expect(s["Nº Processo"]).toBe("process.cnj");
    expect(s["Vara"]).toBe("process.courtUnit");
    expect(s["Vencimento"]).toBe("process.dueDate");
    expect(s["Observações"]).toBe("client.notes");
    expect(s["Coluna estranha"]).toBe("");
    expect(s["Nome"]).toBe("");
    expect(mapsProcess(["client.name", "process.responsible"])).toBe(false);
  });

  it("relatório de processos do ADVBOX (cabeçalho real, sem CPF): colunas principais sugeridas", () => {
    const advbox = ["Nome do cliente", "Parte contrária", "Grupo de ação", "Tipo de ação", "Fase judicial", "Etapa", "Número do processo", "Número do protocolo", "Processo originário", "Pasta/Caso", "Ano", "Data do requerimento", "Segmento", "Comarca", "Vara", "Tribunal", "Data do fechamento", "Data do trânsito em julgado", "Data do arquivamento", "Resultado do processo", "Expectiva/Valor da causa (R$)", "Valor dos honorários (R$)", "Honorários (%)", "Contingenciamento", "Responsável", "Último andamento", "Anotações Gerais", "Data de cadastro"];
    const s = suggestMapping(advbox);
    expect(s).toMatchObject({
      "Nome do cliente": "client.name",
      "Parte contrária": "process.opposingParty",
      "Tipo de ação": "process.actionType",
      "Número do processo": "process.cnj",
      Comarca: "process.district",
      Vara: "process.courtUnit",
      Tribunal: "process.court",
      "Expectiva/Valor da causa (R$)": "process.caseValue",
      Responsável: "process.responsible",
      "Anotações Gerais": "process.notes",
    });
    expect(Object.values(s).includes("client.document")).toBe(false);
    expect(mapsProcess(["process.cnj"])).toBe(true);
  });
});

describe("CSV", () => {
  it("separador ; com aspas, quebra de linha dentro de aspas e linha em branco no meio", () => {
    const text = 'Nome;CPF;Obs\r\n"Silva; Maria";123;"linha 1\nlinha 2"\r\n\r\nJoão;456;"diz ""oi"""\r\n';
    expect(detectDelimiter(text)).toBe(";");
    const rows = parseCsv(text);
    expect(rows).toEqual([
      { line: 1, cells: ["Nome", "CPF", "Obs"] },
      { line: 2, cells: ["Silva; Maria", "123", "linha 1\nlinha 2"] },
      { line: 5, cells: ["João", "456", 'diz "oi"'] },
    ]);
  });

  it("vírgula e tabulação são detectadas", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a\tb\n1\t2")).toBe("\t");
  });

  it("UTF-8 com BOM e Windows-1252 (CSV do Excel em português)", () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...enc("João")]))).toBe("João");
    expect(decodeText(new Uint8Array([0x4a, 0x6f, 0xe3, 0x6f]))).toBe("João"); // "João" em cp1252
  });

  it("título acima do cabeçalho é pulado; cabeçalho mais curto que os dados não", () => {
    const r = readSpreadsheet(enc("RELATÓRIO DE CLIENTES\n\nNome;CPF;Cidade\nAna;1;SP\n"), "CSV");
    expect([r.headerLine, r.headers]).toEqual([3, ["Nome", "CPF", "Cidade"]]);
    const s = readSpreadsheet(enc("Nome;CPF;Cidade\nAna;1;SP;x;y;z\n"), "CSV");
    expect([s.headerLine, s.headers[0]]).toEqual([1, "Nome"]);
  });

  it("cabeçalho: coluna sem nome com dados vira 'Coluna X'; repetida ganha (2); vazias somem", () => {
    const r = readSpreadsheet(enc("Nome;;Nome;\nAna;x;Ana2;\n"), "CSV");
    expect(r.headers).toEqual(["Nome", "Coluna B", "Nome (2)"]);
    expect(r.rows).toEqual([{ line: 2, cells: ["Ana", "x", "Ana2"] }]);
  });

  it("recusa .xlsx com extensão .csv, arquivo vazio e sem linhas", () => {
    expect(() => readSpreadsheet(new Uint8Array([0x50, 0x4b, 3, 4]), "CSV")).toThrow(/é um Excel/);
    expect(() => readSpreadsheet(new Uint8Array(), "CSV")).toThrow(ImportFileError);
    expect(() => readSpreadsheet(enc("Nome;CPF\n"), "CSV")).toThrow(/não tem linhas de dados/);
  });

  it("mais de 5.000 linhas é recusado com a contagem", () => {
    const text = "Nome\n" + Array.from({ length: 5001 }, (_, i) => `n${i}`).join("\n");
    expect(() => readSpreadsheet(enc(text), "CSV")).toThrow(/5\.001 linhas/);
  });
});

describe("XLSX", () => {
  it("lê textos, números, datas e escolhe a primeira aba visível com dados", () => {
    const bytes = buildXlsx([
      { name: "Oculta", hidden: true, rows: [["X"], ["y"]] },
      { name: "Vazia", rows: [["só cabeçalho"]] },
      {
        name: "Clientes",
        rows: [
          [null, null],
          ["Nome", "CPF", "Distribuição", "Valor"],
          ["Ana & Cia <teste>", 1234567890, { date: 46023 }, 18500.5],
          ["José", "123.456.789-09", null, null],
        ],
      },
    ]);
    const r = readSpreadsheet(bytes, "XLSX");
    expect(r.sheets).toEqual(["Vazia", "Clientes"]);
    expect(r.sheetName).toBe("Clientes");
    expect(r.headers).toEqual(["Nome", "CPF", "Distribuição", "Valor"]);
    expect(r.rows[0]).toEqual({ line: 3, cells: ["Ana & Cia <teste>", "1234567890", "2026-01-01", "18500.5"] });
    expect(r.rows[1]!.line).toBe(4);
  });

  it("aba pedida pelo nome; aba inexistente é erro claro", () => {
    const bytes = buildXlsx([{ name: "A", rows: [["N"], ["1"]] }, { name: "B", rows: [["M"], ["2"]] }], { store: true });
    expect(readSpreadsheet(bytes, "XLSX", "B").headers).toEqual(["M"]);
    expect(() => readSpreadsheet(bytes, "XLSX", "Z")).toThrow(/não existe/);
  });

  it("arquivo que não é ZIP (xls antigo, senha) tem mensagem útil", () => {
    expect(() => readSpreadsheet(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, ...new Array(40).fill(0)]), "XLSX")).toThrow(/salve como \.xlsx/);
  });

  it("utilitários: coluna, entidades, datas, formato de data e números grandes", () => {
    expect(columnIndex("A1")).toBe(0);
    expect(columnIndex("AA10")).toBe(26);
    expect(decodeXml("a &amp; b &#233; &#x41; _x000D_")).toBe("a & b é A \r");
    expect(excelSerialToIso(45658)).toBe("2025-01-01");
    expect(excelSerialToIso(0, true)).toBe("1904-01-01");
    expect(isDateFormat(14, undefined)).toBe(true);
    expect(isDateFormat(164, '[$-416]dd/mm/yyyy')).toBe(true);
    expect(isDateFormat(165, '#,##0.00 "dias"')).toBe(false);
    expect(numberText("1.2345678901E+10")).toBe("12345678901");
  });
});

describe("conversões", () => {
  it("datas", () => {
    expect(parseDate("31/12/2026")).toBe("2026-12-31");
    expect(parseDate("1/2/26")).toBe("2026-02-01");
    expect(parseDate("2026-12-31T00:00:00")).toBe("2026-12-31");
    expect(parseDate("31/02/2026")).toBeUndefined();
    expect(parseDate("amanhã")).toBeUndefined();
  });
  it("valores", () => {
    expect(parseMoney("R$ 1.234,56")).toBe(1234.56);
    expect(parseMoney("18500.5")).toBe(18500.5);
    expect(parseMoney("1.234.567")).toBe(1234567);
    expect(parseMoney("1.500")).toBe(1500);
    expect(parseMoney("abc")).toBeUndefined();
    expect(parseMoney("-10")).toBe(-10);
  });
  it("UF, status e CNJ", () => {
    expect(parseUf("sp")).toBe("SP");
    expect(parseUf("São Paulo")).toBe("SP");
    expect(parseUf("XX")).toBeUndefined();
    expect(parseStatus("Em andamento")).toBe("ACTIVE");
    expect(parseStatus("Arquivado")).toBe("ARCHIVED");
    expect(parseStatus("Baixado")).toBe("CLOSED");
    expect(parseStatus("Pré-ajuizamento")).toBe("PRE_FILING");
    expect(parseStatus("???")).toBeUndefined();
    expect(isValidCnj(cnj(1))).toBe(true);
    expect(isValidCnj(cnj(1).replace(/^0/, "9"))).toBe(false);
  });
  it("responsável: nome completo, de preferência ou primeiro nome único", () => {
    const users: ImportUser[] = [
      { id: "1", name: "Bárbara Cardoso", preferredName: "Dra. Bárbara", role: "ADMIN" },
      { id: "2", name: "Lucas Silva", role: "LAWYER" },
      { id: "3", name: "Lucas Souza", role: "LAWYER" },
    ];
    expect(matchUser("barbara cardoso", users).user?.id).toBe("1");
    expect(matchUser("Dra. Bárbara", users).user?.id).toBe("1");
    expect(matchUser("Bárbara", users).user?.id).toBe("1");
    expect(matchUser("Lucas", users)).toEqual({ ambiguous: true });
    expect(matchUser("Lucas Souza", users).user?.id).toBe("3");
    expect(matchUser("Fulano", users)).toEqual({ ambiguous: false });
  });
});

describe("validação linha a linha (simulação)", () => {
  const users: ImportUser[] = [{ id: "u-lucas", name: "Lucas Silva", role: "LAWYER" }];
  const headers = ["Nome", "CPF", "Telefone", "UF", "Processo", "Ação", "Status", "Responsável", "Vencimento", "Valor"];
  const mapping = {
    "client.name": "Nome",
    "client.document": "CPF",
    "client.phone": "Telefone",
    "client.state": "UF",
    "process.cnj": "Processo",
    "process.actionType": "Ação",
    "process.status": "Status",
    "process.responsible": "Responsável",
    "process.dueDate": "Vencimento",
    "process.caseValue": "Valor",
  } as const;
  const ctx = { users, lawyerId: "u-padrao", today: "2026-11-03" };
  const row = (line: number, cells: string[]) => ({ line, cells });

  it("linha boa vira payload normalizado", () => {
    const [r] = normalizeRows(headers, [row(2, ["Ana Lima", "529.982.247-25", "+55 (11) 98888-7777", "sp", cnj(10), "Revisional", "Em andamento", "Lucas", "10/12/2026", "R$ 1.500,00"])], mapping, ctx);
    expect(r!.status).toBe("VALID");
    expect(r!.payload).toEqual({
      client: { kind: "INDIVIDUAL", document: "52998224725", name: "Ana Lima", phone: "11988887777", address: { state: "SP" }, responsible_user_id: "u-lucas" },
      process: { cnj: cnj(10), legal_class: "Revisional", status: "ACTIVE", case_value: 1500, due_date: "2026-12-10", responsible_user_id: "u-lucas" },
    });
    expect(r!.raw_data.Nome).toBe("Ana Lima");
  });

  it("erros: sem nome, CPF com 10 dígitos com máscara, CNJ com DV errado, CNJ repetido no arquivo, tipo PJ com CPF", () => {
    const rows = normalizeRows(
      [...headers, "Tipo"],
      [
        row(2, ["", "52998224725", "", "", "", "Ação", "", "", "", "", ""]),
        row(3, ["B", "123.456.789-0", "", "", "", "Ação", "", "", "", "", ""]),
        row(4, ["C", "52998224725", "", "", cnj(11).replace(/^0/, "9"), "", "", "", "", "", ""]),
        row(5, ["D", "11144477735", "", "", cnj(12), "", "", "", "", "", ""]),
        row(6, ["E", "11144477735", "", "", cnj(12), "", "", "", "", "", ""]),
        row(7, ["F", "52998224725", "", "", "", "Ação", "", "", "", "", "PJ"]),
      ],
      { ...mapping, "client.kind": "Tipo" },
      ctx,
    );
    expect(rows.map((r) => r.status)).toEqual(["ERROR", "ERROR", "ERROR", "VALID", "ERROR", "ERROR"]);
    expect(rows[0]!.errors[0]).toMatch(/Nome do cliente vazio/);
    expect(rows[1]!.errors[0]).toMatch(/10 dígitos/);
    expect(rows[2]!.errors[0]).toMatch(/dígito verificador/);
    expect(rows[4]!.errors[0]).toMatch(/linha 5/);
    expect(rows[5]!.errors[0]).toMatch(/não combina/);
    expect(rows.filter((r) => r.status === "ERROR").every((r) => r.payload === undefined)).toBe(true);
  });

  it("avisos: zero à esquerda do Excel, DV do CPF, telefone/UF/valor/data ruins, vencimento passado, responsável desconhecido", () => {
    const [r] = normalizeRows(headers, [row(2, ["Ana", "2998224725", "123", "ZZ", cnj(13), "", "???", "Fulano", "01/01/2020", "abc"])], mapping, ctx);
    expect(r!.status).toBe("WARNING");
    expect(r!.payload!.client.document).toBe("02998224725");
    const w = r!.warnings.join("\n");
    for (const re of [/zero à esquerda/, /Dígito verificador do CPF/, /Telefone/, /UF “ZZ”/, /Status “\?\?\?”/, /Fulano/, /já passou/, /Valor da causa/]) expect(w).toMatch(re);
    expect(r!.payload!.process).toEqual({ cnj: cnj(13) });
    expect(r!.payload!.client.responsible_user_id).toBe("u-padrao");
  });

  it("mesmo CPF com outro nome: aviso apontando a primeira linha SEM erro; linha só de cliente não tem processo", () => {
    const rows = normalizeRows(
      headers,
      [
        row(2, ["Ana", "52998224725", "", "", "123", "", "", "", "", ""]), // erro de CNJ: não conta como primeira
        row(3, ["Ana Lima", "52998224725", "", "", "", "", "", "", "", ""]),
        row(4, ["Ana L.", "52998224725", "", "", "", "", "", "", "", ""]),
      ],
      mapping,
      ctx,
    );
    expect(rows.map((r) => r.status)).toEqual(["ERROR", "VALID", "WARNING"]);
    expect(rows[2]!.warnings[0]).toMatch(/linha 3/);
    expect(rows[1]!.payload!.process).toBeUndefined();
  });

  it("sem CPF/CNPJ: linha de processo vai para o banco achar o cliente pelo nome; linha só de cliente é erro", () => {
    const [p, c] = normalizeRows(headers, [row(2, ["Ana Lima", "", "", "", cnj(20), "Revisional", "", "", "", ""]), row(3, ["Bia", "", "", "", "", "", "", "", "", ""])], mapping, ctx);
    expect(p!.status).toBe("VALID");
    expect(p!.payload).toEqual({ client: { name: "Ana Lima", by_name: true }, process: { cnj: cnj(20), legal_class: "Revisional" } });
    expect(c!.status).toBe("ERROR");
    expect(c!.errors[0]).toMatch(/cliente novo precisa do documento/);
  });

  it("processo sem CNJ, nome nem tipo de ação é erro; CNPJ vira pessoa jurídica", () => {
    const [a, b] = normalizeRows(
      headers,
      [row(2, ["Empresa X", "11.222.333/0001-81", "", "", "", "", "Em andamento", "", "", ""]), row(3, ["Empresa Y", "11222333000181", "", "", "", "Cobrança", "", "", "", ""])],
      mapping,
      ctx,
    );
    expect(a!.errors[0]).toMatch(/sem número CNJ/);
    expect(b!.payload!.client.kind).toBe("COMPANY");
  });
});

describe("relatório CSV", () => {
  it("abre no Excel (BOM e ;), neutraliza fórmula e descreve o que aconteceu", () => {
    const row = toRow({
      row_number: 7,
      status: "IMPORTED",
      errors: [],
      warnings: ["Aviso; com ponto e vírgula"],
      raw_data: { Nome: "=HYPERLINK(1)", CPF: "123" },
      payload: { client: { name: "X", document: "52998224725" } },
      outcome: { result: "IMPORTED", client_action: "CREATE", process_action: "CREATE", deadline_id: "d1" },
    });
    const csv = buildReportCsv([row], ["Nome", "CPF"]);
    expect(csv.startsWith("﻿Linha;Situação;O que aconteceu;Erros;Avisos;Nome;CPF\r\n")).toBe(true);
    expect(csv).toContain('7;Importada;"cliente criado; processo criado; prazo criado";;' + "\"Aviso; com ponto e vírgula\";'=HYPERLINK(1);123");
  });
});
