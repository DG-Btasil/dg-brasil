'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { COOKIE, entrar, sair } from '@/servidor/auth'

const MOTIVOS: Record<string, string> = {
  credencial: 'E-mail ou senha incorretos.',
  bloqueado:
    'Muitas tentativas. Espere 15 minutos ou peça ao administrador para liberar.',
  inativo: 'Esta conta está desativada. Fale com o administrador.',
  sem_senha:
    'Esta conta ainda não tem senha. Peça ao administrador o link para defini-la.',
}

export async function entrarNoSistema(_estado: unknown, form: FormData) {
  const email = String(form.get('email') ?? '')
  const senha = String(form.get('senha') ?? '')

  if (!email || !senha) return { erro: 'Preencha e-mail e senha.' }

  const cabecalhos = await headers()
  const r = await entrar(email, senha, {
    // Atrás da Vercel/Fly o IP real vem no x-forwarded-for.
    ip: cabecalhos.get('x-forwarded-for')?.split(',')[0]?.trim(),
    agente: cabecalhos.get('user-agent') ?? undefined,
  })

  if (!r.ok) {
    // Uma mensagem só para e-mail inexistente e senha errada: dizer "este
    // e-mail não existe" entrega a lista de quem trabalha aqui.
    return { erro: MOTIVOS[r.motivo] ?? 'Não foi possível entrar.' }
  }

  const jar = await cookies()
  jar.set(COOKIE, r.token, {
    httpOnly: true, // JavaScript da página não lê — protege contra XSS
    sameSite: 'lax', // não viaja em requisição de outro site
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: r.expiraEm,
  })

  redirect('/')
}

export async function sairDoSistema() {
  const jar = await cookies()
  const token = jar.get(COOKIE)?.value
  if (token) await sair(token)
  jar.delete(COOKIE)
  redirect('/entrar')
}
