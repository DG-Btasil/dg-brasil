import { tool } from '@anthropic-ai/claude-agent-sdk'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, relative, resolve, isAbsolute } from 'node:path'
import { z } from 'zod'
import { um } from './banco.js'
import { EXIGE_CASO, TIPOS_PROPOSTA, validarPayload, type PayloadGravado } from './propostas.js'
import type { ContextoExecucao, Ferramenta } from './tipos.js'

/**
 * As ferramentas que o agente enxerga do sistema.
 *
 * Regra estrutural: muitas de LEITURA e duas de escrita, ambas presas a uma
 * revisão humana:
 *
 *   propor              grava agent_proposals + reviews (PENDING). O efeito só
 *                       acontece depois que um advogado aprova (aplicar.ts) — e
 *                       o banco recusa aprovar proposta sem revisão aprovada.
 *   entregar_documento  grava uma minuta como versão INTERNAL de documento, com
 *                       revisão pendente. Parceiro não vê; nada sai do escritório.
 *
 * Se alguém adicionar aqui uma ferramenta que escreve direto no que tem efeito,
 * é esse contrato que se perde. Não é detalhe de implementação.
 */

export const FERRAMENTAS_LEITURA = [
  'buscar_cliente', 'ver_caso', 'ver_processo', 'baixar_documento',
  'teses_do_agente', 'referencias_do_agente',
] as const
export const FERRAMENTAS_ESCRITA = ['propor', 'entregar_documento'] as const

const LIMITE_ARQUIVO = 50 * 1024 * 1024
const BUCKET_DOCUMENTOS = 'legal-documents'
const BUCKET_REFERENCIAS = 'reference-materials'

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.txt': 'text/plain',
  '.md': 'text/plain',
  '.csv': 'text/csv',
}

const texto = (t: string) => ({ content: [{ type: 'text' as const, text: t }] })
const json = (v: unknown) => texto(JSON.stringify(v, null, 2))
const erro = (t: string) => ({ ...texto(t), isError: true })

