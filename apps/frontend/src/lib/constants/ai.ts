/**
 * Configuração de execução dos agentes, do lado da tela. O MESMO contrato
 * vale no banco (039, dg_validate_agent_configuration) e no worker
 * (apps/agentes/src/tipos.ts, ConfigAgente): modelo fora da lista ou campo
 * desconhecido é recusado nos três lugares.
 */

export const AI_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", note: "Mais capaz. Para redação e análise jurídica." },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", note: "Equilíbrio entre capacidade e custo." },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", note: "Mais barato. Só para tarefas simples e repetitivas." },
] as const;
export type AiModelId = (typeof AI_MODELS)[number]["id"];
export const AI_MODEL_IDS = AI_MODELS.map((m) => m.id) as [AiModelId, ...AiModelId[]];
export const DEFAULT_AI_MODEL: AiModelId = "claude-opus-5-5";
export const AI_MODEL_LABEL: Record<string, string> = Object.fromEntries(AI_MODELS.map((m) => [m.id, m.label]));

export const AI_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type AiEffort = (typeof AI_EFFORTS)[number];
export const AI_EFFORT_LABEL: Record<AiEffort, string> = {
  low: "Baixo",
  medium: "Médio",
  high: "Alto",
  xhigh: "Muito alto",
  max: "Máximo",
};

/** Ferramentas de LEITURA que a versão do agente pode restringir (as de entrega ficam sempre). */
export const AGENT_READ_TOOLS = [
  { id: "ver_caso", label: "Ver o caso" },
  { id: "ver_processo", label: "Ver processo" },
  { id: "abrir_documento", label: "Abrir documentos do caso" },
  { id: "consultar_teses", label: "Consultar teses" },
  { id: "listar_referencias", label: "Listar referências" },
  { id: "abrir_referencia", label: "Abrir referência" },
] as const;

export const AGENT_LIMITS = {
  maxTurns: { min: 1, max: 200, default: 40 },
  maxToolCalls: { min: 1, max: 500, default: 120 },
  maxDurationSeconds: { min: 30, max: 3600, default: 900 },
  maxBudgetUsd: { min: 0.05, max: 50, default: 2 },
} as const;

/** Arquivos de skill: o que a tela aceita (o banco e o bucket conferem de novo). */
export const SKILL_FILE_TYPES: Record<string, string> = {
  ".py": "text/x-python",
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".json": "application/json",
  ".csv": "text/csv",
  ".html": "text/html",
  ".css": "text/css",
  ".xml": "application/xml",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};
export const SKILL_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const SKILL_FILES_TOTAL_MAX_BYTES = 25 * 1024 * 1024;
export const SKILL_FILES_MAX_COUNT = 200;
/** Caminho dentro da skill (ex.: scripts/gerar.py): sem "..", sem arquivo oculto, sem SKILL.md. */
export const SKILL_FILE_PATH = /^[A-Za-z0-9_][A-Za-z0-9._-]*(\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/;

export function skillFileMime(path: string): string | undefined {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? undefined : SKILL_FILE_TYPES[path.slice(dot).toLowerCase()];
}

/** Referência com arquivo. */
export const REFERENCE_FILE_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".md": "text/markdown",
};
export const REFERENCE_FILE_MAX_BYTES = 50 * 1024 * 1024;

/** Mensagem amigável por categoria de erro da execução (worker, 039). Nunca o erro bruto. */
export const RUN_ERROR_LABEL: Record<string, string> = {
  PROVIDER_UNAVAILABLE: "O provedor de IA estava indisponível.",
  PROVIDER_RATE_LIMITED: "O provedor de IA limitou o uso; tente de novo em alguns minutos.",
  EXECUTION_TIMEOUT: "A execução passou do tempo máximo.",
  CANCELLED: "Interrompida a pedido.",
  CANCELLED_BY_USER: "Interrompida a pedido.",
  INVALID_OUTPUT: "O agente não entregou o resultado no formato exigido.",
  TOOL_ERROR: "Uma ferramenta do sistema falhou durante a execução.",
  MISSING_INPUT: "Faltavam dados para executar o agente.",
  CONFIGURATION_ERROR: "Configuração do agente ou do provedor inválida. Avise o administrador.",
  BUDGET_EXCEEDED: "A execução atingiu o limite de custo, passos ou chamadas.",
  PROVIDER_REFUSED: "O provedor de IA recusou a tarefa.",
  INTERNAL_ERROR: "Erro interno do worker.",
  PARTIAL_OUTPUT: "Falhou depois de entregar parte do resultado: confira em Revisões.",
  MAX_ATTEMPTS: "Esgotou as tentativas automáticas.",
  AGENT_ERROR: "Falha temporária; nova tentativa automática.",
};

export function runErrorLabel(code: string | null | undefined): string | undefined {
  if (!code) return undefined;
  return RUN_ERROR_LABEL[code] ?? "A execução falhou.";
}
