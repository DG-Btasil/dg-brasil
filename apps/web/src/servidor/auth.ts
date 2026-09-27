import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { banco } from './banco'
import { conferirSenha, criticarSenha, hashSenha } from './senha'

export { conferirSenha, criticarSenha, hashSenha } from './senha'

/**
 * Senhas, sessões e convites.
 *
 * Nada aqui inventa criptografia: scrypt para senha (função de derivação
 * própria para isso, no Node desde sempre), 256 bits de aleatoriedade para
 * token, SHA-256 para guardar o token no banco.
 *
 * O que guardamos no banco NUNCA serve para se passar por alguém: a senha vira
 * hash scrypt com sal, e o token de sessão vira SHA-256. Quem obtiver uma cópia
 * do banco não entra no sistema com ela.
 *
 * Trocar para Supabase Auth, se um dia fizer sentido, é reescrever uma função:
 * `verificarCredencial`. Sessão, cookie e RLS continuam como estão.
 */

const DIAS_DE_SESSAO = 14
const FALHAS_ATE_BLOQUEIO = 5
const MINUTOS_DE_BLOQUEIO = 15
const HORAS_DE_CONVITE = 72

export const COOKIE = 'dgb_sessao'

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function novoToken(): string {
  return randomBytes(32).toString('base64url')
}

// ── login ──────────────────────────────────────────────────────────

export type ResultadoLogin =
  | { ok: true; token: string; expiraEm: Date }
  | { ok: false; motivo: 'credencial' | 'bloqueado' | 'inativo' | 'sem_senha' }

/**
 * O ponto de troca, se um dia migrarmos para Supabase Auth: só esta função
 * precisa mudar.
 */
async function verificarCredencial(email: string, senha: string) {
  const db = await banco()
  const u = await db.um<{
    id: string
    ativo: boolean
    senha_hash: string | null
  }>(`select id, ativo, senha_hash from usuario where email = lower($1)`, [email])

  if (!u) {
    // Gasta o mesmo tempo de um hash real. Sem isso, dá para descobrir quais
    // e-mails existem só cronometrando a resposta.
    conferirSenha(senha, hashSenha('descarte'))
    return { estado: 'credencial' as const }
  }
  if (!u.ativo) return { estado: 'inativo' as const }
  if (!u.senha_hash) return { estado: 'sem_senha' as const }
  if (!conferirSenha(senha, u.senha_hash)) return { estado: 'credencial' as const }
  return { estado: 'ok' as const, id: u.id }
}

export async function entrar(
  email: string,
  senha: string,
  contexto: { ip?: string; agente?: string } = {},
): Promise<ResultadoLogin> {
  const db = await banco()
  const normalizado = email.trim().toLowerCase()

  const bloqueio = await db.um<{ falhas_recentes: number }>(
    `select falhas_recentes($1, $2)`,
    [normalizado, MINUTOS_DE_BLOQUEIO],
  )
  if ((bloqueio?.falhas_recentes ?? 0) >= FALHAS_ATE_BLOQUEIO) {
    return { ok: false, motivo: 'bloqueado' }
  }

  const r = await verificarCredencial(normalizado, senha)

  await db.consulta(
    `insert into tentativa_login (email, ip, sucesso) values ($1, $2, $3)`,
    [normalizado, contexto.ip ?? null, r.estado === 'ok'],
  )

  if (r.estado !== 'ok') return { ok: false, motivo: r.estado }

  const token = novoToken()
  const expiraEm = new Date(Date.now() + DIAS_DE_SESSAO * 864e5)
  await db.consulta(
    `insert into sessao (usuario_id, token_hash, expira_em, ip, agente_usuario)
     values ($1, $2, $3, $4, $5)`,
    [r.id, hashToken(token), expiraEm, contexto.ip ?? null, contexto.agente ?? null],
  )
  await db.consulta(`update usuario set ultimo_acesso = now() where id = $1`, [r.id])

  return { ok: true, token, expiraEm }
}

export async function sair(token: string) {
  const db = await banco()
  await db.consulta(
    `update sessao set encerrada_em = now()
     where token_hash = $1 and encerrada_em is null`,
    [hashToken(token)],
  )
}

export interface UsuarioSessao {
  id: string
  nome: string
  email: string
  papel: 'admin' | 'advogado' | 'estagiario' | 'financeiro' | 'atendimento'
}

export async function usuarioDoToken(token: string): Promise<UsuarioSessao | null> {
  const db = await banco()
  const u = await db.um<UsuarioSessao>(
    `select u.id, u.nome, u.email, u.papel
     from sessao s join usuario u on u.id = s.usuario_id
     where s.token_hash = $1
       and s.encerrada_em is null
       and s.expira_em > now()
       and u.ativo`,
    [hashToken(token)],
  )
  if (u) {
    await db.consulta(
      `update sessao set ultimo_uso_em = now() where token_hash = $1`,
      [hashToken(token)],
    )
  }
  return u
}

// ── convites ───────────────────────────────────────────────────────

/**
 * O admin nunca digita a senha de outra pessoa: cadastra e entrega um link de
 * uso único. Quem define a senha é o dono da conta.
 */
export async function criarConvite(usuarioId: string, criadoPor: string): Promise<string> {
  const db = await banco()
  const token = novoToken()
  // Convite anterior em aberto deixa de valer: um link vivo por pessoa.
  await db.consulta(
    `update convite set usado_em = now()
     where usuario_id = $1 and usado_em is null`,
    [usuarioId],
  )
  await db.consulta(
    `insert into convite (usuario_id, token_hash, criado_por, expira_em)
     values ($1, $2, $3, now() + make_interval(hours => $4))`,
    [usuarioId, hashToken(token), criadoPor, HORAS_DE_CONVITE],
  )
  return token
}

export async function conviteValido(token: string) {
  const db = await banco()
  return db.um<{ usuario_id: string; nome: string; email: string }>(
    `select c.usuario_id, u.nome, u.email
     from convite c join usuario u on u.id = c.usuario_id
     where c.token_hash = $1 and c.usado_em is null and c.expira_em > now() and u.ativo`,
    [hashToken(token)],
  )
}

export type ResultadoSenha = { ok: true } | { ok: false; erro: string }

export async function definirSenhaPorConvite(
  token: string,
  senha: string,
): Promise<ResultadoSenha> {
  const problema = criticarSenha(senha)
  if (problema) return { ok: false, erro: problema }

  const db = await banco()
  const c = await conviteValido(token)
  if (!c) return { ok: false, erro: 'Este link não vale mais. Peça outro ao administrador.' }

  await db.consulta(
    `update usuario set senha_hash = $2, senha_definida_em = now() where id = $1`,
    [c.usuario_id, hashSenha(senha)],
  )
  await db.consulta(`update convite set usado_em = now() where token_hash = $1`, [
    hashToken(token),
  ])
  // Trocar de senha derruba as sessões antigas — é o que se espera de uma
  // troca feita porque a senha pode ter vazado.
  await db.consulta(
    `update sessao set encerrada_em = now()
     where usuario_id = $1 and encerrada_em is null`,
    [c.usuario_id],
  )
  return { ok: true }
}
