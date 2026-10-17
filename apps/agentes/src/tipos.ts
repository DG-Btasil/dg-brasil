import { z } from 'zod'
import type { Armazenamento } from './armazenamento.js'
import type { Banco } from './banco.js'
import { MODELO_PADRAO } from './config.js'
import type { Logger } from './log.js'
import type { ContextoFerramenta, ResultadoFerramenta } from './provedor/tipos.js'

/**
 * Configuração de uma versão de agente (agent_versions.configuration). O
 * banco valida o mesmo contrato ao salvar (039, dg_validate_agent_configuration);
 * aqui se revalida porque versões antigas existem e o worker não confia.
 */
export const ConfigAgente = z.object({
  model: z.string().min(1).default(MODELO_PADRAO),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('high'),
  /** Allowlist das ferramentas de LEITURA. Vazia = todas. As de entrega entram sempre. */
  tools: z.array(z.string()).default([]),
  max_turns: z.number().int().min(1).max(200).default(40),
  max_tool_calls: z.number().int().min(1).max(500).optional(),
  max_duration_seconds: z.number().int().min(30).max(3600).optional(),
  /** Teto de gasto por execução, em dólares. Sem valor, vale TETO_USD do ambiente. */
  max_budget_usd: z.number().positive().max(50).optional(),
  max_output_tokens: z.number().int().min(1024).max(128_000).optional(),
  /** Ambiente isolado (execução de código + skills com arquivos). */
  code_execution: z.boolean().default(true),
}).strict()
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
  attempt: number
  retry_of_agent_run_id: string | null
}

export interface ArquivoSkill {
  path: string
  storage_object_name: string
  mime_type: string
  file_size: number
  checksum_sha256: string
}

export interface SkillCarregada {
  id: string
  slug: string
  name: string
  description: string | null
  versionId: string
  versionNumber: number
  instructions: string
  arquivos: ArquivoSkill[]
  /** De onde veio: vínculo do agente ou do template da análise. */
  origem: 'agente' | 'template'
  /** Versão já registrada no provedor (skill_provider_versions). */
  noProvedor: { providerSkillId: string; providerVersionId: string } | null
  /** Skill do provedor de uma versão anterior (para criar só a versão nova). */
  providerSkillIdAnterior: string | null
}

export interface AgenteCarregado {
  id: string
  slug: string
  name: string
  versionId: string
  instructions: string
  config: ConfigAgente
  skills: SkillCarregada[]
}

/** Pedido em texto e parâmetros da execução (agent_run_inputs). Nunca vai para metadata. */
export interface EntradaExecucao {
  pedido: string | null
  parametros: Record<string, unknown>
}

/** Análise ligada à execução (private.worker_run_context, 039). */
export interface AnaliseDaExecucao {
  id: string
  template_id: string
  template_name: string
  template_description: string | null
  field_values: Record<string, unknown>
  template_skill_ids: string[]
  template_thesis_ids: string[]
  fields: { key: string; label: string; type: string; help: string | null }[]
  previous: {
    result_id: string
    summary: string
    result: Record<string, unknown>
    review_status: string | null
    review_notes: string | null
  } | null
}

/** O que a execução fez, sem conteúdo: ids e contagens (vai para metadata). */
export interface Registro {
  propostas: string[]
  documentos: string[]
  analise: string | null
  documentosAbertos: number
  /** Versões de tese e de referência efetivamente consultadas pelo agente. */
  tesesConsultadas: Map<string, string>
  referenciasAbertas: Map<string, string>
  /** Minutas já entregues nesta execução: checksum → versão (não duplica). */
  entregues: Map<string, string>
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
  analise: AnaliseDaExecucao | null
  operacao: string
  registro: Registro
  ambienteIsolado: boolean
  log: Logger
}

/**
 * Uma ferramenta do catálogo do DG Brasil. O provedor só alcança o que está
 * aqui: nada de SQL, shell, URL ou arquivo arbitrário. A entrada chega crua
 * do modelo e é validada pelo schema antes de qualquer efeito.
 */
export interface Ferramenta<T = unknown> {
  nome: string
  descricao: string
  entrada: z.ZodType<T>
  /** JSON Schema enviado ao provedor; sem valor, gerado do schema zod. */
  esquema?: Record<string, unknown>
  /** Validação estrita do lado do provedor (structured outputs). */
  estrita?: boolean
  /** Ferramentas de entrega (proposta, minuta, análise) não passam pela allowlist de leitura. */
  entrega?: boolean
  executar(dados: T, ctx: ContextoFerramenta): Promise<ResultadoFerramenta>
}
