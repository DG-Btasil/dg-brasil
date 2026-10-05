/**
 * Testes do worker contra o banco V1 de verdade: as mesmas migrations de
 * supabase/migrations, aplicadas no PGlite sobre a simulação do Supabase.
 *
 * O Claude é substituído por um "agente falso" que chama as ferramentas como o
 * modelo faria. Assim se testa tudo que é nosso — fila, ferramentas, gate de
 * revisão, aplicação — sem chamar a API.
 */
import { PGlite } from '@electric-sql/pglite'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { aplicarDecididas } from '../src/aplicar.js'
import { armazenamentoEmMemoria } from '../src/armazenamento.js'
import type { Banco } from '../src/banco.js'
import { lerMensagem, processarMensagem, type Dependencias } from '../src/fila.js'
import type { ContextoExecucao, ExecutarAgente, Ferramenta } from '../src/tipos.js'

const SUPABASE = new URL('../../../supabase/', import.meta.url)

let db: PGlite
let banco: Banco
const armazenamento = armazenamentoEmMemoria()
const ids: Record<string, string> = {}

function bancoPglite(p: PGlite): Banco {
  return {
    query: (sql, params) => p.query(sql, params) as never,
    transacao: (fn) => p.transaction((tx) => fn({ query: (sql, params) => tx.query(sql, params) as never })),
    fechar: () => p.close(),
  }
}

const um = async <T = Record<string, any>>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows[0] as T
const linhas = async <T = Record<string, any>>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows

function deps(executar: ExecutarAgente, extra: Partial<Dependencias> = {}): Dependencias {
  return { banco, armazenamento, executar, worker: 'teste', maxTentativas: 3, vtSegundos: 600, ...extra }
}

/**
 * Roda um agente falso cujas asserções precisam valer. Sem isto, um expect que
 * falha dentro do agente vira "erro do agente" e o worker o trata (reenfileira),
 * escondendo a falha do teste.
 */
async function rodarAgente(fn: (ctx: ContextoExecucao, f: Ferramenta[]) => Promise<void>) {
  let falhaDoTeste: unknown = null
  const desfecho = await processarMensagem(deps(async (ctx, f) => {
    try { await fn(ctx, f) } catch (e) { falhaDoTeste = e; throw e }
    return metricas
  }), await proximaMensagem())
  if (falhaDoTeste) throw falhaDoTeste
  return desfecho
}

/** Chama uma ferramenta como o modelo faria e devolve o texto da resposta. */
async function chamar(ferramentas: Ferramenta[], nome: string, args: Record<string, unknown> = {}) {
  const f = ferramentas.find((x) => x.name === nome)
  if (!f) throw new Error(`ferramenta ${nome} não liberada`)
  // Como o SDK: os argumentos passam pelo schema (com defaults) antes do handler.
  const r = await f.handler(z.object(f.inputSchema).parse(args), {})
  const texto = r.content.map((c: any) => c.text ?? '').join('\n')
  return { texto, erro: !!r.isError }
}

const metricas = { tokensEntrada: 1000, tokensSaida: 200, custoUsd: 0.0123, modelo: 'claude-opus-5-5' }

/** Cria uma execução e a põe na fila; devolve o id da execução. */
async function enfileirar(caso: string | null = ids.casoA!, agente = ids.agente!, versao = ids.versao!) {
  const r = await um<{ id: string }>(
    `insert into agent_runs (agent_id, agent_version_id, legal_case_id, requested_by, metadata)
     values ($1, $2, $3, $4, '{"input":{"pedido":"analisar"}}') returning id`,
    [agente, versao, caso, ids.lucas])
  await db.query(`select private.enqueue_agent_run($1)`, [r.id])
  return r.id
}

async function proximaMensagem() {
  const m = await lerMensagem(banco, 600)
  if (!m) throw new Error('fila vazia')
  return m
}

async function decidir(revisao: string, decisao: 'APPROVE' | 'REJECT', notas?: string) {
  await db.query(`insert into review_decisions (review_id, decision, decided_by, notes) values ($1, $2, $3, $4)`,
    [revisao, decisao, ids.lucas, notas ?? null])
}

