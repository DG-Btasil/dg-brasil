'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { banco } from '@/servidor/banco'
import { criarConvite } from '@/servidor/auth'
import { exigirUsuario, type Papel } from '@/servidor/sessao'

const PAPEIS: Papel[] = ['admin', 'advogado', 'estagiario', 'financeiro', 'atendimento']

async function exigirAdmin() {
  const u = await exigirUsuario()
  if (u.papel !== 'admin') throw new Error('Só a administração mexe na equipe.')
  return u
}

/** Monta o link de convite a partir do host da requisição. */
async function enderecoBase(): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const protocolo = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${protocolo}://${host}`
}

export async function cadastrarPessoa(_estado: unknown, form: FormData) {
  const admin = await exigirAdmin()
  const db = await banco()

  const nome = String(form.get('nome') ?? '').trim()
  const email = String(form.get('email') ?? '').trim().toLowerCase()
  const papel = String(form.get('papel') ?? '') as Papel
  const oab = String(form.get('oab') ?? '').trim() || null

  if (nome.length < 3) return { erro: 'Escreva o nome completo.' }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { erro: 'E-mail inválido.' }
  if (!PAPEIS.includes(papel)) return { erro: 'Escolha um papel.' }

  const existe = await db.um(`select id from usuario where email = $1`, [email])
  if (existe) return { erro: 'Já existe alguém com esse e-mail.' }

  const novo = await db.um<{ id: string }>(
    `insert into usuario (nome, email, papel, oab) values ($1,$2,$3,$4) returning id`,
    [nome, email, papel, oab],
  )
  const token = await criarConvite(novo!.id, admin.id)

  await db.consulta(
    `insert into evento_auditoria (usuario_id, acao, tabela, registro_id, depois)
     values ($1, 'insert', 'usuario', $2, $3)`,
    [admin.id, novo!.id, JSON.stringify({ nome, email, papel })],
  )

  revalidatePath('/equipe')
  // O link volta na resposta em vez de ir por e-mail: não há SMTP configurado,
  // e entregar na mão (ou pelo WhatsApp do escritório) é mais direto para cinco
  // pessoas. Some da tela assim que a página recarrega.
  return {
    erro: '',
    convite: { nome, link: `${await enderecoBase()}/definir-senha/${token}` },
  }
}

export async function reenviarConvite(_estado: unknown, form: FormData) {
  const admin = await exigirAdmin()
  const db = await banco()
  const usuarioId = String(form.get('usuario_id') ?? '')

  const pessoa = await db.um<{ nome: string }>(`select nome from usuario where id = $1`, [
    usuarioId,
  ])
  if (!pessoa) return { erro: 'Pessoa não encontrada.' }

  const token = await criarConvite(usuarioId, admin.id)
  revalidatePath('/equipe')
  return {
    erro: '',
    convite: { nome: pessoa.nome, link: `${await enderecoBase()}/definir-senha/${token}` },
  }
}

export async function alternarAtivo(usuarioId: string) {
  const admin = await exigirAdmin()
  const db = await banco()

  if (usuarioId === admin.id) {
    throw new Error('Você não pode desativar a própria conta.')
  }

  const r = await db.um<{ ativo: boolean }>(
    `update usuario set ativo = not ativo where id = $1 returning ativo`,
    [usuarioId],
  )

  // Desativar precisa derrubar as sessões abertas — senão a pessoa continua
  // dentro do sistema até o cookie vencer, que é o oposto do pretendido.
  if (r && !r.ativo) {
    await db.consulta(
      `update sessao set encerrada_em = now()
       where usuario_id = $1 and encerrada_em is null`,
      [usuarioId],
    )
  }

  await db.consulta(
    `insert into evento_auditoria (usuario_id, acao, tabela, registro_id, depois)
     values ($1, 'update', 'usuario', $2, $3)`,
    [admin.id, usuarioId, JSON.stringify({ ativo: r?.ativo })],
  )

  revalidatePath('/equipe')
}

export async function mudarPapel(usuarioId: string, papel: Papel) {
  const admin = await exigirAdmin()
  if (!PAPEIS.includes(papel)) throw new Error('Papel inválido.')
  if (usuarioId === admin.id) {
    throw new Error('Você não pode mudar o próprio papel — peça a outro administrador.')
  }

  const db = await banco()
  await db.consulta(`update usuario set papel = $2 where id = $1`, [usuarioId, papel])
  await db.consulta(
    `insert into evento_auditoria (usuario_id, acao, tabela, registro_id, depois)
     values ($1, 'update', 'usuario', $2, $3)`,
    [admin.id, usuarioId, JSON.stringify({ papel })],
  )
  revalidatePath('/equipe')
}
