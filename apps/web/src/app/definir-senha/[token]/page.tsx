import { conviteValido } from '@/servidor/auth'
import { FormularioSenha } from './FormularioSenha'

export const dynamic = 'force-dynamic'

export default async function DefinirSenha({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const convite = await conviteValido(token)

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">DG Brasil</h1>
          <p className="mt-1 text-sm text-suave">Barbara Cardoso Advocacia</p>
        </div>

        {!convite ? (
          <div className="rounded-lg border border-borda bg-superficie px-4 py-5 text-center">
            <p className="text-sm">Este link não vale mais.</p>
            <p className="mt-2 text-xs text-suave">
              Links de convite duram 72 horas e servem uma vez só. Peça outro a quem
              administra o sistema.
            </p>
          </div>
        ) : (
          <>
            <p className="mb-4 text-center text-sm text-suave">
              Olá, <strong className="text-texto">{convite.nome.split(' ')[0]}</strong>.
              Escolha uma senha para <span className="tabular">{convite.email}</span>.
            </p>
            <FormularioSenha token={token} />
          </>
        )}
      </div>
    </div>
  )
}
