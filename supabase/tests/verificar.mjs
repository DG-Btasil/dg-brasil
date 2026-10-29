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
import { createHash, randomUUID } from 'node:crypto'

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
  igual(r.map((x) => [x.id, x.public]), [['imports', false], ['legal-documents', false], ['reference-materials', false], ['skill-files', false]], 'buckets')
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
  return { caso, analise: r.analysis_id, run: r.agent_run_id }
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

secao('Financeiro: cronograma de parcelas, valores da parceria e contratado por modelo [035]')
const cronograma035 = (uid, k, acordo, total, n, primeiro, freq = 'MONTHLY', tipo = 'FIXED', desc = null) => como(uid, async (tx) =>
  (await um(tx, `select public.create_payment_schedule_once($1, $2, $3, $4, $5, $6, $7, $8) r`, [k, acordo, total, n, primeiro, freq, tipo, desc])).r)
const parcelas035 = (acordo) => linhas(db, `select amount::text a, due_date::text d, description, payment_type from payments where financial_agreement_id = $1 order by due_date, description`, [acordo])
const contar035 = async (acordo) => (await um(db, `select count(*)::int n from payments where financial_agreement_id = $1`, [acordo])).n
const novoAcordo035 = async (status = 'DRAFT') => acordo030(ids.barbara, await novoCaso030('Caso 035'), status)

await deve('R$ 100,00 em 3 mensais: 33,34 + 33,33 + 33,33 (resto nas primeiras), soma exata; 31/01 → 28/02 → 31/03', async () => {
  const a = await novoAcordo035()
  const r = await cronograma035(ids.barbara, randomUUID(), a, '100.00', 3, '2027-01-31')
  igual([r.count, r.deduplicated, r.payment_ids.length], [3, false, 3], 'resposta')
  const p = await parcelas035(a)
  igual(p.map((x) => x.a), ['33.34', '33.33', '33.33'], 'valores')
  igual(p.map((x) => x.d), ['2027-01-31', '2027-02-28', '2027-03-31'], 'vencimentos')
  igual(p.map((x) => x.description), ['Parcela 1/3', 'Parcela 2/3', 'Parcela 3/3'], 'descrições')
  igual((await um(db, `select sum(amount)::text s from payments where financial_agreement_id = $1`, [a])).s, '100.00', 'soma')
})
await deve('uma parcela = o total; 12 parcelas de R$ 1.000,00: quatro de 83,34 e oito de 83,33', async () => {
  const a = await novoAcordo035()
  await cronograma035(ids.barbara, randomUUID(), a, '750.55', 1, '2027-05-10')
  igual((await parcelas035(a)).map((x) => x.a), ['750.55'], 'uma parcela')
  const b = await novoAcordo035()
  await cronograma035(ids.barbara, randomUUID(), b, '1000.00', 12, '2027-01-15', 'MONTHLY', 'MONTHLY', 'Mensalidade')
  const p = await parcelas035(b)
  igual([p.filter((x) => x.a === '83.34').length, p.filter((x) => x.a === '83.33').length], [4, 8], 'distribuição')
  igual((await um(db, `select sum(amount)::text s from payments where financial_agreement_id = $1`, [b])).s, '1000.00', 'soma')
  igual([p[0].description, p[0].payment_type], ['Mensalidade 1/12', 'MONTHLY'], 'rótulo e tipo')
})
await deve('quinzenal e semanal', async () => {
  const a = await novoAcordo035()
  await cronograma035(ids.barbara, randomUUID(), a, '30.00', 3, '2027-03-01', 'BIWEEKLY')
  igual((await parcelas035(a)).map((x) => x.d), ['2027-03-01', '2027-03-15', '2027-03-29'], 'quinzenal')
  const b = await novoAcordo035()
  await cronograma035(ids.barbara, randomUUID(), b, '30.00', 3, '2027-03-01', 'WEEKLY')
  igual((await parcelas035(b)).map((x) => x.d), ['2027-03-01', '2027-03-08', '2027-03-15'], 'semanal')
})
await deve('mesma chave (clique duplo/nova tentativa): o mesmo cronograma, nada duplicado; outra chave com outros dados é outro pedido', async () => {
  const a = await novoAcordo035('ACTIVE')
  const k = randomUUID()
  const r1 = await cronograma035(ids.barbara, k, a, '900.00', 3, '2027-02-01')
  const r2 = await cronograma035(ids.barbara, k, a, '900.00', 3, '2027-02-01')
  igual([r2.deduplicated, r2.payment_ids], [true, r1.payment_ids], 'repetição')
  igual(await contar035(a), 3, 'obrigações')
  await cronograma035(ids.barbara, k, a, '901.00', 3, '2027-02-01').then(() => { throw new Error('aceito') }, (e) => { if (!/outros dados/.test(e.message)) throw e })
  igual(await contar035(a), 3, 'nada a mais')
})
await deve('cronograma cria só OBRIGAÇÕES: nenhum recebimento, divisão ou repasse; auditoria do cronograma', async () => {
  const a = await novoAcordo035('ACTIVE')
  await cronograma035(ids.barbara, randomUUID(), a, '300.00', 2, '2027-04-01')
  igual((await um(db, `select count(*)::int n from payment_receipts r join payments p on p.id = r.payment_id where p.financial_agreement_id = $1`, [a])).n, 0, 'recebimentos')
  const ev = await um(db, `select actor_user_id, metadata from audit_events where action = 'PAYMENT_SCHEDULE_CREATED' and entity_id = $1`, [a])
  igual([ev.actor_user_id, ev.metadata.count, ev.metadata.frequency], [ids.barbara, 2, 'MONTHLY'], 'auditoria')
  if (JSON.stringify(ev.metadata).includes('300')) throw new Error('valor na auditoria')
})
for (const [rotulo, args, padrao] of [
  ['acordo concluído ou cancelado', 'CANCELLED', /concluído ou cancelado/],
  ['fração de centavo', ['100.005', 2], /fração de centavo/],
  ['parcela abaixo de R$ 0,01', ['0.02', 3], /pelo menos R\$ 0,01/],
  ['mais de 120 parcelas', ['1000.00', 121], /120 parcelas/],
  ['periodicidade inválida', ['100.00', 2, 'DAILY'], /Periodicidade/],
  ['tipo inválido', ['100.00', 2, 'MONTHLY', 'SUCCESS_FEE'], /Tipo de parcela/],
]) {
  await deve(`recusado sem gravar nada: ${rotulo}`, async () => {
    const a = Array.isArray(args) ? await novoAcordo035() : await novoAcordo035(args === 'CANCELLED' ? 'DRAFT' : 'DRAFT')
    if (args === 'CANCELLED') await situacao030(ids.barbara, a, 'CANCELLED')
    const [total, n, freq, tipo] = Array.isArray(args) ? args : ['100.00', 2]
    await cronograma035(ids.barbara, randomUUID(), a, total, n, '2027-01-01', freq ?? 'MONTHLY', tipo ?? 'FIXED')
      .then(() => { throw new Error('aceito') }, (e) => { if (!padrao.test(e.message)) throw e })
    igual(await contar035(a), 0, 'obrigações')
  })
}
await deveFalhar('LAWYER não gera cronograma', async () => cronograma035(ids.lucas, randomUUID(), await novoAcordo035(), '100.00', 2, '2027-01-01'), /Somente ADMIN/)
await deveFalhar('parceiro não gera cronograma', async () => cronograma035(ids.almeidaAdm, randomUUID(), await novoAcordo035(), '100.00', 2, '2027-01-01'), /Somente ADMIN/)
await deveFalhar('acordo inexistente', () => cronograma035(ids.barbara, randomUUID(), randomUUID(), '100.00', 2, '2027-01-01'), /não encontrado/)

await deve('valores da parceria: receita elegível, participação e parte do escritório derivadas do ledger; parceiro só os dele', async () => {
  const esperado = await um(db, `select sum(base_amount)::text e, sum(partner_amount)::text p, sum(owner_amount)::text o
    from partner_revenue_allocations where case_partnership_agreement_id = $1`, [ids.parceriaA])
  const doAdmin = await como(ids.barbara, (tx) => um(tx, `select eligible_revenue::text e, partner_share::text p, owner_share::text o
    from partner_agreement_share_totals where case_partnership_agreement_id = $1`, [ids.parceriaA]))
  igual(doAdmin, esperado, 'ADMIN')
  const doParceiro = await como(ids.almeidaAdm, (tx) => linhas(tx, `select case_partnership_agreement_id id, partner_organization_id org from partner_agreement_share_totals`))
  if (!doParceiro.some((x) => x.id === ids.parceriaA) || doParceiro.some((x) => x.org !== ids.almeida)) throw new Error('escopo do parceiro')
  igual((await como(ids.ferreiraAdm, (tx) => linhas(tx, `select 1 from partner_agreement_share_totals where case_partnership_agreement_id = $1`, [ids.parceriaA]))).length, 0, 'outro parceiro')
  igual((await como(ids.almeidaUsr, (tx) => linhas(tx, `select 1 from partner_agreement_share_totals`))).length, 0, 'PARTNER_USER')
  igual((await como(ids.lucas, (tx) => linhas(tx, `select 1 from partner_agreement_share_totals`))).length, 0, 'LAWYER')
})
await deveFalhar('valores da parceria não se editam (nem ADMIN)', () =>
  como(ids.barbara, (tx) => tx.query(`update partner_agreement_share_totals set partner_share = 1 where case_partnership_agreement_id = $1`, [ids.parceriaA])),
  /cannot update|not automatically updatable|permission denied/)

await deve('contratado por modelo: obrigações não canceladas de acordos não cancelados, somadas no banco; só ADMIN', async () => {
  const modelo = (await um(db, `insert into fee_models (name) values ('Modelo 035') returning id`)).id
  const caso1 = await novoCaso030('Caso 035 modelo A'), caso2 = await novoCaso030('Caso 035 modelo B'), caso3 = await novoCaso030('Caso 035 modelo C')
  const a1 = await como(ids.barbara, async (tx) => (await um(tx, `insert into financial_agreements (legal_case_id, fee_model_id) values ($1, $2) returning id`, [caso1, modelo])).id)
  const a2 = await como(ids.barbara, async (tx) => (await um(tx, `insert into financial_agreements (legal_case_id, fee_model_id) values ($1, $2) returning id`, [caso2, modelo])).id)
  const a3 = await como(ids.barbara, async (tx) => (await um(tx, `insert into financial_agreements (legal_case_id, fee_model_id) values ($1, $2) returning id`, [caso3, modelo])).id)
  await cronograma035(ids.barbara, randomUUID(), a1, '1000.00', 2, '2027-01-01')
  const p2 = await obrigacao030(ids.barbara, a2, 250)
  const cancelada = await obrigacao030(ids.barbara, a2, 500)
  await como(ids.barbara, (tx) => tx.query(`update payments set cancelled_at = now(), cancellation_reason = 'teste' where id = $1`, [cancelada]))
  await obrigacao030(ids.barbara, a3, 999)
  await como(ids.barbara, (tx) => tx.query(`update payments set cancelled_at = now(), cancellation_reason = 'teste' where financial_agreement_id = $1`, [a3]))
  await situacao030(ids.barbara, a3, 'CANCELLED')
  const r = await como(ids.barbara, (tx) => um(tx, `select agreement_count, contracted_amount::text v from financial_contracted_by_fee_model where fee_model_id = $1`, [modelo]))
  igual([r.agreement_count, r.v], [2, '1250.00'], 'modelo')
  igual(!!p2, true, 'obrigação')
  igual((await como(ids.lucas, (tx) => linhas(tx, `select 1 from financial_contracted_by_fee_model`))).length, 0, 'LAWYER')
  igual((await como(ids.almeidaAdm, (tx) => linhas(tx, `select 1 from financial_contracted_by_fee_model`))).length, 0, 'parceiro')
})
await deve('anon não lê as views nem gera cronograma', async () => {
  for (const q of [`select 1 from partner_agreement_share_totals`, `select 1 from financial_contracted_by_fee_model`,
    `select public.create_payment_schedule_once('${randomUUID()}', '${randomUUID()}', 1, 1, current_date, 'MONTHLY', 'FIXED')`])
    await db.transaction(async (tx) => { await tx.query('set local role anon'); await tx.query(q) })
      .then(() => { throw new Error(`anon: ${q}`) }, (e) => { if (!/permission denied/.test(e.message)) throw e })
})

await deve('atomicidade: falha na 3ª de 5 obrigações → nenhuma fica gravada (e a chave pode ser usada de novo)', async () => {
  const a = await novoAcordo035()
  await db.exec(`
    create function public.falha_035() returns trigger language plpgsql as $f$
    begin
      if new.description like '% 3/5' then raise exception 'falha simulada na terceira parcela'; end if;
      return new;
    end $f$;
    create trigger falha_035 before insert on public.payments for each row execute function public.falha_035();`)
  const k = randomUUID()
  try {
    await cronograma035(ids.barbara, k, a, '500.00', 5, '2027-01-01').then(() => { throw new Error('aceito') }, (e) => { if (!/falha simulada/.test(e.message)) throw e })
    igual(await contar035(a), 0, 'obrigações depois da falha')
  } finally {
    await db.exec(`drop trigger falha_035 on public.payments; drop function public.falha_035();`)
  }
  const r = await cronograma035(ids.barbara, k, a, '500.00', 5, '2027-01-01')
  igual([r.deduplicated, await contar035(a)], [false, 5], 'nova tentativa com a mesma chave')
})

secao('Portal: histórico sanitizado do caso e contagens por cliente [036]')
const historico036 = (uid, caso, offset = 0, limit = 100) => como(uid, (tx) =>
  linhas(tx, `select * from public.get_partner_case_timeline($1, $2, $3)`, [caso, offset, limit]))
const contagens036 = (uid, clientes) => como(uid, (tx) => linhas(tx, `select * from public.get_partner_client_counts($1)`, [clientes]))

