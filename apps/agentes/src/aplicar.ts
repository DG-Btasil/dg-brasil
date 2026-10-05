import { um, type Banco, type Executor } from './banco.js'
import { ConfigAgente } from './tipos.js'
import { validarPayload, type PayloadGravado, type TipoProposta } from './propostas.js'

/**
 * O outro lado do gate: proposta decidida em Revisões vira fato aqui.
 *
 *  - Revisão REJECTED → proposta REJECTED.
 *  - Revisão APPROVED → proposta APPROVED → aplicador → APPLIED, numa transação,
 *    com a linha travada (for update skip locked): dois workers não aplicam a mesma.
 *    O banco recusa APPROVED sem revisão aprovada; não há atalho por aqui.
 *  - Aplicador que falha deixa a proposta FAILED com o erro em
 *    application_error, visível na tela. Nada fica sem efeito em silêncio.
 *
 * Também aplica proposta que o backend já marcou APPROVED.
 */
export async function aplicarDecididas(banco: Banco, limite = 10): Promise<number> {
  let processadas = 0

  for (let i = 0; i < limite; i++) {
    let falha: { id: string; erro: string } | null = null

    const resultado = await banco.transacao(async (tx) => {
      const p = await um<{
        id: string; agent_run_id: string; legal_case_id: string | null; legal_process_id: string | null
        proposal_type: TipoProposta; payload: PayloadGravado; status: string; review_status: string | null
      }>(tx,
        `select p.id, p.agent_run_id, p.legal_case_id, p.legal_process_id, p.proposal_type,
                p.payload, p.status, r.status as review_status
         from public.agent_proposals p
         left join lateral (
           select rv.status from public.reviews rv
           where rv.agent_proposal_id = p.id
           order by rv.created_at desc limit 1
         ) r on true
         where p.status = 'APPROVED'
            or (p.status = 'PENDING' and r.status in ('APPROVED', 'REJECTED'))
         order by p.created_at
         for update of p skip locked
         limit 1`)
      if (!p) return 'vazio' as const

      await tx.query(`select set_config('dg.request_id', $1::text, true)`, [p.agent_run_id])

      if (p.status === 'PENDING' && p.review_status === 'REJECTED') {
        await tx.query(`update public.agent_proposals set status = 'REJECTED' where id = $1::uuid`, [p.id])
        await fecharExecucaoSeDecidida(tx, p.agent_run_id)
        return 'decidida' as const
      }

      if (p.status === 'PENDING') {
        await tx.query(`update public.agent_proposals set status = 'APPROVED' where id = $1::uuid`, [p.id])
      }

      try {
        await tx.query('savepoint aplicar')
        const alvo = await APLICADORES[p.proposal_type](tx, p.payload.data, p)
        await tx.query('release savepoint aplicar')
        await tx.query(`update public.agent_proposals set status = 'APPLIED' where id = $1::uuid`, [p.id])
        if (alvo) {
          await tx.query(
            `select private.record_audit_event('AGENT_PROPOSAL_EFFECT', $1::text, $2::uuid, $3::jsonb)`,
            [alvo.tabela, alvo.id, JSON.stringify({ agent_proposal_id: p.id, proposal_type: p.proposal_type })],
          )
        }
      } catch (e) {
        await tx.query('rollback to savepoint aplicar')
        falha = { id: p.id, erro: e instanceof Error ? e.message : String(e) }
        await tx.query(
          `update public.agent_proposals set status = 'FAILED', application_error = $2::text where id = $1::uuid`,
          [p.id, falha.erro.slice(0, 2000)],
        )
      }

      await fecharExecucaoSeDecidida(tx, p.agent_run_id)
      return 'decidida' as const
    })

    if (resultado === 'vazio') break
    processadas++
    if (falha) console.error(`proposta ${(falha as { id: string }).id} falhou ao aplicar:`, (falha as { erro: string }).erro)
  }

  return processadas
}

/** Execução que esperava humano termina quando nenhuma proposta dela está pendente. */
async function fecharExecucaoSeDecidida(tx: Executor, runId: string) {
  await tx.query(
    `update public.agent_runs
        set status = 'COMPLETED', completed_at = now()
      where id = $1::uuid and status = 'WAITING_HUMAN'
        and not exists (select 1 from public.agent_proposals
                        where agent_run_id = $1::uuid and status in ('PENDING', 'APPROVED'))`,
    [runId],
  )
}

type Alvo = { tabela: string; id: string } | null
type Proposta = { id: string; legal_case_id: string | null; legal_process_id: string | null }
type Aplicador = (tx: Executor, dados: Record<string, unknown>, p: Proposta) => Promise<Alvo>

function exigeCaso(p: Proposta): string {
  if (!p.legal_case_id) throw new Error('proposta sem caso')
  return p.legal_case_id
}

