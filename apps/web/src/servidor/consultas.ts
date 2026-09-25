import 'server-only'
import { banco } from './banco'

export interface PrazoLinha {
  id: string
  tipo: string
  descricao: string | null
  data_fatal: string
  dias_restantes: number
  numero_cnj: string | null
  cliente: string
  contato_id: string
  responsavel: string | null
  fonte: string
}

export interface TarefaLinha {
  id: string
  titulo: string
  prazo_em: string | null
  prioridade: string
  status: string
  cliente: string | null
  contato_id: string | null
  responsavel: string | null
}

export interface PropostaLinha {
  id: string
  tipo: string
  resumo: string
  payload: Record<string, unknown>
  criado_em: string
  agente_slug: string
  agente_nome: string
  execucao_id: string
  custo_usd: string | null
  cliente: string | null
  contato_id: string | null
}

/** Prazos abertos, do mais urgente ao menos. Vencidos aparecem com número negativo. */
export async function prazosAbertos(limite = 30): Promise<PrazoLinha[]> {
  const db = await banco()
  return db.consulta<PrazoLinha>(
    `select z.id, z.tipo, z.descricao, z.data_fatal::text,
            (z.data_fatal - current_date) as dias_restantes,
            p.numero_cnj, c.nome as cliente, c.id as contato_id,
            u.nome as responsavel, z.fonte
     from prazo z
     join processo p on p.id = z.processo_id
     join caso k on k.id = p.caso_id
     join contato c on c.id = k.contato_id
     left join usuario u on u.id = z.responsavel_id
     where z.status = 'aberto'
     order by z.data_fatal
     limit $1`,
    [limite],
  )
}

export async function tarefasAbertas(limite = 30): Promise<TarefaLinha[]> {
  const db = await banco()
  return db.consulta<TarefaLinha>(
    `select t.id, t.titulo, t.prazo_em::text, t.prioridade, t.status,
            c.nome as cliente, c.id as contato_id, u.nome as responsavel
     from tarefa t
     left join caso k on k.id = t.caso_id
     left join contato c on c.id = k.contato_id
     left join usuario u on u.id = t.responsavel_id
     where t.status in ('aberta','fazendo')
     order by t.prazo_em nulls last, t.prioridade desc
     limit $1`,
    [limite],
  )
}

/** A fila que dá sentido ao sistema: o que os agentes propuseram e espera humano. */
export async function propostasPendentes(limite = 50): Promise<PropostaLinha[]> {
  const db = await banco()
  return db.consulta<PropostaLinha>(
    `select pr.id, pr.tipo, pr.resumo, pr.payload, pr.criado_em::text,
            a.slug as agente_slug, a.nome as agente_nome,
            e.id as execucao_id, e.custo_usd::text,
            c.nome as cliente, c.id as contato_id
     from proposta pr
     join execucao e on e.id = pr.execucao_id
     join agente a on a.id = e.agente_id
     left join caso k on k.id = e.caso_id
     left join contato c on c.id = k.contato_id
     where pr.status = 'pendente'
     order by pr.criado_em
     limit $1`,
    [limite],
  )
}

export async function contarPropostasPendentes(): Promise<number> {
  const db = await banco()
  const r = await db.um<{ n: string }>(
    `select count(*)::text as n from proposta where status = 'pendente'`,
  )
  return Number(r?.n ?? 0)
}

/** O rastro que torna a proposta auditável: o que o agente fez até chegar nela. */
export async function passosDaExecucao(execucaoId: string) {
  const db = await banco()
  return db.consulta<{
    ordem: number
    tipo: string
    ferramenta: string | null
    saida: unknown
  }>(
    `select ordem, tipo, ferramenta, saida from passo_execucao
     where execucao_id = $1 order by ordem`,
    [execucaoId],
  )
}

export async function buscarContatos(termo: string, limite = 50) {
  const db = await banco()
  const digitos = termo.replace(/\D/g, '')
  return db.consulta<{
    id: string
    nome: string
    cpf_cnpj: string | null
    telefone: string | null
    is_cliente: boolean | null
    casos: string
  }>(
    `select c.id, c.nome, c.cpf_cnpj, c.telefone, c.is_cliente,
            (select count(*) from caso k where k.contato_id = c.id)::text as casos
     from contato c
     where $1 = ''
        or c.nome ilike '%' || $1 || '%'
        or ($2 <> '' and c.cpf_cnpj like $2 || '%')
     order by c.nome
     limit $3`,
    [termo.trim(), digitos, limite],
  )
}

/** Visão 360 do cliente: tudo que a equipe precisa numa tela só. */
export async function fichaDoContato(id: string) {
  const db = await banco()

  const contato = await db.um<{
    id: string
    nome: string
    cpf_cnpj: string | null
    nascimento: string | null
    telefone: string | null
    email: string | null
    origem: string | null
    is_cliente: boolean | null
  }>(
    `select id, nome, cpf_cnpj, nascimento::text, telefone, email, origem, is_cliente
     from contato where id = $1`,
    [id],
  )
  if (!contato) return null

  const [beneficios, casos, prazos, documentos, financeiro] = await Promise.all([
    db.consulta<{
      numero_beneficio: string
      especie: string | null
      dib: string | null
      valor_mensal: string | null
      banco_pagador: string | null
    }>(
      `select numero_beneficio, especie, dib::text, valor_mensal::text, banco_pagador
       from beneficio where contato_id = $1 order by dib`,
      [id],
    ),
    db.consulta<{
      id: string
      titulo: string
      status: string
      valor_causa: string | null
      responsavel: string | null
      numero_cnj: string | null
      tribunal: string | null
      vara: string | null
    }>(
      `select k.id, k.titulo, k.status, k.valor_causa::text, u.nome as responsavel,
              p.numero_cnj, p.tribunal, p.vara
       from caso k
       left join usuario u on u.id = k.responsavel_id
       left join processo p on p.caso_id = k.id
       where k.contato_id = $1
       order by k.aberto_em desc`,
      [id],
    ),
    db.consulta<{ tipo: string; data_fatal: string; dias_restantes: number }>(
      `select z.tipo, z.data_fatal::text, (z.data_fatal - current_date) as dias_restantes
       from prazo z
       join processo p on p.id = z.processo_id
       join caso k on k.id = p.caso_id
       where k.contato_id = $1 and z.status = 'aberto'
       order by z.data_fatal`,
      [id],
    ),
    db.consulta<{ tipo: string; nome: string; assinado: boolean; criado_em: string }>(
      `select tipo, nome, assinado, criado_em::text
       from documento where contato_id = $1 or caso_id in (select id from caso where contato_id = $1)
       order by criado_em desc`,
      [id],
    ),
    db.consulta<{
      tipo: string
      descricao: string
      valor: string
      vencimento: string | null
      pago_em: string | null
    }>(
      `select tipo, descricao, valor::text, vencimento::text, pago_em::text
       from lancamento where contato_id = $1 order by vencimento desc nulls last`,
      [id],
    ),
  ])

  return { contato, beneficios, casos, prazos, documentos, financeiro }
}