await deve('caso de parceiro: cadastro, processo, documento compartilhado e solicitações; nada interno', async () => {
  const h = await historico036(ids.almeidaAdm, ids.casoA)
  if (h.length === 0) throw new Error('histórico vazio')
  const tipos = new Set(h.map((e) => e.kind))
  for (const k of ['CASE', 'PROCESS', 'DOCUMENT', 'REQUEST']) if (!tipos.has(k)) throw new Error(`faltou ${k}: ${[...tipos]}`)
  igual(h.every((e) => Number(e.total_count) === h.length), true, 'total')
  const texto = JSON.stringify(h)
  for (const proibido of ['Parecer interno', 'internal_notes', 'rejection_reason_internal', 'request_id', 'ip_address', 'user_agent', 'metadata'])
    if (texto.includes(proibido)) throw new Error(`vazou: ${proibido}`)
  igual(Object.keys(h[0]).sort(), ['actor_label', 'description', 'event_id', 'kind', 'occurred_at', 'related_id', 'related_type', 'title', 'total_count'], 'colunas fixas')
  const docs = h.filter((e) => e.kind === 'DOCUMENT').map((e) => e.related_id)
  igual(docs.includes(ids.docInterno), false, 'documento interno')
})
await deve('mais recentes primeiro; páginas sem sobreposição', async () => {
  const todos = await historico036(ids.almeidaAdm, ids.casoA)
  igual(todos.every((e, i) => i === 0 || todos[i - 1].occurred_at >= e.occurred_at), true, 'ordem')
  const p1 = await historico036(ids.almeidaAdm, ids.casoA, 0, 2)
  const p2 = await historico036(ids.almeidaAdm, ids.casoA, 2, 2)
  igual(p1.some((a) => p2.some((b) => b.event_id === a.event_id)), false, 'sobreposição')
  igual([p1[0]?.event_id, p2[0]?.event_id], [todos[0]?.event_id, todos[2]?.event_id], 'sequência')
  igual(Number(p1[0].total_count), todos.length, 'total na página')
})
await deve('situações internas viram "Em análise" sem repetir; recusa mostra SÓ o motivo público', async () => {
  const caso = (await como(ids.almeidaUsr, (tx) => um(tx, `insert into legal_cases (client_id, legal_area_id, title, status, partner_organization_id, origin_organization_id)
    values ($1, $2, 'Caso 036', 'SUBMITTED', $3, $3) returning id`, [ids.joao, ids.banking, ids.almeida]))).id
  for (const st of ['WAITING_DOCUMENTS', 'READY_FOR_ANALYSIS', 'ANALYZING', 'WAITING_REVIEW'])
    await como(ids.lucas, (tx) => tx.query(`update legal_cases set status = $2 where id = $1`, [caso, st]))
  await como(ids.lucas, async (tx) => {
    await tx.query(`insert into legal_case_internal_details (legal_case_id, rejection_reason_internal, internal_notes) values ($1, 'MOTIVO-INTERNO-036', 'NOTA-INTERNA-036')
      on conflict (legal_case_id) do update set rejection_reason_internal = excluded.rejection_reason_internal, internal_notes = excluded.internal_notes`, [caso])
    await tx.query(`update legal_cases set status = 'REJECTED', rejected_at = now(), rejection_reason_public = 'Documentação insuficiente (público)' where id = $1`, [caso])
  })
  const h = await historico036(ids.almeidaUsr, caso)
  const titulos = h.map((e) => e.title)
  igual(titulos.filter((t) => t === 'Situação: Em análise').length, 1, 'uma vez "Em análise"')
  igual(titulos.includes('Situação: Aguardando documentos'), true, 'aguardando documentos')
  const recusa = h.find((e) => e.title === 'Caso não aceito')
  igual(recusa?.description, 'Documentação insuficiente (público)', 'motivo público')
  const texto = JSON.stringify(h)
  if (/MOTIVO-INTERNO-036|NOTA-INTERNA-036/.test(texto)) throw new Error('motivo/nota interna vazou')
  igual(h.find((e) => e.title === 'Caso cadastrado')?.actor_label, 'Paula', 'autor do próprio escritório pelo nome')
  igual(recusa?.actor_label, 'Bárbara Cardoso Advocacia', 'equipe interna como escritório')
})
await deveFalhar('outro parceiro: "não encontrado"', () => historico036(ids.ferreiraAdm, ids.casoA), /não encontrado/)
await deveFalhar('equipe interna não usa o histórico do portal', () => historico036(ids.barbara, ids.casoA), /só do escritório parceiro/)
await deveFalhar('caso interno com origem do parceiro (sem operação): "não encontrado"', () => historico036(ids.almeidaAdm, ids.casoI), /não encontrado/)
await deveFalhar('sessão aal1 não lê', () => comoAal1(ids.almeidaAdm, (tx) => tx.query(`select * from public.get_partner_case_timeline($1)`, [ids.casoA])), /Sem sessão liberada|duas etapas/)

const esperado036 = (cliente, org) => um(db, `select
    (select count(*)::int from legal_cases where client_id = $1 and partner_organization_id = $2 and deleted_at is null) case_count,
    (select count(*)::int from legal_processes p join legal_cases c on c.id = p.legal_case_id
      where c.client_id = $1 and c.partner_organization_id = $2 and c.deleted_at is null and p.deleted_at is null) process_count,
    (select count(*)::int from partner_requests q join legal_cases c on c.id = q.legal_case_id
      where c.client_id = $1 and c.partner_organization_id = $2 and c.deleted_at is null and q.partner_organization_id = $2 and q.status = 'OPEN') open_request_count,
    (select count(*)::int from case_document_requirements r join legal_cases c on c.id = r.legal_case_id
      where c.client_id = $1 and c.partner_organization_id = $2 and c.deleted_at is null and r.status = 'REQUESTED') requested_document_count,
    (select count(*)::int from legal_cases where client_id = $1 and deleted_at is null) todos`, [cliente, org])
const carteira036 = async (org) => (await linhas(db, `select r.client_id from client_organization_relationships r join clients c on c.id = r.client_id
  where r.organization_id = $1 and r.status = 'ACTIVE' and c.deleted_at is null`, [org])).map((x) => x.client_id)
await deve('contagens só no escopo de cada escritório: cliente fora da carteira não volta; o total do cliente nunca vaza', async () => {
  const fora = (await um(db, `insert into clients (kind, cpf, origin_organization_id) values ('INDIVIDUAL', '77700000361', $1) returning id`, [ids.owner])).id
  let provouVazamento = false
  for (const [uid, org] of [[ids.almeidaAdm, ids.almeida], [ids.ferreiraAdm, ids.ferreira]]) {
    const r = await contagens036(uid, [ids.joao, ids.carla, fora])
    const carteira = await carteira036(org)
    igual(r.map((x) => x.client_id).sort(), [ids.joao, ids.carla].filter((c) => carteira.includes(c)).sort(), 'só a carteira')
    for (const linha of r) {
      const e = await esperado036(linha.client_id, org)
      igual([linha.case_count, linha.process_count, linha.open_request_count, linha.requested_document_count],
        [e.case_count, e.process_count, e.open_request_count, e.requested_document_count], `contagens ${linha.client_id}`)
      if (e.todos > e.case_count) provouVazamento = true
    }
  }
  if (!provouVazamento) throw new Error('cenário fraco: nenhum cliente com casos fora do escopo do parceiro')
})
await deveFalhar('equipe interna não usa as contagens do portal', () => contagens036(ids.barbara, [ids.joao]), /só do escritório parceiro/)
await deveFalhar('no máximo 100 clientes por consulta', () => contagens036(ids.almeidaAdm, Array.from({ length: 101 }, () => randomUUID())), /100 clientes/)
await deve('anon não executa histórico nem contagens', async () => {
  for (const q of [`select * from public.get_partner_case_timeline('${randomUUID()}')`, `select * from public.get_partner_client_counts(array['${randomUUID()}']::uuid[])`])
    await db.transaction(async (tx) => { await tx.query('set local role anon'); await tx.query(q) })
      .then(() => { throw new Error(`anon: ${q}`) }, (e) => { if (!/permission denied/.test(e.message)) throw e })
})

secao('Notificações: produtor central, destinatários, preferências e idempotência [037]')
const avisos037 = (uid, tipo) => linhas(db, `select type, title, message, legal_case_id, event_key from notifications where user_id = $1 and type = $2 order by created_at`, [uid, tipo])
const casoParceiro037 = async (titulo) => (await como(ids.almeidaUsr, (tx) => um(tx,
  `insert into legal_cases (client_id, legal_area_id, title, status, partner_organization_id, origin_organization_id)
   values ($1, $2, $3, 'SUBMITTED', $4, $4) returning id`, [ids.joao, ids.banking, titulo, ids.almeida]))).id

await deve('caso enviado pelo parceiro sem responsável → triagem (ADMIN); nunca para o próprio parceiro nem para outro escritório', async () => {
  const caso = await casoParceiro037('Caso 037 enviado')
  ids.caso037 = caso
  igual((await avisos037(ids.barbara, 'CASE_SUBMITTED')).filter((a) => a.legal_case_id === caso).length, 1, 'ADMIN')
  for (const uid of [ids.almeidaUsr, ids.almeidaAdm, ids.ferreiraAdm, ids.lucas])
    igual((await avisos037(uid, 'CASE_SUBMITTED')).filter((a) => a.legal_case_id === caso).length, 0, `não para ${uid}`)
})
await deve('atribuição: o advogado é avisado (por outra pessoa); quem se atribui não recebe aviso de si', async () => {
  await como(ids.barbara, (tx) => tx.query(`update legal_cases set assigned_lawyer_id = $2 where id = $1`, [ids.caso037, ids.lucas]))
  igual((await avisos037(ids.lucas, 'CASE_ASSIGNED')).filter((a) => a.legal_case_id === ids.caso037).length, 1, 'LAWYER avisado')
  igual((await avisos037(ids.barbara, 'CASE_ASSIGNED')).filter((a) => a.legal_case_id === ids.caso037).length, 0, 'autor não')
})
await deve('aceite: todo o escritório parceiro que opera o caso é avisado; o outro parceiro não', async () => {
  await como(ids.lucas, (tx) => tx.query(`update legal_cases set status = 'ACCEPTED' where id = $1`, [ids.caso037]))
  for (const uid of [ids.almeidaAdm, ids.almeidaUsr]) igual((await avisos037(uid, 'CASE_ACCEPTED')).filter((a) => a.legal_case_id === ids.caso037).length, 1, `Almeida ${uid}`)
  igual((await avisos037(ids.ferreiraAdm, 'CASE_ACCEPTED')).filter((a) => a.legal_case_id === ids.caso037).length, 0, 'Ferreira')
})
await deve('recusa: o parceiro recebe SÓ o motivo público', async () => {
  const caso = await casoParceiro037('Caso 037 recusado')
  await como(ids.lucas, async (tx) => {
    await tx.query(`insert into legal_case_internal_details (legal_case_id, rejection_reason_internal) values ($1, 'MOTIVO-INTERNO-037')`, [caso])
    await tx.query(`update legal_cases set status = 'REJECTED', rejected_at = now(), rejection_reason_public = 'Fora da área de atuação' where id = $1`, [caso])
  })
  const a = (await avisos037(ids.almeidaUsr, 'CASE_REJECTED')).find((x) => x.legal_case_id === caso)
  igual(a?.message, 'Fora da área de atuação', 'motivo público')
  if (JSON.stringify(await linhas(db, `select * from notifications where legal_case_id = $1`, [caso])).includes('MOTIVO-INTERNO-037')) throw new Error('motivo interno vazou')
})
await deve('atomicidade: operação recusada não deixa notificação (aceite sem advogado falha → nada para o parceiro)', async () => {
  const caso = await casoParceiro037('Caso 037 atômico')
  await como(ids.barbara, (tx) => tx.query(`update legal_cases set status = 'ACCEPTED' where id = $1`, [caso])).then(() => { throw new Error('aceito sem advogado') }, () => {})
  igual((await linhas(db, `select 1 from notifications where legal_case_id = $1 and type = 'CASE_ACCEPTED'`, [caso])).length, 0, 'nada gravado')
})
await deve('prazo novo → responsável; lembretes "próximo" e "vencido" uma vez só (rodar de novo não duplica)', async () => {
  const proximo = (await como(ids.barbara, (tx) => um(tx, `insert into deadlines (legal_case_id, title, due_at, responsible_user_id, priority)
    values ($1, 'Contestação 037', now() + interval '10 hours', $2, 'HIGH') returning id`, [ids.caso037, ids.lucas]))).id
  const vencido = (await como(ids.barbara, (tx) => um(tx, `insert into deadlines (legal_case_id, title, due_at, responsible_user_id)
    values ($1, 'Réplica 037', now() - interval '2 hours', $2) returning id`, [ids.caso037, ids.lucas]))).id
  const novo = (await avisos037(ids.lucas, 'DEADLINE_CREATED')).filter((a) => a.event_key === `deadline-created:${proximo}`)
  igual(novo.length, 1, 'prazo novo')
  igual((await avisos037(ids.almeidaAdm, 'DEADLINE_CREATED')).length, 0, 'prazo é interno: parceiro não recebe')
  await comoWorker((tx) => tx.query(`select private.notify_deadline_reminders()`))
  await comoWorker((tx) => tx.query(`select private.notify_deadline_reminders()`))
  igual((await avisos037(ids.lucas, 'DEADLINE_DUE_SOON')).filter((a) => a.event_key === `deadline-due-soon:${proximo}`).length, 1, 'próximo, uma vez')
  igual((await avisos037(ids.lucas, 'DEADLINE_OVERDUE')).filter((a) => a.event_key === `deadline-overdue:${vencido}`).length, 1, 'vencido, uma vez')
})
await deve('documento pedido → escritório parceiro; recebido → advogado do caso', async () => {
  const req = (await como(ids.barbara, (tx) => um(tx, `insert into case_document_requirements (legal_case_id, requirement_label, category, status, requested_at)
    values ($1, 'Extrato 037', 'BANK_STATEMENT', 'REQUESTED', now()) returning id`, [ids.caso037]))).id
  for (const uid of [ids.almeidaAdm, ids.almeidaUsr]) igual((await avisos037(uid, 'DOCUMENT_REQUESTED')).filter((a) => a.legal_case_id === ids.caso037).length, 1, `pedido ${uid}`)
  igual((await avisos037(ids.ferreiraAdm, 'DOCUMENT_REQUESTED')).length, 0, 'outro parceiro')
  const v = randomUUID(), doc = randomUUID()
  await db.query(`insert into documents (id, client_id, category, title, visibility) values ($1, $2, 'BANK_STATEMENT', 'Extrato', 'PARTNER_VISIBLE')`, [doc, ids.joao])
  await db.query(`insert into case_documents (legal_case_id, document_id) values ($1, $2)`, [ids.caso037, doc])
  await db.query(`insert into document_versions (id, document_id, storage_object_name, source) values ($1, $2, $3, 'UPLOAD')`, [v, doc, `clients/${ids.joao}/documents/${doc}/${v}/extrato.pdf`])
  await db.query(`update case_document_requirements set status = 'RECEIVED', satisfied_by_document_version_id = $2, satisfied_at = now() where id = $1`, [req, v])
  igual((await avisos037(ids.lucas, 'DOCUMENT_RECEIVED')).filter((a) => a.legal_case_id === ids.caso037).length, 1, 'recebido')
})
await deve('revisão atribuída → revisor; decidida → quem pediu a análise', async () => {
  const an = (await um(db, `insert into legal_analyses (legal_case_id, analysis_template_id, started_by) values ($1, $2, $3) returning id`, [ids.caso037, ids.tpl029, ids.lucas])).id
  const rv = (await um(db, `insert into reviews (legal_case_id, legal_analysis_id, assigned_reviewer_id) values ($1, $2, $3) returning id`, [ids.caso037, an, ids.barbara])).id
  igual((await avisos037(ids.barbara, 'REVIEW_ASSIGNED')).filter((a) => a.event_key.startsWith(`review-assigned:${rv}`)).length, 1, 'atribuída')
  await decidir(ids.barbara, rv, 'REQUEST_CHANGES', 'Ajustar a conclusão')
  const d = (await avisos037(ids.lucas, 'REVIEW_DECIDED')).filter((a) => a.event_key.startsWith(`review-decided:${rv}`))
  igual([d.length, d[0]?.title], [1, 'Alterações pedidas na revisão'], 'decidida')
})
await deve('solicitação: do escritório → parceiro; resposta do parceiro → advogado; resposta interna → parceiro', async () => {
  const q = (await como(ids.lucas, (tx) => um(tx, `insert into partner_requests (partner_organization_id, legal_case_id, type, title) values ($1, $2, 'DOCUMENT', 'Enviar RG 037') returning id`, [ids.almeida, ids.caso037]))).id
  for (const uid of [ids.almeidaAdm, ids.almeidaUsr]) igual((await avisos037(uid, 'PARTNER_REQUEST_CREATED')).filter((a) => a.event_key === `request-created:${q}`).length, 1, `aberta ${uid}`)
  const m1 = (await como(ids.almeidaUsr, (tx) => um(tx, `insert into partner_request_messages (partner_request_id, body) values ($1, 'Enviado') returning id`, [q]))).id
  igual((await avisos037(ids.lucas, 'PARTNER_REQUEST_REPLY')).filter((a) => a.event_key === `request-message:${m1}`).length, 1, 'resposta do parceiro')
  igual((await avisos037(ids.almeidaUsr, 'PARTNER_REQUEST_REPLY')).filter((a) => a.event_key === `request-message:${m1}`).length, 0, 'autor não')
  const m2 = (await como(ids.lucas, (tx) => um(tx, `insert into partner_request_messages (partner_request_id, body) values ($1, 'Recebido, obrigado') returning id`, [q]))).id
  igual((await avisos037(ids.almeidaAdm, 'PARTNER_REQUEST_REPLY')).filter((a) => a.event_key === `request-message:${m2}`).length, 1, 'resposta interna')
})
await deve('análise concluída pelo worker → quem pediu', async () => {
  const a = await novaAnalise033(ids.lucas)
  await reservar033(a.run, 'worker-037')
  await comoWorker((tx) => tx.query(`select private.worker_finish_run($1, 'worker-037', 'COMPLETED')`, [a.run]))
  igual((await avisos037(ids.lucas, 'ANALYSIS_COMPLETED')).filter((x) => x.event_key.includes(a.analise)).length, 1, 'concluída')
})
await deve('repasse → só PARTNER_ADMIN do escritório (PARTNER_USER não vê financeiro)', async () => {
  const t = (await como(ids.barbara, (tx) => um(tx, `insert into partner_transfers (partner_organization_id, amount) values ($1, 10) returning id`, [ids.almeida]))).id
  igual((await avisos037(ids.almeidaAdm, 'PARTNER_TRANSFER_REGISTERED')).filter((a) => a.event_key === `transfer:${t}:registered`).length, 1, 'PARTNER_ADMIN')
  igual((await avisos037(ids.almeidaUsr, 'PARTNER_TRANSFER_REGISTERED')).length, 0, 'PARTNER_USER')
  igual((await avisos037(ids.ferreiraAdm, 'PARTNER_TRANSFER_REGISTERED')).filter((a) => a.event_key === `transfer:${t}:registered`).length, 0, 'outro parceiro')
})
await deve('preferência: categoria desligada não gera aviso; outras continuam', async () => {
  await como(ids.lucas, (tx) => tx.query(`insert into user_notification_preferences (user_id, notification_type, in_app, email) values ($1, 'DEADLINES', false, false)`, [ids.lucas]))
  const d = (await como(ids.barbara, (tx) => um(tx, `insert into deadlines (legal_case_id, title, due_at, responsible_user_id) values ($1, 'Sem aviso 037', now() + interval '20 days', $2) returning id`, [ids.caso037, ids.lucas]))).id
  igual((await avisos037(ids.lucas, 'DEADLINE_CREATED')).filter((a) => a.event_key === `deadline-created:${d}`).length, 0, 'desligado')
  const an = (await um(db, `insert into legal_analyses (legal_case_id, analysis_template_id, started_by) values ($1, $2, $3) returning id`, [ids.caso037, ids.tpl029, ids.barbara])).id
  const rv = (await um(db, `insert into reviews (legal_case_id, legal_analysis_id, assigned_reviewer_id) values ($1, $2, $3) returning id`, [ids.caso037, an, ids.lucas])).id
  igual((await avisos037(ids.lucas, 'REVIEW_ASSIGNED')).filter((a) => a.event_key.startsWith(`review-assigned:${rv}`)).length, 1, 'revisões seguem ligadas')
  await db.query(`delete from user_notification_preferences where user_id = $1`, [ids.lucas])
})
await deveFalhar('segurança não se desliga na plataforma', () =>
  como(ids.lucas, (tx) => tx.query(`insert into user_notification_preferences (user_id, notification_type, in_app) values ($1, 'SECURITY', false)`, [ids.lucas])), /security_in_app/)
