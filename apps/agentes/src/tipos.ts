import { z } from 'zod'
import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import type { Armazenamento } from './armazenamento.js'
import type { Banco } from './banco.js'

/**
 * Configuração de uma versão de agente (agent_versions.configuration).
 * As instruções ficam em agent_versions.instructions.
 */
export const ConfigAgente = z.object({
  model: z.string().min(1).default('claude-opus-5-5'),
  /** Allowlist das ferramentas de LEITURA. Vazia = todas. As de escrita (propor, entregar_documento) entram sempre. */
  tools: z.array(z.string()).default([]),
  max_turns: z.number().int().min(1).max(200).default(40),
  /** Teto de gasto por execução, em dólares. Sem valor, vale TETO_USD do ambiente. */
  max_budget_usd: z.number().positive().max(50).optional(),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('high'),
})
export type ConfigAgente = z.infer<typeof ConfigAgente>

/** Mensagem da fila agent_execution, montada por private.enqueue_agent_run. */
export const MensagemFila = z.object({
  agent_run_id: z.string().uuid(),
  legal_case_id: z.string().uuid().nullable().optional(),
  operation: z.string(),
  correlation_id: z.string().uuid().optional(),
})
export type MensagemFila = z.infer<typeof MensagemFila>

export interface AgentRun {
  id: string
  agent_id: string
  agent_version_id: string
  legal_case_id: string | null
  legal_process_id: string | null
  requested_by: string | null
}

export interface AgenteCarregado {
  id: string
  slug: string
  name: string
  versionId: string
  instructions: string
  config: ConfigAgente
  /** Skills vinculadas e ativas, na versão corrente. */
  skills: { slug: string; instructions: string }[]
}

/** Pedido em texto e parâmetros da execução (agent_run_inputs). Nunca vai para metadata. */
export interface EntradaExecucao {
  pedido: string | null
  parametros: Record<string, unknown>
}

/** O que a execução fez, sem conteúdo: vai para agent_runs.metadata. */
export interface Registro {
  ferramentas: Record<string, number>
  negadas: string[]
  propostas: string[]
  documentos: string[]
}

export interface Metricas {
  tokensEntrada: number
  tokensSaida: number
  custoUsd: number
  modelo: string
}

export interface ContextoExecucao {
  banco: Banco
  armazenamento: Armazenamento
  /** Id deste worker: dono da reserva, exigido pelas funções private.worker_*. */
  worker: string
  run: AgentRun
  agente: AgenteCarregado
  /** Cliente do caso da execução. Quando há caso, as leituras ficam restritas a ele. */
  clienteDoCaso: string | null
  entrada: EntradaExecucao
  scratch: string
  operacao: string
  registro: Registro
}

export type Ferramenta = SdkMcpToolDefinition<any>

/** Executa o agente com as ferramentas dadas. A implementação real usa o Claude Agent SDK. */
export type ExecutarAgente = (ctx: ContextoExecucao, ferramentas: Ferramenta[]) => Promise<Metricas>
