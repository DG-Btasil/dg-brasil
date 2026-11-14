import { describe, expect, it } from "vitest";
import {
  caseCorrectionData,
  caseCorrectionDefaults,
  caseCorrectionSchema,
  correctionRows,
  deadlineCorrectionData,
  deadlineCorrectionDefaults,
  deadlineCorrectionSchema,
  documentCorrectionData,
  documentCorrectionDefaults,
  documentCorrectionSchema,
  officeDateTimeParts,
  officeInstant,
  processCorrectionData,
  processCorrectionDefaults,
  processCorrectionSchema,
  proposalFieldText,
} from "./proposal-correction";

const USER = "00000000-0000-4000-8000-000000000001";
const OTHER_USER = "00000000-0000-4000-8000-000000000002";
const names = (id: string) => ({ [USER]: "Lucas", [OTHER_USER]: "Ana" })[id];

describe("datas no fuso do escritório", () => {
  it("instante com fuso → data e hora de Brasília; texto que não é data fica vazio", () => {
    expect(officeDateTimeParts("2027-03-10T23:59:00-03:00")).toEqual({ date: "2027-03-10", time: "23:59" });
    expect(officeDateTimeParts("2027-03-11T02:30:00Z")).toEqual({ date: "2027-03-10", time: "23:30" });
    expect(officeDateTimeParts("amanhã")).toEqual({ date: "", time: "" });
    expect(officeDateTimeParts(undefined)).toEqual({ date: "", time: "" });
  });

  it("data civil → fim do dia em Brasília; com hora, a hora em Brasília", () => {
    expect(officeInstant("2027-03-10")).toBe("2027-03-10T23:59:59-03:00");
    expect(officeInstant("2027-03-10", "14:30")).toBe("2027-03-10T14:30:00-03:00");
  });
});

describe("prazo (CREATE_DEADLINE)", () => {
  const agent = { title: "Réplica", due_at: "2027-03-10T23:59:00-03:00", priority: "HIGH", description: "CPC, art. 350.", legal_process_id: "p1" };

  it("o formulário nasce com o que o agente propôs; sem tipo, é prazo interno", () => {
    expect(deadlineCorrectionDefaults(agent)).toEqual({
      title: "Réplica", type: "INTERNAL", dueDate: "2027-03-10", dueTime: "", responsibleUserId: "", priority: "HIGH", notes: "CPC, art. 350.",
    });
    expect(deadlineCorrectionDefaults({ ...agent, deadline_type: "HEARING", due_at: "2027-03-10T14:00:00-03:00" })).toMatchObject({ type: "HEARING", dueTime: "14:00" });
  });

  it("muda só o que a pessoa mudou: a data do agente não é regravada quando a data não mudou", () => {
    const v = deadlineCorrectionSchema.parse({ ...deadlineCorrectionDefaults(agent), title: "Réplica à contestação", responsibleUserId: USER });
    expect(deadlineCorrectionData(agent, v)).toEqual({ ...agent, title: "Réplica à contestação", responsible_user_id: USER });
  });

  it("data nova vale até 23:59:59 de Brasília; audiência leva a hora; descrição apagada sai", () => {
    const base = { ...deadlineCorrectionDefaults(agent), responsibleUserId: USER };
    expect(deadlineCorrectionData(agent, deadlineCorrectionSchema.parse({ ...base, dueDate: "2027-03-12" })).due_at).toBe("2027-03-12T23:59:59-03:00");
    const hearing = deadlineCorrectionData(agent, deadlineCorrectionSchema.parse({ ...base, type: "HEARING", dueTime: "09:30" }));
    expect([hearing.deadline_type, hearing.due_at]).toEqual(["HEARING", "2027-03-10T09:30:00-03:00"]);
    expect("description" in deadlineCorrectionData(agent, deadlineCorrectionSchema.parse({ ...base, notes: "  " }))).toBe(false);
  });

  it("as regras do formulário de prazo da equipe: título, vencimento, responsável e hora da audiência", () => {
    const base = { ...deadlineCorrectionDefaults(agent), responsibleUserId: USER };
    const issues = (v: object) => (deadlineCorrectionSchema.safeParse(v).error?.issues ?? []).map((i) => i.path.join("."));
    expect(issues({ ...base, title: " " })).toContain("title");
    expect(issues({ ...base, dueDate: "" })).toContain("dueDate");
    expect(issues({ ...base, responsibleUserId: "" })).toContain("responsibleUserId");
    expect(issues({ ...base, type: "HEARING", dueTime: "" })).toContain("dueTime");
    expect(issues(base)).toEqual([]);
  });
});

