import { passosDaExecucao, propostasPendentes } from '@/servidor/consultas'
import { comoUsuarioLogado, podeAprovar } from '@/servidor/sessao'
import { Cartao, Secao, Titulo, Vazio } from '@/componentes/ui'
import { CartaoProposta } from './CartaoProposta'

export const dynamic = 'force-dynamic'

export default async function Aprovacoes() {
  const { propostas, rastros, souAprovador } = await comoUsuarioLogado(
    async (db, usuario) => {
      const propostas = await propostasPendentes(db)
      // O rastro de cada execução, uma vez por execução (várias propostas
      // podem ter saído da mesma).
      const execucoes = [...new Set(propostas.map((p) => p.execucao_id))]
      return {
        propostas,
        souAprovador: podeAprovar(usuario),
        rastros: new Map(
          await Promise.all(
            execucoes.map(async (id) => [id, await passosDaExecucao(db, id)] as const),
          ),
        ),
      }
    },
  )

  return (
    <>
      <Titulo acima="Fila de aprovação">O que os agentes propuseram</Titulo>

      <p className="mb-6 max-w-2xl text-sm text-suave">
        Nada aqui foi aplicado. Aprovar marca a proposta para o worker executar; rejeitar
        a descarta e registra o motivo — que é o material para corrigir o agente.
      </p>

      {!souAprovador && (
        <p className="mb-6 rounded-md bg-atencao-fraco px-3 py-2 text-xs text-atencao">
          Você acompanha a fila, mas quem aprova é advogado ou administração — é quem
          responde pelo que o agente propôs.
        </p>
      )}

      <Secao titulo="Pendentes" contador={propostas.length}>
        {propostas.length === 0 ? (
          <Vazio>Nenhuma proposta esperando. A fila está limpa.</Vazio>
        ) : (
          <Cartao>
            <ul className="divide-y divide-borda">
              {propostas.map((p) => (
                <CartaoProposta
                  key={p.id}
                  id={p.id}
                  tipo={p.tipo}
                  resumo={p.resumo}
                  payload={p.payload}
                  agenteNome={p.agente_nome}
                  cliente={p.cliente}
                  custoUsd={p.custo_usd}
                  passos={rastros.get(p.execucao_id) ?? []}
                  podeDecidir={souAprovador}
                />
              ))}
            </ul>
          </Cartao>
        )}
      </Secao>
    </>
  )
}