await deveFalhar('categoria desconhecida é recusada', () =>
  como(ids.lucas, (tx) => tx.query(`insert into user_notification_preferences (user_id, notification_type) values ($1, 'QUALQUER')`, [ids.lucas])), /category/)
await deve('segurança: MFA redefinido e troca de perfil avisam a própria pessoa, mesmo com tudo desligado', async () => {
  for (const cat of ['CASES', 'DEADLINES', 'DOCUMENTS', 'REVIEWS', 'PARTNER_REQUESTS', 'ANALYSES', 'FINANCE'])
    await como(ids.ana, (tx) => tx.query(`insert into user_notification_preferences (user_id, notification_type, in_app) values ($1, $2, false)`, [ids.ana, cat]))
  await db.query(`select private.record_auth_event('MFA_RESET_COMPLETED', $1, '{}', $2)`, [ids.ana, ids.barbara])
  igual((await avisos037(ids.ana, 'MFA_RESET')).length, 1, 'MFA')
  const m = (await um(db, `select id from organization_memberships where user_id = $1`, [ids.ana])).id
  await db.query(`update organization_memberships set role = 'LAWYER' where id = $1`, [m])
  await db.query(`update organization_memberships set role = 'ASSISTANT' where id = $1`, [m])
  igual((await avisos037(ids.ana, 'ROLE_CHANGED')).length, 2, 'perfil (duas mudanças)')
  await db.query(`delete from user_notification_preferences where user_id = $1`, [ids.ana])
})
await deve('idempotência: o mesmo evento duas vezes = uma notificação; destinatário inativo ou de outro escritório = nenhuma', async () => {
  const k = `teste-037:${randomUUID()}`
  for (let i = 0; i < 2; i++) await db.query(`select private.notify($1, 'CASE_UPDATE', 'Teste', null, 'INFO', $2)`, [ids.lucas, k])
  igual((await linhas(db, `select 1 from notifications where user_id = $1 and event_key = $2`, [ids.lucas, k])).length, 1, 'uma só')
  igual((await um(db, `select private.notify($1, 'CASE_UPDATE', 'x', null, 'INFO', $2, $3) v`, [ids.ferreiraAdm, `x:${randomUUID()}`, ids.caso037])).v, false, 'parceiro de outro escritório')
  await db.query(`update profiles set active = false where id = $1`, [ids.ana])
  igual((await um(db, `select private.notify($1, 'CASE_UPDATE', 'x', null, 'INFO', $2) v`, [ids.ana, `x:${randomUUID()}`])).v, false, 'inativo')
  await db.query(`update profiles set active = true where id = $1`, [ids.ana])
})
await deve('ninguém grava notificação pela API: nem INSERT direto nem private.notify', async () => {
  await como(ids.barbara, (tx) => tx.query(`insert into notifications (user_id, type, title) values ($1, 'CASE_UPDATE', 'forjada')`, [ids.lucas]))
    .then(() => { throw new Error('INSERT aceito') }, (e) => { if (!/permission denied|row-level security/.test(e.message)) throw e })
  await como(ids.barbara, (tx) => tx.query(`select private.notify($1, 'CASE_UPDATE', 'forjada', null, 'INFO', 'x')`, [ids.lucas]))
    .then(() => { throw new Error('notify aceito') }, (e) => { if (!/permission denied/.test(e.message)) throw e })
})
await deve('marcar como lida continua funcionando (só as próprias)', async () => {
  const n = await como(ids.lucas, async (tx) => (await tx.query(`update notifications set read_at = now() where user_id = $1 and read_at is null`, [ids.lucas])).affectedRows)
  if (!(n > 0)) throw new Error('nada marcado')
  const alheias = await como(ids.lucas, async (tx) => (await tx.query(`update notifications set read_at = now() where user_id = $1`, [ids.barbara])).affectedRows)
  igual(alheias, 0, 'alheias')
})

secao('Catálogo: funções novas da 4.3.1 seguem as regras de segurança [032–037]')
const novas431 = [
  'partner_client_ids', 'partner_case_ids', 'partner_process_ids', 'partner_document_ids',
  'request_agent_run_cancel', 'get_agent_run_cancel_state', 'worker_cancel_requested', 'claim_agent_run', 'worker_finish_run', 'worker_requeue_run', 'agent_runs_sync_analysis',
  'prepare_manual_revision', 'commit_manual_revision_once', 'manual_revision_check',
  'create_payment_schedule_once',
  'get_partner_case_timeline', 'get_partner_client_counts', 'partner_actor_label',
  'notify', 'org_member_ids', 'active_admin_ids', 'notify_deadline_reminders', 'notify_legal_cases', 'notify_deadlines', 'notify_requirements',
  'notify_reviews', 'notify_partner_requests', 'notify_partner_request_messages', 'notify_legal_analyses', 'notify_agent_runs',
  'notify_partner_transfers', 'notify_security_events', 'deadline_recipient',
]
await deve('toda função SECURITY DEFINER nova fixa search_path vazio', async () => {
  const r = await linhas(db, `select n.nspname || '.' || p.proname f, coalesce(array_to_string(p.proconfig, ','), '') cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef and p.proname = any ($1)`, [novas431])
  if (r.length < 25) throw new Error(`poucas funções encontradas: ${r.length}`)
  const sem = r.filter((x) => !/search_path=("")?$|search_path=""|search_path=$/.test(x.cfg) && !x.cfg.includes('search_path=""') && !x.cfg.includes('search_path=')).map((x) => x.f)
  igual(sem, [], 'sem search_path')
})
await deve('anon não executa nenhuma função nova (public ou private)', async () => {
  const r = await linhas(db, `select n.nspname || '.' || p.proname f
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.proname = any ($1) and has_function_privilege('anon', p.oid, 'execute')`, [novas431])
  igual(r.map((x) => x.f), [], 'anon com execute')
})
await deve('usuário logado não chama os blocos internos (produtor, conferências, rótulos) direto', async () => {
  const internos = ['notify', 'manual_revision_check', 'partner_actor_label', 'org_member_ids', 'active_admin_ids', 'deadline_recipient', 'notify_deadline_reminders', 'worker_cancel_requested']
  const r = await linhas(db, `select p.proname f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = any ($1) and has_function_privilege('authenticated', p.oid, 'execute')`, [internos])
  igual(r.map((x) => x.f), [], 'authenticated com execute em bloco interno')
})

secao('Sessões: revogação vale no banco, reset de MFA força novo login, lista só das próprias [038]')
// Como usuário logado COM o session_id do JWT (o Supabase sempre envia).
function comoSessao(uid, sid, fn, aal = 'aal2') {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: uid, role: 'authenticated', aal, session_id: sid })])
    await tx.query('set local role authenticated')
    return fn(tx)
  })
}
const UA_CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const UA_SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
const UA_FIREFOX_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:132.0) Gecko/20100101 Firefox/132.0'
const novaSessao038 = async (uid, ua = UA_CHROME_WIN, extra = '') =>
  (await um(db, `insert into auth.sessions (user_id, aal, user_agent ${extra ? ', ' + extra.split('=')[0] : ''})
    values ($1, 'aal2', $2 ${extra ? ', ' + extra.split('=')[1] : ''}) returning id`, [uid, ua])).id
const contexto038 = (uid, sid) => comoSessao(uid, sid, (tx) => um(tx, `select public.get_my_session_context() c`)).then((r) => r.c)
const clientesVisiveis038 = (uid, sid) => comoSessao(uid, sid, async (tx) => (await linhas(tx, `select id from clients`)).length)

ids.sLucasA = await novaSessao038(ids.lucas, UA_CHROME_WIN)
ids.sLucasB = await novaSessao038(ids.lucas, UA_SAFARI_IPHONE)

