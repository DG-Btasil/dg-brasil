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
      [JSON.stringify({ sub: uid, role: 'authenticated' })])
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

await deve('ADMIN altera origem de caso aceito → snapshot e CASE_ORIGIN_CHANGED', () => como(ids.barbara, (tx) =>
  tx.query(`update legal_cases set origin_organization_id = $2 where id = $1`, [ids.casoB, ids.almeida])
).then(async () => {
  const a = await um(db, `select partner_percentage::text p from case_partnership_agreements where legal_case_id = $1`, [ids.casoB])
  igual(a?.p, '50.00', 'snapshot criado na troca de origem')
  const ev = await um(db, `select actor_user_id, metadata from audit_events
                           where action = 'CASE_ORIGIN_CHANGED' and entity_id = $1`, [ids.casoB])
  igual(ev?.actor_user_id, ids.barbara, 'autor do evento')
  igual(ev?.metadata?.after_acceptance, true, 'after_acceptance')
}))

await deveFalhar('troca de origem não descarta acordo de parceria em silêncio', () => como(ids.barbara, (tx) =>
  tx.query(`update legal_cases set origin_organization_id = $2 where id = $1`, [ids.casoA, ids.owner])),
  /já tem acordo de parceria/)

secao('Snapshot financeiro')
await deve('alterar porcentagem padrão não altera Case antigo', async () => {
  await como(ids.barbara, (tx) => tx.query(
    `update partner_office_settings set default_partner_percentage = 60, default_owner_percentage = 40
     where organization_id = $1`, [ids.almeida]))
  const a = await um(db, `select partner_percentage::text p from case_partnership_agreements where legal_case_id = $1`, [ids.casoA])
  igual(a.p, '50.00', 'caso A continua 50/50')
  const ev = await um(db, `select metadata from audit_events where action = 'PARTNER_SHARE_CHANGED'`)
  igual(ev?.metadata?.preserved_agreements, 2, 'acordos preservados no evento')

  // Caso novo aceito depois usa 60/40.
  const novo = await um(db, `insert into legal_cases (client_id, legal_area_id, title, partner_organization_id,
      origin_organization_id, created_by_organization_id, status, accepted_at, assigned_lawyer_id)
    values ($1, $2, 'Caso novo', $3, $3, $3, 'ACCEPTED', now(), $4) returning id`,
    [ids.joao, ids.banking, ids.almeida, ids.lucas])
  const b = await um(db, `select partner_percentage::text p from case_partnership_agreements where legal_case_id = $1`, [novo.id])
  igual(b.p, '60.00', 'caso novo')
})

