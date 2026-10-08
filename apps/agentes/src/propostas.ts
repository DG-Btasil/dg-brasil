import { createHash } from 'node:crypto'
import { z } from 'zod'

/**
 * O que um agente pode PROPOR (agent_proposals.proposal_type) e o formato de
 * cada payload. O mesmo schema valida na hora de propor (o agente recebe o erro
 * e corrige) e de novo na hora de aplicar.
 *
 * Minuta de documento não é proposta: é entregue como versão INTERNAL de
 * documento e revisada como tal (ferramenta entregar_documento).
 */

const isoData = z.string().datetime({ offset: true })

// Status que um agente pode pôr no caso. Aceitar, rejeitar, encerrar e
// arquivar são decisões humanas e não estão aqui de propósito.
export const STATUS_CASO_PARA_AGENTE = [
  'WAITING_DOCUMENTS', 'READY_FOR_ANALYSIS', 'ANALYZING', 'WAITING_REVIEW',
] as const

export const PAYLOADS = {
  CREATE_DEADLINE: z.object({
    title: z.string().min(3).max(200),
    description: z.string().max(4000).optional(),
    due_at: isoData,
    priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
    legal_process_id: z.string().uuid().optional(),
    responsible_user_id: z.string().uuid().optional(),
  }),
  REQUEST_DOCUMENT: z.object({
    category: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/, 'categoria em CAIXA_ALTA, ex.: BENEFIT_STATEMENT'),
    label: z.string().min(3).max(200),
    required: z.boolean().default(true),
    /** Se o caso tem parceiro, vira também uma solicitação ao parceiro. */
    message_to_partner: z.string().max(2000).optional(),
    due_at: isoData.optional(),
  }),
  UPDATE_CASE: z
    .object({
      title: z.string().min(3).max(200).optional(),
      summary: z.string().max(8000).optional(),
      status: z.enum(STATUS_CASO_PARA_AGENTE).optional(),
    })
    .refine((p) => Object.values(p).some((v) => v !== undefined), 'informe ao menos um campo'),
  CREATE_PROCESS: z.object({
    cnj_number: z.string().regex(/^[0-9]{20}$/, 'CNJ só com os 20 dígitos').optional(),
    court: z.string().max(200).optional(),
    court_unit: z.string().max(200).optional(),
    district: z.string().max(200).optional(),
    state: z.string().regex(/^[A-Z]{2}$/).optional(),
    legal_class: z.string().max(200).optional(),
    subject: z.string().max(500).optional(),
    /** Polo do CLIENTE no processo (não é o papel de cada parte). */
    client_side: z.enum(['ACTIVE', 'PASSIVE', 'THIRD_PARTY']).optional(),
    adverse_party_summary: z.string().max(2000).optional(),
    case_value: z.number().nonnegative().optional(),
  }),
  UPDATE_SKILL: z.object({
    skill_slug: z.string().min(2),
    instructions: z.string().min(20),
    configuration: z.record(z.string(), z.unknown()).default({}),
  }),
  UPDATE_AGENT: z.object({
    agent_slug: z.string().min(2),
    instructions: z.string().min(20),
    configuration: z.record(z.string(), z.unknown()).default({}),
  }),
  /** Algo sem aplicador automático: aprovado, vira providência humana. */
  OTHER: z.object({
    description: z.string().min(10).max(4000),
  }),
} as const

export type TipoProposta = keyof typeof PAYLOADS
export const TIPOS_PROPOSTA = Object.keys(PAYLOADS) as [TipoProposta, ...TipoProposta[]]

/** Tipos que só fazem sentido dentro de um caso. */
export const EXIGE_CASO: ReadonlySet<TipoProposta> = new Set([
  'CREATE_DEADLINE', 'REQUEST_DOCUMENT', 'UPDATE_CASE', 'CREATE_PROCESS',
])

/**
 * Chave de idempotência: mesma proposta (tipo + dados) na mesma execução é a
 * mesma linha — o banco tem unique (agent_run_id, idempotency_key).
 */
export function chaveIdempotencia(tipo: TipoProposta, dados: Record<string, unknown>): string {
  return `prop:${createHash('sha256').update(`${tipo}:${canonico(dados)}`).digest('hex').slice(0, 40)}`
}

function canonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonico((v as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(v)
}

export function validarPayload<T extends TipoProposta>(tipo: T, payload: unknown): z.infer<(typeof PAYLOADS)[T]> {
  return PAYLOADS[tipo].parse(payload) as z.infer<(typeof PAYLOADS)[T]>
}

/**
 * agent_proposals.payload guarda o resumo para a fila de Revisões e os dados
 * já validados, que são exatamente o que será aplicado.
 */
export interface PayloadGravado {
  summary: string
  data: Record<string, unknown>
}
