import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { consulta, um } from './db.js'
import type { Agente, Execucao } from './tipos.js'

/**
 * As ferramentas que o agente enxerga do sistema.
 *
 * Regra estrutural: há MUITAS de leitura e UMA de escrita — `propor`. O agente
 * não tem caminho para gravar nada no banco do escritório por conta própria.
 * Tudo que ele quer fazer vira uma linha em `proposta`, que um advogado aprova
 * no painel. Se algum dia alguém adicionar aqui uma ferramenta que escreve
 * direto, é esse contrato que se perde — não é detalhe de implementação.
 */
export function ferramentasDo(execucao: Execucao, agente: Agente) {
  const texto = (t: string) => ({ content: [{ type: 'text' as const, text: t }] })
  const json = (v: unknown) => texto(JSON.stringify(v, null, 2))

  const buscarContato = tool(
    'buscar_contato',
    'Busca um contato por CPF/CNPJ (só dígitos) ou por parte do nome. Retorna dados cadastrais, benefícios do INSS e casos.',
    { termo: z.string().describe('CPF, CNPJ ou parte do nome') },
    async ({ termo }) => {
      const digitos = termo.replace(/\D/g, '')
      const linhas = await consulta(
        `select c.id, c.nome, c.cpf_cnpj, c.nascimento, c.telefone, c.is_cliente,
                coalesce(
                  (select json_agg(json_build_object(
                     'numero', b.numero_beneficio, 'especie', b.especie, 'dib', b.dib))
                   from beneficio b where b.contato_id = c.id), '[]') as beneficios,
                coalesce(
                  (select json_agg(json_build_object(
                     'id', k.id, 'titulo', k.titulo, 'status', k.status))
                   from caso k where k.contato_id = c.id), '[]') as casos
         from contato c
         where ($1 <> '' and c.cpf_cnpj = $1)
            or c.nome ilike '%' || $2 || '%'
         limit 10`,
        [digitos, termo],
      )
      return linhas.length ? json(linhas) : texto('Nenhum contato encontrado.')
    },
    { annotations: { readOnlyHint: true } },
  )

  const verCaso = tool(
    'ver_caso',
    'Abre um caso: dados do cliente, processos, prazos abertos, documentos já existentes e ações da esteira.',
    { caso_id: z.string().uuid() },
    async ({ caso_id }) => {
      const caso = await um(
        `select k.*, c.nome as cliente, c.cpf_cnpj,
                (select json_agg(json_build_object('id',p.id,'cnj',p.numero_cnj,'fase',p.fase))
                 from processo p where p.caso_id = k.id) as processos,
                (select json_agg(json_build_object('tipo',z.tipo,'fatal',z.data_fatal))
                 from prazo z join processo p on p.id = z.processo_id
                 where p.caso_id = k.id and z.status = 'aberto') as prazos_abertos,
                (select json_agg(json_build_object('tipo',d.tipo,'nome',d.nome,'assinado',d.assinado))
                 from documento d where d.caso_id = k.id) as documentos
         from caso k join contato c on c.id = k.contato_id
         where k.id = $1`,
        [caso_id],
      )
      return caso ? json(caso) : texto('Caso não encontrado.')
    },
    { annotations: { readOnlyHint: true } },
  )

  const contratosDoExtrato = tool(
    'contratos_do_extrato',
    'Lista os contratos de consignado importados de um extrato HISCON, para classificação nos blocos.',
    { extrato_id: z.string().uuid() },
    async ({ extrato_id }) => {
      const linhas = await consulta(
        `select numero_contrato, banco_nome, tipo, situacao, data_inclusao, data_exclusao,
                valor_parcela, qtd_parcelas, valor_emprestado, valor_liberado,
                origem_averbacao, utilizado_mes
         from contrato_consignado where extrato_id = $1
         order by data_inclusao`,
        [extrato_id],
      )
      return json(linhas)
    },
    { annotations: { readOnlyHint: true } },
  )

  const publicacoesPendentes = tool(
    'publicacoes_pendentes',
    'Publicações capturadas do diário que ainda não foram tratadas pela equipe.',
    { limite: z.number().int().min(1).max(100).default(30) },
    async ({ limite }) => {
      const linhas = await consulta(
        `select id, numero_cnj, diario, data_publicacao, oab_destinatario,
                left(conteudo, 2000) as conteudo
         from publicacao where not tratada
         order by data_publicacao desc limit $1`,
        [limite],
      )
      return json(linhas)
    },
    { annotations: { readOnlyHint: true } },
  )

  const conversaRecente = tool(
    'conversa_recente',
    'Últimas mensagens de uma conversa de WhatsApp, para entender o contexto do lead.',
    { conversa_id: z.string().uuid(), limite: z.number().int().min(1).max(200).default(40) },
    async ({ conversa_id, limite }) => {
      const linhas = await consulta(
        `select direcao, tipo, conteudo, enviada_em from mensagem
         where conversa_id = $1 order by enviada_em desc limit $2`,
        [conversa_id, limite],
      )
      return json(linhas.reverse())
    },
    { annotations: { readOnlyHint: true } },
  )

  // ── a única escrita ────────────────────────────────────────────────
  const propor = tool(
    'propor',
    [
      'Registra uma proposta para revisão humana. É o ÚNICO jeito de produzir efeito no sistema.',
      'Nada acontece até um advogado aprovar no painel — então escreva o `resumo` como quem explica',
      'a um colega ocupado o que está pedindo e por quê, numa linha.',
      'O `payload` precisa estar completo e correto: na aprovação ele é aplicado como está.',
    ].join(' '),
    {
      tipo: z.enum([
        'criar_documento',
        'abrir_prazo',
        'criar_tarefa',
        'enviar_mensagem',
        'lancar_honorario',
        'classificar_lead',
        'atualizar_caso',
        'registrar_esteira',
      ]),
      resumo: z.string().min(10).max(300),
      payload: z.record(z.string(), z.unknown()),
      alvo_tabela: z.string().optional(),
      alvo_id: z.string().uuid().optional(),
    },
    async ({ tipo, resumo, payload, alvo_tabela, alvo_id }) => {
      const auto =
        agente.politica_aprovacao === 'auto' ||
        (agente.politica_aprovacao === 'humana_se' && abaixoDoLimite(agente, payload))

      const linha = await um<{ id: string }>(
        `insert into proposta (execucao_id, tipo, resumo, payload, alvo_tabela, alvo_id, status)
         values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [
          execucao.id,
          tipo,
          resumo,
          JSON.stringify(payload),
          alvo_tabela ?? null,
          alvo_id ?? null,
          auto ? 'aprovada' : 'pendente',
        ],
      )
      return texto(
        auto
          ? `Proposta ${linha?.id} registrada e aprovada automaticamente (política "${agente.politica_aprovacao}").`
          : `Proposta ${linha?.id} registrada. Vai para a fila de aprovação — não está aplicada ainda.`,
      )
    },
  )

  const todas = [
    buscarContato,
    verCaso,
    contratosDoExtrato,
    publicacoesPendentes,
    conversaRecente,
    propor,
  ]

  // `agente.ferramentas` vazio = todas liberadas. Preenchido = allowlist estrita.
  const permitidas = agente.ferramentas.length
    ? todas.filter((t) => agente.ferramentas.includes(t.name) || t.name === 'propor')
    : todas

  return createSdkMcpServer({
    name: 'nucleo',
    version: '1.0.0',
    tools: permitidas,
  })
}

function abaixoDoLimite(agente: Agente, payload: Record<string, unknown>): boolean {
  const limite = agente.limite_auto ? Number(agente.limite_auto) : null
  if (limite === null) return false
  const valor = Number(payload.valor)
  return Number.isFinite(valor) && valor <= limite
}
