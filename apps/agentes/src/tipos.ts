export type PoliticaAprovacao = 'auto' | 'humana' | 'humana_se'

export interface Agente {
  id: string
  slug: string
  nome: string
  descricao: string | null
  modelo: string
  prompt_sistema: string
  ferramentas: string[]
  politica_aprovacao: PoliticaAprovacao
  limite_auto: string | null
  gatilho: Record<string, unknown>
  ativo: boolean
}

export interface Execucao {
  id: string
  agente_id: string
  gatilho: string
  solicitado_por: string | null
  caso_id: string | null
  entrada: Record<string, unknown>
  tentativas: number
  max_tentativas: number
}

/** O que o agente pode propor. Cada tipo tem um aplicador em `aplicar.ts`. */
export type TipoProposta =
  | 'criar_documento'
  | 'abrir_prazo'
  | 'criar_tarefa'
  | 'enviar_mensagem'
  | 'lancar_honorario'
  | 'classificar_lead'
  | 'atualizar_caso'
  | 'registrar_esteira'

export interface Proposta {
  tipo: TipoProposta
  resumo: string
  payload: Record<string, unknown>
  alvo_tabela?: string
  alvo_id?: string
}