await deveFalhar('LAWYER não altera acordo de parceria', () => como(ids.lucas, (tx) =>
  tx.query(`update case_partnership_agreements set partner_percentage = 70, owner_percentage = 30
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
  await tx.query(`insert into documents (id, client_id, category, title) values ($1, $2, 'INTERNAL_MEMO', 'Parecer interno')`, [ids.docInterno, ids.joao])
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
                  values ($1, $2, 'IDENTITY_DOCUMENT', 'RG do João', 'PARTNER_VISIBLE')`, [ids.docParceiro, ids.joao])
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
await deve('LAWYER aprova a v1', () => como(ids.lucas, async (tx) => {
  ids.rev1 = (await um(tx, `insert into reviews (legal_case_id, document_version_id) values ($1, $2) returning id`, [ids.casoA, ids.v1])).id
  await tx.query(`insert into review_decisions (review_id, decision, decided_by) values ($1, 'APPROVE', $2)`, [ids.rev1, ids.lucas])
  const r = await um(tx, `select status, decided_at from reviews where id = $1`, [ids.rev1])
  igual(r.status, 'APPROVED', 'status da revisão')
}))

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

await deveFalhar('não se aprova de novo uma revisão já aprovada', () => como(ids.lucas, (tx) =>
  tx.query(`insert into review_decisions (review_id, decision, decided_by) values ($1, 'APPROVE', $2)`, [ids.rev1, ids.lucas])),
  /não aceita/)

await deve('reabrir mantém a decisão anterior no histórico', () => como(ids.lucas, async (tx) => {
  await tx.query(`insert into review_decisions (review_id, decision, decided_by, notes) values ($1, 'REOPEN', $2, 'Rever pedido')`, [ids.rev1, ids.lucas])
  const d = await linhas(tx, `select decision from review_decisions where review_id = $1 order by created_at`, [ids.rev1])
  igual(d.map((x) => x.decision), ['APPROVE', 'REOPEN'], 'decisões')
  igual((await um(tx, `select status from reviews where id = $1`, [ids.rev1])).status, 'REOPENED', 'status')
}))

await deveFalhar('decisão em nome de outra pessoa é recusada', () => como(ids.lucas, (tx) =>
  tx.query(`insert into review_decisions (review_id, decision, decided_by) values ($1, 'APPROVE', $2)`, [ids.rev1, ids.barbara])),
  /row-level security|próprio usuário/)

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
await deve('ADMIN registra honorários, recebimento, divisão e repasse', () => como(ids.barbara, async (tx) => {
  ids.acordo = (await um(tx, `insert into financial_agreements (legal_case_id, fixed_fee, status) values ($1, 4000, 'ACTIVE') returning id`, [ids.casoA])).id
  ids.pagamento = (await um(tx, `insert into payments (financial_agreement_id, amount, paid_amount, paid_at, payment_type, status)
    values ($1, 4000, 4000, now(), 'FIXED', 'PAID') returning id`, [ids.acordo])).id
  const parceria = await um(tx, `select id from case_partnership_agreements where legal_case_id = $1`, [ids.casoA])
  ids.parceriaA = parceria.id
  ids.divisao = (await um(tx, `insert into partner_revenue_allocations (payment_id, case_partnership_agreement_id, base_amount, partner_amount, owner_amount)
    values ($1, $2, 4000, 2000, 2000) returning id`, [ids.pagamento, ids.parceriaA])).id
  ids.repasse = (await um(tx, `insert into partner_transfers (partner_organization_id, amount, status, paid_at)
    values ($1, 1000, 'PAID', now()) returning id`, [ids.almeida])).id
  await tx.query(`insert into partner_transfer_items (transfer_id, allocation_id, amount) values ($1, $2, 1000)`, [ids.repasse, ids.divisao])
}))

await deveFalhar('um segundo acordo ATIVO no mesmo caso é impedido', () =>
  db.query(`insert into financial_agreements (legal_case_id, status) values ($1, 'ACTIVE')`, [ids.casoA]),
  /one_active_per_case/)

await deveFalhar('divisão precisa fechar com a base', () =>
  db.query(`insert into partner_revenue_allocations (payment_id, case_partnership_agreement_id, base_amount, partner_amount, owner_amount)
            values ($1, $2, 4000, 2000, 1999)`, [ids.pagamento, ids.parceriaA]),
  /allocations_sum|duplicate|payment_id/)

await deveFalhar('repasse não excede a parte do parceiro', async () => {
  const t = await um(db, `insert into partner_transfers (partner_organization_id, amount) values ($1, 5000) returning id`, [ids.almeida])
  await db.query(`insert into partner_transfer_items (transfer_id, allocation_id, amount) values ($1, $2, 1500)`, [t.id, ids.divisao])
}, /excede a parte/)

await deveFalhar('valor negativo é rejeitado', () =>
  db.query(`insert into payments (financial_agreement_id, amount, payment_type) values ($1, -10, 'OTHER')`, [ids.acordo]))

await deveFalhar('PAID sem valor integral é inconsistente', () =>
  db.query(`insert into payments (financial_agreement_id, amount, paid_amount, paid_at, payment_type, status)
            values ($1, 100, 50, now(), 'OTHER', 'PAID')`, [ids.acordo]),
  /status_consistent/)

await deve('Partner Admin vê apenas seu financeiro', () => como(ids.almeidaAdm, async (tx) => {
  const acordos = await linhas(tx, `select partner_organization_id from case_partnership_agreements`)
  if (acordos.length === 0 || acordos.some((a) => a.partner_organization_id !== ids.almeida))
    throw new Error(`acordos vistos: ${JSON.stringify(acordos)}`)
  igual((await linhas(tx, `select partner_amount::text v from partner_revenue_allocations`)).map((x) => x.v), ['2000.00'], 'divisões')
  igual((await linhas(tx, `select amount::text v from partner_transfers where status = 'PAID'`)).map((x) => x.v), ['1000.00'], 'repasses')
  igual((await linhas(tx, `select 1 from payments`)).length, 0, 'pagamentos internos')
  igual((await linhas(tx, `select 1 from financial_agreements`)).length, 0, 'honorários internos')
  igual((await linhas(tx, `select 1 from fee_models`)).length, 0, 'modelos de honorários')
}))

await deve('Partner Admin de outro parceiro não vê o financeiro da Almeida', () => como(ids.ferreiraAdm, async (tx) => {
  igual((await linhas(tx, `select 1 from case_partnership_agreements`)).length, 0, 'acordos')
  igual((await linhas(tx, `select 1 from partner_revenue_allocations`)).length, 0, 'divisões')
  igual((await linhas(tx, `select 1 from partner_transfers`)).length, 0, 'repasses')
}))

await deve('Partner User não vê financeiro', () => como(ids.almeidaUsr, async (tx) => {
  for (const t of ['case_partnership_agreements', 'partner_revenue_allocations', 'partner_transfers',
    'partner_transfer_items', 'payments', 'financial_agreements']) {
    igual((await linhas(tx, `select 1 from ${t}`)).length, 0, t)
  }
}))

await deve('LAWYER e ASSISTANT não veem financeiro interno', async () => {
  for (const u of [ids.lucas, ids.ana]) {
    await como(u, async (tx) => {
      for (const t of ['payments', 'financial_agreements', 'case_partnership_agreements', 'partner_transfers'])
        igual((await linhas(tx, `select 1 from ${t}`)).length, 0, t)
    })
  }
})

// ═════════════════════════════ agentes e fila ════════════════════════════

secao('Agentes, fila e o gate humano')
await deve('ADMIN cadastra agente e versão; current_version aponta para versão dele', () => como(ids.barbara, async (tx) => {
  ids.agente = (await um(tx, `insert into agents (slug, name, status) values ('analise-bancaria', 'Análise bancária', 'ACTIVE') returning id`)).id
  ids.agenteV = (await um(tx, `insert into agent_versions (agent_id, instructions) values ($1, 'Analise o extrato.') returning id, version_number`, [ids.agente]))
  igual(ids.agenteV.version_number, 1, 'número da versão')
  ids.agenteV = ids.agenteV.id
  await tx.query(`update agents set current_version_id = $2 where id = $1`, [ids.agente, ids.agenteV])
}))

await deve('LAWYER não vê agentes, skills nem execuções', () => como(ids.lucas, async (tx) => {
  for (const t of ['agents', 'agent_versions', 'skills', 'legal_theses', 'reference_materials', 'agent_runs'])
    igual((await linhas(tx, `select 1 from ${t}`)).length, 0, t)
}))

await deve('Service user/worker consegue processar AgentRun', () => comoServico(async (tx) => {
  ids.run = (await um(tx, `insert into agent_runs (agent_id, agent_version_id, legal_case_id, requested_by, model)
    values ($1, $2, $3, $4, 'claude-opus-5-5') returning id`, [ids.agente, ids.agenteV, ids.casoA, ids.lucas])).id
  const env = await um(tx, `select private.enqueue_agent_run($1) msg_id`, [ids.run])

  // Worker: lê a mensagem, executa e registra.
  const msg = await um(tx, `select * from pgmq.read('agent_execution', 60, 1)`)
  igual(String(msg.msg_id), String(env.msg_id), 'mensagem lida')
  igual(Object.keys(msg.message).sort(), ['agent_run_id', 'correlation_id', 'legal_case_id', 'operation'], 'payload mínimo')
  igual(msg.message.agent_run_id, ids.run, 'agent_run_id na mensagem')

  await tx.query(`update agent_runs set status = 'RUNNING', started_at = now() where id = $1`, [ids.run])
  ids.proposta = (await um(tx, `insert into agent_proposals (agent_run_id, legal_case_id, proposal_type, payload)
    values ($1, $2, 'CREATE_DEADLINE', '{"title":"Réplica","days":15}') returning id`, [ids.run, ids.casoA])).id
  await tx.query(`update agent_runs set status = 'WAITING_HUMAN', input_tokens = 1200, output_tokens = 300, estimated_cost = 0.012 where id = $1`, [ids.run])
  await tx.query(`select pgmq.archive('agent_execution', $1)`, [msg.msg_id])
}))

await deveFalhar('não se enfileira execução que já saiu de QUEUED', () => comoServico((tx) =>
  tx.query(`select private.enqueue_agent_run($1)`, [ids.run])),
  /não está QUEUED/)

await deveFalhar('usuário logado não acessa a fila', () => como(ids.barbara, (tx) =>
  tx.query(`select * from pgmq.send('agent_execution', '{}'::jsonb)`)),
  /permission denied/)

await deveFalhar('usuário logado não chama o enfileirador', () => como(ids.barbara, (tx) =>
  tx.query(`select private.enqueue_agent_run($1)`, [ids.run])),
  /permission denied/)

await deveFalhar('IA não se aprova sozinha: proposta exige revisão humana', () => comoServico((tx) =>
  tx.query(`update agent_proposals set status = 'APPROVED' where id = $1`, [ids.proposta])),
  /revisão humana aprovada/)

await deve('humano revisa → proposta aprovada → aplicada', async () => {
  await como(ids.lucas, async (tx) => {
    const r = await um(tx, `insert into reviews (legal_case_id, agent_proposal_id) values ($1, $2) returning id`, [ids.casoA, ids.proposta])
    await tx.query(`insert into review_decisions (review_id, decision, decided_by) values ($1, 'APPROVE', $2)`, [r.id, ids.lucas])
  })
  await comoServico(async (tx) => {
    await tx.query(`update agent_proposals set status = 'APPROVED' where id = $1`, [ids.proposta])
    await tx.query(`update agent_proposals set status = 'APPLIED' where id = $1`, [ids.proposta])
    await tx.query(`update agent_runs set status = 'COMPLETED', completed_at = now() where id = $1`, [ids.run])
  })
  const p = await um(db, `select status, decided_at from agent_proposals where id = $1`, [ids.proposta])
  igual(p.status, 'APPLIED', 'status da proposta')
})

await deveFalhar('integração não guarda chave de API', () =>
  db.query(`insert into integration_connections (organization_id, provider, type, credentials_reference)
            values ($1, 'anthropic', 'CLAUDE', 'sk-ant-api03-xxxxxxxx')`, [ids.owner]),
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

// ═════════════════════════════ fim ═══════════════════════════════════════

console.log(
  falhas === 0
    ? `\n\x1b[32m${total} verificações, todas passaram.\x1b[0m\n`
    : `\n\x1b[31m${falhas} de ${total} verificações falharam.\x1b[0m\n`,
)
await db.close()
process.exit(falhas === 0 ? 0 : 1)
