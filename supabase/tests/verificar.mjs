// Aplica as migrations num Postgres real (PGlite, em WASM) sobre uma simulação
// mínima do Supabase e roda os critérios de aceitação da especificação V1
// (seção 105), mais as regras de integridade que os sustentam.
//
//   cd supabase && npm install && npm run verificar
//
// RLS é testada de verdade: cada "usuário" roda numa transação com
// `set local role authenticated` e o JWT em request.jwt.claims, como o
// PostgREST faz. O worker roda como service_role.
//
// O que isto NÃO cobre: o Supabase Auth, o Storage e o pgmq reais (aqui são
// simulados em tests/supabase-shim.sql). Isso se confirma no projeto.

import { PGlite } from '@electric-sql/pglite'
import { readFile, readdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

const raiz = new URL('../', import.meta.url)
const db = new PGlite()
let falhas = 0
let total = 0

const ok = (msg) => { total++; console.log(`  \x1b[32m✓\x1b[0m ${msg}`) }
const erro = (msg, e) => {
  total++; falhas++
  console.log(`  \x1b[31m✗\x1b[0m ${msg}`)
  if (e) console.log(`    ${String(e.message ?? e).split('\n').join('\n    ')}`)
}
const secao = (t) => console.log(`\n${t}`)

async function deve(msg, fn) {
  try { await fn(); ok(msg) } catch (e) { erro(msg, e) }
}
async function deveFalhar(msg, fn, padrao) {
  try {
    await fn()
    erro(`${msg} — foi aceito`)
  } catch (e) {
    if (padrao && !padrao.test(e.message)) erro(`${msg} — falhou pelo motivo errado`, e)
    else ok(msg)
  }
}
function igual(real, esperado, rotulo) {
  const a = JSON.stringify(real), b = JSON.stringify(esperado)
  if (a !== b) throw new Error(`${rotulo ?? 'valor'}: esperado ${b}, veio ${a}`)
}

// Como usuário logado: role authenticated + JWT. Erro → rollback e exceção.
function como(uid, fn) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: uid, role: 'authenticated', aal: 'aal2' })])
    await tx.query('set local role authenticated')
    return fn(tx)
  })
}
// Como worker / backend com service role.
function comoServico(fn) {
  return db.transaction(async (tx) => {
    await tx.query('set local role service_role')
    return fn(tx)
  })
}
// Como o worker de agentes: papel dg_worker (sem bypass de RLS). Com runId, a
// transação declara a execução, e a auditoria registra actor_type AGENT.
function comoWorker(fn, runId = null) {
  return db.transaction(async (tx) => {
    await tx.query('set local role dg_worker')
    if (runId) await tx.query(`select set_config('dg.agent_run_id', $1, true)`, [runId])
    return fn(tx)
  })
}
// Decisão de revisão: só pela operação controlada.
const decidir = (uid, review, decision, notes = null) =>
  como(uid, (tx) => tx.query(`select public.decide_review($1, $2, $3)`, [review, decision, notes]))

const um = async (tx, sql, params) => (await tx.query(sql, params)).rows[0]
const linhas = async (tx, sql, params) => (await tx.query(sql, params)).rows

// CNJ válido: NNNNNNN DD AAAA J TR OOOO, DV módulo 97.
function cnj(seq, ano = '2026', j = '8', tr = '05', origem = '0001') {
  const n = String(seq).padStart(7, '0')
  const dv = 98n - (BigInt(n + ano + j + tr + origem + '00') % 97n)
  return n + String(dv).padStart(2, '0') + ano + j + tr + origem
}
const sha = (c) => c.repeat(64).slice(0, 64)

// ═════════════════════════════ migrations ════════════════════════════════

secao('Aplicando migrations sobre a simulação do Supabase')
await db.exec(await readFile(new URL('tests/supabase-shim.sql', raiz), 'utf8'))
for (const f of (await readdir(new URL('migrations/', raiz))).filter((x) => x.endsWith('.sql')).sort()) {
  try {
    await db.exec(await readFile(new URL(`migrations/${f}`, raiz), 'utf8'))
    ok(f)
  } catch (e) {
    erro(f, e)
    console.log('\n  Interrompido: as migrations seguintes dependem desta.\n')
    process.exit(1)
  }
}

// Migrations são idempotentes no seed: rodar 019 de novo não duplica nada.
await deve('seed é idempotente', async () => {
  await db.exec(await readFile(new URL('migrations/20261005000019_seed.sql', raiz), 'utf8'))
  const r = await um(db, `select count(*)::int n from organizations where type = 'OWNER'`)
  igual(r.n, 1, 'organizações OWNER')
})

// ═════════════════════════════ cenário ═══════════════════════════════════
// Montado como faria o backend/bootstrap (dono do banco).

const ids = {}
ids.owner = (await um(db, `select id from organizations where type = 'OWNER'`)).id
ids.banking = (await um(db, `select id from legal_areas where code = 'BANKING'`)).id
ids.template = (await um(db, `select id from analysis_templates where name = 'Análise Bancária'`)).id

async function parceiro(nome, pct) {
  const o = await um(db, `insert into organizations (type, name, status) values ('PARTNER', $1, 'ACTIVE') returning id`, [nome])
  await db.query(
    `insert into partner_office_settings (organization_id, default_partner_percentage, default_owner_percentage)
     values ($1, $2, $3)`, [o.id, pct, 100 - pct])
  return o.id
}
ids.almeida = await parceiro('Almeida Advogados', 50)
ids.ferreira = await parceiro('Ferreira & Lima', 60)

async function usuario(nome, org, papel) {
  const u = await um(db,
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [`${nome.toLowerCase()}@exemplo.com.br`, JSON.stringify({ full_name: nome })])
  await db.query(
    `insert into organization_memberships (organization_id, user_id, role) values ($1, $2, $3)`,
    [org, u.id, papel])
  return u.id
}

secao('Bootstrap')
await deve('private.bootstrap_owner_admin cria a primeira ADMIN', async () => {
  const u = await um(db, `insert into auth.users (email, raw_user_meta_data)
    values ('barbara@exemplo.com.br', '{"full_name":"Bárbara Cardoso"}') returning id`)
  ids.barbara = u.id
  await db.query(`select private.bootstrap_owner_admin($1)`, [u.id])
  const p = await um(db, `select full_name from profiles where id = $1`, [u.id])
  igual(p.full_name, 'Bárbara Cardoso', 'profile criado pelo trigger do Auth')
})
await deveFalhar('bootstrap não roda de novo depois que existe ADMIN', async () => {
  const u = await um(db, `insert into auth.users (email) values ('intruso@exemplo.com') returning id`)
  await db.query(`select private.bootstrap_owner_admin($1)`, [u.id])
}, /Já existe ADMIN/)

ids.lucas = await usuario('Lucas', ids.owner, 'LAWYER')
ids.ana = await usuario('Ana', ids.owner, 'ASSISTANT')
ids.almeidaAdm = await usuario('Roberto', ids.almeida, 'PARTNER_ADMIN')
ids.almeidaUsr = await usuario('Paula', ids.almeida, 'PARTNER_USER')
ids.ferreiraAdm = await usuario('Marcos', ids.ferreira, 'PARTNER_ADMIN')

// ═════════════════════════════ organizações e papéis ═════════════════════

secao('Organizações e papéis')
await deveFalhar('só existe um Owner', () =>
  db.query(`insert into organizations (type, name) values ('OWNER', 'Outro escritório')`),
  /organizations_single_owner/)

await deveFalhar('PARTNER_ADMIN não entra na organização OWNER', async () => {
  const u = await um(db, `insert into auth.users (email) values ('x1@exemplo.com') returning id`)
  await db.query(`insert into organization_memberships (organization_id, user_id, role) values ($1, $2, 'PARTNER_ADMIN')`, [ids.owner, u.id])
}, /role_matches_org/)

await deveFalhar('LAWYER não entra em organização PARTNER', async () => {
  const u = await um(db, `insert into auth.users (email) values ('x2@exemplo.com') returning id`)
  await db.query(`insert into organization_memberships (organization_id, user_id, role) values ($1, $2, 'LAWYER')`, [ids.almeida, u.id])
}, /role_matches_org/)

await deveFalhar('configuração de parceria só para organização PARTNER', () =>
  db.query(`insert into partner_office_settings (organization_id, default_partner_percentage, default_owner_percentage)
            values ($1, 50, 50)`, [ids.owner]),
  /partner_office_settings_org_fkey/)

await deveFalhar('divisão padrão precisa somar 100', () =>
  db.query(`update partner_office_settings set default_partner_percentage = 70 where organization_id = $1`, [ids.almeida]),
  /split_is_100/)

await deveFalhar('convite não guarda token em texto puro', () =>
  db.query(`insert into user_invitations (organization_id, email, role, token_hash, expires_at)
            values ($1, 'novo@exemplo.com', 'LAWYER', 'token-em-claro', now() + interval '7 days')`, [ids.owner]),
  /token_hash/)

// ═════════════════════════════ clientes ══════════════════════════════════

secao('Cliente canônico')
await deve('ADMIN cadastra João (PF) com origem Bárbara', () => como(ids.barbara, async (tx) => {
  ids.joao = (await um(tx, `insert into clients (kind, cpf, origin_organization_id)
    values ('INDIVIDUAL', '12345678901', $1) returning id`, [ids.owner])).id
  await tx.query(`insert into individual_client_details (client_id, full_name, gender) values ($1, 'João da Silva', 'MALE')`, [ids.joao])
  await tx.query(`insert into client_contacts (client_id, type, value, is_primary) values ($1, 'WHATSAPP', '+5571999990000', true)`, [ids.joao])
}))

await deveFalhar('CPF duplicado é impedido', () =>
  db.query(`insert into clients (kind, cpf, origin_organization_id) values ('INDIVIDUAL', '12345678901', $1)`, [ids.owner]),
  /clients_cpf_key/)

await deve('cadastra empresa (PJ)', async () => {
  ids.empresa = (await um(db, `insert into clients (kind, cnpj, origin_organization_id)
    values ('COMPANY', '11222333000181', $1) returning id`, [ids.owner])).id
})
await deveFalhar('CNPJ duplicado é impedido', () =>
  db.query(`insert into clients (kind, cnpj, origin_organization_id) values ('COMPANY', '11222333000181', $1)`, [ids.owner]),
  /clients_cnpj_key/)

await deveFalhar('PF com CNPJ é rejeitada', () =>
  db.query(`insert into clients (kind, cpf, cnpj, origin_organization_id) values ('INDIVIDUAL', '99988877766', '99888777000166', $1)`, [ids.owner]),
  /identifier_matches_kind/)

await deveFalhar('CPF formatado é rejeitado (só dígitos)', () =>
  db.query(`insert into clients (kind, cpf, origin_organization_id) values ('INDIVIDUAL', '123.456.789-01', $1)`, [ids.owner]))

await deveFalhar('detalhe de PF não se liga a cliente PJ', () =>
  db.query(`insert into individual_client_details (client_id, full_name) values ($1, 'X')`, [ids.empresa]),
  /individual_client_details_client_fkey/)

// Deduplicação feita pelo backend (service role): Almeida traz João; não nasce
// outro Client, nasce o relacionamento. Ferreira também tem relação com João.
await deve('Almeida traz João: reutiliza o Client e cria o relacionamento', () => comoServico(async (tx) => {
  await tx.query(`insert into client_organization_relationships (client_id, organization_id) values ($1, $2)`, [ids.joao, ids.almeida])
  await tx.query(`insert into client_organization_relationships (client_id, organization_id) values ($1, $2)`, [ids.joao, ids.ferreira])
  const r = await um(tx, `select origin_organization_id from clients where id = $1`, [ids.joao])
  igual(r.origin_organization_id, ids.owner, 'origem histórica do cliente')
}))

await deve('Ferreira cadastra Carla (cliente só dela)', () => comoServico(async (tx) => {
  ids.carla = (await um(tx, `insert into clients (kind, cpf, origin_organization_id)
    values ('INDIVIDUAL', '55566677788', $1) returning id`, [ids.ferreira])).id
  await tx.query(`insert into individual_client_details (client_id, full_name) values ($1, 'Carla Souza')`, [ids.carla])
  await tx.query(`insert into client_organization_relationships (client_id, organization_id) values ($1, $2)`, [ids.carla, ids.ferreira])
}))

// ═════════════════════════════ casos ═════════════════════════════════════

secao('Casos: parceiro, origem e escopo')
await deve('Almeida cria caso de João com origem Almeida (opção A)', () => como(ids.almeidaUsr, async (tx) => {
  ids.casoA = (await um(tx, `insert into legal_cases (client_id, legal_area_id, title, status, partner_organization_id, origin_organization_id)
    values ($1, $2, 'Consignado BMG', 'SUBMITTED', $3, $3) returning id, created_by_organization_id, submitted_at`,
    [ids.joao, ids.banking, ids.almeida]))
  igual(ids.casoA.created_by_organization_id, ids.almeida, 'created_by_organization_id')
  if (!ids.casoA.submitted_at) throw new Error('submitted_at não foi preenchido')
  ids.casoA = ids.casoA.id
}))

await deve('Almeida cria caso de João com origem Bárbara (opção B)', () => como(ids.almeidaUsr, async (tx) => {
  ids.casoB = (await um(tx, `insert into legal_cases (client_id, legal_area_id, title, status, partner_organization_id, origin_organization_id)
    values ($1, $2, 'Consignado Pan', 'SUBMITTED', $3, $4) returning id`,
    [ids.joao, ids.banking, ids.almeida, ids.owner])).id
}))

await deveFalhar('parceiro não escolhe outro parceiro como origem', () => como(ids.almeidaUsr, (tx) =>
  tx.query(`insert into legal_cases (client_id, legal_area_id, title, status, partner_organization_id, origin_organization_id)
    values ($1, $2, 'x', 'DRAFT', $3, $4)`, [ids.joao, ids.banking, ids.almeida, ids.ferreira])),
  /origem/)

await deveFalhar('parceiro não cria caso em nome de outro parceiro', () => como(ids.almeidaUsr, (tx) =>
  tx.query(`insert into legal_cases (client_id, legal_area_id, title, status, partner_organization_id, origin_organization_id)
    values ($1, $2, 'x', 'DRAFT', $3, $3)`, [ids.joao, ids.banking, ids.ferreira])),
  /row-level security|próprio escritório/)

await deveFalhar('parceiro não cria caso já aceito', () => como(ids.almeidaUsr, (tx) =>
  tx.query(`insert into legal_cases (client_id, legal_area_id, title, status, partner_organization_id, origin_organization_id, accepted_at, assigned_lawyer_id)
    values ($1, $2, 'x', 'ACCEPTED', $3, $3, now(), $4)`, [ids.joao, ids.banking, ids.almeida, ids.lucas])),
  /row-level security/)

await deveFalhar('parceiro não abre caso para cliente sem relacionamento', () => como(ids.almeidaUsr, (tx) =>
  tx.query(`insert into legal_cases (client_id, legal_area_id, title, status, partner_organization_id, origin_organization_id)
    values ($1, $2, 'x', 'DRAFT', $3, $3)`, [ids.carla, ids.banking, ids.almeida])),
  /row-level security/)

await deve('Ferreira cria caso de Carla', () => como(ids.ferreiraAdm, async (tx) => {
  ids.casoF = (await um(tx, `insert into legal_cases (client_id, legal_area_id, title, status, partner_organization_id, origin_organization_id)
    values ($1, $2, 'Revisional Itaú', 'SUBMITTED', $3, $3) returning id`, [ids.carla, ids.banking, ids.ferreira])).id
}))

await deve('Bárbara cria caso interno de João', () => como(ids.barbara, async (tx) => {
  ids.casoI = (await um(tx, `insert into legal_cases (client_id, legal_area_id, title, origin_organization_id)
    values ($1, $2, 'Caso interno', $3) returning id`, [ids.joao, ids.banking, ids.owner])).id
}))

await deve('mesmo Client possui casos de origens diferentes', async () => {
  const r = await linhas(db, `select distinct origin_organization_id o from legal_cases where client_id = $1 order by 1`, [ids.joao])
  igual(r.length, 2, 'origens distintas de João')
})

await deve('Partner não lê caso de outro Partner nem caso interno', () => como(ids.almeidaUsr, async (tx) => {
  const r = await linhas(tx, `select id from legal_cases order by title`)
  const vistos = r.map((x) => x.id).sort()
  igual(vistos, [ids.casoA, ids.casoB].sort(), 'casos vistos pela Almeida')
}))

await deve('Partner continua lendo caso cuja origem financeira é Bárbara', () => como(ids.almeidaUsr, async (tx) => {
  const r = await um(tx, `select origin_organization_id from legal_cases where id = $1`, [ids.casoB])
  igual(r?.origin_organization_id, ids.owner, 'caso B visível com origem Bárbara')
}))

await deve('Partner não lê cliente de outro Partner', () => como(ids.almeidaUsr, async (tx) => {
  const r = await linhas(tx, `select id from clients`)
  igual(r.map((x) => x.id), [ids.joao], 'clientes vistos pela Almeida')
  const d = await linhas(tx, `select full_name from individual_client_details`)
  igual(d.map((x) => x.full_name), ['João da Silva'], 'detalhes vistos')
}))

await deve('Partner não descobre outro relacionamento do mesmo cliente', () => como(ids.almeidaUsr, async (tx) => {
  const r = await linhas(tx, `select organization_id from client_organization_relationships where client_id = $1`, [ids.joao])
  igual(r.map((x) => x.organization_id), [ids.almeida], 'relacionamentos de João vistos pela Almeida')
}))

await deve('Partner vê só a própria organização e a do proprietário', () => como(ids.almeidaUsr, async (tx) => {
  const r = await linhas(tx, `select id from organizations`)
  igual(r.map((x) => x.id).sort(), [ids.owner, ids.almeida].sort(), 'organizações')
}))

await deve('Partner não lê configuração de parceria (nem a própria)', () => como(ids.almeidaAdm, async (tx) => {
  igual((await linhas(tx, `select 1 from partner_office_settings`)).length, 0, 'linhas')
}))

secao('Aceite e rejeição')
await deveFalhar('Case aceito exige Lawyer', () => como(ids.lucas, (tx) =>
  tx.query(`update legal_cases set status = 'ACCEPTED', accepted_at = now() where id = $1`, [ids.casoA])),
  /accepted_requires_lawyer/)

await deveFalhar('advogado responsável precisa ser ADMIN ou LAWYER interno', () => como(ids.lucas, (tx) =>
  tx.query(`update legal_cases set status = 'ACCEPTED', accepted_at = now(), assigned_lawyer_id = $2 where id = $1`, [ids.casoA, ids.ana])),
  /advogado responsável/)

await deveFalhar('ASSISTANT não aceita caso', () => como(ids.ana, (tx) =>
  tx.query(`update legal_cases set status = 'ACCEPTED', accepted_at = now(), assigned_lawyer_id = $2 where id = $1`, [ids.casoA, ids.lucas])),
  /row-level security/)

await deve('LAWYER aceita caso de origem parceiro → nasce snapshot 50/50', () => como(ids.lucas, async (tx) => {
  await tx.query(`update legal_cases set status = 'ACCEPTED', accepted_at = now(), assigned_lawyer_id = $2 where id = $1`, [ids.casoA, ids.lucas])
}).then(async () => {
  const a = await um(db, `select partner_organization_id, partner_percentage::text p, owner_percentage::text o
                          from case_partnership_agreements where legal_case_id = $1`, [ids.casoA])
  igual([a?.partner_organization_id, a?.p, a?.o], [ids.almeida, '50.00', '50.00'], 'snapshot')
}))

await deve('aceite só com status (sem accepted_at no UPDATE, como o PostgREST faz) cria o snapshot [020]', async () => {
  const c = (await um(db, `insert into legal_cases (client_id, legal_area_id, title, status, partner_organization_id,
      origin_organization_id, created_by_organization_id) values ($1, $2, 'Aceite pelo caminho normal', 'SUBMITTED', $3, $3, $3) returning id`,
    [ids.joao, ids.banking, ids.almeida])).id
  await como(ids.lucas, (tx) => tx.query(`update legal_cases set status = 'ACCEPTED', assigned_lawyer_id = $2 where id = $1`, [c, ids.lucas]))
  const a = await um(db, `select partner_percentage::text p from case_partnership_agreements where legal_case_id = $1 and cancelled_at is null`, [c])
  igual(a?.p, '50.00', 'snapshot no aceite sem accepted_at explícito')
})

await deve('aceite de caso com origem Bárbara não cria divisão de parceiro', () => como(ids.lucas, async (tx) => {
  await tx.query(`update legal_cases set status = 'ACCEPTED', accepted_at = now(), assigned_lawyer_id = $2 where id = $1`, [ids.casoB, ids.lucas])
}).then(async () => {
  const r = await linhas(db, `select 1 from case_partnership_agreements where legal_case_id = $1`, [ids.casoB])
  igual(r.length, 0, 'acordos do caso B')
}))

await deveFalhar('Rejeição exige motivo público', () => como(ids.lucas, (tx) =>
  tx.query(`update legal_cases set status = 'REJECTED', rejected_at = now() where id = $1`, [ids.casoF])),
  /rejected_requires_reason/)

await deve('rejeita com motivo público e nota interna separada', () => como(ids.lucas, async (tx) => {
  await tx.query(`update legal_cases set status = 'REJECTED', rejected_at = now(),
                  rejection_reason_public = 'Documentação insuficiente' where id = $1`, [ids.casoF])
  await tx.query(`insert into legal_case_internal_details (legal_case_id, rejection_reason_internal)
                  values ($1, 'Cliente com histórico de litigância temerária')`, [ids.casoF])
}))

await deve('nota interna nunca chega ao Partner', () => como(ids.ferreiraAdm, async (tx) => {
  const c = await um(tx, `select rejection_reason_public from legal_cases where id = $1`, [ids.casoF])
  igual(c?.rejection_reason_public, 'Documentação insuficiente', 'motivo público visível')
  igual((await linhas(tx, `select * from legal_case_internal_details`)).length, 0, 'notas internas visíveis')
  const colunas = Object.keys((await um(tx, `select * from legal_cases where id = $1`, [ids.casoF])) ?? {})
  if (colunas.some((k) => k.includes('internal'))) throw new Error(`legal_cases expõe ${colunas.join(', ')}`)
}))

secao('Origem depois do aceite')
await deveFalhar('LAWYER não altera origem de caso aceito', () => como(ids.lucas, (tx) =>
  tx.query(`update legal_cases set origin_organization_id = $2 where id = $1`, [ids.casoB, ids.almeida])),
  /Somente ADMIN/)

await deveFalhar('nem ADMIN troca a origem de caso aceito por UPDATE direto', () => como(ids.barbara, (tx) =>
  tx.query(`update legal_cases set origin_organization_id = $2 where id = $1`, [ids.casoB, ids.almeida])),
  /change_case_origin/)

await deveFalhar('LAWYER não troca origem de caso aceito nem pela operação', () => como(ids.lucas, (tx) =>
  tx.query(`select public.change_case_origin($1, $2, 'motivo')`, [ids.casoB, ids.almeida])),
  /Somente ADMIN/)

await deveFalhar('troca de origem de caso aceito exige motivo', () => como(ids.barbara, (tx) =>
  tx.query(`select public.change_case_origin($1, $2, '  ')`, [ids.casoB, ids.almeida])),
  /exige motivo/)

await deve('ADMIN troca a origem (OWNER → parceiro) → snapshot e CASE_ORIGIN_CHANGED com motivo', () => como(ids.barbara, (tx) =>
  tx.query(`select public.change_case_origin($1, $2, 'Indicação comprovada da Almeida')`, [ids.casoB, ids.almeida])
).then(async () => {
  const a = await um(db, `select partner_percentage::text p from case_partnership_agreements
                          where legal_case_id = $1 and cancelled_at is null`, [ids.casoB])
  igual(a?.p, '50.00', 'snapshot criado na troca de origem')
  const ev = await um(db, `select actor_type, actor_user_id, metadata from audit_events
                           where action = 'CASE_ORIGIN_CHANGED' and entity_id = $1`, [ids.casoB])
  igual([ev?.actor_type, ev?.actor_user_id], ['USER', ids.barbara], 'autor do evento')
  igual(ev?.metadata?.after_acceptance, true, 'after_acceptance')
  igual(ev?.metadata?.reason, 'Indicação comprovada da Almeida', 'motivo')
}))

secao('Snapshot financeiro')
await deve('alterar porcentagem padrão não altera Case antigo', async () => {
  await como(ids.barbara, (tx) => tx.query(
    `update partner_office_settings set default_partner_percentage = 60, default_owner_percentage = 40
     where organization_id = $1`, [ids.almeida]))
  const a = await um(db, `select partner_percentage::text p from case_partnership_agreements where legal_case_id = $1`, [ids.casoA])
  igual(a.p, '50.00', 'caso A continua 50/50')
  const ev = await um(db, `select metadata from audit_events where action = 'PARTNER_SHARE_CHANGED'`)
  igual(ev?.metadata?.preserved_agreements, 3, 'acordos preservados no evento')

  // Caso novo aceito depois usa 60/40.
  const novo = await um(db, `insert into legal_cases (client_id, legal_area_id, title, partner_organization_id,
      origin_organization_id, created_by_organization_id, status, accepted_at, assigned_lawyer_id)
    values ($1, $2, 'Caso novo', $3, $3, $3, 'ACCEPTED', now(), $4) returning id`,
    [ids.joao, ids.banking, ids.almeida, ids.lucas])
  const b = await um(db, `select partner_percentage::text p from case_partnership_agreements where legal_case_id = $1`, [novo.id])
  igual(b.p, '60.00', 'caso novo')
})

await deveFalhar('ninguém reescreve percentual de snapshot (nem ADMIN)', () => como(ids.barbara, (tx) =>
  tx.query(`update case_partnership_agreements set partner_percentage = 70, owner_percentage = 30
            where legal_case_id = $1`, [ids.casoA])), /permission denied/)

await deveFalhar('LAWYER não cancela acordo de parceria', () => como(ids.lucas, (tx) =>
  tx.query(`update case_partnership_agreements set cancelled_at = now(), cancellation_reason = 'x'
            where legal_case_id = $1 returning id`, [ids.casoA]).then((r) => {
    if (r.rows.length === 0) throw new Error('bloqueado pela RLS')
  })), /bloqueado pela RLS|Somente ADMIN/)

await deveFalhar('acordo de parceria só para caso de origem parceiro', () =>
  db.query(`insert into case_partnership_agreements (legal_case_id, partner_organization_id, partner_percentage, owner_percentage)
            values ($1, $2, 50, 50)`, [ids.casoI, ids.almeida]),
  /origem é este parceiro/)

// ═════════════════════════════ processos ═════════════════════════════════

secao('Processos')
await deve('um Case pode possuir vários Processes', () => como(ids.lucas, async (tx) => {
  ids.proc1 = (await um(tx, `insert into legal_processes (legal_case_id, cnj_number, status) values ($1, $2, 'FILED') returning id`, [ids.casoA, cnj(800123)])).id
  ids.proc2 = (await um(tx, `insert into legal_processes (legal_case_id, cnj_number, status) values ($1, $2, 'ACTIVE') returning id`, [ids.casoA, cnj(800124)])).id
  const r = await um(tx, `select count(*)::int n from legal_processes where legal_case_id = $1`, [ids.casoA])
  igual(r.n, 2, 'processos do caso A')
}))

await deveFalhar('CNJ com dígito verificador errado é rejeitado', () =>
  db.query(`insert into legal_processes (legal_case_id, cnj_number) values ($1, '08001239920268050001')`, [ids.casoA]),
  /cnj_digits|is_valid_cnj/)

await deveFalhar('CNJ duplicado é rejeitado', () =>
  db.query(`insert into legal_processes (legal_case_id, cnj_number) values ($1, $2)`, [ids.casoI, cnj(800123)]),
  /legal_processes_cnj_key/)

await deveFalhar('processo importado exige CNJ', () =>
  db.query(`insert into legal_processes (legal_case_id, technical_origin) values ($1, 'IMPORT')`, [ids.casoA]),
  /official_has_cnj/)

await deve('processo em preparação pode existir sem CNJ', async () => {
  await db.query(`insert into legal_processes (legal_case_id, status) values ($1, 'PREPARING')`, [ids.casoI])
})

await deveFalhar('prazo não aponta processo de outro caso', () =>
  db.query(`insert into deadlines (legal_case_id, legal_process_id, title, due_at) values ($1, $2, 'Réplica', now())`,
    [ids.casoI, ids.proc1]),
  /deadlines_process_fkey/)

await deve('movimentações: parceiro vê a oficial, não a nota manual', async () => {
  await db.query(`insert into process_events (legal_process_id, event_type, description, occurred_at, source, external_provider, external_id)
                  values ($1, 'CITACAO', 'Citação expedida', now(), 'JUDICIAL_INTEGRATION', 'tribunal', 'ev-1')`, [ids.proc1])
  await db.query(`insert into process_events (legal_process_id, event_type, description, occurred_at, source)
                  values ($1, 'NOTA', 'Cliente ligou nervoso', now(), 'MANUAL')`, [ids.proc1])
  await como(ids.almeidaUsr, async (tx) => {
    const r = await linhas(tx, `select event_type from process_events`)
    igual(r.map((x) => x.event_type), ['CITACAO'], 'movimentações vistas pelo parceiro')
    igual((await linhas(tx, `select id from legal_processes`)).length, 2, 'processos vistos pelo parceiro')
  })
  await como(ids.ferreiraAdm, async (tx) => {
    igual((await linhas(tx, `select id from legal_processes`)).length, 0, 'processos vistos pela Ferreira')
  })
})

await deveFalhar('ressincronização não duplica movimentação', () =>
  db.query(`insert into process_events (legal_process_id, event_type, description, occurred_at, source, external_provider, external_id)
            values ($1, 'CITACAO', 'dup', now(), 'JUDICIAL_INTEGRATION', 'tribunal', 'ev-1')`, [ids.proc1]),
  /process_events_external_key/)

// ═════════════════════════════ documentos ════════════════════════════════

secao('Documentos e versões')
async function novaVersao(tx, docId, nome = 'arquivo.pdf', source = 'UPLOAD') {
  const vid = randomUUID()
  const doc = await um(tx, `select client_id from documents where id = $1`, [docId]).catch(() => null)
  const clientId = doc?.client_id ?? ids.joao
  await tx.query(
    `insert into document_versions (id, document_id, storage_object_name, original_filename, mime_type, file_size, checksum_sha256, source)
     values ($1, $2, $3, $4, 'application/pdf', 1024, $5, $6)`,
    [vid, docId, `clients/${clientId}/documents/${docId}/${vid}/${nome}`, nome, sha('a'), source])
  return vid
}

