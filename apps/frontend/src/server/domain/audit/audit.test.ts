import { describe, expect, it } from "vitest";
import * as service from "./service";
import { accessEventFromRow, auditEventFromRow, sanitizeAuditMetadata, type AuditEventRow } from "./mappers";
import { listAuditEventsSchema, listPersonalDataAccessSchema } from "./schemas";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

describe("whitelist da metadata de auditoria", () => {
  it("mantém IDs, status, nomes de campo e números", () => {
    const { metadata, omitted } = sanitizeAuditMetadata({
      legal_case_id: UUID_A,
      from: "SUBMITTED",
      to: "ACCEPTED",
      fields: ["title", "summary"],
      partner_percentage: 40,
      amount: "1500.50",
      after_acceptance: true,
      before: { partner: 50, owner: 50 },
      after: { partner: 30, owner: 70 },
    });
    expect(omitted).toBe(false);
    expect(metadata).toEqual({
      legal_case_id: UUID_A,
      from: "SUBMITTED",
      to: "ACCEPTED",
      fields: ["title", "summary"],
      partner_percentage: 40,
      amount: 1500.5,
      after_acceptance: true,
      before: { partner: 50, owner: 50 },
      after: { partner: 30, owner: 70 },
    });
  });

  it("descarta texto livre e chave desconhecida (motivo, e-mail, CPF)", () => {
    const { metadata, omitted } = sanitizeAuditMetadata({
      from: UUID_A,
      to: UUID_B,
      reason: "Cliente Maria da Silva pediu troca",
      cancellation_reason: "texto livre",
      email: "pessoa@exemplo.test",
      cpf: "99900011122",
    });
    expect(omitted).toBe(true);
    expect(metadata).toEqual({ from: UUID_A, to: UUID_B });
  });

  it("chave da whitelist com valor fora do formato é omitida", () => {
    const { metadata, omitted } = sanitizeAuditMetadata({
      client_id: "não é uuid",
      status: "texto com espaço e @",
      fields: ["ok", "Nome Completo"],
      amount: "R$ 10",
      before: { partner: 50, nota: "x" },
      enabled: "sim",
    });
    expect(omitted).toBe(true);
    expect(metadata).toEqual({});
  });

  it("metadata nula/vazia não sinaliza omissão; array/primitivo sim", () => {
    expect(sanitizeAuditMetadata(null)).toEqual({ metadata: {}, omitted: false });
    expect(sanitizeAuditMetadata({})).toEqual({ metadata: {}, omitted: false });
    expect(sanitizeAuditMetadata(["x"])).toEqual({ metadata: {}, omitted: true });
    expect(sanitizeAuditMetadata("x")).toEqual({ metadata: {}, omitted: true });
  });
});

describe("DTO de auditoria", () => {
  const row: AuditEventRow & { ip_address: string; user_agent: string } = {
    id: UUID_A,
    actor_type: "USER",
    actor_user_id: UUID_B,
    actor_organization_id: null,
    agent_run_id: null,
    action: "PARTNER_SHARE_CHANGED",
    entity_type: "organizations",
    entity_id: UUID_A,
    request_id: null,
    metadata: { preserved_agreements: 3, reason: "x" },
    created_at: "2026-10-10T12:00:00Z",
    ip_address: "10.0.0.1",
    user_agent: "Mozilla",
  };

  it("nunca leva ip_address/user_agent, mesmo que a linha traga", () => {
    const dto = auditEventFromRow(row, new Map([[UUID_B, "Dra. Admin"]]));
    expect(dto).toMatchObject({ actorName: "Dra. Admin", metadata: { preserved_agreements: 3 }, metadataOmitted: true });
    const json = JSON.stringify(dto);
    expect(json).not.toContain("10.0.0.1");
    expect(json).not.toContain("Mozilla");
    expect(dto).not.toHaveProperty("ipAddress");
  });

  it("acesso LGPD: só IDs, ação e finalidade", () => {
    const dto = accessEventFromRow(
      { id: UUID_A, actor_type: "USER", actor_user_id: null, organization_id: null, agent_run_id: null, client_id: UUID_B, resource_type: "CLIENT", resource_id: UUID_B, action: "VIEW_DETAIL", purpose: null, request_id: null, created_at: "2026-10-10T12:00:00Z" },
      new Map(),
    );
    expect(dto).toMatchObject({ clientId: UUID_B, action: "VIEW_DETAIL" });
    expect(dto.actorName).toBeUndefined();
  });
});

describe("schemas e superfície do módulo", () => {
  it("filtros validados; período invertido recusado; só ordena por data", () => {
    expect(listAuditEventsSchema.parse({ action: "case_accepted" }).action).toBe("CASE_ACCEPTED");
    expect(listAuditEventsSchema.safeParse({ entityType: "organizations; drop" }).success).toBe(false);
    expect(listAuditEventsSchema.safeParse({ from: "2026-10-10T00:00:00Z", to: "2026-10-01T00:00:00Z" }).success).toBe(false);
    expect(listAuditEventsSchema.safeParse({ sortBy: "ip_address" }).success).toBe(false);
    expect(listPersonalDataAccessSchema.safeParse({ action: "DELETE" }).success).toBe(false);
  });

  it("o service só expõe leitura", () => {
    expect(Object.keys(service).sort()).toEqual(["listAuditEvents", "listPersonalDataAccessEvents"]);
  });
});
