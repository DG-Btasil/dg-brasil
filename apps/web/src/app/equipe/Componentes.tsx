'use client'

import { useActionState, useState, useTransition } from 'react'
import { alternarAtivo, cadastrarPessoa, mudarPapel, reenviarConvite } from './acoes'

export type Papel = 'admin' | 'advogado' | 'estagiario' | 'financeiro' | 'atendimento'

export const ROTULO_PAPEL: Record<Papel, string> = {
  admin: 'Administração',
  advogado: 'Advogado',
  estagiario: 'Estagiário',
  financeiro: 'Financeiro',
  atendimento: 'Atendimento',
}

export interface Pessoa {
  id: string
  nome: string
  email: string
  papel: Papel
  oab: string | null
  ativo: boolean
  tem_senha: boolean
  ultimo_acesso: string | null
  convite_aberto: boolean
}

function situacao(p: Pessoa) {
  if (!p.ativo) return { classe: 'bg-urgente-fraco text-urgente', texto: 'desativada' }
  if (!p.tem_senha && p.convite_aberto)
    return { classe: 'bg-atencao-fraco text-atencao', texto: 'convite em aberto' }
  if (!p.tem_senha) return { classe: 'bg-urgente-fraco text-urgente', texto: 'sem senha' }
  return { classe: 'bg-calmo-fraco text-calmo', texto: 'ativa' }
}

export function LinhaPessoa({ pessoa, souEu }: { pessoa: Pessoa; souEu: boolean }) {
  const [pendente, iniciar] = useTransition()
  const [erro, setErro] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const s = situacao(pessoa)

  function agir(fn: () => Promise<unknown>) {
    setErro(null)
    iniciar(async () => {
      try {
        await fn()
      } catch (e) {
        setErro(e instanceof Error ? e.message : String(e))
      }
    })
  }

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {pessoa.nome}
            {souEu && <span className="ml-2 text-[11px] text-suave">você</span>}
          </p>
          <p className="tabular mt-0.5 text-xs text-suave">
            {pessoa.email}
            {pessoa.oab && ` · OAB ${pessoa.oab}`}
          </p>
        </div>

        <span
          className={`rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${s.classe}`}
        >
          {s.texto}
        </span>

        <select
          value={pessoa.papel}
          disabled={souEu || pendente}
          onChange={(e) => agir(() => mudarPapel(pessoa.id, e.target.value as Papel))}
          className="rounded-md border border-borda bg-superficie px-2 py-1 text-xs disabled:opacity-50"
        >
          {(Object.keys(ROTULO_PAPEL) as Papel[]).map((p) => (
            <option key={p} value={p}>
              {ROTULO_PAPEL[p]}
            </option>
          ))}
        </select>

        <form
          action={async (fd) => {
            const r = await reenviarConvite(null, fd)
            if (r.erro) setErro(r.erro)
            else if (r.convite) setLink(r.convite.link)
          }}
        >
          <input type="hidden" name="usuario_id" value={pessoa.id} />
          <button
            type="submit"
            disabled={pendente}
            className="rounded-md border border-borda px-2 py-1 text-xs hover:border-realce hover:text-realce disabled:opacity-50"
          >
            {pessoa.tem_senha ? 'Trocar senha' : 'Gerar link'}
          </button>
        </form>

        <button
          type="button"
          disabled={souEu || pendente}
          onClick={() => agir(() => alternarAtivo(pessoa.id))}
          className="rounded-md border border-borda px-2 py-1 text-xs hover:border-urgente hover:text-urgente disabled:opacity-50"
        >
          {pessoa.ativo ? 'Desativar' : 'Reativar'}
        </button>
      </div>

      {erro && <p className="mt-2 text-xs text-urgente">{erro}</p>}
      {link && <CaixaLink nome={pessoa.nome} link={link} aoFechar={() => setLink(null)} />}
    </li>
  )
}

export function FormularioPessoa() {
  const [estado, acao, pendente] = useActionState(cadastrarPessoa, {
    erro: '',
    convite: undefined as { nome: string; link: string } | undefined,
  })

  return (
    <div className="rounded-lg border border-borda bg-superficie p-4">
      <form action={acao} className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="nome" className="mb-1 block text-xs text-suave">
            Nome completo
          </label>
          <input
            id="nome"
            name="nome"
            required
            className="w-full rounded-md border border-borda bg-fundo px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="email" className="mb-1 block text-xs text-suave">
            E-mail
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="w-full rounded-md border border-borda bg-fundo px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="papel" className="mb-1 block text-xs text-suave">
            Papel
          </label>
          <select
            id="papel"
            name="papel"
            defaultValue="atendimento"
            className="w-full rounded-md border border-borda bg-fundo px-3 py-2 text-sm"
          >
            {(Object.keys(ROTULO_PAPEL) as Papel[]).map((p) => (
              <option key={p} value={p}>
                {ROTULO_PAPEL[p]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="oab" className="mb-1 block text-xs text-suave">
            OAB <span className="opacity-60">(se advogado)</span>
          </label>
          <input
            id="oab"
            name="oab"
            placeholder="BA 12345"
            className="w-full rounded-md border border-borda bg-fundo px-3 py-2 text-sm"
          />
        </div>

        <div className="sm:col-span-2">
          {estado?.erro && <p className="mb-2 text-xs text-urgente">{estado.erro}</p>}
          <button
            type="submit"
            disabled={pendente}
            className="rounded-md bg-realce px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {pendente ? 'Cadastrando…' : 'Cadastrar e gerar link'}
          </button>
        </div>
      </form>

      {estado?.convite && (
        <CaixaLink nome={estado.convite.nome} link={estado.convite.link} />
      )}
    </div>
  )
}

function CaixaLink({
  nome,
  link,
  aoFechar,
}: {
  nome: string
  link: string
  aoFechar?: () => void
}) {
  const [copiado, setCopiado] = useState(false)

  return (
    <div className="mt-3 rounded-md border border-realce/40 bg-realce-fraco p-3">
      <p className="text-xs">
        Link para <strong>{nome.split(' ')[0]}</strong> definir a senha. Vale 72 horas e
        serve uma vez — entregue por um canal que você confia.
      </p>
      <div className="mt-2 flex gap-2">
        <input
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="tabular min-w-0 flex-1 rounded border border-borda bg-superficie px-2 py-1 text-xs"
        />
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(link).then(
              () => setCopiado(true),
              () => setCopiado(false),
            )
          }}
          className="shrink-0 rounded bg-realce px-2 py-1 text-xs font-medium text-white"
        >
          {copiado ? 'copiado' : 'copiar'}
        </button>
        {aoFechar && (
          <button
            type="button"
            onClick={aoFechar}
            className="shrink-0 px-1 text-xs text-suave hover:text-texto"
          >
            fechar
          </button>
        )}
      </div>
    </div>
  )
}
