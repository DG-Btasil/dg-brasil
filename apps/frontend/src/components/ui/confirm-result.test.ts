import { describe, expect, it } from "vitest";
import { confirmFailed } from "./confirm-result";

describe("confirmFailed (diálogo de confirmação)", () => {
  it("mantém o diálogo aberto quando a ação falha", () => {
    expect(confirmFailed(false)).toBe(true);
    expect(confirmFailed({ ok: false, error: { code: "INVALID_STATE", message: "x" } })).toBe(true);
  });

  it("fecha quando a ação termina bem ou não devolve resultado", () => {
    expect(confirmFailed({ ok: true, data: null })).toBe(false);
    expect(confirmFailed(undefined)).toBe(false);
    expect(confirmFailed(true)).toBe(false);
    expect(confirmFailed(null)).toBe(false);
  });
});
