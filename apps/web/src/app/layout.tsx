import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'
import { banco } from '@/servidor/banco'
import { contarPropostasPendentes } from '@/servidor/consultas'
import { ROTULO_PAPEL, usuarioAtual, type Usuario } from '@/servidor/sessao'
import { sairDoSistema } from './entrar/acoes'

export const metadata: Metadata = {
  title: 'DG Brasil',
  description: 'Sistema interno da Barbara Cardoso Advocacia',
}

export const dynamic = 'force-dynamic'

export default async function Layout({ children }: { children: React.ReactNode }) {
  const db = await banco()
  const usuario = await usuarioAtual()

  // Sem sessão, a moldura some: as telas de login e de convite se desenham
  // sozinhas, e não faz sentido mostrar navegação para quem não entrou.
  if (!usuario) {
    return (
      <html lang="pt-BR">
        <body className="min-h-dvh">
          {db.demonstracao && <AvisoDemonstracao />}
          {children}
        </body>
      </html>
    )
  }

  const pendentes = await db.comoUsuario(usuario.id, (escopo) =>
    contarPropostasPendentes(escopo),
  )

  return (
    <html lang="pt-BR">
      <body className="min-h-dvh">
        <div className="flex min-h-dvh flex-col lg:flex-row">
          <nav className="flex shrink-0 flex-col border-b border-borda bg-superficie lg:w-56 lg:border-r lg:border-b-0">
            <div className="flex items-center gap-2 px-4 py-4 lg:px-5">
              <span className="text-base font-semibold tracking-tight">DG Brasil</span>
            </div>

            <ul className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:gap-0.5 lg:pb-4">
              <Item href="/" rotulo="Hoje" />
              <Item href="/aprovacoes" rotulo="Aprovações" contador={pendentes} />
              <Item href="/contatos" rotulo="Contatos" />
              {usuario.papel === 'admin' && <Item href="/equipe" rotulo="Equipe" />}
            </ul>

            <Rodape usuario={usuario} />
          </nav>

          <main className="min-w-0 flex-1">
            {db.demonstracao && <AvisoDemonstracao />}
            <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:py-8">{children}</div>
          </main>
        </div>
      </body>
    </html>
  )
}

function Item({ href, rotulo, contador }: { href: string; rotulo: string; contador?: number }) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap text-texto hover:bg-realce-fraco"
      >
        {rotulo}
        {contador !== undefined && contador > 0 && (
          <span className="tabular rounded-full bg-realce px-1.5 py-0.5 text-[11px] leading-none font-medium text-white">
            {contador}
          </span>
        )}
      </Link>
    </li>
  )
}

function Rodape({ usuario }: { usuario: Usuario }) {
  return (
    <div className="mt-auto hidden border-t border-borda px-4 py-3 lg:block">
      <p className="truncate text-xs font-medium">{usuario.nome}</p>
      <p className="mt-0.5 text-[11px] text-suave">{ROTULO_PAPEL[usuario.papel]}</p>
      <form action={sairDoSistema}>
        <button
          type="submit"
          className="mt-2 text-xs text-suave underline-offset-2 hover:text-urgente hover:underline"
        >
          sair
        </button>
      </form>
    </div>
  )
}

function AvisoDemonstracao() {
  return (
    <div className="border-b border-atencao/30 bg-atencao-fraco px-4 py-2 text-center text-xs text-atencao sm:px-6">
      <strong className="font-semibold">Modo demonstração</strong> — banco em memória,
      dados fictícios. Some ao reiniciar o servidor. Defina{' '}
      <code className="tabular">DATABASE_URL</code> para usar o banco de verdade.
    </div>
  )
}
