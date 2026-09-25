'use client'

import { useState, useTransition } from 'react'
import { aprovar, rejeitar } from './acoes'

export interface Passo {
  ordem: number
  tipo: string
  ferramenta: string | null
  saida: unknown
}

const ROTULO_TIPO: Record<string, string> = {
  criar_documento: 'Documento',
  abrir_prazo: 'Prazo',
  criar_tarefa: 'Tarefa',
  enviar_mensagem: 'Mensagem',
  lancar_honorario: 'Honorário',
  classificar_lead: 'Lead',
  atualizar_caso: 'Caso',
  registrar_esteira: 'Esteira',
}

export function CartaoProposta({
  id,
  tipo,
  resumo,
  payload,
  agenteNome,
  cliente,
  custoUsd,
  passos,
}: {
  id: string
  tipo: string
  resumo: string
  payload: Record<string, unknown>
  agenteNome: string
  cliente: string | null
  custoUsd: string | null
  passos: Passo[]
}) {
  const [pendente, iniciar] = useTransition()
  const [rejeitando, setRejeitando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [aberto, setAberto] = useState(false)

  function executar(acao: () => Promise<void>) {
    setErro(null)
    iniciar(async () => {
      try {
        await acao()
      } catch (e) {
        setErro(e instanceof Error ? e.message : String(e))
      }
    })
  }

  return (
    <li className="px-4 py-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-suave">
        <span className="rounded bg-realce-fraco px-1.5 py-0.5 font-medium text-realce">
          {ROTULO_TIPO[tipo] ?? tipo}
        </span>
        <span>{agenteNome}</span>
        {cliente && <span>· {cliente}</span>}
        {custoUsd && <span className="tabular">· US$ {Number(custoUsd).toFixed(4)}</span>}
      </div>

      <p className="mt-2 text-sm">{resumo}</p>

      <button
        type="button"
        onClick={() => setAberto(!aberto)}
        className="mt-2 text-xs text-suave underline-offset-2 hover:text-realce hover:underline"
      >
        {aberto ? 'ocultar' : 'como o agente chegou nisso'}
      </button>

      {aberto && (
        <div className="mt-3 space-y-3 rounded-md border border-borda bg-fundo p-3">
          <div>
            <p className="mb-1 text-[11px] font-medium tracking-wide text-suave uppercase">
              O que será aplicado
            </p>
            <pre className="tabular overflow-x-auto text-xs whitespace-pre-wrap text-suave">
              {JSON.stringify(payload, null, 2)}
            </pre>
          </div>
          {passos.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-medium tracking-wide text-suave uppercase">
                Rastro da execução
              </p>
              <ol className="space-y-1 text-xs text-suave">
                {passos.map((p) => (
                  <li key={p.ordem} className="flex gap-2">
                    <span className="tabular shrink-0 opacity-50">{p.ordem}</span>
                    <span className="min-w-0">
                      {p.ferramenta && (
                        <code className="tabular mr-1 text-realce">{p.ferramenta}</code>
                      )}
                      {textoDoPasso(p.saida)}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      {erro && <p className="mt-2 text-xs text-urgente">{erro}</p>}

      {rejeitando ? (
        <div className="mt-3">
          <label className="mb-1 block text-xs text-suave" htmlFor={`motivo-${id}`}>
            Por que está rejeitando? Isso é o que corrige o agente.
          </label>
          <textarea
            id={`motivo-${id}`}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-borda bg-superficie px-2 py-1.5 text-sm"
            placeholder="O prazo é de 15 dias úteis contados da publicação, não da disponibilização."
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={pendente}
              onClick={() => executar(() => rejeitar(id, motivo))}
              className="rounded-md bg-urgente px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              Confirmar rejeição
            </button>
            <button
              type="button"
              onClick={() => setRejeitando(false)}
              className="rounded-md px-3 py-1.5 text-sm text-suave hover:text-texto"
            >
              Voltar
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={pendente}
            onClick={() => executar(() => aprovar(id))}
            className="rounded-md bg-realce px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {pendente ? 'Aprovando…' : 'Aprovar'}
          </button>
          <button
            type="button"
            disabled={pendente}
            onClick={() => setRejeitando(true)}
            className="rounded-md border border-borda px-3 py-1.5 text-sm hover:border-urgente hover:text-urgente disabled:opacity-50"
          >
            Rejeitar
          </button>
        </div>
      )}
    </li>
  )
}

function textoDoPasso(saida: unknown): string {
  if (saida === null || saida === undefined) return '—'
  if (typeof saida === 'string') return saida
  return JSON.stringify(saida)
}
