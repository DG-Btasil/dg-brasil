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

// ═════════════════════════════ fim ═══════════════════════════════════════

console.log(
  falhas === 0
    ? `\n\x1b[32m${total} verificações, todas passaram.\x1b[0m\n`
    : `\n\x1b[31m${falhas} de ${total} verificações falharam.\x1b[0m\n`,
)
await db.close()
process.exit(falhas === 0 ? 0 : 1)
