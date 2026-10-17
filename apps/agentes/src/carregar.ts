import { createHash } from 'node:crypto'
import type { Armazenamento } from './armazenamento.js'
import { um, type Banco } from './banco.js'
import { ErroExecucao } from './erros.js'
import type { AIProvider, SkillNoProvedor } from './provedor/tipos.js'
import { ConfigAgente, type AgenteCarregado, type AgentRun, type ArquivoSkill, type SkillCarregada } from './tipos.js'

/**
 * Configuração de IA (agente, versão, skills, arquivos de skill): leitura
 * direta das tabelas de configuração, que não têm dado de cliente (o
 * dg_worker tem SELECT só nelas). Dado de cliente: só por private.worker_*.
 */

const BUCKET_SKILLS = 'skill-files'
/** Limite do provedor: 20 skills por execução. */
const MAX_SKILLS = 20

export async function carregarAgente(banco: Banco, run: AgentRun, skillsDoTemplate: string[] = []): Promise<AgenteCarregado> {
  const a = await um<{
    id: string; slug: string; name: string; status: string; deleted_at: string | null
    instructions: string; configuration: unknown
  }>(
    banco,
    `select a.id, a.slug, a.name, a.status, a.deleted_at, v.instructions, v.configuration
     from public.agents a
     join public.agent_versions v on v.id = $2::uuid and v.agent_id = a.id
     where a.id = $1::uuid`,
    [run.agent_id, run.agent_version_id],
  )
  if (!a) throw new ErroExecucao('CONFIGURATION_ERROR', 'agente ou versão não encontrados')
  if (a.status !== 'ACTIVE' || a.deleted_at) throw new ErroExecucao('CONFIGURATION_ERROR', `agente ${a.slug} não está ativo`)

  const config = ConfigAgente.safeParse(a.configuration ?? {})
  if (!config.success) {
    throw new ErroExecucao('CONFIGURATION_ERROR', `configuração da versão inválida: ${config.error.issues[0]?.message ?? ''}`)
  }

  const { rows } = await banco.query<{
    id: string; slug: string; name: string; description: string | null; version_id: string; version_number: number
    instructions: string; origem: 'agente' | 'template'
    provider_skill_id: string | null; provider_version_id: string | null; provider_skill_anterior: string | null
  }>(
    `with escolhidas as (
       select b.skill_id, 'agente'::text as origem from public.agent_skill_bindings b
       where b.agent_id = $1::uuid and b.enabled
       union
       select s, 'template' from unnest($2::uuid[]) s
     )
     select s.id, s.slug, s.name, s.description, sv.id as version_id, sv.version_number, sv.instructions,
            min(e.origem) as origem,
            pv.provider_skill_id, pv.provider_version_id,
            (select p2.provider_skill_id from public.skill_provider_versions p2
             where p2.skill_id = s.id order by p2.created_at desc limit 1) as provider_skill_anterior
     from escolhidas e
     join public.skills s on s.id = e.skill_id
     join public.skill_versions sv on sv.id = s.current_version_id
     left join public.skill_provider_versions pv on pv.skill_version_id = sv.id
     where s.status = 'ACTIVE' and s.deleted_at is null
     group by s.id, s.slug, s.name, s.description, sv.id, sv.version_number, sv.instructions,
              pv.provider_skill_id, pv.provider_version_id
     order by s.slug`,
    [a.id, skillsDoTemplate],
  )
  if (rows.length > MAX_SKILLS) {
    throw new ErroExecucao('CONFIGURATION_ERROR', `mais de ${MAX_SKILLS} skills para a execução`)
  }

  const arquivos = rows.length
    ? (await banco.query<ArquivoSkill & { skill_version_id: string }>(
      `select skill_version_id, path, storage_object_name, mime_type, file_size::int as file_size, checksum_sha256
       from public.skill_version_files where skill_version_id = any ($1::uuid[]) order by path`,
      [rows.map((r) => r.version_id)])).rows
    : []

  const skills: SkillCarregada[] = rows.map((r) => ({
    id: r.id, slug: r.slug, name: r.name, description: r.description,
    versionId: r.version_id, versionNumber: r.version_number, instructions: r.instructions, origem: r.origem,
    arquivos: arquivos.filter((f) => f.skill_version_id === r.version_id).map(({ skill_version_id: _s, ...f }) => f),
    noProvedor: r.provider_skill_id && r.provider_version_id
      ? { providerSkillId: r.provider_skill_id, providerVersionId: r.provider_version_id }
      : null,
    providerSkillIdAnterior: r.provider_skill_anterior,
  }))

  return {
    id: a.id, slug: a.slug, name: a.name, versionId: run.agent_version_id,
    instructions: a.instructions, config: config.data, skills,
  }
}

/**
 * Garante que cada versão de skill está no provedor e registra (uma vez) a
 * versão de lá. Versão já registrada não é reenviada. A gravação no banco
 * exige a reserva desta execução (private.worker_register_skill_upload).
 */
export async function prepararSkills(
  deps: { banco: Banco; armazenamento: Armazenamento; provedor: AIProvider; worker: string },
  runId: string,
  skills: SkillCarregada[],
): Promise<SkillNoProvedor[]> {
  const prontas: SkillNoProvedor[] = []
  for (const s of skills) {
    if (s.noProvedor) {
      prontas.push(s.noProvedor)
      continue
    }
    const arquivos = []
    for (const f of s.arquivos) {
      const bytes = await deps.armazenamento.baixar(BUCKET_SKILLS, f.storage_object_name)
      const sha = createHash('sha256').update(bytes).digest('hex')
      if (sha !== f.checksum_sha256) {
        throw new ErroExecucao('CONFIGURATION_ERROR', `arquivo ${f.path} da skill ${s.slug} não confere com o registrado`)
      }
      arquivos.push({ caminho: f.path, mime: f.mime_type, bytes })
    }
    const bundle = createHash('sha256')
      .update(s.instructions).update(s.description ?? '')
      .update(s.arquivos.map((f) => `${f.path}:${f.checksum_sha256}`).join('|'))
      .digest('hex')

    const no = await deps.provedor.garantirSkill({
      nome: s.slug,
      descricao: s.description ?? s.name,
      instrucoes: s.instructions,
      arquivos,
      providerSkillIdExistente: s.providerSkillIdAnterior ?? undefined,
    })
    // A primeira gravação vale (outra execução pode ter enviado a mesma versão).
    const r = (await um<{ provider_skill_id: string; provider_version_id: string }>(deps.banco,
      `select provider_skill_id, provider_version_id
       from private.worker_register_skill_upload($1::uuid, $2::text, $3::uuid, $4::text, $5::text, $6::text, $7::text)`,
      [runId, deps.worker, s.versionId, no.providerSkillId, no.nome, no.providerVersionId, bundle]))!
    s.noProvedor = { providerSkillId: r.provider_skill_id, providerVersionId: r.provider_version_id }
    prontas.push(s.noProvedor)
  }
  return prontas
}
