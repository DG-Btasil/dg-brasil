/**
 * Leitura do arquivo de importação no protótipo.
 *
 * - CSV: lido de verdade no navegador (separador ";" ou ",", aspas).
 * - XLSX: a leitura real será feita no backend (import job). Aqui usamos a
 *   planilha de demonstração, claramente identificada na interface.
 */
import { addDays, now } from "@/lib/clock";
import { formatCNJ, formatCPF } from "@/lib/formatting";
import type { Client, Process } from "@/types";

export interface ParsedSheet {
  fileName: string;
  /** "demo" quando os dados vêm da planilha de exemplo. */
  source: "csv" | "demo";
  headers: string[];
  rows: string[][];
}

export const ACCEPTED_EXTENSIONS = [".xlsx", ".csv"] as const;

export function isAcceptedFile(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Parser CSV simples (RFC 4180 básico), com detecção de ";" ou ",". */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      record.push(field.trim());
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i += 1;
      record.push(field.trim());
      if (record.some(Boolean)) records.push(record);
      record = [];
      field = "";
    } else field += ch;
  }
  record.push(field.trim());
  if (record.some(Boolean)) records.push(record);
  const [headers = [], ...rows] = records;
  return { headers, rows: rows.map((r) => headers.map((_, i) => r[i] ?? "")) };
}

/**
 * Planilha de demonstração, com dados FICTÍCIOS. Inclui de propósito casos
 * que a validação precisa pegar: CPF inválido, cliente sem nome, processo
 * repetido no arquivo, CPF e CNJ já cadastrados no escritório e processo
 * sem responsável.
 */
export function buildDemoSheet(existingClients: Client[], existingProcesses: Process[]): ParsedSheet {
  const existingPerson = existingClients.find((c) => c.kind === "INDIVIDUAL");
  const existingProcess = existingProcesses.find((p) => p.cnj);
  const headers = [
    "Nome Completo",
    "CPF",
    "Tipo",
    "E-mail",
    "Telefone",
    "Cidade",
    "UF",
    "Nº Processo",
    "Ação",
    "Tribunal",
    "Parte contrária",
    "Responsável",
    "Vencimento",
    "Status",
    "Valor da causa",
  ];
  const cnj = (n: number) => formatCNJ(`00${String(n).padStart(5, "0")}9920268260100`);
  const cpf = (n: number) => formatCPF(`000${String(n).padStart(6, "0")}91`);
  const due = (d: number) => {
    const date = addDays(now(), d);
    return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
  };
  const bank = "Banco Exemplo S.A. (fictício)";
  const rows: string[][] = [
    ["Maria Aparecida Teste", cpf(101), "PF", "maria.teste@exemplo.com", "(11) 90000-0101", "São Paulo", "SP", cnj(101), "Revisional de consignado", "TJSP", bank, "Cláudio", due(12), "Em andamento", "18.500,00"],
    ["José Carlos Exemplo", cpf(102), "PF", "jose.exemplo@exemplo.com", "(11) 90000-0102", "Campinas", "SP", cnj(102), "Declaratória de inexistência de débito", "TJSP", bank, "Bárbara Cardoso", due(5), "Em andamento", "9.800,00"],
    ["José Carlos Exemplo", cpf(102), "PF", "jose.exemplo@exemplo.com", "(11) 90000-0102", "Campinas", "SP", cnj(103), "Repetição de indébito", "TJSP", bank, "Bárbara Cardoso", due(20), "Distribuído", "4.200,00"],
    ["Comércio Demonstração Ltda.", "00.000.104/0001-91", "PJ", "contato@comercio.exemplo", "(11) 3000-0104", "Santos", "SP", cnj(104), "Revisional de capital de giro", "TJSP", bank, "Cláudio", due(30), "Em andamento", "120.000,00"],
    ["Ana Beatriz Fictícia", cpf(105), "PF", "ana.ficticia@exemplo.com", "(31) 90000-0105", "Belo Horizonte", "MG", cnj(105), "Ação de cobrança indevida", "TJMG", bank, "", due(9), "Em andamento", "6.300,00"],
    ["Paulo Roberto Modelo", "000.000.106", "PF", "paulo.modelo@exemplo.com", "(11) 90000-0106", "Osasco", "SP", cnj(106), "Revisional de cartão consignado", "TJSP", bank, "Cláudio", due(14), "Em andamento", "7.100,00"],
    ["", cpf(107), "PF", "sem.nome@exemplo.com", "(11) 90000-0107", "Guarulhos", "SP", cnj(107), "Revisional de consignado", "TJSP", bank, "Cláudio", due(11), "Em andamento", "5.000,00"],
    ["Lúcia Helena Amostra", cpf(108), "PF", "lucia.amostra@exemplo.com", "(11) 90000-0108", "São Paulo", "SP", cnj(101), "Revisional de consignado", "TJSP", bank, "Cláudio", due(12), "Em andamento", "18.500,00"],
    ["Roberto Teste Silva", cpf(109), "PF", "roberto.teste@exemplo.com", "(41) 90000-0109", "Curitiba", "PR", "", "", "", "", "", "", "", ""],
  ];
  if (existingPerson && existingPerson.kind === "INDIVIDUAL") {
    rows.push([existingPerson.fullName, existingPerson.cpf, "PF", existingPerson.contact.email ?? "", "(11) 90000-0110", existingPerson.address?.city ?? "São Paulo", "SP", cnj(110), "Revisional de consignado", "TJSP", bank, "Cláudio", due(18), "Em andamento", "8.900,00"]);
  }
  if (existingProcess?.cnj) {
    rows.push(["Marcos Vinícius Exemplar", cpf(111), "PF", "marcos.exemplar@exemplo.com", "(11) 90000-0111", "São Paulo", "SP", existingProcess.cnj, existingProcess.actionType, existingProcess.court ?? "TJSP", bank, "Cláudio", due(7), "Em andamento", "12.000,00"]);
  }
  return { fileName: "planilha-exemplo-dg-brasil.xlsx", source: "demo", headers, rows };
}
