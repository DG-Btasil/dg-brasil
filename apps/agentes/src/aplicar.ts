import { pool } from './db.js'
import type { TipoProposta } from './tipos.js'

/**
 * O outro lado do gate: uma proposta aprovada no painel vira fato aqui.
 *
 * Duas garantias:
 *  1. A transição pendente→aprovada→aplicada acontece numa transação, com a
 *     linha travada (`for update skip locked`). Dois workers não aplicam a mesma.
 *  2. Um aplicador que falha marca a proposta como 'falhou' com o erro visível
 *     no painel. Nada fica silenciosamente sem efeito.
 */
export async function aplicarAprovadas(limite = 10): Promise<number> {
  let aplicadas = 0

  for (let i = 0; i < limite; i++) {
    const cliente = await pool.connect()
    try {
      await cliente.query('begin')

      const { rows } = await cliente.query(
        `select p.*, e.solicitado_por
         from proposta p join execucao e on e.id = p.execucao_id
         where p.status = 'aprovada'
         order by p.revisado_em nulls first, p.criado_em
         for update of p skip locked
         limit 1`,
      )
      const proposta = rows[0]
      if (!proposta) {
        await cliente.query('rollback')
        break
      }

      try {
        const alvo = await aplicadores[proposta.tipo as TipoProposta](
          cliente,
          proposta.payload,
          proposta,
        )
        await cliente.query(
          `update proposta set status = 'aplicada', aplicado_em = now(),
                  alvo_tabela = coalesce($2, alvo_tabela), alvo_id = coalesce($3, alvo_id)
           where id = $1`,
          [proposta.id, alvo?.tabela ?? null, alvo?.id ?? null],
        )
        await cliente.query(
          `insert into evento_auditoria (execucao_id, acao, tabela, registro_id, depois)
           values ($1, 'aplicar_proposta', $2, $3, $4)`,
          [proposta.execucao_id, alvo?.tabela ?? 'proposta', alvo?.id ?? proposta.id, proposta.payload],
        )
        await cliente.query('commit')
        aplicadas++
      } catch (erro) {
        await cliente.query('rollback')
        // Fora da transação revertida, para que o erro sobreviva.
        await pool.query(
          `update proposta set status = 'falhou', erro_aplicacao = $2 where id = $1`,
          [proposta.id, erro instanceof Error ? erro.message : String(erro)],
        )
      }
    } finally {
      cliente.release()
    }
  }

  return aplicadas
}

type Alvo = { tabela: string; id: string } | null
type Aplicador = (
  cliente: import('pg').PoolClient,
  payload: Record<string, unknown>,
  proposta: Record<string, unknown>,
) => Promise<Alvo>

const aplicadores: Record<TipoProposta, Aplicador> = {
  abrir_prazo: async (c, p) => {
    const { rows } = await c.query(
      `insert into prazo (processo_id, publicacao_id, tipo, descricao, data_inicio,
                          dias, dias_uteis, data_fatal, responsavel_id, fonte)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'agente') returning id`,
      [
        p.processo_id, p.publicacao_id ?? null, p.tipo, p.descricao ?? null,
        p.data_inicio, p.dias, p.dias_uteis ?? true, p.data_fatal,
        p.responsavel_id ?? null,
      ],
    )
    return { tabela: 'prazo', id: rows[0].id }
  },

  criar_tarefa: async (c, p) => {
    const { rows } = await c.query(
      `insert into tarefa (caso_id, processo_id, titulo, descricao, responsavel_id,
                           prazo_em, prioridade)
       values ($1,$2,$3,$4,$5,$6,coalesce($7,'normal')) returning id`,
      [
        p.caso_id ?? null, p.processo_id ?? null, p.titulo, p.descricao ?? null,
        p.responsavel_id ?? null, p.prazo_em ?? null, p.prioridade ?? null,
      ],
    )
    return { tabela: 'tarefa', id: rows[0].id }
  },

  criar_documento: async (c, p, proposta) => {
    // O arquivo já foi escrito no Storage pelo agente; aqui ele entra no acervo.
    const { rows } = await c.query(
      `insert into documento (caso_id, contato_id, processo_id, tipo, nome,
                              caminho_storage, mime, tamanho, hash_sha256,
                              gerado_por_execucao)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [
        p.caso_id ?? null, p.contato_id ?? null, p.processo_id ?? null,
        p.tipo, p.nome, p.caminho_storage, p.mime ?? null, p.tamanho ?? null,
        p.hash_sha256 ?? null, proposta.execucao_id,
      ],
    )
    return { tabela: 'documento', id: rows[0].id }
  },

  atualizar_caso: async (c, p) => {
    await c.query(
      `update caso set status = coalesce($2, status),
                       responsavel_id = coalesce($3, responsavel_id),
                       valor_causa = coalesce($4, valor_causa),
                       atualizado_em = now()
       where id = $1`,
      [p.caso_id, p.status ?? null, p.responsavel_id ?? null, p.valor_causa ?? null],
    )
    return { tabela: 'caso', id: String(p.caso_id) }
  },

  classificar_lead: async (c, p) => {
    await c.query(
      `update contato set is_cliente = $2, origem = coalesce($3, origem),
                          atualizado_em = now()
       where id = $1`,
      [p.contato_id, p.is_cliente ?? null, p.origem ?? null],
    )
    if (p.etapa_funil_id) {
      await c.query(
        `insert into contato_etapa (contato_id, etapa_funil_id)
         values ($1,$2) on conflict do nothing`,
        [p.contato_id, p.etapa_funil_id],
      )
    }
    return { tabela: 'contato', id: String(p.contato_id) }
  },

  lancar_honorario: async (c, p) => {
    const { rows } = await c.query(
      `insert into lancamento (tipo, categoria, contato_id, caso_id, processo_id,
                               descricao, valor, vencimento)
       values ('receita', coalesce($1,'honorario'), $2,$3,$4,$5,$6,$7) returning id`,
      [
        p.categoria ?? null, p.contato_id ?? null, p.caso_id ?? null,
        p.processo_id ?? null, p.descricao, p.valor, p.vencimento ?? null,
      ],
    )
    return { tabela: 'lancamento', id: rows[0].id }
  },

  registrar_esteira: async (c, p) => {
    const acoes = (p.acoes ?? []) as Record<string, unknown>[]
    for (const a of acoes) {
      await c.query(
        `insert into acao_esteira (caso_id, extrato_id, bloco, rotulo, banco_nome,
                                   ano, contratos, motivo_descarte, pendencia, motor_versao)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          p.caso_id, p.extrato_id, a.bloco ?? null, a.rotulo, a.banco_nome ?? null,
          a.ano ?? null, a.contratos ?? [], a.motivo_descarte ?? null,
          a.pendencia ?? null, p.motor_versao,
        ],
      )
    }
    return { tabela: 'acao_esteira', id: String(p.caso_id) }
  },

  enviar_mensagem: async () => {
    // Fase 4. Falha alto de propósito: melhor uma proposta marcada como 'falhou'
    // e visível no painel do que uma mensagem que o escritório acha que enviou.
    throw new Error('ponte de WhatsApp ainda não integrada (fase 4 do roadmap)')
  },
}
