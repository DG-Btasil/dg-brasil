import { describe, expect, it } from "vitest";
import { agentRunIdSchema } from "@/server/domain/agents/schemas";
import { canInterrupt, interruptOutcomeMessage } from "./interrupt";

describe("Interromper análise / execução (4.3.1, 033)", () => {
  it("botão só onde o banco aceitaria: fila e rodando sem pedido; aguardando humano só ADMIN; encerradas nunca", () => {
    expect(canInterrupt({ status: "QUEUED" }, false)).toBe(true);
    expect(canInterrupt({ status: "RUNNING" }, false)).toBe(true);
    expect(canInterrupt({ status: "RUNNING", cancelRequested: true }, true)).toBe(false);
    expect(canInterrupt({ status: "WAITING_HUMAN" }, false)).toBe(false);
    expect(canInterrupt({ status: "WAITING_HUMAN" }, true)).toBe(true);
    for (const status of ["COMPLETED", "FAILED", "CANCELLED"] as const) expect(canInterrupt({ status }, true)).toBe(false);
  });

  it("cada resposta do servidor tem mensagem própria (sem fingir que parou quando só foi pedido)", () => {
    expect(interruptOutcomeMessage("CANCELLED").title).toBe("Execução interrompida");
    expect(interruptOutcomeMessage("CANCEL_REQUESTED").title).toBe("Interrupção solicitada");
    expect(interruptOutcomeMessage("ALREADY_REQUESTED").description).toMatch(/Aguardando/);
    expect(interruptOutcomeMessage("ALREADY_CANCELLED").title).toMatch(/já estava/);
  });

  it("a action só aceita o id da execução (nada de estado vindo do navegador)", () => {
    expect(agentRunIdSchema.safeParse({ id: "x" }).success).toBe(false);
    expect(agentRunIdSchema.parse({ id: "8f6c1f0e-3b7a-4d2c-9a51-2f4e5d6c7b8a", status: "CANCELLED" })).toEqual({ id: "8f6c1f0e-3b7a-4d2c-9a51-2f4e5d6c7b8a" });
  });
});
