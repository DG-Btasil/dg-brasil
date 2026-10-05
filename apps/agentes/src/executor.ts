import { createSdkMcpServer, query } from '@anthropic-ai/claude-agent-sdk'
import { join } from 'node:path'
import type { ContextoExecucao, ExecutarAgente, Ferramenta } from './tipos.js'

/** Teto padrão de gasto por execução. Um agente em laço não vira fatura surpresa. */
const TETO_USD = Number(process.env.TETO_USD ?? '2.00')

/**
 * Onde moram as skills em arquivo do escritório (`.claude/skills`), versionadas
 * no repo. O SDK carrega `.claude/` a partir do `cwd` com settingSources 'project'.
 * As skills cadastradas no DG Brasil (tabela skills) entram no system prompt.
 */
const RAIZ_AGENTES = process.env.RAIZ_AGENTES ?? join(process.cwd(), 'agentes-claude')

/** Ferramentas nativas do SDK liberadas: só arquivo, no diretório de trabalho. */
const NATIVAS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Skill', 'TodoWrite']

export const executarComClaude: ExecutarAgente = async (ctx, ferramentas) => {
  const servidor = createSdkMcpServer({ name: 'dgbrasil', version: '2.0.0', tools: ferramentas })
  const permitidas = new Set([...NATIVAS, ...ferramentas.map((f: Ferramenta) => `mcp__dgbrasil__${f.name}`)])
  const { config } = ctx.agente

  let tokensEntrada = 0
  let tokensSaida = 0
  let custoUsd = 0

  const iterador = query({
    prompt: montarPrompt(ctx),
    options: {
      model: config.model,
      effort: config.effort,
      systemPrompt: montarSystemPrompt(ctx),

      cwd: RAIZ_AGENTES,
      additionalDirectories: [ctx.scratch],
      settingSources: ['project'],

      maxTurns: config.max_turns,
      maxBudgetUsd: config.max_budget_usd ?? TETO_USD,

      mcpServers: { dgbrasil: servidor },
      allowedTools: [...permitidas],
      disallowedTools: ['WebFetch', 'WebSearch', 'Bash', 'NotebookEdit'],

      // Ninguém está na frente de um terminal. canUseTool decide, e nega o que
      // estiver fora da allowlist. Só o NOME da ferramenta é registrado:
      // entradas e saídas podem ter CPF e não vão para agent_runs.
      permissionMode: 'default',
      canUseTool: async (nome, entrada) => {
        if (permitidas.has(nome)) {
          ctx.registro.ferramentas[nome] = (ctx.registro.ferramentas[nome] ?? 0) + 1
          return { behavior: 'allow', updatedInput: entrada }
        }
        ctx.registro.negadas.push(nome)
        return {
          behavior: 'deny',
          message: `A ferramenta "${nome}" não está liberada para o agente ${ctx.agente.slug}.`,
        }
      },
    },
  })

  for await (const msg of iterador) {
    if (msg.type !== 'result') continue
    custoUsd = msg.total_cost_usd
    tokensEntrada = msg.usage.input_tokens
    tokensSaida = msg.usage.output_tokens
    if (msg.subtype !== 'success') {
      const e = new Error(`agente terminou em "${msg.subtype}": ${msg.errors.join('; ') || 'sem detalhe'}`)
      Object.assign(e, { metricas: { tokensEntrada, tokensSaida, custoUsd, modelo: config.model } })
      throw e
    }
  }

  return { tokensEntrada, tokensSaida, custoUsd, modelo: config.model }
}

export function montarSystemPrompt(ctx: ContextoExecucao): string {
  const partes = [ctx.agente.instructions.trim()]
  for (const s of ctx.agente.skills) {
    partes.push(`\n\n## Skill: ${s.slug}\n\n${s.instructions.trim()}`)
  }
  partes.push(
    '\n\n## Regras do DG Brasil',
    '- Nada do que você fizer tem efeito sozinho. Ações passam por `propor`; minutas por `entregar_documento`.',
    '  Um advogado revisa tudo antes de qualquer efeito.',
    '- Não há ninguém para responder perguntas durante a execução. Se faltar informação para agir com',
    '  segurança, proponha (OTHER ou REQUEST_DOCUMENT) pedindo o que falta, em vez de assumir.',
    '- Os titulares dos dados são, em grande parte, idosos aposentados. CPF, benefício e endereço são',
    '  sigilosos: use-os só no documento que estiver produzindo.',
  )
  return partes.join('\n')
}

export function montarPrompt(ctx: ContextoExecucao): string {
  const entrada = (ctx.run.metadata.input ?? {}) as Record<string, unknown>
  return [
    `Execução ${ctx.run.id}, operação ${ctx.operacao}.`,
    ctx.run.legal_case_id ? `Caso: ${ctx.run.legal_case_id} (comece por ver_caso).` : 'Execução sem caso vinculado.',
    ctx.run.legal_process_id ? `Processo: ${ctx.run.legal_process_id}.` : null,
    `Diretório de trabalho: ${ctx.scratch}`,
    '',
    'Entrada:',
    '```json',
    JSON.stringify(entrada, null, 2),
    '```',
  ]
    .filter((p) => p !== null)
    .join('\n')
}
