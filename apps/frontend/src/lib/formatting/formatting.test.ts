import { describe, expect, it } from "vitest";
import { agentRunEventKindLabel, agentRunOperationLabel, agentRunProviderLabel } from "@/features/agent-runs/labels";
import { organizationStatusNotice } from "@/lib/constants/status";
import { capitalizeFirst, displayCNJ, formatCEP, formatPhone, formatUsd } from "./index";

/** Espaço comum no lugar do espaço sem quebra que o Intl usa em moeda. */
const plain = (s: string) => s.replace(/ /g, " ");

describe("formatadores de exibição", () => {
  it("dia da semana: só a primeira letra maiúscula (o capitalize do CSS dava Sexta-Feira)", () => {
    expect(capitalizeFirst("sexta-feira")).toBe("Sexta-feira");
    expect(capitalizeFirst("sábado")).toBe("Sábado");
    expect(capitalizeFirst("")).toBe("");
    const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "America/Sao_Paulo" }).format(new Date("2026-11-13T15:00:00Z"));
    expect(capitalizeFirst(weekday)).toBe("Sexta-feira");
  });

  it("número CNJ: 20 dígitos saem com a máscara, com ou sem pontuação na origem", () => {
    expect(displayCNJ("00012345620268190042")).toBe("0001234-56.2026.8.19.0042");
    expect(displayCNJ("0001234-56.2026.8.19.0042")).toBe("0001234-56.2026.8.19.0042");
  });

  it("número fora do padrão CNJ sai como foi gravado, sem cortar", () => {
    expect(displayCNJ("2009.001.123456-7")).toBe("2009.001.123456-7");
    expect(displayCNJ(" 12345 ")).toBe("12345");
  });

  it("telefone e CEP da ficha do cliente", () => {
    expect(formatPhone("24999366691")).toBe("(24) 99936-6691");
    expect(formatPhone("2422334455")).toBe("(24) 2233-4455");
    expect(formatCEP("25685000")).toBe("25685-000");
  });

  it("custo em dólar com vírgula decimal, inclusive com 4 casas", () => {
    expect(plain(formatUsd(1.5))).toBe("US$ 1,50");
    expect(plain(formatUsd(0.0123, 4))).toBe("US$ 0,0123");
    expect(formatUsd(0.0123, 4)).not.toContain(".");
  });
});

describe("códigos técnicos nunca aparecem crus", () => {
  it("tipo do pedido ao agente", () => {
    expect(agentRunOperationLabel("EXECUTE")).toBe("Execução");
    expect(agentRunOperationLabel("PROCESS_TASK")).toBe("Tarefa do processo");
    expect(agentRunOperationLabel("ALGO_NOVO")).toBe("Pedido ao agente");
    expect(agentRunOperationLabel(undefined)).toBe("Pedido ao agente");
  });

  it("provedor e tipo de registro da execução", () => {
    expect(agentRunProviderLabel("CLAUDE_CODE")).toBe("Claude Code");
    expect(agentRunProviderLabel("OUTRO_X")).toBe("Outro provedor");
    expect(agentRunEventKindLabel("LEASE")).toBe("Trabalho reservado pelo computador do escritório");
    expect(agentRunEventKindLabel("NOVO_TIPO")).toBe("Registro da execução");
  });

  it("situação do escritório na tela de equipe", () => {
    expect(organizationStatusNotice("PENDING")).toBe("Escritório com convite pendente.");
    expect(organizationStatusNotice("SUSPENDED")).toBe("Escritório suspenso.");
    expect(organizationStatusNotice("INACTIVE")).toBe("Escritório inativo.");
    expect(organizationStatusNotice("OUTRA")).not.toContain("OUTRA");
  });
});
