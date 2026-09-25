import 'server-only'
import { banco } from './banco'

export type Papel = 'admin' | 'advogado' | 'estagiario' | 'financeiro' | 'atendimento'

export interface Usuario {
  id: string
  nome: string
  email: string
  papel: Papel
}

/**
 * Quem está usando o painel.
 *
 * Em demonstração, é a administradora do seed — não há login, e o rodapé de
 * cada tela diz isso em voz alta.
 *
 * Em produção, isto passa a ler a sessão do Supabase Auth e casar o `auth_id`
 * com a linha em `usuario`. Enquanto essa ligação não existir, o painel se
 * RECUSA a rodar contra banco real: um sistema com dados de cliente e sem
 * login não é um estado intermediário aceitável, é um vazamento esperando
 * acontecer.
 */
export async function usuarioAtual(): Promise<Usuario> {
  const db = await banco()

  if (!db.demonstracao) {
    throw new Error(
      'Autenticação não configurada. O painel só roda contra banco real depois ' +
        'que o Supabase Auth estiver ligado em src/servidor/sessao.ts.',
    )
  }

  const u = await db.um<Usuario>(
    `select id, nome, email, papel from usuario where papel = 'admin' limit 1`,
  )
  if (!u) throw new Error('nenhum usuário no banco de demonstração')
  return u
}