await deve('documento interno e documento visível ao parceiro no caso A', () => como(ids.lucas, async (tx) => {
  ids.docInterno = randomUUID()
  ids.docVisivel = randomUUID()
  await tx.query(`insert into documents (id, client_id, category, title) values ($1, $2, 'OTHER', 'Parecer interno')`, [ids.docInterno, ids.joao])
  await tx.query(`insert into documents (id, client_id, category, title, visibility) values ($1, $2, 'PETITION', 'Petição inicial', 'PARTNER_VISIBLE')`, [ids.docVisivel, ids.joao])
  await tx.query(`insert into case_documents (legal_case_id, document_id) values ($1, $2), ($1, $3)`, [ids.casoA, ids.docInterno, ids.docVisivel])
  ids.vInterno = await novaVersao(tx, ids.docInterno, 'parecer.pdf')
  ids.v1 = await novaVersao(tx, ids.docVisivel, 'peticao.pdf', 'AGENT')
}))

await deve('Partner não vê documento INTERNAL', () => como(ids.almeidaUsr, async (tx) => {
  igual((await linhas(tx, `select id from documents`)).map((x) => x.id), [ids.docVisivel], 'documentos')
  igual((await linhas(tx, `select document_id from document_versions`)).map((x) => x.document_id), [ids.docVisivel], 'versões')
  igual((await linhas(tx, `select document_id from case_documents`)).map((x) => x.document_id), [ids.docVisivel], 'vínculos')
}))

await deve('outro Partner não vê nenhum dos dois', () => como(ids.ferreiraAdm, async (tx) => {
  igual((await linhas(tx, `select id from documents`)).length, 0, 'documentos')
}))

await deveFalhar('Partner não vincula documento INTERNAL ao próprio caso', () => como(ids.almeidaUsr, (tx) =>
  tx.query(`insert into case_documents (legal_case_id, document_id) values ($1, $2)`, [ids.casoB, ids.docInterno])),
  /row-level security/)

await deve('Partner envia documento: cria, vincula e sobe a versão', () => como(ids.almeidaUsr, async (tx) => {
  ids.docParceiro = randomUUID()
  await tx.query(`insert into documents (id, client_id, category, title, visibility)
                  values ($1, $2, 'IDENTIFICATION', 'RG do João', 'PARTNER_VISIBLE')`, [ids.docParceiro, ids.joao])
  await tx.query(`insert into case_documents (legal_case_id, document_id) values ($1, $2)`, [ids.casoB, ids.docParceiro])
  await novaVersao(tx, ids.docParceiro, 'rg.pdf')
  igual((await linhas(tx, `select id from documents where id = $1`, [ids.docParceiro])).length, 1, 'documento enviado visível')
}))

await deveFalhar('Partner não envia documento INTERNAL', () => como(ids.almeidaUsr, (tx) =>
  tx.query(`insert into documents (client_id, category, title) values ($1, 'OTHER', 'x')`, [ids.joao])),
  /row-level security/)

await deveFalhar('documento não se vincula a caso de outro cliente', () =>
  db.query(`insert into case_documents (legal_case_id, document_id) values ($1, $2)`, [ids.casoF, ids.docVisivel]),
  /clientes diferentes/)

await deveFalhar('versão é imutável', () =>
  db.query(`update document_versions set original_filename = 'outro.pdf' where id = $1`, [ids.v1]),
  /append-only/)

await deveFalhar('caminho de Storage fora do padrão é rejeitado', () =>
  db.query(`insert into document_versions (document_id, storage_object_name, source) values ($1, 'qualquer/lugar.pdf', 'UPLOAD')`, [ids.docVisivel]),
  /storage_object_name/)

await deve('o helper de caminho sanitiza o nome do arquivo', async () => {
  const r = await um(db, `select private.legal_document_object_name($1, $2, $3, 'Petição Inicial (v2).pdf') p`, [ids.joao, ids.docVisivel, ids.v1])
  igual(r.p, `clients/${ids.joao}/documents/${ids.docVisivel}/${ids.v1}/Peti_o_Inicial_v2_.pdf`, 'caminho')
})

// ═════════════════════════════ revisões ══════════════════════════════════

secao('Revisões')
await deve('LAWYER aprova a v1 (decide_review)', async () => {
  await como(ids.lucas, async (tx) => {
    ids.rev1 = (await um(tx, `insert into reviews (legal_case_id, document_version_id) values ($1, $2) returning id`, [ids.casoA, ids.v1])).id
  })
  await decidir(ids.lucas, ids.rev1, 'APPROVE')
  const r = await um(db, `select status, decided_at from reviews where id = $1`, [ids.rev1])
  igual(r.status, 'APPROVED', 'status da revisão')
  if (!r.decided_at) throw new Error('decided_at não preenchido')
})

await deve('uma nova DocumentVersion não herda aprovação', () => como(ids.lucas, async (tx) => {
  ids.v2 = await novaVersao(tx, ids.docVisivel, 'peticao-v2.pdf', 'MANUAL_EDIT')
  const r = await linhas(tx, `select version_number, approval_status from document_version_approvals
                              where document_id = $1 order by version_number`, [ids.docVisivel])
  igual(r.map((x) => [x.version_number, x.approval_status]), [[1, 'APPROVED'], [2, 'PENDING']], 'situação por versão')
}))

await deveFalhar('versão fora de sequência é rejeitada', () =>
  db.query(`insert into document_versions (document_id, version_number, storage_object_name, source)
            values ($1, 7, 'x', 'UPLOAD')`, [ids.docVisivel]),
  /fora de sequência/)

await deveFalhar('revisão precisa de exatamente um alvo', () =>
  db.query(`insert into reviews (legal_case_id) values ($1)`, [ids.casoA]),
  /exactly_one_target/)

await deveFalhar('não se aprova de novo uma revisão já aprovada', () => decidir(ids.lucas, ids.rev1, 'APPROVE'),
  /não aceita/)

await deve('reabrir mantém a decisão anterior no histórico', async () => {
  await decidir(ids.lucas, ids.rev1, 'REOPEN', 'Rever pedido')
  const d = await linhas(db, `select decision from review_decisions where review_id = $1 order by created_at`, [ids.rev1])
  igual(d.map((x) => x.decision), ['APPROVE', 'REOPEN'], 'decisões')
  igual((await um(db, `select status from reviews where id = $1`, [ids.rev1])).status, 'REOPENED', 'status')
})

await deveFalhar('decisão em nome de outra pessoa é recusada', () => como(ids.lucas, (tx) =>
  tx.query(`select public.decide_review($1, 'APPROVE', null, $2)`, [ids.rev1, ids.barbara])),
  /próprio usuário/)

await deve('Partner não vê Review', () => como(ids.almeidaAdm, async (tx) => {
  igual((await linhas(tx, `select 1 from reviews`)).length, 0, 'reviews')
  igual((await linhas(tx, `select 1 from review_decisions`)).length, 0, 'decisões')
}))

await deve('ASSISTANT não vê Review nem análise', () => como(ids.ana, async (tx) => {
  igual((await linhas(tx, `select 1 from reviews`)).length, 0, 'reviews')
  igual((await linhas(tx, `select 1 from legal_analyses`)).length, 0, 'análises')
}))

// ═════════════════════════════ solicitações ══════════════════════════════

secao('Solicitações ao parceiro')
await deve('LAWYER pede documento à Almeida; Almeida responde', async () => {
  await como(ids.lucas, async (tx) => {
    ids.pedido = (await um(tx, `insert into partner_requests (partner_organization_id, legal_case_id, type, title)
      values ($1, $2, 'DOCUMENT', 'Enviar extrato HISCON') returning id`, [ids.almeida, ids.casoA])).id
  })
  await como(ids.almeidaUsr, async (tx) => {
    await tx.query(`insert into partner_request_messages (partner_request_id, author_id, body) values ($1, $2, 'Segue em anexo')`, [ids.pedido, ids.almeidaUsr])
    await tx.query(`update partner_requests set status = 'ANSWERED' where id = $1`, [ids.pedido])
  })
  const r = await um(db, `select status, answered_at from partner_requests where id = $1`, [ids.pedido])
  igual(r.status, 'ANSWERED', 'status')
})

await db.query(`update partner_requests set status = 'OPEN', answered_at = null where id = $1`, [ids.pedido])
await deveFalhar('parceiro não reescreve a solicitação', () => como(ids.almeidaUsr, (tx) =>
  tx.query(`update partner_requests set title = 'outra coisa' where id = $1`, [ids.pedido])),
  /só pode responder/)

await deveFalhar('solicitação só vai para o parceiro do caso', () =>
  db.query(`insert into partner_requests (partner_organization_id, legal_case_id, type, title)
            values ($1, $2, 'GENERAL', 'x')`, [ids.ferreira, ids.casoA]),
  /parceiro do caso/)

await deve('outro parceiro não vê a solicitação', () => como(ids.ferreiraAdm, async (tx) => {
  igual((await linhas(tx, `select 1 from partner_requests`)).length, 0, 'solicitações')
  igual((await linhas(tx, `select 1 from partner_request_messages`)).length, 0, 'mensagens')
}))

// ═════════════════════════════ financeiro ════════════════════════════════

secao('Financeiro')
await deve('ADMIN registra honorários, obrigação e recebimento; a divisão nasce sozinha do snapshot', () => como(ids.barbara, async (tx) => {
  ids.acordo = (await um(tx, `insert into financial_agreements (legal_case_id, fixed_fee, status) values ($1, 4000, 'ACTIVE') returning id`, [ids.casoA])).id
  ids.pagamento = (await um(tx, `insert into payments (financial_agreement_id, amount, payment_type, due_date)
    values ($1, 4000, 'FIXED', current_date + 30) returning id`, [ids.acordo])).id
  ids.recebimento = (await um(tx, `insert into payment_receipts (payment_id, kind, amount, method)
    values ($1, 'RECEIPT', 4000, 'PIX') returning id`, [ids.pagamento])).id
  const parceria = await um(tx, `select id from case_partnership_agreements where legal_case_id = $1 and cancelled_at is null`, [ids.casoA])
  ids.parceriaA = parceria.id
  const d = await um(tx, `select id, partner_amount::text p, owner_amount::text o, case_partnership_agreement_id a
                          from partner_revenue_allocations where receipt_id = $1`, [ids.recebimento])
  igual([d?.p, d?.o, d?.a], ['2000.00', '2000.00', ids.parceriaA], 'divisão automática 50/50')
  ids.divisao = d.id
  ids.repasse = (await um(tx, `insert into partner_transfers (partner_organization_id, amount) values ($1, 1000) returning id`, [ids.almeida])).id
  await tx.query(`insert into partner_transfer_items (transfer_id, allocation_id, amount) values ($1, $2, 1000)`, [ids.repasse, ids.divisao])
  await tx.query(`update partner_transfers set status = 'PAID' where id = $1`, [ids.repasse])
}))

await deveFalhar('um segundo acordo ATIVO no mesmo caso é impedido', () =>
  db.query(`insert into financial_agreements (legal_case_id, status) values ($1, 'ACTIVE')`, [ids.casoA]),
  /one_active_per_case/)

await deveFalhar('divisão não se digita: nem ADMIN insere', () => como(ids.barbara, (tx) =>
  tx.query(`insert into partner_revenue_allocations (receipt_id, case_partnership_agreement_id, base_amount, partner_percentage, partner_amount, owner_amount)
            values ($1, $2, 4000, 50, 3000, 1000)`, [ids.recebimento, ids.parceriaA])),
  /permission denied/)

await deveFalhar('divisão incompatível com o percentual congelado é recusada (mesmo pelo dono do banco)', () =>
  db.query(`insert into partner_revenue_allocations (receipt_id, case_partnership_agreement_id, base_amount, partner_percentage, partner_amount, owner_amount)
            values ($1, $2, 4000, 50, 2500, 1500)`, [ids.recebimento, ids.parceriaA]),
  /allocations_formula|receipt_id_key|duplicate/)

await deveFalhar('repasse não excede a parte do parceiro', async () => {
  const t = await um(db, `insert into partner_transfers (partner_organization_id, amount) values ($1, 5000) returning id`, [ids.almeida])
  await db.query(`insert into partner_transfer_items (transfer_id, allocation_id, amount) values ($1, $2, 1500)`, [t.id, ids.divisao])
}, /excede a parte/)

await deveFalhar('valor negativo é rejeitado', () =>
  db.query(`insert into payments (financial_agreement_id, amount, payment_type) values ($1, -10, 'OTHER')`, [ids.acordo]))

await deveFalhar('obrigação não guarda valor pago (o ledger guarda)', () =>
  db.query(`update payments set paid_amount = 10 where id = $1`, [ids.pagamento]),
  /paid_amount/)

await deve('Partner Admin vê apenas seu financeiro', () => como(ids.almeidaAdm, async (tx) => {
  const acordos = await linhas(tx, `select partner_organization_id from case_partnership_agreements`)
  if (acordos.length === 0 || acordos.some((a) => a.partner_organization_id !== ids.almeida))
    throw new Error(`acordos vistos: ${JSON.stringify(acordos)}`)
  igual((await linhas(tx, `select partner_amount::text v from partner_revenue_allocations`)).map((x) => x.v), ['2000.00'], 'divisões')
  igual((await linhas(tx, `select amount::text v from partner_transfers where status = 'PAID'`)).map((x) => x.v), ['1000.00'], 'repasses')
  const saldo = await um(tx, `select net_partner_amount::text n, paid_amount::text p from partner_allocation_balances`)
  igual([saldo?.n, saldo?.p], ['2000.00', '1000.00'], 'saldo derivado')
  for (const t of ['payments', 'payment_receipts', 'financial_agreements', 'fee_models', 'payment_balances'])
    igual((await linhas(tx, `select 1 from ${t}`)).length, 0, t)
}))

await deveFalhar('Partner Admin não registra recebimento', () => como(ids.almeidaAdm, (tx) =>
  tx.query(`insert into payment_receipts (payment_id, kind, amount) values ($1, 'RECEIPT', 1)`, [ids.pagamento])),
  /Somente ADMIN interno opera o financeiro/)

await deveFalhar('Partner Admin não altera repasse', () => como(ids.almeidaAdm, (tx) =>
  tx.query(`update partner_transfers set status = 'CANCELLED', cancellation_reason = 'x' where id = $1 returning id`, [ids.repasse])
    .then((r) => { if (r.rows.length === 0) throw new Error('bloqueado pela RLS') })),
  /bloqueado pela RLS|permission denied/)

await deve('Partner Admin de outro parceiro não vê o financeiro da Almeida', () => como(ids.ferreiraAdm, async (tx) => {
  for (const t of ['case_partnership_agreements', 'partner_revenue_allocations', 'partner_transfers', 'partner_allocation_balances'])
    igual((await linhas(tx, `select 1 from ${t}`)).length, 0, t)
}))

await deve('Partner User não vê financeiro', () => como(ids.almeidaUsr, async (tx) => {
  for (const t of ['case_partnership_agreements', 'partner_revenue_allocations', 'partner_transfers',
    'partner_transfer_items', 'payments', 'payment_receipts', 'financial_agreements', 'partner_allocation_balances']) {
    igual((await linhas(tx, `select 1 from ${t}`)).length, 0, t)
  }
}))

await deve('LAWYER e ASSISTANT não veem financeiro interno', async () => {
  for (const u of [ids.lucas, ids.ana]) {
    await como(u, async (tx) => {
      for (const t of ['payments', 'payment_receipts', 'financial_agreements', 'case_partnership_agreements',
        'partner_transfers', 'payment_balances'])
        igual((await linhas(tx, `select 1 from ${t}`)).length, 0, t)
    })
  }
})

// ═════════════════════════════ ledger (status derivado) ══════════════════

secao('Ledger: obrigação, recebimento, estorno')
await deve('R$ 1.000: +500 PARTIAL → +500 PAID → estorno −500 PARTIAL, sem reescrever o original', async () => {
  const st = async () => (await um(db, `select status, received_amount::text r, balance::text b from payment_balances where payment_id = $1`, [ids.obrig])).status
  await como(ids.barbara, async (tx) => {
    ids.obrig = (await um(tx, `insert into payments (financial_agreement_id, amount, payment_type, due_date)
      values ($1, 1000, 'MONTHLY', current_date + 10) returning id`, [ids.acordo])).id
  })
  igual(await st(), 'PENDING', 'sem recebimento')
  ids.rec1 = (await como(ids.barbara, (tx) => um(tx, `insert into payment_receipts (payment_id, kind, amount) values ($1, 'RECEIPT', 500) returning id`, [ids.obrig]))).id
  igual(await st(), 'PARTIAL', 'depois de 500')
  await como(ids.barbara, (tx) => tx.query(`insert into payment_receipts (payment_id, kind, amount) values ($1, 'RECEIPT', 500)`, [ids.obrig]))
  igual(await st(), 'PAID', 'depois de 1000')
  await como(ids.barbara, (tx) => tx.query(`insert into payment_receipts (payment_id, kind, amount, original_receipt_id, notes)
    values ($1, 'REVERSAL', -500, $2, 'PIX devolvido')`, [ids.obrig, ids.rec1]))
  igual(await st(), 'PARTIAL', 'depois do estorno')
  const orig = await um(db, `select amount::text a from payment_receipts where id = $1`, [ids.rec1])
  igual(orig.a, '500.00', 'recebimento original intacto')
  igual((await um(db, `select count(*)::int n from payment_receipts where payment_id = $1`, [ids.obrig])).n, 3, 'lançamentos')
})

await deveFalhar('recebimento histórico não se edita', () =>
  db.query(`update payment_receipts set amount = 400 where id = $1`, [ids.rec1]),
  /append-only/)

await deveFalhar('nem a service role apaga recebimento', () => comoServico((tx) =>
  tx.query(`delete from payment_receipts where id = $1`, [ids.rec1])),
  /permission denied/)

await deveFalhar('estorno além do lançamento original é recusado', () =>
  db.query(`insert into payment_receipts (payment_id, kind, amount, original_receipt_id) values ($1, 'REVERSAL', -1, $2)`, [ids.obrig, ids.rec1]),
  /excede o valor do lançamento original/)

await deveFalhar('estorno sem lançamento original é recusado', () =>
  db.query(`insert into payment_receipts (payment_id, kind, amount) values ($1, 'REVERSAL', -10)`, [ids.obrig]),
  /kind_consistent/)

await deveFalhar('recebimento acima da obrigação é recusado', () =>
  db.query(`insert into payment_receipts (payment_id, kind, amount) values ($1, 'RECEIPT', 600)`, [ids.obrig]),
  /excederia a obrigação/)

await deveFalhar('ajuste sem justificativa é recusado', () =>
  db.query(`insert into payment_receipts (payment_id, kind, amount) values ($1, 'ADJUSTMENT', 10)`, [ids.obrig]),
  /kind_consistent/)

await deve('vencida com saldo aberto é OVERDUE; cancelada é CANCELLED', async () => {
  const p = (await um(db, `insert into payments (financial_agreement_id, amount, payment_type, due_date)
    values ($1, 300, 'OTHER', current_date - 5) returning id`, [ids.acordo])).id
  igual((await um(db, `select status from payment_balances where payment_id = $1`, [p])).status, 'OVERDUE', 'vencida')
  await db.query(`update payments set cancelled_at = now(), cancellation_reason = 'Acordo refeito' where id = $1`, [p])
  igual((await um(db, `select status from payment_balances where payment_id = $1`, [p])).status, 'CANCELLED', 'cancelada')
})

await deve('o estorno desfaz a parte do parceiro no MESMO acordo (simétrico)', async () => {
  const r = await linhas(db, `select al.partner_amount::text p, al.reverses_allocation_id is not null estorno
                              from partner_revenue_allocations al join payment_receipts r on r.id = al.receipt_id
                              where r.payment_id = $1 order by al.sequence`, [ids.obrig])
  igual(r.map((x) => [x.p, x.estorno]), [['250.00', false], ['250.00', false], ['-250.00', true]], 'divisões do ledger')
})

secao('Divisão do parceiro e snapshot histórico')
await deve('50/50 sobre R$ 1.000 recebido → parceiro R$ 500; mudar o padrão para 60/40 não muda o histórico', async () => {
  const p = (await um(db, `insert into payments (financial_agreement_id, amount, payment_type) values ($1, 1000, 'OTHER') returning id`, [ids.acordo])).id
  const r = (await um(db, `insert into payment_receipts (payment_id, kind, amount) values ($1, 'RECEIPT', 1000) returning id`, [p])).id
  igual((await um(db, `select partner_amount::text v from partner_revenue_allocations where receipt_id = $1`, [r])).v, '500.00', 'parte do parceiro')
  await como(ids.barbara, (tx) => tx.query(`update partner_office_settings set default_partner_percentage = 60, default_owner_percentage = 40
                                             where organization_id = $1`, [ids.almeida]))
  igual((await um(db, `select partner_amount::text v from partner_revenue_allocations where receipt_id = $1`, [r])).v, '500.00', 'histórico')
  // Caso novo aceito agora: snapshot 60/40 e divisão a 60%.
  const novo = (await um(db, `insert into legal_cases (client_id, legal_area_id, title, partner_organization_id,
      origin_organization_id, created_by_organization_id, status, accepted_at, assigned_lawyer_id)
    values ($1, $2, 'Caso 60/40', $3, $3, $3, 'ACCEPTED', now(), $4) returning id`, [ids.joao, ids.banking, ids.almeida, ids.lucas])).id
  const fa = (await um(db, `insert into financial_agreements (legal_case_id, status) values ($1, 'ACTIVE') returning id`, [novo])).id
  const p2 = (await um(db, `insert into payments (financial_agreement_id, amount, payment_type) values ($1, 1000, 'OTHER') returning id`, [fa])).id
  const r2 = (await um(db, `insert into payment_receipts (payment_id, kind, amount) values ($1, 'RECEIPT', 1000) returning id`, [p2])).id
  igual((await um(db, `select partner_amount::text v from partner_revenue_allocations where receipt_id = $1`, [r2])).v, '600.00', 'caso novo a 60%')
  await db.query(`update partner_office_settings set default_partner_percentage = 50, default_owner_percentage = 50 where organization_id = $1`, [ids.almeida])
})

await deve('arredondamento: R$ 100,01 a 50% → parceiro 50,01 + escritório 50,00 = base', async () => {
  const p = (await um(db, `insert into payments (financial_agreement_id, amount, payment_type) values ($1, 100.01, 'OTHER') returning id`, [ids.acordo])).id
  const r = (await um(db, `insert into payment_receipts (payment_id, kind, amount) values ($1, 'RECEIPT', 100.01) returning id`, [p])).id
  const d = await um(db, `select partner_amount::text p, owner_amount::text o from partner_revenue_allocations where receipt_id = $1`, [r])
  igual([d.p, d.o], ['50.01', '50.00'], 'divisão arredondada')
})

secao('Repasse cancelado devolve o saldo')
await deve('repasse cancelado deixa de consumir a parte do parceiro', async () => {
  const p = (await um(db, `insert into payments (financial_agreement_id, amount, payment_type) values ($1, 1000, 'OTHER') returning id`, [ids.acordo])).id
  const r = (await um(db, `insert into payment_receipts (payment_id, kind, amount) values ($1, 'RECEIPT', 1000) returning id`, [p])).id
  const al = (await um(db, `select id from partner_revenue_allocations where receipt_id = $1`, [r])).id
  const disponivel = async () => Number((await um(db, `select private.allocation_available_amount($1) v`, [al])).v)
  igual(await disponivel(), 500, 'antes do repasse')
  const t = (await um(db, `insert into partner_transfers (partner_organization_id, amount) values ($1, 300) returning id`, [ids.almeida])).id
  await db.query(`insert into partner_transfer_items (transfer_id, allocation_id, amount) values ($1, $2, 300)`, [t, al])
  igual(await disponivel(), 200, 'com repasse pendente')
  await como(ids.barbara, (tx) => tx.query(`update partner_transfers set status = 'CANCELLED', cancellation_reason = 'Dados bancários errados' where id = $1`, [t]))
  igual(await disponivel(), 500, 'depois do cancelamento')
  const t2 = (await um(db, `insert into partner_transfers (partner_organization_id, amount) values ($1, 500) returning id`, [ids.almeida])).id
  await db.query(`insert into partner_transfer_items (transfer_id, allocation_id, amount) values ($1, $2, 500)`, [t2, al])
  igual(await disponivel(), 0, 'repasse integral depois')
})

await deveFalhar('item não entra em repasse já pago', () =>
  db.query(`insert into partner_transfer_items (transfer_id, allocation_id, amount) values ($1, $2, 1)`, [ids.repasse, ids.divisao]),
  /PENDING/)

await deveFalhar('repasse cancelado não volta', () =>
  db.query(`update partner_transfers set status = 'PENDING', cancelled_at = null, cancellation_reason = null
            where status = 'CANCELLED'`),
  /inválida/)

// ═════════════════════════════ troca de origem: histórico ════════════════

secao('Troca de origem: histórico de parceria')
await deve('Parceiro A → Parceiro B → OWNER → Parceiro A: cancela, recria, nunca apaga; um ativo por vez', async () => {
  const caso = (await um(db, `insert into legal_cases (client_id, legal_area_id, title, partner_organization_id,
      origin_organization_id, created_by_organization_id, status, accepted_at, assigned_lawyer_id)
    values ($1, $2, 'Caso de origem trocada', $3, $3, $3, 'ACCEPTED', now(), $4) returning id`,
    [ids.joao, ids.banking, ids.almeida, ids.lucas])).id
  const fa = (await um(db, `insert into financial_agreements (legal_case_id, status) values ($1, 'ACTIVE') returning id`, [caso])).id
  const pg = (await um(db, `insert into payments (financial_agreement_id, amount, payment_type) values ($1, 2000, 'OTHER') returning id`, [fa])).id
  const antes = (await um(db, `insert into payment_receipts (payment_id, kind, amount) values ($1, 'RECEIPT', 1000) returning id`, [pg])).id
  const acordoA = (await um(db, `select id from case_partnership_agreements where legal_case_id = $1 and cancelled_at is null`, [caso])).id

  const ativos = async () => linhas(db, `select partner_organization_id p from case_partnership_agreements
                                         where legal_case_id = $1 and cancelled_at is null`, [caso])
  const troca = (para, motivo) => como(ids.barbara, (tx) => tx.query(`select public.change_case_origin($1, $2, $3)`, [caso, para, motivo]))

  await troca(ids.ferreira, 'Origem real é a Ferreira')
  igual((await ativos()).map((x) => x.p), [ids.ferreira], 'A → B')
  const a = await um(db, `select cancelled_at is not null c, cancelled_by, cancellation_reason r from case_partnership_agreements where id = $1`, [acordoA])
  igual([a.c, a.cancelled_by, a.r], [true, ids.barbara, 'Origem real é a Ferreira'], 'acordo A cancelado, com autor e motivo')

  // Receita recebida antes continua ligada ao acordo A; a nova segue o acordo de B (60%).
  igual((await um(db, `select case_partnership_agreement_id a from partner_revenue_allocations where receipt_id = $1`, [antes])).a, acordoA, 'receita antiga')
  const depois = (await um(db, `insert into payment_receipts (payment_id, kind, amount) values ($1, 'RECEIPT', 1000) returning id`, [pg])).id
  const nova = await um(db, `select al.partner_amount::text v, a.partner_organization_id p from partner_revenue_allocations al
                             join case_partnership_agreements a on a.id = al.case_partnership_agreement_id where al.receipt_id = $1`, [depois])
  igual([nova.v, nova.p], ['600.00', ids.ferreira], 'receita nova no acordo de B')

  // Estorno de recebimento antigo segue o acordo antigo, mesmo cancelado.
  await db.query(`insert into payment_receipts (payment_id, kind, amount, original_receipt_id) values ($1, 'REVERSAL', -1000, $2)`, [pg, antes])
  const estorno = await um(db, `select al.case_partnership_agreement_id a, al.partner_amount::text v from partner_revenue_allocations al
                                join payment_receipts r on r.id = al.receipt_id where r.original_receipt_id = $1`, [antes])
  igual([estorno.a, estorno.v], [acordoA, '-500.00'], 'estorno no acordo antigo')

  await troca(ids.owner, 'Cliente veio direto ao escritório')
  igual((await ativos()).length, 0, 'Parceiro → OWNER: nenhum ativo')

  await troca(ids.almeida, 'Indicação da Almeida confirmada')
  igual((await ativos()).map((x) => x.p), [ids.almeida], 'OWNER → Parceiro')

  const antesMesma = (await um(db, `select count(*)::int n from case_partnership_agreements where legal_case_id = $1`, [caso])).n
  await troca(ids.almeida, 'Sem mudança')
  igual((await um(db, `select count(*)::int n from case_partnership_agreements where legal_case_id = $1`, [caso])).n, antesMesma, 'mesmo parceiro: sem snapshot novo')
  igual(antesMesma, 3, 'três acordos no histórico (A, B, A)')

  const ev = await linhas(db, `select action from audit_events where entity_type = 'case_partnership_agreements'
                               and metadata ->> 'legal_case_id' = $1 order by created_at`, [caso])
  igual(ev.filter((e) => e.action === 'PARTNERSHIP_AGREEMENT_CANCELLED').length, 2, 'cancelamentos auditados')
})

await deveFalhar('acordo cancelado é histórico: não se reativa', () =>
  db.query(`update case_partnership_agreements set cancelled_at = null where cancelled_at is not null`),
  /histórico/)

// ═════════════════════════════ agentes e fila ════════════════════════════

secao('Agentes: pedido de execução')
await deve('ADMIN cadastra agente e versão; current_version aponta para versão dele', () => como(ids.barbara, async (tx) => {
  ids.agente = (await um(tx, `insert into agents (slug, name, status) values ('analise-bancaria', 'Análise bancária', 'ACTIVE') returning id`)).id
  ids.agenteV = (await um(tx, `insert into agent_versions (agent_id, instructions) values ($1, 'Analise o extrato.') returning id, version_number`, [ids.agente]))
  igual(ids.agenteV.version_number, 1, 'número da versão')
  ids.agenteV = ids.agenteV.id
  await tx.query(`update agents set current_version_id = $2 where id = $1`, [ids.agente, ids.agenteV])
}))

await deve('LAWYER não vê agentes, skills nem a tabela de execuções', () => como(ids.lucas, async (tx) => {
  for (const t of ['agents', 'agent_versions', 'skills', 'legal_theses', 'reference_materials', 'agent_runs'])
    igual((await linhas(tx, `select 1 from ${t}`)).length, 0, t)
}))

await deveFalhar('usuário não cria execução por INSERT direto', () => como(ids.barbara, (tx) =>
  tx.query(`insert into agent_runs (agent_id, agent_version_id) values ($1, $2)`, [ids.agente, ids.agenteV])),
  /permission denied/)

