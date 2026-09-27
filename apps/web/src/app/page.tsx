import Link from 'next/link'
import { prazosAbertos, tarefasAbertas, contarPropostasPendentes } from '@/servidor/consultas'
import { comoUsuarioLogado } from '@/servidor/sessao'
import {
  Cartao,
  Etiqueta,
  LinhaCliente,
  Secao,
  Titulo,
  Vazio,
  dataBr,
  prazoEmPalavras,
} from '@/componentes/ui'

export const dynamic = 'force-dynamic'

export default async function Hoje() {
  const { usuario, prazos, tarefas, pendentes } = await comoUsuarioLogado(
    async (db, usuario) => ({
      usuario,
      prazos: await prazosAbertos(db),
      tarefas: await tarefasAbertas(db),
      pendentes: await contarPropostasPendentes(db),
    }),
  )

  const primeiroNome = usuario.nome.split(' ')[0]
  const hoje = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  return (
    <>
      <Titulo acima={hoje}>Bom dia, {primeiroNome}</Titulo>

      {pendentes > 0 && (
        <Link
          href="/aprovacoes"
          className="mb-8 flex items-center justify-between gap-3 rounded-lg border border-realce/30 bg-realce-fraco px-4 py-3 text-sm hover:border-realce/60"
        >
          <span>
            <strong className="font-semibold">
              {pendentes} {pendentes === 1 ? 'proposta' : 'propostas'}
            </strong>{' '}
            {pendentes === 1 ? 'esperando' : 'esperando'} sua conferência
          </span>
          <span className="text-realce">revisar →</span>
        </Link>
      )}

      <Secao titulo="Prazos abertos" contador={prazos.length}>
        {prazos.length === 0 ? (
          <Vazio>Nenhum prazo em aberto.</Vazio>
        ) : (
          <Cartao>
            <ul className="divide-y divide-borda">
              {prazos.map((p) => {
                const { texto, tom } = prazoEmPalavras(p.dias_restantes)
                return (
                  <li key={p.id} className="flex items-start gap-3 px-4 py-3">
                    <div className="w-24 shrink-0 pt-0.5">
                      <Etiqueta tom={tom}>{texto}</Etiqueta>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {p.tipo}
                        {p.fonte === 'agente' && (
                          <span className="ml-2 text-[11px] font-normal text-suave">
                            aberto por agente
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-suave">
                        <LinhaCliente id={p.contato_id} nome={p.cliente} />
                        {p.numero_cnj && (
                          <>
                            {' · '}
                            <span className="tabular">{p.numero_cnj}</span>
                          </>
                        )}
                      </p>
                      {p.descricao && (
                        <p className="mt-1 text-xs text-suave">{p.descricao}</p>
                      )}
                    </div>
                    <div className="hidden shrink-0 text-right text-xs text-suave sm:block">
                      <p className="tabular">{dataBr(p.data_fatal)}</p>
                      {p.responsavel && <p className="mt-0.5">{p.responsavel}</p>}
                    </div>
                  </li>
                )
              })}
            </ul>
          </Cartao>
        )}
      </Secao>

      <Secao titulo="Tarefas" contador={tarefas.length}>
        {tarefas.length === 0 ? (
          <Vazio>Nada pendente.</Vazio>
        ) : (
          <Cartao>
            <ul className="divide-y divide-borda">
              {tarefas.map((t) => (
                <li key={t.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="w-24 shrink-0 pt-0.5">
                    {t.prioridade === 'urgente' || t.prioridade === 'alta' ? (
                      <Etiqueta tom="atencao">{t.prioridade}</Etiqueta>
                    ) : (
                      <span className="text-[11px] text-suave">{t.status}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{t.titulo}</p>
                    {(t.cliente || t.responsavel) && (
                      <p className="mt-0.5 text-xs text-suave">
                        {t.cliente && t.contato_id && (
                          <LinhaCliente id={t.contato_id} nome={t.cliente} />
                        )}
                        {t.cliente && t.responsavel && ' · '}
                        {t.responsavel}
                      </p>
                    )}
                  </div>
                  <div className="tabular hidden shrink-0 text-xs text-suave sm:block">
                    {dataBr(t.prazo_em)}
                  </div>
                </li>
              ))}
            </ul>
          </Cartao>
        )}
      </Secao>
    </>
  )
}
