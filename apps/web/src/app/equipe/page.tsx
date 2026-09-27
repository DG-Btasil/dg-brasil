import { redirect } from 'next/navigation'
import { banco } from '@/servidor/banco'
import { exigirUsuario } from '@/servidor/sessao'
import { Cartao, Secao, Titulo } from '@/componentes/ui'
import { FormularioPessoa, LinhaPessoa, ROTULO_PAPEL, type Papel, type Pessoa } from './Componentes'

export const dynamic = 'force-dynamic'

const O_QUE_CADA_PAPEL_VE: [Papel, string][] = [
  ['admin', 'Tudo, mais a gestão da equipe.'],
  ['advogado', 'Todos os casos, prazos e documentos. Aprova propostas de agente.'],
  ['estagiario', 'Só os casos em que é responsável. Vê a fila de aprovação, mas não carimba.'],
  ['financeiro', 'Lançamentos e cadastro mínimo. Não abre o conteúdo dos casos.'],
  ['atendimento', 'Contatos e conversas. Não abre processos.'],
]

export default async function Equipe() {
  const eu = await exigirUsuario()
  if (eu.papel !== 'admin') redirect('/')

  // Esta é uma das poucas leituras feitas fora do escopo do usuário: a lista
  // inclui contas desativadas e o estado do convite, que a RLS de `usuario`
  // esconderia. O acesso já está travado pelo redirect acima.
  const db = await banco()
  const pessoas = await db.consulta<Pessoa>(
    `select u.id, u.nome, u.email, u.papel, u.oab, u.ativo,
            (u.senha_hash is not null) as tem_senha,
            u.ultimo_acesso::text,
            exists (select 1 from convite c
                    where c.usuario_id = u.id and c.usado_em is null and c.expira_em > now())
              as convite_aberto
     from usuario u
     order by u.ativo desc, u.nome`,
  )

  const semSenha = pessoas.filter((p) => p.ativo && !p.tem_senha).length

  return (
    <>
      <Titulo acima="Administração">Equipe</Titulo>

      <p className="mb-6 max-w-2xl text-sm text-suave">
        Cada pessoa entra com a própria conta. Você cadastra e entrega o link; quem
        define a senha é ela — você nunca digita senha de outra pessoa. O papel decide o
        que ela enxerga, e isso é aplicado pelo banco, não só pela tela.
      </p>

      {semSenha > 0 && (
        <p className="mb-6 rounded-md bg-atencao-fraco px-3 py-2 text-xs text-atencao">
          {semSenha} {semSenha === 1 ? 'pessoa ainda não definiu' : 'pessoas ainda não definiram'}{' '}
          a senha e {semSenha === 1 ? 'não consegue' : 'não conseguem'} entrar.
        </p>
      )}

      <Secao titulo="Pessoas" contador={pessoas.length}>
        <Cartao>
          <ul className="divide-y divide-borda">
            {pessoas.map((p) => (
              <LinhaPessoa key={p.id} pessoa={p} souEu={p.id === eu.id} />
            ))}
          </ul>
        </Cartao>
      </Secao>

      <Secao titulo="Cadastrar pessoa">
        <FormularioPessoa />
      </Secao>

      <Secao titulo="O que cada papel enxerga">
        <Cartao>
          <ul className="divide-y divide-borda text-sm">
            {O_QUE_CADA_PAPEL_VE.map(([papel, texto]) => (
              <li key={papel} className="flex flex-wrap gap-x-3 gap-y-1 px-4 py-2.5">
                <span className="w-32 shrink-0 font-medium">{ROTULO_PAPEL[papel]}</span>
                <span className="text-suave">{texto}</span>
              </li>
            ))}
          </ul>
        </Cartao>
      </Secao>

      <p className="text-xs text-suave">
        Todo acesso a ficha de cliente fica registrado em{' '}
        <code className="tabular">acesso_dado_pessoal</code>, e toda mudança nesta tela
        em <code className="tabular">evento_auditoria</code>.
      </p>
    </>
  )
}
