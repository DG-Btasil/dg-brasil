/**
 * Categorias de erro de uma execução. Vão para agent_runs.error_code; a tela
 * mostra uma mensagem amigável por categoria. O erro bruto do provedor nunca
 * vai ao navegador nem ao banco: só a mensagem curta e sanitizada daqui.
 *
 * Transitório = vale tentar de novo (rede, limite de uso, provedor fora).
 * Permanente = repetir dá no mesmo (configuração, permissão, saída inválida).
 */
export const CATEGORIAS = {
  PROVIDER_UNAVAILABLE: { transitorio: true, mensagem: 'O provedor de IA está indisponível no momento.' },
  PROVIDER_RATE_LIMITED: { transitorio: true, mensagem: 'O provedor de IA limitou o uso; nova tentativa em instantes.' },
  EXECUTION_TIMEOUT: { transitorio: false, mensagem: 'A execução passou do tempo máximo permitido.' },
  CANCELLED: { transitorio: false, mensagem: 'Execução interrompida a pedido.' },
  INVALID_OUTPUT: { transitorio: false, mensagem: 'O agente não entregou um resultado no formato exigido.' },
  TOOL_ERROR: { transitorio: false, mensagem: 'Uma ferramenta do sistema falhou durante a execução.' },
  MISSING_INPUT: { transitorio: false, mensagem: 'Faltam dados para executar o agente.' },
  CONFIGURATION_ERROR: { transitorio: false, mensagem: 'A configuração do agente ou do provedor de IA é inválida.' },
  BUDGET_EXCEEDED: { transitorio: false, mensagem: 'A execução atingiu o limite de custo, passos ou chamadas.' },
  PROVIDER_REFUSED: { transitorio: false, mensagem: 'O provedor de IA recusou a tarefa.' },
  INTERNAL_ERROR: { transitorio: true, mensagem: 'Erro interno do worker.' },
} as const

export type Categoria = keyof typeof CATEGORIAS

export interface UsoParcial {
  tokensEntrada: number
  tokensSaida: number
  cacheLeitura: number
  cacheEscrita: number
  custoUsd: number
  passos: number
  chamadasFerramenta: number
}

export class ErroExecucao extends Error {
  readonly categoria: Categoria
  /** Uso já consumido até a falha (para registrar o custo mesmo assim). */
  uso?: UsoParcial
  modelo?: string

  constructor(categoria: Categoria, detalhe?: string, opcoes?: { uso?: UsoParcial; modelo?: string }) {
    // A mensagem é curta e não carrega conteúdo: categoria + detalhe técnico controlado.
    super(detalhe ? `${CATEGORIAS[categoria].mensagem} (${detalhe.slice(0, 300)})` : CATEGORIAS[categoria].mensagem)
    this.name = 'ErroExecucao'
    this.categoria = categoria
    this.uso = opcoes?.uso
    this.modelo = opcoes?.modelo
  }

  get transitorio(): boolean {
    return CATEGORIAS[this.categoria].transitorio
  }
}

export function comoErroExecucao(e: unknown): ErroExecucao {
  if (e instanceof ErroExecucao) return e
  // Erro inesperado: só a classe vai para o registro, nunca a mensagem (pode
  // carregar trecho de dado ou de resposta do provedor).
  const nome = e instanceof Error ? e.name : typeof e
  return new ErroExecucao('INTERNAL_ERROR', nome)
}
