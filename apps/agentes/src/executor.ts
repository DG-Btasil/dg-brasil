import { query } from '@anthropic-ai/claude-agent-sdk'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ferramentasDo } from './ferramentas.js'
import { registrarPasso } from './fila.js'
import type { Agente, Execucao } from './tipos.js'

/** Teto de gasto por execução. Um agente em laço não vira fatura surpresa. */
const TETO_USD = Number(process.env.TETO_USD ?? '2.00')

/**
 * Onde moram os agentes e skills do escritório — o mesmo material de
 * `.claude/agents` e `.claude/skills` da máquina da Barbara, versionado no repo.
 * É isto que faz "subir os agentes para a nuvem" ser uma mudança de máquina,
 * e não uma reescrita: o SDK carrega `.claude/` a partir do `cwd`, desde que
 * `settingSources` inclua 'project'.
 */
const RAIZ_AGENTES = process.env.RAIZ_AGENTES ?? join(process.cwd(), 'agentes-claude')

const FERRAMENTAS_BASE = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Skill', 'TodoWrite']

export async function executar(execucao: Execucao, agente: Agente) {
  const scratch = await mkdtemp(join(tmpdir(), `dgbrasil-${agente.slug}-`))
  const servidor = ferramentasDo(execucao, agente)
  const permitidas = new Set([...FERRAMENTAS_BASE, ...ferramentasMcp(agente)])

  let ordem = 0
  let tokensEntrada = 0
  let tokensSaida = 0
  let custoUsd = 0

  try {
    const iterador = query({
      prompt: montarPrompt(execucao, scratch),
      options: {
        model: agente.modelo,
        effort: 'high',
        systemPrompt: agente.prompt_sistema,

        // cwd precisa ser a raiz que contém `.claude/`, senão as skills e os
        // agentes do escritório não são carregados. O trabalho sujo acontece
        // no scratch, liberado como diretório adicional.
        cwd: RAIZ_AGENTES,
        additionalDirectories: [scratch],
        settingSources: ['project'],

        maxTurns: 40,
        maxBudgetUsd: TETO_USD,

        mcpServers: { dgbrasil: servidor },

        allowedTools: [...permitidas],
        disallowedTools: ['WebFetch', 'WebSearch', 'Bash', 'NotebookEdit'],

        // Ninguém está na frente do terminal para responder a um prompt de
        // permissão. `canUseTool` é quem decide, e ele nega por padrão:
        // ferramenta fora da allowlist do agente não roda, ponto.
        permissionMode: 'default',
        canUseTool: async (nomeFerramenta, entrada) => {
          const liberada = permitidas.has(nomeFerramenta)
          await registrarPasso(execucao.id, ordem++, liberada ? 'ferramenta' : 'erro', {
            ferramenta: nomeFerramenta,
            entrada,
            saida: liberada ? null : { negada: 'fora da allowlist do agente' },
          })
          return liberada
            ? { behavior: 'allow', updatedInput: entrada }
            : {
                behavior: 'deny',
                message: `A ferramenta "${nomeFerramenta}" não está liberada para o agente ${agente.slug}.`,
              }
        },
      },
    })

    for await (const msg of iterador) {
      if (msg.type === 'assistant') {
        for (const bloco of msg.message.content) {
          if (bloco.type === 'text' && bloco.text.trim()) {
            await registrarPasso(execucao.id, ordem++, 'texto', { saida: bloco.text })
          } else if (bloco.type === 'tool_use') {
            await registrarPasso(execucao.id, ordem++, 'ferramenta', {
              ferramenta: bloco.name,
              entrada: bloco.input,
            })
          }
        }
      } else if (msg.type === 'result') {
        // Mensagem final da execução: é aqui que vêm custo e uso reais.
        custoUsd = msg.total_cost_usd
        tokensEntrada = msg.usage.input_tokens
        tokensSaida = msg.usage.output_tokens

        if (msg.subtype !== 'success') {
          await registrarPasso(execucao.id, ordem++, 'erro', {
            saida: { subtype: msg.subtype, erros: msg.errors },
          })
          throw new Error(
            `agente terminou em "${msg.subtype}": ${msg.errors.join('; ') || 'sem detalhe'}`,
          )
        }

        await registrarPasso(execucao.id, ordem++, 'texto', { saida: msg.result })
      }
    }

    return { tokensEntrada, tokensSaida, custoUsd }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

/** As ferramentas do servidor MCP chegam ao agente com prefixo. */
function ferramentasMcp(agente: Agente): string[] {
  const base = agente.ferramentas.length
    ? [...new Set([...agente.ferramentas, 'propor'])]
    : [
        'buscar_contato',
        'ver_caso',
        'contratos_do_extrato',
        'publicacoes_pendentes',
        'conversa_recente',
        'propor',
      ]
  return base.map((n) => `mcp__dgbrasil__${n}`)
}

function montarPrompt(execucao: Execucao, scratch: string): string {
  return [
    `Execução ${execucao.id}, disparada por: ${execucao.gatilho}.`,
    execucao.caso_id ? `Caso em questão: ${execucao.caso_id}` : null,
    `Diretório de trabalho para arquivos temporários: ${scratch}`,
    '',
    'Entrada:',
    '```json',
    JSON.stringify(execucao.entrada, null, 2),
    '```',
    '',
    'Lembre: nada que você fizer tem efeito até passar por `propor` e ser aprovado por um advogado.',
    'Se faltar informação para agir com segurança, proponha uma tarefa pedindo o que falta',
    'em vez de assumir. Aqui os titulares dos dados são idosos — um erro não é só um bug.',
  ]
    .filter((p) => p !== null)
    .join('\n')
}