const CNJ = (() => {
  const n = '0800500', resto = '2026805' + '0001'
  const dv = 98n - (BigInt(n + resto + '00') % 97n)
  return n + String(dv).padStart(2, '0') + resto
})()

beforeAll(async () => {
  db = new PGlite()
  banco = bancoPglite(db)
  await db.exec(await readFile(new URL('tests/supabase-shim.sql', SUPABASE), 'utf8'))
  for (const f of (await readdir(new URL('migrations/', SUPABASE))).sort()) {
    await db.exec(await readFile(new URL(`migrations/${f}`, SUPABASE), 'utf8'))
  }

  ids.owner = (await um(`select id from organizations where type = 'OWNER'`)).id
  ids.banking = (await um(`select id from legal_areas where code = 'BANKING'`)).id
  ids.almeida = (await um(`insert into organizations (type, name) values ('PARTNER', 'Almeida') returning id`)).id
  await db.query(`insert into partner_office_settings values ($1, 'PARTNER', 50, 50)`, [ids.almeida])

  ids.lucas = (await um(`insert into auth.users (email, raw_user_meta_data)
    values ('lucas@exemplo.com', '{"full_name":"Lucas"}') returning id`)).id
  await db.query(`insert into organization_memberships (organization_id, user_id, role) values ($1, $2, 'LAWYER')`,
    [ids.owner, ids.lucas])

  async function cliente(cpf: string, nome: string) {
    const c = (await um(`insert into clients (kind, cpf, origin_organization_id) values ('INDIVIDUAL', $1, $2) returning id`,
      [cpf, ids.owner])).id
    await db.query(`insert into individual_client_details (client_id, full_name) values ($1, $2)`, [c, nome])
    return c
  }
  ids.joao = await cliente('12345678901', 'João da Silva')
  ids.maria = await cliente('98765432100', 'Maria Souza')

  // Caso A: de parceiro, ainda em análise. Caso B: de outro cliente. Caso C: já aceito.
  ids.casoA = (await um(`insert into legal_cases (client_id, legal_area_id, title, status, partner_organization_id,
      origin_organization_id, created_by_organization_id, submitted_at)
    values ($1, $2, 'Consignado BMG', 'SUBMITTED', $3, $3, $3, now()) returning id`,
    [ids.joao, ids.banking, ids.almeida])).id
  ids.casoB = (await um(`insert into legal_cases (client_id, legal_area_id, title, origin_organization_id, created_by_organization_id)
    values ($1, $2, 'Caso da Maria', $3, $3) returning id`, [ids.maria, ids.banking, ids.owner])).id
  ids.casoC = (await um(`insert into legal_cases (client_id, legal_area_id, title, status, origin_organization_id,
      created_by_organization_id, accepted_at, assigned_lawyer_id)
    values ($1, $2, 'Caso aceito', 'ACCEPTED', $3, $3, now(), $4) returning id`,
    [ids.joao, ids.banking, ids.owner, ids.lucas])).id
  ids.processoA = (await um(`insert into legal_processes (legal_case_id, cnj_number, status) values ($1, $2, 'ACTIVE') returning id`,
    [ids.casoA, CNJ])).id

  // Documento do cliente, já no Storage, para baixar_documento.
  ids.docHiscon = (await um(`insert into documents (client_id, category, title) values ($1, 'BENEFIT_STATEMENT', 'HISCON') returning id`,
    [ids.joao])).id
  await db.query(`insert into case_documents (legal_case_id, document_id) values ($1, $2)`, [ids.casoA, ids.docHiscon])
  ids.versaoHiscon = '11111111-1111-4111-8111-111111111111'
  const objeto = `clients/${ids.joao}/documents/${ids.docHiscon}/${ids.versaoHiscon}/hiscon.pdf`
  await db.query(`insert into document_versions (id, document_id, storage_object_name, original_filename, source)
    values ($1, $2, $3, 'hiscon.pdf', 'UPLOAD')`, [ids.versaoHiscon, ids.docHiscon, objeto])
  await armazenamento.enviar('legal-documents', objeto, new TextEncoder().encode('EXTRATO HISCON'), 'application/pdf')

  // Agente com uma skill e uma tese vinculadas.
  ids.agente = (await um(`insert into agents (slug, name, status) values ('analise-bancaria', 'Análise bancária', 'ACTIVE') returning id`)).id
  ids.versao = (await um(`insert into agent_versions (agent_id, instructions, configuration)
    values ($1, 'Você analisa casos de consignado.', '{"model":"claude-opus-5-5","max_turns":20}') returning id`, [ids.agente])).id
  await db.query(`update agents set current_version_id = $2 where id = $1`, [ids.agente, ids.versao])

  const skill = (await um(`insert into skills (slug, name, status) values ('roteiro-hiscon', 'Roteiro HISCON', 'ACTIVE') returning id`)).id
  const sv = (await um(`insert into skill_versions (skill_id, instructions) values ($1, 'Leia o HISCON linha a linha.') returning id`, [skill])).id
  await db.query(`update skills set current_version_id = $2 where id = $1`, [skill, sv])
  await db.query(`insert into agent_skill_bindings (agent_id, skill_id) values ($1, $2)`, [ids.agente, skill])

  const tese = (await um(`insert into legal_theses (legal_area_id, slug, title, status) values ($1, 'tese-quitacao', 'Tese da Quitação', 'ACTIVE') returning id`, [ids.banking])).id
  const tv = (await um(`insert into legal_thesis_versions (legal_thesis_id, foundations) values ($1, 'Art. 320 CC') returning id`, [tese])).id
  await db.query(`update legal_theses set current_version_id = $2 where id = $1`, [tese, tv])
  await db.query(`insert into agent_thesis_bindings (agent_id, legal_thesis_id) values ($1, $2)`, [ids.agente, tese])
}, 120_000)