const APLICADORES: Record<TipoProposta, Aplicador> = {
  CREATE_DEADLINE: async (tx, dados, p) => {
    const d = validarPayload('CREATE_DEADLINE', dados)
    const r = await um<{ id: string }>(tx,
      `insert into public.deadlines
         (legal_case_id, legal_process_id, title, description, due_at, priority, responsible_user_id, source)
       values ($1::uuid, $2::uuid, $3::text, $4::text, $5::timestamptz, $6::text, $7::uuid, 'AGENT')
       returning id`,
      [exigeCaso(p), d.legal_process_id ?? p.legal_process_id, d.title, d.description ?? null,
       d.due_at, d.priority, d.responsible_user_id ?? null])
    return { tabela: 'deadlines', id: r!.id }
  },

  REQUEST_DOCUMENT: async (tx, dados, p) => {
    const d = validarPayload('REQUEST_DOCUMENT', dados)
    const caso = exigeCaso(p)
    const r = await um<{ id: string }>(tx,
      `insert into public.case_document_requirements
         (legal_case_id, requirement_label, category, required, status, requested_at)
       values ($1::uuid, $2::text, $3::text, $4::boolean, 'REQUESTED', now())
       returning id`,
      [caso, d.label, d.category, d.required])

    // Caso de parceiro: o pedido chega ao parceiro como solicitação.
    if (d.message_to_partner) {
      await tx.query(
        `insert into public.partner_requests
           (partner_organization_id, legal_case_id, type, title, description, due_at)
         select c.partner_organization_id, c.id, 'DOCUMENT', $2::text, $3::text, $4::timestamptz
         from public.legal_cases c
         where c.id = $1::uuid and c.partner_organization_id is not null`,
        [caso, d.label, d.message_to_partner, d.due_at ?? null])
    }
    return { tabela: 'case_document_requirements', id: r!.id }
  },

  UPDATE_CASE: async (tx, dados, p) => {
    const d = validarPayload('UPDATE_CASE', dados)
    const r = await tx.query(
      `update public.legal_cases
          set title = coalesce($2::text, title),
              summary = coalesce($3::text, summary),
              status = coalesce($4::text, status)
        where id = $1::uuid
          and status in ('DRAFT', 'SUBMITTED', 'WAITING_DOCUMENTS', 'READY_FOR_ANALYSIS', 'ANALYZING', 'WAITING_REVIEW')
        returning id`,
      [exigeCaso(p), d.title ?? null, d.summary ?? null, d.status ?? null])
    if (r.rows.length === 0) throw new Error('O caso já foi decidido: agente não altera caso aceito, rejeitado ou encerrado')
    return { tabela: 'legal_cases', id: exigeCaso(p) }
  },

  CREATE_PROCESS: async (tx, dados, p) => {
    const d = validarPayload('CREATE_PROCESS', dados)
    const r = await um<{ id: string }>(tx,
      `insert into public.legal_processes
         (legal_case_id, cnj_number, technical_origin, court, court_unit, district, state,
          legal_class, subject, client_side, adverse_party_summary, case_value, status)
       values ($1::uuid, $2::text, 'AGENT', $3::text, $4::text, $5::text, $6::text,
               $7::text, $8::text, $9::text, $10::text, $11::numeric, 'PREPARING')
       returning id`,
      [exigeCaso(p), d.cnj_number ?? null, d.court ?? null, d.court_unit ?? null, d.district ?? null,
       d.state ?? null, d.legal_class ?? null, d.subject ?? null, d.client_side ?? null,
       d.adverse_party_summary ?? null, d.case_value ?? null])
    return { tabela: 'legal_processes', id: r!.id }
  },

  UPDATE_SKILL: async (tx, dados) => {
    const d = validarPayload('UPDATE_SKILL', dados)
    const s = await um<{ id: string }>(tx,
      `select id from public.skills where slug = $1::text and deleted_at is null`, [d.skill_slug])
    if (!s) throw new Error(`skill ${d.skill_slug} não existe`)
    const v = await um<{ id: string }>(tx,
      `insert into public.skill_versions (skill_id, instructions, configuration)
       values ($1::uuid, $2::text, $3::jsonb) returning id`,
      [s.id, d.instructions, JSON.stringify(d.configuration)])
    await tx.query(`update public.skills set current_version_id = $2::uuid where id = $1::uuid`, [s.id, v!.id])
    return { tabela: 'skills', id: s.id }
  },

  UPDATE_AGENT: async (tx, dados) => {
    const d = validarPayload('UPDATE_AGENT', dados)
    const config = ConfigAgente.parse(d.configuration)  // agente não grava configuração que o worker não roda
    const a = await um<{ id: string }>(tx,
      `select id from public.agents where slug = $1::text and deleted_at is null`, [d.agent_slug])
    if (!a) throw new Error(`agente ${d.agent_slug} não existe`)
    const v = await um<{ id: string }>(tx,
      `insert into public.agent_versions (agent_id, instructions, configuration)
       values ($1::uuid, $2::text, $3::jsonb) returning id`,
      [a.id, d.instructions, JSON.stringify(config)])
    await tx.query(`update public.agents set current_version_id = $2::uuid where id = $1::uuid`, [a.id, v!.id])
    return { tabela: 'agents', id: a.id }
  },

  // Sem efeito automático: aprovar significa que a equipe assume a providência.
  OTHER: async (_tx, dados) => {
    validarPayload('OTHER', dados)
    return null
  },
}
