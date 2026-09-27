import { redirect } from 'next/navigation'
import { banco } from '@/servidor/banco'
import { usuarioAtual } from '@/servidor/sessao'
import { Formulario } from './Formulario'

export const dynamic = 'force-dynamic'

export default async function Entrar({
  searchParams,
}: {
  searchParams: Promise<{ expirou?: string }>
}) {
  if (await usuarioAtual()) redirect('/')
  const { expirou } = await searchParams
  const db = await banco()

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">DG Brasil</h1>
          <p className="mt-1 text-sm text-suave">Barbara Cardoso Advocacia</p>
        </div>

        {expirou && (
          <p className="mb-4 rounded-md bg-atencao-fraco px-3 py-2 text-center text-xs text-atencao">
            Sua sessão expirou. Entre de novo.
          </p>
        )}

        <Formulario />

        {db.demonstracao && (
          <div className="mt-6 rounded-md border border-dashed border-borda px-3 py-3 text-xs text-suave">
            <p className="mb-1.5 font-medium">Modo demonstração — duas contas:</p>
            <p className="tabular">
              barbara@exemplo.adv.br · senha <strong>demo</strong> — administradora
            </p>
            <p className="tabular mt-0.5">
              renata@exemplo.adv.br · senha <strong>demo</strong> — estagiária
            </p>
            <p className="mt-2">
              Entre com as duas e compare: a estagiária enxerga apenas o caso em que é
              responsável.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
