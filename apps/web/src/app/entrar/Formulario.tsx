'use client'

import { useActionState } from 'react'
import { entrarNoSistema } from './acoes'

export function Formulario() {
  const [estado, acao, pendente] = useActionState(entrarNoSistema, { erro: '' })

  return (
    <form action={acao} className="space-y-3">
      <div>
        <label htmlFor="email" className="mb-1 block text-xs text-suave">
          E-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          autoFocus
          className="w-full rounded-md border border-borda bg-superficie px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label htmlFor="senha" className="mb-1 block text-xs text-suave">
          Senha
        </label>
        <input
          id="senha"
          name="senha"
          type="password"
          required
          autoComplete="current-password"
          className="w-full rounded-md border border-borda bg-superficie px-3 py-2 text-sm"
        />
      </div>

      {estado?.erro && (
        <p role="alert" className="text-xs text-urgente">
          {estado.erro}
        </p>
      )}

      <button
        type="submit"
        disabled={pendente}
        className="w-full rounded-md bg-realce px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pendente ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  )
}
