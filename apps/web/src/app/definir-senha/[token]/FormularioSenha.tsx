'use client'

import { useActionState } from 'react'
import { salvarSenha } from './acoes'

export function FormularioSenha({ token }: { token: string }) {
  const [estado, acao, pendente] = useActionState(salvarSenha, { erro: '' })

  return (
    <form action={acao} className="space-y-3">
      <input type="hidden" name="token" value={token} />

      <div>
        <label htmlFor="senha" className="mb-1 block text-xs text-suave">
          Nova senha
        </label>
        <input
          id="senha"
          name="senha"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          autoFocus
          className="w-full rounded-md border border-borda bg-superficie px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-suave">
          Pelo menos 10 caracteres. Uma frase que só você saiba funciona melhor que
          uma palavra com símbolos.
        </p>
      </div>

      <div>
        <label htmlFor="repetida" className="mb-1 block text-xs text-suave">
          Repita a senha
        </label>
        <input
          id="repetida"
          name="repetida"
          type="password"
          required
          autoComplete="new-password"
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
        {pendente ? 'Salvando…' : 'Salvar senha'}
      </button>
    </form>
  )
}