await deve('LAWYER pede execução no caso: requested_by, entrada isolada e evento com o autor', async () => {
  ids.run = (await como(ids.lucas, (tx) => um(tx,
    `select public.request_agent_run($1, $2, null, 'Conferir o HISCON do João, CPF 12345678901') id`,
    [ids.agente, ids.casoA]))).id
  const r = await um(db, `select requested_by, status, metadata, queue_msg_id from agent_runs where id = $1`, [ids.run])
  igual([r.requested_by, r.status], [ids.lucas, 'QUEUED'], 'execução')
  if (!r.queue_msg_id) throw new Error('não enfileirou')
  if (JSON.stringify(r.metadata).includes('12345678901')) throw new Error('entrada vazou para metadata')
  const i = await um(db, `select request_text, requested_by, expires_at > now() + interval '170 days' ok from agent_run_inputs where agent_run_id = $1`, [ids.run])
  igual([i.requested_by, i.ok], [ids.lucas, true], 'entrada com retenção')
  const ev = await um(db, `select actor_type, actor_user_id from audit_events where action = 'AGENT_RUN_REQUESTED' and entity_id = $1`, [ids.run])
  igual([ev.actor_type, ev.actor_user_id], ['USER', ids.lucas], 'autor do pedido')
})

await deve('ADMIN pede execução sem caso', () => como(ids.barbara, async (tx) => {
  ids.runAdmin = (await um(tx, `select public.request_agent_run($1) id`, [ids.agente])).id
}))

await deve('backend (service role) pede em nome do LAWYER; o banco revalida o papel', async () => {
  const r = await comoServico((tx) => um(tx, `select public.request_agent_run($1, $2, null, null, '{}', 'EXECUTE', $3) id`,
    [ids.agente, ids.casoA, ids.lucas]))
  igual((await um(db, `select requested_by from agent_runs where id = $1`, [r.id])).requested_by, ids.lucas, 'solicitante')
  const ev = await um(db, `select actor_type, actor_user_id from audit_events where action = 'AGENT_RUN_REQUESTED' and entity_id = $1`, [r.id])
  igual([ev.actor_type, ev.actor_user_id], ['USER', ids.lucas], 'ator preservado')
})

await deveFalhar('backend sem informar o usuário não pede execução', () => comoServico((tx) =>
  tx.query(`select public.request_agent_run($1, $2)`, [ids.agente, ids.casoA])),
  /informar quem está agindo/)

await deveFalhar('backend não pede em nome de ASSISTANT', () => comoServico((tx) =>
  tx.query(`select public.request_agent_run($1, $2, null, null, '{}', 'EXECUTE', $3)`, [ids.agente, ids.casoA, ids.ana])),
  /Somente ADMIN ou LAWYER/)

await deveFalhar('ASSISTANT não inicia agente', () => como(ids.ana, (tx) =>
  tx.query(`select public.request_agent_run($1, $2)`, [ids.agente, ids.casoA])),
  /Somente ADMIN ou LAWYER/)

await deveFalhar('PARTNER não inicia agente', () => como(ids.almeidaAdm, (tx) =>
  tx.query(`select public.request_agent_run($1, $2)`, [ids.agente, ids.casoA])),
  /Somente ADMIN ou LAWYER/)

await deveFalhar('LAWYER não pede execução sem caso', () => como(ids.lucas, (tx) =>
  tx.query(`select public.request_agent_run($1)`, [ids.agente])),
  /só de ADMIN/)

await deveFalhar('processo de outro caso é recusado no pedido', () => como(ids.lucas, (tx) =>
  tx.query(`select public.request_agent_run($1, $2, $3)`, [ids.agente, ids.casoI, ids.proc1])),
  /não pertence ao caso/)

await deveFalhar('conteúdo livre não entra em agent_runs.metadata', () =>
  db.query(`update agent_runs set metadata = '{"input":{"pedido":"x"}}' where id = $1`, [ids.run]),
  /agent_runs_metadata_check|check constraint/)

await deve('LAWYER acompanha a execução pela RPC, sem dados técnicos; ASSISTANT, parceiro e anon não', async () => {
  await como(ids.lucas, async (tx) => {
    const r = await linhas(tx, `select * from public.get_agent_run_summaries($1)`, [ids.casoA])
    igual(r.some((x) => x.id === ids.run), true, 'execução visível ao LAWYER')
    for (const k of ['metadata', 'input_tokens', 'estimated_cost', 'model', 'error_message', 'request_text'])
      if (k in r[0]) throw new Error(`RPC expõe ${k}`)
    const todas = await linhas(tx, `select id from public.get_agent_run_summaries()`)
    igual(todas.some((x) => x.id === ids.runAdmin), false, 'execução sem caso não aparece ao LAWYER')
    igual((await linhas(tx, `select request_text from agent_run_inputs where agent_run_id = $1`, [ids.run])).length, 1, 'a própria entrada')
  })
  for (const u of [ids.ana, ids.almeidaAdm, ids.almeidaUsr]) {
    await como(u, (tx) => tx.query(`select * from public.get_agent_run_summaries()`)).then(
      () => { throw new Error('papel sem acesso leu execuções') },
      (e) => { if (!/só a ADMIN e LAWYER/.test(e.message)) throw e })
    await como(u, async (tx) => igual((await linhas(tx, `select 1 from agent_run_inputs`)).length, 0, 'entradas'))
  }
  await db.transaction(async (tx) => {
    await tx.query('set local role anon')
    await tx.query(`select * from public.get_agent_run_summaries()`)
  }).then(() => { throw new Error('anon leu execuções') }, (e) => { if (!/permission denied/.test(e.message)) throw e })
  const view = await um(db, `select to_regclass('public.agent_run_summaries') v`)
  igual(view.v, null, 'a view com privilégio do dono não existe mais')
})

await deve('ADMIN vê todas, inclusive sem caso; filtro por caso que o LAWYER não acessa é recusado', async () => {
  await como(ids.barbara, async (tx) => {
    const r = await linhas(tx, `select id from public.get_agent_run_summaries()`)
    igual([ids.run, ids.runAdmin].every((x) => r.some((y) => y.id === x)), true, 'todas')
  })
  await como(ids.lucas, (tx) => tx.query(`select * from public.get_agent_run_summaries($1)`, [randomUUID()])).then(
    () => { throw new Error('caso inexistente aceito') }, (e) => { if (!/Sem acesso/.test(e.message)) throw e })
})

await deveFalhar('ADMIN só cancela execução (não a conclui)', () => como(ids.barbara, (tx) =>
  tx.query(`update agent_runs set status = 'COMPLETED' where id = $1 returning id`, [ids.runAdmin])
    .then((r) => { if (r.rows.length === 0) throw new Error('bloqueado pela RLS') })),
  /bloqueado pela RLS|row-level security|Transição de execução inválida/)

secao('Worker (dg_worker): fila, reserva e batimento')
const claim = (worker, stale = 300) => comoWorker((tx) =>
  um(tx, `select * from private.claim_agent_run($1, $2, $3, $4)`, [ids.run, worker, ids.msg, stale]))

await deve('dg_worker lê a mensagem: payload só com IDs', () => comoWorker(async (tx) => {
  const msgs = await linhas(tx, `select * from pgmq.read('agent_execution', 60, 10)`)
  const msg = msgs.find((m) => m.message.agent_run_id === ids.run)
  if (!msg) throw new Error('mensagem não encontrada')
  ids.msg = msg.msg_id
  igual(Object.keys(msg.message).sort(), ['agent_run_id', 'correlation_id', 'legal_case_id', 'operation'], 'payload mínimo')
}))

await deve('dois workers reservam a mesma execução: só um ganha', async () => {
  const a = await claim('worker-a')
  const b = await claim('worker-b')
  igual([a.claimed, b.claimed, b.status], [true, false, 'RUNNING'], 'reservas')
  const r = await um(db, `select status, claimed_by, attempt, claimed_at is not null c from agent_runs where id = $1`, [ids.run])
  igual([r.status, r.claimed_by, r.attempt, r.c], ['RUNNING', 'worker-a', 1, true], 'dono da reserva')
})

await deve('batimento do dono estende a invisibilidade; o de outro worker é recusado', async () => {
  const vtAntes = (await um(db, `select vt from pgmq.q_agent_execution where msg_id = $1`, [ids.msg])).vt
  const ok = await comoWorker((tx) => um(tx, `select private.heartbeat_agent_run($1, 'worker-a', $2, 3600) v`, [ids.run, ids.msg]))
  const vtDepois = (await um(db, `select vt from pgmq.q_agent_execution where msg_id = $1`, [ids.msg])).vt
  igual(ok.v, true, 'batimento do dono')
  if (!(new Date(vtDepois) > new Date(vtAntes))) throw new Error('VT não foi estendido')
  const outro = await comoWorker((tx) => um(tx, `select private.heartbeat_agent_run($1, 'worker-b', $2, 3600) v`, [ids.run, ids.msg]))
  igual(outro.v, false, 'batimento de quem não reservou')
})

await deve('reserva com batimento parado (worker morto) é retomada; com batimento vivo, não', async () => {
  igual((await claim('worker-c')).claimed, false, 'batimento recente')
  await db.query(`update agent_runs set heartbeat_at = now() - interval '1 hour' where id = $1`, [ids.run])
  const morto = await claim('worker-c')
  igual([morto.claimed, morto.attempt], [true, 2], 'retomada')
  // Quem perdeu a reserva não grava o resultado final.
  const perdeu = await comoWorker((tx) => um(tx, `select private.worker_finish_run($1, 'worker-a', 'COMPLETED') v`, [ids.run]))
  igual(perdeu.v, false, 'worker-a perdeu a reserva')
  await db.query(`update agent_runs set claimed_by = 'worker-a' where id = $1`, [ids.run])
})

secao('Worker: escopo da execução (caso A não alcança caso B)')
await deve('dg_worker não tem SELECT em nenhuma tabela com dado de cliente', async () => {
  for (const t of ['clients', 'individual_client_details', 'company_client_details', 'client_internal_details',
    'legal_cases', 'legal_case_internal_details', 'legal_processes', 'process_parties', 'process_events', 'deadlines',
    'documents', 'document_versions', 'case_documents', 'case_document_requirements', 'document_version_verifications',
    'agent_runs', 'agent_run_inputs', 'agent_proposals', 'reviews', 'partner_requests',
    'payments', 'payment_receipts', 'audit_events', 'personal_data_access_events', 'profiles',
    'organization_memberships', 'integration_connections', 'import_jobs', 'case_partnership_agreements']) {
    await comoWorker((tx) => tx.query(`select 1 from ${t}`)).then(
      () => { throw new Error(`dg_worker leu ${t}`) },
      (e) => { if (!/permission denied/.test(e.message)) throw e })
  }
})

await deve('contexto da execução vem só da própria execução', () => comoWorker(async (tx) => {
  const c = (await um(tx, `select private.worker_run_context($1, 'worker-a') c`, [ids.run])).c
  igual([c.legal_case_id, c.client_id, c.input.request_text.startsWith('Conferir')], [ids.casoA, ids.joao, true], 'contexto')
}))

await deve('execução do caso A não lê caso, processo, documento nem cliente de outro caso', async () => {
  // Dados do "caso B" (caso F, cliente Carla), preparados fora da transação do worker.
  const outroProc = (await um(db, `insert into legal_processes (legal_case_id, status) values ($1, 'PREPARING') returning id`, [ids.casoF])).id
  const docB = randomUUID(), verB = randomUUID()
  await db.query(`insert into documents (id, client_id, category, title) values ($1, $2, 'OTHER', 'Documento do caso B')`, [docB, ids.carla])
  await db.query(`insert into case_documents (legal_case_id, document_id) values ($1, $2)`, [ids.casoF, docB])
  await db.query(`insert into document_versions (id, document_id, storage_object_name, source) values ($1, $2, $3, 'UPLOAD')`,
    [verB, docB, `clients/${ids.carla}/documents/${docB}/${verB}/b.pdf`])
  await comoWorker(async (tx) => {
    igual((await um(tx, `select private.worker_get_case($1, 'worker-a', $2) c`, [ids.run, ids.casoF])).c, null, 'caso F')
    igual((await um(tx, `select private.worker_get_case($1, 'worker-a', $2) c`, [ids.run, ids.casoI])).c, null, 'caso I (mesmo cliente)')
    igual((await um(tx, `select private.worker_get_process($1, 'worker-a', $2) p`, [ids.run, outroProc])).p, null, 'processo de outro caso')
    igual((await linhas(tx, `select * from private.worker_get_document_version($1, 'worker-a', $2)`, [ids.run, verB])).length, 0, 'documento de outro caso')
    igual((await um(tx, `select private.worker_find_client($1, 'worker-a', 'Carla') c`, [ids.run])).c, [], 'cliente de outro caso')
    igual((await um(tx, `select private.worker_find_client($1, 'worker-a', '55566677788') c`, [ids.run])).c, [], 'CPF de outro cliente')
    const proprio = (await um(tx, `select private.worker_get_case($1, 'worker-a', $2) c`, [ids.run, ids.casoA])).c
    igual(proprio?.id, ids.casoA, 'o próprio caso')
  })
})

await deve('documento do próprio caso é liberado e o acesso fica registrado com ator AGENT', async () => {
  const r = await comoWorker((tx) => linhas(tx, `select * from private.worker_get_document_version($1, 'worker-a', $2)`, [ids.run, ids.v1]))
  igual(r.length, 1, 'versão do caso A')
  const ev = await um(db, `select actor_type, agent_run_id from personal_data_access_events
                           where resource_id = $1 and action = 'DOWNLOAD' order by created_at desc limit 1`, [ids.v1])
  igual([ev?.actor_type, ev?.agent_run_id], ['AGENT', ids.run], 'acesso LGPD do agente')
})

await deveFalhar('worker sem a reserva não lê nem o contexto da execução', () => comoWorker((tx) =>
  tx.query(`select private.worker_get_case($1, 'worker-x', $2)`, [ids.run, ids.casoA])),
  /não está reservada por este worker/)

await deveFalhar('worker não lê contexto de execução que não está rodando', () => comoWorker((tx) =>
  tx.query(`select private.worker_run_context($1, 'worker-a')`, [ids.runAdmin])),
  /não está reservada/)

await deveFalhar('worker não propõe sobre processo de outro caso', async () => {
  const outro = (await um(db, `select id from legal_processes where legal_case_id <> $1 limit 1`, [ids.casoA])).id
  await comoWorker((tx) => tx.query(
    `select private.worker_create_proposal($1, 'worker-a', 'OTHER', '{}', 'prop:dddddddd', 'NORMAL', $2)`, [ids.run, outro]))
}, /não pertence ao caso/)

await deve('worker grava proposta e revisão PENDING; a mesma proposta não entra duas vezes', () => comoWorker(async (tx) => {
  const payload = JSON.stringify({ summary: 'Réplica', data: { title: 'Réplica', due_at: '2026-11-20T23:59:00-03:00' } })
  const a = await um(tx, `select * from private.worker_create_proposal($1, 'worker-a', 'CREATE_DEADLINE', $2, 'prop:aaaaaaaa')`, [ids.run, payload])
  const b = await um(tx, `select * from private.worker_create_proposal($1, 'worker-a', 'CREATE_DEADLINE', $2, 'prop:aaaaaaaa')`, [ids.run, payload])
  igual([a.created, b.created, a.proposal_id === b.proposal_id], [true, false, true], 'idempotência')
  ids.proposta = a.proposal_id
  igual((await um(tx, `select private.worker_finish_run($1, 'worker-a', 'WAITING_HUMAN', null, null, 'claude-opus-5-5', 1200, 300, 0.012, '{"proposals":1}') v`, [ids.run])).v, true, 'fim')
  await tx.query(`select pgmq.archive('agent_execution', $1::bigint)`, [ids.msg])
}))

await deve('uma proposta só, com uma revisão pendente', async () => {
  igual((await um(db, `select count(*)::int n from agent_proposals where agent_run_id = $1`, [ids.run])).n, 1, 'propostas')
  ids.revProposta = (await um(db, `select id from reviews where agent_proposal_id = $1 and status = 'PENDING'`, [ids.proposta])).id
})


await deveFalhar('não existe mais proposta CREATE_DOCUMENT (minuta vai como versão de documento)', () =>
  db.query(`insert into agent_proposals (agent_run_id, legal_case_id, proposal_type, payload, idempotency_key)
            values ($1, $2, 'CREATE_DOCUMENT', '{}', 'prop:bbbbbbbb')`, [ids.run, ids.casoA]),
  /proposal_type_check/)

await deveFalhar('IA não se aprova sozinha: proposta exige revisão humana (mesmo pelo dono do banco)', () =>
  db.query(`update agent_proposals set status = 'APPROVED' where id = $1`, [ids.proposta]),
  /revisão humana aprovada/)

await deveFalhar('worker não muda status de revisão', () => comoWorker((tx) =>
  tx.query(`update reviews set status = 'APPROVED' where id = $1`, [ids.revProposta])),
  /permission denied/)

await deveFalhar('worker não registra decisão humana', () => comoWorker((tx) =>
  tx.query(`insert into review_decisions (review_id, decision, decided_by) values ($1, 'APPROVE', $2)`, [ids.revProposta, ids.lucas])),
  /permission denied/)

await deveFalhar('worker não chama a operação de decisão', () => comoWorker((tx) =>
  tx.query(`select public.decide_review($1, 'APPROVE', null, $2)`, [ids.revProposta, ids.lucas])),
  /permission denied/)

await deveFalhar('worker não chama o bloco interno do aplicador direto', () => comoWorker((tx) =>
  tx.query(`select * from private.apply_proposal_effect('OTHER', '{}', null, null)`)),
  /permission denied/)

await deve('dg_worker não é superuser nem ignora RLS', async () => {
  const r = await um(db, `select rolsuper, rolbypassrls, rolinherit from pg_roles where rolname = 'dg_worker'`)
  igual([r.rolsuper, r.rolbypassrls, r.rolinherit], [false, false, false], 'atributos do papel')
})

await deveFalhar('não se enfileira execução que já saiu de QUEUED', () => comoServico((tx) =>
  tx.query(`select private.enqueue_agent_run($1)`, [ids.run])),
  /não está QUEUED/)

await deveFalhar('usuário logado não acessa a fila', () => como(ids.barbara, (tx) =>
  tx.query(`select * from pgmq.send('agent_execution', '{}'::jsonb)`)),
  /permission denied/)

await deveFalhar('usuário logado não chama o enfileirador', () => como(ids.barbara, (tx) =>
  tx.query(`select private.enqueue_agent_run($1)`, [ids.run])),
  /permission denied/)

await deveFalhar('worker não envia mensagem para a fila', () => comoWorker((tx) =>
  tx.query(`select * from pgmq.send('agent_execution', '{}'::jsonb)`)),
  /permission denied/)

await deve('humano decide → proposta APPROVED na mesma transação → worker aplica no banco (actor AGENT)', async () => {
  await decidir(ids.lucas, ids.revProposta, 'APPROVE')
  igual((await um(db, `select status from agent_proposals where id = $1`, [ids.proposta])).status, 'APPROVED', 'proposta aprovada pela decisão')
  const r = await comoWorker((tx) => linhas(tx, `select * from private.worker_apply_next_proposal('worker-a')`))
  igual(r.map((x) => [x.proposal_id, x.status]), [[ids.proposta, 'APPLIED']], 'aplicada')
  const p = await um(db, `select status, applied_entity_type, applied_entity_id from agent_proposals where id = $1`, [ids.proposta])
  igual([p.status, p.applied_entity_type], ['APPLIED', 'deadlines'], 'proposta aplicada')
  const ev = await um(db, `select actor_type, agent_run_id from audit_events where action = 'DEADLINE_CREATED' and entity_id = $1`, [p.applied_entity_id])
  igual([ev.actor_type, ev.agent_run_id], ['AGENT', ids.run], 'ator do efeito')
  igual((await um(db, `select status from agent_runs where id = $1`, [ids.run])).status, 'COMPLETED', 'execução encerrada')
  const de_novo = await comoWorker((tx) => linhas(tx, `select * from private.worker_apply_next_proposal('worker-a')`))
  igual(de_novo.length, 0, 'nada a reaplicar')
  igual((await um(db, `select count(*)::int n from deadlines where id = $1`, [p.applied_entity_id])).n, 1, 'efeito único')
})

await deveFalhar('proposta aplicada não volta a ser aprovada (sem efeito duplicado)', () =>
  db.query(`update agent_proposals set status = 'APPROVED' where id = $1`, [ids.proposta]),
  /Transição de proposta inválida/)

await deveFalhar('integração não guarda chave de API', () =>
  db.query(`insert into integration_connections (organization_id, provider, type, credentials_reference)
            values ($1, 'anthropic', 'AI_PROVIDER', 'sk-ant-api03-xxxxxxxx')`, [ids.owner]),
  /credentials_reference/)

// ═════════════════════════════ auditoria ═════════════════════════════════

secao('Auditoria')
await deve('aceite do caso gerou CASE_ACCEPTED com autor e organização', async () => {
  const e = await um(db, `select actor_user_id, actor_organization_id from audit_events
                          where action = 'CASE_ACCEPTED' and entity_id = $1`, [ids.casoA])
  igual([e?.actor_user_id, e?.actor_organization_id], [ids.lucas, ids.owner], 'autor')
})

await deve('eventos não carregam CPF', async () => {
  const r = await um(db, `select count(*)::int n from audit_events where metadata::text like '%12345678901%'`)
  igual(r.n, 0, 'eventos com CPF')
})

await deveFalhar('AuditEvents não podem ser alterados por usuários', () => como(ids.barbara, (tx) =>
  tx.query(`update audit_events set action = 'NADA'`)),
  /permission denied/)

await deveFalhar('nem pela service role', () => comoServico((tx) =>
  tx.query(`update audit_events set action = 'NADA'`)),
  /permission denied/)

await deveFalhar('nem pelo dono do banco sem a chave administrativa', () =>
  db.query(`delete from audit_events`),
  /append-only/)

await deveFalhar('usuário não insere evento de auditoria forjado', () => como(ids.barbara, (tx) =>
  tx.query(`insert into audit_events (action, entity_type) values ('FAKE', 'x')`)),
  /permission denied/)

await deve('ADMIN lê a auditoria; LAWYER e parceiro não', async () => {
  await como(ids.barbara, async (tx) => {
    if ((await linhas(tx, `select 1 from audit_events`)).length === 0) throw new Error('ADMIN não vê auditoria')
  })
  for (const u of [ids.lucas, ids.almeidaAdm])
    await como(u, async (tx) => igual((await linhas(tx, `select 1 from audit_events`)).length, 0, 'eventos'))
})

// ═════════════════════════════ exclusão e acesso anônimo ═════════════════

secao('Exclusão e acesso anônimo')
await deveFalhar('exclusão de Client não apaga Processes em cascata', () =>
  db.query(`delete from clients where id = $1`, [ids.joao]),
  /foreign key|violates/)

await deve('processos de João continuam lá', async () => {
  const r = await um(db, `select count(*)::int n from legal_processes p join legal_cases c on c.id = p.legal_case_id where c.client_id = $1`, [ids.joao])
  if (r.n < 2) throw new Error(`restaram ${r.n}`)
})

await deveFalhar('usuário logado não apaga fisicamente', () => como(ids.barbara, (tx) =>
  tx.query(`delete from legal_cases where id = $1`, [ids.casoI])),
  /permission denied/)

await deve('cliente excluído (soft delete) some para o parceiro', async () => {
  await como(ids.barbara, (tx) => tx.query(`update clients set deleted_at = now() where id = $1`, [ids.joao]))
  await como(ids.almeidaUsr, async (tx) => igual((await linhas(tx, `select 1 from clients`)).length, 0, 'clientes'))
  await db.query(`update clients set deleted_at = null where id = $1`, [ids.joao])
})

await deveFalhar('anon não lê nada', () => db.transaction(async (tx) => {
  await tx.query('set local role anon')
  await tx.query('select * from clients')
}), /permission denied/)

await deve('sem sessão, authenticated não vê nenhuma linha', () => db.transaction(async (tx) => {
  await tx.query('set local role authenticated')
  for (const t of ['clients', 'legal_cases', 'documents', 'organizations'])
    igual((await linhas(tx, `select 1 from ${t}`)).length, 0, t)
}))

await deve('parceiro suspenso perde o acesso inteiro', async () => {
  await db.query(`update organizations set status = 'SUSPENDED' where id = $1`, [ids.almeida])
  await como(ids.almeidaAdm, async (tx) => {
    for (const t of ['clients', 'legal_cases', 'documents', 'case_partnership_agreements'])
      igual((await linhas(tx, `select 1 from ${t}`)).length, 0, t)
  })
  await db.query(`update organizations set status = 'ACTIVE' where id = $1`, [ids.almeida])
})

await deve('usuário não reativa o próprio perfil', async () => {
  await db.query(`update profiles set active = false where id = $1`, [ids.ana])
  await como(ids.ana, async (tx) => {
    await tx.query(`update profiles set full_name = 'Ana Paula' where id = $1`, [ids.ana])
    try {
      await tx.query(`savepoint s`)
      await tx.query(`update profiles set active = true where id = $1`, [ids.ana])
      throw new Error('active foi alterado pelo próprio usuário')
    } catch (e) {
      if (!/permission denied/.test(e.message)) throw e
      await tx.query(`rollback to savepoint s`)
    }
  })
  await db.query(`update profiles set active = true where id = $1`, [ids.ana])
})

secao('Storage')
await deve('buckets de documentos são privados', async () => {
  const r = await linhas(db, `select id, public from storage.buckets order by id`)
  igual(r.map((x) => [x.id, x.public]), [['imports', false], ['legal-documents', false], ['reference-materials', false]], 'buckets')
})
await deveFalhar('navegador não grava direto no bucket', () => como(ids.barbara, (tx) =>
  tx.query(`insert into storage.objects (bucket_id, name) values ('legal-documents', 'clients/x/y.pdf')`)),
  /row-level security/)

// ═════════════════════════════ gate humano ═══════════════════════════════

secao('Gate humano: status de revisão só muda por decisão')
await deve('prepara uma revisão pendente da v2', () => como(ids.lucas, async (tx) => {
  ids.revV2 = (await um(tx, `insert into reviews (legal_case_id, document_version_id) values ($1, $2) returning id`, [ids.casoA, ids.v2])).id
}))

await deveFalhar('LAWYER não faz UPDATE reviews SET status = APPROVED', () => como(ids.lucas, (tx) =>
  tx.query(`update reviews set status = 'APPROVED', decided_at = now() where id = $1`, [ids.revV2])),
  /permission denied/)

await deveFalhar('LAWYER não cria revisão já APPROVED', () => como(ids.lucas, (tx) =>
  tx.query(`insert into reviews (legal_case_id, document_version_id, status) values ($1, $2, 'APPROVED')`, [ids.casoA, ids.v2])),
  /permission denied/)

await deveFalhar('LAWYER não insere decisão direto (só por decide_review)', () => como(ids.lucas, (tx) =>
  tx.query(`insert into review_decisions (review_id, decision, decided_by) values ($1, 'APPROVE', $2)`, [ids.revV2, ids.lucas])),
  /permission denied/)

await deveFalhar('nem a service role muda o status por UPDATE', () => comoServico((tx) =>
  tx.query(`update reviews set status = 'APPROVED' where id = $1`, [ids.revV2])),
  /só muda por decisão/)

await deveFalhar('nem a service role cria revisão já decidida', () => comoServico((tx) =>
  tx.query(`insert into reviews (legal_case_id, document_version_id, status) values ($1, $2, 'APPROVED')`, [ids.casoA, ids.v2])),
  /nasce PENDING/)

await deveFalhar('ASSISTANT não decide', () => decidir(ids.ana, ids.revV2, 'APPROVE'), /Só ADMIN ou LAWYER/)
await deveFalhar('parceiro não decide', () => decidir(ids.almeidaAdm, ids.revV2, 'APPROVE'), /Só ADMIN ou LAWYER/)
await deveFalhar('rejeitar exige motivo', () => decidir(ids.lucas, ids.revV2, 'REJECT'), /reason_required/)

await deve('decisão válida: cria ReviewDecision + muda a Review + audita com o autor', async () => {
  await decidir(ids.lucas, ids.revV2, 'APPROVE')
  const d = await linhas(db, `select decided_by from review_decisions where review_id = $1`, [ids.revV2])
  igual(d.map((x) => x.decided_by), [ids.lucas], 'decisão registrada')
  const r = await um(db, `select status, decided_at is not null decidida from reviews where id = $1`, [ids.revV2])
  igual([r.status, r.decidida], ['APPROVED', true], 'revisão')
  const ev = await um(db, `select actor_type, actor_user_id from audit_events where action = 'REVIEW_APPROVED' and entity_id = $1`, [ids.revV2])
  igual([ev?.actor_type, ev?.actor_user_id], ['USER', ids.lucas], 'auditoria')
})

await deve('backend decide em nome do LAWYER: o banco revalida o papel e preserva o ator', async () => {
  const rev = (await um(db, `insert into reviews (legal_case_id, document_version_id) values ($1, $2) returning id`, [ids.casoA, ids.vInterno])).id
  await comoServico((tx) => tx.query(`select public.decide_review($1, 'REQUEST_CHANGES', 'Ajustar fundamentação', $2)`, [rev, ids.lucas]))
  const ev = await um(db, `select actor_type, actor_user_id from audit_events where action = 'REVIEW_CHANGES_REQUESTED' and entity_id = $1`, [rev])
  igual([ev?.actor_type, ev?.actor_user_id], ['USER', ids.lucas], 'ator preservado')
  await comoServico((tx) => tx.query(`select public.decide_review($1, 'REOPEN', null, $2)`, [rev, ids.ana])).then(
    () => { throw new Error('ASSISTANT decidiu pelo backend') },
    (e) => { if (!/Só ADMIN ou LAWYER/.test(e.message)) throw e })
})

secao('Proposta estrutural (agente/skill): só ADMIN decide')
await deve('prepara proposta UPDATE_AGENT', async () => {
  const run = (await um(db, `insert into agent_runs (agent_id, agent_version_id, requested_by) values ($1, $2, $3) returning id`,
    [ids.agente, ids.agenteV, ids.barbara])).id
  ids.propEstrutural = (await um(db, `insert into agent_proposals (agent_run_id, proposal_type, payload, idempotency_key)
    values ($1, 'UPDATE_AGENT', '{"summary":"x","data":{}}', 'prop:estrutural1') returning id`, [run])).id
  ids.revEstrutural = (await um(db, `insert into reviews (agent_proposal_id) values ($1) returning id`, [ids.propEstrutural])).id
})

await deveFalhar('LAWYER não aprova UPDATE_AGENT', () => decidir(ids.lucas, ids.revEstrutural, 'APPROVE'),
  /Somente ADMIN decide proposta UPDATE_AGENT/)

