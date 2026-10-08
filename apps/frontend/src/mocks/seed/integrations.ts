import { dateFromNow, daysFromNowISO } from "@/lib/clock";
import type { AIUsage, Integration, JudicialSourceState } from "@/types";
import { A, OFFICE_ID, U } from "../ids";

const o = { officeId: OFFICE_ID };

export function buildIntegrations(): Integration[] {
  return [
    {
      ...o,
      id: "int_ai",
      kind: "AI_PROVIDER",
      name: "Claude",
      status: "CONNECTED",
      lastSyncAt: daysFromNowISO(0, 9, 0),
      details: [
        { label: "Organização", value: "Bárbara Cardoso Advocacia — Produção (demonstração)" },
        { label: "Modelo principal", value: "claude-sonnet-5" },
        { label: "Credencial", value: "Gerenciada no backend (não armazenada no navegador)" },
      ],
    },
    {
      ...o,
      id: "int_processual",
      kind: "JUDICIAL",
      name: "Integração Judicial",
      status: "CONNECTED",
      lastSyncAt: daysFromNowISO(0, 6, 0),
      // Detalhes por fonte (DJEN, DataJud) ficam em judicialSources.
      details: [],
    },
    {
      ...o,
      id: "int_storage",
      kind: "STORAGE",
      name: "Armazenamento de documentos",
      status: "CONNECTED",
      lastSyncAt: daysFromNowISO(0, 9, 12),
      details: [
        { label: "Documentos armazenados", value: "48" },
        { label: "Região", value: "Brasil (planejado)" },
      ],
    },
    {
      ...o,
      id: "int_email",
      kind: "EMAIL",
      name: "E-mail",
      status: "ERROR",
      lastSyncAt: daysFromNowISO(-1, 6, 0),
      details: [{ label: "Remetente", value: "contato@barbaracardoso.exemplo" }],
      statusMessage: "Autenticação expirada. Reconecte a conta para retomar os envios.",
    },
    {
      ...o,
      id: "int_whatsapp",
      kind: "WHATSAPP",
      name: "WhatsApp",
      status: "DISCONNECTED",
      details: [],
    },
  ];
}

/** Série determinística (sem aleatoriedade) para os gráficos de consumo. */
export function buildAIUsage(): AIUsage {
  const daily = Array.from({ length: 30 }, (_, i) => {
    const day = 29 - i;
    const weekday = new Date(dateFromNow(-day) + "T12:00:00").getDay();
    const weekend = weekday === 0 || weekday === 6;
    const base = weekend ? 60_000 : 210_000;
    const wave = Math.round(Math.sin(i / 3) * 40_000 + (i % 5) * 9_000);
    const inputTokens = Math.max(20_000, base + wave);
    const outputTokens = Math.round(inputTokens * 0.28);
    const costUsd = Number(((inputTokens / 1e6) * 3 + (outputTokens / 1e6) * 15).toFixed(2));
    const runs = Math.round((inputTokens + outputTokens) / 14_000);
    return { date: dateFromNow(-day), runs, inputTokens, outputTokens, costUsd };
  });
  const runs = daily.reduce((s, d) => s + d.runs, 0);
  const inputTokens = daily.reduce((s, d) => s + d.inputTokens, 0);
  const outputTokens = daily.reduce((s, d) => s + d.outputTokens, 0);
  const estimatedCostUsd = Number(daily.reduce((s, d) => s + d.costUsd, 0).toFixed(2));
  const share = [
    [A.peticoes, 0.41],
    [A.triagem, 0.31],
    [A.prazos, 0.13],
    [A.documentacao, 0.1],
    [A.revisoes, 0.05],
  ] as const;
  return {
    officeId: OFFICE_ID,
    month: dateFromNow(0).slice(0, 7),
    organization: "Bárbara Cardoso Advocacia — Produção (demonstração)",
    primaryModel: "claude-sonnet-5",
    runs,
    runLimit: 3000,
    inputTokens,
    outputTokens,
    estimatedCostUsd,
    daily,
    byAgent: share.map(([agentId, s]) => ({
      agentId,
      runs: Math.round(runs * s),
      inputTokens: Math.round(inputTokens * s),
      outputTokens: Math.round(outputTokens * s),
      costUsd: Number((estimatedCostUsd * s).toFixed(2)),
    })),
    byModel: [
      { model: "claude-sonnet-5", runs: Math.round(runs * 0.52), tokens: Math.round((inputTokens + outputTokens) * 0.52), costUsd: Number((estimatedCostUsd * 0.44).toFixed(2)) },
      { model: "claude-opus-5-5", runs: Math.round(runs * 0.24), tokens: Math.round((inputTokens + outputTokens) * 0.24), costUsd: Number((estimatedCostUsd * 0.49).toFixed(2)) },
      { model: "claude-haiku-4-5", runs: Math.round(runs * 0.24), tokens: Math.round((inputTokens + outputTokens) * 0.24), costUsd: Number((estimatedCostUsd * 0.07).toFixed(2)) },
    ],
    lastSyncAt: daysFromNowISO(0, 9, 0),
  };
}

/** Fontes da Integração Judicial (mock): DJEN conectado por OAB; DataJud aguardando configuração. */
export function buildJudicialSources(): JudicialSourceState[] {
  return [
    {
      ...o,
      id: "jud_djen",
      source: "DJEN",
      status: "CONNECTED",
      oabNumber: "000.101",
      oabState: "SP",
      responsibleUserId: U.barbara,
      lastSyncAt: daysFromNowISO(0, 6, 0),
      lastCommunicationAt: daysFromNowISO(-1, 18, 12),
      importedCount: 37,
    },
    {
      ...o,
      id: "jud_datajud",
      source: "DATAJUD",
      status: "PENDING",
      courts: ["TJSP", "TJMG"],
      responsibleUserId: U.claudio,
      importedCount: 0,
      statusMessage: "Configure os tribunais consultados para enriquecer os processos já cadastrados.",
    },
  ];
}
