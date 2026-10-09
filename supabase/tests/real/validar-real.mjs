// Validação do Database V1 contra um Supabase REAL de DESENVOLVIMENTO (Etapa 3.3).
//
//   cd supabase && node --env-file=.env.real tests/real/validar-real.mjs
//
// O que este script exercita (e o PGlite não): Supabase Auth real (usuários,
// trigger on_auth_user_created, sessões e JWT), PostgREST real (RLS e RPCs pelo
// supabase-js, como a aplicação faria), Storage real (buckets privados, signed
// URLs), pgmq real (send/read/set_vt/archive com as assinaturas instaladas) e o
// login real do dg_worker, com dois workers concorrentes de verdade.
//
// Regras:
//   * recusa rodar sem DG_ENV=development;
//   * só dados fictícios: e-mails @dgbrasil.test, CPFs 999xxxxxxxx (fora do
//     padrão de documento real), nomes "Teste";
//   * nunca imprime chave, senha ou URL com credencial;
//   * não apaga nada fora do que ele mesmo criou (prefixo da rodada).
//
// Variáveis (arquivo supabase/.env.real, fora do Git — ver .env.real.example):
//   DG_ENV, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//   SUPABASE_DB_URL (papel postgres, só para montar o cenário e inspecionar
//   catálogo), DG_WORKER_DB_URL (papel dg_worker, do jeito que o Fly.io conecta).

import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import { randomBytes, randomUUID } from 'node:crypto'

// ═════════════════════════════ guarda ════════════════════════════════════

const env = (k, obrigatorio = true) => {
  const v = process.env[k]
  if (obrigatorio && !v) { console.error(`variável ausente: ${k}`); process.exit(2) }
  return v
}
if (env('DG_ENV') !== 'development') {
  console.error('Recusado: DG_ENV precisa ser "development". Este script nunca roda em produção.')
  process.exit(2)
}
const URL_ = env('SUPABASE_URL'), ANON = env('SUPABASE_ANON_KEY'), SERVICE = env('SUPABASE_SERVICE_ROLE_KEY')
const DB_URL = env('SUPABASE_DB_URL'), WORKER_URL = env('DG_WORKER_DB_URL')
const ref = new URL(URL_).hostname.split('.')[0]
const mascara = (s) => (s.length <= 6 ? '***' : `${s.slice(0, 4)}…${s.slice(-2)}`)
const RODADA = `r${Date.now().toString(36)}`

// ═════════════════════════════ relatório ═════════════════════════════════