await deve('ADMIN aprova UPDATE_AGENT', async () => {
  await decidir(ids.barbara, ids.revEstrutural, 'APPROVE')
  igual((await um(db, `select status from agent_proposals where id = $1`, [ids.propEstrutural])).status, 'APPROVED', 'proposta')
})

await deve('regra estrutural cobre tipos futuros (tese, referência, ADMIN_*) e não os jurídicos', async () => {
  const r = await um(db, `select private.proposal_requires_admin('UPDATE_SKILL') s, private.proposal_requires_admin('UPDATE_THESIS') t,
                                 private.proposal_requires_admin('UPDATE_REFERENCE') r, private.proposal_requires_admin('ADMIN_ANY') a,
                                 private.proposal_requires_admin('CREATE_DEADLINE') d, private.proposal_requires_admin('UPDATE_CASE') c`)
  igual([r.s, r.t, r.r, r.a, r.d, r.c], [true, true, true, true, false, false], 'tipos estruturais')
})

await deveFalhar('revisão de proposta de agente não se reabre', () => decidir(ids.barbara, ids.revEstrutural, 'REOPEN', 'x'),
  /não se reabre/)

// ═════════════════════════════ máquina de estados ════════════════════════

secao('Máquina de estados do caso')
await deve('fluxo válido: DRAFT → SUBMITTED → ACCEPTED → IN_PROGRESS → CLOSED', () => como(ids.lucas, async (tx) => {
  ids.casoSM = (await um(tx, `insert into legal_cases (client_id, legal_area_id, title, origin_organization_id)
    values ($1, $2, 'Caso da máquina de estados', $3) returning id`, [ids.joao, ids.banking, ids.owner])).id
  for (const st of ['SUBMITTED', 'ACCEPTED', 'IN_PROGRESS', 'CLOSED'])
    await tx.query(`update legal_cases set status = $2, assigned_lawyer_id = $3 where id = $1`, [ids.casoSM, st, ids.lucas])
  const c = await um(tx, `select submitted_at is not null s, accepted_at is not null a, closed_at is not null c from legal_cases where id = $1`, [ids.casoSM])
  igual([c.s, c.a, c.c], [true, true, true], 'datas preenchidas')
  const i = await um(tx, `select accepted_by from legal_case_internal_details where legal_case_id = $1`, [ids.casoSM])
  igual(i?.accepted_by, ids.lucas, 'quem aceitou (dado interno)')
}))

await deveFalhar('CLOSED → DRAFT é bloqueado', () => como(ids.lucas, (tx) =>
  tx.query(`update legal_cases set status = 'DRAFT' where id = $1`, [ids.casoSM])), /Transição de caso inválida: CLOSED → DRAFT/)
await deveFalhar('CLOSED → IN_PROGRESS direto é bloqueado', () => como(ids.barbara, (tx) =>
  tx.query(`update legal_cases set status = 'IN_PROGRESS' where id = $1`, [ids.casoSM])), /Transição de caso inválida/)
await deveFalhar('ACCEPTED → SUBMITTED é bloqueado', () =>
  db.query(`update legal_cases set status = 'SUBMITTED' where id = $1`, [ids.casoA]), /Transição de caso inválida/)
await deveFalhar('nem o backend pula a máquina de estados (DRAFT → CLOSED)', () =>
  db.query(`update legal_cases set status = 'CLOSED' where id = $1`, [ids.casoI]), /Transição de caso inválida/)
await deveFalhar('caso não nasce CLOSED pelas mãos de um usuário', () => como(ids.lucas, (tx) =>
  tx.query(`insert into legal_cases (client_id, legal_area_id, title, origin_organization_id, status)
            values ($1, $2, 'x', $3, 'CLOSED')`, [ids.joao, ids.banking, ids.owner])), /não pode nascer/)

await deveFalhar('LAWYER não aplica exceção de status', () => como(ids.lucas, (tx) =>
  tx.query(`select public.override_case_status($1, 'IN_PROGRESS', 'Cliente voltou')`, [ids.casoSM])), /Somente ADMIN/)
await deveFalhar('exceção de ADMIN exige motivo', () => como(ids.barbara, (tx) =>
  tx.query(`select public.override_case_status($1, 'IN_PROGRESS', '')`, [ids.casoSM])), /exige motivo/)
await deve('ADMIN reabre caso encerrado (exceção explícita, auditada)', async () => {
  await como(ids.barbara, (tx) => tx.query(`select public.override_case_status($1, 'IN_PROGRESS', 'Sentença anulada em recurso')`, [ids.casoSM]))
  const c = await um(db, `select status, closed_at from legal_cases where id = $1`, [ids.casoSM])
  igual([c.status, c.closed_at], ['IN_PROGRESS', null], 'reaberto')
  const ev = await um(db, `select actor_user_id, metadata from audit_events where action = 'CASE_STATUS_OVERRIDDEN' and entity_id = $1`, [ids.casoSM])
  igual([ev?.actor_user_id, ev?.metadata?.reason], [ids.barbara, 'Sentença anulada em recurso'], 'auditoria')
})
await deveFalhar('nem ADMIN tem exceção CLOSED → DRAFT', async () => {
  await db.query(`update legal_cases set status = 'CLOSED' where id = $1`, [ids.casoSM])
  await como(ids.barbara, (tx) => tx.query(`select public.override_case_status($1, 'DRAFT', 'quero')`, [ids.casoSM]))
}, /não prevista/)
await deve('CLOSED → ARCHIVED; ARCHIVED é terminal', async () => {
  await db.query(`update legal_cases set status = 'ARCHIVED' where id = $1`, [ids.casoSM])
  await db.query(`update legal_cases set status = 'CLOSED' where id = $1`, [ids.casoSM]).then(
    () => { throw new Error('saiu de ARCHIVED') },
    (e) => { if (!/inválida/.test(e.message)) throw e })
})
await deve('ADMIN reconsidera rejeição (REJECTED → SUBMITTED) e o motivo público sai', async () => {
  await como(ids.barbara, (tx) => tx.query(`select public.override_case_status($1, 'SUBMITTED', 'Documentos novos')`, [ids.casoF]))
  const c = await um(db, `select status, rejection_reason_public from legal_cases where id = $1`, [ids.casoF])
  igual([c.status, c.rejection_reason_public], ['SUBMITTED', null], 'reconsiderado')
})
await deveFalhar('LAWYER não exclui caso (soft delete é de ADMIN)', () => como(ids.lucas, (tx) =>
  tx.query(`update legal_cases set deleted_at = now() where id = $1`, [ids.casoI])), /Somente ADMIN/)
await deveFalhar('LAWYER não exclui cliente', () => como(ids.lucas, (tx) =>
  tx.query(`update clients set deleted_at = now() where id = $1`, [ids.empresa])), /Somente ADMIN/)

// ═════════════════════════════ verificação de documento ══════════════════

secao('Verificação de arquivo (por versão, append-only)')
const verif = async (v) => (await um(db, `select verification_status s from document_version_verification_status where document_version_id = $1`, [v])).s
await deve('v1 sem registro é UNVERIFIED; VERIFIED vale só para a v1; v2 nasce UNVERIFIED; FAILED na v2', async () => {
  await como(ids.lucas, async (tx) => {
    ids.docVer = randomUUID()
    await tx.query(`insert into documents (id, client_id, category, title) values ($1, $2, 'BANK_STATEMENT', 'Extrato')`, [ids.docVer, ids.joao])
    await tx.query(`insert into case_documents (legal_case_id, document_id) values ($1, $2)`, [ids.casoA, ids.docVer])
    ids.ver1 = await novaVersao(tx, ids.docVer, 'extrato-v1.pdf')
  })
  igual(await verif(ids.ver1), 'UNVERIFIED', 'v1 sem registro')
  await como(ids.lucas, (tx) => tx.query(`insert into document_version_verifications (document_version_id, status, verification_source)
                                            values ($1, 'VERIFIED', 'MANUAL')`, [ids.ver1]))
  igual(await verif(ids.ver1), 'VERIFIED', 'v1 verificada')
  await como(ids.lucas, async (tx) => { ids.ver2 = await novaVersao(tx, ids.docVer, 'extrato-v2.pdf') })
  igual(await verif(ids.ver2), 'UNVERIFIED', 'v2 não herda')
  await como(ids.ana, (tx) => tx.query(`insert into document_version_verifications (document_version_id, status, verification_source, notes)
                                         values ($1, 'FAILED', 'MANUAL', 'Ilegível')`, [ids.ver2]))
  igual([await verif(ids.ver2), await verif(ids.ver1)], ['FAILED', 'VERIFIED'], 'v2 FAILED, v1 continua VERIFIED')
  const ev = await um(db, `select actor_user_id from audit_events where action = 'DOCUMENT_VERIFICATION_FAILED' and entity_id = $1`, [ids.ver2])
  igual(ev?.actor_user_id, ids.ana, 'auditoria da verificação')
})
await deveFalhar('verificação não se edita', () =>
  db.query(`update document_version_verifications set status = 'VERIFIED' where document_version_id = $1`, [ids.ver2]), /append-only/)
await deveFalhar('verificação só em nome próprio', () => como(ids.lucas, (tx) =>
  tx.query(`insert into document_version_verifications (document_version_id, status, verification_source, verified_by)
            values ($1, 'VERIFIED', 'MANUAL', $2)`, [ids.ver2, ids.ana])), /próprio usuário/)
await deveFalhar('parceiro não registra verificação', () => como(ids.almeidaAdm, (tx) =>
  tx.query(`insert into document_version_verifications (document_version_id, status, verification_source)
            values ($1, 'VERIFIED', 'MANUAL')`, [ids.v1])), /row-level security/)

secao('Pendência satisfeita por versão concreta')
await deve('prepara pendência do caso A e um documento da Carla (outro cliente)', async () => {
  ids.pend = (await um(db, `insert into case_document_requirements (legal_case_id, requirement_label, category)
    values ($1, 'Extrato bancário', 'BANK_STATEMENT') returning id`, [ids.casoA])).id
  ids.docCarla = randomUUID()
  await db.query(`insert into documents (id, client_id, category, title) values ($1, $2, 'BANK_STATEMENT', 'Extrato da Carla')`, [ids.docCarla, ids.carla])
  await db.query(`insert into case_documents (legal_case_id, document_id) values ($1, $2)`, [ids.casoF, ids.docCarla])
  ids.verCarla = randomUUID()
  await db.query(`insert into document_versions (id, document_id, storage_object_name, source) values ($1, $2, $3, 'UPLOAD')`,
    [ids.verCarla, ids.docCarla, `clients/${ids.carla}/documents/${ids.docCarla}/${ids.verCarla}/extrato.pdf`])
})
await deveFalhar('versão de outro cliente não satisfaz a pendência', () =>
  db.query(`update case_document_requirements set status = 'RECEIVED', satisfied_by_document_version_id = $2 where id = $1`, [ids.pend, ids.verCarla]),
  /mesmo cliente/)
await deveFalhar('versão do mesmo cliente, mas de documento fora do caso, não satisfaz', async () => {
  const d = randomUUID(), v = randomUUID()
  await db.query(`insert into documents (id, client_id, category, title) values ($1, $2, 'BANK_STATEMENT', 'Solto')`, [d, ids.joao])
  await db.query(`insert into document_versions (id, document_id, storage_object_name, source) values ($1, $2, $3, 'UPLOAD')`,
    [v, d, `clients/${ids.joao}/documents/${d}/${v}/solto.pdf`])
  await db.query(`update case_document_requirements set status = 'RECEIVED', satisfied_by_document_version_id = $2 where id = $1`, [ids.pend, v])
}, /vinculado a este caso/)
await deveFalhar('RECEIVED sem versão é inconsistente', () =>
  db.query(`update case_document_requirements set status = 'RECEIVED' where id = $1`, [ids.pend]), /satisfied_has_version/)
await deve('versão correta do mesmo cliente e caso satisfaz', async () => {
  await como(ids.ana, (tx) => tx.query(`update case_document_requirements set status = 'RECEIVED', satisfied_by_document_version_id = $2
                                         where id = $1`, [ids.pend, ids.ver1]))
  const r = await um(db, `select status, satisfied_at is not null s from case_document_requirements where id = $1`, [ids.pend])
  igual([r.status, r.s], ['RECEIVED', true], 'pendência satisfeita')
})

// ═════════════════════════════ ator e PII na auditoria ═══════════════════

secao('Auditoria: ator e ausência de PII')
await deve('operação sem usuário nem agente é SYSTEM; usuário é USER; worker é AGENT', async () => {
  const c = (await um(db, `insert into clients (kind, cpf, origin_organization_id) values ('INDIVIDUAL', '11122233344', $1) returning id`, [ids.owner])).id
  const ev = await um(db, `select actor_type, actor_user_id from audit_events where action = 'CLIENT_CREATED' and entity_id = $1`, [c])
  igual([ev.actor_type, ev.actor_user_id], ['SYSTEM', null], 'sistema')
  const tipos = await linhas(db, `select distinct actor_type from audit_events order by 1`)
  igual(tipos.map((x) => x.actor_type), ['AGENT', 'SYSTEM', 'USER'], 'os três tipos de ator aparecem')
})
await deveFalhar('usuário logado não se passa por outro na auditoria', () => como(ids.lucas, (tx) =>
  tx.query(`select set_config('dg.actor_user_id', $1, true)`, [ids.barbara]).then(() =>
    tx.query(`select public.change_case_origin($1, $2, 'x', $3)`, [ids.casoI, ids.almeida, ids.barbara]))),
  /próprio usuário/)
await deve('nenhum evento carrega CPF, texto de pedido ao agente ou conteúdo', async () => {
  for (const termo of ['12345678901', '11122233344', 'Conferir o HISCON', 'Analise o extrato', 'Ilegível'])
    igual((await um(db, `select count(*)::int n from audit_events where metadata::text like $1`, [`%${termo}%`])).n, 0, termo)
})

secao('Acesso a dado pessoal (LGPD)')
await deve('LAWYER abre a ficha: um evento só, mesmo abrindo de novo em seguida; download sempre registra', async () => {
  const a = await como(ids.lucas, (tx) => um(tx, `select public.record_personal_data_access($1, 'CLIENT', $1, 'VIEW_DETAIL', 'Atendimento') id`, [ids.joao]))
  const b = await como(ids.lucas, (tx) => um(tx, `select public.record_personal_data_access($1, 'CLIENT', $1, 'VIEW_DETAIL') id`, [ids.joao]))
  igual(a.id, b.id, 'abertura repetida deduplicada')
  await como(ids.lucas, (tx) => tx.query(`select public.record_personal_data_access($1, 'DOCUMENT_VERSION', $2, 'DOWNLOAD')`, [ids.joao, ids.ver1]))
  await como(ids.lucas, (tx) => tx.query(`select public.record_personal_data_access($1, 'DOCUMENT_VERSION', $2, 'DOWNLOAD')`, [ids.joao, ids.ver1]))
  const n = await um(db, `select count(*) filter (where action = 'VIEW_DETAIL')::int v, count(*) filter (where action = 'DOWNLOAD')::int d
                          from personal_data_access_events where client_id = $1 and actor_user_id = $2`, [ids.joao, ids.lucas])
  igual([n.v, n.d], [1, 2], 'eventos')
})
await deveFalhar('parceiro não registra acesso a titular que não acessa', () => como(ids.almeidaUsr, (tx) =>
  tx.query(`select public.record_personal_data_access($1, 'CLIENT', $1, 'VIEW_DETAIL')`, [ids.carla])), /Sem acesso/)
await deve('só ADMIN lê os acessos; ninguém altera', async () => {
  await como(ids.barbara, async (tx) => { if ((await linhas(tx, `select 1 from personal_data_access_events`)).length === 0) throw new Error('ADMIN não vê') })
  for (const u of [ids.lucas, ids.ana, ids.almeidaAdm])
    await como(u, async (tx) => igual((await linhas(tx, `select 1 from personal_data_access_events`)).length, 0, 'eventos'))
  await db.query(`update personal_data_access_events set purpose = 'x'`).then(
    () => { throw new Error('evento alterado') }, (e) => { if (!/append-only/.test(e.message)) throw e })
})

// ═════════════════════════════ RLS das estruturas novas ══════════════════

secao('RLS: dados internos, papéis e isolamento entre parceiros')
await deve('notas internas do cliente e do processo nunca chegam ao parceiro', async () => {
  await como(ids.lucas, async (tx) => {
    await tx.query(`insert into client_internal_details (client_id, notes, legal_summary) values ($1, 'Cliente desconfiado', 'Fraude provável')`, [ids.joao])
    await tx.query(`insert into legal_process_internal_details (legal_process_id, notes) values ($1, 'Juiz rigoroso')`, [ids.proc1])
  })
  for (const u of [ids.almeidaAdm, ids.almeidaUsr])
    await como(u, async (tx) => {
      igual((await linhas(tx, `select 1 from client_internal_details`)).length, 0, 'dados internos do cliente')
      igual((await linhas(tx, `select 1 from legal_process_internal_details`)).length, 0, 'dados internos do processo')
      const cols = Object.keys((await um(tx, `select * from clients where id = $1`, [ids.joao])) ?? {})
      if (cols.some((k) => ['notes', 'legal_summary', 'inactivation_reason'].includes(k))) throw new Error('clients expõe dado interno')
    })
})
await deve('ASSISTANT não ganha execuções, revisões, financeiro, DG Brasil nem administração', () => como(ids.ana, async (tx) => {
  for (const t of ['agent_runs', 'agent_proposals', 'reviews', 'review_decisions', 'payments',
    'payment_receipts', 'agents', 'skills', 'audit_events', 'personal_data_access_events', 'import_jobs', 'user_invitations'])
    igual((await linhas(tx, `select 1 from ${t}`)).length, 0, t)
}))
await deve('PARTNER_USER sem financeiro, revisões, execuções, DG Brasil e auditoria', () => como(ids.almeidaUsr, async (tx) => {
  for (const t of ['reviews', 'agent_proposals', 'agents', 'legal_theses', 'audit_events',
    'payment_receipts', 'partner_revenue_allocations', 'document_version_verification_status'])
    if (t === 'document_version_verification_status') continue
    else igual((await linhas(tx, `select 1 from ${t}`)).length, 0, t)
}))
await deve('Parceiro A nunca acessa dados do Parceiro B', async () => {
  await como(ids.ferreiraAdm, async (tx) => {
    igual((await linhas(tx, `select 1 from document_version_verifications`)).length, 0, 'verificações da Almeida')
    igual((await linhas(tx, `select 1 from legal_cases where partner_organization_id = $1`, [ids.almeida])).length, 0, 'casos da Almeida')
    igual((await linhas(tx, `select 1 from case_partnership_agreements where partner_organization_id = $1`, [ids.almeida])).length, 0, 'acordos')
  })
  await como(ids.almeidaAdm, async (tx) => {
    igual((await linhas(tx, `select 1 from legal_cases where partner_organization_id = $1`, [ids.ferreira])).length, 0, 'casos da Ferreira')
    igual((await linhas(tx, `select 1 from clients where id = $1`, [ids.carla])).length, 0, 'cliente da Ferreira')
    igual((await linhas(tx, `select 1 from documents where id = $1`, [ids.docCarla])).length, 0, 'documento da Ferreira')
  })
})
await deve('Partner vê o caso que criou com origem Bárbara, sem parceria financeira', async () => {
  await como(ids.almeidaUsr, async (tx) => igual((await linhas(tx, `select 1 from legal_cases where id = $1`, [ids.casoB])).length, 1, 'caso B'))
})

secao('Cliente: campos persistentes')
await deveFalhar('CNAE secundário inválido é rejeitado', () =>
  db.query(`insert into company_client_details (client_id, legal_name, secondary_cnaes) values ($1, 'Empresa', '{6201501,12}')`, [ids.empresa]),
  /secondary_cnaes|check constraint/)
await deve('PJ com sócios e CNAEs secundários', async () => {
  await db.query(`insert into company_client_details (client_id, legal_name, secondary_cnaes) values ($1, 'Empresa LTDA', '{6201501,6202300}')`, [ids.empresa])
  await db.query(`insert into company_shareholders (client_id, name, document_number, share_percentage) values ($1, 'Sócia', '52998224725', 60)`, [ids.empresa])
})
await deveFalhar('documento de identidade precisa de tipo e número juntos', () =>
  db.query(`update individual_client_details set identity_document_type = 'CNH' where client_id = $1`, [ids.joao]),
  /identity_complete/)
await deveFalhar('responsável pelo cliente precisa ser usuário interno', () =>
  db.query(`update clients set responsible_user_id = $2 where id = $1`, [ids.joao, ids.almeidaAdm]), /usuário interno ativo/)

// ═════════════════════════════ importação genérica ═══════════════════════

secao('Importação CSV/XLSX (genérica)')
await deveFalhar('JSON não é formato de importação na V1', () => como(ids.barbara, (tx) =>
  tx.query(`insert into import_jobs (organization_id, file_name, file_type) values ($1, 'x.json', 'JSON')`, [ids.owner])),
  /file_type_check/)
await deve('fluxo: upload → colunas → mapeamento → dry-run (backend) com conflito', () => como(ids.barbara, async (tx) => {
  ids.imp = (await um(tx, `insert into import_jobs (organization_id, file_name, file_type) values ($1, 'clientes.xlsx', 'XLSX') returning id`, [ids.owner])).id
  await tx.query(`update import_jobs set status = 'COLUMNS_DETECTED', detected_columns = '["Nome","CPF"]' where id = $1`, [ids.imp])
  await tx.query(`insert into import_column_mappings (import_job_id, source_column, target_field) values ($1, 'Nome', 'client.name'), ($1, 'CPF', 'client.document')`, [ids.imp])
  await tx.query(`update import_jobs set status = 'MAPPED' where id = $1`, [ids.imp])
}).then(() => comoServico(async (tx) => {
  // Dry-run é do backend: grava o resultado por linha e os conflitos.
  await tx.query(`insert into import_row_results (import_job_id, row_number, status, action, raw_data) values ($1, 1, 'WARNING', 'UPDATE', '{"Nome":"João","CPF":"12345678901"}')`, [ids.imp])
  ids.conf = (await um(tx, `insert into import_conflicts (import_job_id, row_number, conflict_kind, existing_entity_type, existing_entity_id)
    values ($1, 1, 'CLIENT_DOCUMENT', 'clients', $2) returning id`, [ids.imp, ids.joao])).id
  await tx.query(`update import_jobs set status = 'CONFLICTS_PENDING', dry_run_at = now(), total_rows = 1 where id = $1`, [ids.imp])
})))
await deveFalhar('mesmo campo de destino não é mapeado duas vezes', () =>
  db.query(`insert into import_column_mappings (import_job_id, source_column, target_field) values ($1, 'Nome2', 'client.name')`, [ids.imp]),
  /target_once/)
await deveFalhar('CPF já existente não vira cliente novo (CREATE_NEW)', () =>
  db.query(`update import_conflicts set resolution = 'CREATE_NEW' where id = $1`, [ids.conf]), /never_duplicated/)
await deveFalhar('não se valida com conflito aberto', () =>
  db.query(`update import_jobs set status = 'VALIDATED' where id = $1`, [ids.imp]), /conflitos sem resolução/)
await deve('resolve, confirma (autor registrado), processa e conclui com procedência por linha', async () => {
  await como(ids.barbara, async (tx) => {
    await tx.query(`update import_conflicts set resolution = 'UPDATE' where id = $1`, [ids.conf])
    await tx.query(`update import_jobs set status = 'VALIDATED' where id = $1`, [ids.imp])
    await tx.query(`update import_jobs set status = 'CONFIRMED' where id = $1`, [ids.imp])
  })
  await db.query(`update import_jobs set status = 'PROCESSING' where id = $1`, [ids.imp])
  await db.query(`update import_row_results set status = 'IMPORTED', entity_type = 'clients', entity_id = $2 where import_job_id = $1`, [ids.imp, ids.joao])
  await db.query(`update import_jobs set status = 'COMPLETED', successful_rows = 1 where id = $1`, [ids.imp])
  const j = await um(db, `select confirmed_by, completed_at is not null c from import_jobs where id = $1`, [ids.imp])
  igual([j.confirmed_by, j.c], [ids.barbara, true], 'job')
  const r = await um(db, `select entity_type, entity_id from import_row_results where import_job_id = $1`, [ids.imp])
  igual([r.entity_type, r.entity_id], ['clients', ids.joao], 'procedência')
})
await deveFalhar('linha IMPORTED sem entidade é inconsistente', () =>
  db.query(`insert into import_row_results (import_job_id, row_number, status) values ($1, 2, 'IMPORTED')`, [ids.imp]),
  /imported_has_entity/)
await deve('a linha bruta (com CPF) é apagada depois do prazo; a procedência fica', async () => {
  await db.query(`update import_jobs set completed_at = now() - interval '40 days' where id = $1`, [ids.imp])
  await comoServico((tx) => tx.query(`select private.purge_import_raw_data(interval '30 days')`))
  const r = await um(db, `select raw_data, entity_id from import_row_results where import_job_id = $1 and row_number = 1`, [ids.imp])
  igual([r.raw_data, r.entity_id], [null, ids.joao], 'raw apagado, procedência mantida')
})
await deve('nenhuma coluna específica de fornecedor no schema', async () => {
  const r = await um(db, `select count(*)::int n from information_schema.columns
                          where table_schema = 'public' and (column_name ilike '%advbox%' or column_name ilike '%asaas%')`)
  igual(r.n, 0, 'colunas de fornecedor')
})
await deve('LAWYER não vê importações', () => como(ids.lucas, async (tx) => {
  for (const t of ['import_jobs', 'import_row_results', 'import_conflicts', 'import_column_mappings'])
    igual((await linhas(tx, `select 1 from ${t}`)).length, 0, t)
}))

secao('Função da plataforma fechada para a API [021]')
await deve('anon e authenticated não executam public.rls_auto_enable()', async () => {
  for (const papel of ['anon', 'authenticated']) {
    await db.transaction(async (tx) => {
      await tx.query(`set local role ${papel}`)
      await tx.query(`select public.rls_auto_enable()`)
    }).then(() => { throw new Error(`${papel} executou`) }, (e) => { if (!/permission denied/.test(e.message)) throw e })
  }
})

secao('Storage: caminho de referência e órfãos')
await deveFalhar('referência com caminho fora do padrão é rejeitada', async () => {
  const r = (await um(db, `insert into reference_materials (type, title) values ('OTHER', 'Modelo') returning id`)).id
  await db.query(`insert into reference_material_versions (reference_material_id, storage_object_name) values ($1, 'qualquer/lugar.pdf')`, [r])
}, /storage_object_name/)
await deve('referência no padrão references/{id}/{versão}/{arquivo} é aceita', async () => {
  const r = (await um(db, `insert into reference_materials (type, title, tags) values ('OTHER', 'Modelo 2', '{consignado,inss}') returning id`)).id
  const v = randomUUID()
  await db.query(`insert into reference_material_versions (id, reference_material_id, storage_object_name) values ($1, $2, $3)`,
    [v, r, `references/${r}/${v}/modelo.docx`])
})
await deve('objeto sem versão no banco é listado como órfão (nada é apagado)', async () => {
  await db.query(`insert into storage.objects (bucket_id, name, created_at) values ('legal-documents', 'clients/x/documents/y/z/orfao.pdf', now() - interval '2 days')`)
  const r = await comoServico((tx) => linhas(tx, `select object_name from private.find_orphan_storage_objects()`))
  igual(r.map((x) => x.object_name), ['clients/x/documents/y/z/orfao.pdf'], 'órfãos')
  igual((await um(db, `select count(*)::int n from storage.objects`)).n, 1, 'objeto continua lá')
})
await deve('bucket de importação aceita só CSV/XLSX', async () => {
  const r = await um(db, `select allowed_mime_types m from storage.buckets where id = 'imports'`)
  if (r.m.some((x) => x.includes('json'))) throw new Error(`MIME: ${r.m}`)
})

// ═════════════════════════════ Auth (022) ════════════════════════════════

