import 'server-only'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { banco, type Escopo } from './banco'
import { COOKIE, usuarioDoToken, type UsuarioSessao } from './auth'

export type { UsuarioSessao as Usuario }
export type Papel = UsuarioSessao['papel']

/** Quem está logado, ou null. Não redireciona — serve para a tela de login. */
export async function usuarioAtual(): Promise<UsuarioSessao | null> {
  const token = (await cookies()).get(COOKIE)?.value
  if (!token) return null
  return usuarioDoToken(token)
}

/** Quem está logado. Sem sessão, manda para o login. */
export async function exigirUsuario(): Promise<UsuarioSessao> {
  const u = await usuarioAtual()
  if (!u) redirect('/entrar')
  return u
}

/**
 * O jeito certo de ler dados nas telas.
 *
 * Entrega um escopo já dentro de uma transação, com o papel `painel` e a
 * identidade do usuário declarada — ou seja, com a RLS valendo. Consulta feita
 * por fora disto enxerga o banco inteiro; consulta feita aqui enxerga o que
 * aquela pessoa tem direito de ver.
 */
export async function comoUsuarioLogado<T>(
  fn: (db: Escopo, usuario: UsuarioSessao) => Promise<T>,
): Promise<T> {
  const usuario = await exigirUsuario()
  const db = await banco()
  return db.comoUsuario(usuario.id, (escopo) => fn(escopo, usuario))
}

export function ehAdmin(u: UsuarioSessao): boolean {
  return u.papel === 'admin'
}

export function podeAprovar(u: UsuarioSessao): boolean {
  return u.papel === 'admin' || u.papel === 'advogado'
}

export const ROTULO_PAPEL: Record<Papel, string> = {
  admin: 'Administração',
  advogado: 'Advogado',
  estagiario: 'Estagiário',
  financeiro: 'Financeiro',
  atendimento: 'Atendimento',
}
