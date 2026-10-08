import { tool } from '@anthropic-ai/claude-agent-sdk'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, relative, resolve, isAbsolute } from 'node:path'
import { z } from 'zod'
import { um } from './banco.js'
import { EXIGE_CASO, TIPOS_PROPOSTA, chaveIdempotencia, validarPayload, type PayloadGravado } from './propostas.js'
import { ConfigAgente, type ContextoExecucao, type Ferramenta } from './tipos.js'

/**
 * As ferramentas que o agente enxerga do sistema.
 *
 * Regra estrutural: muitas de LEITURA e duas de escrita, ambas presas a uma
 * revisão humana:
 *
 * Dado de cliente só chega por funções private.worker_* (escopadas à execução).
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
  const { banco, run, worker, clienteDoCaso } = ctx

  // ── leitura ──────────────────────────────────────────────────────────────
  // Dado de cliente só por funções private.worker_*: o banco confere a reserva
  // desta execução e devolve só o que é do caso dela.

  const buscarCliente = tool(
    'buscar_cliente',
    'Busca cliente por CPF/CNPJ (só dígitos) ou por parte do nome. Retorna cadastro básico e casos. ' +
      'Só encontra o cliente do caso desta execução.',
    { termo: z.string().min(3).describe('CPF, CNPJ ou parte do nome (mínimo 3 caracteres)') },
    async ({ termo }) => {
      const r = await um<{ c: unknown[] }>(banco,
        `select private.worker_find_client($1::uuid, $2::text, $3::text) as c`, [run.id, worker, termo])
      return r?.c?.length ? json(r.c) : texto('Nenhum cliente encontrado.')
    },
    { annotations: { readOnlyHint: true } },
  )

  const verCaso = tool(
    'ver_caso',
    'Abre o caso desta execução: cliente, processos, prazos abertos, documentos (com a situação de aprovação ' +
      'e de verificação da última versão) e pendências de documento.',
    { caso_id: z.string().uuid() },
    async ({ caso_id }) => {
      const r = await um<{ c: unknown }>(banco,
        `select private.worker_get_case($1::uuid, $2::text, $3::uuid) as c`, [run.id, worker, caso_id])
      return r?.c ? json(r.c) : texto('Caso não encontrado (ou fora do escopo desta execução).')
    },
    { annotations: { readOnlyHint: true } },
  )

  const verProcesso = tool(
    'ver_processo',
    'Abre um processo do caso desta execução: dados, partes e as últimas movimentações.',
    {
      processo_id: z.string().uuid(),
      movimentacoes: z.number().int().min(1).max(200).default(50),
    },
    async ({ processo_id, movimentacoes }) => {
      const r = await um<{ p: unknown }>(banco,
        `select private.worker_get_process($1::uuid, $2::text, $3::uuid, $4::int) as p`,
        [run.id, worker, processo_id, movimentacoes])
      return r?.p ? json(r.p) : texto('Processo não encontrado (ou fora do escopo desta execução).')
    },
    { annotations: { readOnlyHint: true } },
  )

  const baixarDocumento = tool(
    'baixar_documento',
    'Baixa uma versão de documento do caso para o diretório de trabalho e devolve o caminho local, ' +
      'para você ler com Read. Use o ultima_versao_id que ver_caso devolve.',
    { versao_id: z.string().uuid() },
    async ({ versao_id }) => {
      const v = await um<{ storage_object_name: string; original_filename: string | null; file_size: string | null }>(
        banco,
        `select storage_object_name, original_filename, file_size
         from private.worker_get_document_version($1::uuid, $2::text, $3::uuid)`,
        [run.id, worker, versao_id],
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
      'CREATE_PROCESS {cnj_number? (20 dígitos), court?, client_side?: ACTIVE|PASSIVE|THIRD_PARTY, ...};',
      'UPDATE_SKILL {skill_slug, instructions};',
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
        // Agente não propõe configuração que o worker não consegue rodar.
        if (tipo === 'UPDATE_AGENT') ConfigAgente.parse(dados.configuration ?? {})
      } catch (e) {
        return erro(`Payload inválido para ${tipo}: ${e instanceof Error ? e.message : String(e)}`)
      }

      const gravado: PayloadGravado = { summary: resumo, data: dados }
      const chave = chaveIdempotencia(tipo, dados)
      let r: { proposal_id: string; created: boolean }
      try {
        // O banco confere a reserva, o caso e o processo, grava proposta e revisão
        // PENDING, e não duplica a mesma proposta (idempotency_key).
        r = (await um<{ proposal_id: string; created: boolean }>(banco,
          `select proposal_id, created
           from private.worker_create_proposal($1::uuid, $2::text, $3::text, $4::jsonb, $5::text, $6::text, $7::uuid)`,
          [run.id, worker, tipo, JSON.stringify(gravado), chave, prioridade ?? 'NORMAL',
           (dados.legal_process_id as string | undefined) ?? null]))!
      } catch (e) {
        return erro(`Proposta recusada: ${e instanceof Error ? e.message : String(e)}`)
      }

      if (!r.created) return texto(`Essa proposta já estava registrada (${r.proposal_id}). Nada foi duplicado.`)
      ctx.registro.propostas.push(r.proposal_id)
      return texto(`Proposta ${r.proposal_id} registrada e enviada para Revisões. Ainda NÃO está aplicada.`)
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
        const doc = await um<{ c: { documentos?: { id: string }[] } | null }>(banco,
          `select private.worker_get_case($1::uuid, $2::text, $3::uuid) as c`, [run.id, worker, run.legal_case_id])
        if (!doc?.c?.documentos?.some((d) => d.id === documento_id)) return erro('documento_id não é documento deste caso.')
      }

      const bytes = new Uint8Array(await readFile(local))
      const checksum = createHash('sha256').update(bytes).digest('hex')
      const documentoId = documento_id ?? randomUUID()
      const versaoId = randomUUID()
      const objeto = (await um<{ nome: string }>(banco,
        `select private.legal_document_object_name($1::uuid, $2::uuid, $3::uuid, $4::text) as nome`,
        [clienteDoCaso, documentoId, versaoId, basename(local)]))!.nome

      // Primeiro o arquivo, depois as linhas: versão no banco sempre tem objeto.
      // (Se o insert falhar, o objeto fica órfão e aparece em find_orphan_storage_objects.)
      await ctx.armazenamento.enviar(BUCKET_DOCUMENTOS, objeto, bytes, mime)

      let numero: number
      try {
        numero = (await um<{ n: number }>(banco,
          `select private.worker_deliver_document($1::uuid, $2::text, $3::uuid, $4::boolean, $5::uuid, $6::text,
                    $7::text, $8::text, $9::text, $10::text, $11::text, $12::bigint, $13::text) as n`,
          [run.id, worker, documentoId, !documento_id, versaoId, categoria, titulo, descricao ?? null,
           objeto, basename(local), mime, info.size, checksum]))!.n
      } catch (e) {
        return erro(`Minuta recusada: ${e instanceof Error ? e.message : String(e)}`)
      }

      ctx.registro.documentos.push(versaoId)
      return texto(`Minuta entregue: documento ${documentoId}, versão ${numero}. Revisão pendente em Revisões.`)
    },
  )

  const leitura = [buscarCliente, verCaso, verProcesso, baixarDocumento, tesesDoAgente, referenciasDoAgente]
  const allowlist = ctx.agente.config.tools
  const liberadas = allowlist.length ? leitura.filter((t) => allowlist.includes(t.name)) : leitura

  return [...liberadas, propor, entregarDocumento] as Ferramenta[]
}