describe("pedido de documento, caso e processo", () => {
  it("pedido de documento: obrigatório vira sim/não; prazo do parceiro em data civil", () => {
    const agent = { label: "Extrato", category: "OTHER", required: true };
    const d = documentCorrectionDefaults(agent);
    expect(d).toEqual({ label: "Extrato", category: "OTHER", required: "yes", messageToPartner: "", dueDate: "" });
    const v = documentCorrectionSchema.parse({ ...d, category: "BENEFIT_STATEMENT", required: "no", dueDate: "2027-01-20" });
    expect(documentCorrectionData(agent, v)).toEqual({ label: "Extrato", category: "BENEFIT_STATEMENT", required: false, due_at: "2027-01-20T23:59:59-03:00" });
    expect(documentCorrectionSchema.safeParse({ ...d, category: "" }).success).toBe(false);
  });

  it("caso: só as situações do agente; ao menos um campo", () => {
    const agent = { summary: "Resumo do agente" };
    const d = caseCorrectionDefaults(agent);
    expect(d).toEqual({ title: "", summary: "Resumo do agente", status: "" });
    expect(caseCorrectionData(agent, caseCorrectionSchema.parse({ ...d, status: "READY_FOR_ANALYSIS" }))).toEqual({ summary: "Resumo do agente", status: "READY_FOR_ANALYSIS" });
    expect(caseCorrectionSchema.safeParse({ ...d, status: "ACCEPTED" }).success).toBe(false);
    expect(caseCorrectionSchema.safeParse({ title: "", summary: "", status: "" }).success).toBe(false);
  });

  it("processo: CNJ só com dígitos, UF maiúscula, valor no formato brasileiro", () => {
    const agent = { court: "TJRJ", case_value: 1500 };
    const d = processCorrectionDefaults(agent);
    expect([d.court, d.caseValue, d.cnj]).toEqual(["TJRJ", "1.500,00", ""]);
    const v = processCorrectionSchema.parse({ ...d, cnj: "0001234-56.2026.8.19.0001", state: "rj", caseValue: "15.000,50" });
    expect(processCorrectionData(agent, v)).toEqual({ court: "TJRJ", case_value: 15000.5, cnj_number: "00012345620268190001", state: "RJ" });
    expect(processCorrectionData(agent, processCorrectionSchema.parse(d))).toEqual(agent);
    expect(processCorrectionSchema.safeParse({ ...d, caseValue: "1500.00" }).success).toBe(false);
    expect(processCorrectionSchema.safeParse({ ...d, cnj: "123" }).success).toBe(false);
  });
});

describe("resumo do que vai ser aplicado", () => {
  it("só as linhas que mudaram, com rótulos e valores para pessoas", () => {
    const before = { title: "Réplica", priority: "NORMAL", responsible_user_id: USER, due_at: "2027-03-10T23:59:00-03:00" };
    const after = { title: "Réplica à contestação", priority: "HIGH", responsible_user_id: OTHER_USER, due_at: "2027-03-10T23:59:00-03:00", deadline_type: "REPLY" };
    const rows = correctionRows(before, after, names);
    expect(rows.map((r) => [r.label, r.before, r.after])).toEqual([
      ["Título", "Réplica", "Réplica à contestação"],
      ["Prioridade", "Normal", "Alta"],
      ["Tipo do prazo", "—", "Réplica"],
      ["Responsável", "Lucas", "Ana"],
    ]);
  });

  it("valores de cada tipo de campo", () => {
    expect(proposalFieldText("required", false, names)).toBe("Não");
    expect(proposalFieldText("category", "BENEFIT_STATEMENT", names)).toBe("Extrato de benefício");
    expect(proposalFieldText("status", "READY_FOR_ANALYSIS", names)).toBe("Pronto para análise");
    expect(proposalFieldText("client_side", "ACTIVE", names)).toBe("Polo ativo (autor)");
    expect(proposalFieldText("case_value", 1500, names)).toMatch(/1\.500,00/);
    expect(proposalFieldText("responsible_user_id", "x", names)).toBe("Pessoa da equipe");
    expect(proposalFieldText("title", "", names)).toBe("—");
    // Tela da proposta (R4): data e hora para pessoas, rótulo da prioridade, nada de ISO nem código cru.
    expect(proposalFieldText("due_at", "2026-12-03T23:59:00-03:00", names)).toMatch(/^\d{2}\/\d{2}\/2026 às \d{2}:\d{2}$/);
    expect(proposalFieldText("priority", "HIGH", names)).not.toBe("HIGH");
    expect(proposalFieldText("category", "POWER_OF_ATTORNEY", names)).not.toBe("POWER_OF_ATTORNEY");
    expect(proposalFieldText("required", true, names)).toBe("Sim");
  });
});