export function criarFerramentas(ctx: ContextoExecucao): Ferramenta[] {
  const { banco, run, clienteDoCaso } = ctx

  // ── leitura ──────────────────────────────────────────────────────────────

  const buscarCliente = tool(
    'buscar_cliente',
    'Busca cliente por CPF/CNPJ (só dígitos) ou por parte do nome. Retorna cadastro básico e casos. ' +
      'Em execução ligada a um caso, só encontra o cliente desse caso.',
    { termo: z.string().min(3).describe('CPF, CNPJ ou parte do nome (mínimo 3 caracteres)') },
    async ({ termo }) => {
      const digitos = termo.replace(/\D/g, '')
      const { rows } = await banco.query(
        `select c.id, c.kind, c.cpf, c.cnpj, c.status,
                coalesce(i.full_name, co.legal_name) as nome,
                i.birth_date, i.marital_status, i.profession,
                coalesce((select json_agg(json_build_object('id', k.id, 'titulo', k.title, 'status', k.status))
                          from public.legal_cases k where k.client_id = c.id and k.deleted_at is null), '[]') as casos
         from public.clients c
         left join public.individual_client_details i on i.client_id = c.id
         left join public.company_client_details co on co.client_id = c.id
         where c.deleted_at is null
           and ($3::uuid is null or c.id = $3::uuid)
           and ((length($1::text) >= 11 and (c.cpf = $1::text or c.cnpj = $1::text))
                or coalesce(i.full_name, co.legal_name) ilike '%' || $2::text || '%')
         order by nome
         limit 10`,
        [digitos, termo.replace(/[%_]/g, ''), clienteDoCaso],
      )
      return rows.length ? json(rows) : texto('Nenhum cliente encontrado.')
    },
    { annotations: { readOnlyHint: true } },
  )

  const verCaso = tool(
    'ver_caso',
    'Abre um caso: cliente, processos, prazos abertos, documentos (com a situação de aprovação da última versão) ' +
      'e pendências de documento.',
    { caso_id: z.string().uuid() },
    async ({ caso_id }) => {
      const caso = await um(
        banco,
        `select k.id, k.title as titulo, k.summary as resumo, k.status, k.client_id,
                a.code as area, coalesce(i.full_name, co.legal_name) as cliente,
                coalesce((select json_agg(json_build_object(
                    'id', p.id, 'cnj', p.cnj_number, 'status', p.status, 'tribunal', p.court))
                  from public.legal_processes p
                  where p.legal_case_id = k.id and p.deleted_at is null), '[]') as processos,
                coalesce((select json_agg(json_build_object(
                    'id', d.id, 'titulo', d.title, 'vence_em', d.due_at, 'processo_id', d.legal_process_id)
                    order by d.due_at)
                  from public.deadlines d
                  where d.legal_case_id = k.id and d.status = 'OPEN'), '[]') as prazos_abertos,
                coalesce((select json_agg(json_build_object(
                    'id', doc.id, 'titulo', doc.title, 'categoria', doc.category,
                    'visibilidade', doc.visibility,
                    'ultima_versao_id', ult.document_version_id, 'versao', ult.version_number,
                    'aprovacao', ult.approval_status))
                  from public.case_documents cd
                  join public.documents doc on doc.id = cd.document_id and doc.deleted_at is null
                  left join lateral (
                    select va.document_version_id, va.version_number, va.approval_status
                    from public.document_version_approvals va
                    where va.document_id = doc.id
                    order by va.version_number desc limit 1
                  ) ult on true
                  where cd.legal_case_id = k.id), '[]') as documentos,
                coalesce((select json_agg(json_build_object(
                    'categoria', r.category, 'descricao', r.requirement_label,
                    'obrigatorio', r.required, 'status', r.status))
                  from public.case_document_requirements r
                  where r.legal_case_id = k.id), '[]') as pendencias
         from public.legal_cases k
         join public.legal_areas a on a.id = k.legal_area_id
         left join public.individual_client_details i on i.client_id = k.client_id
         left join public.company_client_details co on co.client_id = k.client_id
         where k.id = $1::uuid and k.deleted_at is null
           and ($2::uuid is null or k.client_id = $2::uuid)`,
        [caso_id, clienteDoCaso],
      )
      return caso ? json(caso) : texto('Caso não encontrado (ou fora do escopo desta execução).')
    },
    { annotations: { readOnlyHint: true } },
  )

  const verProcesso = tool(
    'ver_processo',
    'Abre um processo: dados, partes e as últimas movimentações.',
    {
      processo_id: z.string().uuid(),
      movimentacoes: z.number().int().min(1).max(200).default(50),
    },
    async ({ processo_id, movimentacoes }) => {
      const p = await um(
        banco,
        `select p.id, p.legal_case_id, p.cnj_number, p.status, p.court, p.court_unit, p.district,
                p.state, p.legal_class, p.subject, p.client_side, p.case_value, p.distribution_date,
                coalesce((select json_agg(json_build_object('tipo', pp.party_type, 'nome', pp.name))
                          from public.process_parties pp where pp.legal_process_id = p.id), '[]') as partes,
                coalesce((select json_agg(e order by e.occurred_at desc)
                          from (select ev.event_type, ev.description, ev.occurred_at, ev.source
                                from public.process_events ev
                                where ev.legal_process_id = p.id
                                order by ev.occurred_at desc limit $3::int) e), '[]') as movimentacoes
         from public.legal_processes p
         join public.legal_cases k on k.id = p.legal_case_id
         where p.id = $1::uuid and p.deleted_at is null
           and ($2::uuid is null or k.client_id = $2::uuid)`,
        [processo_id, clienteDoCaso, movimentacoes],
      )
      return p ? json(p) : texto('Processo não encontrado (ou fora do escopo desta execução).')
    },
    { annotations: { readOnlyHint: true } },
  )

  const baixarDocumento = tool(
    'baixar_documento',
    'Baixa uma versão de documento para o diretório de trabalho e devolve o caminho local, ' +
      'para você ler com Read. Use o ultima_versao_id que ver_caso devolve.',
    { versao_id: z.string().uuid() },
    async ({ versao_id }) => {
      const v = await um<{ storage_object_name: string; original_filename: string | null; file_size: string | null }>(
        banco,
        `select v.storage_object_name, v.original_filename, v.file_size
         from public.document_versions v
         join public.documents d on d.id = v.document_id
         where v.id = $1::uuid and d.deleted_at is null
           and ($2::uuid is null or d.client_id = $2::uuid)`,
        [versao_id, clienteDoCaso],
      )
      if (!v) return texto('Versão não encontrada (ou fora do escopo desta execução).')
      if (Number(v.file_size ?? 0) > LIMITE_ARQUIVO) return erro('Arquivo grande demais para baixar.')

      const bytes = await ctx.armazenamento.baixar(BUCKET_DOCUMENTOS, v.storage_object_name)
      const local = join(ctx.scratch, `${versao_id}-${basename(v.original_filename ?? 'documento')}`)
      await writeFile(local, bytes)
      return texto(`Baixado em: ${local}`)
    },
    { annotations: { readOnlyHint: true } },
  )

  const tesesDoAgente = tool(
    'teses_do_agente',
    'Teses jurídicas vinculadas a este agente, na versão vigente: fundamentos, critérios de aplicação e de exclusão.',
    {},
    async () => {
      const { rows } = await banco.query(
        `select t.slug, t.title as titulo, t.description as descricao,
                v.version_number as versao, v.foundations as fundamentos,
                v.application_criteria as criterios_aplicacao,
                v.exclusion_criteria as criterios_exclusao, v.notes as notas
         from public.agent_thesis_bindings b
         join public.legal_theses t on t.id = b.legal_thesis_id
         join public.legal_thesis_versions v on v.id = t.current_version_id
         where b.agent_id = $1::uuid and b.enabled and t.status = 'ACTIVE' and t.deleted_at is null
         order by t.title`,
        [ctx.agente.id],
      )
      return rows.length ? json(rows) : texto('Nenhuma tese vinculada a este agente.')
    },
    { annotations: { readOnlyHint: true } },
  )

  const referenciasDoAgente = tool(
    'referencias_do_agente',
    'Materiais de referência vinculados a este agente (petições aprovadas, modelos de escrita, orientações). ' +
      'Texto vem inline; arquivo é baixado para o diretório de trabalho.',
    {},
    async () => {
      const { rows } = await banco.query<{
        id: string; tipo: string; titulo: string; descricao: string | null
        storage_object_name: string | null; content_text: string | null
      }>(
        `select r.id, r.type as tipo, r.title as titulo, r.description as descricao,
                v.storage_object_name, left(v.content_text, 20000) as content_text
         from public.agent_reference_bindings b
         join public.reference_materials r on r.id = b.reference_material_id
         join public.reference_material_versions v on v.id = r.current_version_id
         where b.agent_id = $1::uuid and b.enabled and r.status = 'ACTIVE' and r.deleted_at is null
         order by r.title`,
        [ctx.agente.id],
      )
      if (!rows.length) return texto('Nenhuma referência vinculada a este agente.')

      const saida = []
      for (const r of rows) {
        let arquivo: string | null = null
        if (r.storage_object_name) {
          const bytes = await ctx.armazenamento.baixar(BUCKET_REFERENCIAS, r.storage_object_name)
          arquivo = join(ctx.scratch, `ref-${r.id}-${basename(r.storage_object_name)}`)
          await writeFile(arquivo, bytes)
        }
        saida.push({ tipo: r.tipo, titulo: r.titulo, descricao: r.descricao, texto: r.content_text, arquivo })
      }
      return json(saida)
    },
    { annotations: { readOnlyHint: true } },
  )

  // ── escrita 1: proposta com revisão humana ──────────────────────────────

  const propor = tool(
    'propor',
    [
      'Registra uma proposta para revisão humana. É o ÚNICO jeito de produzir efeito no sistema.',
      'Nada acontece até um advogado aprovar em Revisões. Escreva o `resumo` como quem explica a um',
      'colega ocupado, numa linha, o que está pedindo e por quê.',
      'O `payload` precisa estar completo: aprovado, ele é aplicado exatamente como está.',
      'Tipos: CREATE_DEADLINE {title, due_at ISO, priority?, legal_process_id?, description?};',
      'REQUEST_DOCUMENT {category, label, required?, message_to_partner?, due_at?};',
      'UPDATE_CASE {title?, summary?, status?: WAITING_DOCUMENTS|READY_FOR_ANALYSIS|ANALYZING|WAITING_REVIEW};',
      'CREATE_PROCESS {cnj_number? (20 dígitos), court?, ...}; UPDATE_SKILL {skill_slug, instructions};',
      'UPDATE_AGENT {agent_slug, instructions}; OTHER {description} para providência sem aplicação automática.',
      'Minuta de documento NÃO é proposta: use entregar_documento.',
    ].join(' '),
    {
      tipo: z.enum(TIPOS_PROPOSTA),
      resumo: z.string().min(10).max(300),
      payload: z.record(z.string(), z.unknown()),
      prioridade: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
    },
    async ({ tipo, resumo, payload, prioridade }) => {
      if (EXIGE_CASO.has(tipo) && !run.legal_case_id) {
        return erro(`${tipo} só pode ser proposto numa execução ligada a um caso.`)
      }

      let dados: Record<string, unknown>
      try {
        dados = validarPayload(tipo, payload) as Record<string, unknown>
      } catch (e) {
        return erro(`Payload inválido para ${tipo}: ${e instanceof Error ? e.message : String(e)}`)
      }

      const processoId = (dados.legal_process_id as string | undefined) ?? run.legal_process_id
      if (processoId && run.legal_case_id) {
        const ok = await um(banco,
          `select 1 from public.legal_processes where id = $1::uuid and legal_case_id = $2::uuid`,
          [processoId, run.legal_case_id])
        if (!ok) return erro('legal_process_id não pertence ao caso desta execução.')
      }

      const gravado: PayloadGravado = { summary: resumo, data: dados }
      const id = await banco.transacao(async (tx) => {
        const p = await um<{ id: string }>(tx,
          `insert into public.agent_proposals
             (agent_run_id, legal_case_id, legal_process_id, proposal_type, payload, requires_human_review)
           values ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::jsonb, true)
           returning id`,
          [run.id, run.legal_case_id, run.legal_case_id ? processoId : null, tipo, JSON.stringify(gravado)])
        await tx.query(
          `insert into public.reviews (legal_case_id, agent_proposal_id, priority)
           values ($1::uuid, $2::uuid, $3::text)`,
          [run.legal_case_id, p!.id, prioridade ?? 'NORMAL'])
        return p!.id
      })

      ctx.registro.propostas.push(id)
      return texto(`Proposta ${id} registrada e enviada para Revisões. Ainda NÃO está aplicada.`)
    },
  )

  // ── escrita 2: minuta interna com revisão humana ────────────────────────

  const entregarDocumento = tool(
    'entregar_documento',
    'Entrega uma minuta (PDF, DOCX, TXT, MD) que você escreveu no diretório de trabalho. Ela vira um ' +
      'documento INTERNO do caso, versão nova, com revisão pendente. Parceiros não veem; nada é enviado ao cliente.',
    {
      caminho: z.string().describe('Arquivo dentro do diretório de trabalho'),
      titulo: z.string().min(3).max(200),
      categoria: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/).describe('Ex.: PETITION, POWER_OF_ATTORNEY'),
      descricao: z.string().max(2000).optional(),
      documento_id: z.string().uuid().optional().describe('Para nova versão de documento que já existe no caso'),
    },
    async ({ caminho, titulo, categoria, descricao, documento_id }) => {
      if (!run.legal_case_id || !clienteDoCaso) {
        return erro('entregar_documento só funciona numa execução ligada a um caso.')
      }

      const local = resolve(ctx.scratch, caminho)
      const rel = relative(ctx.scratch, local)
      if (rel.startsWith('..') || isAbsolute(rel)) {
        return erro('O arquivo precisa estar dentro do diretório de trabalho.')
      }
      const mime = MIME[extname(local).toLowerCase()]
      if (!mime) return erro(`Extensão não aceita. Use: ${Object.keys(MIME).join(', ')}`)
      const info = await stat(local).catch(() => null)
      if (!info?.isFile()) return erro('Arquivo não encontrado no diretório de trabalho.')
      if (info.size > LIMITE_ARQUIVO) return erro('Arquivo maior que 50 MB.')

      if (documento_id) {
        const doc = await um(banco,
          `select 1 from public.case_documents cd join public.documents d on d.id = cd.document_id
           where cd.document_id = $1::uuid and cd.legal_case_id = $2::uuid and d.deleted_at is null`,
          [documento_id, run.legal_case_id])
        if (!doc) return erro('documento_id não é documento deste caso.')
      }

      const bytes = new Uint8Array(await readFile(local))
      const checksum = createHash('sha256').update(bytes).digest('hex')
      const documentoId = documento_id ?? randomUUID()
      const versaoId = randomUUID()
      const objeto = (await um<{ nome: string }>(banco,
        `select private.legal_document_object_name($1::uuid, $2::uuid, $3::uuid, $4::text) as nome`,
        [clienteDoCaso, documentoId, versaoId, basename(local)]))!.nome

      // Primeiro o arquivo, depois as linhas: versão no banco sempre tem objeto.
      await ctx.armazenamento.enviar(BUCKET_DOCUMENTOS, objeto, bytes, mime)

      const numero = await banco.transacao(async (tx) => {
        if (!documento_id) {
          await tx.query(
            `insert into public.documents (id, client_id, category, title, description, visibility)
             values ($1::uuid, $2::uuid, $3::text, $4::text, $5::text, 'INTERNAL')`,
            [documentoId, clienteDoCaso, categoria, titulo, descricao ?? null])
          await tx.query(
            `insert into public.case_documents (legal_case_id, document_id, purpose)
             values ($1::uuid, $2::uuid, 'AGENT_DRAFT')`,
            [run.legal_case_id, documentoId])
        }
        const v = await um<{ version_number: number }>(tx,
          `insert into public.document_versions
             (id, document_id, storage_object_name, original_filename, mime_type, file_size, checksum_sha256, source)
           values ($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::bigint, $7::text, 'AGENT')
           returning version_number`,
          [versaoId, documentoId, objeto, basename(local), mime, info.size, checksum])
        await tx.query(
          `insert into public.reviews (legal_case_id, legal_process_id, document_version_id)
           values ($1::uuid, $2::uuid, $3::uuid)`,
          [run.legal_case_id, run.legal_process_id, versaoId])
        await tx.query(
          `update public.agent_runs
              set metadata = jsonb_set(metadata, '{documents}',
                    coalesce(metadata -> 'documents', '[]'::jsonb) || to_jsonb($2::text))
            where id = $1::uuid`,
          [run.id, versaoId])
        return v!.version_number
      })

      ctx.registro.documentos.push(versaoId)
      return texto(`Minuta entregue: documento ${documentoId}, versão ${numero}. Revisão pendente em Revisões.`)
    },
  )

  const leitura = [buscarCliente, verCaso, verProcesso, baixarDocumento, tesesDoAgente, referenciasDoAgente]
  const allowlist = ctx.agente.config.tools
  const liberadas = allowlist.length ? leitura.filter((t) => allowlist.includes(t.name)) : leitura

  return [...liberadas, propor, entregarDocumento] as Ferramenta[]
}
