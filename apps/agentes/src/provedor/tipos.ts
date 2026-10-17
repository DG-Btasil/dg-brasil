import type { UsoParcial } from '../erros.js'

/**
 * Contrato entre o domínio (worker do DG Brasil) e um provedor de IA.
 *
 * O domínio não conhece SDK, formato de mensagem nem nome de bloco do
 * provedor: entrega uma tarefa (instruções, pedido, ferramentas do catálogo,
 * limites) e recebe o resultado ou um ErroExecucao com categoria. Trocar de
 * provedor = outra implementação desta interface.
 *
 * Implementações: ClaudeApiProvider (provedor/anthropic.ts, a real) e
 * ProvedorFalso (provedor/falso.ts, determinístico, para os testes).
 */

/** Arquivo que uma ferramenta disponibiliza ao agente (documento do caso, referência). */
export interface Anexo {
  nome: string
  mime: string
  bytes: Uint8Array
  /**
   * leitura = o modelo lê o conteúdo (PDF, texto, imagem);
   * arquivo = vai para o ambiente isolado, para scripts processarem;
   * ambos = os dois.
   */
  modo: 'leitura' | 'arquivo' | 'ambos'
}

export interface ResultadoFerramenta {
  texto: string
  erro?: boolean
  anexos?: Anexo[]
}

/** Arquivo que o agente PRODUZIU nesta execução (no ambiente isolado). */
export interface ArquivoGerado {
  nome: string
  mime: string
  bytes: Uint8Array
}

/** O que a ferramenta pode pedir ao provedor durante a execução. */
export interface ContextoFerramenta {
  /** Só arquivos produzidos NESTA execução; nome = o que o agente gravou. */
  arquivoGerado(nome: string): Promise<ArquivoGerado | null>
  arquivosGerados(): string[]
}

export interface FerramentaProvedor {
  nome: string
  descricao: string
  /** JSON Schema da entrada (objeto). */
  esquema: Record<string, unknown>
  /** Validação estrita do provedor, quando suportada. A ferramenta revalida sempre. */
  estrita?: boolean
  executar(entrada: unknown, ctx: ContextoFerramenta): Promise<ResultadoFerramenta>
}

/** Skill pronta para o ambiente isolado do provedor (versão já registrada lá). */
export interface SkillNoProvedor {
  providerSkillId: string
  providerVersionId: string
}

/** Pacote de uma versão de skill a enviar ao provedor (SKILL.md + arquivos). */
export interface PacoteSkill {
  nome: string
  descricao: string
  instrucoes: string
  arquivos: { caminho: string; mime: string; bytes: Uint8Array }[]
  /** Skill já existente no provedor (versões anteriores), para criar só a versão nova. */
  providerSkillIdExistente?: string
}

export interface LimitesTarefa {
  maxPassos: number
  maxChamadasFerramenta: number
  maxDuracaoMs: number
  maxCustoUsd: number
  maxTokensSaida: number
  maxLembretesFinais: number
}

export interface TarefaProvedor {
  modelo: string
  esforco: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  sistema: string
  pedido: string
  ferramentas: FerramentaProvedor[]
  ambienteIsolado: { habilitado: boolean; skills: SkillNoProvedor[] }
  limites: LimitesTarefa
  /** Abortado = parar já (interrupção pedida ou reserva perdida). */
  sinal: AbortSignal
  /** Chamado a cada passo concluído (o domínio confere interrupção/reserva). */
  aoPasso?: (uso: Uso) => Promise<void>
  /**
   * O agente terminou de falar. Devolver texto = lembrete ao agente (ex.: não
   * entregou a análise) e o trabalho continua; null = pode encerrar.
   */
  aoTerminar?: () => Promise<string | null>
}

export interface Uso extends UsoParcial {
  ferramentas: Record<string, number>
  /** Chamadas de execução de código no ambiente isolado. */
  execucoesCodigo: number
}

export interface ResultadoProvedor {
  modelo: string
  uso: Uso
  /** Última fala do agente (só para log técnico local; não vai ao banco). */
  textoFinal: string
}

export interface AIProvider {
  readonly id: string
  /** Envia uma versão de skill ao provedor e devolve a versão registrada lá. */
  garantirSkill(pacote: PacoteSkill): Promise<SkillNoProvedor & { nome: string }>
  /** Executa a tarefa. Falha = ErroExecucao com categoria (e uso parcial). */
  executar(tarefa: TarefaProvedor): Promise<ResultadoProvedor>
}

export function usoVazio(): Uso {
  return {
    tokensEntrada: 0, tokensSaida: 0, cacheLeitura: 0, cacheEscrita: 0, custoUsd: 0,
    passos: 0, chamadasFerramenta: 0, ferramentas: {}, execucoesCodigo: 0,
  }
}
