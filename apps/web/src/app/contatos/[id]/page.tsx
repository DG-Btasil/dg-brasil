import { notFound } from 'next/navigation'
import { fichaDoContato } from '@/servidor/consultas'
import {
  Cartao,
  Etiqueta,
  STATUS_CASO,
  Secao,
  Titulo,
  Vazio,
  cpfBr,
  dataBr,
  moedaBr,
  prazoEmPalavras,
} from '@/componentes/ui'

export default async function Ficha({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ficha = await fichaDoContato(id)
  if (!ficha) notFound()

  const { contato, beneficios, casos, prazos, documentos, financeiro } = ficha
  const idade = contato.nascimento ? anos(contato.nascimento) : null

  return (
    <>
      <Titulo acima={contato.is_cliente ? 'Cliente' : 'Lead'}>{contato.nome}</Titulo>

      <dl className="mb-8 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
        <Campo rotulo="CPF" valor={cpfBr(contato.cpf_cnpj)} tabular />
        <Campo
          rotulo="Nascimento"
          valor={
            contato.nascimento
              ? `${dataBr(contato.nascimento)}${idade ? ` (${idade} anos)` : ''}`
              : null
          }
        />
        <Campo rotulo="Telefone" valor={contato.telefone} tabular />
        <Campo rotulo="Origem" valor={contato.origem} />
      </dl>

      {prazos.length > 0 && (
        <Secao titulo="Prazos abertos" contador={prazos.length}>
          <Cartao>
            <ul className="divide-y divide-borda">
              {prazos.map((z, i) => {
                const { texto, tom } = prazoEmPalavras(z.dias_restantes)
                return (
                  <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <Etiqueta tom={tom}>{texto}</Etiqueta>
                    <span className="flex-1">{z.tipo}</span>
                    <span className="tabular text-xs text-suave">
                      {dataBr(z.data_fatal)}
                    </span>
                  </li>
                )
              })}
            </ul>
          </Cartao>
        </Secao>
      )}

      <Secao titulo="Benefícios do INSS" contador={beneficios.length}>
        {beneficios.length === 0 ? (
          <Vazio>Nenhum benefício cadastrado.</Vazio>
        ) : (
          <Cartao>
            <ul className="divide-y divide-borda">
              {beneficios.map((b) => (
                <li key={b.numero_beneficio} className="px-4 py-3 text-sm">
                  <p className="tabular font-medium">{b.numero_beneficio}</p>
                  <p className="mt-0.5 text-xs text-suave">
                    Espécie {b.especie ?? '—'} · DIB {dataBr(b.dib)} ·{' '}
                    {moedaBr(b.valor_mensal)}/mês
                    {b.banco_pagador && ` · ${b.banco_pagador}`}
                  </p>
                </li>
              ))}
            </ul>
          </Cartao>
        )}
      </Secao>

      <Secao titulo="Casos" contador={casos.length}>
        {casos.length === 0 ? (
          <Vazio>Nenhum caso aberto.</Vazio>
        ) : (
          <Cartao>
            <ul className="divide-y divide-borda">
              {casos.map((k) => (
                <li key={k.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-medium">{k.titulo}</p>
                    <Etiqueta tom={k.status === 'judicializado' ? 'calmo' : 'neutro'}>
                      {STATUS_CASO[k.status] ?? k.status}
                    </Etiqueta>
                  </div>
                  <p className="mt-1 text-xs text-suave">
                    {k.numero_cnj ? (
                      <>
                        <span className="tabular">{k.numero_cnj}</span>
                        {k.vara && ` · ${k.vara}`}
                        {k.tribunal && ` · ${k.tribunal}`}
                      </>
                    ) : (
                      'sem processo distribuído'
                    )}
                    {k.valor_causa && ` · ${moedaBr(k.valor_causa)}`}
                    {k.responsavel && ` · ${k.responsavel}`}
                  </p>
                </li>
              ))}
            </ul>
          </Cartao>
        )}
      </Secao>

      <Secao titulo="Documentos" contador={documentos.length}>
        {documentos.length === 0 ? (
          <Vazio>Nenhum documento.</Vazio>
        ) : (
          <Cartao>
            <ul className="divide-y divide-borda">
              {documentos.map((d, i) => (
                <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="flex-1 truncate">{d.nome}</span>
                  {d.assinado && <Etiqueta tom="calmo">assinado</Etiqueta>}
                  <span className="tabular hidden text-xs text-suave sm:block">
                    {dataBr(d.criado_em)}
                  </span>
                </li>
              ))}
            </ul>
          </Cartao>
        )}
      </Secao>

      <Secao titulo="Financeiro" contador={financeiro.length}>
        {financeiro.length === 0 ? (
          <Vazio>Nenhum lançamento.</Vazio>
        ) : (
          <Cartao>
            <ul className="divide-y divide-borda">
              {financeiro.map((l, i) => (
                <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">{l.descricao}</span>
                  {!l.pago_em && <Etiqueta tom="atencao">em aberto</Etiqueta>}
                  <span
                    className={`tabular font-medium ${l.tipo === 'despesa' ? 'text-suave' : ''}`}
                  >
                    {l.tipo === 'despesa' ? '−' : ''}
                    {moedaBr(l.valor)}
                  </span>
                </li>
              ))}
            </ul>
          </Cartao>
        )}
      </Secao>
    </>
  )
}

function Campo({
  rotulo,
  valor,
  tabular,
}: {
  rotulo: string
  valor: string | null
  tabular?: boolean
}) {
  return (
    <div>
      <dt className="text-xs text-suave">{rotulo}</dt>
      <dd className={`mt-0.5 ${tabular ? 'tabular' : ''}`}>{valor ?? '—'}</dd>
    </div>
  )
}

function anos(nascimento: string): number {
  const n = new Date(`${nascimento}T12:00:00`)
  const hoje = new Date()
  let a = hoje.getFullYear() - n.getFullYear()
  const m = hoje.getMonth() - n.getMonth()
  if (m < 0 || (m === 0 && hoje.getDate() < n.getDate())) a--
  return a
}
