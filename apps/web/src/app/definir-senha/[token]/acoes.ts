'use server'

import { redirect } from 'next/navigation'
import { definirSenhaPorConvite } from '@/servidor/auth'

export async function salvarSenha(_estado: unknown, form: FormData) {
  const token = String(form.get('token') ?? '')
  const senha = String(form.get('senha') ?? '')
  const repetida = String(form.get('repetida') ?? '')

  if (senha !== repetida) return { erro: 'As duas senhas não são iguais.' }

  const r = await definirSenhaPorConvite(token, senha)
  if (!r.ok) return { erro: r.erro }

  // Não fazemos login automático: quem acabou de criar a senha digita ela uma
  // vez, o que confirma que foi guardada certo — e não fica uma sessão aberta
  // por um link que pode ter passado por e-mail ou WhatsApp.
  redirect('/entrar')
}
