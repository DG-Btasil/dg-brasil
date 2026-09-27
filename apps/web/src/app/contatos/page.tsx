import Link from 'next/link'
import { buscarContatos } from '@/servidor/consultas'
import { comoUsuarioLogado } from '@/servidor/sessao'
import { Cartao, Etiqueta, Titulo, Vazio, cpfBr } from '@/componentes/ui'

export const dynamic = 'force-dynamic'

export default async function Contatos({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q = '' } = await searchParams
  const contatos = await comoUsuarioLogado((db) => buscarContatos(db, q))

  return (
    <>
      <Titulo acima="Cadastro">Contatos</Titulo>

      <form className="mb-6">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Nome ou CPF"
          className="w-full max-w-md rounded-md border border-borda bg-superficie px-3 py-2 text-sm"
        />
      </form>

      {contatos.length === 0 ? (
        <Vazio>
          {q ? `Nada encontrado para “${q}”.` : 'Nenhum contato cadastrado ainda.'}
        </Vazio>
      ) : (
        <Cartao>
          <ul className="divide-y divide-borda">
            {contatos.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/contatos/${c.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-realce-fraco"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.nome}</p>
                    <p className="tabular mt-0.5 text-xs text-suave">
                      {cpfBr(c.cpf_cnpj)}
                      {c.telefone && ` · ${c.telefone}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {Number(c.casos) > 0 && (
                      <span className="tabular text-xs text-suave">
                        {c.casos} {Number(c.casos) === 1 ? 'caso' : 'casos'}
                      </span>
                    )}
                    <Etiqueta tom={c.is_cliente ? 'calmo' : 'neutro'}>
                      {c.is_cliente === true
                        ? 'Cliente'
                        : c.is_cliente === false
                          ? 'Lead'
                          : 'Sem classificação'}
                    </Etiqueta>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Cartao>
      )}
    </>
  )
}