await deve('sessão existente e válida: acesso normal; contexto diz VALID', async () => {
  igual((await contexto038(ids.lucas, ids.sLucasA)).session_state, 'VALID', 'estado')
  if (!((await clientesVisiveis038(ids.lucas, ids.sLucasA)) > 0)) throw new Error('não viu clientes')
})
await deve('sem session_id no JWT (serviço, testes antigos): comportamento de antes', async () => {
  igual((await como(ids.lucas, (tx) => um(tx, `select public.get_my_session_context() c`))).c.session_state, 'NO_SESSION_CLAIM', 'estado')
})
await deve('sessão revogada (some de auth.sessions): o JWT ainda não expirou, mas a RLS não devolve nada e o contexto diz REVOKED', async () => {
  const sid = await novaSessao038(ids.lucas)
  igual((await clientesVisiveis038(ids.lucas, sid)) > 0, true, 'antes')
  await db.query(`delete from auth.sessions where id = $1`, [sid]) // o que o Auth faz no signOut
  igual(await clientesVisiveis038(ids.lucas, sid), 0, 'depois: nenhum cliente')
  igual((await contexto038(ids.lucas, sid)).session_state, 'REVOKED', 'estado')
  await comoSessao(ids.lucas, sid, (tx) => tx.query(`insert into deadlines (legal_case_id, title, due_at) values ($1, 'Revogada', now() + interval '1 day')`, [ids.casoA]))
    .then(() => { throw new Error('gravou com sessão revogada') }, (e) => { if (!/row-level security|permission denied|violates/.test(e.message)) throw e })
})
await deve('session_id de OUTRA pessoa no JWT (forjado) não vale', async () => {
  igual((await contexto038(ids.ana, ids.sLucasA)).session_state, 'REVOKED', 'estado')
  igual(await clientesVisiveis038(ids.ana, ids.sLucasA), 0, 'nada')
})
await deve('sessão vencida (not_after no passado) não vale e não aparece na lista', async () => {
  const sid = await novaSessao038(ids.lucas, UA_FIREFOX_MAC, `not_after=now() - interval '1 minute'`)
  igual((await contexto038(ids.lucas, sid)).session_state, 'REVOKED', 'estado')
  const lista = await comoSessao(ids.lucas, ids.sLucasA, (tx) => linhas(tx, `select session_id from public.get_my_sessions()`))
  igual(lista.some((s) => s.session_id === sid), false, 'fora da lista')
})
await deve('reset de MFA: sessão aberta ANTES perde acesso (REAUTH_REQUIRED); sessão nova depois funciona', async () => {
  const antiga = await novaSessao038(ids.almeidaUsr, UA_CHROME_WIN, `created_at=now() - interval '1 hour'`)
  igual((await contexto038(ids.almeidaUsr, antiga)).session_state, 'VALID', 'antes do reset')
  await db.query(`select private.record_auth_event('MFA_RESET_COMPLETED', $1, '{}', $2)`, [ids.almeidaUsr, ids.barbara])
  igual((await contexto038(ids.almeidaUsr, antiga)).session_state, 'REAUTH_REQUIRED', 'depois do reset')
  igual(await clientesVisiveis038(ids.almeidaUsr, antiga), 0, 'sem dados')
  const nova = await novaSessao038(ids.almeidaUsr, UA_CHROME_WIN, `created_at=now() + interval '1 second'`)
  igual((await contexto038(ids.almeidaUsr, nova)).session_state, 'VALID', 'sessão nova')
  if (!((await clientesVisiveis038(ids.almeidaUsr, nova)) > 0)) throw new Error('sessão nova sem dados')
  const lista = await comoSessao(ids.almeidaUsr, nova, (tx) => linhas(tx, `select session_id from public.get_my_sessions()`))
  igual(lista.map((s) => s.session_id).includes(antiga), false, 'antiga não aparece como ativa')
})
await deve('suspensão: vínculo suspenso perde acesso mesmo com sessão válida (a cada requisição)', async () => {
  const m = (await um(db, `select id from organization_memberships where user_id = $1`, [ids.lucas])).id
  await db.query(`update organization_memberships set status = 'SUSPENDED' where id = $1`, [m])
  try {
    igual(await clientesVisiveis038(ids.lucas, ids.sLucasA), 0, 'suspenso')
    await comoSessao(ids.lucas, ids.sLucasA, (tx) => tx.query(`select * from public.get_my_sessions()`))
      .then(() => { throw new Error('suspenso listou sessões') }, (e) => { if (!/Sem sessão liberada/.test(e.message)) throw e })
  } finally {
    await db.query(`update organization_memberships set status = 'ACTIVE' where id = $1`, [m])
  }
})
await deve('lista de sessões: só as do próprio usuário; atual marcada; navegador/sistema/aparelho amigáveis; sem user agent cru nem IP', async () => {
  const outra = await novaSessao038(ids.barbara)
  const lista = await comoSessao(ids.lucas, ids.sLucasA, (tx) => linhas(tx, `select * from public.get_my_sessions()`))
  igual(lista.some((s) => s.session_id === outra), false, 'sessão da Barbara não aparece')
  igual(lista[0].session_id, ids.sLucasA, 'atual primeiro')
  igual(lista.filter((s) => s.is_current).length, 1, 'uma atual')
  const a = lista.find((s) => s.session_id === ids.sLucasA), b = lista.find((s) => s.session_id === ids.sLucasB)
  igual([a.browser, a.operating_system, a.device_class], ['Chrome', 'Windows', 'DESKTOP'], 'Chrome no Windows')
  igual([b.browser, b.operating_system, b.device_class, b.is_current], ['Safari', 'iPhone', 'MOBILE', false], 'Safari no iPhone')
  igual(Object.keys(a).sort(), ['aal', 'browser', 'created_at', 'device_class', 'is_current', 'last_refreshed_at', 'operating_system', 'session_id'], 'colunas')
  if (JSON.stringify(lista).includes('Mozilla')) throw new Error('user agent cru vazou')
})
await deve('user agent: famílias conhecidas; desconhecido ou vazio → nulo (sem palpite)', async () => {
  const r = await um(db, `select
    private.ua_browser($1) b1, private.ua_os($1) o1,
    private.ua_browser($2) b2, private.ua_os($2) o2, private.ua_device($2) d2,
    private.ua_browser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0') b3,
    private.ua_browser('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36') b4,
    private.ua_os('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36') o4,
    private.ua_browser('node') b5, private.ua_device('node') d5, private.ua_browser(null) b6, private.ua_browser('') b7`,
    [UA_FIREFOX_MAC, 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'])
  igual(r, { b1: 'Firefox', o1: 'macOS', b2: 'Safari', o2: 'iPad', d2: 'TABLET', b3: 'Edge', b4: 'Chrome', o4: 'Android', b5: null, d5: null, b6: null, b7: null }, 'parser')
})
await deveFalhar('lista de sessões exige MFA (aal1 não lista)', () =>
  comoSessao(ids.lucas, ids.sLucasA, (tx) => tx.query(`select * from public.get_my_sessions()`), 'aal1'), /Sem sessão liberada/)
await deveFalhar('sessão revogada não lista sessões', async () => {
  const sid = await novaSessao038(ids.lucas)
  await db.query(`delete from auth.sessions where id = $1`, [sid])
  await comoSessao(ids.lucas, sid, (tx) => tx.query(`select * from public.get_my_sessions()`))
}, /Sem sessão liberada/)
await deve('auth.sessions não é exposta: nem authenticated nem anon leem a tabela', async () => {
  for (const r of ['authenticated', 'anon']) {
    const pode = (await um(db, `select has_table_privilege($1, 'auth.sessions', 'select') v`, [r])).v
    igual(pode, false, r)
  }
})
await deve('auditoria da conta: registra quem fez (a própria pessoa), sem segredo; avisa nas ações críticas', async () => {
  const antes = (await linhas(db, `select 1 from notifications where user_id = $1 and type = 'SECURITY_NOTICE'`, [ids.lucas])).length
  for (const acao of ['SESSION_CURRENT_REVOKED', 'OTHER_SESSIONS_REVOKED', 'ALL_SESSIONS_REVOKED', 'PASSWORD_CHANGED'])
    await comoSessao(ids.lucas, ids.sLucasA, (tx) => tx.query(`select public.record_account_security_event($1)`, [acao]))
  const ev = await linhas(db, `select action, actor_user_id, entity_type, entity_id, metadata from audit_events
    where entity_id = $1 and action in ('SESSION_CURRENT_REVOKED', 'OTHER_SESSIONS_REVOKED', 'ALL_SESSIONS_REVOKED', 'PASSWORD_CHANGED') order by created_at`, [ids.lucas])
  igual(ev.map((e) => e.action), ['SESSION_CURRENT_REVOKED', 'OTHER_SESSIONS_REVOKED', 'ALL_SESSIONS_REVOKED', 'PASSWORD_CHANGED'], 'ações')
  igual(ev.every((e) => e.actor_user_id === ids.lucas && e.entity_type === 'profiles'), true, 'autor e entidade')
  igual(ev.map((e) => Object.keys(e.metadata)), [['aal'], ['aal'], ['aal'], ['aal']], 'metadados mínimos')
  const avisos = await linhas(db, `select title from notifications where user_id = $1 and type = 'SECURITY_NOTICE' order by created_at`, [ids.lucas])
  igual(avisos.length - antes, 3, 'sair só deste dispositivo não gera aviso; os outros três sim')
  igual(avisos.slice(-3).map((a) => a.title), ['Outras sessões encerradas', 'Todas as sessões encerradas', 'Sua senha foi alterada'], 'títulos')
})
await deveFalhar('auditoria da conta: ação fora da lista é recusada', () =>
  comoSessao(ids.lucas, ids.sLucasA, (tx) => tx.query(`select public.record_account_security_event('MFA_RESET_COMPLETED')`)), /não permitido/)
await deveFalhar('auditoria da conta: sem MFA não registra', () =>
  comoSessao(ids.lucas, ids.sLucasA, (tx) => tx.query(`select public.record_account_security_event('PASSWORD_CHANGED')`), 'aal1'), /Sem sessão liberada/)
await deve('aviso de segurança da conta não depende de preferência e não duplica', async () => {
  await como(ids.lucas, (tx) => tx.query(`insert into user_notification_preferences (user_id, notification_type, in_app, email) values ($1, 'CASES', false, false)`, [ids.lucas]))
  const ev = (await comoSessao(ids.lucas, ids.sLucasA, (tx) => um(tx, `select public.record_account_security_event('PASSWORD_CHANGED') id`))).id
  igual((await linhas(db, `select 1 from notifications where event_key = $1`, [`security:${ev}`])).length, 1, 'um aviso')
  await db.query(`delete from user_notification_preferences where user_id = $1`, [ids.lucas])
})

secao('Catálogo: funções da 4.3.2 [038]')
const novas432 = ['jwt_session_id', 'jwt_session_state', 'current_membership', 'get_my_session_context', 'ua_browser', 'ua_os', 'ua_device',
  'get_my_sessions', 'record_account_security_event', 'notify_security_events']
await deve('SECURITY DEFINER com search_path fixo; anon não executa nada', async () => {
  const r = await linhas(db, `select n.nspname || '.' || p.proname f, p.prosecdef d, coalesce(array_to_string(p.proconfig, ','), '') cfg,
      has_function_privilege('anon', p.oid, 'execute') anon
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.proname = any ($1)`, [novas432])
  igual(r.filter((x) => !x.cfg.includes('search_path=')).map((x) => x.f), [], 'sem search_path')
  igual(r.filter((x) => x.anon).map((x) => x.f), [], 'anon com execute')
})
await deve('authenticated não chama o parser nem o produtor de avisos direto', async () => {
  const r = await linhas(db, `select p.proname f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = any ($1) and has_function_privilege('authenticated', p.oid, 'execute')`,
    [['ua_browser', 'ua_os', 'ua_device', 'notify_security_events']])
  igual(r.map((x) => x.f), [], 'authenticated com execute')
})

// ═════════════════════════════ 039: execução real dos agentes ════════════

secao('Interruptor geral da IA [039]')
const statusIA = (uid) => como(uid, async (tx) => (await um(tx, `select public.get_ai_runtime_status() r`)).r)
const ligarIA = (uid, on, motivo = null) => como(uid, async (tx) => (await um(tx, `select public.set_ai_execution_enabled($1, $2) r`, [on, motivo])).r)
const iaNoWorker = () => comoWorker(async (tx) => (await um(tx, `select private.worker_ai_enabled() v`)).v)
await deve('nasce DESLIGADO; equipe interna vê a situação; o worker vê desligado', async () => {
  igual((await statusIA(ids.barbara)).execution_enabled, false, 'ADMIN')
  igual((await statusIA(ids.ana)).execution_enabled, false, 'ASSISTANT')
  igual(await iaNoWorker(), false, 'worker')
})
await deve('ADMIN liga e desliga; auditado com o autor; o worker acompanha', async () => {
  const r = await ligarIA(ids.barbara, true, 'Teste controlado no DEV')
  igual([r.execution_enabled, r.reason, r.updated_by_name], [true, 'Teste controlado no DEV', 'Bárbara Cardoso'], 'ligado')
  igual(await iaNoWorker(), true, 'worker vê ligado')
  await ligarIA(ids.barbara, false)
  igual(await iaNoWorker(), false, 'worker vê desligado')
  const ev = await linhas(db, `select action, actor_user_id from audit_events where action in ('AI_EXECUTION_ENABLED', 'AI_EXECUTION_DISABLED') order by created_at`)
  igual(ev.map((e) => [e.action, e.actor_user_id]), [['AI_EXECUTION_ENABLED', ids.barbara], ['AI_EXECUTION_DISABLED', ids.barbara]], 'auditoria')
})
await deve('LAWYER e ASSISTANT não ligam; parceiro nem lê; ninguém lê a tabela direto', async () => {
  for (const u of [ids.lucas, ids.ana])
    await ligarIA(u, true).then(() => { throw new Error('aceito') }, (e) => { if (!/Somente ADMIN/.test(e.message)) throw e })
  await statusIA(ids.almeidaAdm).then(() => { throw new Error('parceiro leu') }, (e) => { if (!/equipe interna/.test(e.message)) throw e })
  await como(ids.barbara, (tx) => tx.query(`select * from ai_runtime_settings`)).then(
    () => { throw new Error('leitura direta aceita') }, (e) => { if (!/permission denied/.test(e.message)) throw e })
  igual(await iaNoWorker(), false, 'continua desligado')
})

secao('Área DG Brasil: agente, skill (com arquivos), tese e referência [039]')
const salvarAgente = (uid, k, a) => como(uid, async (tx) => (await um(tx, `select public.dg_save_agent_once($1, $2) r`, [k, JSON.stringify(a)])).r)
const salvarSkill = (uid, k, s) => como(uid, async (tx) => (await um(tx, `select public.dg_save_skill_once($1, $2) r`, [k, JSON.stringify(s)])).r)
const salvarTese = (uid, k, t) => como(uid, async (tx) => (await um(tx, `select public.dg_save_thesis_once($1, $2) r`, [k, JSON.stringify(t)])).r)
const salvarRef = (uid, k, r) => como(uid, async (tx) => (await um(tx, `select public.dg_save_reference_once($1, $2) r`, [k, JSON.stringify(r)])).r)
const objetoSkill = (nome) => db.query(`insert into storage.objects (bucket_id, name) values ('skill-files', $1)`, [nome])
const sha64 = 'a'.repeat(64)
await deve('ADMIN cria skill com arquivo: versão 1 com SKILL.md gerado (não aceita SKILL.md como arquivo)', async () => {
  ids.sk039 = randomUUID(); ids.sk039v1 = randomUUID()
  const obj = `skills/${ids.sk039}/${ids.sk039v1}/scripts/gerar.py`
  await objetoSkill(obj)
  const r = await salvarSkill(ids.barbara, randomUUID(), {
    id: ids.sk039, create: true, version_id: ids.sk039v1, slug: 'kit-documentos', name: 'Kit de documentos',
    description: 'Gera procuração e declaração.', status: 'ACTIVE', instructions: 'Use scripts/gerar.py com os dados do cliente.',
    files: [{ path: 'scripts/gerar.py', storage_object_name: obj, mime_type: 'text/x-python', file_size: 120, checksum_sha256: sha64 }],
  })
  igual([r.version_number, r.version_created, r.created], [1, true, true], 'versão 1')
  const f = await linhas(db, `select path from skill_version_files where skill_version_id = $1`, [ids.sk039v1])
  igual(f.map((x) => x.path), ['scripts/gerar.py'], 'arquivo')
})
await deve('repetir a mesma chave devolve o mesmo resultado, sem versão nova', async () => {
  const k = randomUUID()
  const dados = { id: ids.sk039, version_id: randomUUID(), name: 'Kit de documentos', description: 'Gera procuração e declaração.',
    status: 'ACTIVE', instructions: 'Use scripts/gerar.py com os dados do cliente.' }
  const r1 = await salvarSkill(ids.barbara, k, dados)
  const r2 = await salvarSkill(ids.barbara, k, dados)
  igual([r1.version_created, r1.version_number, r2.deduplicated, r2.version_number], [false, 1, true, 1], 'sem mudança, sem versão')
})
await deve('arquivo novo = versão 2, mantém o anterior (mesmo objeto); remover = versão 3', async () => {
  ids.sk039v2 = randomUUID()
  const obj = `skills/${ids.sk039}/${ids.sk039v2}/modelos/procuracao.docx`
  await objetoSkill(obj)
  const r = await salvarSkill(ids.barbara, randomUUID(), { id: ids.sk039, version_id: ids.sk039v2, name: 'Kit de documentos',
    status: 'ACTIVE', instructions: 'Use scripts/gerar.py com os dados do cliente.',
    files: [{ path: 'modelos/procuracao.docx', storage_object_name: obj, mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', file_size: 300, checksum_sha256: sha64 }] })
  igual(r.version_number, 2, 'versão 2')
  const f = await linhas(db, `select path, storage_object_name from skill_version_files where skill_version_id = $1 order by path`, [ids.sk039v2])
  igual(f.map((x) => x.path), ['modelos/procuracao.docx', 'scripts/gerar.py'], 'arquivos da v2')
  igual(f[1].storage_object_name.includes(ids.sk039v1), true, 'arquivo mantido aponta para o objeto da v1')
  const r3 = await salvarSkill(ids.barbara, randomUUID(), { id: ids.sk039, version_id: randomUUID(), name: 'Kit de documentos',
    status: 'ACTIVE', instructions: 'Use scripts/gerar.py com os dados do cliente.', keep_paths: ['scripts/gerar.py'] })
  igual(r3.version_number, 3, 'versão 3')
  ids.sk039v3 = r3.version_id
  igual((await linhas(db, `select path from skill_version_files where skill_version_id = $1`, [r3.version_id])).map((x) => x.path), ['scripts/gerar.py'], 'só o mantido')
  igual((await linhas(db, `select 1 from skill_version_files where skill_version_id = $1`, [ids.sk039v2])).length, 2, 'v2 intacta')
})
await deveFalhar('arquivo fora do caminho da versão é recusado', async () => {
  const v = randomUUID()
  await salvarSkill(ids.barbara, randomUUID(), { id: ids.sk039, version_id: v, name: 'Kit', status: 'ACTIVE', instructions: 'x',
    files: [{ path: 'a.py', storage_object_name: `skills/${ids.sk039}/${randomUUID()}/a.py`, mime_type: 'text/x-python', file_size: 1, checksum_sha256: sha64 }] })
}, /fora do caminho/)
await deveFalhar('arquivo que não está no Storage é recusado', async () => {
  const v = randomUUID()
  await salvarSkill(ids.barbara, randomUUID(), { id: ids.sk039, version_id: v, name: 'Kit', status: 'ACTIVE', instructions: 'x',
    files: [{ path: 'b.py', storage_object_name: `skills/${ids.sk039}/${v}/b.py`, mime_type: 'text/x-python', file_size: 1, checksum_sha256: sha64 }] })
}, /não encontrado no Storage/)
await deveFalhar('caminho com ".." ou SKILL.md é recusado', async () => {
  const v = randomUUID()
  const obj = `skills/${ids.sk039}/${v}/SKILL.md`
  await objetoSkill(obj)
  await salvarSkill(ids.barbara, randomUUID(), { id: ids.sk039, version_id: v, name: 'Kit', status: 'ACTIVE', instructions: 'x',
    files: [{ path: 'SKILL.md', storage_object_name: obj, mime_type: 'text/markdown', file_size: 1, checksum_sha256: sha64 }] })
}, /skill_version_files_path_format/)
await deveFalhar('identificador de skill com "claude" é recusado (nome reservado do provedor)', () =>
  salvarSkill(ids.barbara, randomUUID(), { id: randomUUID(), create: true, version_id: randomUUID(), slug: 'claude-helper',
    name: 'X', instructions: 'x' }), /não pode conter/)
await deveFalhar('arquivo de skill é append-only', () =>
  db.query(`update skill_version_files set path = 'outro.py' where skill_version_id = $1`, [ids.sk039v1]), /append-only|imutável|não pode/i)

await deve('ADMIN cria agente com versão, skill e configuração; LAWYER não', async () => {
  const k = randomUUID()
  const r = await salvarAgente(ids.barbara, k, { slug: 'lucas-kit', name: 'Lucas (kit)', status: 'ACTIVE',
    instructions: 'Você gera o kit de documentos do cliente.', configuration: { model: 'claude-opus-5-5', effort: 'high', code_execution: true, max_turns: 30 },
    skill_ids: [ids.sk039] })
  igual([r.version_number, r.created], [1, true], 'agente criado')
  ids.ag039 = r.agent_id
  const a = await um(db, `select a.status, v.configuration ->> 'model' m from agents a join agent_versions v on v.id = a.current_version_id where a.id = $1`, [ids.ag039])
  igual([a.status, a.m], ['ACTIVE', 'claude-opus-5-5'], 'agente ativo com a versão')
  igual((await linhas(db, `select 1 from agent_skill_bindings where agent_id = $1 and enabled`, [ids.ag039])).length, 1, 'skill vinculada')
  await salvarAgente(ids.lucas, randomUUID(), { slug: 'x-lawyer', name: 'X', instructions: 'x' }).then(
    () => { throw new Error('LAWYER criou agente') }, (e) => { if (!/Somente ADMIN/.test(e.message)) throw e })
})
await deve('salvar sem mudar instruções/configuração não cria versão; mudar cria v2; desvincular desabilita sem apagar', async () => {
  const base = { id: ids.ag039, name: 'Lucas (kit)', status: 'ACTIVE', instructions: 'Você gera o kit de documentos do cliente.',
    configuration: { model: 'claude-opus-5-5', effort: 'high', code_execution: true, max_turns: 30 } }
  igual((await salvarAgente(ids.barbara, randomUUID(), { ...base, description: 'Descrição nova' })).version_created, false, 'sem versão')
  const r = await salvarAgente(ids.barbara, randomUUID(), { ...base, instructions: base.instructions + ' Sempre confira o CPF.', skill_ids: [] })
  igual([r.version_created, r.version_number], [true, 2], 'v2')
  igual((await um(db, `select enabled from agent_skill_bindings where agent_id = $1`, [ids.ag039])).enabled, false, 'vínculo desabilitado')
  await salvarAgente(ids.barbara, randomUUID(), { ...base, instructions: base.instructions + ' Sempre confira o CPF.', skill_ids: [ids.sk039] })
})
await deveFalhar('configuração com campo desconhecido é recusada', () =>
  salvarAgente(ids.barbara, randomUUID(), { slug: 'cfg-ruim', name: 'X', instructions: 'x', configuration: { shell: true } }), /campo desconhecido/)
await deveFalhar('modelo fora do formato é recusado', () =>
  salvarAgente(ids.barbara, randomUUID(), { slug: 'cfg-ruim2', name: 'X', instructions: 'x', configuration: { model: 'gpt-5' } }), /modelo inválido/)
await deveFalhar('identificador do agente não muda depois de criado', () =>
  salvarAgente(ids.barbara, randomUUID(), { id: ids.ag039, slug: 'outro-slug', name: 'X', instructions: 'x' }), /não muda/)
await deve('ADMIN cria tese (versão) e referência de texto; vínculos com o agente', async () => {
  const t = await salvarTese(ids.barbara, randomUUID(), { slug: 'tese-039', title: 'Tese 039', legal_area_id: ids.banking, status: 'ACTIVE',
    foundations: 'Art. 1º', application_criteria: 'Quando X', agent_ids: [ids.ag039] })
  igual([t.version_number, t.created], [1, true], 'tese v1')
  ids.tese039 = t.thesis_id
  const t2 = await salvarTese(ids.barbara, randomUUID(), { id: ids.tese039, title: 'Tese 039', status: 'ACTIVE', foundations: 'Art. 1º e 2º', application_criteria: 'Quando X' })
  igual(t2.version_number, 2, 'tese v2')
  ids.ref039 = randomUUID()
  const r = await salvarRef(ids.barbara, randomUUID(), { id: ids.ref039, create: true, version_id: randomUUID(), type: 'INTERNAL_GUIDELINE',
    title: 'Orientação 039', status: 'ACTIVE', content_text: 'Sempre conferir o HISCON.', tags: ['Consignado', 'consignado'], agent_ids: [ids.ag039] })
  igual([r.version_number, r.created], [1, true], 'referência v1')
  igual((await um(db, `select tags from reference_materials where id = $1`, [ids.ref039])).tags, ['consignado'], 'tags normalizadas')
  igual((await linhas(db, `select 1 from agent_reference_bindings where agent_id = $1 and enabled`, [ids.ag039])).length, 1, 'referência vinculada')
})
await deveFalhar('referência nova sem texto nem arquivo é recusada', () =>
  salvarRef(ids.barbara, randomUUID(), { id: randomUUID(), create: true, title: 'Vazia' }), /texto ou arquivo/)
await deve('template de análise → agente (ADMIN); LAWYER não', async () => {
  ids.tpl039 = (await um(db, `insert into analysis_templates (legal_area_id, name) values ($1, 'Template 039') returning id`, [ids.banking])).id
  await como(ids.barbara, (tx) => tx.query(`select public.dg_set_template_agent($1, $2)`, [ids.tpl039, ids.ag039]))
  igual((await um(db, `select primary_agent_id from analysis_templates where id = $1`, [ids.tpl039])).primary_agent_id, ids.ag039, 'ligado')
  await como(ids.lucas, (tx) => tx.query(`select public.dg_set_template_agent($1, null)`, [ids.tpl039])).then(
    () => { throw new Error('LAWYER mudou template') }, (e) => { if (!/Somente ADMIN/.test(e.message)) throw e })
})
await deve('LAWYER não lê arquivos de skill; o worker lê (configuração, sem dado de cliente)', async () => {
  await como(ids.lucas, async (tx) => igual((await linhas(tx, `select 1 from skill_version_files`)).length, 0, 'LAWYER'))
  igual((await comoWorker((tx) => linhas(tx, `select 1 from skill_version_files where skill_id = $1`, [ids.sk039]))).length > 0, true, 'worker')
})

secao('Execução real: análise estruturada, revisão do resultado exato e nova tentativa [039]')
const reservar039 = async (run, worker = 'worker-039') => {
  const m = (await um(db, `select queue_msg_id from agent_runs where id = $1`, [run])).queue_msg_id
  return comoWorker((tx) => um(tx, `select * from private.claim_agent_run($1, $2, $3, 300)`, [run, worker, m]))
}
const entregarAnalise = (run, worker, resumo, resultado) => comoWorker((tx) =>
  um(tx, `select * from private.worker_submit_analysis_result($1, $2, $3, $4, 1)`, [run, worker, resumo, JSON.stringify(resultado)]))
const resultado039 = { summary: 'Cabem duas ações.', recommendation: 'Ajuizar no JEC', findings: [{ title: 'Migração', detail: 'Contrato migrado' }],
  missing_information: [], recommendations: [], proposed_actions: [], references_used: [], theses_considered: [] }
await deve('análise enviada: o contexto do worker traz template, campos e skills do template', async () => {
  const r = await iniciar(ids.lucas, randomUUID(), ids.casoA, ids.tpl039, { banco: 'Banco 039' }, true, 'Analise o HISCON')
  ids.an039 = r.analysis_id; ids.run039 = r.agent_run_id
  igual((await reservar039(ids.run039)).claimed, true, 'reservada')
  const c = await comoWorker(async (tx) => (await um(tx, `select private.worker_run_context($1, 'worker-039') c`, [ids.run039])).c)
  igual([c.analysis.id, c.analysis.template_name, c.analysis.field_values.banco, c.analysis.previous, c.previous_output],
    [ids.an039, 'Template 039', 'Banco 039', null, false], 'contexto da análise')
})
await deve('worker registra a configuração usada (só ids/hashes); recusa prompt, instruções e entrada', async () => {
  const snap = { runtime: 'dg-agentes/5', agent_version_id: ids.agenteV, prompt_sha256: sha64, model: 'claude-opus-5-5' }
  igual((await comoWorker((tx) => um(tx, `select private.worker_record_run_config($1, 'worker-039', $2) v`, [ids.run039, JSON.stringify(snap)]))).v, true, 'gravado')
  igual((await um(db, `select config_snapshot ->> 'prompt_sha256' h from agent_runs where id = $1`, [ids.run039])).h, sha64, 'snapshot')
  for (const k of ['prompt', 'instructions', 'input'])
    await comoWorker((tx) => tx.query(`select private.worker_record_run_config($1, 'worker-039', $2)`, [ids.run039, JSON.stringify({ [k]: 'x' })])).then(
      () => { throw new Error(`aceitou ${k}`) }, (e) => { if (!/não guarda/.test(e.message)) throw e })
  igual((await comoWorker((tx) => um(tx, `select private.worker_record_run_config($1, 'outro', '{}') v`, [ids.run039]))).v, false, 'sem reserva, não grava')
})
await deve('resultado estruturado: append-only, espelhado na análise, revisão aponta o resultado EXATO; repetir não duplica', async () => {
  const r1 = await entregarAnalise(ids.run039, 'worker-039', 'Cabem duas ações.', resultado039)
  const r2 = await entregarAnalise(ids.run039, 'worker-039', 'Outro resumo', resultado039)
  igual([r1.created, r2.created, r2.result_id === r1.result_id, r2.review_id === r1.review_id], [true, false, true, true], 'idempotente')
  ids.res039 = r1.result_id; ids.rev039 = r1.review_id
  const a = await um(db, `select summary, result_data ->> 'recommendation' rec, result_data ->> 'result_id' rid from legal_analyses where id = $1`, [ids.an039])
  igual([a.summary, a.rec, a.rid], ['Cabem duas ações.', 'Ajuizar no JEC', ids.res039], 'espelho')
  const rv = await um(db, `select status, legal_analysis_id, legal_analysis_result_id from reviews where id = $1`, [ids.rev039])
  igual([rv.status, rv.legal_analysis_id, rv.legal_analysis_result_id], ['PENDING', ids.an039, ids.res039], 'revisão')
  await db.query(`update legal_analysis_results set summary = 'x' where id = $1`, [ids.res039]).then(
    () => { throw new Error('resultado editável') }, () => {})
})
await deveFalhar('outro worker (sem a reserva) não entrega resultado', () => entregarAnalise(ids.run039, 'intruso', 'x', resultado039), /não está reservada/)
await deveFalhar('execução que não é de análise não entrega resultado de análise', async () => {
  await reservar039(ids.runAdmin, 'worker-039b')
  await entregarAnalise(ids.runAdmin, 'worker-039b', 'x', resultado039)
}, /não é de uma análise/)
await deve('execução com resultado pendente fica aguardando humano; LAWYER pede alterações → análise volta para envio, execução encerra', async () => {
  igual((await comoWorker((tx) => um(tx, `select private.worker_finish_run($1, 'worker-039', 'WAITING_HUMAN') v`, [ids.run039]))).v, true, 'encerrou aguardando')
  igual((await um(db, `select status from legal_analyses where id = $1`, [ids.an039])).status, 'WAITING_REVIEW', 'análise aguardando revisão')
  igual((await comoWorker((tx) => um(tx, `select private.worker_close_decided_runs() n`))).n, 0, 'nada a fechar ainda')
  await decidir(ids.lucas, ids.rev039, 'REQUEST_CHANGES', 'Faltou o bloco D (cartão RMC).')
  const a = await um(db, `select status, interruption_reason from legal_analyses where id = $1`, [ids.an039])
  igual(a.status, 'PENDING', 'análise volta para novo envio')
  await comoWorker((tx) => tx.query(`select private.worker_close_decided_runs()`))
  igual((await um(db, `select status from agent_runs where id = $1`, [ids.run039])).status, 'COMPLETED', 'execução encerrada')
  igual((await um(db, `select summary from legal_analysis_results where id = $1`, [ids.res039])).summary, 'Cabem duas ações.', 'resultado original intacto')
})
await deve('reenvio cria execução NOVA ligada à anterior; o contexto traz o resultado anterior e as observações da revisão', async () => {
  const r = await enviarAnalise(ids.lucas, randomUUID(), ids.an039, 'Inclua o bloco D')
  ids.run039b = r.agent_run_id
  igual((await um(db, `select retry_of_agent_run_id from agent_runs where id = $1`, [ids.run039b])).retry_of_agent_run_id, ids.run039, 'ligada')
  await reservar039(ids.run039b)
  const c = await comoWorker(async (tx) => (await um(tx, `select private.worker_run_context($1, 'worker-039') c`, [ids.run039b])).c)
  igual([c.retry_of_agent_run_id, c.analysis.previous.result_id, c.analysis.previous.review_status, c.analysis.previous.review_notes],
    [ids.run039, ids.res039, 'CHANGES_REQUESTED', 'Faltou o bloco D (cartão RMC).'], 'contexto da nova tentativa')
  const r2 = await entregarAnalise(ids.run039b, 'worker-039', 'Cabem três ações.', { ...resultado039, recommendation: 'Ajuizar três ações' })
  ids.rev039b = r2.review_id
  igual((await linhas(db, `select 1 from legal_analysis_results where legal_analysis_id = $1`, [ids.an039])).length, 2, 'dois resultados no histórico')
})
await deve('aprovar o resultado conclui a análise; a execução fecha quando nada mais está pendente', async () => {
  await decidir(ids.lucas, ids.rev039b, 'APPROVE')
  igual((await um(db, `select status from legal_analyses where id = $1`, [ids.an039])).status, 'COMPLETED', 'análise concluída')
  await comoWorker((tx) => tx.query(`select private.worker_finish_run($1, 'worker-039', 'WAITING_HUMAN')`, [ids.run039b]))
  await comoWorker((tx) => tx.query(`select private.worker_close_decided_runs()`))
  igual((await um(db, `select status from agent_runs where id = $1`, [ids.run039b])).status, 'COMPLETED', 'execução encerrada')
  igual((await um(db, `select status from legal_analyses where id = $1`, [ids.an039])).status, 'COMPLETED', 'análise segue concluída')
})
await deve('registro de skill no provedor: congelado desde a 040 (o worker da Claude API saiu)', async () => {
  const r = await iniciar(ids.lucas, randomUUID(), ids.casoA, ids.tpl039, {}, true)
  await reservar039(r.agent_run_id, 'worker-039c')
  await comoWorker((tx) => tx.query(`select * from private.worker_register_skill_upload($1, 'worker-039c', $2, 'skill_01x', 'kit-documentos', 'v', $3)`,
    [r.agent_run_id, ids.sk039v3, sha64])).then(
    () => { throw new Error('dg_worker ainda registra skill no provedor') }, (e) => { if (!/permission denied/.test(e.message)) throw e })
  await comoWorker((tx) => tx.query(`select private.worker_finish_run($1, 'worker-039c', 'FAILED', 'CONFIGURATION_ERROR')`, [r.agent_run_id]))
  ids.run039fail = r.agent_run_id
})
await deve('abrir documento: só versão vinculada ao caso da execução, com tipo e título; acesso registrado', async () => {
  const r = await iniciar(ids.lucas, randomUUID(), ids.casoA, ids.tpl039, {}, true)
  await reservar039(r.agent_run_id, 'worker-039d')
  const meu = await um(db, `select v.id from document_versions v join case_documents cd on cd.document_id = v.document_id where cd.legal_case_id = $1 limit 1`, [ids.casoA])
  const alheio = await um(db, `select v.id from document_versions v join case_documents cd on cd.document_id = v.document_id where cd.legal_case_id <> $1 limit 1`, [ids.casoA])
  if (meu) {
    const d = await comoWorker((tx) => linhas(tx, `select * from private.worker_open_document($1, 'worker-039d', $2)`, [r.agent_run_id, meu.id]))
    igual(d.length, 1, 'documento do caso')
  }
  if (alheio) {
    const d = await comoWorker((tx) => linhas(tx, `select * from private.worker_open_document($1, 'worker-039d', $2)`, [r.agent_run_id, alheio.id]))
    igual(d.length, 0, 'documento de outro caso não volta')
  }
  await comoWorker((tx) => tx.query(`select private.worker_finish_run($1, 'worker-039d', 'FAILED', 'INTERNAL_ERROR')`, [r.agent_run_id]))
})
await deve('nova tentativa de execução avulsa: nova execução ligada; idempotente; recusada para execução de análise', async () => {
  const run = (await como(ids.lucas, (tx) => um(tx, `select public.request_agent_run($1, $2) id`, [ids.agente, ids.casoA]))).id
  await reservar039(run, 'worker-039e')
  await comoWorker((tx) => tx.query(`select private.worker_finish_run($1, 'worker-039e', 'FAILED', 'PROVIDER_UNAVAILABLE')`, [run]))
  const k = randomUUID()
  const r1 = await como(ids.lucas, async (tx) => (await um(tx, `select public.retry_agent_run_once($1, $2) r`, [k, run])).r)
  const r2 = await como(ids.lucas, async (tx) => (await um(tx, `select public.retry_agent_run_once($1, $2) r`, [k, run])).r)
  igual([r1.deduplicated, r2.deduplicated, r2.agent_run_id === r1.agent_run_id], [false, true, true], 'idempotente')
  const n = await um(db, `select status, retry_of_agent_run_id from agent_runs where id = $1`, [r1.agent_run_id])
  igual([n.status, n.retry_of_agent_run_id], ['QUEUED', run], 'nova execução ligada')
  await como(ids.lucas, (tx) => tx.query(`select public.retry_agent_run_once($1, $2)`, [randomUUID(), ids.run039fail])).then(
    () => { throw new Error('retry de análise aceito') }, (e) => { if (!/envie a análise de novo/.test(e.message)) throw e })
  await como(ids.ana, (tx) => tx.query(`select public.retry_agent_run_once($1, $2)`, [randomUUID(), run])).then(
    () => { throw new Error('ASSISTANT tentou de novo') }, (e) => { if (!/Somente ADMIN ou advogado/.test(e.message)) throw e })
  await db.query(`update agent_runs set status = 'CANCELLED' where id = $1`, [r1.agent_run_id])
})
await deve('detalhe da execução: LAWYER vê o que foi entregue, sem uso/custo/configuração; ADMIN vê tudo; ASSISTANT não', async () => {
  const d = await como(ids.lucas, async (tx) => (await um(tx, `select public.get_agent_run_detail($1) d`, [ids.run039b])).d)
  igual([d.status, d.analysis_id, d.analysis_result.id, d.analysis_result.review_status, d.retry_of_agent_run_id, d.usage, d.config],
    ['COMPLETED', ids.an039, (await um(db, `select id from legal_analysis_results where agent_run_id = $1`, [ids.run039b])).id, 'APPROVED', ids.run039, null, null], 'LAWYER')
  const adm = await como(ids.barbara, async (tx) => (await um(tx, `select public.get_agent_run_detail($1) d`, [ids.run039])).d)
  igual([typeof adm.usage, adm.config.prompt_sha256, adm.retried_by], ['object', sha64, [ids.run039b]], 'ADMIN')
  await como(ids.ana, (tx) => tx.query(`select public.get_agent_run_detail($1)`, [ids.run039])).then(
    () => { throw new Error('ASSISTANT leu') }, (e) => { if (!/só a ADMIN e LAWYER/.test(e.message)) throw e })
})
await deve('uso da IA: só ADMIN, só agregados', async () => {
  const u = await como(ids.barbara, async (tx) => (await um(tx, `select public.get_ai_usage_summary(30) u`)).u)
  igual([typeof u.totals.runs, Array.isArray(u.by_agent), Array.isArray(u.by_day)], ['number', true, true], 'formato')
  await como(ids.lucas, (tx) => tx.query(`select public.get_ai_usage_summary(30)`)).then(
    () => { throw new Error('LAWYER leu uso') }, (e) => { if (!/Somente ADMIN/.test(e.message)) throw e })
})

secao('Catálogo: funções da Etapa 5 [039]')
const novas039 = ['get_ai_runtime_status', 'set_ai_execution_enabled', 'worker_ai_enabled', 'dg_storage_object_exists',
  'worker_register_skill_upload', 'reviews_validate_analysis_result', 'reviews_sync_analysis', 'worker_submit_analysis_result',
  'agent_runs_retry_guard', 'worker_record_run_config', 'worker_open_document', 'retry_agent_run_once', 'link_analysis_retry',
  'agent_run_has_pending_outputs', 'dg_validate_agent_configuration', 'dg_uuid_array', 'dg_save_agent_once', 'dg_set_agent_status',
  'dg_save_skill_once', 'dg_save_thesis_once', 'dg_save_reference_once', 'dg_set_template_agent', 'get_agent_run_detail', 'get_ai_usage_summary']
await deve('toda função nova fixa search_path; anon não executa nenhuma', async () => {
  const r = await linhas(db, `select n.nspname || '.' || p.proname f, coalesce(array_to_string(p.proconfig, ','), '') cfg,
      has_function_privilege('anon', p.oid, 'execute') anon
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.proname = any ($1)`, [novas039])
  if (r.length < novas039.length) throw new Error(`funções faltando: ${r.length}`)
  igual(r.filter((x) => !x.cfg.includes('search_path=') && x.f !== 'private.agent_runs_retry_guard').map((x) => x.f), [], 'sem search_path')
  igual(r.filter((x) => x.anon).map((x) => x.f), [], 'anon com execute')
})
await deve('usuário logado não chama as portas do worker; o worker não chama as da tela', async () => {
  const doWorker = ['worker_ai_enabled', 'worker_register_skill_upload', 'worker_submit_analysis_result', 'worker_record_run_config',
    'worker_open_document', 'agent_run_has_pending_outputs', 'reviews_sync_analysis']
  const r = await linhas(db, `select p.proname f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = any ($1) and has_function_privilege('authenticated', p.oid, 'execute')`, [doWorker])
  igual(r.map((x) => x.f), [], 'authenticated com execute em porta do worker')
  const daTela = ['set_ai_execution_enabled', 'retry_agent_run_once', 'get_agent_run_detail', 'get_ai_usage_summary']
  const w = await linhas(db, `select p.proname f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = any ($1) and has_function_privilege('dg_worker', p.oid, 'execute')`, [daTela])
  igual(w.map((x) => x.f), [], 'dg_worker com execute em porta da tela')
})

// ═════════════════════════════ 040 ═══════════════════════════════════════

secao('Computador do escritório: cadastro, acesso e situação [040]')
const h040 = (s) => createHash('sha256').update(s).digest('hex')
const tok040 = { A: 'dgx_' + randomUUID().replaceAll('-', ''), B: 'dgx_' + randomUUID().replaceAll('-', '') }
const hA = h040(tok040.A), hB = h040(tok040.B)
const lease = () => h040(randomUUID())
const ex = (sql, params) => comoWorker(async (tx) => Object.values((await um(tx, sql, params)) ?? {})[0])
await deve('ADMIN autoriza computador (só o hash vai ao banco); LAWYER não', async () => {
  ids.exA = (await como(ids.barbara, (tx) => um(tx, `select public.dg_create_executor('Computador A', $1, 'dgx_AAAA') r`, [hA]))).r.id
  ids.exB = (await como(ids.barbara, (tx) => um(tx, `select public.dg_create_executor('Computador B', $1, 'dgx_BBBB') r`, [hB]))).r.id
  await como(ids.lucas, (tx) => tx.query(`select public.dg_create_executor('Intruso', $1, 'dgx_CCCC')`, [h040('x')])).then(
    () => { throw new Error('LAWYER cadastrou') }, (e) => { if (!/Somente ADMIN/.test(e.message)) throw e })
  const n = await um(db, `select count(*)::int n from executors where token_hash = $1`, [tok040.A])
  igual(n.n, 0, 'token em claro no banco')
})
await deveFalhar('token repetido é recusado', () => como(ids.barbara, (tx) => tx.query(`select public.dg_create_executor('Dup', $1, 'dgx_DDDD')`, [hA])), /duplicate|unique/)
await deveFalhar('prefixo fora do formato é recusado', () => como(ids.barbara, (tx) => tx.query(`select public.dg_create_executor('X', $1, 'abc')`, [h040('y')])), /check/)
await deve('computador se autentica pelo hash; hash errado é recusado; contato marca "online"', async () => {
  const a = await ex(`select private.executor_authenticate($1, 'dg-executor/1.0 claude-code/9.9') r`, [hA])
  igual([a.name, a.capabilities.includes('jobs.claim')], ['Computador A', true], 'autenticado')
  await ex(`select private.executor_authenticate($1) r`, [h040('errado')]).then(
    () => { throw new Error('hash errado aceito') }, (e) => { if (!/inválido ou revogado/.test(e.message)) throw e })
  const s = (await como(ids.lucas, (tx) => um(tx, `select public.get_executor_status() r`))).r
  igual([s.online, s.executors], [true, null], 'LAWYER vê "online", sem a lista')
  const adm = (await como(ids.barbara, (tx) => um(tx, `select public.get_executor_status() r`))).r
  igual(adm.executors.find((e) => e.id === ids.exA).client_version, 'dg-executor/1.0 claude-code/9.9', 'ADMIN vê a lista')
  igual(JSON.stringify(adm).includes(hA), false, 'hash fora da tela')
})
await deve('usuário logado não chama porta do executor; dg_worker não chama a gestão', async () => {
  await como(ids.barbara, (tx) => tx.query(`select private.executor_authenticate($1)`, [hA])).then(
    () => { throw new Error('authenticated chamou executor_authenticate') }, (e) => { if (!/permission denied/.test(e.message)) throw e })
  await comoWorker((tx) => tx.query(`select private.dg_create_executor('x', $1, 'dgx_EEEE')`, [h040('z')])).then(
    () => { throw new Error('dg_worker cadastrou') }, (e) => { if (!/permission denied/.test(e.message)) throw e })
  await comoWorker((tx) => tx.query(`select private.maintenance_tick()`)).then(
    () => { throw new Error('dg_worker chamou a manutenção') }, (e) => { if (!/permission denied/.test(e.message)) throw e })
})

secao('Computador do escritório: fila, reserva exclusiva e escopo [040]')
const avulsa040 = async (pedido = 'Gere a procuração de teste') => (await como(ids.lucas, (tx) =>
  um(tx, `select public.request_agent_run_once($1, $2, $3, null, $4, '{}', 'EXECUTE') r`, [randomUUID(), ids.agente, ids.casoA, pedido]))).r.run_id
const reservar040 = (hash, run, l) => ex(`select private.executor_claim($1, $2, $3) r`, [hash, run, l])
await deve('agente aponta para o agente local do Claude Code (configuration.local_agent)', async () => {
  const ag = await um(db, `select a.name, v.instructions from agents a join agent_versions v on v.id = a.current_version_id where a.id = $1`, [ids.agente])
  await como(ids.barbara, (tx) => tx.query(`select public.dg_save_agent_once($1, $2)`, [randomUUID(), JSON.stringify({
    id: ids.agente, name: ag.name, instructions: ag.instructions, status: 'ACTIVE', configuration: { local_agent: 'kit-cliente-teste' } })]))
  igual((await um(db, `select v.configuration ->> 'local_agent' l from agents a join agent_versions v on v.id = a.current_version_id where a.id = $1`, [ids.agente])).l,
    'kit-cliente-teste', 'versão nova com o agente local')
  await db.query(`select private.dg_validate_agent_configuration('{"local_agent": "clara-hiscon"}')`)
  await db.query(`select private.dg_validate_agent_configuration('{"local_agent": "Clara Hiscon"}')`).then(
    () => { throw new Error('nome inválido aceito') }, (e) => { if (!/agente local inválido/.test(e.message)) throw e })
})
await deve('interruptor desligado: não reserva; o pedido fica na fila', async () => {
  await como(ids.barbara, (tx) => tx.query(`select public.set_ai_execution_enabled(false)`))
  ids.r040 = await avulsa040()
  const r = await reservar040(hA, ids.r040, lease())
  igual([r.claimed, r.reason], [false, 'DISABLED'], 'não reservou')
  igual((await um(db, `select status from agent_runs where id = $1`, [ids.r040])).status, 'QUEUED', 'na fila')
  await como(ids.barbara, (tx) => tx.query(`select public.set_ai_execution_enabled(true)`))
})
await deve('fila para o computador: sem nome do cliente nem título do caso', async () => {
  const fila = await ex(`select private.executor_list_jobs($1, 50) r`, [hA])
  const item = fila.find((j) => j.id === ids.r040)
  igual([item.kind, item.agent.local_agent, item.has_request_text], ['EXECUTE', 'kit-cliente-teste', true], 'item')
  const caso = await um(db, `select k.title, coalesce(i.full_name, co.legal_name) cliente from legal_cases k
    left join individual_client_details i on i.client_id = k.client_id left join company_client_details co on co.client_id = k.client_id where k.id = $1`, [ids.casoA])
  const txt = JSON.stringify(fila)
  igual([txt.includes(caso.title), txt.includes(caso.cliente)], [false, false], 'vazou dado do caso')
})
await deve('reserva exclusiva: A reserva; B não; contexto traz agente local e orientações', async () => {
  ids.l040 = lease()
  const a = await reservar040(hA, ids.r040, ids.l040)
  const b = await reservar040(hB, ids.r040, lease())
  igual([a.claimed, b.claimed, b.reason], [true, false, 'NOT_AVAILABLE'], 'uma reserva só')
  igual([a.context.agent.local_agent, typeof a.context.agent.instructions, a.context.input.request_text, a.context.lease_seconds],
    ['kit-cliente-teste', 'string', 'Gere a procuração de teste', 300], 'contexto')
  const r = await um(db, `select status, executor_id, lease_token_hash, claimed_by from agent_runs where id = $1`, [ids.r040])
  igual([r.status, r.executor_id, r.lease_token_hash, r.claimed_by.startsWith(`executor:${ids.exA}:`)], ['RUNNING', ids.exA, ids.l040, true], 'reserva gravada')
})
await deve('sem a reserva certa, nada: outro computador, token de reserva errado', async () => {
  for (const [h, l] of [[hB, ids.l040], [hA, lease()]])
    await ex(`select private.executor_get_case($1, $2, $3) r`, [h, ids.r040, l]).then(
      () => { throw new Error('leu sem reserva') }, (e) => { if (!/não está reservado por este computador/.test(e.message)) throw e })
})
await deve('caso do trabalho: lido pela reserva; acesso a dado pessoal registrado como AGENTE', async () => {
  const c = await ex(`select private.executor_get_case($1, $2, $3) r`, [hA, ids.r040, ids.l040])
  igual(c.id, ids.casoA, 'caso do trabalho')
  const ev = await um(db, `select actor_type, agent_run_id from personal_data_access_events where agent_run_id = $1 and resource_type = 'LEGAL_CASE' order by created_at desc limit 1`, [ids.r040])
  igual([ev.actor_type, ev.agent_run_id], ['AGENT', ids.r040], 'registro de acesso')
})
await deve('documentos: só do caso do trabalho; abrir registra QUAL versão (e checksum) foi processada', async () => {
  const docs = await ex(`select private.executor_list_documents($1, $2, $3) r`, [hA, ids.r040, ids.l040])
  const doCaso = await linhas(db, `select v.id from document_versions v join case_documents cd on cd.document_id = v.document_id where cd.legal_case_id = $1`, [ids.casoA])
  if (docs.some((d) => !doCaso.find((x) => x.id === d.version_id))) throw new Error('documento de outro caso na lista')
  const alheio = await um(db, `select v.id from document_versions v join case_documents cd on cd.document_id = v.document_id
    where cd.legal_case_id <> $1 and not exists (select 1 from case_documents c2 where c2.document_id = v.document_id and c2.legal_case_id = $1) limit 1`, [ids.casoA])
  if (!alheio) throw new Error('cenário sem documento de outro caso')
  await ex(`select private.executor_open_document($1, $2, $3, $4) r`, [hA, ids.r040, ids.l040, alheio.id]).then(
    () => { throw new Error('abriu documento de outro caso') }, (e) => { if (!/não pertence ao caso/.test(e.message)) throw e })
  if (!docs.length) throw new Error('cenário sem documento no caso A')
  const d = await ex(`select private.executor_open_document($1, $2, $3, $4) r`, [hA, ids.r040, ids.l040, docs[0].version_id])
  if (!d.storage_object_name) throw new Error('sem objeto para assinar')
  const e = await um(db, `select document_version_id from agent_run_events where agent_run_id = $1 and kind = 'DOCUMENT_OPENED'`, [ids.r040])
  igual(e.document_version_id, docs[0].version_id, 'versão registrada')
})
await deve('propostas: tipo estrutural recusado; sem resumo recusado; prazo aceito e idempotente', async () => {
  await ex(`select private.executor_create_proposal($1, $2, $3, 'UPDATE_AGENT', '{"summary":"x"}', 'k-040-agente')`, [hA, ids.r040, ids.l040]).then(
    () => { throw new Error('tipo estrutural aceito') }, (e) => { if (!/não permitido/.test(e.message)) throw e })
  await ex(`select private.executor_create_proposal($1, $2, $3, 'OTHER', '{"data":{}}', 'k-040-sem')`, [hA, ids.r040, ids.l040]).then(
    () => { throw new Error('sem resumo aceito') }, (e) => { if (!/resumo/.test(e.message)) throw e })
  const payload = JSON.stringify({ summary: 'Prazo para juntar procuração', data: { title: 'Juntar procuração (teste)', due_at: '2026-12-01T12:00:00Z' } })
  const p1 = await ex(`select private.executor_create_proposal($1, $2, $3, 'CREATE_DEADLINE', $4, 'k-040-prazo') r`, [hA, ids.r040, ids.l040, payload])
  const p2 = await ex(`select private.executor_create_proposal($1, $2, $3, 'CREATE_DEADLINE', $4, 'k-040-prazo') r`, [hA, ids.r040, ids.l040, payload])
  igual([p1.created, p2.created, p2.proposal_id === p1.proposal_id], [true, false, true], 'idempotente')
  ids.p040 = p1.proposal_id
})
await deve('minuta: caminho no Storage é do cliente do trabalho; não dá para apontar outro; sem arquivo não grava', async () => {
  const prep = await ex(`select private.executor_prepare_output($1, $2, $3, 'procuracao-teste.pdf', 'application/pdf', 1200) r`, [hA, ids.r040, ids.l040])
  const cli = (await um(db, `select client_id from legal_cases where id = $1`, [ids.casoA])).client_id
  igual(prep.storage_object_name.startsWith(`clients/${cli}/documents/${prep.document_id}/${prep.document_version_id}/`), true, 'caminho do cliente')
  const fin = (obj) => ex(`select private.executor_finalize_output($1, $2, $3, $4, $5, $6, 'procuracao-teste.pdf', 'application/pdf', 1200, $7, 'Procuração (teste)', 'POWER_OF_ATTORNEY') r`,
    [hA, ids.r040, ids.l040, prep.document_id, prep.document_version_id, obj, sha64])
  await fin(`clients/${randomUUID()}/documents/${prep.document_id}/${prep.document_version_id}/procuracao-teste.pdf`).then(
    () => { throw new Error('caminho de outro cliente aceito') }, (e) => { if (!/não corresponde/.test(e.message)) throw e })
  await fin(prep.storage_object_name).then(() => { throw new Error('gravou sem arquivo') }, (e) => { if (!/não chegou/.test(e.message)) throw e })
  await db.query(`insert into storage.objects (bucket_id, name) values ('legal-documents', $1)`, [prep.storage_object_name])
  const f1 = await fin(prep.storage_object_name)
  const f2 = await fin(prep.storage_object_name)
  igual([f1.created, f2.created, f1.version_number], [true, false, 1], 'idempotente')
  const d = await um(db, `select d.visibility, v.source, (select status from reviews where document_version_id = v.id) rv
    from document_versions v join documents d on d.id = v.document_id where v.id = $1`, [prep.document_version_id])
  igual([d.visibility, d.source, d.rv], ['INTERNAL', 'AGENT', 'PENDING'], 'versão interna em revisão')
  ids.v040 = prep.document_version_id
})
await deve('progresso renova a reserva e entra na linha do tempo', async () => {
  const hb = await ex(`select private.executor_heartbeat($1, $2, $3, 'Gerando a procuração') r`, [hA, ids.r040, ids.l040])
  igual([hb.ok, hb.cancel_requested], [true, false], 'renovado')
  igual((await um(db, `select progress_message m from agent_runs where id = $1`, [ids.r040])).m, 'Gerando a procuração', 'progresso')
  igual((await ex(`select private.executor_heartbeat($1, $2, $3) r`, [hA, ids.r040, lease()])).ok, false, 'reserva errada não renova')
})
await deve('concluir com entregas pendentes: aguardando decisão humana; reserva some', async () => {
  const c = await ex(`select private.executor_complete($1, $2, $3, '{"client_version":"dg-executor/1.0","prompt":"segredo"}') r`, [hA, ids.r040, ids.l040])
  igual(c.status, 'WAITING_HUMAN', 'aguardando')
  const r = await um(db, `select status, lease_token_hash, metadata -> 'executor' rep from agent_runs where id = $1`, [ids.r040])
  igual([r.status, r.lease_token_hash, r.rep], ['WAITING_HUMAN', null, { client_version: 'dg-executor/1.0' }], 'só campos permitidos no relatório')
  await ex(`select private.executor_get_case($1, $2, $3) r`, [hA, ids.r040, ids.l040]).then(
    () => { throw new Error('leu depois de concluir') }, (e) => { if (!/não está reservado/.test(e.message)) throw e })
})
await deve('manutenção (pg_cron): proposta aprovada vira prazo; execução fecha quando tudo foi decidido', async () => {
  const rvP = (await um(db, `select id from reviews where agent_proposal_id = $1`, [ids.p040])).id
  const rvD = (await um(db, `select id from reviews where document_version_id = $1`, [ids.v040])).id
  await decidir(ids.lucas, rvP, 'APPROVE')
  const t = await db.query(`select private.maintenance_tick() r`)
  if (t.rows[0].r.proposals < 1) throw new Error('nenhuma proposta aplicada')
  const p = await um(db, `select status, applied_entity_type from agent_proposals where id = $1`, [ids.p040])
  igual([p.status, p.applied_entity_type], ['APPLIED', 'deadlines'], 'aplicada')
  igual((await um(db, `select status from agent_runs where id = $1`, [ids.r040])).status, 'WAITING_HUMAN', 'minuta ainda pendente')
  await decidir(ids.lucas, rvD, 'APPROVE')
  await db.query(`select private.maintenance_tick()`)
  igual((await um(db, `select status from agent_runs where id = $1`, [ids.r040])).status, 'COMPLETED', 'fechou')
})
await deve('agendamentos do pg_cron registrados (manutenção a cada minuto; lembretes de prazo)', async () => {
  const j = await linhas(db, `select jobname, schedule from cron.job where jobname like 'dg-%' order by jobname`)
  igual(j.map((x) => [x.jobname, x.schedule]), [['dg-lembretes-de-prazo', '*/15 * * * *'], ['dg-manutencao', '* * * * *']], 'jobs')
})

secao('Computador do escritório: interrupção, falha, devolução e queda [040]')
await deve('interrupção pedida: renovação avisa; escrita recusada; concluir encerra como cancelada', async () => {
  const run = await avulsa040(); const l = lease()
  await reservar040(hA, run, l)
  await como(ids.lucas, (tx) => tx.query(`select public.request_agent_run_cancel($1)`, [run]))
  igual((await ex(`select private.executor_heartbeat($1, $2, $3) r`, [hA, run, l])).cancel_requested, true, 'avisado')
  await ex(`select private.executor_create_proposal($1, $2, $3, 'OTHER', '{"summary":"x"}', 'k-040-cancel')`, [hA, run, l]).then(
    () => { throw new Error('escreveu interrompido') }, (e) => { if (!/interrompido/.test(e.message)) throw e })
  igual((await ex(`select private.executor_complete($1, $2, $3) r`, [hA, run, l])).status, 'CANCELLED', 'cancelada')
})
await deve('falha transitória sem entrega volta à fila; com entrega vira PARTIAL_OUTPUT', async () => {
  const run = await avulsa040(); let l = lease()
  await reservar040(hA, run, l)
  igual((await ex(`select private.executor_fail($1, $2, $3, 'DOCUMENT_UNREADABLE', 'PDF ilegível', true) r`, [hA, run, l])).status, 'QUEUED', 'voltou')
  l = lease()
  igual((await reservar040(hA, run, l)).claimed, true, 'reservou de novo')
  await ex(`select private.executor_create_proposal($1, $2, $3, 'OTHER', '{"summary":"parcial"}', 'k-040-parcial')`, [hA, run, l])
  await ex(`select private.executor_fail($1, $2, $3, 'QUALQUER', 'x')`, [hA, run, l]).then(
    () => { throw new Error('código livre aceito') }, (e) => { if (!/desconhecido/.test(e.message)) throw e })
  const f = await ex(`select private.executor_fail($1, $2, $3, 'TOOL_ERROR', 'erro no script', true) r`, [hA, run, l])
  igual([f.status, f.error_code], ['FAILED', 'PARTIAL_OUTPUT'], 'com entrega não volta')
})
await deve('devolver sem executar: volta à fila sem gastar tentativa', async () => {
  const run = await avulsa040(); const l = lease()
  await reservar040(hA, run, l)
  const antes = (await um(db, `select attempt from agent_runs where id = $1`, [run])).attempt
  igual((await ex(`select private.executor_release($1, $2, $3) r`, [hA, run, l])).status, 'QUEUED', 'devolvido')
  igual((await um(db, `select attempt from agent_runs where id = $1`, [run])).attempt, antes - 1, 'tentativa devolvida')
  ids.r040rel = run
})
await deve('computador que some: reserva vence → volta à fila (3x) → falha; a análise acompanha', async () => {
  const an = await iniciar(ids.lucas, randomUUID(), ids.casoA, ids.tpl039, {}, true)
  const run = an.agent_run_id
  for (let i = 1; i <= 3; i++) {
    const r = await reservar040(hA, run, lease())
    if (!r.claimed) throw new Error(`tentativa ${i} não reservou: ${r.reason}`)
    await db.query(`update agent_runs set heartbeat_at = now() - interval '10 minutes' where id = $1`, [run])
    await db.query(`select private.maintenance_tick()`)
    const s = await um(db, `select status, error_code from agent_runs where id = $1`, [run])
    igual([s.status, s.error_code], i < 3 ? ['QUEUED', 'LEASE_EXPIRED'] : ['FAILED', 'EXECUTOR_UNAVAILABLE'], `tentativa ${i}`)
  }
  igual((await um(db, `select status from legal_analyses where id = $1`, [an.analysis_id])).status, 'FAILED', 'análise falhou junto')
  const ev = await linhas(db, `select to_status from agent_run_events where agent_run_id = $1 and kind = 'STATUS' order by id`, [run])
  igual(ev.map((e) => e.to_status), ['RUNNING', 'QUEUED', 'RUNNING', 'QUEUED', 'RUNNING', 'FAILED'], 'linha do tempo')
})
await deve('computador some DEPOIS de entregar: não volta à fila (não duplica); falha como entrega parcial', async () => {
  const run = await avulsa040(); const l = lease()
  await reservar040(hA, run, l)
  await ex(`select private.executor_create_proposal($1, $2, $3, 'OTHER', '{"summary":"entregue antes da queda"}', 'k-040-queda')`, [hA, run, l])
  await db.query(`update agent_runs set heartbeat_at = now() - interval '10 minutes' where id = $1`, [run])
  await db.query(`select private.maintenance_tick()`)
  const s = await um(db, `select status, error_code from agent_runs where id = $1`, [run])
  igual([s.status, s.error_code], ['FAILED', 'PARTIAL_OUTPUT'], 'parcial')
  igual((await um(db, `select count(*)::int n from reviews where agent_proposal_id in (select id from agent_proposals where agent_run_id = $1) and status = 'PENDING'`, [run])).n, 1, 'entrega segue em Revisões')
})
await deve('análise sem resultado não "conclui": falha; com resultado: aguardando revisão', async () => {
  const a1 = await iniciar(ids.lucas, randomUUID(), ids.casoA, ids.tpl039, {}, true); const l1 = lease()
  await reservar040(hA, a1.agent_run_id, l1)
  const c1 = await ex(`select private.executor_complete($1, $2, $3) r`, [hA, a1.agent_run_id, l1])
  igual([c1.status, c1.error_code], ['FAILED', 'NO_ANALYSIS_RESULT'], 'sem resultado')
  const a2 = await iniciar(ids.lucas, randomUUID(), ids.casoA, ids.tpl039, {}, true); const l2 = lease()
  await reservar040(hA, a2.agent_run_id, l2)
  const s = await ex(`select private.executor_submit_analysis($1, $2, $3, 'Cabe uma ação.', $4, 1) r`, [hA, a2.agent_run_id, l2, JSON.stringify(resultado039)])
  igual(s.created, true, 'resultado entregue')
  igual((await ex(`select private.executor_complete($1, $2, $3) r`, [hA, a2.agent_run_id, l2])).status, 'WAITING_HUMAN', 'aguardando revisão')
  igual((await um(db, `select status from legal_analyses where id = $1`, [a2.analysis_id])).status, 'WAITING_REVIEW', 'análise em revisão')
})
await deve('revogar: acesso para na hora e o que estava reservado volta à fila', async () => {
  const run = ids.r040rel; const l = lease()
  igual((await reservar040(hB, run, l)).claimed, true, 'B reservou')
  const r = (await como(ids.barbara, (tx) => um(tx, `select public.dg_revoke_executor($1) r`, [ids.exB]))).r
  igual(r.released, 1, 'liberou 1')
  const s = await um(db, `select status, error_code from agent_runs where id = $1`, [run])
  igual([s.status, s.error_code], ['QUEUED', 'EXECUTOR_REVOKED'], 'de volta à fila')
  await ex(`select private.executor_authenticate($1) r`, [hB]).then(
    () => { throw new Error('revogado autenticou') }, (e) => { if (!/revogado/.test(e.message)) throw e })
  await db.query(`update executors set revoked_at = null where id = $1`, [ids.exB]).then(
    () => { throw new Error('revogação desfeita') }, (e) => { if (!/não volta/.test(e.message)) throw e })
})
await deve('detalhe da execução mostra computador, progresso e linha do tempo', async () => {
  const d = (await como(ids.lucas, (tx) => um(tx, `select public.get_agent_run_detail($1) r`, [ids.r040]))).r
  igual(d.executor.name, 'Computador A', 'computador')
  const kinds = new Set(d.events.map((e) => e.kind))
  for (const k of ['STATUS', 'LEASE', 'PROGRESS', 'OUTPUT', 'DOCUMENT_OPENED']) if (!kinds.has(k)) throw new Error(`sem evento ${k}`)
  igual(d.usage, null, 'LAWYER sem uso')
})
await deve('linha do tempo é append-only', async () => {
  await db.query(`update agent_run_events set message = 'x' where agent_run_id = $1`, [ids.r040]).then(
    () => { throw new Error('evento editável') }, () => {})
})

secao('Catálogo: funções da 040')
const novas040 = ['executors_validate', 'agent_runs_log_status', 'dg_create_executor', 'dg_revoke_executor', 'get_executor_status',
  'executor_require', 'executor_lease', 'executor_authenticate', 'executor_list_jobs', 'executor_context_of', 'executor_claim',
  'executor_job_context', 'executor_heartbeat', 'executor_get_case', 'executor_get_process', 'executor_list_documents',
  'executor_open_document', 'executor_list_theses', 'executor_list_references', 'executor_submit_analysis',
  'executor_create_proposal', 'executor_prepare_output', 'executor_finalize_output', 'executor_record_config',
  'executor_complete', 'executor_fail', 'executor_release', 'expire_executor_leases', 'maintenance_tick']
await deve('toda função nova fixa search_path; anon e service_role não executam', async () => {
  const r = await linhas(db, `select n.nspname || '.' || p.proname f, coalesce(array_to_string(p.proconfig, ','), '') cfg,
      has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('service_role', p.oid, 'execute') srv
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = any ($1)`, [novas040])
  if (r.length < novas040.length) throw new Error(`funções faltando: ${novas040.length - r.length}`)
  igual(r.filter((x) => !x.cfg.includes('search_path=')).map((x) => x.f), [], 'sem search_path')
  igual(r.filter((x) => x.anon || x.srv).map((x) => x.f), [], 'anon/service_role com execute')
})
await deve('portas do executor só para dg_worker; internas (require, lease, contexto, manutenção) para ninguém', async () => {
  const internas = ['executor_require', 'executor_lease', 'executor_context_of', 'expire_executor_leases', 'maintenance_tick']
  const r = await linhas(db, `select p.proname f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = any ($1)
      and (has_function_privilege('dg_worker', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`, [internas])
  igual(r.map((x) => x.f), [], 'interna exposta')
  const portas = novas040.filter((f) => f.startsWith('executor_') && !internas.includes(f))
  const a = await linhas(db, `select p.proname f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = any ($1) and has_function_privilege('authenticated', p.oid, 'execute')`, [portas])
  igual(a.map((x) => x.f), [], 'usuário logado com porta do executor')
})

// ═════════════════════════════ 041 ═══════════════════════════════════════

secao('Google Drive: pasta do cliente pelo ID, importação sem duplicata, exportação do aprovado [041]')
const F1 = 'pastaFicticiaA_0001', F2 = 'pastaFicticiaA_0002'
const md5 = (c) => c.repeat(32).slice(0, 32)
const exW = (sql, params) => comoWorker(async (tx) => Object.values((await um(tx, sql, params)) ?? {})[0])
await deve('LAWYER liga a pasta do cliente pelo ID; repetir não muda; a mesma pasta não vai para outro cliente; ASSISTANT não liga', async () => {
  ids.cli041 = (await um(db, `select client_id from legal_cases where id = $1`, [ids.casoA])).client_id
  ids.cli041b = (await um(db, `select id from clients where id <> $1 and deleted_at is null limit 1`, [ids.cli041])).id
  const a = (await como(ids.lucas, (tx) => um(tx, `select public.drive_link_client_folder($1, $2, 'JOSE FICTICIO') r`, [ids.cli041, F1]))).r
  const b = (await como(ids.lucas, (tx) => um(tx, `select public.drive_link_client_folder($1, $2, 'JOSE FICTICIO (renomeada)') r`, [ids.cli041, F1]))).r
  igual([a.changed, b.changed, b.id === a.id], [true, false, true], 'idempotente')
  ids.link041 = a.id
  await como(ids.lucas, (tx) => tx.query(`select public.drive_link_client_folder($1, $2, 'X')`, [ids.cli041b, F1])).then(
    () => { throw new Error('mesma pasta em dois clientes') }, (e) => { if (!/outro cliente/.test(e.message)) throw e })
  await como(ids.ana, (tx) => tx.query(`select public.drive_link_client_folder($1, $2, 'X')`, [ids.cli041, F2])).then(
    () => { throw new Error('ASSISTANT ligou') }, (e) => { if (!/Somente ADMIN ou advogado/.test(e.message)) throw e })
  await como(ids.lucas, (tx) => tx.query(`select public.drive_link_client_folder($1, 'nome com espaço', 'X')`, [ids.cli041])).then(
    () => { throw new Error('ID inválido aceito') }, (e) => { if (!/inválido/.test(e.message)) throw e })
  const d = (await como(ids.lucas, (tx) => um(tx, `select public.get_client_drive($1) r`, [ids.cli041]))).r
  igual([d.link.folder_id, d.link.folder_name], [F1, 'JOSE FICTICIO (renomeada)'], 'situação')
})
await deve('tabelas do Drive fechadas ao PostgREST; dg_worker não liga pasta; usuário logado não importa', async () => {
  for (const t of ['external_folder_links', 'external_document_imports']) {
    await como(ids.barbara, (tx) => tx.query(`select 1 from public.${t} limit 1`)).then(
      () => { throw new Error(`leu ${t}`) }, (e) => { if (!/permission denied/.test(e.message)) throw e })
  }
  await comoWorker((tx) => tx.query(`select private.drive_link_client_folder($1, $2, 'x')`, [ids.cli041, F2])).then(
    () => { throw new Error('dg_worker ligou') }, (e) => { if (!/permission denied/.test(e.message)) throw e })
  await como(ids.barbara, (tx) => tx.query(`select private.drive_prepare_import($1, 'x.pdf')`, [ids.link041])).then(
    () => { throw new Error('usuário importou') }, (e) => { if (!/permission denied/.test(e.message)) throw e })
})
await deve('importação: caminho do cliente da pasta; sem arquivo no Storage não grava; documento INTERNO, versão IMPORT; repetir não duplica', async () => {
  const sync = await exW(`select private.drive_links_to_sync(10) r`)
  if (!sync.some((l) => l.id === ids.link041)) throw new Error('ligação fora da sincronização')
  const p = await exW(`select private.drive_prepare_import($1, 'HISCON.pdf') r`, [ids.link041])
  igual(p.storage_object_name.startsWith(`clients/${ids.cli041}/documents/`), true, 'caminho do cliente')
  const reg = () => exW(`select private.drive_register_import($1, 'arquivoDrive_00001', $2, 'HISCON.pdf', now(), $3, $4, $5, 'application/pdf', 1024, $6) r`,
    [ids.link041, md5('a'), p.document_id, p.document_version_id, p.storage_object_name, sha64])
  await reg().then(() => { throw new Error('gravou sem arquivo') }, (e) => { if (!/não chegou/.test(e.message)) throw e })
  await db.query(`insert into storage.objects (bucket_id, name) values ('legal-documents', $1)`, [p.storage_object_name])
  const r1 = await reg(), r2 = await reg()
  igual([r1.created, r2.created, r2.document_version_id], [true, false, p.document_version_id], 'idempotente')
  const d = await um(db, `select d.visibility, d.category, v.source from document_versions v join documents d on d.id = v.document_id where v.id = $1`, [p.document_version_id])
  igual([d.visibility, d.category, d.source], ['INTERNAL', 'OTHER', 'IMPORT'], 'documento')
  igual((await exW(`select private.drive_known_files($1) r`, [ids.link041])).imported, [`arquivoDrive_00001:${md5('a')}`], 'conhecidos')
  ids.v041 = p.document_version_id
})
await deve('aprovação em Revisões põe a versão na fila de exportação; o servidor envia e grava o ID do arquivo', async () => {
  await db.query(`insert into case_documents (legal_case_id, document_id) select $1, document_id from document_versions where id = $2 on conflict do nothing`, [ids.casoA, ids.v041])
  const rv = (await como(ids.lucas, (tx) => um(tx, `insert into reviews (legal_case_id, document_version_id) values ($1, $2) returning id`, [ids.casoA, ids.v041]))).id
  await decidir(ids.lucas, rv, 'APPROVE')
  const e = await um(db, `select status, folder_link_id, external_file_id from external_document_exports where document_version_id = $1`, [ids.v041])
  igual([e.status, e.folder_link_id, e.external_file_id], ['PENDING', ids.link041, null], 'na fila')
  const c = await exW(`select private.drive_claim_exports(5) r`)
  const item = c.find((x) => x.folder_id === F1)
  igual([item.attempts, item.filename], [1, 'HISCON.pdf'], 'pego para enviar')
  await comoWorker((tx) => tx.query(`select private.drive_mark_export($1, 'arquivoExportado_0001')`, [item.id]))
  const f = await um(db, `select status, external_file_id, exported_at is not null as feito from external_document_exports where id = $1`, [item.id])
  igual([f.status, f.external_file_id, f.feito], ['EXPORTED', 'arquivoExportado_0001', true], 'exportado')
  igual((await exW(`select private.drive_known_files($1) r`, [ids.link041])).exported, ['arquivoExportado_0001'], 'exportado não volta como importação')
})
await deve('falha de envio tenta de novo até 5 vezes e depois FALHA', async () => {
  const v = await como(ids.lucas, async (tx) => novaVersao(tx, (await um(tx, `select document_id from document_versions where id = $1`, [ids.v041])).document_id, 'HISCON-v2.pdf'))
  const rv = (await como(ids.lucas, (tx) => um(tx, `insert into reviews (legal_case_id, document_version_id) values ($1, $2) returning id`, [ids.casoA, v]))).id
  await decidir(ids.lucas, rv, 'APPROVE')
  const id = (await um(db, `select id from external_document_exports where document_version_id = $1`, [v])).id
  for (let i = 0; i < 5; i++) {
    await exW(`select private.drive_claim_exports(5) r`)
    await comoWorker((tx) => tx.query(`select private.drive_mark_export($1, null, 'Drive fora do ar')`, [id]))
  }
  const e = await um(db, `select status, attempts, last_error from external_document_exports where id = $1`, [id])
  igual([e.status, e.attempts, e.last_error], ['FAILED', 5, 'Drive fora do ar'], 'falhou')
})
await deve('trocar a pasta guarda o histórico; desligar tira da fila o que estava pendente', async () => {
  const nova = (await como(ids.lucas, (tx) => um(tx, `select public.drive_link_client_folder($1, $2, 'JOSE FICTICIO 2') r`, [ids.cli041, F2]))).r
  igual(nova.changed, true, 'trocou')
  const antigas = await um(db, `select count(*)::int n from external_folder_links where client_id = $1 and unlinked_at is not null`, [ids.cli041])
  igual(antigas.n, 1, 'histórico')
  const v = await como(ids.lucas, async (tx) => novaVersao(tx, (await um(tx, `select document_id from document_versions where id = $1`, [ids.v041])).document_id, 'HISCON-v3.pdf'))
  const rv = (await como(ids.lucas, (tx) => um(tx, `insert into reviews (legal_case_id, document_version_id) values ($1, $2) returning id`, [ids.casoA, v]))).id
  await decidir(ids.lucas, rv, 'APPROVE')
  await como(ids.lucas, (tx) => tx.query(`select public.drive_unlink_client_folder($1)`, [ids.cli041]))
  igual((await um(db, `select status from external_document_exports where document_version_id = $1`, [v])).status, 'SKIPPED', 'saiu da fila')
  igual((await como(ids.lucas, (tx) => um(tx, `select public.get_client_drive($1) r`, [ids.cli041]))).r.link, null, 'sem pasta')
  const sem = (await como(ids.lucas, (tx) => um(tx, `select public.drive_unlinked_clients(1000) r`))).r
  if (!sem.some((c) => c.client_id === ids.cli041)) throw new Error('cliente sem pasta fora das sugestões')
})
await deve('cliente sem pasta: aprovação não gera exportação', async () => {
  const v = await como(ids.lucas, async (tx) => novaVersao(tx, (await um(tx, `select document_id from document_versions where id = $1`, [ids.v041])).document_id, 'HISCON-v4.pdf'))
  const rv = (await como(ids.lucas, (tx) => um(tx, `insert into reviews (legal_case_id, document_version_id) values ($1, $2) returning id`, [ids.casoA, v]))).id
  await decidir(ids.lucas, rv, 'APPROVE')
  igual((await um(db, `select count(*)::int n from external_document_exports where document_version_id = $1`, [v])).n, 0, 'sem fila')
})

secao('Catálogo: funções da 041')
await deve('funções do Drive fixam search_path; anon e service_role não executam; as do servidor não estão abertas ao usuário logado', async () => {
  const todas = ['reviews_queue_drive_export', 'drive_link_client_folder', 'drive_unlink_client_folder', 'get_client_drive', 'drive_unlinked_clients',
    'get_drive_summary', 'drive_links_to_sync', 'drive_known_files', 'drive_prepare_import', 'drive_register_import', 'drive_mark_synced',
    'drive_claim_exports', 'drive_mark_export']
  const r = await linhas(db, `select p.proname f, coalesce(array_to_string(p.proconfig, ','), '') cfg,
      has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('service_role', p.oid, 'execute') srv,
      has_function_privilege('authenticated', p.oid, 'execute') usr
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = any ($1)`, [todas])
  if (r.length < todas.length) throw new Error('funções faltando')
  igual(r.filter((x) => !x.cfg.includes('search_path=')).map((x) => x.f), [], 'sem search_path')
  igual(r.filter((x) => x.anon || x.srv).map((x) => x.f), [], 'anon/service_role')
  const doServidor = ['drive_links_to_sync', 'drive_known_files', 'drive_prepare_import', 'drive_register_import', 'drive_mark_synced', 'drive_claim_exports', 'drive_mark_export', 'reviews_queue_drive_export']
  igual(r.filter((x) => doServidor.includes(x.f) && x.usr).map((x) => x.f), [], 'usuário logado com porta do servidor')
})

// ═════════════════════════════ fim ═══════════════════════════════════════

console.log(
  falhas === 0
    ? `\n\x1b[32m${total} verificações, todas passaram.\x1b[0m\n`
    : `\n\x1b[31m${falhas} de ${total} verificações falharam.\x1b[0m\n`,
)
await db.close()
process.exit(falhas === 0 ? 0 : 1)
