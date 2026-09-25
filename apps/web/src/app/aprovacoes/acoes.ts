'use server'

import { revalidatePath } from 'next/cache'
import { banco } from '@/servidor/banco'
import { usuarioAtual } from '@/servidor/sessao'

/**
 * Aprovar NÃO aplica o efeito aqui.
 *
 * A proposta só muda de 'pendente' para 'aprovada'; quem a transforma em fato é
 * o worker, em `apps/agentes/src/aplicar.ts`, dentro de uma transação. O painel
 * jamais escreve na tabela de destino.
 *
 * Isso mantém um único lugar no sistema capaz de aplicar proposta — o que, além
 * de mais simples de auditar, evita que uma aba aberta no navegador consiga
 * abrir prazo ou lançar honorário por um caminho paralelo.
 */
export async function aprovar(id: string) {
  const [db, usuario] = await Promise.all([banco(), usuarioAtual()])

  if (usuario.papel !== 'admin' && usuario.papel !== 'advogado') {
    throw new Error('Só advogado ou administrador aprova proposta de agente.')
  }

  await db.consulta(
    `update proposta
     set status = 'aprovada', revisado_por = $2, revisado_em = now()
     where id = $1 and status = 'pendente'`,
    [id, usuario.id],
  )
  revalidatePath('/aprovacoes')
  revalidatePath('/')
}

export async function rejeitar(id: string, comentario: string) {
  const [db, usuario] = await Promise.all([banco(), usuarioAtual()])

  if (usuario.papel !== 'admin' && usuario.papel !== 'advogado') {
    throw new Error('Só advogado ou administrador rejeita proposta de agente.')
  }
  // O motivo não é burocracia: é o material para corrigir o prompt do agente.
  if (!comentario.trim()) {
    throw new Error('Diga por que está rejeitando — é o que ensina o agente.')
  }

  await db.consulta(
    `update proposta
     set status = 'rejeitada', revisado_por = $2, revisado_em = now(), comentario = $3
     where id = $1 and status = 'pendente'`,
    [id, usuario.id, comentario.trim()],
  )
  revalidatePath('/aprovacoes')
  revalidatePath('/')
}
