import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LEGAL_CASE_STATUSES } from "@/lib/constants/status";
import { canMarkWaitingDocuments, CASE_STATUS_OVERRIDES, caseStatusOverrideFor } from "./utils";

/**
 * Os botões "Reabrir caso", "Reconsiderar rejeição" e "Marcar como aguardando
 * documentos" só aparecem onde a máquina de estados do sistema (migration 006)
 * aceita a mudança. Este teste lê a migration para as duas não se afastarem.
 */
const SQL = readFileSync(resolve(__dirname, "../../../../../supabase/migrations/20261005000006_legal_cases.sql"), "utf8");

function pairsOf(fn: string): string[] {
  const body = SQL.slice(SQL.indexOf(`function private.${fn}(`));
  const block = body.slice(0, body.indexOf("$$;"));
  return [...block.matchAll(/\('([A-Z_]+)',\s*'([A-Z_]+)'\)/g)].map((m) => `${m[1]}>${m[2]}`);
}

describe("exceções de situação do caso", () => {
  it("a tela oferece exatamente as exceções que o sistema aceita", () => {
    const allowed = pairsOf("case_status_override_allowed").sort();
    const offered = Object.values(CASE_STATUS_OVERRIDES)
      .map((o) => `${o.from}>${o.to}`)
      .sort();
    expect(allowed.length).toBeGreaterThan(0);
    expect(offered).toEqual(allowed);
  });

  it("reabrir só em caso encerrado; reconsiderar só em caso rejeitado", () => {
    expect(caseStatusOverrideFor("CLOSED")).toBe("reopen");
    expect(caseStatusOverrideFor("REJECTED")).toBe("reconsider");
    for (const status of LEGAL_CASE_STATUSES.filter((s) => s !== "CLOSED" && s !== "REJECTED")) expect(caseStatusOverrideFor(status)).toBeUndefined();
  });
});

describe("aguardando documentos", () => {
  it("só é oferecido de situações em que o sistema aceita a mudança", () => {
    const transitions = pairsOf("case_status_transition_allowed");
    const offered = LEGAL_CASE_STATUSES.filter(canMarkWaitingDocuments);
    expect(offered).toEqual(["SUBMITTED", "READY_FOR_ANALYSIS", "WAITING_REVIEW"]);
    for (const status of offered) expect(transitions).toContain(`${status}>WAITING_DOCUMENTS`);
  });

  it("não é oferecido em caso já decidido, encerrado ou arquivado", () => {
    for (const status of ["WAITING_DOCUMENTS", "ACCEPTED", "IN_PROGRESS", "REJECTED", "CLOSED", "ARCHIVED"] as const) expect(canMarkWaitingDocuments(status)).toBe(false);
  });
});