let falhas = 0, total = 0
const ok = (m) => { total++; console.log(`  \x1b[32m✓\x1b[0m ${m}`) }
const erro = (m, e) => { total++; falhas++; console.log(`  \x1b[31m✗\x1b[0m ${m}`); if (e) console.log(`    ${String(e.message ?? e).split('\n')[0]}`) }
const secao = (t) => console.log(`\n${t}`)
async function deve(m, fn) { try { await fn(); ok(m) } catch (e) { erro(m, e) } }
async function deveOuPara(m, fn) {
  try { await fn(); ok(m) } catch (e) {
    erro(m, e)
    console.log('\n  Interrompido: o cenário de teste não foi montado; nada adiante seria confiável.\n')
    process.exit(1)
  }
}
async function deveFalhar(m, fn, padrao) {
  try { await fn(); erro(`${m} — foi aceito`) }
  catch (e) { if (padrao && !padrao.test(String(e.message ?? e))) erro(`${m} — motivo errado`, e); else ok(m) }
}
const igual = (a, b, r = 'valor') => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${r}: esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`)
}
// supabase-js devolve { data, error }: transforma error em exceção.
const r = async (p) => { const { data, error } = await p; if (error) throw new Error(`${error.code ?? ''} ${error.message}`); return data }

// ═════════════════════════════ conexões ══════════════════════════════════

const adminDb = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } })
await adminDb.connect()
const sql = async (q, p) => (await adminDb.query(q, p)).rows
const um = async (q, p) => (await sql(q, p))[0]
const service = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
const novoCliente = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } })

secao('1. Pré-flight')
console.log(`  projeto: ${mascara(ref)}  host: ${new URL(URL_).hostname.replace(ref, mascara(ref))}`)
// Rodadas anteriores deixam só dados fictícios (CPF 999…). Qualquer outro
// cliente indica que o projeto não é o ambiente limpo de desenvolvimento.
await deveOuPara('banco sem dados que não sejam de teste (ambiente de desenvolvimento)', async () => {
  const n = await um(`select count(*) filter (where coalesce(cpf, '') not like '999%')::int reais,
                             count(*)::int todos from public.clients`)
  if (n.reais > 0) throw new Error(`há ${n.reais} clientes fora do padrão de teste: confira se o projeto é mesmo de desenvolvimento`)
  if (n.todos > 0) console.log(`    ${n.todos} clientes fictícios de rodadas anteriores (ok)`)
})
await deve('migrations 001–019 registradas', async () => {
  const m = await sql(`select version from supabase_migrations.schema_migrations order by version`)
  igual(m.length, 19, 'quantidade')
})

secao('4. Extensões e catálogo real')
await deve('pgmq instalado; fila agent_execution existe', async () => {
  const e = await um(`select extversion v, n.nspname s from pg_extension x join pg_namespace n on n.oid = x.extnamespace where extname = 'pgmq'`)
  if (!e) throw new Error('pgmq ausente')
  console.log(`    pgmq ${e.v} (schema ${e.s})`)
  const q = await sql(`select queue_name from pgmq.list_queues() where queue_name = 'agent_execution'`)
  igual(q.length, 1, 'fila')
})
await deve('assinaturas reais de read/set_vt/archive/send', async () => {
  const f = await sql(`select p.proname, pg_get_function_identity_arguments(p.oid) a from pg_proc p
                       join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'pgmq' and p.proname in ('read','set_vt','archive','send') order by 1, 2`)
  for (const x of f) console.log(`    pgmq.${x.proname}(${x.a})`)
  for (const nome of ['read', 'set_vt', 'archive', 'send']) if (!f.some((x) => x.proname === nome)) throw new Error(`pgmq.${nome} ausente`)
})
await deve('policy restritiva em storage.objects existe (create policy funcionou)', async () => {
  const p = await sql(`select policyname, permissive from pg_policies where schemaname = 'storage' and tablename = 'objects'
                       and policyname = 'dg_private_buckets_no_direct_access'`)
  igual(p.map((x) => x.permissive), ['RESTRICTIVE'], 'policy')
  const o = await um(`select pg_get_userbyid(relowner) dono, relrowsecurity rls from pg_class where oid = 'storage.objects'::regclass`)
  console.log(`    storage.objects: dono ${o.dono}, RLS ${o.rls}`)
})
await deve('trigger on_auth_user_created em auth.users', async () => {
  igual((await sql(`select 1 from pg_trigger where tgname = 'on_auth_user_created' and tgrelid = 'auth.users'::regclass`)).length, 1, 'trigger')
})
await deve('dg_worker: sem superuser, sem BYPASSRLS, com login', async () => {
  const w = await um(`select rolsuper, rolbypassrls, rolcanlogin from pg_roles where rolname = 'dg_worker'`)
  igual([w.rolsuper, w.rolbypassrls, w.rolcanlogin], [false, false, true], 'atributos')
})
await deve('nenhuma coluna de fornecedor (ADVBOX etc.)', async () => {
  igual((await um(`select count(*)::int n from information_schema.columns where table_schema = 'public' and column_name ilike '%advbox%'`)).n, 0, 'colunas')
})

secao('5. Seed estrutural')
await deve('um OWNER (Bárbara Cardoso Advocacia), categorias e áreas', async () => {
  const o = await sql(`select name from organizations where type = 'OWNER' and deleted_at is null`)
  igual(o.map((x) => x.name), ['Bárbara Cardoso Advocacia'], 'owner')
  igual((await um(`select count(*)::int n from document_categories`)).n, 12, 'categorias')
  igual((await um(`select count(*)::int n from legal_areas`)).n, 8, 'áreas')
})

// ═════════════════════════════ Auth real ═════════════════════════════════

secao('6. Auth real: usuários fictícios, trigger e vínculos')
const senha = () => randomBytes(18).toString('base64url')
const papeis = ['ADMIN', 'LAWYER', 'ASSISTANT', 'PARTNER_ADMIN_A', 'PARTNER_USER_A', 'PARTNER_ADMIN_B', 'PARTNER_USER_B', 'LAWYER_2']
const U = {}
for (const p of papeis) {
  await deve(`cria usuário ${p} e o trigger cria o profile`, async () => {
    const email = `${RODADA}.${p.toLowerCase()}@dgbrasil.test`, pass = senha()
    const d = await r(service.auth.admin.createUser({ email, password: pass, email_confirm: true, user_metadata: { full_name: `Teste ${p}` } }))
    U[p] = { id: d.user.id, email, pass }
    const pr = await um(`select full_name from profiles where id = $1`, [d.user.id])
    igual(pr?.full_name, `Teste ${p}`, 'profile')
  })
}

const ids = {}
ids.owner = (await um(`select id from organizations where type = 'OWNER'`)).id
ids.banking = (await um(`select id from legal_areas where code = 'BANKING'`)).id
const temAdmin = (await um(`select count(*)::int n from organization_memberships where role = 'ADMIN' and status = 'ACTIVE'`)).n > 0
await deveOuPara('vínculos: ADMIN (bootstrap ou direto), internos e parceiros A/B', async () => {
  if (!temAdmin) await sql(`select private.bootstrap_owner_admin($1)`, [U.ADMIN.id])
  else await sql(`insert into organization_memberships (organization_id, user_id, role) values ($1, $2, 'ADMIN')`, [ids.owner, U.ADMIN.id])
  for (const p of ['LAWYER', 'ASSISTANT', 'LAWYER_2'])
    await sql(`insert into organization_memberships (organization_id, user_id, role) values ($1, $2, $3)`, [ids.owner, U[p].id, p === 'LAWYER_2' ? 'LAWYER' : p])
  for (const x of ['A', 'B']) {
    ids[`p${x}`] = (await um(`insert into organizations (type, name, status) values ('PARTNER', $1, 'ACTIVE') returning id`, [`Parceiro ${x} ${RODADA}`])).id
    await sql(`insert into partner_office_settings (organization_id, default_partner_percentage, default_owner_percentage) values ($1, 50, 50)`, [ids[`p${x}`]])
    await sql(`insert into organization_memberships (organization_id, user_id, role) values ($1, $2, 'PARTNER_ADMIN'), ($1, $3, 'PARTNER_USER')`,
      [ids[`p${x}`], U[`PARTNER_ADMIN_${x}`].id, U[`PARTNER_USER_${x}`].id])
  }
})

secao('7. Sessões e JWT reais')
const C = {}
for (const p of papeis) {
  await deve(`login real de ${p}`, async () => {
    C[p] = novoCliente()
    const s = await r(C[p].auth.signInWithPassword({ email: U[p].email, password: U[p].pass }))
    if (!s.session?.access_token) throw new Error('sem JWT')
  })
}
const anon = novoCliente()

// ═════════════════════════════ cenário fictício ══════════════════════════

const cpf = (n) => `999${String(n).padStart(8, '0')}`  // fora do padrão de documento real
async function cliente(n, nome, origem) {
  const id = (await um(`insert into clients (kind, cpf, origin_organization_id) values ('INDIVIDUAL', $1, $2) returning id`, [cpf(n), origem])).id
  await sql(`insert into individual_client_details (client_id, full_name) values ($1, $2)`, [id, nome])
  return id
}
const caso = async (cli, titulo, partner, origin, status = 'SUBMITTED') =>
  (await um(`insert into legal_cases (client_id, legal_area_id, title, status, partner_organization_id, origin_organization_id, created_by_organization_id)
             values ($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid, $6::uuid, coalesce($5::uuid, $6::uuid)) returning id`,
            [cli, ids.banking, titulo, status, partner, origin])).id
const cnj = (seq) => { const n = String(seq).padStart(7, '0'), resto = '2026805' + '0001'; return n + String(98n - (BigInt(n + resto + '00') % 97n)).padStart(2, '0') + resto }

// Sem cenário, todo o resto falharia em cascata: falha aqui encerra a rodada.
await deveOuPara('cenário: clientes, casos, processos e documentos de A e de B', async () => {
  const n0 = Number(Date.now() % 1e6)
  ids.cliA = await cliente(n0 + 1, 'Cliente Teste A', ids.pA)
  ids.cliB = await cliente(n0 + 2, 'Cliente Teste B', ids.pB)
  ids.cliI = await cliente(n0 + 3, 'Cliente Teste Interno', ids.owner)
  ids.casoA = await caso(ids.cliA, 'Caso A (op. A, origem A)', ids.pA, ids.pA)
  ids.casoB = await caso(ids.cliB, 'Caso B (op. B, origem B)', ids.pB, ids.pB)
  ids.casoAOwner = await caso(ids.cliA, 'Caso A (op. A, origem Owner)', ids.pA, ids.owner)
  ids.casoOrigemSo = await caso(ids.cliI, 'Caso interno com origem A, sem acesso', null, ids.pA)
  ids.procA = (await um(`insert into legal_processes (legal_case_id, cnj_number, status) values ($1, $2, 'ACTIVE') returning id`, [ids.casoA, cnj(n0 % 9000000)])).id
  ids.procB = (await um(`insert into legal_processes (legal_case_id, cnj_number, status) values ($1, $2, 'ACTIVE') returning id`, [ids.casoB, cnj((n0 + 1) % 9000000)])).id
  for (const x of ['A', 'B']) {
    const d = randomUUID(), v = randomUUID(), cli = ids[`cli${x}`]
    await sql(`insert into documents (id, client_id, category, title, visibility) values ($1, $2, 'OTHER', $3, 'PARTNER_VISIBLE')`, [d, cli, `Doc ${x}`])
    await sql(`insert into case_documents (legal_case_id, document_id) values ($1, $2)`, [ids[`caso${x}`], d])
    const obj = `clients/${cli}/documents/${d}/${v}/doc-${x}.txt`
    await r(service.storage.from('legal-documents').upload(obj, new Blob([`conteúdo fictício ${x}`], { type: 'text/plain' })))
    await sql(`insert into document_versions (id, document_id, storage_object_name, source, mime_type) values ($1, $2, $3, 'UPLOAD', 'text/plain')`, [v, d, obj])
    Object.assign(ids, { [`doc${x}`]: d, [`ver${x}`]: v, [`obj${x}`]: obj })
  }
  ids.reqB = (await um(`insert into partner_requests (partner_organization_id, legal_case_id, type, title) values ($1, $2, 'DOCUMENT', 'Pedido B') returning id`, [ids.pB, ids.casoB])).id
})

// ═════════════════════════════ RLS via PostgREST ═════════════════════════

secao('7/8. RLS via PostgREST e isolamento de parceiros')
const ve = async (cli, tabela, id) => (await r(cli.from(tabela).select('id').eq('id', id))).length
await deve('anon não lê nada', async () => {
  for (const t of ['clients', 'legal_cases', 'documents', 'organizations', 'audit_events']) {
    const { data, error } = await anon.from(t).select('id').limit(1)
    if (!error && data.length) throw new Error(`anon leu ${t}`)
  }
})
for (const [x, y] of [['A', 'B'], ['B', 'A']]) {
  for (const papel of [`PARTNER_ADMIN_${x}`, `PARTNER_USER_${x}`]) {
    await deve(`${papel} não vê cliente, caso, processo, documento, versão nem pedido de ${y}`, async () => {
      const c = C[papel]
      igual(await ve(c, 'clients', ids[`cli${y}`]), 0, 'cliente')
      igual(await ve(c, 'legal_cases', ids[`caso${y}`]), 0, 'caso')
      igual(await ve(c, 'legal_processes', ids[`proc${y}`]), 0, 'processo')
      igual(await ve(c, 'documents', ids[`doc${y}`]), 0, 'documento')
      igual(await ve(c, 'document_versions', ids[`ver${y}`]), 0, 'versão')
      if (y === 'B') igual(await ve(c, 'partner_requests', ids.reqB), 0, 'pedido')
      igual((await r(c.from('case_partnership_agreements').select('id').eq('partner_organization_id', ids[`p${y}`]))).length, 0, 'financeiro')
    })
    await deve(`${papel} vê os próprios`, async () => {
      igual(await ve(C[papel], 'legal_cases', ids[`caso${x}`]), 1, 'caso próprio')
    })
  }
  await deve(`PARTNER_ADMIN_${x} não altera caso de ${y} trocando IDs (0 linhas afetadas)`, async () => {
    const d = await r(C[`PARTNER_ADMIN_${x}`].from('legal_cases').update({ title: 'invasão' }).eq('id', ids[`caso${y}`]).select('id'))
    igual(d.length, 0, 'linhas')
  })
  await deveFalhar(`PARTNER_ADMIN_${x} não chama RPC com caso de ${y}`, () =>
    r(C[`PARTNER_ADMIN_${x}`].rpc('request_agent_run', { p_agent_id: randomUUID(), p_legal_case_id: ids[`caso${y}`] })), /ADMIN ou LAWYER|42501/)
  await deveFalhar(`PARTNER_ADMIN_${x} não registra acesso a cliente de ${y}`, () =>
    r(C[`PARTNER_ADMIN_${x}`].rpc('record_personal_data_access', { p_client_id: ids[`cli${y}`], p_resource_type: 'CLIENT', p_resource_id: ids[`cli${y}`], p_action: 'VIEW_DETAIL' })), /Sem acesso/)
}

secao('9. partner_organization ≠ origin_organization (JWT real)')
await deve('A vê caso operado por A com origem Owner; não nasce parceria no aceite', async () => {
  igual(await ve(C.PARTNER_USER_A, 'legal_cases', ids.casoAOwner), 1, 'visível')
  await r(C.LAWYER.from('legal_cases').update({ status: 'ACCEPTED', assigned_lawyer_id: U.LAWYER.id }).eq('id', ids.casoAOwner))
  igual((await um(`select count(*)::int n from case_partnership_agreements where legal_case_id = $1`, [ids.casoAOwner])).n, 0, 'parceria')
})
await deve('A NÃO vê caso interno em que é só origem comercial', async () => {
  igual(await ve(C.PARTNER_USER_A, 'legal_cases', ids.casoOrigemSo), 0, 'invisível')
})
await deve('caso operado e originado por A: aceite cria parceria 50/50', async () => {
  await r(C.LAWYER.from('legal_cases').update({ status: 'ACCEPTED', assigned_lawyer_id: U.LAWYER.id }).eq('id', ids.casoA))
  const a = await um(`select partner_percentage::text p from case_partnership_agreements where legal_case_id = $1 and cancelled_at is null`, [ids.casoA])
  igual(a?.p, '50.00', 'snapshot')
})

// ═════════════════════════════ gate humano ═══════════════════════════════

secao('11. Gate humano via PostgREST')
await deve('prepara revisão pendente (LAWYER via PostgREST)', async () => {
  ids.rev = (await r(C.LAWYER.from('reviews').insert({ legal_case_id: ids.casoA, document_version_id: ids.verA }).select('id').single())).id
})
await deveFalhar('LAWYER: UPDATE reviews.status', () => r(C.LAWYER.from('reviews').update({ status: 'APPROVED' }).eq('id', ids.rev)), /permission denied|42501/)
await deveFalhar('LAWYER: INSERT review já APPROVED', () => r(C.LAWYER.from('reviews').insert({ legal_case_id: ids.casoA, document_version_id: ids.verA, status: 'APPROVED' })), /permission denied|42501/)
await deveFalhar('LAWYER: INSERT direto em review_decisions', () => r(C.LAWYER.from('review_decisions').insert({ review_id: ids.rev, decision: 'APPROVE', decided_by: U.LAWYER.id })), /permission denied|42501/)
await deveFalhar('service role: UPDATE reviews.status', () => r(service.from('reviews').update({ status: 'APPROVED' }).eq('id', ids.rev)), /decisão registrada/)
await deve('decide_review (RPC) grava decisão, muda a revisão e audita com o LAWYER', async () => {
  await r(C.LAWYER.rpc('decide_review', { p_review_id: ids.rev, p_decision: 'APPROVE' }))
  igual((await um(`select status from reviews where id = $1`, [ids.rev])).status, 'APPROVED', 'status')
  const ev = await um(`select actor_type, actor_user_id from audit_events where action = 'REVIEW_APPROVED' and entity_id = $1`, [ids.rev])
  igual([ev?.actor_type, ev?.actor_user_id], ['USER', U.LAWYER.id], 'auditoria')
})

// ═════════════════════════════ agentes ═══════════════════════════════════

secao('24/12. request_agent_run e proposta estrutural')
await deve('ADMIN cadastra agente fictício (PostgREST)', async () => {
  ids.agente = (await r(C.ADMIN.from('agents').insert({ slug: `teste-${RODADA}`, name: 'Agente de teste', status: 'ACTIVE' }).select('id').single())).id
  ids.versao = (await r(C.ADMIN.from('agent_versions').insert({ agent_id: ids.agente, instructions: 'Instruções fictícias.' }).select('id').single())).id
  await r(C.ADMIN.from('agents').update({ current_version_id: ids.versao }).eq('id', ids.agente))
})
await deve('LAWYER pede execução no caso: run, input, mensagem na fila, audit USER', async () => {
  ids.run = await r(C.LAWYER.rpc('request_agent_run', { p_agent_id: ids.agente, p_legal_case_id: ids.casoA, p_request_text: 'Pedido fictício' }))
  const run = await um(`select requested_by, status, queue_msg_id from agent_runs where id = $1`, [ids.run])
  igual([run.requested_by, run.status, !!run.queue_msg_id], [U.LAWYER.id, 'QUEUED', true], 'execução')
  igual((await um(`select count(*)::int n from agent_run_inputs where agent_run_id = $1`, [ids.run])).n, 1, 'entrada')
  igual((await um(`select count(*)::int n from pgmq.q_agent_execution where message ->> 'agent_run_id' = $1`, [ids.run])).n, 1, 'mensagem')
  const ev = await um(`select actor_type, actor_user_id from audit_events where action = 'AGENT_RUN_REQUESTED' and entity_id = $1`, [ids.run])
  igual([ev.actor_type, ev.actor_user_id], ['USER', U.LAWYER.id], 'auditoria')
})
await deve('ADMIN pede execução sem caso', async () => { ids.runAdmin = await r(C.ADMIN.rpc('request_agent_run', { p_agent_id: ids.agente })) })
for (const p of ['ASSISTANT', 'PARTNER_ADMIN_A', 'PARTNER_USER_B'])
  await deveFalhar(`${p} não pede execução`, () => r(C[p].rpc('request_agent_run', { p_agent_id: ids.agente, p_legal_case_id: ids.casoA })), /ADMIN ou LAWYER/)
await deveFalhar('anon não pede execução', () => r(anon.rpc('request_agent_run', { p_agent_id: ids.agente, p_legal_case_id: ids.casoA })), /permission denied|42501|PGRST/)
await deveFalhar('usuário não insere em agent_runs pela API', () => r(C.ADMIN.from('agent_runs').insert({ agent_id: ids.agente, agent_version_id: ids.versao })), /permission denied|42501/)

await deve('proposta UPDATE_AGENT: LAWYER recusado, ADMIN aprova (RPC)', async () => {
  const p = (await um(`insert into agent_proposals (agent_run_id, proposal_type, payload, idempotency_key)
                       values ($1, 'UPDATE_AGENT', '{"summary":"x","data":{}}', $2) returning id`, [ids.runAdmin, `prop:${RODADA}1`])).id
  const rev = (await um(`insert into reviews (agent_proposal_id) values ($1) returning id`, [p])).id
  const { error } = await C.LAWYER.rpc('decide_review', { p_review_id: rev, p_decision: 'APPROVE' })
  if (!error || !/Somente ADMIN decide proposta/.test(error.message)) throw new Error(`LAWYER: ${error?.message ?? 'aceito'}`)
  await r(C.ADMIN.rpc('decide_review', { p_review_id: rev, p_decision: 'APPROVE' }))
  igual((await um(`select status from agent_proposals where id = $1`, [p])).status, 'APPROVED', 'proposta')
})

secao('31/32. Execuções para o advogado (get_agent_run_summaries)')
await deve('LAWYER vê execução do caso, sem dados técnicos', async () => {
  const d = await r(C.LAWYER.rpc('get_agent_run_summaries', { p_legal_case_id: ids.casoA }))
  if (!d.some((x) => x.id === ids.run)) throw new Error('não viu')
  for (const k of ['metadata', 'input_tokens', 'estimated_cost', 'model', 'error_message', 'request_text'])
    if (k in d[0]) throw new Error(`expõe ${k}`)
  const todas = await r(C.LAWYER.rpc('get_agent_run_summaries', {}))
  if (todas.some((x) => x.id === ids.runAdmin)) throw new Error('LAWYER viu execução sem caso')
})
for (const p of ['ASSISTANT', 'PARTNER_ADMIN_A', 'PARTNER_USER_B'])
  await deveFalhar(`${p} não lê execuções`, () => r(C[p].rpc('get_agent_run_summaries', {})), /ADMIN e LAWYER/)
await deveFalhar('anon não lê execuções', () => r(anon.rpc('get_agent_run_summaries', {})), /permission denied|42501|PGRST/)
await deve('tabela agent_runs e agent_run_inputs fechadas ao LAWYER pela API', async () => {
  igual((await r(C.LAWYER.from('agent_runs').select('id'))).length, 0, 'agent_runs')
})

// ═════════════════════════════ worker real ═══════════════════════════════

secao('25–30. Worker real (dg_worker), pgmq real, claim e batimento')
const w1 = new pg.Client({ connectionString: WORKER_URL, ssl: { rejectUnauthorized: false } })
const w2 = new pg.Client({ connectionString: WORKER_URL, ssl: { rejectUnauthorized: false } })
await deve('dg_worker conecta pelo método de produção (dois clientes)', async () => {
  await w1.connect(); await w2.connect()
  const q = await w1.query(`select current_user u`)
  igual(q.rows[0].u, 'dg_worker', 'usuário')
  console.log(`    usuário de conexão: ${new URL(WORKER_URL).username.replace(ref, mascara(ref))}`)
})
await deve('dg_worker sem SELECT em dado de cliente, financeiro, auditoria, usuários', async () => {
  for (const t of ['clients', 'legal_cases', 'documents', 'document_versions', 'agent_runs', 'agent_run_inputs',
    'payments', 'payment_receipts', 'audit_events', 'profiles', 'organization_memberships', 'integration_connections', 'import_jobs']) {
    try { await w1.query(`select 1 from public.${t} limit 1`); throw new Error(`leu ${t}`) }
    catch (e) { if (!/permission denied/.test(e.message)) throw e }
  }
})
await deve('dg_worker não envia mensagem nem decide revisão', async () => {
  for (const q of [`select pgmq.send('agent_execution', '{}'::jsonb)`, `select public.decide_review('${ids.rev}', 'APPROVE', null, '${U.LAWYER.id}')`]) {
    try { await w1.query(q); throw new Error(`aceitou: ${q}`) } catch (e) { if (!/permission denied/.test(e.message)) throw e }
  }
})
let msg
await deve('pgmq.read real (assinatura instalada) devolve a mensagem da execução', async () => {
  const q = await w1.query(`select * from pgmq.read('agent_execution', 60, 10)`)
  msg = q.rows.find((m) => m.message.agent_run_id === ids.run)
  if (!msg) throw new Error('mensagem não lida')
})
await deve('claim simultâneo de dois workers: só um ganha', async () => {
  const [a, b] = await Promise.all([
    w1.query(`select * from private.claim_agent_run($1, 'w1', $2, 300)`, [ids.run, msg.msg_id]),
    w2.query(`select * from private.claim_agent_run($1, 'w2', $2, 300)`, [ids.run, msg.msg_id]),
  ])
  const ganhou = [a.rows[0].claimed, b.rows[0].claimed]
  igual(ganhou.filter(Boolean).length, 1, 'vencedores')
  ids.dono = ganhou[0] ? 'w1' : 'w2'
  const run = await um(`select status, claimed_by, claimed_at is not null c from agent_runs where id = $1`, [ids.run])
  igual([run.status, run.claimed_by, run.c], ['RUNNING', ids.dono, true], 'reserva')
})
await deve('heartbeat → set_vt real: mensagem continua invisível', async () => {
  const hb = await w1.query(`select private.heartbeat_agent_run($1, $2, $3, 5) v`, [ids.run, ids.dono, msg.msg_id])
  igual(hb.rows[0].v, true, 'batimento')
  const leitura = await w2.query(`select * from pgmq.read('agent_execution', 60, 10)`)
  igual(leitura.rows.some((m) => m.msg_id === msg.msg_id), false, 'invisível')
})
await deve('escopo: execução do caso A não lê caso B; lê o próprio', async () => {
  const outro = await w1.query(`select private.worker_get_case($1, $2, $3) c`, [ids.run, ids.dono, ids.casoB])
  igual(outro.rows[0].c, null, 'caso B')
  const docB = await w1.query(`select * from private.worker_get_document_version($1, $2, $3)`, [ids.run, ids.dono, ids.verB])
  igual(docB.rows.length, 0, 'documento B')
  const proprio = await w1.query(`select private.worker_get_case($1, $2, $3) c`, [ids.run, ids.dono, ids.casoA])
  igual(proprio.rows[0].c?.id, ids.casoA, 'caso A')
})
await deve('idempotência real: mesma proposta duas vezes = uma', async () => {
  const p = JSON.stringify({ summary: 'x', data: { description: 'Providência fictícia de teste' } })
  const a = await w1.query(`select * from private.worker_create_proposal($1, $2, 'OTHER', $3, $4)`, [ids.run, ids.dono, p, `prop:${RODADA}2`])
  const b = await w2.query(`select * from private.worker_create_proposal($1, $2, 'OTHER', $3, $4)`, [ids.run, ids.dono, p, `prop:${RODADA}2`])
  igual([a.rows[0].created, b.rows[0].created], [true, false], 'criadas')
})
await deve('perda de batimento: reserva retomada; quem perdeu não grava o resultado', async () => {
  await sql(`update agent_runs set heartbeat_at = now() - interval '1 hour' where id = $1`, [ids.run])
  const outro = ids.dono === 'w1' ? 'w2' : 'w1'
  const c = await (outro === 'w1' ? w1 : w2).query(`select * from private.claim_agent_run($1, $2, $3, 60)`, [ids.run, outro, msg.msg_id])
  igual(c.rows[0].claimed, true, 'retomada')
  const fim = await (ids.dono === 'w1' ? w1 : w2).query(`select private.worker_finish_run($1, $2, 'COMPLETED') v`, [ids.run, ids.dono])
  igual(fim.rows[0].v, false, 'quem perdeu')
  const fim2 = await (outro === 'w1' ? w1 : w2).query(`select private.worker_finish_run($1, $2, 'WAITING_HUMAN') v`, [ids.run, outro])
  igual(fim2.rows[0].v, true, 'novo dono')
  await w1.query(`select pgmq.archive('agent_execution', $1)`, [msg.msg_id])
  const ev = await um(`select actor_type, agent_run_id from audit_events where action = 'AGENT_RUN_WAITING_HUMAN' and entity_id = $1`, [ids.run])
  igual([ev?.actor_type, ev?.agent_run_id], ['AGENT', ids.run], 'auditoria AGENT')
})
await w1.end(); await w2.end()

// ═════════════════════════════ máquina de estados e origem ═══════════════

secao('13. Máquina de estados (PostgREST e RPC)')
await deve('fluxo válido até CLOSED', async () => {
  ids.casoSM = await caso(ids.cliI, 'Caso SM', null, ids.owner, 'DRAFT')
  for (const st of ['SUBMITTED', 'ACCEPTED', 'IN_PROGRESS', 'CLOSED'])
    await r(C.LAWYER.from('legal_cases').update({ status: st, assigned_lawyer_id: U.LAWYER.id }).eq('id', ids.casoSM))
})
for (const [de, para] of [['CLOSED', 'DRAFT'], ['CLOSED', 'IN_PROGRESS']])
  await deveFalhar(`${de} → ${para}`, () => r(C.ADMIN.from('legal_cases').update({ status: para }).eq('id', ids.casoSM)), /inválida/)
await deveFalhar('ACCEPTED → SUBMITTED', () => r(C.LAWYER.from('legal_cases').update({ status: 'SUBMITTED' }).eq('id', ids.casoA)), /inválida/)
await deveFalhar('override sem motivo', () => r(C.ADMIN.rpc('override_case_status', { p_case_id: ids.casoSM, p_new_status: 'IN_PROGRESS', p_reason: '' })), /motivo/)
await deveFalhar('override por LAWYER', () => r(C.LAWYER.rpc('override_case_status', { p_case_id: ids.casoSM, p_new_status: 'IN_PROGRESS', p_reason: 'x' })), /Somente ADMIN/)
await deve('override de ADMIN CLOSED → IN_PROGRESS, auditado', async () => {
  await r(C.ADMIN.rpc('override_case_status', { p_case_id: ids.casoSM, p_new_status: 'IN_PROGRESS', p_reason: 'Teste de reabertura' }))
  igual((await um(`select count(*)::int n from audit_events where action = 'CASE_STATUS_OVERRIDDEN' and entity_id = $1`, [ids.casoSM])).n, 1, 'evento')
})

secao('14. Troca de origem (RPC)')
await deve('A → B → Owner → A: cancela, recria, um ativo, histórico intacto', async () => {
  const troca = (para, motivo) => r(C.ADMIN.rpc('change_case_origin', { p_case_id: ids.casoA, p_new_origin: para, p_reason: motivo }))
  const ativos = async () => (await sql(`select partner_organization_id p from case_partnership_agreements where legal_case_id = $1 and cancelled_at is null`, [ids.casoA])).map((x) => x.p)
  await troca(ids.pB, 'Teste A→B'); igual(await ativos(), [ids.pB], 'B')
  await troca(ids.owner, 'Teste B→Owner'); igual(await ativos(), [], 'nenhum')
  await troca(ids.pA, 'Teste Owner→A'); igual(await ativos(), [ids.pA], 'A')
  const h = await um(`select count(*)::int n, count(*) filter (where cancelled_at is not null and cancelled_by is not null and cancellation_reason is not null)::int c
                      from case_partnership_agreements where legal_case_id = $1`, [ids.casoA])
  igual([h.n, h.c], [3, 2], 'histórico')
})
await deveFalhar('LAWYER não troca origem de caso aceito', () => r(C.LAWYER.rpc('change_case_origin', { p_case_id: ids.casoA, p_new_origin: ids.owner, p_reason: 'x' })), /Somente ADMIN/)

// ═════════════════════════════ financeiro ════════════════════════════════

secao('15/16. Ledger e divisão no Postgres real')
await deve('1000: +500 PARTIAL, +500 PAID, −500 PARTIAL; parceiro 50% por lançamento', async () => {
  const fa = (await r(C.ADMIN.from('financial_agreements').insert({ legal_case_id: ids.casoA, status: 'ACTIVE' }).select('id').single())).id
  const pay = (await r(C.ADMIN.from('payments').insert({ financial_agreement_id: fa, amount: 1000, payment_type: 'OTHER', due_date: '2099-01-01' }).select('id').single())).id
  const st = async () => (await r(C.ADMIN.from('payment_balances').select('status').eq('payment_id', pay).single())).status
  const r1 = (await r(C.ADMIN.from('payment_receipts').insert({ payment_id: pay, kind: 'RECEIPT', amount: 500 }).select('id').single())).id
  igual(await st(), 'PARTIAL', '500')
  await r(C.ADMIN.from('payment_receipts').insert({ payment_id: pay, kind: 'RECEIPT', amount: 500 }))
  igual(await st(), 'PAID', '1000')
  await r(C.ADMIN.from('payment_receipts').insert({ payment_id: pay, kind: 'REVERSAL', amount: -500, original_receipt_id: r1 }))
  igual(await st(), 'PARTIAL', 'estorno')
  const al = await sql(`select al.partner_amount::text p from partner_revenue_allocations al join payment_receipts r on r.id = al.receipt_id where r.payment_id = $1 order by al.sequence`, [pay])
  igual(al.map((x) => x.p), ['250.00', '250.00', '-250.00'], 'divisões')
  ids.pay = pay
})
await deve('OVERDUE no fuso de São Paulo', async () => {
  const fa = (await um(`select id from financial_agreements where legal_case_id = $1 and status = 'ACTIVE'`, [ids.casoA])).id
  const p = (await um(`insert into payments (financial_agreement_id, amount, payment_type, due_date)
                       values ($1, 10, 'OTHER', ((now() at time zone 'America/Sao_Paulo')::date - 1)) returning id`, [fa])).id
  igual((await um(`select status from payment_balances where payment_id = $1`, [p])).status, 'OVERDUE', 'vencida ontem')
  console.log(`    timezone do servidor: ${(await um(`show timezone`)).TimeZone}`)
})
await deveFalhar('service role não edita recebimento', () => r(service.from('payment_receipts').update({ amount: 1 }).eq('payment_id', ids.pay)), /permission denied|append-only|42501/)
await deveFalhar('parceiro não vê recebimento interno', async () => {
  const d = await r(C.PARTNER_ADMIN_A.from('payment_receipts').select('id'))
  if (d.length === 0) throw new Error('vazio')
}, /vazio/)

// ═════════════════════════════ documentos ════════════════════════════════

secao('17/18. Verificação e pendência')
await deve('v1 UNVERIFIED → VERIFIED; v2 UNVERIFIED → FAILED; v1 continua VERIFIED', async () => {
  const st = async (v) => (await r(C.LAWYER.from('document_version_verification_status').select('verification_status').eq('document_version_id', v).single())).verification_status
  igual(await st(ids.verA), 'UNVERIFIED', 'v1')
  await r(C.LAWYER.from('document_version_verifications').insert({ document_version_id: ids.verA, status: 'VERIFIED', verification_source: 'MANUAL' }))
  igual(await st(ids.verA), 'VERIFIED', 'v1 verificada')
  const v2 = randomUUID(), obj = `clients/${ids.cliA}/documents/${ids.docA}/${v2}/v2.txt`
  await sql(`insert into document_versions (id, document_id, storage_object_name, source) values ($1, $2, $3, 'UPLOAD')`, [v2, ids.docA, obj])
  igual(await st(v2), 'UNVERIFIED', 'v2')
  await r(C.ASSISTANT.from('document_version_verifications').insert({ document_version_id: v2, status: 'FAILED', verification_source: 'MANUAL', notes: 'teste' }))
  igual([await st(v2), await st(ids.verA)], ['FAILED', 'VERIFIED'], 'final')
})
await deveFalhar('versão é imutável (service role)', () => r(service.from('document_versions').update({ original_filename: 'x' }).eq('id', ids.verA)), /permission denied|append-only/)
await deve('pendência: versão de B recusada; versão de A aceita', async () => {
  const req = (await um(`insert into case_document_requirements (legal_case_id, requirement_label, category) values ($1, 'Teste', 'OTHER') returning id`, [ids.casoA])).id
  const { error } = await C.LAWYER.from('case_document_requirements').update({ status: 'RECEIVED', satisfied_by_document_version_id: ids.verB }).eq('id', req)
  if (!error || !/mesmo cliente/.test(error.message)) throw new Error(`versão de B: ${error?.message ?? 'aceita'}`)
  await r(C.LAWYER.from('case_document_requirements').update({ status: 'RECEIVED', satisfied_by_document_version_id: ids.verA }).eq('id', req))
})

// ═════════════════════════════ storage ═══════════════════════════════════

secao('19–22. Storage real')
await deve('buckets privados', async () => {
  const b = await sql(`select id, public from storage.buckets where id in ('legal-documents','reference-materials','imports') order by id`)
  igual(b.map((x) => [x.id, x.public]), [['imports', false], ['legal-documents', false], ['reference-materials', false]], 'buckets')
})
for (const [nome, cli] of [['anon', anon], ['LAWYER', C.LAWYER], ['PARTNER_ADMIN_A', C.PARTNER_ADMIN_A]]) {
  await deve(`${nome} não baixa objeto direto nem lista bucket nem gera signed URL`, async () => {
    const d = await cli.storage.from('legal-documents').download(ids.objA)
    if (!d.error) throw new Error('download direto aceito')
    const l = await cli.storage.from('legal-documents').list(`clients/${ids.cliA}`)
    if (!l.error && l.data.length) throw new Error('listou')
    const s = await cli.storage.from('legal-documents').createSignedUrl(ids.objA, 60)
    if (!s.error) throw new Error('gerou signed URL')
    const u = await cli.storage.from('legal-documents').upload(`clients/${ids.cliA}/x.txt`, new Blob(['x']))
    if (!u.error) throw new Error('upload direto aceito')
  })
}
await deve('backend (service role) gera signed upload e download que funcionam', async () => {
  const path = `clients/${ids.cliA}/documents/${ids.docA}/${randomUUID()}/assinado.txt`
  const up = await r(service.storage.from('legal-documents').createSignedUploadUrl(path))
  await r(novoCliente().storage.from('legal-documents').uploadToSignedUrl(path, up.token, new Blob(['ok'], { type: 'text/plain' })))
  const dl = await r(service.storage.from('legal-documents').createSignedUrl(path, 60))
  const res = await fetch(dl.signedUrl)
  igual([res.status, await res.text()], [200, 'ok'], 'download assinado')
  ids.orfao = path
})
await deve('objeto sem versão aparece como órfão (nada apagado)', async () => {
  const o = await sql(`select object_name from private.find_orphan_storage_objects(interval '0 seconds')`)
  if (!o.some((x) => x.object_name === ids.orfao)) throw new Error('não detectou')
})

// ═════════════════════════════ auditoria e LGPD ══════════════════════════

secao('36/37. Auditoria e acesso a dado pessoal')
await deve('os três tipos de ator e nenhum CPF/entrada na metadata', async () => {
  const t = await sql(`select distinct actor_type from audit_events order by 1`)
  igual(t.map((x) => x.actor_type), ['AGENT', 'SYSTEM', 'USER'], 'tipos')
  for (const termo of ['999', 'Pedido fictício']) {
    const n = await um(`select count(*)::int n from audit_events where metadata::text ~ $1`, [termo === '999' ? '"999[0-9]{8}"' : termo])
    igual(n.n, 0, termo)
  }
})
await deve('acesso a ficha deduplicado; download sempre; parceiro não lê o log', async () => {
  const a = await r(C.LAWYER.rpc('record_personal_data_access', { p_client_id: ids.cliA, p_resource_type: 'CLIENT', p_resource_id: ids.cliA, p_action: 'VIEW_DETAIL' }))
  const b = await r(C.LAWYER.rpc('record_personal_data_access', { p_client_id: ids.cliA, p_resource_type: 'CLIENT', p_resource_id: ids.cliA, p_action: 'VIEW_DETAIL' }))
  igual(a, b, 'deduplicado')
  igual((await r(C.PARTNER_ADMIN_A.from('personal_data_access_events').select('id'))).length, 0, 'parceiro')
  igual((await r(C.LAWYER.from('personal_data_access_events').select('id'))).length, 0, 'LAWYER')
})

// ═════════════════════════════ desativação ═══════════════════════════════

secao('6. Desativação de profile, vínculo e organização')
const veCaso = async (c, caso) => (await r(c.from('legal_cases').select('id').eq('id', caso))).length
await deve('profile inativo perde acesso', async () => {
  await sql(`update profiles set active = false where id = $1`, [U.LAWYER_2.id])
  igual(await veCaso(C.LAWYER_2, ids.casoA), 0, 'LAWYER_2')
  await sql(`update profiles set active = true where id = $1`, [U.LAWYER_2.id])
  igual(await veCaso(C.LAWYER_2, ids.casoA), 1, 'reativado')
})
await deve('vínculo suspenso perde acesso', async () => {
  await sql(`update organization_memberships set status = 'SUSPENDED' where user_id = $1`, [U.PARTNER_USER_A.id])
  igual(await veCaso(C.PARTNER_USER_A, ids.casoAOwner), 0, 'suspenso')
  await sql(`update organization_memberships set status = 'ACTIVE' where user_id = $1`, [U.PARTNER_USER_A.id])
})
await deve('organização suspensa perde acesso inteiro', async () => {
  await sql(`update organizations set status = 'SUSPENDED' where id = $1`, [ids.pA])
  igual(await veCaso(C.PARTNER_ADMIN_A, ids.casoAOwner), 0, 'suspensa')
  await sql(`update organizations set status = 'ACTIVE' where id = $1`, [ids.pA])
})

// ═════════════════════════════ importação e expurgos ═════════════════════

secao('38/39. Importação e expurgos')
await deve('importação CSV/XLSX, JSON recusado; expurgos rodam', async () => {
  const { error } = await C.ADMIN.from('import_jobs').insert({ organization_id: ids.owner, file_name: 'x.json', file_type: 'JSON' })
  if (!error) throw new Error('JSON aceito')
  await r(C.ADMIN.from('import_jobs').insert({ organization_id: ids.owner, file_name: 'x.csv', file_type: 'CSV' }))
  await sql(`select private.purge_import_raw_data(interval '30 days')`)
  await sql(`select private.purge_expired_agent_run_inputs()`)
})

// ═════════════════════════════ desempenho básico ═════════════════════════

secao('41. Planos de consulta (EXPLAIN)')
for (const [nome, q] of [
  ['cliente por CPF', `select id from clients where cpf = '99900000001'`],
  ['caso por parceiro', `select id from legal_cases where partner_organization_id = '${ids.pA}'`],
  ['caso por status', `select id from legal_cases where status = 'SUBMITTED'`],
  ['processo por CNJ', `select id from legal_processes where cnj_number = '${cnj(1)}'`],
  ['revisões pendentes', `select id from reviews where status = 'PENDING' order by created_at limit 50`],
  ['saldos', `select * from payment_balances where legal_case_id = '${ids.casoA}'`],
]) {
  await deve(`EXPLAIN ${nome}`, async () => {
    const p = await sql(`explain ${q}`)
    console.log(`    ${p[0]['QUERY PLAN']}`)
  })
}

await adminDb.end()
console.log(falhas === 0
  ? `\n\x1b[32m${total} verificações reais, todas passaram.\x1b[0m (rodada ${RODADA})\n`
  : `\n\x1b[31m${falhas} de ${total} verificações reais falharam.\x1b[0m (rodada ${RODADA})\n`)
process.exit(falhas === 0 ? 0 : 1)