// ═══════════════════════════════════════════════════════════════════════════

describe('execução completa', () => {
  let runId: string
  let ctxVisto: ContextoExecucao

  it('lê a fila, roda o agente e manda proposta e minuta para Revisões', async () => {
    runId = await enfileirar()

    const desfecho = await rodarAgente(async (ctx, ferramentas) => {
      ctxVisto = ctx
      const caso = await chamar(ferramentas, 'ver_caso', { caso_id: ids.casoA })
      expect(caso.texto).toContain('Consignado BMG')
      expect(caso.texto).toContain('HISCON')

      const cliente = await chamar(ferramentas, 'buscar_cliente', { termo: '12345678901' })
      expect(cliente.texto).toContain('João da Silva')

      const baixado = await chamar(ferramentas, 'baixar_documento', { versao_id: ids.versaoHiscon })
      const caminho = baixado.texto.replace('Baixado em: ', '')
      expect(await readFile(caminho, 'utf8')).toBe('EXTRATO HISCON')

      expect((await chamar(ferramentas, 'teses_do_agente')).texto).toContain('Art. 320 CC')
      expect((await chamar(ferramentas, 'ver_processo', { processo_id: ids.processoA })).texto).toContain(CNJ)

      const proposta = await chamar(ferramentas, 'propor', {
        tipo: 'CREATE_DEADLINE',
        resumo: 'Abrir prazo de réplica de 15 dias úteis',
        payload: { title: 'Réplica', due_at: '2026-10-26T23:59:00-03:00', priority: 'HIGH', legal_process_id: ids.processoA },
        prioridade: 'HIGH',
      })
      expect(proposta.erro).toBe(false)

      await writeFile(join(ctx.scratch, 'minuta.md'), '# Petição inicial\n\nTexto da minuta.')
      const minuta = await chamar(ferramentas, 'entregar_documento', {
        caminho: 'minuta.md', titulo: 'Petição inicial', categoria: 'PETITION',
      })
      expect(minuta.erro).toBe(false)
    })
    expect(desfecho).toBe('aguardando_humano')
  })

  it('a skill vinculada entra nas instruções do agente', () => {
    expect(ctxVisto.agente.skills).toEqual([{ slug: 'roteiro-hiscon', instructions: 'Leia o HISCON linha a linha.' }])
    expect(ctxVisto.agente.config.max_turns).toBe(20)
  })

  it('a execução fica WAITING_HUMAN com métricas e sem conteúdo no metadata', async () => {
    const r = await um(`select * from agent_runs where id = $1`, [runId])
    expect(r.status).toBe('WAITING_HUMAN')
    expect(Number(r.input_tokens)).toBe(1000)
    expect(Number(r.estimated_cost)).toBeCloseTo(0.0123)
    expect(r.model).toBe('claude-opus-5-5')
    expect(r.metadata.proposals).toHaveLength(1)
    expect(r.metadata.documents).toHaveLength(1)
    const texto = JSON.stringify(r.metadata)
    expect(texto).not.toContain('12345678901')
    expect(texto).not.toContain('João')
  })

  it('a mensagem foi arquivada', async () => {
    expect(await lerMensagem(banco, 600)).toBeNull()
    const m = await linhas(`select archived_at from pgmq.messages where message->>'agent_run_id' = $1`, [runId])
    expect(m[0]!.archived_at).not.toBeNull()
  })

  it('a proposta está PENDING com revisão PENDING; nada foi aplicado', async () => {
    const p = await um(`select p.status, p.payload, r.status as revisao, r.priority
                        from agent_proposals p join reviews r on r.agent_proposal_id = p.id
                        where p.agent_run_id = $1`, [runId])
    expect([p.status, p.revisao, p.priority]).toEqual(['PENDING', 'PENDING', 'HIGH'])
    expect(p.payload.summary).toBe('Abrir prazo de réplica de 15 dias úteis')
    expect(await aplicarDecididas(banco)).toBe(0)
    expect(await linhas(`select 1 from deadlines`)).toHaveLength(0)
  })

  it('a minuta é documento INTERNAL, versão AGENT, no Storage, com revisão pendente', async () => {
    const d = await um(`select d.visibility, v.source, v.storage_object_name, v.checksum_sha256, r.status as revisao
                        from documents d
                        join document_versions v on v.document_id = d.id
                        join reviews r on r.document_version_id = v.id
                        join case_documents cd on cd.document_id = d.id and cd.legal_case_id = $1
                        where d.title = 'Petição inicial'`, [ids.casoA])
    expect([d.visibility, d.source, d.revisao]).toEqual(['INTERNAL', 'AGENT', 'PENDING'])
    expect(d.checksum_sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(armazenamento.objetos.has(`legal-documents/${d.storage_object_name}`)).toBe(true)
  })

  it('humano aprova → o worker cria o prazo, marca APPLIED e encerra a execução', async () => {
    const rev = await um(`select r.id from reviews r join agent_proposals p on p.id = r.agent_proposal_id
                          where p.agent_run_id = $1`, [runId])
    await decidir(rev.id, 'APPROVE')
    expect(await aplicarDecididas(banco)).toBe(1)

    const prazo = await um(`select title, source, priority, legal_process_id from deadlines`)
    expect(prazo).toMatchObject({ title: 'Réplica', source: 'AGENT', priority: 'HIGH', legal_process_id: ids.processoA })

    const p = await um(`select status, applied_at from agent_proposals where agent_run_id = $1`, [runId])
    expect(p.status).toBe('APPLIED')
    expect(p.applied_at).not.toBeNull()
    expect((await um(`select status from agent_runs where id = $1`, [runId])).status).toBe('COMPLETED')

    const ev = await linhas(`select action from audit_events where request_id = $1 order by created_at`, [runId])
    expect(ev.map((e) => e.action)).toEqual(expect.arrayContaining(['AGENT_PROPOSAL_APPROVED', 'AGENT_PROPOSAL_APPLIED', 'AGENT_PROPOSAL_EFFECT']))
  })
})

// ═══════════════════════════════════════════════════════════════════════════

describe('o gate humano', () => {
  async function rodarPropondo(caso: string, tipo: string, payload: Record<string, unknown>) {
    const runId = await enfileirar(caso)
    await rodarAgente(async (_ctx, f) => {
      const r = await chamar(f, 'propor', { tipo, resumo: 'Proposta de teste do gate', payload })
      expect(r.erro, r.texto).toBe(false)
    })
    const rev = await um(`select r.id, p.id as proposta from reviews r join agent_proposals p on p.id = r.agent_proposal_id
                          where p.agent_run_id = $1`, [runId])
    return { runId, revisao: rev.id as string, proposta: rev.proposta as string }
  }

  it('humano rejeita → proposta REJECTED e nada muda no caso', async () => {
    const { revisao, proposta, runId } = await rodarPropondo(ids.casoA!, 'UPDATE_CASE', { status: 'READY_FOR_ANALYSIS' })
    await decidir(revisao, 'REJECT', 'Ainda faltam documentos')
    expect(await aplicarDecididas(banco)).toBe(1)
    expect((await um(`select status from agent_proposals where id = $1`, [proposta])).status).toBe('REJECTED')
    expect((await um(`select status from legal_cases where id = $1`, [ids.casoA])).status).toBe('SUBMITTED')
    expect((await um(`select status from agent_runs where id = $1`, [runId])).status).toBe('COMPLETED')
  })

  it('aplicação que falha fica FAILED com o erro visível, sem efeito parcial', async () => {
    const { revisao, proposta } = await rodarPropondo(ids.casoC!, 'UPDATE_CASE', { title: 'Título novo' })
    await decidir(revisao, 'APPROVE')
    expect(await aplicarDecididas(banco)).toBe(1)
    const p = await um(`select status, application_error from agent_proposals where id = $1`, [proposta])
    expect(p.status).toBe('FAILED')
    expect(p.application_error).toMatch(/já foi decidido/)
    expect((await um(`select title from legal_cases where id = $1`, [ids.casoC])).title).toBe('Caso aceito')
  })

  it('o worker não consegue aprovar proposta sem revisão aprovada', async () => {
    const { proposta } = await rodarPropondo(ids.casoA!, 'OTHER', { description: 'Ligar para o cliente e confirmar endereço' })
    await expect(db.query(`update agent_proposals set status = 'APPROVED' where id = $1`, [proposta]))
      .rejects.toThrow(/revisão humana aprovada/)
  })

  it('REQUEST_DOCUMENT em caso de parceiro vira pendência e solicitação ao parceiro', async () => {
    const { revisao } = await rodarPropondo(ids.casoA!, 'REQUEST_DOCUMENT', {
      category: 'BANK_STATEMENT', label: 'Extrato bancário de 2023', message_to_partner: 'Precisamos do extrato de 2023.',
    })
    await decidir(revisao, 'APPROVE')
    await aplicarDecididas(banco)
    const req = await um(`select status from case_document_requirements where requirement_label = 'Extrato bancário de 2023'`)
    expect(req.status).toBe('REQUESTED')
    const pedido = await um(`select partner_organization_id, type from partner_requests where title = 'Extrato bancário de 2023'`)
    expect(pedido).toMatchObject({ partner_organization_id: ids.almeida, type: 'DOCUMENT' })
  })

  it('UPDATE_AGENT aprovado cria versão nova do agente e a torna corrente', async () => {
    const runId = await enfileirar(null)
    await rodarAgente(async (_ctx, f) => {
      const r = await chamar(f, 'propor', {
        tipo: 'UPDATE_AGENT', resumo: 'Reforçar a conferência do HISCON',
        payload: { agent_slug: 'analise-bancaria', instructions: 'Você analisa casos de consignado com rigor redobrado.', configuration: { max_turns: 30 } },
      })
      expect(r.erro, r.texto).toBe(false)
    })
    const rev = await um(`select r.id, r.legal_case_id from reviews r join agent_proposals p on p.id = r.agent_proposal_id
                          where p.agent_run_id = $1`, [runId])
    expect(rev.legal_case_id).toBeNull()  // revisão sem caso: alvo é proposta
    await decidir(rev.id, 'APPROVE')
    await aplicarDecididas(banco)
    const a = await um(`select v.version_number, v.configuration from agents a join agent_versions v on v.id = a.current_version_id
                        where a.slug = 'analise-bancaria'`)
    expect(a.version_number).toBe(2)
    expect(a.configuration.max_turns).toBe(30)
    // Volta a versão 1 para os testes seguintes usarem a mesma configuração.
    await db.query(`update agents set current_version_id = $2 where id = $1`, [ids.agente, ids.versao])
  })
})

// ═══════════════════════════════════════════════════════════════════════════

describe('limites das ferramentas', () => {
  async function comFerramentas(caso: string | null, fn: (f: Ferramenta[], ctx: ContextoExecucao) => Promise<void>) {
    await enfileirar(caso)
    await rodarAgente((ctx, f) => fn(f, ctx))
  }

  it('payload inválido volta como erro para o agente e nada é gravado', async () => {
    const antes = (await um(`select count(*)::int n from agent_proposals`)).n
    await comFerramentas(ids.casoA!, async (f) => {
      const r = await chamar(f, 'propor', { tipo: 'CREATE_DEADLINE', resumo: 'Prazo sem data nenhuma', payload: { title: 'Réplica' } })
      expect(r.erro).toBe(true)
      expect(r.texto).toMatch(/Payload inválido/)
    })
    expect((await um(`select count(*)::int n from agent_proposals`)).n).toBe(antes)
  })

  it('agente não propõe aceitar o caso (decisão humana)', async () => {
    await comFerramentas(ids.casoA!, async (f) => {
      const r = await chamar(f, 'propor', { tipo: 'UPDATE_CASE', resumo: 'Aceitar o caso imediatamente', payload: { status: 'ACCEPTED' } })
      expect(r.erro).toBe(true)
    })
  })

  it('ação de caso numa execução sem caso é recusada', async () => {
    await comFerramentas(null, async (f) => {
      const r = await chamar(f, 'propor', {
        tipo: 'CREATE_DEADLINE', resumo: 'Prazo solto, sem caso', payload: { title: 'x', due_at: '2026-11-01T00:00:00Z' },
      })
      expect(r.erro).toBe(true)
      expect(r.texto).toMatch(/ligada a um caso/)
    })
  })

  it('processo de outro caso é recusado', async () => {
    const outro = (await um(`insert into legal_processes (legal_case_id, status) values ($1, 'PREPARING') returning id`, [ids.casoB])).id
    await comFerramentas(ids.casoA!, async (f) => {
      const r = await chamar(f, 'propor', {
        tipo: 'CREATE_DEADLINE', resumo: 'Prazo no processo errado', payload: { title: 'x', due_at: '2026-11-01T00:00:00Z', legal_process_id: outro },
      })
      expect(r.erro).toBe(true)
    })
  })

  it('execução de um caso não lê cliente, caso nem documento de outro cliente', async () => {
    await comFerramentas(ids.casoA!, async (f) => {
      expect((await chamar(f, 'buscar_cliente', { termo: '98765432100' })).texto).toMatch(/Nenhum cliente/)
      expect((await chamar(f, 'buscar_cliente', { termo: 'Maria' })).texto).toMatch(/Nenhum cliente/)
      expect((await chamar(f, 'ver_caso', { caso_id: ids.casoB })).texto).toMatch(/não encontrado/)
    })
  })

  it('entregar_documento recusa arquivo fora do diretório de trabalho', async () => {
    await comFerramentas(ids.casoA!, async (f) => {
      const r = await chamar(f, 'entregar_documento', { caminho: '../../etc/passwd.txt', titulo: 'Arquivo de fora', categoria: 'OTHER' })
      expect(r.erro).toBe(true)
      expect(r.texto).toMatch(/dentro do diretório de trabalho/)
    })
  })

  it('a allowlist da versão restringe as ferramentas de leitura, mas não as de escrita', async () => {
    const v = (await um(`insert into agent_versions (agent_id, instructions, configuration)
      values ($1, 'Só lê o caso.', '{"tools":["ver_caso"]}') returning id`, [ids.agente])).id
    await enfileirar(ids.casoA!, ids.agente!, v)
    let nomes: string[] = []
    await processarMensagem(deps(async (_ctx, f) => { nomes = f.map((x) => x.name); return metricas }), await proximaMensagem())
    expect(nomes.sort()).toEqual(['entregar_documento', 'propor', 'ver_caso'])
  })
})

// ═══════════════════════════════════════════════════════════════════════════

describe('falhas e novas tentativas', () => {
  const quebrado: ExecutarAgente = async () => { throw new Error('API indisponível') }
  const reaparecer = () => db.query(`update pgmq.messages set vt = now() where archived_at is null`)

  it('erro do agente devolve à fila com espera; esgotadas as tentativas, FAILED', async () => {
    const runId = await enfileirar()
    const d = deps(quebrado, { maxTentativas: 2 })

    expect(await processarMensagem(d, await proximaMensagem())).toBe('reenfileirada')
    let r = await um(`select status, error_code, error_message from agent_runs where id = $1`, [runId])
    expect(r).toMatchObject({ status: 'QUEUED', error_code: 'AGENT_ERROR', error_message: 'API indisponível' })
    expect(await lerMensagem(banco, 600)).toBeNull()  // invisível durante a espera

    await reaparecer()
    expect(await processarMensagem(d, await proximaMensagem())).toBe('falhou')
    r = await um(`select status, completed_at from agent_runs where id = $1`, [runId])
    expect(r.status).toBe('FAILED')
    expect(r.completed_at).not.toBeNull()
    expect(await lerMensagem(banco, 600)).toBeNull()
  })

  it('falha depois de gerar proposta não é refeita (PARTIAL_OUTPUT)', async () => {
    const runId = await enfileirar()
    const desfecho = await processarMensagem(deps(async (_ctx, f) => {
      await chamar(f, 'propor', { tipo: 'OTHER', resumo: 'Proposta antes de cair', payload: { description: 'Conferir assinatura do contrato' } })
      throw new Error('caiu no meio')
    }), await proximaMensagem())
    expect(desfecho).toBe('falhou')
    const r = await um(`select status, error_code from agent_runs where id = $1`, [runId])
    expect(r).toEqual({ status: 'FAILED', error_code: 'PARTIAL_OUTPUT' })
  })

  it('worker que morreu no meio: a mensagem reaparece e não duplica o que já foi gerado', async () => {
    const runId = await enfileirar()
    // Simula o primeiro worker: marcou RUNNING, gerou uma proposta e morreu sem arquivar.
    await proximaMensagem()
    await db.query(`update agent_runs set status = 'RUNNING', started_at = now() where id = $1`, [runId])
    await db.query(`insert into agent_proposals (agent_run_id, legal_case_id, proposal_type, payload)
      values ($1, $2, 'OTHER', '{"summary":"x","data":{"description":"proposta órfã de teste"}}')`, [runId, ids.casoA])
    await reaparecer()

    let rodou = false
    const desfecho = await processarMensagem(deps(async () => { rodou = true; return metricas }), await proximaMensagem())
    expect(desfecho).toBe('falhou')
    expect(rodou).toBe(false)
    expect((await um(`select error_code from agent_runs where id = $1`, [runId])).error_code).toBe('PARTIAL_OUTPUT')
  })

  it('agente inativo falha de vez, sem nova tentativa', async () => {
    const runId = await enfileirar()
    await db.query(`update agents set status = 'INACTIVE' where id = $1`, [ids.agente])
    try {
      expect(await processarMensagem(deps(async () => metricas), await proximaMensagem())).toBe('falhou')
      expect((await um(`select error_code from agent_runs where id = $1`, [runId])).error_code).toBe('AGENT_INACTIVE')
    } finally {
      await db.query(`update agents set status = 'ACTIVE' where id = $1`, [ids.agente])
    }
  })

  it('mensagem de execução cancelada é descartada', async () => {
    const runId = await enfileirar()
    await db.query(`update agent_runs set status = 'CANCELLED' where id = $1`, [runId])
    let rodou = false
    expect(await processarMensagem(deps(async () => { rodou = true; return metricas }), await proximaMensagem())).toBe('ignorada')
    expect(rodou).toBe(false)
  })

  it('mensagem fora do contrato é descartada', async () => {
    await db.query(`select pgmq.send('agent_execution', '{"qualquer":"coisa"}'::jsonb)`)
    expect(await processarMensagem(deps(async () => metricas), await proximaMensagem())).toBe('ignorada')
    expect(await lerMensagem(banco, 600)).toBeNull()
  })
})
