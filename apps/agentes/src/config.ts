import { z } from 'zod'

/**
 * Configuração central do worker. Nenhum número mágico espalhado: modelos,
 * limites e chaves vêm daqui (e do ambiente). Segredos só no ambiente do
 * processo — nunca no banco, no log ou na entrada da execução.
 */

/** Modelos que um agente pode usar. Fora desta lista, a execução falha (CONFIGURATION_ERROR). */
export const MODELOS = {
  'claude-opus-5-5': { entrada: 4, saida: 20, cacheLeitura: 0.2, cacheEscrita: 5 },
  'claude-sonnet-5-5': { entrada: 2, saida: 10, cacheLeitura: 0.2, cacheEscrita: 2.5 },
  'claude-haiku-5-5': { entrada: 0.1, saida: 0.5, cacheLeitura: 0.01, cacheEscrita: 0.125 },
} as const satisfies Record<string, Preco>

/** Dólares por milhão de tokens (tabela pública da API, outubro de 2026). */
export interface Preco {
  entrada: number
  saida: number
  cacheLeitura: number
  cacheEscrita: number
}

export type Modelo = keyof typeof MODELOS
export const MODELO_PADRAO: Modelo = 'claude-opus-5-5'

/** Limites padrão de uma execução; a versão do agente pode apertar ou afrouxar dentro das faixas. */
export const LIMITES_PADRAO = {
  maxPassos: 40,
  maxChamadasFerramenta: 120,
  maxDuracaoSegundos: 900,
  maxCustoUsd: 2,
  maxTokensSaida: 32_000,
  /** Documentos abertos (lidos ou enviados ao ambiente) por execução. */
  maxDocumentos: 12,
  /** Tamanho máximo de um documento aberto pelo agente. */
  maxBytesDocumento: 25 * 1024 * 1024,
  /** Texto devolvido por uma ferramenta, em caracteres. Acima disso, corta com aviso explícito. */
  maxCaracteresResultado: 60_000,
  /** Avisos ao agente que terminou sem entregar o que a execução exige. */
  maxLembretesFinais: 2,
} as const

const Ambiente = z.object({
  DATABASE_URL: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  /** Interruptor do processo. Desligado (padrão): o worker não reserva execução nenhuma. */
  AI_EXECUTION_ENABLED: z.enum(['true', 'false']).default('false'),
  /** Execuções simultâneas por worker. Comece com 1. */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
  MAX_TENTATIVAS: z.coerce.number().int().min(1).max(10).default(3),
  FILA_VT_SEGUNDOS: z.coerce.number().int().min(30).max(3600).default(300),
  RESERVA_VENCIDA_SEGUNDOS: z.coerce.number().int().min(60).max(7200).default(600),
  /** Tentativas do SDK em 429/5xx/rede, com espera crescente, antes de devolver à fila. */
  ANTHROPIC_MAX_RETRIES: z.coerce.number().int().min(0).max(6).default(2),
  ANTHROPIC_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(3_600_000).default(600_000),
  /** Teto de custo por execução (dólares) quando a versão do agente não define. */
  TETO_USD: z.coerce.number().positive().max(50).default(LIMITES_PADRAO.maxCustoUsd),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  FLY_MACHINE_ID: z.string().optional(),
})

export type ConfigWorker = ReturnType<typeof lerConfig>

export function lerConfig(env: NodeJS.ProcessEnv = process.env) {
  const r = Ambiente.safeParse(env)
  if (!r.success) {
    // Só os NOMES das variáveis com problema: valores podem ser segredos.
    const nomes = [...new Set(r.error.issues.map((i) => String(i.path[0])))].join(', ')
    throw new Error(`variáveis de ambiente ausentes ou inválidas: ${nomes}`)
  }
  const e = r.data
  return {
    bancoUrl: e.DATABASE_URL,
    supabaseUrl: e.SUPABASE_URL,
    supabaseChaveServico: e.SUPABASE_SERVICE_ROLE_KEY,
    anthropicChave: e.ANTHROPIC_API_KEY,
    execucaoHabilitada: e.AI_EXECUTION_ENABLED === 'true',
    concorrencia: e.WORKER_CONCURRENCY,
    maxTentativas: e.MAX_TENTATIVAS,
    vtSegundos: e.FILA_VT_SEGUNDOS,
    reservaVencidaSegundos: e.RESERVA_VENCIDA_SEGUNDOS,
    anthropicMaxRetries: e.ANTHROPIC_MAX_RETRIES,
    anthropicTimeoutMs: e.ANTHROPIC_TIMEOUT_MS,
    tetoUsd: e.TETO_USD,
    porta: e.PORT,
    maquina: e.FLY_MACHINE_ID ?? 'local',
  }
}

export function precoDe(modelo: string): Preco | null {
  return (MODELOS as Record<string, Preco>)[modelo] ?? null
}