// Sessão só com senha (aal1): o que o Supabase emite antes do MFA.
function comoAal1(uid, fn) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated', aal: 'aal1' })])
    await tx.query('set local role authenticated')
    return fn(tx)
  })
}
const sha256hex = async (t) => (await import('node:crypto')).createHash('sha256').update(t).digest('hex')
async function usuarioAuth(email, nome = 'Teste') {
  return (await um(db, `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [email, JSON.stringify({ full_name: nome })])).id
}
// Convite: só o servidor (service role) chama, sempre informando o ator [023].
const convidar = (uid, email, role, org = null, token = randomUUID(), nome = 'Convidado Teste') => comoServico(async (tx) => {
  const r = await um(tx, `select public.create_invitation($1, $2, $3, $4, $5, $6) r`, [email, nome, role, org, await sha256hex(token), uid])
  return { ...r.r, token }
})
const aceitar = (uid, token) => comoAal1(uid, async (tx) =>
  (await um(tx, `select public.accept_invitation($1) r`, [await sha256hex(token)])).r)

secao('Auth: MFA obrigatório no banco [022]')
await deve('sessão aal1 (só senha) não lê nenhum dado de domínio', () => comoAal1(ids.barbara, async (tx) => {
  for (const t of ['clients', 'legal_cases', 'documents', 'reviews', 'payments', 'audit_events', 'notifications'])
    igual((await linhas(tx, `select 1 from ${t}`)).length, 0, t)
}))
await deveFalhar('sessão aal1 não decide revisão nem pede execução', () => comoAal1(ids.lucas, (tx) =>
  tx.query(`select public.request_agent_run($1, $2)`, [randomUUID(), ids.casoA])), /duas etapas/)
await deveFalhar('sessão aal1 não lê execuções de agente', () => comoAal1(ids.barbara, (tx) =>
  tx.query(`select * from public.get_agent_run_summaries()`)), /duas etapas/)
await deve('contexto de sessão funciona antes do MFA e só traz o próprio usuário', () => comoAal1(ids.lucas, async (tx) => {
  const c = (await um(tx, `select public.get_my_session_context() c`)).c
  igual([c.user_id, c.profile.active, c.membership.role, c.membership.status, c.membership.organization.type, c.aal],
    [ids.lucas, true, 'LAWYER', 'ACTIVE', 'OWNER', 'aal1'], 'contexto')
}))
await deve('sem sessão, contexto é nulo', () => db.transaction(async (tx) => {
  await tx.query('set local role authenticated')
  igual((await um(tx, `select public.get_my_session_context() c`)).c, null, 'contexto')
}))
await deve('termos aceitos antes do MFA (o próprio usuário) e auditados', async () => {
  await comoAal1(ids.ana, (tx) => tx.query(`insert into user_legal_acceptances (user_id, document_type, document_version)
                                             values ($1, 'TERMS_OF_USE', '0.1-teste')`, [ids.ana]))
  const ev = await um(db, `select actor_user_id, metadata from audit_events where action = 'LEGAL_TERMS_ACCEPTED' and entity_id = $1`, [ids.ana])
  igual([ev?.actor_user_id, ev?.metadata?.document_version], [ids.ana, '0.1-teste'], 'auditoria')
})
await deveFalhar('ninguém aceita termos em nome de outro', () => comoAal1(ids.ana, (tx) =>
  tx.query(`insert into user_legal_acceptances (user_id, document_type, document_version) values ($1, 'TERMS_OF_USE', 'x')`, [ids.lucas])),
  /row-level security/)

secao('Auth: convites [022]')
await deve('ADMIN convida LAWYER (vai para o OWNER) e PARTNER_USER da Almeida; auditado com o autor', async () => {
  const a = await convidar(ids.barbara, 'novo.lawyer@dgbrasil.test', 'LAWYER')
  igual([a.organization_id, a.existing_auth_user], [ids.owner, false], 'interno')
  ids.convLawyer = a
  const b = await convidar(ids.barbara, 'novo.parceiro@dgbrasil.test', 'PARTNER_USER', ids.almeida)
  igual(b.organization_id, ids.almeida, 'parceiro')
  const ev = await um(db, `select actor_user_id from audit_events where action = 'USER_INVITED' and entity_id = $1`, [a.invitation_id])
  igual(ev?.actor_user_id, ids.barbara, 'auditoria')
})
await deveFalhar('ADMIN não põe papel interno em escritório parceiro', () =>
  convidar(ids.barbara, 'x1@dgbrasil.test', 'LAWYER', ids.almeida), /escritório proprietário/)
await deveFalhar('ADMIN não põe papel de parceiro no OWNER', () =>
  convidar(ids.barbara, 'x2@dgbrasil.test', 'PARTNER_USER', ids.owner), /parceiro inválido/)
await deveFalhar('PARTNER_ADMIN A não convida para o parceiro B (IDOR)', () =>
  convidar(ids.almeidaAdm, 'x3@dgbrasil.test', 'PARTNER_USER', ids.ferreira), /próprio escritório/)
await deveFalhar('PARTNER_ADMIN não convida papel interno', () =>
  convidar(ids.almeidaAdm, 'x4@dgbrasil.test', 'LAWYER'), /só convida usuários do parceiro/)
await deve('PARTNER_ADMIN convida PARTNER_ADMIN e PARTNER_USER do próprio escritório (organização vem da sessão)', async () => {
  igual((await convidar(ids.almeidaAdm, 'x5@dgbrasil.test', 'PARTNER_USER')).organization_id, ids.almeida, 'usuário')
  igual((await convidar(ids.almeidaAdm, 'x6@dgbrasil.test', 'PARTNER_ADMIN')).organization_id, ids.almeida, 'admin')
})
for (const [quem, uid] of [['LAWYER', 'lucas'], ['ASSISTANT', 'ana'], ['PARTNER_USER', 'almeidaUsr']])
  await deveFalhar(`${quem} não convida`, () => convidar(ids[uid], `y-${uid}@dgbrasil.test`, 'PARTNER_USER'), /Sem permissão/)
await deveFalhar('e-mail que já tem acesso não é convidado de novo', async () => {
  const email = (await um(db, `select email from auth.users where id = $1`, [ids.lucas])).email
  await convidar(ids.barbara, email, 'ASSISTANT')
}, /EMAIL_ALREADY_HAS_ACCESS/)
await deve('reemitir revoga o convite pendente anterior (um pendente por e-mail e escritório)', async () => {
  await convidar(ids.barbara, 'novo.lawyer@dgbrasil.test', 'LAWYER')
  const r = await linhas(db, `select revoked_at is null pendente from user_invitations where email = 'novo.lawyer@dgbrasil.test' order by created_at`)
  igual(r.map((x) => x.pendente), [false, true], 'pendentes')
})
await deve('PARTNER_ADMIN A não vê nem revoga convite do parceiro B', async () => {
  const b = await convidar(ids.ferreiraAdm, 'z1@dgbrasil.test', 'PARTNER_USER')
  await como(ids.almeidaAdm, async (tx) => igual((await linhas(tx, `select 1 from user_invitations where id = $1`, [b.invitation_id])).length, 0, 'visível'))
  await como(ids.almeidaAdm, (tx) => tx.query(`select public.revoke_invitation($1)`, [b.invitation_id])).then(
    () => { throw new Error('revogou convite de outro parceiro') }, (e) => { if (!/não encontrado/.test(e.message)) throw e })
})

secao('Auth: convite só pelo servidor, nome validado [023]')
await deveFalhar('usuário logado (mesmo ADMIN) não chama create_invitation pela API', () => como(ids.barbara, (tx) =>
  tx.query(`select public.create_invitation('w1@dgbrasil.test', 'Nome Teste', 'LAWYER', null, $1)`, ['a'.repeat(64)])),
  /permission denied/)
await deveFalhar('PARTNER_ADMIN não sonda e-mails pela API (sem enumeração de contas)', () => como(ids.almeidaAdm, (tx) =>
  tx.query(`select public.create_invitation('w2@dgbrasil.test', 'Nome Teste', 'PARTNER_USER', null, $1)`, ['b'.repeat(64)])),
  /permission denied/)
await deveFalhar('service role sem ator não convida', () => comoServico((tx) =>
  tx.query(`select public.create_invitation('w3@dgbrasil.test', 'Nome Teste', 'LAWYER', null, $1)`, ['c'.repeat(64)])),
  /precisa informar quem está agindo/)
for (const nome of ['X', 'Acesse www.golpe.com', 'João http://x.y', 'Pague R$ 100', 'Ana <b>', 'Ana@mail', 'Nome--Duplo', 'Ana  .', 'A'.repeat(50) + ' Silva', '1234'])
  await deveFalhar(`nome de convidado recusado: ${JSON.stringify(nome.slice(0, 24))}`, () =>
    convidar(ids.barbara, `n${randomUUID().slice(0, 8)}@dgbrasil.test`, 'LAWYER', null, randomUUID(), nome), /Nome inválido/)
for (const nome of ['Maria José da Silva', "Ana D'Ávila", 'Dr. João Pereira-Lima', 'Zoë Łukasiewicz', 'J. R. Tolkien Jr.'])
  await deve(`nome de convidado aceito: ${nome}`, () =>
    convidar(ids.barbara, `n${randomUUID().slice(0, 8)}@dgbrasil.test`, 'LAWYER', null, randomUUID(), nome))
await deve('nome é normalizado (espaços) e conta existente devolve auth_user_id só ao servidor', async () => {
  const id = await usuarioAuth('existente023@dgbrasil.test', 'Existente Teste')
  const r = await convidar(ids.barbara, 'existente023@dgbrasil.test', 'ASSISTANT', null, randomUUID(), '  Existente   Teste ')
  igual([r.existing_auth_user, r.auth_user_id], [true, id], 'conta existente')
  igual((await um(db, `select full_name from user_invitations where id = $1`, [r.invitation_id])).full_name, 'Existente Teste', 'nome')
  igual((await convidar(ids.barbara, 'nova023@dgbrasil.test', 'ASSISTANT')).auth_user_id, null, 'conta nova')
})

secao('Auth: aceite do convite (atômico, idempotente) [022]')
await deve('convidado aceita (antes do MFA): vínculo ACTIVE criado uma vez; repetir não duplica', async () => {
  const t = randomUUID()
  await convidar(ids.barbara, 'aceita@dgbrasil.test', 'ASSISTANT', null, t)
  ids.aceita = await usuarioAuth('aceita@dgbrasil.test', 'Aceita Teste')
  igual((await aceitar(ids.aceita, t)).status, 'ACCEPTED', 'primeiro aceite')
  igual((await aceitar(ids.aceita, t)).status, 'ALREADY_ACCEPTED', 'segundo aceite')
  const m = await linhas(db, `select role, status from organization_memberships where user_id = $1`, [ids.aceita])
  igual(m.map((x) => [x.role, x.status]), [['ASSISTANT', 'ACTIVE']], 'um vínculo')
})
await deve('outro e-mail com o mesmo link não aceita (INVALID)', async () => {
  const t = randomUUID()
  await convidar(ids.barbara, 'alvo@dgbrasil.test', 'ASSISTANT', null, t)
  const intruso = await usuarioAuth('intruso2@dgbrasil.test')
  igual((await aceitar(intruso, t)).status, 'INVALID', 'intruso')
  igual((await um(db, `select count(*)::int n from organization_memberships where user_id = $1`, [intruso])).n, 0, 'sem vínculo')
})
await deve('convite revogado e convite expirado não completam o acesso', async () => {
  const t1 = randomUUID(), t2 = randomUUID()
  const r = await convidar(ids.barbara, 'revogado@dgbrasil.test', 'ASSISTANT', null, t1)
  await como(ids.barbara, (tx) => tx.query(`select public.revoke_invitation($1)`, [r.invitation_id]))
  igual((await aceitar(await usuarioAuth('revogado@dgbrasil.test'), t1)).status, 'REVOKED', 'revogado')
  const e = await convidar(ids.barbara, 'expirado@dgbrasil.test', 'ASSISTANT', null, t2)
  await db.query(`update user_invitations set created_at = now() - interval '10 days', expires_at = now() - interval '1 day' where id = $1`, [e.invitation_id])
  igual((await aceitar(await usuarioAuth('expirado@dgbrasil.test'), t2)).status, 'EXPIRED', 'expirado')
})
await deve('primeiro PARTNER_ADMIN ativa o escritório parceiro pendente', async () => {
  const p = (await um(db, `insert into organizations (type, name, status) values ('PARTNER', 'Parceiro Pendente', 'PENDING') returning id`)).id
  await db.query(`insert into partner_office_settings (organization_id, default_partner_percentage, default_owner_percentage) values ($1, 50, 50)`, [p])
  const t = randomUUID()
  await convidar(ids.barbara, 'pa.pendente@dgbrasil.test', 'PARTNER_ADMIN', p, t)
  igual((await aceitar(await usuarioAuth('pa.pendente@dgbrasil.test'), t)).status, 'ACCEPTED', 'aceite')
  const o = await um(db, `select o.status, s.activated_at is not null a from organizations o join partner_office_settings s on s.organization_id = o.id where o.id = $1`, [p])
  igual([o.status, o.a], ['ACTIVE', true], 'escritório ativado')
})

secao('Auth: papel, vínculo e perfil [022]')
await deve('ADMIN muda LAWYER → ASSISTANT e o efeito é imediato (sem novo login)', async () => {
  ids.lawyer2 = await usuario('Lawyer2', ids.owner, 'LAWYER')
  await como(ids.lawyer2, async (tx) => { if ((await linhas(tx, `select 1 from reviews`)).length === 0) throw new Error('LAWYER sem revisões') })
  const m = (await um(db, `select id from organization_memberships where user_id = $1`, [ids.lawyer2])).id
  await como(ids.barbara, (tx) => tx.query(`select public.set_membership_role($1, 'ASSISTANT')`, [m]))
  await como(ids.lawyer2, async (tx) => igual((await linhas(tx, `select 1 from reviews`)).length, 0, 'revisões depois da troca'))
  const ev = await um(db, `select actor_user_id from audit_events where action = 'ROLE_CHANGED' and entity_id = $1`, [m])
  igual(ev?.actor_user_id, ids.barbara, 'auditoria')
  ids.lawyer2Membership = m
})
await deveFalhar('PARTNER_ADMIN A não muda papel de usuário do parceiro B (IDOR)', async () => {
  const m = (await um(db, `select id from organization_memberships where user_id = $1`, [ids.ferreiraAdm])).id
  await como(ids.almeidaAdm, (tx) => tx.query(`select public.set_membership_role($1, 'PARTNER_USER')`, [m]))
}, /não encontrado/)
await deveFalhar('PARTNER_ADMIN A não suspende usuário do parceiro B (IDOR)', async () => {
  const m = (await um(db, `select id from organization_memberships where user_id = $1`, [ids.ferreiraAdm])).id
  await como(ids.almeidaAdm, (tx) => tx.query(`select public.set_membership_status($1, 'SUSPENDED')`, [m]))
}, /não encontrado/)
await deveFalhar('PARTNER_ADMIN não promove usuário a papel interno', async () => {
  const m = (await um(db, `select id from organization_memberships where user_id = $1`, [ids.almeidaUsr])).id
  await como(ids.almeidaAdm, (tx) => tx.query(`select public.set_membership_role($1, 'LAWYER')`, [m]))
}, /Papel não permitido|role_matches_org/)
await deveFalhar('ninguém altera o próprio acesso', async () => {
  const m = (await um(db, `select id from organization_memberships where user_id = $1`, [ids.barbara])).id
  await como(ids.barbara, (tx) => tx.query(`select public.set_membership_status($1, 'SUSPENDED')`, [m]))
}, /próprio acesso/)
await deveFalhar('o último ADMIN ativo não sai (proteção também no banco)', () =>
  db.query(`select private.assert_not_last_admin($1)`, [ids.barbara]), /último administrador/)
await deve('ADMIN inativa o perfil: a sessão existente perde acesso na próxima consulta', async () => {
  await como(ids.barbara, (tx) => tx.query(`select public.set_profile_active($1, false)`, [ids.lawyer2]))
  await como(ids.lawyer2, async (tx) => igual((await linhas(tx, `select 1 from clients`)).length, 0, 'clientes'))
  await como(ids.barbara, (tx) => tx.query(`select public.set_profile_active($1, true)`, [ids.lawyer2]))
})
await deveFalhar('LAWYER não inativa ninguém', () => como(ids.lucas, (tx) =>
  tx.query(`select public.set_profile_active($1, false)`, [ids.lawyer2])), /Somente ADMIN/)
await deve('equipe: ADMIN vê a interna com e-mail; PARTNER_ADMIN só a própria', async () => {
  await como(ids.barbara, async (tx) => {
    const r = await linhas(tx, `select email, role from public.get_team_members()`)
    if (!r.some((x) => x.role === 'LAWYER' && x.email)) throw new Error('equipe interna sem e-mail')
  })
  await como(ids.almeidaAdm, async (tx) => {
    const r = await linhas(tx, `select organization_id from public.get_team_members()`)
    if (r.length === 0 || r.some((x) => x.organization_id !== ids.almeida)) throw new Error('fora do escritório')
  })
})
await deveFalhar('PARTNER_ADMIN A não lista a equipe do parceiro B', () => como(ids.almeidaAdm, (tx) =>
  tx.query(`select * from public.get_team_members($1)`, [ids.ferreira])), /Sem permissão/)
await deveFalhar('LAWYER não lista equipe', () => como(ids.lucas, (tx) => tx.query(`select * from public.get_team_members()`)), /Sem permissão/)

secao('Auth: escritório OWNER e eventos administrativos [022]')
await deveFalhar('nem ADMIN suspende o escritório proprietário', () => como(ids.barbara, (tx) =>
  tx.query(`update organizations set status = 'SUSPENDED' where id = $1`, [ids.owner])), /proprietário não pode/)
await deveFalhar('organização não troca de tipo', () =>
  db.query(`update organizations set type = 'OWNER' where id = $1`, [ids.almeida]), /tipo da organização/)
await deveFalhar('usuário logado não grava evento de Auth', () => como(ids.barbara, (tx) =>
  tx.query(`select public.record_auth_event('MFA_RESET_COMPLETED', $1)`, [ids.lucas])), /permission denied/)
await deve('backend registra reset de MFA em nome do ADMIN (ator preservado)', async () => {
  await comoServico((tx) => tx.query(`select public.record_auth_event('MFA_RESET_COMPLETED', $1, '{"factors":1}', $2)`, [ids.lucas, ids.barbara]))
  const ev = await um(db, `select actor_type, actor_user_id from audit_events where action = 'MFA_RESET_COMPLETED' and entity_id = $1`, [ids.lucas])
  igual([ev?.actor_type, ev?.actor_user_id], ['USER', ids.barbara], 'auditoria')
})
await deveFalhar('evento de Auth em nome de quem não é ADMIN é recusado', () => comoServico((tx) =>
  tx.query(`select public.record_auth_event('MFA_RESET_COMPLETED', $1, '{}', $2)`, [ids.ana, ids.lucas])), /Somente ADMIN/)

secao('Introdução do produto: uma vez por usuário, no banco [024]')
await deve('usuário novo: sem tour_completed_at (a introdução aparece)', () => como(ids.ana, async (tx) => {
  const r = await linhas(tx, `select tour_completed_at from user_preferences where user_id = $1`, [ids.ana])
  igual(r.length === 0 || r[0].tour_completed_at === null, true, 'pendente')
}))
await deve('concluir ou pular grava o horário (aal2, o próprio usuário)', () => como(ids.ana, async (tx) => {
  await tx.query(`insert into user_preferences (user_id, tour_completed_at) values ($1, now())
                  on conflict (user_id) do update set tour_completed_at = coalesce(user_preferences.tour_completed_at, excluded.tour_completed_at)`, [ids.ana])
  igual((await um(tx, `select tour_completed_at is not null feito from user_preferences where user_id = $1`, [ids.ana])).feito, true, 'gravado')
}))
await deve('outro acesso (nova sessão, outro navegador) lê o mesmo estado do banco', () => como(ids.ana, async (tx) =>
  igual((await um(tx, `select tour_completed_at is not null feito from user_preferences where user_id = $1`, [ids.ana])).feito, true, 'concluído')))
await deve('sessão só com senha (aal1) não lê preferências', () => comoAal1(ids.ana, async (tx) =>
  igual((await linhas(tx, `select 1 from user_preferences`)).length, 0, 'visível em aal1')))
await deveFalhar('sessão só com senha (aal1) não grava preferências', () => comoAal1(ids.lucas, (tx) =>
  tx.query(`insert into user_preferences (user_id, tour_completed_at) values ($1, now())`, [ids.lucas])), /row-level security/)
await deveFalhar('ninguém marca a introdução de outro usuário', () => como(ids.barbara, (tx) =>
  tx.query(`insert into user_preferences (user_id, tour_completed_at) values ($1, now())`, [ids.lucas])), /row-level security/)
await deve('preferências de notificação também exigem aal2', () => comoAal1(ids.ana, async (tx) =>
  igual((await linhas(tx, `select 1 from user_notification_preferences`)).length, 0, 'visível em aal1')))

secao('Backend: correlation ID na auditoria [025]')
await deve('pré-requisição copia x-dg-request-id (UUID) para dg.request_id; a auditoria grava', () => como(ids.barbara, async (tx) => {
  const rid = randomUUID()
  await tx.query(`select set_config('request.headers', $1, true)`, [JSON.stringify({ 'x-dg-request-id': rid })])
  await tx.query(`select public.dg_pre_request()`)
  igual((await um(tx, `select current_setting('dg.request_id', true) v`)).v, rid, 'variável')
  const c = (await um(tx, `insert into clients (kind, cpf, origin_organization_id) values ('INDIVIDUAL', '99900025001', $1) returning id`, [ids.owner])).id
  igual((await um(tx, `select request_id from audit_events where entity_id = $1 and action = 'CLIENT_CREATED'`, [c])).request_id, rid, 'auditoria')
}))
await deve('cabeçalho que não é UUID (texto livre, PII) é ignorado', () => como(ids.barbara, async (tx) => {
  await tx.query(`select set_config('request.headers', $1, true)`, [JSON.stringify({ 'x-dg-request-id': "João 123.456.789-00'; drop" })])
  await tx.query(`select public.dg_pre_request()`)
  igual((await um(tx, `select coalesce(current_setting('dg.request_id', true), '') v`)).v, '', 'variável')
}))
await deve('sem cabeçalho (ou JSON inválido) a pré-requisição não falha', () => como(ids.barbara, async (tx) => {
  await tx.query(`select set_config('request.headers', 'nao-json', true)`)
  await tx.query(`select public.dg_pre_request()`)
}))

secao('Backend: cliente do parceiro sem vazamento [025]')
const lookup = (uid, doc) => como(uid, async (tx) => (await um(tx, `select public.partner_lookup_client($1) r`, [doc])).r)
const enviarCaso = (uid, client, kase) => como(uid, async (tx) =>
  (await um(tx, `select public.partner_submit_case($1, $2) r`, [JSON.stringify(client), JSON.stringify(kase)])).r)
const casoBase = () => ({ legal_area_id: ids.banking, title: 'Caso do portal', origin_organization_id: ids.almeida })
await deve('consulta: CPF inexistente → NOT_FOUND', async () => igual(await lookup(ids.almeidaAdm, '999.000.250-99'), { status: 'NOT_FOUND' }, 'consulta'))
await deve('consulta: cliente já relacionado → ALREADY_RELATED com id', async () => {
  const cpf = (await um(db, `select cpf from clients where id = $1`, [ids.joao])).cpf
  igual(await lookup(ids.almeidaAdm, cpf), { status: 'ALREADY_RELATED', client_id: ids.joao }, 'consulta')
})
await deve('consulta: cliente só de outro escritório → EXISTS sem id nem nome; auditado internamente', async () => {
  const r = await lookup(ids.almeidaAdm, '55566677788')
  igual(r, { status: 'EXISTS' }, 'consulta')
  const ev = await um(db, `select actor_user_id, metadata from audit_events where action = 'CLIENT_DUPLICATE_DETECTED' and entity_id = $1 order by created_at desc limit 1`, [ids.carla])
  igual([ev?.actor_user_id, ev?.metadata?.organization_id], [ids.almeidaAdm, ids.almeida], 'auditoria')
})
await deveFalhar('consulta: equipe interna não usa a operação do portal', () => lookup(ids.barbara, '55566677788'), /exclusiva do Portal/)
await deveFalhar('consulta: parceiro sem MFA (aal1) é recusado', () => comoAal1(ids.almeidaAdm, (tx) =>
  tx.query(`select public.partner_lookup_client('55566677788')`)), /exclusiva do Portal/)
await deve('envio com cliente NOVO: cria cliente + detalhes + contato + caso SUBMITTED; parceiro passa a ver o cliente', async () => {
  const r = await enviarCaso(ids.almeidaAdm, { document: '999.002.500-01', kind: 'INDIVIDUAL', origin_organization_id: ids.almeida,
    full_name: 'Cliente Portal Teste', email: 'Portal@DGBrasil.test', phone: '(11) 99999-0000',
    address: { postal_code: '01001-000', city: 'São Paulo', state: 'sp' } }, casoBase())
  igual(r.client_existed, false, 'novo')
  const c = await um(db, `select c.cpf, d.full_name, lc.status, lc.partner_organization_id
                          from clients c join individual_client_details d on d.client_id = c.id
                          join legal_cases lc on lc.client_id = c.id where c.id = $1`, [r.client_id])
  igual([c.cpf, c.full_name, c.status, c.partner_organization_id], ['99900250001', 'Cliente Portal Teste', 'SUBMITTED', ids.almeida], 'gravado')
  igual((await um(db, `select value from client_contacts where client_id = $1 and type = 'EMAIL'`, [r.client_id])).value, 'portal@dgbrasil.test', 'e-mail')
  await como(ids.almeidaUsr, async (tx) => igual((await linhas(tx, `select 1 from clients where id = $1`, [r.client_id])).length, 1, 'visível ao parceiro'))
  await como(ids.ferreiraAdm, async (tx) => igual((await linhas(tx, `select 1 from clients where id = $1`, [r.client_id])).length, 0, 'invisível ao outro parceiro'))
})
await deve('envio com cliente EXISTENTE de outro escritório: não duplica nem altera o cadastro; vincula e cria o caso', async () => {
  const antes = await um(db, `select full_name from individual_client_details where client_id = $1`, [ids.carla])
  const r = await enviarCaso(ids.almeidaAdm, { document: '55566677788', kind: 'INDIVIDUAL', origin_organization_id: ids.almeida, full_name: 'Nome Diferente' }, casoBase())
  igual([r.client_existed, r.client_id], [true, ids.carla], 'existente')
  igual((await um(db, `select full_name from individual_client_details where client_id = $1`, [ids.carla])).full_name, antes.full_name, 'nome canônico preservado')
  igual((await um(db, `select count(*)::int n from clients where cpf = '55566677788'`)).n, 1, 'sem duplicata')
  const ev = await um(db, `select metadata from audit_events where action = 'CLIENT_PARTNER_LINKED' and entity_id = $1`, [ids.carla])
  igual(ev?.metadata?.organization_id, ids.almeida, 'vínculo auditado')
  // O parceiro A continua sem ver o relacionamento nem os casos do parceiro B.
  await como(ids.almeidaAdm, async (tx) => {
    igual((await linhas(tx, `select organization_id from client_organization_relationships where client_id = $1`, [ids.carla])).map((x) => x.organization_id), [ids.almeida], 'só o próprio vínculo')
    igual((await linhas(tx, `select 1 from legal_cases where client_id = $1 and partner_organization_id = $2`, [ids.carla, ids.ferreira])).length, 0, 'casos do outro parceiro')
  })
})
await deveFalhar('envio com origem de OUTRO parceiro é recusado', () =>
  enviarCaso(ids.almeidaAdm, { document: '99900250002', kind: 'INDIVIDUAL', origin_organization_id: ids.almeida, full_name: 'X Teste' },
    { ...casoBase(), origin_organization_id: ids.ferreira }), /próprio escritório ou ao escritório proprietário/)
await deveFalhar('envio com tipo de cliente que não bate com o documento é recusado', () =>
  enviarCaso(ids.almeidaAdm, { document: '99900250003', kind: 'COMPANY', origin_organization_id: ids.almeida, legal_name: 'X' }, casoBase()),
  /não corresponde/)
await deve('falha no caso desfaz o cliente novo (atômico)', async () => {
  await enviarCaso(ids.almeidaAdm, { document: '99900250004', kind: 'INDIVIDUAL', origin_organization_id: ids.almeida, full_name: 'Atomico Teste' },
    { ...casoBase(), title: '   ' }).then(() => { throw new Error('aceitou título vazio') }, () => {})
  igual((await um(db, `select count(*)::int n from clients where cpf = '99900250004'`)).n, 0, 'cliente desfeito')
})
await deveFalhar('equipe interna não usa o envio do portal', () =>
  enviarCaso(ids.barbara, { document: '99900250005', kind: 'INDIVIDUAL', origin_organization_id: ids.owner, full_name: 'X Teste' }, casoBase()),
  /exclusiva do Portal/)

secao('Backend: gravação e busca de clientes [025]')
const salvar = (uid, id, p) => como(uid, async (tx) => (await um(tx, `select public.save_client($1, $2) id`, [id, JSON.stringify(p)])).id)
await deve('ASSISTANT cria PF completa numa transação (detalhes, contatos, endereço, dados internos)', async () => {
  ids.cli025 = await salvar(ids.ana, null, {
    kind: 'INDIVIDUAL', document: '999.025.000-01', origin_organization_id: ids.owner, responsible_user_id: ids.lucas,
    full_name: 'Maria Teste 025', birth_date: '1950-05-01', gender: 'FEMALE', marital_status: 'WIDOWED',
    identity_document: { type: 'RG', number: '1234567', issuer: 'SSP', state: 'sp' },
    contact: { email: 'Maria@DGBrasil.test', phone: '(11) 98888-7777', secondary_phone: '1133334444', website: '' },
    address: { postal_code: '01001-000', street: 'Rua A', number: '10', neighborhood: 'Centro', city: 'São Paulo', state: 'SP' },
    notes: 'nota interna', legal_summary: 'resumo',
  })
  const r = await um(db, `select c.cpf, d.full_name, d.identity_document_state, i.notes,
      (select count(*)::int from client_contacts where client_id = c.id) contatos,
      (select postal_code from client_addresses where client_id = c.id and is_primary) cep
    from clients c join individual_client_details d on d.client_id = c.id
    left join client_internal_details i on i.client_id = c.id where c.id = $1`, [ids.cli025])
  igual([r.cpf, r.full_name, r.identity_document_state, r.notes, r.contatos, r.cep],
    ['99902500001', 'Maria Teste 025', 'SP', 'nota interna', 3, '01001000'], 'gravado')
})
await deve('PATCH: chave ausente não mexe; null limpa; contato vazio apaga', async () => {
  await salvar(ids.lucas, ids.cli025, { profession: 'Aposentada', contact: { secondary_phone: null } })
  const r = await um(db, `select d.full_name, d.profession,
      (select count(*)::int from client_contacts where client_id = d.client_id and type = 'PHONE') fones
    from individual_client_details d where d.client_id = $1`, [ids.cli025])
  igual([r.full_name, r.profession, r.fones], ['Maria Teste 025', 'Aposentada', 1], 'patch')
})
await deveFalhar('CPF duplicado não cria outro cliente (unique)', () =>
  salvar(ids.ana, null, { kind: 'INDIVIDUAL', document: '99902500001', origin_organization_id: ids.owner, full_name: 'Outra' }), /clients_cpf_key/)
await deveFalhar('falha nos detalhes desfaz o cliente (atômico)', () =>
  salvar(ids.ana, null, { kind: 'INDIVIDUAL', document: '99902500002', origin_organization_id: ids.owner, full_name: '   ' }))
await deve('…e nenhum cliente sobrou do CPF que falhou', async () =>
  igual((await um(db, `select count(*)::int n from clients where cpf = '99902500002'`)).n, 0, 'sobra'))
await deveFalhar('ASSISTANT não corrige CPF (só ADMIN)', () => salvar(ids.ana, ids.cli025, { document: '99902500009' }), /Somente ADMIN/)
await deve('parceiro altera contato e endereço de cliente que acessa', async () => {
  await salvar(ids.almeidaAdm, ids.joao, { contact: { phone: '11 97777-6666' }, address: { city: 'Campinas', state: 'SP' } })
  igual((await um(db, `select city from client_addresses where client_id = $1 and is_primary`, [ids.joao])).city, 'Campinas', 'endereço')
})
await deveFalhar('parceiro não altera nome nem dado interno', () => salvar(ids.almeidaAdm, ids.joao, { full_name: 'X Y' }), /só altera contato e endereço/)
await deveFalhar('parceiro não altera cliente sem relacionamento (IDOR)', () =>
  salvar(ids.almeidaAdm, ids.cli025, { contact: { phone: '1199999999' } }), /não encontrado/)
await deveFalhar('parceiro não cria cliente por aqui', () =>
  salvar(ids.almeidaAdm, null, { contact: {} }), /envio de caso/)
await deve('inativar e reativar (interno) com motivo nos dados internos', async () => {
  await como(ids.ana, (tx) => tx.query(`select public.set_client_status($1, 'INACTIVE', 'CLIENT_GAVE_UP', 'desistiu')`, [ids.cli025]))
  const r = await um(db, `select c.status, i.inactivation_reason, i.inactivated_by from clients c join client_internal_details i on i.client_id = c.id where c.id = $1`, [ids.cli025])
  igual([r.status, r.inactivation_reason, r.inactivated_by], ['INACTIVE', 'CLIENT_GAVE_UP', ids.ana], 'inativo')
  await como(ids.ana, (tx) => tx.query(`select public.set_client_status($1, 'ACTIVE')`, [ids.cli025]))
  igual((await um(db, `select status from clients where id = $1`, [ids.cli025])).status, 'ACTIVE', 'reativado')
})
await deveFalhar('parceiro não inativa cliente', () => como(ids.almeidaAdm, (tx) =>
  tx.query(`select public.set_client_status($1, 'INACTIVE')`, [ids.joao])), /equipe interna/)
await deve('client_directory: busca por nome e documento; parceiro só vê os seus', async () => {
  await como(ids.lucas, async (tx) => {
    igual((await linhas(tx, `select id from client_directory where display_name ilike '%teste 025%'`)).map((x) => x.id), [ids.cli025], 'nome')
    igual((await linhas(tx, `select id from client_directory where cpf like '999025%'`)).map((x) => x.id), [ids.cli025], 'documento')
  })
  await como(ids.almeidaAdm, async (tx) => {
    igual((await linhas(tx, `select 1 from client_directory where id = $1`, [ids.cli025])).length, 0, 'parceiro sem relacionamento')
    igual((await linhas(tx, `select 1 from client_directory where id = $1`, [ids.joao])).length, 1, 'parceiro com relacionamento')
  })
})

secao('Backend: Storage autorizado pelo banco [026]')
await deve('upload: equipe interna recebe o caminho exato; versão repetida é recusada', () => como(ids.lucas, async (tx) => {
  const v = randomUUID()
  const nome = (await um(tx, `select public.authorize_document_upload($1, $2, 'Extrato Março.pdf') n`, [ids.docInterno, v])).n
  igual(nome, `clients/${ids.joao}/documents/${ids.docInterno}/${v}/Extrato_Mar_o.pdf`, 'caminho')
  await tx.query(`select public.authorize_document_upload($1, $2, 'x.pdf')`, [ids.docInterno, ids.vInterno]).then(
    () => { throw new Error('aceitou versão existente') }, (e) => { if (!/já registrada/.test(e.message)) throw e })
}))
await deveFalhar('upload: parceiro não envia para documento INTERNAL', () => como(ids.almeidaUsr, (tx) =>
  tx.query(`select public.authorize_document_upload($1, $2, 'x.pdf')`, [ids.docInterno, randomUUID()])), /não encontrado/)
await deveFalhar('upload: sessão só com senha (aal1) não autoriza', () => comoAal1(ids.lucas, (tx) =>
  tx.query(`select public.authorize_document_upload($1, $2, 'x.pdf')`, [ids.docInterno, randomUUID()])), /Sem sessão liberada/)
await deve('download: parceiro baixa PARTNER_VISIBLE do próprio caso; LGPD e auditoria com o usuário', async () => {
  const nome = await como(ids.almeidaUsr, async (tx) => (await um(tx, `select public.authorize_document_download($1) n`, [ids.v1])).n)
  if (!nome?.includes(`/documents/${ids.docVisivel}/${ids.v1}/`)) throw new Error(`caminho ${nome}`)
  const ac = await um(db, `select actor_user_id, action from personal_data_access_events where resource_id = $1 and action = 'DOWNLOAD' order by created_at desc limit 1`, [ids.v1])
  igual([ac?.actor_user_id, ac?.action], [ids.almeidaUsr, 'DOWNLOAD'], 'LGPD')
  const au = await um(db, `select actor_type, actor_user_id from audit_events where action = 'DOCUMENT_DOWNLOADED' and entity_id = $1 order by created_at desc limit 1`, [ids.v1])
  igual([au?.actor_type, au?.actor_user_id], ['USER', ids.almeidaUsr], 'auditoria')
})
await deveFalhar('download: parceiro não baixa versão de documento INTERNAL', () => como(ids.almeidaUsr, (tx) =>
  tx.query(`select public.authorize_document_download($1)`, [ids.vInterno])), /não encontrado/)
await deveFalhar('download: outro parceiro não baixa (IDOR)', () => como(ids.ferreiraAdm, (tx) =>
  tx.query(`select public.authorize_document_download($1)`, [ids.v1])), /não encontrado/)
await deveFalhar('service role não usa as funções de autorização (precisa ser o usuário)', () => comoServico((tx) =>
  tx.query(`select public.authorize_document_download($1)`, [ids.v1])), /permission denied/)

secao('Backend: idempotência e operações atômicas [026]')
await deve('lançamento com a mesma chave não duplica (unique por autor)', async () => {
  const k = randomUUID()
  await como(ids.barbara, async (tx) => {
    const p = (await um(tx, `insert into payments (financial_agreement_id, amount, payment_type, idempotency_key) values ($1, 50, 'OTHER', $2) returning id`, [ids.acordo, randomUUID()])).id
    await tx.query(`insert into payment_receipts (payment_id, kind, amount, idempotency_key) values ($1, 'RECEIPT', 10, $2)`, [p, k])
    await tx.query(`savepoint s`)
    await tx.query(`insert into payment_receipts (payment_id, kind, amount, idempotency_key) values ($1, 'RECEIPT', 10, $2)`, [p, k]).then(
      () => { throw new Error('duplicou') }, async (e) => { if (!/payment_receipts_idempotency/.test(e.message)) throw e; await tx.query(`rollback to savepoint s`) })
    igual((await um(tx, `select count(*)::int n from payment_receipts where payment_id = $1`, [p])).n, 1, 'lançamentos')
  })
})
await deve('execução de agente com a mesma chave devolve a mesma execução (sem enfileirar de novo)', async () => {
  const k = randomUUID()
  const pedir = () => como(ids.lucas, async (tx) => (await um(tx, `select public.request_agent_run_once($1, $2, $3) r`, [k, ids.agente, ids.casoA])).r)
  const a = await pedir()
  const b = await pedir()
  igual([a.deduplicated, b.deduplicated, b.run_id], [false, true, a.run_id], 'idempotência')
  igual((await um(db, `select count(*)::int n from agent_runs where idempotency_key = $1`, [k])).n, 1, 'execuções')
})
await deveFalhar('ASSISTANT não pede execução nem com chave', () => como(ids.ana, (tx) =>
  tx.query(`select public.request_agent_run_once($1, $2, $3)`, [randomUUID(), ids.agente, ids.casoA])), /ADMIN ou LAWYER/)
await deve('repasse atômico: consome saldo disponível; repetir com a chave não duplica', async () => {
  const disp = Number((await um(db, `select coalesce(sum(net_partner_amount - transferred_amount), 0) v from partner_allocation_balances where partner_organization_id = $1`, [ids.almeida])).v)
  if (disp < 1) throw new Error(`cenário sem saldo disponível (${disp})`)
  const k = randomUUID()
  const r1 = await como(ids.barbara, async (tx) => (await um(tx, `select public.create_partner_transfer($1, 1, 'PIX teste', null, $2) r`, [ids.almeida, k])).r)
  const r2 = await como(ids.barbara, async (tx) => (await um(tx, `select public.create_partner_transfer($1, 1, 'PIX teste', null, $2) r`, [ids.almeida, k])).r)
  igual([r1.deduplicated, r2.deduplicated, r2.transfer_id], [false, true, r1.transfer_id], 'idempotência')
  igual((await um(db, `select coalesce(sum(amount), 0)::text v from partner_transfer_items where transfer_id = $1`, [r1.transfer_id])).v, '1.00', 'itens')
  const depois = Number((await um(db, `select coalesce(sum(net_partner_amount - transferred_amount), 0) v from partner_allocation_balances where partner_organization_id = $1`, [ids.almeida])).v)
  igual(Math.round((disp - depois) * 100), 100, 'saldo consumido')
})
await deve('repasse acima do saldo é recusado e nada fica gravado', async () => {
  const antes = (await um(db, `select count(*)::int n from partner_transfers`)).n
  await como(ids.barbara, (tx) => tx.query(`select public.create_partner_transfer($1, 99999999)`, [ids.almeida])).then(
    () => { throw new Error('aceitou') }, (e) => { if (!/insuficiente/.test(e.message)) throw e })
  igual((await um(db, `select count(*)::int n from partner_transfers`)).n, antes, 'repasses')
})
await deveFalhar('LAWYER não registra repasse', () => como(ids.lucas, (tx) =>
  tx.query(`select public.create_partner_transfer($1, 1)`, [ids.almeida])), /Somente ADMIN/)
await deve('cadastro de parceiro atômico (organização + configuração)', async () => {
  const id = await como(ids.barbara, async (tx) => (await um(tx, `select public.create_partner_office($1, $2) id`,
    [JSON.stringify({ name: 'Parceiro 026', cnpj: '99.026.000/0001-26', address_state: 'sp' }), JSON.stringify({ default_partner_percentage: 40, default_owner_percentage: 60 })])).id)
  const r = await um(db, `select o.type, o.status, s.default_partner_percentage::text p from organizations o join partner_office_settings s on s.organization_id = o.id where o.id = $1`, [id])
  igual([r.type, r.status, r.p], ['PARTNER', 'PENDING', '40.00'], 'parceiro')
})
await deve('cadastro de parceiro com divisão inválida não deixa organização órfã', async () => {
  const antes = (await um(db, `select count(*)::int n from organizations`)).n
  await como(ids.barbara, (tx) => tx.query(`select public.create_partner_office($1, $2)`,
    [JSON.stringify({ name: 'Parceiro Órfão' }), JSON.stringify({ default_partner_percentage: 40, default_owner_percentage: 40 })])).then(
    () => { throw new Error('aceitou') }, () => {})
  igual((await um(db, `select count(*)::int n from organizations`)).n, antes, 'organizações')
})
await deveFalhar('LAWYER não cadastra parceiro', () => como(ids.lucas, (tx) =>
  tx.query(`select public.create_partner_office('{"name":"X"}', '{}')`)), /Somente ADMIN/)

secao('Backend: solicitações ao parceiro [026]')
await deve('resposta do parceiro: mensagem + ANSWERED numa transação; repetir o envio não duplica', async () => {
  ids.ped026 = await como(ids.lucas, async (tx) => (await um(tx, `insert into partner_requests (partner_organization_id, legal_case_id, type, title)
    values ($1, $2, 'INFORMATION', 'Confirmar dados') returning id`, [ids.almeida, ids.casoA])).id)
  const m = randomUUID()
  const s1 = await como(ids.almeidaUsr, async (tx) => (await um(tx, `select public.answer_partner_request($1, $2, 'Dados confirmados') s`, [ids.ped026, m])).s)
  const s2 = await como(ids.almeidaUsr, async (tx) => (await um(tx, `select public.answer_partner_request($1, $2, 'Dados confirmados') s`, [ids.ped026, m])).s)
  igual([s1, s2], ['ANSWERED', 'ANSWERED'], 'situação')
  igual((await um(db, `select count(*)::int n from partner_request_messages where partner_request_id = $1`, [ids.ped026])).n, 1, 'mensagens')
})
await deve('equipe interna reabre (ANSWERED → OPEN) ao responder com p_reopen', () => como(ids.lucas, async (tx) =>
  igual((await um(tx, `select public.answer_partner_request($1, $2, 'Faltou o anexo', null, true) s`, [ids.ped026, randomUUID()])).s, 'OPEN', 'situação')))
await deveFalhar('outro parceiro não responde (IDOR)', () => como(ids.ferreiraAdm, (tx) =>
  tx.query(`select public.answer_partner_request($1, $2, 'x')`, [ids.ped026, randomUUID()])), /não encontrada/)
await deve('encerrada: não recebe mensagem (nem por insert direto) e não reabre', async () => {
  await como(ids.lucas, (tx) => tx.query(`update partner_requests set status = 'RESOLVED' where id = $1`, [ids.ped026]))
  await como(ids.almeidaUsr, (tx) => tx.query(`select public.answer_partner_request($1, $2, 'x')`, [ids.ped026, randomUUID()])).then(
    () => { throw new Error('aceitou mensagem') }, (e) => { if (!/encerrada/.test(e.message)) throw e })
  await como(ids.almeidaUsr, (tx) => tx.query(`insert into partner_request_messages (partner_request_id, author_id, body) values ($1, $2, 'x')`, [ids.ped026, ids.almeidaUsr])).then(
    () => { throw new Error('aceitou insert direto') }, (e) => { if (!/row-level security/.test(e.message)) throw e })
  await como(ids.lucas, (tx) => tx.query(`update partner_requests set status = 'OPEN' where id = $1`, [ids.ped026])).then(
    () => { throw new Error('reabriu') }, (e) => { if (!/não muda de situação/.test(e.message)) throw e })
})
await deveFalhar('caso da solicitação não muda depois de criada', () => como(ids.lucas, async (tx) => {
  const r = (await um(tx, `insert into partner_requests (partner_organization_id, legal_case_id, type, title) values ($1, $2, 'GENERAL', 'x') returning id`, [ids.almeida, ids.casoA])).id
  await tx.query(`update partner_requests set legal_case_id = $2 where id = $1`, [r, ids.casoB])
}), /não mudam/)

secao('Backend: deadline_status [026]')
await deve('a view traz responsável e indica prazo de caso/processo excluído', async () => {
  const r = await linhas(db, `select responsible_user_id, scope_deleted from deadline_status limit 1`)
  if (!r.length) throw new Error('sem prazos no cenário')
  igual(typeof r[0].scope_deleted, 'boolean', 'scope_deleted')
})

secao('Hardening: idempotência genérica — caso [027]')
const caso027 = (title = 'Caso 027') => ({ client_id: ids.joao, legal_area_id: ids.banking, title, origin_organization_id: ids.owner, status: 'DRAFT' })
const criarCaso = (uid, key, c, internal = null) => como(uid, async (tx) =>
  (await um(tx, `select public.create_legal_case_once($1, $2, $3) r`, [key, JSON.stringify(c), internal && JSON.stringify(internal)])).r)
await deve('mesma chave + mesmo pedido: um único caso; repetir (retry após timeout) devolve o original', async () => {
  const k = randomUUID()
  const a = await criarCaso(ids.lucas, k, caso027(), { internal_notes: 'nota' })
  const b = await criarCaso(ids.lucas, k, caso027(), { internal_notes: 'nota' })
  igual([a.deduplicated, b.deduplicated, b.legal_case_id], [false, true, a.legal_case_id], 'idempotência')
  igual((await um(db, `select count(*)::int n from legal_cases where title = 'Caso 027'`)).n, 1, 'casos')
  igual((await um(db, `select internal_notes from legal_case_internal_details where legal_case_id = $1`, [a.legal_case_id])).internal_notes, 'nota', 'nota interna na mesma transação')
})
await deveFalhar('mesma chave + pedido diferente: conflito (nunca reaproveita calado)', async () => {
  const k = randomUUID()
  await criarCaso(ids.lucas, k, caso027('Caso 027 A'))
  await criarCaso(ids.lucas, k, caso027('Caso 027 B'))
}, /já foi usada com outros dados/)
await deve('chaves diferentes com dados idênticos: dois casos (registros legítimos parecidos)', async () => {
  const a = await criarCaso(ids.lucas, randomUUID(), caso027('Caso 027 gêmeo'))
  const b = await criarCaso(ids.lucas, randomUUID(), caso027('Caso 027 gêmeo'))
  igual(a.legal_case_id === b.legal_case_id, false, 'ids distintos')
})
await deve('a mesma chave usada por outro usuário é outro escopo', async () => {
  const k = randomUUID()
  const a = await criarCaso(ids.lucas, k, caso027('Caso 027 escopo'))
  const b = await criarCaso(ids.barbara, k, caso027('Caso 027 escopo'))
  igual(a.legal_case_id === b.legal_case_id, false, 'por usuário')
})
await deve('falha na criação desfaz a chave (nova tentativa com a mesma chave funciona)', async () => {
  const k = randomUUID()
  await criarCaso(ids.lucas, k, { ...caso027(), title: '  ' }).then(() => { throw new Error('aceitou título vazio') }, () => {})
  const r = await criarCaso(ids.lucas, k, { ...caso027(), title: '  ' }).catch((e) => e)
  if (!(r instanceof Error)) throw new Error('aceitou')
  if (/já foi usada|não terminou/.test(r.message)) throw new Error('chave ficou presa após falha')
})
await deveFalhar('a RLS de legal_cases continua valendo (parceiro não cria caso de cliente sem relacionamento)', () =>
  criarCaso(ids.almeidaAdm, randomUUID(), { ...caso027(), client_id: ids.cli025, partner_organization_id: ids.almeida }), /row-level security/)
await deve('portal: mesma chave devolve o mesmo envio (cliente + caso), sem duplicar', async () => {
  const k = randomUUID()
  const cli = { document: '999.027.000-01', kind: 'INDIVIDUAL', origin_organization_id: ids.almeida, full_name: 'Cliente 027' }
  const kase = { legal_area_id: ids.banking, title: 'Caso portal 027', origin_organization_id: ids.almeida }
  const enviar = () => como(ids.almeidaAdm, async (tx) => (await um(tx, `select public.partner_submit_case_once($1, $2, $3) r`, [k, JSON.stringify(cli), JSON.stringify(kase)])).r)
  const a = await enviar()
  const b = await enviar()
  igual([a.deduplicated, b.deduplicated, b.legal_case_id, b.client_id], [false, true, a.legal_case_id, a.client_id], 'idempotência')
  igual((await um(db, `select count(*)::int n from legal_cases where title = 'Caso portal 027'`)).n, 1, 'casos')
})

secao('Hardening: idempotência genérica — processo [027]')
const cnj027 = (n) => { const base = `${String(n).padStart(7, '0')}`; const rest = '20268260100'; const dd = 98n - (BigInt(`${base}${rest}00`) % 97n); return `${base}${String(dd).padStart(2, '0')}${rest}` }
const criarProc = (uid, key, p, internal = null, deadline = null) => como(uid, async (tx) =>
  (await um(tx, `select public.create_legal_process_once($1, $2, $3, $4) r`, [key, JSON.stringify(p), internal && JSON.stringify(internal), deadline && JSON.stringify(deadline)])).r)
await deve('processo + dados internos + prazo inicial numa transação; mesma chave devolve o mesmo', async () => {
  const k = randomUUID()
  const p = { legal_case_id: ids.casoA, title: 'Processo 027', cnj_number: cnj027(27001) }
  const d = { title: 'Prazo inicial', due_at: '2026-12-01T23:59:59-03:00' }
  const a = await criarProc(ids.lucas, k, p, { notes: 'nota do processo' }, d)
  const b = await criarProc(ids.lucas, k, p, { notes: 'nota do processo' }, d)
  igual([a.deduplicated, b.deduplicated, b.legal_process_id, b.deadline_id], [false, true, a.legal_process_id, a.deadline_id], 'idempotência')
  igual((await um(db, `select count(*)::int n from legal_processes where title = 'Processo 027'`)).n, 1, 'processos')
  igual((await um(db, `select notes from legal_process_internal_details where legal_process_id = $1`, [a.legal_process_id])).notes, 'nota do processo', 'internos')
  igual((await um(db, `select count(*)::int n from deadlines where legal_process_id = $1`, [a.legal_process_id])).n, 1, 'prazo')
})
await deve('processo sem CNJ também é idempotente (não depende do CNJ)', async () => {
  const k = randomUUID()
  const a = await criarProc(ids.lucas, k, { legal_case_id: ids.casoA, title: 'Processo 027 sem CNJ' })
  const b = await criarProc(ids.lucas, k, { legal_case_id: ids.casoA, title: 'Processo 027 sem CNJ' })
  igual(b.legal_process_id, a.legal_process_id, 'mesmo processo')
})
await deveFalhar('mesma chave + processo diferente: conflito', async () => {
  const k = randomUUID()
  await criarProc(ids.lucas, k, { legal_case_id: ids.casoA, title: 'Processo 027 X' })
  await criarProc(ids.lucas, k, { legal_case_id: ids.casoA, title: 'Processo 027 Y' })
}, /já foi usada com outros dados/)
await deve('falha no prazo inicial desfaz o processo (atômico)', async () => {
  await criarProc(ids.lucas, randomUUID(), { legal_case_id: ids.casoA, title: 'Processo 027 atômico' }, null, { title: 'sem data' }).then(
    () => { throw new Error('aceitou prazo sem data') }, () => {})
  igual((await um(db, `select count(*)::int n from legal_processes where title = 'Processo 027 atômico'`)).n, 0, 'processo desfeito')
})
await deve('parceiro: campos internos ignorados mesmo chamando a RPC direto', async () => {
  const r = await criarProc(ids.almeidaAdm, randomUUID(), { legal_case_id: ids.casoA, title: 'Processo 027 parceiro', status: 'ACTIVE', responsible_user_id: ids.lucas })
  const p = await um(db, `select status, responsible_user_id, technical_origin from legal_processes where id = $1`, [r.legal_process_id])
  igual([p.status, p.responsible_user_id, p.technical_origin], ['PREPARING', null, 'MANUAL'], 'defaults')
})
await deveFalhar('parceiro não cria processo em caso de outro parceiro', () =>
  criarProc(ids.ferreiraAdm, randomUUID(), { legal_case_id: ids.casoA, title: 'X' }), /row-level security/)

secao('Hardening: tabela de idempotência fora do alcance [027]')
await deveFalhar('usuário logado não lê a tabela de idempotência', () => como(ids.barbara, (tx) =>
  tx.query(`select 1 from private.idempotency_operations`)), /permission denied/)
await deveFalhar('service role também não', () => comoServico((tx) =>
  tx.query(`select 1 from private.idempotency_operations`)), /permission denied/)
await deve('hash do pedido não contém o CPF em claro', async () => {
  const r = await um(db, `select request_hash from private.idempotency_operations where operation = 'partner_case.submit' order by created_at desc limit 1`)
  if (!/^[0-9a-f]{64}$/.test(r.request_hash) || r.request_hash.includes('99902700001')) throw new Error('hash inesperado')
})

secao('Hardening: divisão do parceiro [027]')
await deve('PARTNER_ADMIN A lê a própria divisão (só os campos permitidos)', () => como(ids.almeidaAdm, async (tx) => {
  const r = (await um(tx, `select public.get_my_partner_settings() r`)).r
  igual(Object.keys(r).sort(), ['activated_at', 'organization_id', 'organization_name', 'owner_percentage', 'partner_percentage'], 'campos')
  igual(r.organization_id, ids.almeida, 'organização')
}))
await deve('PARTNER_ADMIN B lê a de B (nunca a de A)', () => como(ids.ferreiraAdm, async (tx) =>
  igual((await um(tx, `select public.get_my_partner_settings() r`)).r.organization_id, ids.ferreira, 'organização')))
await deveFalhar('PARTNER_USER não lê (financeiro)', () => como(ids.almeidaUsr, (tx) =>
  tx.query(`select public.get_my_partner_settings()`)), /administrador do parceiro/)
await deveFalhar('equipe interna usa o fluxo interno, não esta RPC', () => como(ids.barbara, (tx) =>
  tx.query(`select public.get_my_partner_settings()`)), /administrador do parceiro/)
await deveFalhar('parceiro continua sem SELECT em partner_office_settings', async () => {
  const r = await como(ids.almeidaAdm, (tx) => linhas(tx, `select 1 from partner_office_settings`))
  if (r.length === 0) throw new Error('vazio (esperado)')
})

secao('Idempotência: determinismo do request_hash [027]')
// O hash é calculado NO BANCO sobre jsonb, que normaliza o objeto (ordena as
// chaves, descarta espaços e chaves duplicadas). Estes testes provam que a
// ordem das propriedades não muda o resultado — no topo e aninhada.
const hashDe = (op, key) => um(db, `select request_hash h from private.idempotency_operations where operation = $1 and idempotency_key = $2`, [op, key])
await deve('mesma chave + mesmo conteúdo com chaves em OUTRA ORDEM: mesmo hash e deduplicação', async () => {
  const k = randomUUID()
  const a = await como(ids.lucas, async (tx) => (await um(tx, `select public.create_legal_case_once($1, $2::jsonb, $3::jsonb) r`, [k,
    `{"client_id":"${ids.joao}","legal_area_id":"${ids.banking}","title":"Caso ordem","origin_organization_id":"${ids.owner}","status":"DRAFT"}`,
    `{"internal_notes":"nota"}`])).r)
  const h1 = (await hashDe('legal_case.create', k)).h
  const b = await como(ids.lucas, async (tx) => (await um(tx, `select public.create_legal_case_once($1, $2::jsonb, $3::jsonb) r`, [k,
    `{ "status": "DRAFT", "origin_organization_id": "${ids.owner}",  "title": "Caso ordem", "legal_area_id": "${ids.banking}", "client_id": "${ids.joao}" }`,
    `{"internal_notes":"nota"}`])).r)
  igual([b.deduplicated, b.legal_case_id], [true, a.legal_case_id], 'deduplicou')
  igual((await hashDe('legal_case.create', k)).h, h1, 'mesmo hash')
})
await deve('objetos ANINHADOS em outra ordem (cliente + endereço do portal): deduplica', async () => {
  const k = randomUUID()
  const enviar = (cli, kase) => como(ids.almeidaAdm, async (tx) => (await um(tx, `select public.partner_submit_case_once($1, $2::jsonb, $3::jsonb) r`, [k, cli, kase])).r)
  const a = await enviar(
    `{"document":"99902800001","kind":"INDIVIDUAL","origin_organization_id":"${ids.almeida}","full_name":"Ordem Aninhada","address":{"city":"Santos","state":"SP","postal_code":"11010000"}}`,
    `{"legal_area_id":"${ids.banking}","title":"Caso aninhado","origin_organization_id":"${ids.almeida}"}`)
  const b = await enviar(
    `{"address":{"postal_code":"11010000","state":"SP","city":"Santos"},"full_name":"Ordem Aninhada","origin_organization_id":"${ids.almeida}","kind":"INDIVIDUAL","document":"99902800001"}`,
    `{"origin_organization_id":"${ids.almeida}","title":"Caso aninhado","legal_area_id":"${ids.banking}"}`)
  igual([b.deduplicated, b.legal_case_id], [true, a.legal_case_id], 'deduplicou')
})
await deve('controle: mesma chave + conteúdo REALMENTE diferente → conflito', async () => {
  const k = randomUUID()
  await criarCaso(ids.lucas, k, caso027('Caso controle A'))
  const e = await criarCaso(ids.lucas, k, caso027('Caso controle B')).catch((x) => x)
  if (!/já foi usada com outros dados/.test(e?.message ?? '')) throw new Error(`esperava conflito, veio ${e?.message ?? 'sucesso'}`)
})
await deve('representação jsonb: ordem de chaves e espaços não importam; ordem de array, null × ausente, escala decimal e forma Unicode importam', async () => {
  const igualJ = async (x, y) => (await um(db, `select ($1::jsonb)::text = ($2::jsonb)::text v`, [x, y])).v
  igual(await igualJ('{"b":1,"a":{"d":2,"c":3}}', '{ "a": {"c":3,"d":2}, "b":1 }'), true, 'ordem/aninhado/espaços')
  igual(await igualJ('{"a":[1,2]}', '{"a":[2,1]}'), false, 'ordem de array é conteúdo')
  igual(await igualJ('{"a":null}', '{}'), false, 'null ≠ ausente')
  igual(await igualJ('{"v":1234.5}', '{"v":1234.50}'), false, 'escala decimal preservada')
  igual(await igualJ('{"d":"2026-12-01T23:59:59-03:00"}', '{"d":"2026-12-01T23:59:59-03:00"}'), true, 'data como texto')
  igual(await igualJ(JSON.stringify({ n: 'José' }), JSON.stringify({ n: 'José' })), false, 'NFC ≠ NFD')
})

secao('Bloco societário de Cliente PJ: substituição atômica [028]')
const trocar = (uid, cliente, reps, socios) => como(uid, async (tx) =>
  (await um(tx, `select public.replace_company_people($1, $2, $3) r`, [cliente, JSON.stringify(reps), JSON.stringify(socios)])).r)
const quadro = async (cliente) => ({
  reps: await linhas(db, `select id, full_name, cpf, role_title, primary_representative p from company_representatives where client_id = $1 order by full_name`, [cliente]),
  socios: await linhas(db, `select id, name, document_number, share_percentage::text pct from company_shareholders where client_id = $1 order by name`, [cliente]),
})
const comoItem = (r) => ({ id: r.id, name: r.full_name, cpf: r.cpf, role: r.role_title, is_primary: r.p })
const socioItem = (s) => ({ id: s.id, name: s.name, document: s.document_number, share_percentage: s.pct })
await deve('cenário: PJ com 2 representantes e 3 sócios (cadastro)', async () => {
  ids.pj028 = await salvar(ids.ana, null, {
    kind: 'COMPANY', document: '99.028.000/0001-00', origin_organization_id: ids.owner, legal_name: 'Empresa 028 Ltda',
    representatives: [
      { name: 'Rep Um', cpf: '999.028.001-01', role: 'Diretor', is_primary: true },
      { name: 'Rep Dois', cpf: '999.028.002-02', role: 'Procurador', is_primary: false },
    ],
    shareholders: [
      { name: 'Sócio A', document: '99902800011', share_percentage: 40 },
      { name: 'Sócio B', document: '99902800012', share_percentage: 30 },
      { name: 'Sócio C', document: '99902800013', share_percentage: 30 },
    ],
  })
  const q = await quadro(ids.pj028)
  igual([q.reps.length, q.socios.length], [2, 3], 'quadro inicial')
})
await deve('ADMIN edita representantes: renomeia, troca o principal e adiciona um novo', async () => {
  const antes = await quadro(ids.pj028)
  const um1 = antes.reps.find((x) => x.full_name === 'Rep Um')
  const dois = antes.reps.find((x) => x.full_name === 'Rep Dois')
  const r = await trocar(ids.barbara, ids.pj028, [
    { ...comoItem(um1), is_primary: false },
    { ...comoItem(dois), name: 'Rep Dois Renomeado', is_primary: true },
    { name: 'Rep Três', cpf: '999.028.003-03', role: 'Gerente', is_primary: false },
  ], antes.socios.map(socioItem))
  igual(r.representatives, { added: 1, removed: 0, updated: 2 }, 'contagem')
  const q = await quadro(ids.pj028)
  igual(q.reps.map((x) => [x.full_name, x.p]), [['Rep Dois Renomeado', true], ['Rep Três', false], ['Rep Um', false]], 'representantes')
  igual(q.reps.find((x) => x.full_name === 'Rep Um').id, um1.id, 'linha existente mantém o id')
})
await deve('ADMIN edita sócios: 3 → 2 (um removido, um alterado) atomicamente', async () => {
  const antes = await quadro(ids.pj028)
  const [a, b] = antes.socios
  const r = await trocar(ids.barbara, ids.pj028, antes.reps.map(comoItem), [{ ...socioItem(a), share_percentage: 60 }, socioItem(b)])
  igual(r.shareholders, { added: 0, removed: 1, updated: 1 }, 'contagem')
  igual((await quadro(ids.pj028)).socios.map((s) => [s.name, Number(s.pct)]), [['Sócio A', 60], ['Sócio B', 30]], 'sócios')
})
await deve('LAWYER e ASSISTANT seguem a matriz (clients.edit): podem alterar', async () => {
  let q = await quadro(ids.pj028)
  await trocar(ids.lucas, ids.pj028, q.reps.map(comoItem), [...q.socios.map(socioItem), { name: 'Sócio D', document: '', share_percentage: '' }])
  q = await quadro(ids.pj028)
  igual(q.socios.length, 3, 'LAWYER adicionou')
  await trocar(ids.ana, ids.pj028, q.reps.map(comoItem), q.socios.filter((s) => s.name !== 'Sócio D').map(socioItem))
  igual((await quadro(ids.pj028)).socios.length, 2, 'ASSISTANT removeu')
})
await deve('mesma lista de novo: nada muda e nada é auditado', async () => {
  const q = await quadro(ids.pj028)
  const n = (await um(db, `select count(*)::int n from audit_events where entity_id = $1 and action = 'COMPANY_PEOPLE_REPLACED'`, [ids.pj028])).n
  const r = await trocar(ids.barbara, ids.pj028, q.reps.map(comoItem), q.socios.map(socioItem))
  igual(r, { shareholders: { added: 0, removed: 0, updated: 0 }, representatives: { added: 0, removed: 0, updated: 0 } }, 'contagem')
  igual((await um(db, `select count(*)::int n from audit_events where entity_id = $1 and action = 'COMPANY_PEOPLE_REPLACED'`, [ids.pj028])).n, n, 'sem evento')
})
await deve('payload parcialmente inválido (CPF ruim no 3º item): nada é removido nem gravado', async () => {
  const antes = await quadro(ids.pj028)
  let falhou = false
  try {
    await trocar(ids.barbara, ids.pj028, [comoItem(antes.reps[0]), { name: 'Novo Válido', is_primary: false }, { name: 'CPF Ruim', cpf: '123', is_primary: false }].map((x, i) => ({ ...x, is_primary: i === 0 })), [])
  } catch { falhou = true }
  igual(falhou, true, 'recusado')
  igual(await quadro(ids.pj028), antes, 'quadro intacto')
})
await deve('sócio com documento inválido no fim da lista: nenhuma atualização parcial', async () => {
  const antes = await quadro(ids.pj028)
  let falhou = false
  try {
    await trocar(ids.barbara, ids.pj028, antes.reps.map(comoItem), [{ ...socioItem(antes.socios[0]), name: 'Mudou' }, { name: 'Doc Ruim', document: '123' }])
  } catch { falhou = true }
  igual(falhou, true, 'recusado')
  igual(await quadro(ids.pj028), antes, 'quadro intacto')
})
await deveFalhar('dois representantes principais são recusados', async () => {
  const q = await quadro(ids.pj028)
  await trocar(ids.barbara, ids.pj028, q.reps.map((r) => ({ ...comoItem(r), is_primary: true })), q.socios.map(socioItem))
}, /exatamente um representante/)
await deveFalhar('cliente PF recusa a operação', () => trocar(ids.barbara, ids.joao, [], []), /só para pessoa jurídica/)
await deveFalhar('parceiro não altera o bloco societário (dado interno)', () => trocar(ids.almeidaAdm, ids.pj028, [], []), /Somente a equipe interna/)
await deveFalhar('parceiro não altera nem PJ com que tem relacionamento', () => trocar(ids.almeidaAdm, ids.empresa, [], []), /Somente a equipe interna/)
await deveFalhar('sessão sem MFA (aal1) é recusada', () => comoAal1(ids.barbara, (tx) =>
  tx.query(`select public.replace_company_people($1, '[]', '[]')`, [ids.pj028])), /Somente a equipe interna/)
await deveFalhar('cliente inexistente → não encontrado', () => trocar(ids.barbara, randomUUID(), [], []), /não encontrado/)
await deve('IDOR: id de representante de OUTRO cliente é recusado e nada muda nos dois', async () => {
  const alheio = await um(db, `insert into company_representatives (client_id, full_name, primary_representative) values ($1, 'Rep Alheio', true) returning id`, [ids.empresa])
  const antes = [await quadro(ids.pj028), await quadro(ids.empresa)]
  let erroMsg = ''
  try {
    const q = antes[0]
    await trocar(ids.barbara, ids.pj028, [...q.reps.map((r) => ({ ...comoItem(r), is_primary: false })), { id: alheio.id, name: 'Sequestro', is_primary: true }], q.socios.map(socioItem))
  } catch (e) { erroMsg = e.message }
  if (!/não pertence a este cliente/.test(erroMsg)) throw new Error(`esperava recusa, veio "${erroMsg}"`)
  igual([await quadro(ids.pj028), await quadro(ids.empresa)], antes, 'intactos')
})
await deve('auditoria: resumo com contagens, ator e request_id; sem nome nem CPF no metadata', async () => {
  const q = await quadro(ids.pj028)
  return como(ids.barbara, async (tx) => {
  const rid = randomUUID()
  await tx.query(`select set_config('request.headers', $1, true)`, [JSON.stringify({ 'x-dg-request-id': rid })])
  await tx.query(`select public.dg_pre_request()`)
  await tx.query(`select public.replace_company_people($1, $2, $3)`, [ids.pj028,
    JSON.stringify([...q.reps.map(comoItem), { name: 'Rep Auditado', cpf: '999.028.009-09', is_primary: false }]), JSON.stringify(q.socios.map(socioItem))])
  const ev = await um(tx, `select actor_user_id, actor_organization_id, request_id, metadata, created_at from audit_events
    where entity_id = $1 and action = 'COMPANY_PEOPLE_REPLACED' order by created_at desc limit 1`, [ids.pj028])
  igual([ev.actor_user_id, ev.actor_organization_id, ev.request_id], [ids.barbara, ids.owner, rid], 'ator e correlação')
  igual([ev.metadata.representatives.added, ev.metadata.representatives.updated, ev.metadata.representatives.removed, ev.metadata.representatives.total],
    [1, 0, 0, q.reps.length + 1], 'contagens')
  const todos = JSON.stringify(await linhas(tx, `select metadata from audit_events where entity_id = $1 and request_id = $2`, [ids.pj028, rid]))
  if (/Rep Auditado|99902800909|999\.028/.test(todos)) throw new Error('PII no metadata de auditoria')
  })
})
await deve('remover um sócio e adicionar um representante numa chamada; list "atualizado" muda', async () => {
  const antes = await um(db, `select updated_at from clients where id = $1`, [ids.pj028])
  const q = await quadro(ids.pj028)
  const r = await trocar(ids.barbara, ids.pj028, [...q.reps.map(comoItem), { name: 'Rep Novo', is_primary: false }], q.socios.slice(1).map(socioItem))
  igual([r.representatives.added, r.shareholders.removed], [1, 1], 'contagem')
  const depois = await um(db, `select updated_at from clients where id = $1`, [ids.pj028])
  if (!(new Date(depois.updated_at) >= new Date(antes.updated_at))) throw new Error('updated_at não avançou')
})
await deveFalhar('a API não ganhou DELETE direto nas tabelas (só pela operação)', () =>
  como(ids.barbara, (tx) => tx.query(`delete from company_shareholders where client_id = $1`, [ids.pj028])), /permission denied/)
await deveFalhar('…nem em representantes', () =>
  como(ids.barbara, (tx) => tx.query(`delete from company_representatives where client_id = $1`, [ids.pj028])), /permission denied/)

secao('Cliente PF: apagar data de nascimento, gênero, estado civil e documento de identidade [025, sem migration]')
const pfCampos = (id) => um(db, `select birth_date::text, gender, marital_status, identity_document_type t, identity_document_number n,
    identity_document_issuer i, identity_document_state::text uf, profession from individual_client_details where client_id = $1`, [id])
await deve('cenário: PF com os quatro campos preenchidos', async () => {
  ids.pfLimpa = await salvar(ids.ana, null, {
    kind: 'INDIVIDUAL', document: '999.029.000-01', origin_organization_id: ids.owner, full_name: 'PF Limpeza',
    birth_date: '1980-02-03', gender: 'MALE', marital_status: 'SINGLE', profession: 'Pedreiro',
    identity_document: { type: 'RG', number: '7654321', issuer: 'SSP', state: 'SP' },
  })
  const r = await pfCampos(ids.pfLimpa)
  igual([r.birth_date, r.gender, r.marital_status, r.t, r.n, r.uf], ['1980-02-03', 'MALE', 'SINGLE', 'RG', '7654321', 'SP'], 'preenchido')
})
await deve('chave ausente não mexe (outro campo alterado não apaga os quatro)', async () => {
  await salvar(ids.lucas, ids.pfLimpa, { profession: 'Mestre de obras' })
  const r = await pfCampos(ids.pfLimpa)
  igual([r.birth_date, r.gender, r.marital_status, r.t, r.profession], ['1980-02-03', 'MALE', 'SINGLE', 'RG', 'Mestre de obras'], 'intacto')
})
await deve('null apaga cada um (NULL, nunca string vazia)', async () => {
  await salvar(ids.lucas, ids.pfLimpa, { birth_date: null })
  igual((await pfCampos(ids.pfLimpa)).birth_date, null, 'data')
  await salvar(ids.lucas, ids.pfLimpa, { gender: null })
  igual((await pfCampos(ids.pfLimpa)).gender, null, 'gênero')
  await salvar(ids.ana, ids.pfLimpa, { marital_status: null })
  igual((await pfCampos(ids.pfLimpa)).marital_status, null, 'estado civil')
  await salvar(ids.barbara, ids.pfLimpa, { identity_document: null })
  const r = await pfCampos(ids.pfLimpa)
  igual([r.t, r.n, r.i, r.uf], [null, null, null, null], 'documento inteiro')
  const vazios = await um(db, `select count(*)::int n from individual_client_details where client_id = $1
    and ('' in (coalesce(gender, '-'), coalesce(marital_status, '-'), coalesce(identity_document_type, '-'), coalesce(identity_document_number, '-'))) `, [ids.pfLimpa])
  igual(vazios.n, 0, 'string vazia')
})
await deve('preencher de novo depois de apagar funciona', async () => {
  await salvar(ids.lucas, ids.pfLimpa, { birth_date: '1981-04-05', gender: 'OTHER', marital_status: 'MARRIED', identity_document: { type: 'CNH', number: '111222' } })
  const r = await pfCampos(ids.pfLimpa)
  igual([r.birth_date, r.gender, r.marital_status, r.t, r.n], ['1981-04-05', 'OTHER', 'MARRIED', 'CNH', '111222'], 'repreenchido')
})
await deveFalhar('documento pela metade (tipo sem número) é recusado', () =>
  salvar(ids.lucas, ids.pfLimpa, { identity_document: { type: 'RG' } }), /identity_complete|violates/)
await deveFalhar('parceiro não apaga dado de PF (só contato e endereço)', () =>
  salvar(ids.almeidaAdm, ids.joao, { birth_date: null }), /só altera contato e endereço/)
await deve('auditoria da limpeza: nomes de campo, sem data nem número de documento', async () => {
  await salvar(ids.lucas, ids.pfLimpa, { birth_date: null, identity_document: null })
  const ev = await linhas(db, `select metadata from audit_events where entity_id = $1 and action = 'CLIENT_UPDATED'
    and metadata ->> 'table' = 'individual_client_details' order by created_at desc limit 1`, [ids.pfLimpa])
  const fields = ev[0].metadata.fields
  if (!fields.includes('birth_date') || !fields.includes('identity_document_number')) throw new Error(`campos: ${fields}`)
  const tudo = JSON.stringify(await linhas(db, `select metadata from audit_events where entity_id = $1`, [ids.pfLimpa]))
  if (/1981-04-05|1980-02-03|111222|7654321/.test(tudo)) throw new Error('PII na auditoria')
})

secao('Análise jurídica: início atômico e idempotente [029]')
const iniciar = (uid, k, caso, template, campos = {}, enviar = false, pedido = null) => como(uid, async (tx) =>
  (await um(tx, `select public.start_legal_analysis_once($1, $2, $3, $4, $5, $6, $7) r`, [k, caso, template, JSON.stringify(campos), enviar, pedido,
    JSON.stringify({ request_id: randomUUID() })])).r)
const enviarAnalise = (uid, k, analise, pedido = null) => como(uid, async (tx) =>
  (await um(tx, `select public.send_legal_analysis_once($1, $2, $3) r`, [k, analise, pedido])).r)
const contar029 = async () => (await um(db, `select (select count(*)::int from legal_analyses) a, (select count(*)::int from agent_runs) r,
  (select count(*)::int from pgmq.q_agent_execution) f`))
await deve('cenário: template bancário COM agente (o do seed fica sem agente) e template de outra área', async () => {
  ids.tpl029 = (await um(db, `insert into analysis_templates (legal_area_id, name, primary_agent_id) values ($1, 'Template 029', $2) returning id`, [ids.banking, ids.agente])).id
  const outra = (await um(db, `select id from legal_areas where code <> 'BANKING' order by code limit 1`)).id
  ids.tpl029Outra = (await um(db, `insert into analysis_templates (legal_area_id, name, primary_agent_id) values ($1, 'Template 029 outra área', $2) returning id`, [outra, ids.agente])).id
})
await deve('LAWYER cria análise sem enviar: PENDING, sem execução; repetir a chave devolve a mesma', async () => {
  const k = randomUUID()
  const antes = await contar029()
  const r1 = await iniciar(ids.lucas, k, ids.casoA, ids.tpl029, { banco: 'Banco X' })
  const r2 = await iniciar(ids.lucas, k, ids.casoA, ids.tpl029, { banco: 'Banco X' })
  igual([r1.deduplicated, r2.deduplicated, r2.analysis_id === r1.analysis_id, r1.agent_run_id], [false, true, true, null], 'idempotente')
  const a = await um(db, `select status, field_values, started_by, agent_run_id from legal_analyses where id = $1`, [r1.analysis_id])
  igual([a.status, a.field_values.banco, a.started_by, a.agent_run_id], ['PENDING', 'Banco X', ids.lucas, null], 'análise')
  const depois = await contar029()
  igual([depois.a - antes.a, depois.r - antes.r], [1, 0], 'uma análise, nenhuma execução')
  ids.analise029 = r1.analysis_id
})
await deve('criar E enviar numa transação: análise QUEUED ligada a UMA execução enfileirada', async () => {
  const k = randomUUID()
  const antes = await contar029()
  const r = await iniciar(ids.barbara, k, ids.casoA, ids.tpl029, {}, true, 'Conferir descontos')
  const a = await um(db, `select status, agent_run_id, started_at from legal_analyses where id = $1`, [r.analysis_id])
  igual([a.status, a.agent_run_id, !!a.started_at], ['QUEUED', r.agent_run_id, true], 'análise ligada')
  const run = await um(db, `select status, legal_case_id, requested_by from agent_runs where id = $1`, [r.agent_run_id])
  igual([run.status, run.legal_case_id, run.requested_by], ['QUEUED', ids.casoA, ids.barbara], 'execução')
  const depois = await contar029()
  igual([depois.a - antes.a, depois.r - antes.r, depois.f - antes.f], [1, 1, 1], 'uma análise, uma execução, uma mensagem na fila')
  const again = await iniciar(ids.barbara, k, ids.casoA, ids.tpl029, {}, true, 'Conferir descontos')
  igual([again.deduplicated, again.analysis_id, again.agent_run_id], [true, r.analysis_id, r.agent_run_id], 'repetição devolve o mesmo par')
  igual((await contar029()).r, depois.r, 'repetição não enfileira de novo')
})
await deve('falha no envio desfaz TUDO: template sem agente não deixa análise nem execução nem chave', async () => {
  const k = randomUUID()
  const antes = await contar029()
  let msg = ''
  try { await iniciar(ids.lucas, k, ids.casoA, ids.template, {}, true) } catch (e) { msg = e.message }
  if (!/não tem agente configurado/.test(msg)) throw new Error(`esperava recusa, veio "${msg}"`)
  const depois = await contar029()
  igual([depois.a, depois.r, depois.f], [antes.a, antes.r, antes.f], 'nada gravado')
  const chave = await um(db, `select count(*)::int n from private.idempotency_operations where idempotency_key = $1`, [k])
  igual(chave.n, 0, 'chave liberada (pode tentar de novo)')
})
await deve('agente inativo no meio do envio: nada fica gravado (rollback da análise)', async () => {
  await db.query(`update agents set status = 'INACTIVE' where id = $1`, [ids.agente])
  const antes = await contar029()
  try {
    let falhou = false
    try { await iniciar(ids.lucas, randomUUID(), ids.casoA, ids.tpl029, {}, true) } catch { falhou = true }
    igual(falhou, true, 'recusado')
    const depois = await contar029()
    igual([depois.a, depois.r], [antes.a, antes.r], 'nada gravado')
  } finally {
    await db.query(`update agents set status = 'ACTIVE' where id = $1`, [ids.agente])
  }
})
await deveFalhar('mesma chave com outros dados = conflito (nunca reaproveita calado)', async () => {
  const k = randomUUID()
  await iniciar(ids.lucas, k, ids.casoA, ids.tpl029, { banco: 'A' })
  await iniciar(ids.lucas, k, ids.casoA, ids.tpl029, { banco: 'B' })
}, /já foi usada com outros dados/)
await deveFalhar('template de outra área é recusado', () => iniciar(ids.lucas, randomUUID(), ids.casoA, ids.tpl029Outra), /área jurídica/)
await deveFalhar('template inativo é recusado', async () => {
  await db.query(`update analysis_templates set active = false where id = $1`, [ids.tpl029Outra])
  await iniciar(ids.lucas, randomUUID(), ids.casoA, ids.tpl029Outra)
}, /indisponível/)
await deveFalhar('ASSISTANT não inicia análise', () => iniciar(ids.ana, randomUUID(), ids.casoA, ids.tpl029), /ADMIN ou advogado/)
await deveFalhar('parceiro não inicia análise', () => iniciar(ids.almeidaAdm, randomUUID(), ids.casoA, ids.tpl029), /ADMIN ou advogado/)
await deveFalhar('sessão sem MFA (aal1) não inicia análise', () => comoAal1(ids.lucas, (tx) =>
  tx.query(`select public.start_legal_analysis_once($1, $2, $3)`, [randomUUID(), ids.casoA, ids.tpl029])), /ADMIN ou advogado|sessão/i)
await deveFalhar('caso inexistente é recusado', () => iniciar(ids.lucas, randomUUID(), randomUUID(), ids.tpl029), /Caso não encontrado/)
await deve('correlação (request_id) muda a cada tentativa e não quebra a idempotência; vai para os parâmetros da execução', async () => {
  const k = randomUUID()
  const r1 = await iniciar(ids.lucas, k, ids.casoA, ids.tpl029, {}, true)
  const r2 = await iniciar(ids.lucas, k, ids.casoA, ids.tpl029, {}, true)
  igual([r2.deduplicated, r2.agent_run_id === r1.agent_run_id], [true, true], 'mesma execução')
  const p = await um(db, `select parameters from agent_run_inputs where agent_run_id = $1`, [r1.agent_run_id])
  igual(Object.keys(p.parameters), ['request_id'], 'só a correlação')
})
await deve('enviar análise existente: QUEUED + execução numa transação; repetir a chave não duplica', async () => {
  const k = randomUUID()
  const antes = await contar029()
  const r1 = await enviarAnalise(ids.lucas, k, ids.analise029, 'Pedido do advogado')
  const r2 = await enviarAnalise(ids.lucas, k, ids.analise029, 'Pedido do advogado')
  igual([r1.deduplicated, r2.deduplicated, r2.agent_run_id === r1.agent_run_id], [false, true, true], 'idempotente')
  const a = await um(db, `select status, agent_run_id from legal_analyses where id = $1`, [ids.analise029])
  igual([a.status, a.agent_run_id], ['QUEUED', r1.agent_run_id], 'ligada')
  const depois = await contar029()
  igual([depois.r - antes.r, depois.f - antes.f], [1, 1], 'uma execução e uma mensagem')
  const input = await um(db, `select request_text from agent_run_inputs where agent_run_id = $1`, [r1.agent_run_id])
  igual(input.request_text, 'Pedido do advogado', 'pedido fica em agent_run_inputs')
})
await deveFalhar('outra chave para a análise já enfileirada é recusada (nunca duas execuções)', () =>
  enviarAnalise(ids.barbara, randomUUID(), ids.analise029), /já está com o agente/)
await deve('análise FAILED pode ser reenviada (nova execução) e o motivo da interrupção é limpo', async () => {
  await db.query(`update legal_analyses set status = 'FAILED', interruption_reason = 'Erro simulado' where id = $1`, [ids.analise029])
  const r = await enviarAnalise(ids.lucas, randomUUID(), ids.analise029)
  const a = await um(db, `select status, agent_run_id, interruption_reason from legal_analyses where id = $1`, [ids.analise029])
  igual([a.status, a.agent_run_id, a.interruption_reason], ['QUEUED', r.agent_run_id, null], 'reenviada')
})
await deveFalhar('ASSISTANT não envia análise', () => enviarAnalise(ids.ana, randomUUID(), ids.analise029), /ADMIN ou advogado/)
await deveFalhar('parceiro não envia análise', () => enviarAnalise(ids.almeidaAdm, randomUUID(), ids.analise029), /ADMIN ou advogado/)
await deveFalhar('análise inexistente', () => enviarAnalise(ids.lucas, randomUUID(), randomUUID()), /não encontrada/)
await deve('auditoria na mesma transação: ANALYSIS_STARTED com a execução e o request_id, sem o texto do pedido', async () =>
  como(ids.barbara, async (tx) => {
    const rid = randomUUID()
    await tx.query(`select set_config('request.headers', $1, true)`, [JSON.stringify({ 'x-dg-request-id': rid })])
    await tx.query(`select public.dg_pre_request()`)
    const r = (await um(tx, `select public.start_legal_analysis_once($1, $2, $3, '{}', true, 'Texto sigiloso do pedido') r`, [randomUUID(), ids.casoA, ids.tpl029])).r
    const ev = await um(tx, `select action, actor_user_id, request_id, metadata from audit_events where entity_id = $1 and action = 'ANALYSIS_STARTED'`, [r.analysis_id])
    igual([ev.action, ev.actor_user_id, ev.request_id, ev.metadata.agent_run_id, ev.metadata.to], ['ANALYSIS_STARTED', ids.barbara, rid, r.agent_run_id, 'QUEUED'], 'evento')
    const run = await um(tx, `select count(*)::int n from audit_events where entity_id = $1 and request_id = $2`, [r.agent_run_id, rid])
    if (run.n < 1) throw new Error('execução sem auditoria na mesma requisição')
    const tudo = JSON.stringify(await linhas(tx, `select metadata from audit_events where request_id = $1`, [rid]))
    if (/Texto sigiloso/.test(tudo)) throw new Error('texto do pedido na auditoria')
  }))

secao('Acordo financeiro: ciclo de vida garantido no banco [030]')
const novoCaso030 = async (titulo) => (await um(db, `insert into legal_cases (client_id, legal_area_id, title, origin_organization_id, created_by_organization_id)
  values ($1, $2, $3, $4, $4) returning id`, [ids.joao, ids.banking, titulo, ids.owner])).id
const acordo030 = (uid, caso, status = 'DRAFT', termos = {}) => como(uid, async (tx) =>
  (await um(tx, `insert into financial_agreements (legal_case_id, status, fixed_fee, notes) values ($1, $2, $3, $4) returning id`,
    [caso, status, termos.fixed_fee ?? 1000, termos.notes ?? null])).id)
const situacao030 = (uid, id, status) => como(uid, (tx) => tx.query(`update financial_agreements set status = $2 where id = $1`, [id, status]))
const obrigacao030 = (uid, acordo, valor = 500) => como(uid, async (tx) =>
  (await um(tx, `insert into payments (financial_agreement_id, amount, payment_type) values ($1, $2, 'OTHER') returning id`, [acordo, valor])).id)
const entrada030 = (uid, pagamento, valor, kind = 'RECEIPT', original = null, notes = null) => como(uid, async (tx) =>
  (await um(tx, `insert into payment_receipts (payment_id, kind, amount, original_receipt_id, notes) values ($1, $2, $3, $4, $5) returning id`,
    [pagamento, kind, valor, original, notes])).id)
await deve('rascunho: termos mudam; ativar; depois os termos ficam congelados (observação ainda muda)', async () => {
  ids.caso030 = await novoCaso030('Caso 030')
  ids.fa030 = await acordo030(ids.barbara, ids.caso030)
  await como(ids.barbara, (tx) => tx.query(`update financial_agreements set fixed_fee = 1500, installments = 3 where id = $1`, [ids.fa030]))
  await situacao030(ids.barbara, ids.fa030, 'ACTIVE')
  await como(ids.barbara, (tx) => tx.query(`update financial_agreements set notes = 'Observação nova' where id = $1`, [ids.fa030]))
  const a = await um(db, `select status, fixed_fee::text f, installments, notes from financial_agreements where id = $1`, [ids.fa030])
  igual([a.status, a.f, a.installments, a.notes], ['ACTIVE', '1500.00', 3, 'Observação nova'], 'acordo')
})
await deveFalhar('termos de acordo ATIVO não mudam', () =>
  como(ids.barbara, (tx) => tx.query(`update financial_agreements set fixed_fee = 9999 where id = $1`, [ids.fa030])), /Só o rascunho/)
await deveFalhar('acordo não muda de caso', () =>
  como(ids.barbara, (tx) => tx.query(`update financial_agreements set legal_case_id = $2 where id = $1`, [ids.fa030, ids.casoI])), /não muda de caso/)
await deveFalhar('ATIVO não volta para rascunho', () => situacao030(ids.barbara, ids.fa030, 'DRAFT'), /não é permitida/)
await deveFalhar('acordo não nasce concluído', async () => acordo030(ids.barbara, await novoCaso030('Caso 030 concluído'), 'COMPLETED'), /rascunho ou ativo/)
await deve('LAWYER não opera acordo: a RLS nem mostra a linha (0 alteradas, nenhuma mensagem de regra)', async () => {
  const r = await como(ids.lucas, (tx) => tx.query(`update financial_agreements set status = 'COMPLETED' where id = $1`, [ids.fa030]))
  igual(r.affectedRows ?? 0, 0, 'linhas alteradas')
  igual((await um(db, `select status from financial_agreements where id = $1`, [ids.fa030])).status, 'ACTIVE', 'intacto')
})
await deve('concluir com obrigação em aberto é recusado; quitada, conclui; depois é histórico', async () => {
  const p = await obrigacao030(ids.barbara, ids.fa030, 800)
  let msg = ''
  try { await situacao030(ids.barbara, ids.fa030, 'COMPLETED') } catch (e) { msg = e.message }
  if (!/obrigações em aberto/.test(msg)) throw new Error(`esperava recusa, veio "${msg}"`)
  if (/800/.test(msg)) throw new Error('valor na mensagem de erro')
  await entrada030(ids.barbara, p, 800)
  await situacao030(ids.barbara, ids.fa030, 'COMPLETED')
  igual((await um(db, `select status from financial_agreements where id = $1`, [ids.fa030])).status, 'COMPLETED', 'concluído')
  ids.p030 = p
})
await deveFalhar('acordo concluído não muda (nem observação)', () =>
  como(ids.barbara, (tx) => tx.query(`update financial_agreements set notes = 'x' where id = $1`, [ids.fa030])), /histórico/)
await deveFalhar('acordo concluído não recebe obrigação nova', () => obrigacao030(ids.barbara, ids.fa030), /não recebe nem altera obrigações/)
await deveFalhar('obrigação de acordo concluído não muda', () =>
  como(ids.barbara, (tx) => tx.query(`update payments set description = 'x' where id = $1`, [ids.p030])), /não recebe nem altera obrigações/)
await deve('estorno (correção) vale mesmo com o acordo concluído', async () => {
  const original = (await um(db, `select id from payment_receipts where payment_id = $1 and kind = 'RECEIPT'`, [ids.p030])).id
  await entrada030(ids.barbara, ids.p030, -100, 'REVERSAL', original)
  igual((await um(db, `select sum(amount)::text s from payment_receipts where payment_id = $1`, [ids.p030])).s, '700.00', 'líquido')
})
await deveFalhar('…mas entrada nova em acordo concluído é recusada', () => entrada030(ids.barbara, ids.p030, 100), /Ative o acordo/)
await deve('rascunho: aceita obrigação, recusa entrada; cancelar com obrigação aberta é recusado; cancelada a obrigação, cancela', async () => {
  const fa = await acordo030(ids.barbara, await novoCaso030('Caso 030 rascunho'))
  const p = await obrigacao030(ids.barbara, fa, 300)
  let msg = ''
  try { await entrada030(ids.barbara, p, 300) } catch (e) { msg = e.message }
  if (!/Ative o acordo/.test(msg)) throw new Error(`esperava recusa da entrada, veio "${msg}"`)
  msg = ''
  try { await situacao030(ids.barbara, fa, 'CANCELLED') } catch (e) { msg = e.message }
  if (!/obrigações em aberto/.test(msg)) throw new Error(`esperava recusa do cancelamento, veio "${msg}"`)
  await como(ids.barbara, (tx) => tx.query(`update payments set cancelled_at = now(), cancellation_reason = 'Lançada por engano' where id = $1`, [p]))
  await situacao030(ids.barbara, fa, 'CANCELLED')
  igual((await um(db, `select status from financial_agreements where id = $1`, [fa])).status, 'CANCELLED', 'cancelado')
})
await deveFalhar('cancelado não volta a ativo', async () => {
  const fa = await acordo030(ids.barbara, await novoCaso030('Caso 030 cancelado'))
  await situacao030(ids.barbara, fa, 'CANCELLED')
  await situacao030(ids.barbara, fa, 'ACTIVE')
}, /histórico/)
await deve('auditoria: mudança de situação do acordo fica registrada (sem valores)', async () => {
  const ev = await linhas(db, `select action, metadata from audit_events where entity_id = $1 order by created_at`, [ids.fa030])
  if (ev.length < 3) throw new Error(`eventos: ${ev.length}`)
})

secao('Execuções de agente: resumos paginados [031]')
const pagina031 = (uid, { caso = null, status = null, agente = null, offset = 0, limit = 25 } = {}) => como(uid, (tx) =>
  linhas(tx, `select * from public.get_agent_run_summaries_page($1, $2, $3, $4, $5)`, [caso, status, agente, offset, limit]))
await deve('ADMIN pagina todas: total em todas as linhas, mais recentes primeiro, páginas sem sobreposição', async () => {
  const todas = await pagina031(ids.barbara, { limit: 100 })
  const total = Number(todas[0].total_count)
  igual(todas.length, Math.min(total, 100), 'página cheia')
  igual(todas.every((r) => Number(r.total_count) === total), true, 'total repetido')
  const ordenadas = [...todas].sort((a, b) => (b.created_at - a.created_at) || (b.id < a.id ? -1 : 1))
  igual(todas.map((r) => r.id), ordenadas.map((r) => r.id), 'ordem')
  const p1 = await pagina031(ids.barbara, { limit: 2 })
  const p2 = await pagina031(ids.barbara, { offset: 2, limit: 2 })
  igual(p1.some((r) => p2.some((s) => s.id === r.id)), false, 'sem sobreposição')
  igual([p1[0].id, p1[1].id, p2[0]?.id], [todas[0].id, todas[1].id, todas[2]?.id], 'páginas seguem a ordem')
})
await deve('filtros por caso, situação e agente; colunas fixas, sem dados técnicos', async () => {
  const doCaso = await pagina031(ids.barbara, { caso: ids.casoA, limit: 100 })
  igual(doCaso.every((r) => r.legal_case_id === ids.casoA), true, 'caso')
  const fila = await pagina031(ids.barbara, { status: 'QUEUED', limit: 100 })
  igual(fila.every((r) => r.status === 'QUEUED'), true, 'situação')
  const doAgente = await pagina031(ids.barbara, { agente: ids.agente, limit: 100 })
  igual(doAgente.every((r) => r.agent_id === ids.agente), true, 'agente')
  for (const k of ['metadata', 'input_tokens', 'estimated_cost', 'model', 'error_message', 'request_text'])
    if (doCaso[0] && k in doCaso[0]) throw new Error(`RPC expõe ${k}`)
})
await deve('LAWYER só vê execuções de casos que acessa (nunca as sem caso), com o total coerente', async () => {
  const r = await pagina031(ids.lucas, { limit: 100 })
  igual(r.some((x) => x.id === ids.runAdmin), false, 'sem caso escondida')
  igual(r.every((x) => x.legal_case_id !== null), true, 'todas com caso')
  if (r.length) igual(Number(r[0].total_count), r.length <= 100 ? Number(r[0].total_count) : 0, 'total')
})
await deve('limite é aparado em 1..100 e deslocamento negativo vira 0', async () => {
  igual((await pagina031(ids.barbara, { limit: 0 })).length <= 1, true, 'mínimo 1')
  igual((await pagina031(ids.barbara, { limit: 1000 })).length <= 100, true, 'máximo 100')
  igual((await pagina031(ids.barbara, { offset: -5, limit: 1 }))[0]?.id, (await pagina031(ids.barbara, { limit: 1 }))[0]?.id, 'offset negativo')
})
await deveFalhar('situação inválida é recusada', () => pagina031(ids.barbara, { status: 'QUALQUER' }), /Situação de execução inválida/)
await deveFalhar('ASSISTANT não lê execuções', () => pagina031(ids.ana), /só a ADMIN e LAWYER/)
await deveFalhar('parceiro não lê execuções', () => pagina031(ids.almeidaAdm), /só a ADMIN e LAWYER/)
await deveFalhar('LAWYER filtrando caso sem acesso é recusado', () => pagina031(ids.lucas, { caso: randomUUID() }), /Sem acesso/)
await deveFalhar('sessão aal1 não lê', () => comoAal1(ids.barbara, (tx) => tx.query(`select * from public.get_agent_run_summaries_page()`)), /duas etapas/)
await deve('anon não executa a função', async () => {
  await db.transaction(async (tx) => {
    await tx.query('set local role anon')
    await tx.query(`select * from public.get_agent_run_summaries_page()`)
  }).then(() => { throw new Error('anon leu execuções') }, (e) => { if (!/permission denied/.test(e.message)) throw e })
})
await deve('a função antiga continua igual (compatibilidade)', async () => {
  const r = await como(ids.barbara, (tx) => linhas(tx, `select * from public.get_agent_run_summaries(null, 5)`))
  igual(r.length <= 5 && !('total_count' in (r[0] ?? {})), true, 'antiga')
})

secao('RLS dos caminhos quentes do portal: mesmo acesso, calculado uma vez [032]')
// Critério ANTIGO (funções can_access_* por linha), avaliado como dono do banco
// com o JWT do usuário: é a referência que as políticas novas precisam igualar.
const criterio032 = {
  clients: `t.deleted_at is null and private.is_partner_user() and private.can_access_client(t.id)`,
  individual_client_details: `private.can_access_client(t.client_id)`,
  company_client_details: `private.can_access_client(t.client_id)`,
  company_representatives: `private.can_access_client(t.client_id)`,
  company_shareholders: `private.can_access_client(t.client_id)`,
  client_contacts: `private.can_access_client(t.client_id)`,
  client_addresses: `private.can_access_client(t.client_id)`,
  legal_processes: `t.deleted_at is null and private.is_partner_user() and private.can_access_case(t.legal_case_id)`,
  process_parties: `private.can_access_process(t.legal_process_id)`,
  process_events: `t.source in ('JUDICIAL_INTEGRATION', 'IMPORT', 'SYSTEM') and private.can_access_process(t.legal_process_id)`,
  case_document_requirements: `private.can_access_case(t.legal_case_id)`,
  documents: `t.visibility = 'PARTNER_VISIBLE' and private.is_partner_user() and private.can_access_document(t.id)`,
  document_versions: `private.can_access_document(t.document_id)`,
  case_documents: `private.can_access_case(t.legal_case_id) and private.can_access_document(t.document_id)`,
  process_documents: `private.can_access_process(t.legal_process_id) and private.can_access_document(t.document_id)`,
}
const referencia032 = (uid, tabela) => db.transaction(async (tx) => {
  await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated', aal: 'aal2' })])
  return (await linhas(tx, `select t::text k from public.${tabela} t where ${criterio032[tabela]} order by 1`)).map((r) => r.k)
})
const visto032 = (uid, tabela) => como(uid, async (tx) =>
  (await linhas(tx, `select t::text k from public.${tabela} t order by 1`)).map((r) => r.k))
for (const [nome, uid] of [['PARTNER_ADMIN Almeida', ids.almeidaAdm], ['PARTNER_USER Almeida', ids.almeidaUsr], ['PARTNER_ADMIN Ferreira', ids.ferreiraAdm]]) {
  await deve(`${nome}: cada tabela devolve exatamente as linhas do critério antigo`, async () => {
    let algum = 0
    for (const tabela of Object.keys(criterio032)) {
      const [ref, real] = await Promise.all([referencia032(uid, tabela), visto032(uid, tabela)])
      igual(real.length, ref.length, `${tabela} (quantidade)`)
      igual(real, ref, tabela)
      algum += real.length
    }
    if (algum === 0) throw new Error('cenário sem nenhuma linha visível ao parceiro: o teste não provaria nada')
  })
}
await deve('internos (ADMIN e ASSISTANT) continuam lendo todas as linhas', async () => {
  for (const uid of [ids.barbara, ids.ana])
    for (const tabela of Object.keys(criterio032)) {
      const total = (await um(db, `select count(*)::int n from public.${tabela}`)).n
      igual((await como(uid, (tx) => um(tx, `select count(*)::int n from public.${tabela}`))).n, total, tabela)
    }
})
await deve('sessão aal1 e usuário sem vínculo não leem nada', async () => {
  const semVinculo = (await um(db, `insert into auth.users (email) values ('sem-vinculo-032@exemplo.com') returning id`)).id
  for (const tabela of ['clients', 'documents', 'legal_processes']) {
    igual((await como(semVinculo, (tx) => um(tx, `select count(*)::int n from public.${tabela}`))).n, 0, `${tabela} sem vínculo`)
    igual((await comoAal1(ids.almeidaAdm, (tx) => um(tx, `select count(*)::int n from public.${tabela}`))).n, 0, `${tabela} aal1`)
  }
})
await deve('funções do conjunto: sem parâmetro (escopo só da sessão) e fora do alcance de anon', async () => {
  for (const f of ['partner_client_ids', 'partner_case_ids', 'partner_process_ids', 'partner_document_ids']) {
    const p = await um(db, `select pronargs, prosecdef from pg_proc where proname = $1 and pronamespace = 'private'::regnamespace`, [f])
    igual([p.pronargs, p.prosecdef], [0, true], f)
    await db.transaction(async (tx) => {
      await tx.query('set local role anon')
      await tx.query(`select private.${f}()`)
    }).then(() => { throw new Error(`anon executou ${f}`) }, (e) => { if (!/permission denied/.test(e.message)) throw e })
  }
})
await deve('volume: 3.000 clientes de outro escritório não pesam na carteira do parceiro', async () => {
  await db.query(`
    with novos as (
      insert into clients (kind, cpf, origin_organization_id)
      select 'INDIVIDUAL', lpad((88000000000 + g)::text, 11, '0'), $1 from generate_series(1, 3000) g
      returning id
    )
    insert into individual_client_details (client_id, full_name) select id, 'Volume 032' from novos`, [ids.owner])
  const antes = performance.now()
  const novo = await como(ids.almeidaAdm, (tx) => um(tx, `select count(*)::int n from public.client_directory where deleted_at is null`))
  const tNovo = performance.now() - antes
  const antes2 = performance.now()
  const antigo = await db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ids.almeidaAdm, role: 'authenticated', aal: 'aal2' })])
    return um(tx, `select count(*)::int n from public.clients c
      left join public.individual_client_details i on i.client_id = c.id and private.can_access_client(i.client_id)
      left join public.company_client_details co on co.client_id = c.id and private.can_access_client(co.client_id)
      where c.deleted_at is null and private.is_partner_user() and private.can_access_client(c.id)`)
  })
  const tAntigo = performance.now() - antes2
  igual(novo.n, antigo.n, 'mesma carteira')
  console.log(`    carteira ${novo.n} · política nova ${tNovo.toFixed(0)} ms × critério por linha ${tAntigo.toFixed(0)} ms`)
  if (tNovo >= tAntigo) throw new Error('a política nova não ficou mais rápida que o critério por linha')
  await db.query(`delete from individual_client_details where full_name = 'Volume 032'`)
  await db.query(`delete from clients where cpf like '880%'`)
})

secao('Interromper análise / execução de agente [033]')
const cancelar033 = (uid, run) => como(uid, async (tx) => (await um(tx, `select public.request_agent_run_cancel($1) r`, [run])).r)
const run033 = async (id) => um(db, `select status, cancel_requested_at, cancel_requested_by, queue_msg_id from agent_runs where id = $1`, [id])
const analise033 = async (runId) => um(db, `select status, interruption_reason from legal_analyses where agent_run_id = $1`, [runId])
const naFila033 = async (msg) => (await um(db, `select count(*)::int n from pgmq.q_agent_execution where msg_id = $1`, [msg])).n
async function novaAnalise033(uid = ids.lucas) {
  const caso = (await um(db, `insert into legal_cases (client_id, legal_area_id, title, origin_organization_id, created_by_organization_id)
    values ($1, $2, 'Caso 033', $3, $3) returning id`, [ids.joao, ids.banking, ids.owner])).id
  const r = await iniciar(uid, randomUUID(), caso, ids.tpl029, {}, true)
  return { caso, analise: r.legal_analysis_id, run: r.agent_run_id }
}
const reservar033 = async (run, worker, stale = 300) => {
  const m = (await run033(run)).queue_msg_id
  return comoWorker((tx) => um(tx, `select * from private.claim_agent_run($1, $2, $3, $4)`, [run, worker, m, stale]))
}
const recusa033 = (p, padrao) => p.then(() => { throw new Error('foi aceito') }, (e) => { if (!padrao.test(e.message)) throw e })

await deve('QUEUED: LAWYER interrompe → CANCELLED na hora, mensagem arquivada, análise interrompida, auditoria com o autor', async () => {
  const a = await novaAnalise033()
  if (!a.run) throw new Error(`análise sem execução: ${JSON.stringify(a)}`)
  ids.run033 = a.run
  const msg = (await run033(a.run)).queue_msg_id
  igual(await naFila033(msg), 1, 'mensagem na fila antes')
  const r = await cancelar033(ids.lucas, a.run)
  igual([r.outcome, r.status], ['CANCELLED', 'CANCELLED'], 'resposta')
  const run = await run033(a.run)
  igual([run.status, run.cancel_requested_by], ['CANCELLED', ids.lucas], 'execução')
  igual(await naFila033(msg), 0, 'mensagem saiu da fila')
  const an = await analise033(a.run)
  igual([an.status, an.interruption_reason], ['CANCELLED', 'Execução interrompida a pedido.'], 'análise')
  const ev = await um(db, `select actor_user_id, metadata from audit_events where action = 'AGENT_RUN_CANCELLED' and entity_id = $1`, [a.run])
  igual([ev.actor_user_id, ev.metadata.from], [ids.lucas, 'QUEUED'], 'auditoria')
})
await deve('repetir o pedido é idempotente: mesmo estado, sem evento novo', async () => {
  const antes = (await um(db, `select count(*)::int n from audit_events where entity_id = $1`, [ids.run033])).n
  const r = await cancelar033(ids.lucas, ids.run033)
  igual([r.outcome, r.status], ['ALREADY_CANCELLED', 'CANCELLED'], 'resposta')
  igual((await um(db, `select count(*)::int n from audit_events where entity_id = $1`, [ids.run033])).n, antes, 'eventos')
})
await deve('RUNNING: ADMIN pede interrupção → continua RUNNING até o worker confirmar; pedido auditado e idempotente', async () => {
  const a = await novaAnalise033()
  ids.run033b = a.run
  const c = await reservar033(a.run, 'worker-033')
  igual(c.claimed, true, 'reservada')
  igual((await analise033(a.run)).status, 'RUNNING', 'análise acompanha a execução')
  const r = await cancelar033(ids.barbara, a.run)
  igual([r.outcome, r.status], ['CANCEL_REQUESTED', 'RUNNING'], 'resposta')
  igual((await run033(a.run)).cancel_requested_by, ids.barbara, 'quem pediu')
  igual((await analise033(a.run)).status, 'RUNNING', 'análise ainda rodando')
  igual((await cancelar033(ids.lucas, a.run)).outcome, 'ALREADY_REQUESTED', 'segundo pedido')
  const ev = await linhas(db, `select actor_user_id from audit_events where action = 'AGENT_RUN_CANCEL_REQUESTED' and entity_id = $1`, [a.run])
  igual(ev.map((e) => e.actor_user_id), [ids.barbara], 'um evento, com o autor')
})
await deve('contrato do worker: confere o pedido; não conclui nem manda para Revisões; confirma CANCELLED', async () => {
  const run = ids.run033b
  igual((await comoWorker((tx) => um(tx, `select private.worker_cancel_requested($1, 'worker-033') v`, [run]))).v, true, 'pedido visto')
  igual((await comoWorker((tx) => um(tx, `select private.worker_cancel_requested($1, 'outro-worker') v`, [run]))).v, true, 'sem reserva = pare')
  for (const st of ['COMPLETED', 'WAITING_HUMAN'])
    await recusa033(comoWorker((tx) => tx.query(`select private.worker_finish_run($1, 'worker-033', $2)`, [run, st])), /encerre como CANCELLED/)
  igual((await comoWorker((tx) => um(tx, `select private.worker_finish_run($1, 'worker-033', 'CANCELLED') v`, [run]))).v, true, 'confirmou')
  igual((await run033(run)).status, 'CANCELLED', 'execução')
  igual((await analise033(run)).status, 'CANCELLED', 'análise')
})
await deve('worker sem pedido não "cancela" por conta própria; nova tentativa com pedido encerra em vez de voltar à fila', async () => {
  const a = await novaAnalise033()
  await reservar033(a.run, 'worker-033')
  await recusa033(comoWorker((tx) => tx.query(`select private.worker_finish_run($1, 'worker-033', 'CANCELLED')`, [a.run])), /só confirma um pedido/)
  igual((await comoWorker((tx) => um(tx, `select private.worker_cancel_requested($1, 'worker-033') v`, [a.run]))).v, false, 'sem pedido: segue')
  await cancelar033(ids.lucas, a.run)
  await comoWorker((tx) => tx.query(`select private.worker_requeue_run($1, 'worker-033', 'falha de rede')`, [a.run]))
  igual((await run033(a.run)).status, 'CANCELLED', 'não voltou para a fila')
})
await deve('worker morto: pedido sobre reserva vencida cancela na hora; reserva vencida COM pedido não é retomada', async () => {
  const a = await novaAnalise033()
  await reservar033(a.run, 'worker-morto')
  await db.query(`update agent_runs set heartbeat_at = now() - interval '1 hour' where id = $1`, [a.run])
  igual((await cancelar033(ids.lucas, a.run)).outcome, 'CANCELLED', 'cancelada na hora')
  const b = await novaAnalise033()
  await reservar033(b.run, 'worker-morto')
  await cancelar033(ids.lucas, b.run)
  await db.query(`update agent_runs set heartbeat_at = now() - interval '1 hour' where id = $1`, [b.run])
  const c = await reservar033(b.run, 'worker-novo')
  igual([c.claimed, c.status], [false, 'CANCELLED'], 'não retomada')
})
await deve('WAITING_HUMAN: advogado decide em Revisões; ADMIN pode interromper', async () => {
  const a = await novaAnalise033()
  await reservar033(a.run, 'worker-033')
  await comoWorker((tx) => tx.query(`select private.worker_finish_run($1, 'worker-033', 'WAITING_HUMAN')`, [a.run]))
  igual((await analise033(a.run)).status, 'WAITING_REVIEW', 'análise aguardando revisão')
  await recusa033(cancelar033(ids.lucas, a.run), /decida em Revisões/)
  igual((await cancelar033(ids.barbara, a.run)).outcome, 'CANCELLED', 'ADMIN')
  igual((await analise033(a.run)).status, 'CANCELLED', 'análise')
})
await deve('execução encerrada: recusado (e a análise concluiu junto com a execução)', async () => {
  const a = await novaAnalise033()
  await reservar033(a.run, 'worker-033')
  await comoWorker((tx) => tx.query(`select private.worker_finish_run($1, 'worker-033', 'COMPLETED')`, [a.run]))
  igual((await analise033(a.run)).status, 'COMPLETED', 'análise concluída junto')
  await recusa033(cancelar033(ids.barbara, a.run), /já encerrada/)
})
await deveFalhar('ASSISTANT não interrompe', () => cancelar033(ids.ana, ids.run033b), /Somente ADMIN ou advogado/)
await deveFalhar('parceiro não interrompe', () => cancelar033(ids.almeidaAdm, ids.run033b), /Somente ADMIN ou advogado/)
await deveFalhar('LAWYER não interrompe execução sem caso (só ADMIN a vê)', () => cancelar033(ids.lucas, ids.runAdmin), /não encontrada/)
await deveFalhar('id inexistente: "não encontrada" (sem enumeração)', () => cancelar033(ids.barbara, randomUUID()), /não encontrada/)
await deveFalhar('sessão aal1 não interrompe', () => comoAal1(ids.barbara, (tx) => tx.query(`select public.request_agent_run_cancel($1)`, [ids.run033b])), /Sem sessão liberada|duas etapas/)
await deve('RUNNING não se cancela mais por UPDATE direto (só pelo pedido)', async () => {
  const a = await novaAnalise033()
  await reservar033(a.run, 'worker-033')
  const n = await como(ids.barbara, async (tx) => (await tx.query(`update agent_runs set status = 'CANCELLED' where id = $1`, [a.run])).affectedRows)
  igual(n, 0, 'linhas alteradas')
  igual((await run033(a.run)).status, 'RUNNING', 'segue rodando')
})
await deveFalhar('pedido de interrupção não se desfaz', () =>
  db.query(`update agent_runs set cancel_requested_at = null, cancel_requested_by = null where id = $1`, [ids.run033b]), /não se desfaz/)
await deve('anon não executa; dg_worker só confere (não pede)', async () => {
  await recusa033(db.transaction(async (tx) => { await tx.query('set local role anon'); await tx.query(`select public.request_agent_run_cancel($1)`, [ids.run033b]) }), /permission denied/)
  await recusa033(comoWorker((tx) => tx.query(`select private.request_agent_run_cancel($1)`, [ids.run033b])), /permission denied/)
})

await deve('estado de interrupção: LAWYER vê só execuções de casos que acessa; nada além de id/situação/pedido', async () => {
  const ids3 = [ids.run033, ids.run033b, ids.runAdmin]
  const doLawyer = await como(ids.lucas, (tx) => linhas(tx, `select * from public.get_agent_run_cancel_state($1)`, [ids3]))
  igual(doLawyer.some((r) => r.agent_run_id === ids.runAdmin), false, 'sem caso escondida')
  igual(Object.keys(doLawyer[0]).sort(), ['agent_run_id', 'cancel_requested', 'status'], 'colunas')
  const doAdmin = await como(ids.barbara, (tx) => linhas(tx, `select * from public.get_agent_run_cancel_state($1)`, [ids3]))
  igual(doAdmin.length, 3, 'ADMIN vê todas')
})
await deveFalhar('estado de interrupção: ASSISTANT e parceiro recusados', () =>
  como(ids.almeidaAdm, (tx) => tx.query(`select * from public.get_agent_run_cancel_state($1)`, [[ids.run033]])), /Somente ADMIN ou advogado/)

secao('Revisão: edição manual cria a versão N+1, nunca altera a N [034]')
const preparar034 = (uid, k, review, base) => como(uid, async (tx) => (await um(tx, `select public.prepare_manual_revision($1, $2, $3) r`, [k, review, base])).r)
const commit034 = (uid, k, review, base, p, size = 120, checksum = sha('c')) => como(uid, async (tx) =>
  (await um(tx, `select public.commit_manual_revision_once($1, $2, $3, $4, $5, $6, $7) r`, [k, review, base, p.document_version_id, p.object_name, size, checksum])).r)
async function minuta034(mime = 'text/plain') {
  const doc = randomUUID(), v = randomUUID()
  await db.query(`insert into documents (id, client_id, category, title) values ($1, $2, 'OTHER', 'Minuta 034')`, [doc, ids.joao])
  await db.query(`insert into case_documents (legal_case_id, document_id, purpose) values ($1, $2, 'AGENT_DRAFT')`, [ids.casoI, doc])
  await db.query(`insert into document_versions (id, document_id, storage_object_name, original_filename, mime_type, file_size, checksum_sha256, source)
    values ($1, $2, $3, 'minuta.md', $4, 64, $5, 'AGENT')`, [v, doc, `clients/${ids.joao}/documents/${doc}/${v}/minuta.md`, mime, sha('a')])
  const review = (await um(db, `insert into reviews (legal_case_id, document_version_id, priority, assigned_reviewer_id)
    values ($1, $2, 'HIGH', $3) returning id`, [ids.casoI, v, ids.lucas])).id
  return { doc, v, review }
}
const versao034 = (id) => um(db, `select document_id, version_number, storage_object_name, source, created_by, checksum_sha256 from document_versions where id = $1`, [id])

await deve('LAWYER edita: versão N+1 MANUAL_EDIT; a N fica intacta; revisão N recebe "alterações pedidas"; revisão nova PENDING com o mesmo responsável', async () => {
  const m = await minuta034()
  ids.m034 = m
  const antes = await versao034(m.v)
  const k = randomUUID()
  const p = await preparar034(ids.lucas, k, m.review, m.v)
  igual([p.deduplicated, p.base_version_number, p.mime_type], [false, 1, 'text/plain'], 'preparo')
  if (!p.object_name.startsWith(`clients/${ids.joao}/documents/${m.doc}/${p.document_version_id}/`)) throw new Error(`caminho: ${p.object_name}`)
  const r = await commit034(ids.lucas, k, m.review, m.v, p)
  igual([r.deduplicated, r.version_number, r.previous_review_id], [false, 2, m.review], 'commit')
  ids.m034.v2 = r.document_version_id
  ids.m034.review2 = r.review_id
  igual(await versao034(m.v), antes, 'versão N intacta')
  const nova = await versao034(r.document_version_id)
  igual([nova.version_number, nova.source, nova.created_by], [2, 'MANUAL_EDIT', ids.lucas], 'versão N+1')
  const velha = await um(db, `select status from reviews where id = $1`, [m.review])
  igual(velha.status, 'CHANGES_REQUESTED', 'revisão da N')
  const dec = await linhas(db, `select decision, decided_by, notes from review_decisions where review_id = $1`, [m.review])
  igual([dec.length, dec[0].decision, dec[0].decided_by], [1, 'REQUEST_CHANGES', ids.lucas], 'decisão append-only')
  const rv = await um(db, `select status, document_version_id, priority, assigned_reviewer_id, decided_at from reviews where id = $1`, [r.review_id])
  igual([rv.status, rv.document_version_id, rv.priority, rv.assigned_reviewer_id, rv.decided_at], ['PENDING', r.document_version_id, 'HIGH', ids.lucas, null], 'revisão nova')
})
await deve('aprovação é por versão: a N fica "substituída" e a N+1 nasce pendente (nada herdado)', async () => {
  const ap = await linhas(db, `select document_version_id, approval_status from document_version_approvals where document_id = $1 order by version_number`, [ids.m034.doc])
  igual(ap.map((x) => x.approval_status), ['SUPERSEDED', 'PENDING'], 'situação por versão')
})
await deve('mesma chave: mesmo resultado (nem versão nem revisão novas); preparo avisa para não subir de novo', async () => {
  const m = await minuta034()
  const k = randomUUID()
  const p = await preparar034(ids.lucas, k, m.review, m.v)
  const r1 = await commit034(ids.lucas, k, m.review, m.v, p)
  const r2 = await commit034(ids.lucas, k, m.review, m.v, { ...p, document_version_id: randomUUID() })
  igual([r2.deduplicated, r2.document_version_id, r2.review_id], [true, r1.document_version_id, r1.review_id], 'repetição')
  igual((await um(db, `select count(*)::int n from document_versions where document_id = $1`, [m.doc])).n, 2, 'versões')
  const p2 = await preparar034(ids.lucas, k, m.review, m.v)
  igual([p2.deduplicated, p2.document_version_id], [true, r1.document_version_id], 'preparo deduplicado')
})
await deve('mesma chave com outro conteúdo é recusada', async () => {
  const m = await minuta034()
  const k = randomUUID()
  const p = await preparar034(ids.lucas, k, m.review, m.v)
  await commit034(ids.lucas, k, m.review, m.v, p)
  await commit034(ids.lucas, k, m.review, m.v, p, 120, sha('d')).then(() => { throw new Error('aceito') }, (e) => { if (!/outros dados/.test(e.message)) throw e })
})
await deveFalhar('editar a partir de versão antiga é recusado (a base precisa ser a mais recente)', async () => {
  const p = await preparar034(ids.barbara, randomUUID(), ids.m034.review, ids.m034.v).catch((e) => { throw e })
  return p
}, /decidida|versão mais nova/)
await deveFalhar('duas edições da mesma base com chaves diferentes: a segunda é recusada', async () => {
  const m = await minuta034()
  const pa = await preparar034(ids.lucas, randomUUID(), m.review, m.v)
  const kb = randomUUID()
  const pb = await preparar034(ids.barbara, kb, m.review, m.v)
  await commit034(ids.lucas, randomUUID(), m.review, m.v, pa)
  await commit034(ids.barbara, kb, m.review, m.v, pb)
}, /decidida|versão mais nova/)
await deveFalhar('revisão já decidida não se edita (reabra antes)', async () => {
  const m = await minuta034()
  await decidir(ids.lucas, m.review, 'APPROVE')
  await preparar034(ids.lucas, randomUUID(), m.review, m.v)
}, /já decidida/)
await deveFalhar('formato não editável (PDF): envie uma nova versão do arquivo', async () => {
  const m = await minuta034('application/pdf')
  await preparar034(ids.lucas, randomUUID(), m.review, m.v)
}, /não é editável/)
await deveFalhar('caminho diferente do autorizado é recusado', async () => {
  const m = await minuta034()
  const k = randomUUID()
  const p = await preparar034(ids.lucas, k, m.review, m.v)
  await commit034(ids.lucas, k, m.review, m.v, { ...p, object_name: `clients/${ids.joao}/documents/${m.doc}/${p.document_version_id}/outro.md` })
}, /não confere/)
await deveFalhar('versão de outra revisão é recusada', async () => {
  const a = await minuta034(), b = await minuta034()
  await preparar034(ids.lucas, randomUUID(), a.review, b.v)
}, /não é a desta revisão/)
await deveFalhar('ASSISTANT não edita', async () => {
  const m = await minuta034()
  await preparar034(ids.ana, randomUUID(), m.review, m.v)
}, /Somente ADMIN ou advogado/)
await deveFalhar('parceiro não edita (nem enxerga a revisão)', async () => {
  const m = await minuta034()
  await preparar034(ids.almeidaAdm, randomUUID(), m.review, m.v)
}, /Somente ADMIN ou advogado/)
await deveFalhar('revisão inexistente: "não encontrada"', () => preparar034(ids.lucas, randomUUID(), randomUUID(), randomUUID()), /não encontrada/)
await deveFalhar('sessão aal1 não edita', () => comoAal1(ids.lucas, (tx) => tx.query(`select public.prepare_manual_revision($1, $2, $3)`, [randomUUID(), ids.m034.review2, ids.m034.v2])), /Sem sessão liberada|duas etapas/)
await deve('auditoria: versão N → N+1, revisões anterior e nova, sem conteúdo', async () => {
  const ev = await um(db, `select actor_user_id, metadata from audit_events where action = 'DOCUMENT_MANUALLY_REVISED' and entity_id = $1`, [ids.m034.v2])
  igual([ev.actor_user_id, ev.metadata.base_version_number, ev.metadata.version_number, ev.metadata.previous_review_id, ev.metadata.review_id],
    [ids.lucas, 1, 2, ids.m034.review, ids.m034.review2], 'evento')
})
await deve('anon não executa as funções de edição', async () => {
  for (const q of [`select public.prepare_manual_revision($1, $1, $1)`, `select public.commit_manual_revision_once($1, $1, $1, $1, 'x', 1, 'x')`])
    await db.transaction(async (tx) => { await tx.query('set local role anon'); await tx.query(q, [randomUUID()]) })
      .then(() => { throw new Error('anon executou') }, (e) => { if (!/permission denied/.test(e.message)) throw e })
})

// ═════════════════════════════ fim ═══════════════════════════════════════

console.log(
  falhas === 0
    ? `\n\x1b[32m${total} verificações, todas passaram.\x1b[0m\n`
    : `\n\x1b[31m${falhas} de ${total} verificações falharam.\x1b[0m\n`,
)
await db.close()
process.exit(falhas === 0 ? 0 : 1)
