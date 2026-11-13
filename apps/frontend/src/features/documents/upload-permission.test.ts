import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS } from "@/lib/permissions";
import type { Role } from "@/types";
import { canUploadDocuments } from "./upload-permission";

const ID = "8f6c1f0e-3b7a-4d2c-9a51-2f4e5d6c7b8a";
const ROLES = Object.keys(ROLE_PERMISSIONS) as Role[];
const internal = ROLES.filter((r) => ROLE_PERMISSIONS[r].includes("documents.manage"));
const partner = ROLES.filter((r) => ROLE_PERMISSIONS[r].includes("partnerPortal.documents.submit"));

describe("quem pode enviar documento (aba Documentos e Anexar documento da revisão)", () => {
  it("há papéis internos e de parceiro na matriz (o teste não passa no vazio)", () => {
    expect(internal).toEqual(expect.arrayContaining(["ADMIN", "LAWYER"]));
    expect(partner.length).toBeGreaterThan(0);
  });
  it("equipe interna com documents.manage envia em cliente, caso e processo", () => {
    for (const role of internal) {
      expect(canUploadDocuments(role, { clientId: ID })).toBe(true);
      expect(canUploadDocuments(role, { legalCaseId: ID })).toBe(true);
      expect(canUploadDocuments(role, { legalProcessId: ID })).toBe(true);
    }
  });
  it("parceiro envia em caso/processo, nunca só para o cliente", () => {
    for (const role of partner.filter((r) => !internal.includes(r))) {
      expect(canUploadDocuments(role, { legalCaseId: ID })).toBe(true);
      expect(canUploadDocuments(role, { legalProcessId: ID })).toBe(true);
      expect(canUploadDocuments(role, { clientId: ID })).toBe(false);
    }
  });
  it("sem papel, papel sem permissão ou tela só de leitura: não envia", () => {
    expect(canUploadDocuments(undefined, { legalCaseId: ID })).toBe(false);
    for (const role of ROLES.filter((r) => !internal.includes(r) && !partner.includes(r))) expect(canUploadDocuments(role, { legalCaseId: ID })).toBe(false);
    for (const role of ROLES) expect(canUploadDocuments(role, { legalCaseId: ID }, true)).toBe(false);
  });
});
