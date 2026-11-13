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

// Kit básico de agentes (054): os 13 clones e o orquestrador já vêm cadastrados.
const KIT054 = ['clara-hiscon-dg', 'lucas-procuracao-dg', 'alice-inicial-dg', 'atlas-revisional-dg', 'vicente-agregados-dg',
  'murilo-replica-dg', 'pedro-provas-dg', 'teresa-audiencia-dg', 'laura-emenda-dg', 'rafael-recurso-dg', 'gabriel-embargos-dg',
  'paulo-agravo-dg', 'beatriz-cumprimento-dg', 'orquestrador']
await deve('kit básico [054]: 14 agentes ativos, cada um chamando o agente de mesmo nome no computador do escritório', async () => {
  const r = await db.query(`select a.slug, a.status, v.version_number, v.configuration ->> 'local_agent' local, v.instructions
                              from agents a join agent_versions v on v.id = a.current_version_id where a.slug = any($1) order by a.slug`, [KIT054])
  igual(r.rows.length, KIT054.length, 'agentes do kit')
  for (const a of r.rows) {
    igual([a.status, a.version_number, a.local], ['ACTIVE', 1, a.slug], a.slug)
    if (a.slug !== 'orquestrador' && !/FICHA_REVISAO_/.test(a.instructions)) throw new Error(`${a.slug}: orientações sem a ficha de revisão`)
  }
  const t = await um(db, `select a.slug from analysis_templates t join agents a on a.id = t.primary_agent_id where t.name = 'Análise Bancária'`)
  igual(t.slug, 'clara-hiscon-dg', 'Análise Bancária com a Clara do kit')
})
await deve('kit básico [054]: rodar de novo não duplica e não mexe no que o escritório editou', async () => {
  await db.query(`update agents set name = 'Clara editada no site' where slug = 'clara-hiscon-dg'`)
  await db.exec(await readFile(new URL('migrations/20261112000054_kit_basico_agentes.sql', raiz), 'utf8'))
  const r = await um(db, `select count(*)::int n, max(name) filter (where slug = 'clara-hiscon-dg') clara from agents where slug = any($1)`, [KIT054])
  igual([r.n, r.clara], [KIT054.length, 'Clara editada no site'], 'sem duplicar, sem sobrescrever')
  igual((await um(db, `select count(*)::int n from agent_versions v join agents a on a.id = v.agent_id where a.slug = 'clara-hiscon-dg'`)).n, 1, 'uma versão')
})
await deve('sequência automática [056]: a Análise Bancária já sai com Lucas e depois Alice, cada um com o seu pedido', async () => {
  const t = await um(db, `select (select array_agg(a.slug order by x.pos) from unnest(t.next_agent_ids) with ordinality x(id, pos)
                                   join agents a on a.id = x.id) slugs, t.next_agent_requests req
                            from analysis_templates t where t.name = 'Análise Bancária'`)
  igual(t.slugs, ['lucas-procuracao-dg', 'alice-inicial-dg'], 'sequência')
  const lucas = (await um(db, `select id from agents where slug = 'lucas-procuracao-dg'`)).id
  const alice = (await um(db, `select id from agents where slug = 'alice-inicial-dg'`)).id
  if (!/procuração, declaração de hipossuficiência e contrato de honorários/.test(t.req[lucas])) throw new Error('pedido do Lucas')
  if (!/primeira rodada.*segunda rodada não está autorizada/s.test(t.req[alice])) throw new Error('pedido da Alice')
})
// Agente de prazos (058): entra no kit e, como a integração judicial não tinha agente escolhido, passa a propor os prazos.
// Prazo direto (059): as orientações da 058 ("o prazo só vale depois que um advogado aprovar em Revisões") ganham versão nova.
const KIT058 = 'intimacao-dg'
const DIANA058 = ['Como entregar no DG Brasil:',
  '- O agente termina a resposta com um bloco PROPOR (tipo, resumo, dados). Chame a ferramenta propor UMA vez, exatamente com esses dados.',
  '- Nunca escreva ao cliente nem diga que algo foi protocolado: o prazo só vale depois que um advogado aprovar em Revisões.'].join('\n')
const DIANA059 = ['Como entregar no DG Brasil:',
  '- O agente termina a resposta com um bloco PROPOR (tipo, resumo, dados). Chame a ferramenta propor UMA vez, exatamente com esses dados.',
  '- Nunca escreva ao cliente nem diga que algo foi protocolado. O prazo proposto entra direto na agenda do processo; "Sem prazo" vai para a equipe conferir.'].join('\n')
await deve('agente de prazos [058/059]: a Diana vem cadastrada e ativa, chamando o intimacao-dg, já com as orientações do prazo direto (versão 2); a integração judicial, que não tinha agente, aponta para ela', async () => {
  const a = await um(db, `select a.id, a.name, a.description, a.purpose, a.status, v.version_number, v.configuration ->> 'local_agent' local, v.instructions
                            from agents a join agent_versions v on v.id = a.current_version_id where a.slug = $1 and a.deleted_at is null`, [KIT058])
  igual([a.name, a.status, a.version_number, a.local], ['Diana · Prazos das publicações', 'ACTIVE', 2, KIT058], 'agente')
  igual(a.description, 'Lê cada publicação nova do DJEN, diz se abre prazo para o cliente e propõe o prazo, com a contagem e o agente que faz a peça.', 'descrição')
  igual(a.purpose, "Nenhum prazo sem dono: toda publicação vira um prazo proposto ou um 'sem prazo' para a equipe conferir.", 'objetivo')
  igual(a.instructions, DIANA059, 'orientações (059)')
  const v = await linhas(db, `select version_number n, instructions i, configuration ->> 'local_agent' local from agent_versions where agent_id = $1 order by version_number`, [a.id])
  igual(v.map((x) => [x.n, x.i, x.local]), [[1, DIANA058, KIT058], [2, DIANA059, KIT058]], 'a versão da 058 continua no histórico')
  const s = await um(db, `select deadline_agent_id, updated_by, deadline_auto_apply from judicial_settings where id`)
  igual([s.deadline_agent_id, s.updated_by, s.deadline_auto_apply], [a.id, null, true], 'agente que propõe prazos (ninguém "escolheu": updated_by fica vazio); prazo direto ligado')
})
// Os testes seguintes montam os próprios agentes e supõem o banco sem agentes do kit (modelo sem agente, sem
// orquestrador, sem sequência automática, integração judicial sem agente de prazos): o kit sai de cena, como se
// tivesse sido arquivado no site.
await db.query(`update analysis_templates set primary_agent_id = null, next_agent_ids = '{}', next_agent_requests = '{}' where name = 'Análise Bancária'`)
await db.query(`update judicial_settings set deadline_agent_id = null where id`)
await db.query(`update agents set slug = slug || '-kit054', status = 'INACTIVE', deleted_at = now() where slug = any($1)`, [[...KIT054, KIT058]])

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

// Roadmap 2.0 [046]: contrato de honorários é do PROCESSO. Nos testes antigos,
// o contrato vai para o primeiro processo do caso (criado aqui se não houver).
await db.exec(`
  create or replace function public.test_process_of(p_case uuid) returns uuid
  language plpgsql security definer set search_path = '' as $f$
  declare v uuid;
  begin
    select id into v from public.legal_processes where legal_case_id = p_case and deleted_at is null order by created_at, id limit 1;
    if v is null then
      insert into public.legal_processes (legal_case_id, title) values (p_case, 'Processo do contrato') returning id into v;
    end if;
    return v;
  end $f$;
  grant execute on function public.test_process_of(uuid) to authenticated;
`)

secao('Financeiro')
await deve('ADMIN registra honorários, obrigação e recebimento; a divisão nasce sozinha do snapshot', () => como(ids.barbara, async (tx) => {
  ids.acordo = (await um(tx, `insert into financial_agreements (legal_process_id, legal_case_id, fixed_fee, status) values (public.test_process_of($1), $1, 4000, 'ACTIVE') returning id`, [ids.casoA])).id
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

await deveFalhar('um segundo acordo ATIVO no mesmo processo é impedido', () =>
  db.query(`insert into financial_agreements (legal_process_id, legal_case_id, status) values (public.test_process_of($1), $1, 'ACTIVE')`, [ids.casoA]),
  /one_active_per_process/)

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
  const fa = (await um(db, `insert into financial_agreements (legal_process_id, legal_case_id, status) values (public.test_process_of($1), $1, 'ACTIVE') returning id`, [novo])).id
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
  const fa = (await um(db, `insert into financial_agreements (legal_process_id, legal_case_id, status) values (public.test_process_of($1), $1, 'ACTIVE') returning id`, [caso])).id
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
await deveFalhar('cliente não tem mais "responsável" (Roadmap 2.0: advogado responde por caso/processo) [045]', () =>
  db.query(`update clients set responsible_user_id = $2 where id = $1`, [ids.joao, ids.almeidaAdm]), /responsible_user_id/)

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
  (await um(tx, `insert into financial_agreements (legal_process_id, legal_case_id, status, fixed_fee, notes) values (public.test_process_of($1), $1, $2, $3, $4) returning id`,
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
  const a1 = await como(ids.barbara, async (tx) => (await um(tx, `insert into financial_agreements (legal_process_id, legal_case_id, fee_model_id) values (public.test_process_of($1), $1, $2) returning id`, [caso1, modelo])).id)
  const a2 = await como(ids.barbara, async (tx) => (await um(tx, `insert into financial_agreements (legal_process_id, legal_case_id, fee_model_id) values (public.test_process_of($1), $1, $2) returning id`, [caso2, modelo])).id)
  const a3 = await como(ids.barbara, async (tx) => (await um(tx, `insert into financial_agreements (legal_process_id, legal_case_id, fee_model_id) values (public.test_process_of($1), $1, $2) returning id`, [caso3, modelo])).id)
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
await deve('agendamentos do pg_cron registrados (manutenção a cada minuto; lembretes de prazo; importações diária [042]; DataJud a cada 20 min [043])', async () => {
  const j = await linhas(db, `select jobname, schedule from cron.job where jobname like 'dg-%' order by jobname`)
  igual(j.map((x) => [x.jobname, x.schedule]), [['dg-importacoes', '17 6 * * *'], ['dg-judicial', '*/5 * * * *'], ['dg-lembretes-de-prazo', '*/15 * * * *'], ['dg-limpeza-do-agendador', '43 6 * * *'], ['dg-manutencao', '* * * * *']], 'jobs')
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

// ═════════════════════════════ 042 ═══════════════════════════════════════

secao('Importação de planilhas: arquivo, colunas e mapeamento [042]')
const imp = {}
const rpc042 = (uid, sql, params) => como(uid, (tx) => um(tx, sql, params)).then((x) => x?.r)
const cpf042 = (n) => `99904${String(n).padStart(6, '0')}`
const cnj042 = (n) => cnj(9042000 + n, '2026', '8', '26', '0042')
const amanha042 = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10)

await deveFalhar('advogado não opera importação', () =>
  rpc042(ids.lucas, `select public.import_create_job('x.csv', 'CSV') r`), /administrador/)
await deveFalhar('formato fora de CSV/XLSX é recusado', () =>
  rpc042(ids.barbara, `select public.import_create_job('x.json', 'JSON') r`), /Formato não aceito/)
await deve('ADMIN cria o job: UPLOADED, caminho decidido pelo banco (sem o nome do arquivo)', async () => {
  const r = await rpc042(ids.barbara, `select public.import_create_job('Clientes ADVBOX.xlsx', 'xlsx') r`)
  imp.job = r.import_job_id
  igual(r.storage_object_name, `jobs/${imp.job}/source.xlsx`, 'caminho')
  const j = await um(db, `select status, file_type, created_by, organization_id from import_jobs where id = $1`, [imp.job])
  igual([j.status, j.file_type, j.created_by, j.organization_id], ['UPLOADED', 'XLSX', ids.barbara, ids.owner], 'job')
  igual((await rpc042(ids.barbara, `select public.import_authorize_file($1) r`, [imp.job])).storage_object_name, r.storage_object_name, 'autorização')
})
const colunas042 = ['Nome', 'CPF', 'Telefone', 'Cidade', 'UF', 'Processo', 'Ação', 'Vara', 'Status', 'Responsável', 'Vencimento']
await deveFalhar('cabeçalho com coluna repetida é recusado', () =>
  rpc042(ids.barbara, `select public.import_register_columns($1, $2, 'Plan1', '["Nome","Nome"]', 3) r`, [imp.job, sha('a')]), /mesmo nome/)
await deveFalhar('mais de 5.000 linhas é recusado', () =>
  rpc042(ids.barbara, `select public.import_register_columns($1, $2, 'Plan1', '["Nome"]', 5001) r`, [imp.job, sha('a')]), /limite é 5.000/)
await deve('colunas lidas → COLUMNS_DETECTED; o mesmo arquivo em outro job gera aviso', async () => {
  const r = await rpc042(ids.barbara, `select public.import_register_columns($1, $2, 'Plan1', $3, 8) r`, [imp.job, sha('4'), JSON.stringify(colunas042)])
  igual([r.status, r.same_file_jobs.length], ['COLUMNS_DETECTED', 0], 'primeiro')
  const outro = (await rpc042(ids.barbara, `select public.import_create_job('copia.xlsx', 'XLSX') r`)).import_job_id
  const r2 = await rpc042(ids.barbara, `select public.import_register_columns($1, $2, null, '["Nome"]', 1) r`, [outro, sha('4')])
  igual(r2.same_file_jobs.map((x) => x.id), [imp.job], 'aviso de arquivo repetido')
  await como(ids.barbara, (tx) => tx.query(`select public.import_cancel($1)`, [outro]))
})
const map042 = [['Nome', 'client.name'], ['CPF', 'client.document'], ['Telefone', 'client.phone'], ['Cidade', 'client.city'],
  ['UF', 'client.state'], ['Processo', 'process.cnj'], ['Ação', 'process.actionType'], ['Vara', 'process.court'],
  ['Status', 'process.status'], ['Responsável', 'process.responsible'], ['Vencimento', 'process.dueDate']]
  .map(([source_column, target_field]) => ({ source_column, target_field }))
await deveFalhar('campo de destino fora da lista é recusado', () =>
  rpc042(ids.barbara, `select public.import_save_mapping($1, '[{"source_column":"Nome","target_field":"client.senha"}]') r`, [imp.job]), /desconhecido/)
await deveFalhar('sem o nome do cliente não há importação', () =>
  rpc042(ids.barbara, `select public.import_save_mapping($1, '[{"source_column":"Processo","target_field":"process.cnj"}]') r`, [imp.job]), /nome do cliente/)
await deveFalhar('com processo, área e advogado padrão são obrigatórios', () =>
  rpc042(ids.barbara, `select public.import_save_mapping($1, $2, '{}') r`, [imp.job, JSON.stringify(map042)]), /área jurídica/)
await deveFalhar('advogado padrão precisa ser ADMIN ou LAWYER (assistente não)', () =>
  rpc042(ids.barbara, `select public.import_save_mapping($1, $2, $3) r`,
    [imp.job, JSON.stringify(map042), JSON.stringify({ legal_area_id: ids.banking, lawyer_id: ids.ana })]), /advogado responsável padrão/)
await deve('mapeamento salvo → MAPPED, com as opções', async () => {
  const r = await rpc042(ids.barbara, `select public.import_save_mapping($1, $2, $3) r`,
    [imp.job, JSON.stringify(map042), JSON.stringify({ legal_area_id: ids.banking, lawyer_id: ids.lucas })])
  igual([r.status, r.has_processes], ['MAPPED', true], 'mapeado')
  const j = await um(db, `select options from import_jobs where id = $1`, [imp.job])
  igual([j.options.legal_area_id, j.options.lawyer_id], [ids.banking, ids.lucas], 'opções')
})

secao('Importação de planilhas: simulação e conflitos (nada gravado) [042]')
await deve('cenário: cliente e processo existentes para conflitar', async () => {
  const c = await um(db, `select c.id, c.cpf, i.full_name from clients c join individual_client_details i on i.client_id = c.id
    where c.deleted_at is null order by c.created_at limit 1`)
  imp.existente = c
  const outro = await um(db, `select c.id, i.full_name from clients c join individual_client_details i on i.client_id = c.id
    where c.deleted_at is null and c.id <> $1 order by c.created_at limit 1`, [c.id])
  imp.homonimo = outro
  const p = await um(db, `select lp.id, lp.cnj_number, lp.court from legal_processes lp where lp.cnj_number is not null and lp.deleted_at is null order by lp.created_at limit 1`)
  imp.processo = p
  if (!c || !outro || !p) throw new Error('cenário sem cliente/processo existente')
})
const pf042 = (n, nome, extra = {}) => ({ kind: 'INDIVIDUAL', document: cpf042(n), name: nome, ...extra })
const linhas042 = () => [
  { row_number: 2, status: 'VALID', raw_data: { Nome: 'Ana Importada' }, payload: {
    client: pf042(1, 'Ana Importada', { phone: '11900000001', address: { city: 'Campinas', state: 'SP' }, responsible_user_id: ids.lucas }),
    process: { cnj: cnj042(1), legal_class: 'Revisional de consignado', court: 'TJSP', status: 'ACTIVE', phase: 'PLEADINGS', due_date: amanha042, responsible_user_id: ids.lucas } } },
  { row_number: 3, status: 'WARNING', warnings: ['Dados do cliente diferentes da linha 2: vale a primeira.'], payload: {
    client: pf042(1, 'Ana Importada Outra Grafia'),
    process: { cnj: cnj042(2), legal_class: 'Repetição de indébito', status: 'FILED' } } },
  { row_number: 4, status: 'VALID', payload: {
    client: { kind: 'INDIVIDUAL', document: imp.existente.cpf, name: imp.existente.full_name, phone: '11955554444' },
    process: { cnj: cnj042(3), legal_class: 'Declaratória' } } },
  { row_number: 5, status: 'VALID', payload: {
    client: pf042(5, imp.homonimo.full_name.toUpperCase()),
    process: { cnj: cnj042(5), legal_class: 'Revisional' } } },
  { row_number: 6, status: 'VALID', payload: {
    client: pf042(6, 'Carlos Importado'),
    process: { cnj: imp.processo.cnj_number, court: 'TJSP — 3ª Vara Cível (importado)' } } },
  { row_number: 7, status: 'ERROR', errors: ['CPF inválido.'], raw_data: { Nome: 'Sem CPF' } },
  { row_number: 8, status: 'VALID', payload: { client: pf042(8, 'Dora Só Cliente', { email: 'dora@exemplo.com.br' }) } },
  { row_number: 9, status: 'VALID', payload: {
    client: pf042(9, 'Eva Encerrada'),
    process: { cnj: cnj042(9), legal_class: 'Cobrança', status: 'CLOSED', phase: 'ARCHIVED' } } },
]
await deveFalhar('lote com linha sem CPF/CNPJ válido no payload é recusado', () =>
  rpc042(ids.barbara, `select public.import_stage_rows($1, $2, true) r`,
    [imp.job, JSON.stringify([{ row_number: 2, status: 'VALID', payload: { client: { document: '123' } } }])]), /Lote de linhas inválido/)
await deveFalhar('simulação não fecha com linhas faltando', async () => {
  await rpc042(ids.barbara, `select public.import_stage_rows($1, $2, true) r`, [imp.job, JSON.stringify(linhas042().slice(0, 3))])
  await rpc042(ids.barbara, `select public.import_finish_dry_run($1) r`, [imp.job])
}, /incompleta/)
await deve('simulação: conflitos de CPF, homônimo e CNJ; nada criado em clientes/processos', async () => {
  const antes = await um(db, `select (select count(*) from clients)::int c, (select count(*) from legal_processes)::int p, (select count(*) from legal_cases)::int k`)
  const todas = linhas042()
  igual(await rpc042(ids.barbara, `select public.import_stage_rows($1, $2, true) r`, [imp.job, JSON.stringify(todas.slice(0, 4))]), 4, 'lote 1')
  igual(await rpc042(ids.barbara, `select public.import_stage_rows($1, $2, false) r`, [imp.job, JSON.stringify(todas.slice(4))]), 4, 'lote 2')
  const r = await rpc042(ids.barbara, `select public.import_finish_dry_run($1) r`, [imp.job])
  igual([r.status, r.open_conflicts], ['CONFLICTS_PENDING', 3], 'conflitos')
  const k = await linhas(db, `select row_number, conflict_kind, existing_entity_id from import_conflicts where import_job_id = $1 order by row_number`, [imp.job])
  igual(k.map((x) => [x.row_number, x.conflict_kind]), [[4, 'CLIENT_DOCUMENT'], [5, 'POSSIBLE_DUPLICATE'], [6, 'PROCESS_CNJ']], 'tipos')
  igual([k[0].existing_entity_id, k[1].existing_entity_id, k[2].existing_entity_id], [imp.existente.id, imp.homonimo.id, imp.processo.id], 'existentes')
  const depois = await um(db, `select (select count(*) from clients)::int c, (select count(*) from legal_processes)::int p, (select count(*) from legal_cases)::int k`)
  igual(depois, antes, 'simulação não grava')
  const w = await um(db, `select status, warnings from import_row_results where import_job_id = $1 and row_number = 6`, [imp.job])
  igual([w.status, w.warnings.some((x) => /outro cliente/.test(x))], ['WARNING', true], 'aviso de processo de outro cliente')
  const j = await um(db, `select successful_rows, warning_rows, failed_rows, dry_run_at is not null d from import_jobs where id = $1`, [imp.job])
  igual([j.successful_rows, j.warning_rows, j.failed_rows, j.d], [5, 2, 1, true], 'contagens da simulação')
})
await deve('tela de conflitos traz o que já existe e quantas linhas do cliente', async () => {
  const r = await rpc042(ids.barbara, `select public.get_import_conflicts($1) r`, [imp.job])
  igual([r.total, r.open, r.items.length], [3, 3, 3], 'totais')
  const c = r.items[0]
  igual([c.kind, c.existing_label, c.existing_document, c.rows_with_same_client], ['CLIENT_DOCUMENT', imp.existente.full_name, imp.existente.cpf, 1], 'CPF')
  igual(r.items[2].existing_client_name !== null, true, 'cliente do processo existente')
})
await deveFalhar('não confirma com conflito aberto', () => rpc042(ids.barbara, `select public.import_confirm($1) r`, [imp.job]), /outra etapa/)
await deveFalhar('CPF já cadastrado nunca vira cliente novo (CREATE_NEW recusado)', () =>
  rpc042(ids.barbara, `select public.import_resolve_conflicts($1, $2) r`, [imp.job, JSON.stringify([{ kind: 'CLIENT_DOCUMENT', resolution: 'CREATE_NEW' }])]), /não permitida/)
await deveFalhar('possível duplicata não aceita "Atualizar"', () =>
  rpc042(ids.barbara, `select public.import_resolve_conflicts($1, $2) r`, [imp.job, JSON.stringify([{ kind: 'POSSIBLE_DUPLICATE', resolution: 'UPDATE' }])]), /não permitida/)
await deve('decisões: atualizar CPF, ignorar homônimo, atualizar CNJ → VALIDATED; desfazer volta a pendente', async () => {
  const ks = await linhas(db, `select id, conflict_kind from import_conflicts where import_job_id = $1`, [imp.job])
  const id = (k) => ks.find((x) => x.conflict_kind === k).id
  let r = await rpc042(ids.barbara, `select public.import_resolve_conflicts($1, $2) r`, [imp.job, JSON.stringify([
    { conflict_id: id('CLIENT_DOCUMENT'), resolution: 'UPDATE' }, { conflict_id: id('POSSIBLE_DUPLICATE'), resolution: 'IGNORE' }])])
  igual([r.open_conflicts, r.status], [1, 'CONFLICTS_PENDING'], 'um aberto')
  r = await rpc042(ids.barbara, `select public.import_resolve_conflicts($1, $2) r`, [imp.job, JSON.stringify([{ kind: 'PROCESS_CNJ', resolution: 'UPDATE' }])])
  igual([r.open_conflicts, r.status], [0, 'VALIDATED'], 'todos resolvidos')
  r = await rpc042(ids.barbara, `select public.import_resolve_conflicts($1, $2) r`, [imp.job, JSON.stringify([{ conflict_id: id('PROCESS_CNJ'), resolution: null }])])
  igual(r.status, 'CONFLICTS_PENDING', 'desfeito')
  r = await rpc042(ids.barbara, `select public.import_resolve_conflicts($1, $2) r`, [imp.job, JSON.stringify([{ conflict_id: id('PROCESS_CNJ'), resolution: 'UPDATE' }])])
  igual(r.status, 'VALIDATED', 'de novo')
  igual((await um(db, `select resolved_by from import_conflicts where id = $1`, [id('PROCESS_CNJ')])).resolved_by, ids.barbara, 'quem decidiu')
})
await deve('prévia calculada pela mesma regra da gravação', async () => {
  imp.plano = await rpc042(ids.barbara, `select public.get_import_plan($1) r`, [imp.job])
  const p = imp.plano
  igual([p.rows_total, p.rows_error, p.rows_to_import, p.rows_to_skip], [8, 1, 6, 1], 'linhas')
  igual([p.clients_create, p.clients_update, p.clients_keep, p.clients_skip], [4, 1, 0, 1], 'clientes')
  igual([p.processes_create, p.processes_update, p.processes_skip, p.cases_create, p.deadlines_create], [4, 1, 1, 4, 1], 'processos')
})
await deveFalhar('advogado não lê a prévia', () => rpc042(ids.lucas, `select public.get_import_plan($1) r`, [imp.job]), /administrador/)

secao('Importação de planilhas: confirmação, gravação em lotes e relatório [042]')
await deve('confirma: autor e hora registrados', async () => {
  await rpc042(ids.barbara, `select public.import_confirm($1) r`, [imp.job])
  const j = await um(db, `select status, confirmed_by, confirmed_at is not null c from import_jobs where id = $1`, [imp.job])
  igual([j.status, j.confirmed_by, j.c], ['CONFIRMED', ids.barbara, true], 'confirmado')
})
await deveFalhar('confirmado: o mapeamento não muda mais', () => como(ids.barbara, (tx) =>
  tx.query(`insert into import_column_mappings (import_job_id, source_column, target_field) values ($1, 'Vara', 'process.courtUnit')`, [imp.job])), /não pode mais ser alterado/)
await deve('grava em lotes até concluir; contagens batem com a prévia', async () => {
  let r = await rpc042(ids.barbara, `select public.import_process_batch($1, 2) r`, [imp.job])
  igual([r.status, r.processed, r.remaining], ['PROCESSING', 2, 5], 'primeiro lote')
  let voltas = 0
  while (r.status !== 'COMPLETED' && voltas++ < 10) r = await rpc042(ids.barbara, `select public.import_process_batch($1, 2) r`, [imp.job])
  igual([r.status, r.imported, r.skipped, r.failed, r.failed_on_save], ['COMPLETED', 6, 1, 1, 0], 'resultado')
  igual([r.clients_created, r.clients_updated, r.processes_created, r.processes_updated, r.deadlines_created],
    [imp.plano.clients_create, imp.plano.clients_update, imp.plano.processes_create, imp.plano.processes_update, imp.plano.deadlines_create], 'igual à prévia')
  const j = await um(db, `select status, successful_rows, failed_rows, completed_at is not null c from import_jobs where id = $1`, [imp.job])
  igual([j.status, j.successful_rows, j.failed_rows, j.c], ['COMPLETED', 6, 1, true], 'job')
  const a = await um(db, `select metadata from audit_events where action = 'IMPORT_JOB_SUMMARY' and entity_id = $1`, [imp.job])
  igual(a.metadata.processes_created, 4, 'auditoria do resumo')
})
await deve('mesmo CPF em duas linhas = um cliente com dois casos/processos; origem IMPORT, caso em andamento com advogado', async () => {
  const c = await um(db, `select id from clients where cpf = $1`, [cpf042(1)])
  const ps = await linhas(db, `select lp.technical_origin, lp.status, lp.responsible_user_id, lc.status cs, lc.assigned_lawyer_id, lc.origin_organization_id, lc.legal_area_id
    from legal_processes lp join legal_cases lc on lc.id = lp.legal_case_id where lc.client_id = $1 order by lp.cnj_number`, [c.id])
  igual(ps.length, 2, 'dois processos')
  igual(ps.map((p) => [p.technical_origin, p.cs, p.assigned_lawyer_id, p.origin_organization_id, p.legal_area_id]),
    [['IMPORT', 'IN_PROGRESS', ids.lucas, ids.owner, ids.banking], ['IMPORT', 'IN_PROGRESS', ids.lucas, ids.owner, ids.banking]], 'casos')
  const r2 = await um(db, `select status, entity_type, outcome from import_row_results where import_job_id = $1 and row_number = 2`, [imp.job])
  const r3 = await um(db, `select status, outcome from import_row_results where import_job_id = $1 and row_number = 3`, [imp.job])
  igual([r2.status, r2.entity_type, r2.outcome.client_action, r3.outcome.client_action, r3.outcome.client_id], ['IMPORTED', 'legal_processes', 'CREATE', 'LINK', c.id], 'procedência')
  const d = await um(db, `select d.title, d.source, d.responsible_user_id, (d.due_at at time zone 'America/Sao_Paulo')::date::text dia
    from deadlines d where d.id = $1`, [r2.outcome.deadline_id])
  igual([d.source, d.responsible_user_id, d.dia], ['MANUAL', ids.lucas, amanha042], 'prazo do vencimento')
  const ev = await um(db, `select source, event_type from process_events where legal_process_id = $1`, [r2.outcome.legal_process_id])
  igual([ev.source, ev.event_type], ['IMPORT', 'IMPORT'], 'movimentação de procedência')
  const notas = await um(db, `select notes from client_internal_details where client_id = $1`, [c.id])
  igual(/linha 2/.test(notas.notes), true, 'origem nas observações internas')
})
await deve('CPF existente atualizado só no que veio; homônimo ignorado; CNJ existente atualizado sem trocar cliente', async () => {
  const fone = await um(db, `select value from client_contacts where client_id = $1 and type = 'PHONE' and is_primary`, [imp.existente.id])
  igual(fone.value, '11955554444', 'telefone atualizado')
  const nome = await um(db, `select full_name from individual_client_details where client_id = $1`, [imp.existente.id])
  igual(nome.full_name, imp.existente.full_name, 'nome mantido')
  igual((await um(db, `select count(*)::int n from clients where cpf = $1`, [cpf042(5)])).n, 0, 'homônimo não criado')
  const r5 = await um(db, `select status, outcome from import_row_results where import_job_id = $1 and row_number = 5`, [imp.job])
  igual([r5.status, r5.outcome.client_action], ['SKIPPED', 'SKIP'], 'linha ignorada')
  const p = await um(db, `select lp.court, lc.client_id from legal_processes lp join legal_cases lc on lc.id = lp.legal_case_id where lp.id = $1`, [imp.processo.id])
  igual(p.court, 'TJSP — 3ª Vara Cível (importado)', 'processo atualizado')
  igual(p.client_id === (await um(db, `select id from clients where cpf = $1`, [cpf042(6)])).id, false, 'cliente do processo não muda')
  const e = await um(db, `select count(*)::int n from process_events where legal_process_id = $1 and source = 'IMPORT'`, [imp.processo.id])
  igual(e.n, 1, 'atualização registrada na linha do tempo')
})
await deve('processo encerrado → caso encerrado; cliente sem processo só cadastra o cliente', async () => {
  const c = await um(db, `select lc.status from legal_cases lc join clients c on c.id = lc.client_id where c.cpf = $1`, [cpf042(9)])
  igual(c.status, 'CLOSED', 'caso encerrado')
  const d = await um(db, `select c.id, (select count(*)::int from legal_cases lc where lc.client_id = c.id) casos,
    (select value from client_contacts cc where cc.client_id = c.id and cc.type = 'EMAIL') email from clients c where c.cpf = $1`, [cpf042(8)])
  igual([d.casos, d.email], [0, 'dora@exemplo.com.br'], 'só cliente')
})
await deve('processar de novo depois de concluído não grava nada', async () => {
  const antes = (await um(db, `select count(*)::int n from legal_processes`)).n
  const r = await rpc042(ids.barbara, `select public.import_process_batch($1) r`, [imp.job])
  igual([r.status, r.processed, (await um(db, `select count(*)::int n from legal_processes`)).n], ['COMPLETED', 0, antes], 'idempotente')
})

secao('Importação de planilhas: falha por linha não derruba o lote [042]')
const fluxo042 = async (nome, linhas, decisoes = []) => {
  const job = (await rpc042(ids.barbara, `select public.import_create_job($1, 'CSV') r`, [nome])).import_job_id
  await rpc042(ids.barbara, `select public.import_register_columns($1, $2, null, $3, $4) r`, [job, createHash('sha256').update(nome).digest('hex'), JSON.stringify(colunas042), linhas.length])
  await rpc042(ids.barbara, `select public.import_save_mapping($1, $2, $3) r`, [job, JSON.stringify(map042), JSON.stringify({ legal_area_id: ids.banking, lawyer_id: ids.barbara })])
  await rpc042(ids.barbara, `select public.import_stage_rows($1, $2, true) r`, [job, JSON.stringify(linhas)])
  await rpc042(ids.barbara, `select public.import_finish_dry_run($1) r`, [job])
  if (decisoes.length) await rpc042(ids.barbara, `select public.import_resolve_conflicts($1, $2) r`, [job, JSON.stringify(decisoes)])
  return job
}
await deve('CPF cadastrado entre a simulação e a gravação: só aquela linha (e as do mesmo cliente) falham, com motivo', async () => {
  const job = await fluxo042('corrida.csv', [
    { row_number: 2, status: 'VALID', payload: { client: pf042(20, 'Fabio Corrida'), process: { cnj: cnj042(20), legal_class: 'Revisional' } } },
    { row_number: 3, status: 'VALID', payload: { client: pf042(20, 'Fabio Corrida'), process: { cnj: cnj042(21), legal_class: 'Revisional' } } },
    { row_number: 4, status: 'VALID', payload: { client: pf042(22, 'Gina Sem Corrida') } },
  ])
  await rpc042(ids.barbara, `select public.import_confirm($1) r`, [job])
  // Alguém cadastra o mesmo CPF pela tela, depois da simulação.
  await como(ids.lucas, (tx) => tx.query(`select public.save_client(null, $1)`, [JSON.stringify({ kind: 'INDIVIDUAL', document: cpf042(20), full_name: 'Fabio Cadastrado Antes', origin_organization_id: ids.owner })]))
  const r = await rpc042(ids.barbara, `select public.import_process_batch($1) r`, [job])
  igual([r.status, r.imported, r.failed, r.failed_on_save], ['COMPLETED', 1, 2, 2], 'resultado')
  const e = await linhas(db, `select row_number, status, errors from import_row_results where import_job_id = $1 order by row_number`, [job])
  igual(e.map((x) => x.status), ['ERROR', 'ERROR', 'IMPORTED'], 'por linha')
  igual([/depois da simulação/.test(e[0].errors.at(-1)), /linha 2/.test(e[1].errors.at(-1))], [true, true], 'motivos')
  igual((await um(db, `select count(*)::int n from legal_processes where cnj_number in ($1, $2)`, [cnj042(20), cnj042(21)])).n, 0, 'nada pela metade')
})
await deve('CPF de cliente excluído vira erro na simulação (não reaproveita cadastro excluído)', async () => {
  const x = await um(db, `insert into clients (kind, cpf, origin_organization_id, deleted_at) values ('INDIVIDUAL', $1, $2, now()) returning id`, [cpf042(30), ids.owner])
  await db.query(`insert into individual_client_details (client_id, full_name) values ($1, 'Excluído Teste')`, [x.id])
  const job = await fluxo042('excluido.csv', [{ row_number: 2, status: 'VALID', payload: { client: pf042(30, 'Excluído Teste') } }])
  const r = await um(db, `select status, errors from import_row_results where import_job_id = $1`, [job])
  igual([r.status, /excluído/.test(r.errors[0])], ['ERROR', true], 'erro')
  await deveFalhar('sem linha gravável não confirma', () => rpc042(ids.barbara, `select public.import_confirm($1) r`, [job]), /Nada para gravar/)
  await como(ids.barbara, (tx) => tx.query(`select public.import_cancel($1)`, [job]))
})

secao('Importação de planilhas: processos sem CPF ligados ao cliente já cadastrado pelo nome [042]')
await deveFalhar('sem CPF/CNPJ e sem processo não há o que importar', async () => {
  const job = (await rpc042(ids.barbara, `select public.import_create_job('so-nomes.csv', 'CSV') r`)).import_job_id
  await rpc042(ids.barbara, `select public.import_register_columns($1, $2, null, '["Nome"]', 1) r`, [job, sha('9')])
  await rpc042(ids.barbara, `select public.import_save_mapping($1, '[{"source_column":"Nome","target_field":"client.name"}]') r`, [job])
}, /sem ela só dá para importar processos/)
await deve('um homônimo: liga ao cadastro (decisão já "Manter"); nenhum ou dois: erro com motivo; nada de cliente novo', async () => {
  // Dois clientes com o mesmo nome, para o caso ambíguo.
  for (const n of [40, 41]) {
    const x = await um(db, `insert into clients (kind, cpf, origin_organization_id) values ('INDIVIDUAL', $1, $2) returning id`, [cpf042(n), ids.owner])
    await db.query(`insert into individual_client_details (client_id, full_name) values ($1, 'Gêmeo Homônimo')`, [x.id])
  }
  const semCpf = (n, nome) => ({ row_number: n, status: 'VALID', payload: { client: { name: nome, by_name: true }, process: { cnj: cnj042(n + 50), legal_class: 'Revisional' } } })
  const lote = [semCpf(2, imp.existente.full_name.toLowerCase()), semCpf(3, 'Ninguém Com Este Nome 042'), semCpf(4, 'GEMEO HOMONIMO')]
  const job = (await rpc042(ids.barbara, `select public.import_create_job('advbox-processos.xlsx', 'XLSX') r`)).import_job_id
  await rpc042(ids.barbara, `select public.import_register_columns($1, $2, null, '["Nome do cliente","Número do processo","Tipo de ação"]', 3) r`, [job, sha('8')])
  await rpc042(ids.barbara, `select public.import_save_mapping($1, $2, $3) r`, [job,
    JSON.stringify([{ source_column: 'Nome do cliente', target_field: 'client.name' }, { source_column: 'Número do processo', target_field: 'process.cnj' }, { source_column: 'Tipo de ação', target_field: 'process.actionType' }]),
    JSON.stringify({ legal_area_id: ids.banking, lawyer_id: ids.lucas })])
  await rpc042(ids.barbara, `select public.import_stage_rows($1, $2, true) r`, [job, JSON.stringify(lote)])
  const r = await rpc042(ids.barbara, `select public.import_finish_dry_run($1) r`, [job])
  igual([r.status, r.open_conflicts], ['VALIDATED', 0], 'decisão já tomada')
  const rows = await linhas(db, `select row_number, status, errors, payload #>> '{client,document}' doc from import_row_results where import_job_id = $1 order by row_number`, [job])
  igual(rows.map((x) => [x.row_number, x.status, x.doc]), [[2, 'WARNING', imp.existente.cpf], [3, 'ERROR', null], [4, 'ERROR', null]], 'linhas')
  igual([/não encontrado/.test(rows[1].errors[0]), /há 2 clientes/.test(rows[2].errors[0])], [true, true], 'motivos')
  const k = await um(db, `select conflict_kind, resolution, existing_entity_id from import_conflicts where import_job_id = $1`, [job])
  igual([k.conflict_kind, k.resolution, k.existing_entity_id], ['CLIENT_DOCUMENT', 'IGNORE', imp.existente.id], 'conflito já decidido')
  const plano = await rpc042(ids.barbara, `select public.get_import_plan($1) r`, [job])
  igual([plano.clients_create, plano.clients_keep, plano.processes_create], [0, 1, 1], 'prévia')
  await rpc042(ids.barbara, `select public.import_confirm($1) r`, [job])
  const fim = await rpc042(ids.barbara, `select public.import_process_batch($1) r`, [job])
  igual([fim.status, fim.imported, fim.clients_created, fim.processes_created, fim.failed], ['COMPLETED', 1, 0, 1, 2], 'gravou só o vínculo')
  const p = await um(db, `select lc.client_id from legal_processes lp join legal_cases lc on lc.id = lp.legal_case_id where lp.cnj_number = $1`, [cnj042(52)])
  igual(p.client_id, imp.existente.id, 'processo no cliente existente')
})

secao('Importação de planilhas: arquivo, retenção e catálogo [042]')
await deve('arquivo dos jobs encerrados: lista para apagar e marca apagado', async () => {
  const lista = await rpc042(ids.barbara, `select public.import_files_to_delete(100) r`)
  if (!lista.some((x) => x.id === imp.job)) throw new Error('job concluído fora da lista')
  await como(ids.barbara, (tx) => tx.query(`select public.import_mark_file_deleted($1)`, [imp.job]))
  igual((await rpc042(ids.barbara, `select public.import_files_to_delete(100) r`)).some((x) => x.id === imp.job), false, 'saiu da lista')
})
await deve('rotina diária: cancela importação parada há 7 dias e apaga linha original e normalizada depois de 30', async () => {
  const parado = (await rpc042(ids.barbara, `select public.import_create_job('parado.csv', 'CSV') r`)).import_job_id
  await db.query(`alter table import_jobs disable trigger import_jobs_set_updated_at`)
  await db.query(`update import_jobs set updated_at = now() - interval '8 days' where id = $1`, [parado])
  await db.query(`update import_jobs set completed_at = now() - interval '31 days' where id = $1`, [imp.job])
  await db.query(`alter table import_jobs enable trigger import_jobs_set_updated_at`)
  const r = (await um(db, `select private.import_housekeeping() r`)).r
  igual(r.cancelled >= 1, true, 'cancelou')
  igual((await um(db, `select status from import_jobs where id = $1`, [parado])).status, 'CANCELLED', 'parado')
  const linha = await um(db, `select raw_data, payload, outcome from import_row_results where import_job_id = $1 and row_number = 2`, [imp.job])
  igual([linha.raw_data, linha.payload, linha.outcome.client_action], [null, null, 'CREATE'], 'dado pessoal apagado, procedência mantida')
})
await deve('funções da 042 fixam search_path; anon e service_role não executam; as internas não estão abertas ao usuário', async () => {
  const internas = ['import_lock_job', 'import_row_actions', 'import_client_patch', 'import_apply_row', 'import_housekeeping', 'import_error_text']
  const tela = ['import_create_job', 'import_authorize_file', 'import_register_columns', 'import_fail', 'import_save_mapping', 'import_stage_rows',
    'import_finish_dry_run', 'import_resolve_conflicts', 'get_import_plan', 'get_import_conflicts', 'get_import_reference_data', 'import_confirm',
    'import_process_batch', 'import_cancel', 'import_files_to_delete', 'import_mark_file_deleted']
  const r = await linhas(db, `select n.nspname s, p.proname f, coalesce(array_to_string(p.proconfig, ','), '') cfg, p.prosecdef def,
      has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('service_role', p.oid, 'execute') srv,
      has_function_privilege('authenticated', p.oid, 'execute') usr
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('private', 'public') and p.proname = any ($1)`, [[...internas, ...tela]])
  if (r.length < internas.length + tela.length * 2) throw new Error(`funções faltando: ${r.length}`)
  igual(r.filter((x) => !x.cfg.includes('search_path=')).map((x) => x.f), [], 'sem search_path')
  igual(r.filter((x) => x.anon || x.srv).map((x) => `${x.s}.${x.f}`), [], 'anon/service_role')
  igual(r.filter((x) => internas.includes(x.f) && x.usr).map((x) => x.f), [], 'interna aberta')
  igual(r.filter((x) => x.s === 'public' && x.def).map((x) => x.f), [], 'pública como definer')
})
await deve('referência para o mapeamento: áreas ativas e equipe interna (sem parceiros)', async () => {
  const r = await rpc042(ids.barbara, `select public.get_import_reference_data() r`)
  igual(r.areas.some((a) => a.id === ids.banking), true, 'área')
  igual([r.users.some((u) => u.id === ids.lucas), r.users.some((u) => u.id === ids.almeidaAdm)], [true, false], 'equipe')
})

// ═════════════════════════════ 043: integrações judiciais e prazos ═══════

const rpc043 = async (uid, sql, params) => (await como(uid, (tx) => um(tx, sql, params))).r
const worker043 = async (sql, params) => (await comoWorker((tx) => um(tx, sql, params))).r
// 057: a chave do aviso de falha é o dia e o período (manhã/tarde, Brasília), não a rodada.
const chaveJsync057 = async () => (await um(db, `select 'jsync:' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD')
  || case when extract(hour from now() at time zone 'America/Sao_Paulo') < 12 then ':am' else ':pm' end k`)).k
const j043 = {}
// CNJs do TJSP (8.26) para os cenários da 043.
const cnj043 = (n) => cnj(4300 + n, '2025', '8', '26', '0100')

secao('Integração judicial: processo com CNJ fica acompanhado [043]')
await deve('cenário: processo do escritório (Lucas) e processo de caso do Almeida, com CNJ', async () => {
  const cli = (await um(db, `insert into clients (kind, cpf, origin_organization_id) values ('INDIVIDUAL', '52998224725', $1) returning id`, [ids.owner])).id
  await db.query(`insert into individual_client_details (client_id, full_name) values ($1, 'Odete Integração')`, [cli])
  j043.caso = (await um(db, `insert into legal_cases (client_id, legal_area_id, title, status, origin_organization_id, created_by_organization_id, assigned_lawyer_id)
    values ($1, $2, 'Consignado Odete', 'IN_PROGRESS', $3, $3, $4) returning id`, [cli, ids.banking, ids.owner, ids.lucas])).id
  j043.proc = (await um(db, `insert into legal_processes (legal_case_id, cnj_number, title, legal_class) values ($1, $2, 'Odete x Banco', 'Procedimento do Juizado') returning id`,
    [j043.caso, cnj043(1)])).id
  j043.procA = (await um(db, `insert into legal_processes (legal_case_id, cnj_number, title) values ($1, $2, 'João x BMG') returning id`, [ids.casoA, cnj043(2)])).id
  j043.semCnj = (await um(db, `insert into legal_processes (legal_case_id, title) values ($1, 'Em preparação') returning id`, [j043.caso])).id
  const refs = await linhas(db, `select legal_process_id, external_id from process_external_refs where provider = 'DATAJUD' and legal_process_id = any ($1)`,
    [[j043.proc, j043.procA, j043.semCnj]])
  igual(refs.map((r) => r.external_id).sort(), [cnj043(1), cnj043(2)].sort(), 'uma referência por processo com CNJ')
  j043.ref = (await um(db, `select id from process_external_refs where provider = 'DATAJUD' and legal_process_id = $1`, [j043.proc])).id
})
await deve('CNJ preenchido depois e CNJ trocado: a referência acompanha e refaz a linha de base', async () => {
  await db.query(`update legal_processes set cnj_number = $1 where id = $2`, [cnj043(3), j043.semCnj])
  await db.query(`update process_external_refs set baseline_at = now(), last_synced_at = now() where legal_process_id = $1`, [j043.semCnj])
  await db.query(`update legal_processes set cnj_number = $1 where id = $2`, [cnj043(4), j043.semCnj])
  const r = await um(db, `select external_id, baseline_at, last_synced_at from process_external_refs where legal_process_id = $1 and provider = 'DATAJUD'`, [j043.semCnj])
  igual([r.external_id, r.baseline_at, r.last_synced_at], [cnj043(4), null, null], 'referência')
})

secao('Integração judicial: OABs acompanhadas (escritório e parceiros) [043]')
await deve('ADMIN cadastra OAB do escritório (normaliza pontuação e zeros) e de um parceiro', async () => {
  const a = await rpc043(ids.barbara, `select public.save_judicial_monitor(' 0225.006 ', 'rj', 'Barbara Cardoso', null, $1) r`, [ids.lucas])
  igual(a.created, true, 'criada')
  j043.monOwner = a.id
  const m = await um(db, `select oab_number, oab_state, organization_id, responsible_user_id from judicial_monitors where id = $1`, [a.id])
  igual([m.oab_number, m.oab_state, m.organization_id, m.responsible_user_id], ['225006', 'RJ', ids.owner, ids.lucas], 'OAB')
  const b = await rpc043(ids.barbara, `select public.save_judicial_monitor('225006', 'RJ', null, null, null) r`)
  igual([b.created, b.id], [false, a.id], 'repetida reativa/atualiza, não duplica')
  j043.monFerreira = (await rpc043(ids.barbara, `select public.save_judicial_monitor('77001', 'SP', 'Dr. Ferreira', $1) r`, [ids.ferreira])).id
})
await deve('administrador do parceiro cadastra a OAB do próprio escritório (a mesma OAB pode estar em dois escritórios)', async () => {
  j043.monAlmeida = (await rpc043(ids.almeidaAdm, `select public.save_judicial_monitor('123456', 'SP', 'Roberto Almeida') r`)).id
  await rpc043(ids.almeidaAdm, `select public.save_judicial_monitor('225006', 'RJ') r`)
  igual((await um(db, `select organization_id from judicial_monitors where id = $1`, [j043.monAlmeida])).organization_id, ids.almeida, 'escritório da sessão')
})
await deveFalhar('usuário do parceiro (não administrador) não cadastra OAB', () =>
  rpc043(ids.almeidaUsr, `select public.save_judicial_monitor('9999', 'SP') r`), /Somente o ADMIN/)
await deveFalhar('parceiro não cadastra OAB em outro escritório', () =>
  rpc043(ids.almeidaAdm, `select public.save_judicial_monitor('9999', 'SP', null, $1) r`, [ids.ferreira]), /próprio escritório/)
await deveFalhar('advogado interno não cadastra OAB', () =>
  rpc043(ids.lucas, `select public.save_judicial_monitor('9999', 'SP') r`), /Somente o ADMIN/)
await deveFalhar('OAB inválida é recusada', () =>
  rpc043(ids.barbara, `select public.save_judicial_monitor('ABC', 'SP') r`), /OAB inválido/)
await deveFalhar('parceiro não pausa OAB de outro escritório (não revela que existe)', () =>
  rpc043(ids.almeidaAdm, `select public.set_judicial_monitor_active($1, false) r`, [j043.monFerreira]), /não encontrada/)
await deve('parceiro vê só as OABs do próprio escritório; a equipe vê todas com o escritório', async () => {
  const p = await rpc043(ids.almeidaUsr, `select public.get_my_judicial_monitors() r`)
  igual([p.can_manage, p.monitors.map((m) => m.oab_number).sort()], [false, ['123456', '225006']], 'parceiro')
  igual(p.monitors.every((m) => m.organization_name == null), true, 'sem nome de outros escritórios')
  const o = await rpc043(ids.lucas, `select public.get_judicial_overview() r`)
  igual(o.can_manage, false, 'advogado só lê')
  igual(o.monitors.filter((m) => m.oab_number === '225006').map((m) => m.organization_name).sort(), ['Almeida Advogados', 'Bárbara Cardoso Advocacia'].sort(), 'mesma OAB em dois escritórios')
})
await deveFalhar('assistente não abre a visão da integração', () => rpc043(ids.ana, `select public.get_judicial_overview() r`), /Somente advogado ou ADMIN/)
await deveFalhar('a tela não escreve direto em judicial_monitors', () => como(ids.barbara, (tx) =>
  tx.query(`update judicial_monitors set active = false where id = $1`, [j043.monOwner])), /permission denied/)

secao('Integração judicial: rodada do servidor e DJEN [043]')
await deve('agendador: de manhã (a partir das 05:00) todas as OABs ainda não conferidas no dia; antes das 05:00, nenhuma', async () => {
  const due = async (t) => (await linhas(db, `select oab_state || oab_number o from private.judicial_djen_due($1) order by 1`, [t])).map((x) => x.o)
  igual(await due('2026-11-04 06:00-03'), ['RJ225006', 'SP123456', 'SP77001'], 'manhã: todas (repetida entre escritórios conta uma vez)')
  igual(await due('2026-11-04 04:59-03'), [], 'madrugada: nenhuma')
})
await deve('rodada: uma consulta por OAB (repetida entre escritórios conta uma vez); segunda rodada simultânea = busy', async () => {
  const r = await worker043(`select private.judicial_sync_begin('MANUAL', $1) r`, [ids.barbara])
  igual(r.busy, false, 'abriu')
  j043.run = r.run_id
  igual(r.oabs.map((o) => `${o.oab_state}${o.oab_number}`), ['RJ225006', 'SP123456', 'SP77001'], 'OABs distintas')
  igual(r.lookback_days, 5, 'janela (atraso de até 5 dias do DJEN)')
  igual((await worker043(`select private.judicial_sync_begin('CRON') r`)).busy, true, 'busy')
})
await deveFalhar('busca manual sem quem pediu é recusada', () => worker043(`select private.judicial_sync_begin('MANUAL') r`), /Busca manual/)
await deveFalhar('busca manual pedida por assistente é recusada', () => worker043(`select private.judicial_sync_begin('MANUAL', $1) r`, [ids.ana]), /Busca manual/)
await deveFalhar('usuário logado não chama as funções do servidor', () => como(ids.barbara, (tx) =>
  tx.query(`select private.judicial_ingest_djen(null, '1', 'SP', current_date, current_date, true, null, '[]')`)), /permission denied/)

const pub043 = (id, cnjN, dia, extra = {}) => ({ external_id: String(id), cnj: cnjN, court: 'TJSP', organ: '1ª Vara do Juizado Especial Cível',
  communication_type: 'Intimação', class_name: 'Procedimento do Juizado Especial Cível', available_on: dia,
  content: `Fica a parte autora intimada para se manifestar sobre a contestação no prazo de 15 dias. (${id})`, link: `https://comunica.pje.jus.br/x/${id}`, ...extra })

await deve('DJEN: só a publicação de processo cadastrado entra; da outra não fica nada (nem o número), só a contagem', async () => {
  const itens = [pub043(910001, cnj043(1), '2026-11-02'), pub043(910002, cnj043(9), '2026-11-02'), { external_id: 'x', cnj: '123' }]
  const r = await worker043(`select private.judicial_ingest_djen($1, '225006', 'RJ', '2026-10-31', '2026-11-02', true, null, $2) r`, [j043.run, JSON.stringify(itens)])
  igual([r.found, r.matched, r.new, r.duplicates, r.unmatched], [3, 1, 1, 0, 1], 'contagem')
  const p = await um(db, `select id, legal_process_id, triage_status, found_by, process_event_id from judicial_publications where external_id = '910001'`)
  igual([p.legal_process_id, p.triage_status, p.found_by], [j043.proc, 'PENDING', ['RJ 225006']], 'publicação')
  j043.pub = p.id
  const ev = await um(db, `select event_type, source, external_provider, important from process_events where id = $1`, [p.process_event_id])
  igual([ev.event_type, ev.source, ev.external_provider, ev.important], ['PUBLICATION', 'JUDICIAL_INTEGRATION', 'DJEN', true], 'movimentação')
  igual((await um(db, `select count(*)::int n from judicial_publications where cnj_number = $1`, [cnj043(9)])).n, 0, 'nada do processo não cadastrado')
  igual((await um(db, `select count(*)::int n from process_events where description like '%(910002)%'`)).n, 0, 'teor não guardado')
  const st = await um(db, `select last_found, last_matched, last_error from judicial_monitor_status where judicial_monitor_id = $1`, [j043.monOwner])
  igual([st.last_found, st.last_matched, st.last_error], [3, 1, null], 'situação da OAB')
  igual((await um(db, `select count(*)::int n from information_schema.columns where table_name = 'judicial_monitor_status' and column_name like '%cnj%'`)).n, 0, 'sem coluna de números de fora')
  const ov = await rpc043(ids.barbara, `select public.get_judicial_overview() r`)
  igual(JSON.stringify(ov).includes(cnj043(9)), false, 'a tela não recebe o número')
})
await deve('agendador: OAB conferida hoje sai da lista; com falha, volta 10 min depois', async () => {
  const due = async (t) => (await linhas(db, `select oab_state || oab_number o from private.judicial_djen_due($1::timestamptz) order by 1`, [t])).map((x) => x.o)
  const t = await um(db, `select (now() at time zone 'America/Sao_Paulo')::date::text hoje,
    ((now() at time zone 'America/Sao_Paulo')::date + 1)::text amanha,
    ((now() + interval '11 minutes') at time zone 'America/Sao_Paulo')::time >= time '05:00' manha`)
  igual((await due(`${t.hoje} 23:30-03`)).includes('RJ225006'), false, 'conferida hoje: fora')
  igual((await due(`${t.amanha} 06:00-03`)).includes('RJ225006'), true, 'amanhã: de novo')
  await worker043(`select private.judicial_ingest_djen($1, '77001', 'SP', '2026-11-01', '2026-11-02', false, 'HTTP 503', null) r`, [j043.run])
  igual((await due(new Date(Date.now() + 5 * 60e3).toISOString())).includes('SP77001'), false, 'falhou há 5 min: espera')
  if (t.manha) igual((await due(new Date(Date.now() + 11 * 60e3).toISOString())).includes('SP77001'), true, 'falhou há 11 min: tenta de novo')
})
await deve('aviso de publicação ao advogado do caso (categoria JUDICIAL), com chave única', async () => {
  const n = await linhas(db, `select user_id, type, severity, related_type from notifications where event_key = $1`, ['pub:' + j043.pub])
  igual(n.map((x) => [x.user_id, x.type, x.severity, x.related_type]), [[ids.lucas, 'PUBLICATION_RECEIVED', 'WARNING', 'publication']], 'aviso')
  igual((await um(db, `select private.notification_category('PUBLICATION_RECEIVED') c`)).c, 'JUDICIAL', 'categoria')
})
await deve('mesma publicação de novo (outra OAB, outra rodada): não duplica; só anota quem trouxe', async () => {
  const r = await worker043(`select private.judicial_ingest_djen($1, '123456', 'SP', '2026-11-02', '2026-11-02', true, null, $2) r`,
    [j043.run, JSON.stringify([pub043(910001, cnj043(1), '2026-11-02')])])
  igual([r.new, r.duplicates], [0, 1], 'duplicada')
  igual((await um(db, `select found_by from judicial_publications where id = $1`, [j043.pub])).found_by, ['RJ 225006', 'SP 123456'], 'quem trouxe')
  igual((await um(db, `select count(*)::int n from process_events where external_provider = 'DJEN' and external_id = '910001'`)).n, 1, 'uma movimentação')
  igual((await um(db, `select count(*)::int n from notifications where event_key = $1`, ['pub:' + j043.pub])).n, 1, 'um aviso')
})
await deve('publicação em processo de parceiro avisa a equipe do parceiro, que vê a movimentação (e não a triagem)', async () => {
  await worker043(`select private.judicial_ingest_djen($1, '123456', 'SP', '2026-11-03', '2026-11-03', true, null, $2) r`,
    [j043.run, JSON.stringify([pub043(910003, cnj043(2), '2026-11-03')])])
  const pid = (await um(db, `select id from judicial_publications where external_id = '910003'`)).id
  const dest = (await linhas(db, `select user_id from notifications where event_key = $1`, ['pub:' + pid])).map((x) => x.user_id)
  igual([dest.includes(ids.almeidaAdm), dest.includes(ids.almeidaUsr), dest.includes(ids.ferreiraAdm)], [true, true, false], 'destinatários')
  const ev = await como(ids.almeidaUsr, (tx) => linhas(tx, `select event_type from process_events where legal_process_id = $1`, [j043.procA]))
  igual(ev.map((x) => x.event_type), ['PUBLICATION'], 'parceiro vê a movimentação')
})
await deve('tribunal cancela depois: a publicação é marcada e a equipe é avisada (uma vez)', async () => {
  const cancelada = pub043(910003, cnj043(2), '2026-11-03', { cancelled: true, cancel_reason: 'Publicada por engano', hash: 'abcDEF123456789xyz', content: 'Cancelada: publicada por engano' })
  await worker043(`select private.judicial_ingest_djen($1, '123456', 'SP', '2026-11-03', '2026-11-03', true, null, $2) r`, [j043.run, JSON.stringify([cancelada])])
  await worker043(`select private.judicial_ingest_djen($1, '123456', 'SP', '2026-11-03', '2026-11-03', true, null, $2) r`, [j043.run, JSON.stringify([cancelada])])
  const p = await um(db, `select id, cancelled_at is not null c, cancel_reason, djen_hash, content from judicial_publications where external_id = '910003'`)
  igual([p.c, p.cancel_reason, p.djen_hash, p.content.includes('15 dias')], [true, 'Publicada por engano', 'abcDEF123456789xyz', true], 'cancelamento registrado; teor original preservado')
  igual((await um(db, `select count(*)::int n from notifications where event_key = $1 and type = 'PUBLICATION_CANCELLED'`, ['pubc:' + p.id])).n > 0, true, 'aviso')
  const d = await rpc043(ids.lucas, `select public.get_judicial_publication($1) r`, [p.id])
  igual(d.certificate_url, 'https://comunicaapi.pje.jus.br/api/v1/comunicacao/abcDEF123456789xyz/certidao', 'certidão')
})
await deveFalhar('parceiro não lê a tabela de publicações', () => como(ids.almeidaUsr, (tx) => tx.query(`select * from judicial_publications`)), /permission denied/)
await deveFalhar('parceiro não lista a triagem', () => rpc043(ids.almeidaUsr, `select public.list_judicial_publications('{}') r`), /Somente a equipe/)
await deve('falha na consulta registra o erro sem apagar o que já foi conferido', async () => {
  await worker043(`select private.judicial_ingest_djen($1, '225006', 'RJ', '2026-11-02', '2026-11-03', false, 'HTTP 503', null) r`, [j043.run])
  const d = await linhas(db, `select day::text, last_ok_at is not null ok, last_error from judicial_capture_days where oab_number = '225006' and day between '2026-11-02' and '2026-11-03' order by day`)
  igual(d.map((x) => [x.day, x.ok, x.last_error]), [['2026-11-02', true, 'HTTP 503'], ['2026-11-03', false, 'HTTP 503']], 'dias')
  igual((await um(db, `select last_error from judicial_monitor_status where judicial_monitor_id = $1`, [j043.monOwner])).last_error, 'HTTP 503', 'situação')
})
await deve('prova de diligência dia a dia (consultado, assentado, quantidade); parceiro só da própria OAB', async () => {
  const c = await rpc043(ids.lucas, `select public.get_judicial_coverage('225006', 'RJ', '2026-10-31', '2026-11-03') r`)
  igual(c.map((x) => [x.day, x.checked, x.found]), [['2026-10-31', true, 0], ['2026-11-01', true, 0], ['2026-11-02', true, 2], ['2026-11-03', false, null]], 'cobertura')
  igual(c[3].last_error, 'HTTP 503', 'erro do dia não conferido')
  await rpc043(ids.almeidaUsr, `select public.get_judicial_coverage('123456', 'SP') r`)
})
await deveFalhar('parceiro não vê a cobertura de OAB de outro escritório', () =>
  rpc043(ids.almeidaUsr, `select public.get_judicial_coverage('77001', 'SP') r`), /não encontrada/)

secao('Integração judicial: DataJud e movimentações sem duplicar [043]')
const mov043 = (n, nome, dia) => ({ external_id: createHash('sha256').update(`m${n}`).digest('hex'), occurred_at: `${dia}T10:00:00-03:00`, code: n, name: nome, description: nome, grau: 'JE' })
await deve('fila do DataJud: processos com CNJ, os sem tentativa primeiro', async () => {
  const q = await worker043(`select private.judicial_datajud_queue(500) r`)
  igual([j043.proc, j043.procA, j043.semCnj].every((id) => q.some((x) => x.legal_process_id === id)), true, 'na fila')
})
await deve('primeira leitura = linha de base: grava o histórico, preenche só o vazio e não avisa', async () => {
  const meta = { court: 'TJSP', court_unit: '1ª Vara do JEC de Santos', legal_class: 'Outra classe', distribution_date: '2025-03-10', alias: 'tjsp', graus: ['JE'] }
  const r = await worker043(`select private.judicial_ingest_datajud($1, $2, true, null, $3, $4) r`,
    [j043.run, j043.ref, JSON.stringify(meta), JSON.stringify([mov043(1, 'Distribuído por sorteio', '2025-03-10'), mov043(2, 'Conclusos', '2025-04-01'), { external_id: 'curto', occurred_at: '2025-01-01', name: 'x' }])])
  igual([r.ok, r.inserted, r.baseline], [true, 2, true], 'linha de base')
  const p = await um(db, `select court, court_unit, legal_class, distribution_date::text d from legal_processes where id = $1`, [j043.proc])
  igual([p.court, p.court_unit, p.legal_class, p.d], ['TJSP', '1ª Vara do JEC de Santos', 'Procedimento do Juizado', '2025-03-10'], 'não sobrescreve o que a equipe digitou')
  igual((await um(db, `select count(*)::int n from notifications where type = 'PROCESS_MOVEMENT' and legal_process_id = $1`, [j043.proc])).n, 0, 'sem aviso')
})
await deve('leitura seguinte: só a movimentação nova entra e avisa', async () => {
  const r = await worker043(`select private.judicial_ingest_datajud($1, $2, true, null, '{}', $3) r`,
    [j043.run, j043.ref, JSON.stringify([mov043(1, 'Distribuído por sorteio', '2025-03-10'), mov043(2, 'Conclusos', '2025-04-01'), mov043(3, 'Julgado procedente', '2026-11-02')])])
  igual([r.inserted, r.baseline], [1, false], 'só a nova')
  igual((await um(db, `select count(*)::int n from process_events where legal_process_id = $1 and external_provider = 'DATAJUD'`, [j043.proc])).n, 3, 'sem duplicar')
  const n = await linhas(db, `select user_id, message from notifications where type = 'PROCESS_MOVEMENT' and legal_process_id = $1`, [j043.proc])
  igual(n.map((x) => [x.user_id, x.message]), [[ids.lucas, 'Julgado procedente']], 'aviso')
})
await deve('falha no DataJud fica registrada no processo; tentado há pouco sai da fila; pausado não entra', async () => {
  await worker043(`select private.judicial_ingest_datajud($1, $2, false, 'Tribunal não encontrado', null, null) r`,
    [j043.run, (await um(db, `select id from process_external_refs where legal_process_id = $1 and provider = 'DATAJUD'`, [j043.procA])).id])
  const s = await rpc043(ids.lucas, `select public.get_process_judicial_status($1) r`, [j043.procA])
  igual([s.tracked, s.last_error], [true, 'Tribunal não encontrado'], 'situação interna')
  const sp = await rpc043(ids.almeidaUsr, `select public.get_process_judicial_status($1) r`, [j043.procA])
  igual([sp.tracked, sp.last_error, sp.publications], [true, null, null], 'parceiro: sem detalhe técnico')
  await rpc043(ids.lucas, `select public.set_process_judicial_sync($1, false) r`, [j043.semCnj])
  const q = await worker043(`select private.judicial_datajud_queue(500) r`)
  igual([q.some((x) => x.legal_process_id === j043.proc), q.some((x) => x.legal_process_id === j043.semCnj)], [false, false], 'fora da fila')
  igual((await worker043(`select private.judicial_datajud_queue(5, $1) r`, [j043.proc])).length, 1, 'busca de um processo ignora o intervalo')
})
await deveFalhar('assistente não pausa o acompanhamento', () => rpc043(ids.ana, `select public.set_process_judicial_sync($1, true) r`, [j043.semCnj]), /Somente advogado/)
await deve('rodada com falha avisa os ADMIN uma vez', async () => {
  await worker043(`select private.judicial_sync_finish($1, 'PARTIAL', '{"djen_errors":1}', 'OAB RJ 225006: HTTP 503') r`, [j043.run])
  await worker043(`select private.judicial_sync_finish($1, 'PARTIAL', '{}', 'de novo') r`, [j043.run])
  igual((await um(db, `select count(*)::int n from notifications where event_key = $1 and user_id = $2`, [await chaveJsync057(), ids.barbara])).n, 1, 'aviso')
  igual((await um(db, `select status from judicial_sync_runs where id = $1`, [j043.run])).status, 'PARTIAL', 'situação')
})

await deve('lote extra do DataJud (agendador do banco): sem DJEN; DataJud desligado = nem abre rodada', async () => {
  const r = await worker043(`select private.judicial_sync_begin('CRON', null, null, true) r`)
  igual([r.busy, r.idle, r.djen_enabled, r.oabs], [false, false, false, []], 'lote')
  igual((await um(db, `select scope from judicial_sync_runs where id = $1`, [r.run_id])).scope, 'DATAJUD', 'escopo')
  igual((await worker043(`select private.judicial_sync_begin('CRON', null, null, true) r`)).busy, true, 'um lote por vez')
  await worker043(`select private.judicial_sync_finish($1, 'COMPLETED', '{}') r`, [r.run_id])
  await rpc043(ids.barbara, `select public.save_judicial_settings('{"datajud_enabled":false}') r`)
  const n0 = (await um(db, `select count(*)::int n from judicial_sync_runs`)).n
  igual((await worker043(`select private.judicial_sync_begin('CRON', null, null, true) r`)).idle, true, 'ocioso')
  igual((await um(db, `select count(*)::int n from judicial_sync_runs`)).n, n0, 'sem rodada nova')
  await rpc043(ids.barbara, `select public.save_judicial_settings('{"datajud_enabled":true}') r`)
  igual((await um(db, `select private.judicial_cron_kick() r`)).r, 'pg_net ou Vault indisponível', 'sem pg_net não chama nada')
})

secao('Integração judicial: contagem do prazo em dias úteis [043]')
await deve('Páscoa e Sexta-feira Santa', async () => {
  const r = await um(db, `select private.easter_sunday(2026)::text a, private.easter_sunday(2027)::text b, private.non_business_reason('2027-03-26', 'TJSP') c`)
  igual([r.a, r.b, r.c], ['2026-04-05', '2027-03-28', 'Sexta-feira Santa'], 'datas')
})
await deve('disponibilizada na sexta 13/11/2026: publicada 16/11, prazo começa 17/11, pula 20/11 (Consciência Negra), 15 dias úteis = 08/12', async () => {
  const r = await rpc043(ids.ana, `select public.judicial_deadline_preview('2026-11-13', 'TJSP', 15) r`)
  igual([r.published_on, r.first_day, r.due_on, r.skipped.map((s) => s.day)], ['2026-11-16', null, '2026-12-08', ['2026-11-20']], 'contagem')
})
await deve('recesso do art. 220 do CPC suspende; dia cadastrado para o tribunal também', async () => {
  const r = await um(db, `select private.judicial_deadline_dates('2026-12-15', 'TJSP', 5, 5) r`)
  igual([r.r.published_on, r.r.list, r.r.due_on], ['2026-12-16', ['2026-12-17', '2026-12-18', '2027-01-21', '2027-01-22', '2027-01-25'], '2027-01-25'], 'recesso')
  await rpc043(ids.barbara, `select public.save_court_calendar_day('tjsp', '2027-01-25', 'HOLIDAY', 'Aniversário de São Paulo') r`)
  const s = await um(db, `select private.judicial_deadline_dates('2026-12-15', 'TJSP', 5, 0) r`)
  const o = await um(db, `select private.judicial_deadline_dates('2026-12-15', 'TJRJ', 5, 0) r`)
  igual([s.r.due_on, o.r.due_on], ['2027-01-26', '2027-01-25'], 'feriado só do TJSP')
})
await deveFalhar('advogado não mexe no calendário', () => rpc043(ids.lucas, `select public.save_court_calendar_day(null, '2027-02-15', 'SUSPENSION', 'Carnaval') r`), /Somente ADMIN/)
await deveFalhar('parceiro não usa a prévia de prazo', () => rpc043(ids.almeidaUsr, `select public.judicial_deadline_preview('2026-11-13', 'TJSP', 15) r`), /Somente a equipe/)

secao('Integração judicial: triagem humana e prazo [043]')
await deve('fila de triagem (a minha) e detalhe com sugestão de contagem', async () => {
  const l = await rpc043(ids.lucas, `select public.list_judicial_publications('{"status":"OPEN","mine":true}') r`)
  // O caso do Almeida (casoA) também é do Lucas; mais recente primeiro.
  igual(l.items.map((x) => x.external_id), ['910003', '910001'], 'minhas abertas')
  igual([l.items[1].client_name, l.items[1].content], ['Odete Integração', null], 'lista sem o teor')
  const outro = await rpc043(ids.barbara, `select public.list_judicial_publications($1) r`, [JSON.stringify({ status: 'OPEN', legal_process_id: j043.proc })])
  igual([outro.total, outro.items.map((x) => x.external_id)], [1, ['910001']], 'por processo')
  const d = await rpc043(ids.ana, `select public.get_judicial_publication($1) r`, [j043.pub])
  igual([d.content.includes('15 dias'), d.suggestion.published_on], [true, '2026-11-03'], 'detalhe')
})
await deveFalhar('"sem prazo" exige o motivo', () => rpc043(ids.lucas, `select public.judicial_publication_decide($1, 'NO_DEADLINE', ' ') r`, [j043.pub]), /por que/)
await deveFalhar('assistente não fecha a triagem', () => rpc043(ids.ana, `select public.create_deadline_from_publication($1, '{"title":"x","due_on":"2026-11-24"}') r`, [j043.pub]), /Somente advogado/)
await deve('advogado cria o prazo a partir da publicação: prazo + triagem juntos, vencimento no fim do dia (Brasília)', async () => {
  const r = await rpc043(ids.lucas, `select public.create_deadline_from_publication($1, $2) r`,
    [j043.pub, JSON.stringify({ title: 'Manifestação sobre a contestação', due_on: '2026-11-24', deadline_type: 'REPLY' })])
  const d = await um(db, `select source, deadline_type, responsible_user_id, legal_process_id, to_char(due_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') due from deadlines where id = $1`, [r.deadline_id])
  igual([d.source, d.deadline_type, d.responsible_user_id, d.legal_process_id, d.due], ['JUDICIAL_INTEGRATION', 'REPLY', ids.lucas, j043.proc, '2026-11-24 23:59'], 'prazo')
  const p = await um(db, `select triage_status, triage_outcome, deadline_id, triaged_by from judicial_publications where id = $1`, [j043.pub])
  igual([p.triage_status, p.triage_outcome, p.deadline_id, p.triaged_by], ['DONE', 'DEADLINE', r.deadline_id, ids.lucas], 'triagem')
})
await deveFalhar('publicação já tratada não gera segundo prazo', () =>
  rpc043(ids.lucas, `select public.create_deadline_from_publication($1, '{"title":"x","due_on":"2026-11-24"}') r`, [j043.pub]), /já foi tratada/)
await deve('reabrir e fechar como "sem prazo", com motivo', async () => {
  await rpc043(ids.lucas, `select public.judicial_publication_decide($1, 'REOPEN', 'Revisar') r`, [j043.pub])
  await rpc043(ids.lucas, `select public.judicial_publication_decide($1, 'NO_DEADLINE', 'Prazo já controlado no outro prazo') r`, [j043.pub])
  const p = await um(db, `select triage_status, triage_outcome, deadline_id from judicial_publications where id = $1`, [j043.pub])
  igual([p.triage_status, p.triage_outcome, p.deadline_id], ['DONE', 'NO_DEADLINE', null], 'sem prazo')
})

secao('Integração judicial: agente propõe o prazo, humano decide em Revisões [043]')
await deveFalhar('advogado não escolhe o agente de prazos', () => rpc043(ids.lucas, `select public.save_judicial_settings($1) r`, [JSON.stringify({ deadline_agent_id: ids.agente })]), /Somente ADMIN/)
await deve('ADMIN escolhe o agente; publicação nova vira trabalho do agente, pedido em nome do advogado do caso', async () => {
  await rpc043(ids.barbara, `select public.save_judicial_settings($1) r`, [JSON.stringify({ deadline_agent_id: ids.agente })])
  const run2 = (await worker043(`select private.judicial_sync_begin('MANUAL', $1) r`, [ids.lucas])).run_id
  await worker043(`select private.judicial_ingest_djen($1, '225006', 'RJ', '2026-11-03', '2026-11-03', true, null, $2) r`,
    [run2, JSON.stringify([pub043(910004, cnj043(1), '2026-11-03'), pub043(910005, cnj043(1), '2026-11-03')])])
  const p = await um(db, `select id, triage_status, agent_run_id, agent_error from judicial_publications where external_id = '910004'`)
  igual([p.triage_status, p.agent_error, !!p.agent_run_id], ['WITH_AGENT', null, true], 'com o agente')
  j043.pubAg = p.id
  j043.runAg = p.agent_run_id
  const r = await um(db, `select r.status, r.requested_by, r.legal_process_id, i.parameters, i.request_text from agent_runs r join agent_run_inputs i on i.agent_run_id = r.id where r.id = $1`, [p.agent_run_id])
  igual([r.status, r.requested_by, r.legal_process_id, r.parameters.kind, r.parameters.business_days.length], ['QUEUED', ids.lucas, j043.proc, 'JUDICIAL_PUBLICATION', 30], 'trabalho')
  igual(r.request_text.includes('(910004)'), true, 'teor no pedido')
  igual([r.request_text.includes('dia 1: 05/11/2026'), r.request_text.includes('dia 15: 26/11/2026'), r.request_text.includes('publicada em 04/11/2026')], [true, true, true], 'contagem no texto que o agente lê')
  // O ator da transação foi limpo: o advogado recebeu o aviso das duas publicações.
  const outra = (await um(db, `select id from judicial_publications where external_id = '910005'`)).id
  igual((await um(db, `select count(*)::int n from notifications where user_id = $1 and event_key = any ($2)`, [ids.lucas, ['pub:' + p.id, 'pub:' + outra]])).n, 2, 'avisos')
  j043.pubAg2 = outra
  j043.runAg2 = (await um(db, `select agent_run_id from judicial_publications where id = $1`, [outra])).agent_run_id
})
await deve('proposta CREATE_DEADLINE aprovada em Revisões e aplicada → publicação tratada com o prazo', async () => {
  const prop = (await um(db, `insert into agent_proposals (agent_run_id, legal_case_id, legal_process_id, proposal_type, payload, idempotency_key)
    values ($1, $2, $3, 'CREATE_DEADLINE', $4, 'prop:j043a') returning id`,
    [j043.runAg, j043.caso, j043.proc, JSON.stringify({ summary: 'Manifestação', data: { title: 'Manifestação (15 dias úteis)', due_at: '2026-11-25T23:59:00-03:00' } })])).id
  const rev = (await um(db, `insert into reviews (agent_proposal_id, legal_case_id) values ($1, $2) returning id`, [prop, j043.caso])).id
  const d = await rpc043(ids.lucas, `select public.get_judicial_publication($1) r`, [j043.pubAg])
  igual(d.pending_review_id, rev, 'revisão pendente aparece na publicação')
  await decidir(ids.barbara, rev, 'APPROVE')
  for (let i = 0; i < 10; i++) {
    const r = await comoWorker((tx) => linhas(tx, `select * from private.worker_apply_next_proposal('worker-j043')`))
    if (!r.length || r.some((x) => x.proposal_id === prop)) break
  }
  const ap = await um(db, `select status, applied_entity_id from agent_proposals where id = $1`, [prop])
  const p = await um(db, `select triage_status, triage_outcome, deadline_id, triaged_by from judicial_publications where id = $1`, [j043.pubAg])
  igual([ap.status, p.triage_status, p.triage_outcome, p.deadline_id, p.triaged_by], ['APPLIED', 'DONE', 'DEADLINE', ap.applied_entity_id, ids.barbara], 'tratada')
})
await deve('proposta rejeitada devolve a publicação à triagem humana', async () => {
  const prop = (await um(db, `insert into agent_proposals (agent_run_id, legal_case_id, legal_process_id, proposal_type, payload, idempotency_key)
    values ($1, $2, $3, 'CREATE_DEADLINE', $4, 'prop:j043b') returning id`,
    [j043.runAg2, j043.caso, j043.proc, JSON.stringify({ summary: 'x', data: { title: 'x', due_at: '2026-11-25T23:59:00-03:00' } })])).id
  const rev = (await um(db, `insert into reviews (agent_proposal_id, legal_case_id) values ($1, $2) returning id`, [prop, j043.caso])).id
  await decidir(ids.lucas, rev, 'REJECT', 'Contagem errada')
  for (let i = 0; i < 10; i++) {
    const r = await comoWorker((tx) => linhas(tx, `select * from private.worker_apply_next_proposal('worker-j043')`))
    if (!r.length || r.some((x) => x.proposal_id === prop)) break
  }
  igual((await um(db, `select triage_status from judicial_publications where id = $1`, [j043.pubAg2])).triage_status, 'PENDING', 'de volta')
})
await deve('sem agente configurado a publicação fica para a equipe', async () => {
  await rpc043(ids.barbara, `select public.save_judicial_settings('{"deadline_agent_id":null}') r`)
  const run3 = (await worker043(`select private.judicial_sync_begin('MANUAL', $1) r`, [ids.barbara])).run_id
  await worker043(`select private.judicial_ingest_djen($1, '225006', 'RJ', '2026-11-03', '2026-11-03', true, null, $2) r`,
    [run3, JSON.stringify([pub043(910006, cnj043(1), '2026-11-03')])])
  const p = await um(db, `select triage_status, agent_run_id from judicial_publications where external_id = '910006'`)
  igual([p.triage_status, p.agent_run_id], ['PENDING', null], 'pendente')
})

secao('Integração judicial: catálogo [043]')
await deve('funções da 043 fixam search_path; anon e service_role não executam; servidor só nas portas da busca', async () => {
  const servidor = ['judicial_sync_begin', 'judicial_datajud_queue', 'judicial_ingest_datajud', 'judicial_ingest_djen', 'judicial_sync_finish']
  const internas = ['judicial_connection_id', 'judicial_cron_kick', 'judicial_request_deadline_proposal', 'judicial_recipients', 'judicial_deadline_dates', 'non_business_reason']
  const tela = ['save_judicial_monitor', 'set_judicial_monitor_active', 'get_my_judicial_monitors', 'get_judicial_coverage', 'get_judicial_overview',
    'save_judicial_settings', 'save_court_calendar_day', 'delete_court_calendar_day', 'judicial_deadline_preview', 'list_judicial_publications',
    'get_judicial_publication', 'judicial_publication_decide', 'create_deadline_from_publication', 'get_process_judicial_status', 'set_process_judicial_sync']
  const r = await linhas(db, `select n.nspname s, p.proname f, coalesce(array_to_string(p.proconfig, ','), '') cfg, p.prosecdef def,
      has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('service_role', p.oid, 'execute') srv,
      has_function_privilege('authenticated', p.oid, 'execute') usr, has_function_privilege('dg_worker', p.oid, 'execute') wrk
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('private', 'public') and p.proname = any ($1)`, [[...servidor, ...internas, ...tela]])
  if (r.length < servidor.length + internas.length + tela.length * 2) throw new Error(`funções faltando: ${r.length}`)
  igual(r.filter((x) => !x.cfg.includes('search_path=')).map((x) => x.f), [], 'sem search_path')
  igual(r.filter((x) => x.anon || x.srv).map((x) => `${x.s}.${x.f}`), [], 'anon/service_role')
  igual(r.filter((x) => [...servidor, ...internas].includes(x.f) && x.usr).map((x) => x.f), [], 'aberta ao usuário')
  igual(r.filter((x) => x.wrk).map((x) => x.f).sort(), [...servidor].sort(), 'portas do servidor')
  igual(r.filter((x) => x.s === 'public' && x.def).map((x) => x.f), [], 'pública como definer')
})

secao('Integração judicial: correções da validação [044]')
await deve('DataJud: falha passageira volta em 1 h; "não encontrado" e leitura com sucesso, em 20 h (JUD-04)', async () => {
  const ref = (await um(db, `select id from process_external_refs where provider = 'DATAJUD' and legal_process_id = $1`, [j043.procA])).id
  await db.query(`update process_external_refs set sync_enabled = true where id = $1`, [ref])
  const horas = async () => Number((await um(db, `select round(extract(epoch from next_attempt_at - now()) / 3600) h from process_external_refs where id = $1`, [ref])).h)
  const naFila = async () => (await worker043(`select private.judicial_datajud_queue(500) r`)).some((x) => x.ref_id === ref)
  await worker043(`select private.judicial_ingest_datajud($1, $2, false, 'DataJud não respondeu (tempo esgotado)', null, null, true) r`, [j043.run, ref])
  igual([await horas(), await naFila()], [1, false], 'passageira: 1 h, fora da fila até lá')
  await worker043(`select private.judicial_ingest_datajud($1, $2, false, 'Processo ainda não aparece no DataJud', null, null) r`, [j043.run, ref])
  igual(await horas(), 20, 'não encontrado (chamada antiga, sem o 7º argumento): 20 h')
  await worker043(`select private.judicial_ingest_datajud($1, $2, true, null, '{}', '[]') r`, [j043.run, ref])
  igual(await horas(), 20, 'leitura com sucesso: 20 h')
  await db.query(`update process_external_refs set next_attempt_at = now() - interval '1 minute' where id = $1`, [ref])
  igual(await naFila(), true, 'liberada: volta à fila')
})
await deve('rodada presa (a rota morreu antes de gravar o fim) vira interrompida depois de 6 min, e não 15 (JUD-06)', async () => {
  const velha = (await um(db, `insert into judicial_sync_runs (trigger, scope, started_at) values ('CRON', 'DATAJUD', now() - interval '7 minutes') returning id`)).id
  const nova = (await um(db, `insert into judicial_sync_runs (trigger, scope, started_at) values ('CRON', 'DATAJUD', now() - interval '5 minutes') returning id`)).id
  const r = await worker043(`select private.judicial_sync_begin('CRON', null, null, true) r`)
  igual(r.busy, true, 'a de 5 min ainda conta como em andamento')
  const st = await linhas(db, `select id, status, error from judicial_sync_runs where id = any ($1)`, [[velha, nova]])
  igual(st.find((x) => x.id === velha).status, 'FAILED', 'a de 7 min foi encerrada')
  igual(st.find((x) => x.id === velha).error, 'Interrompida (sem conclusão em 6 min).', 'motivo')
  igual(st.find((x) => x.id === nova).status, 'RUNNING', 'a de 5 min segue')
  await db.query(`update judicial_sync_runs set status = 'FAILED', finished_at = now() where id = $1`, [nova])
})

// ═════════════════════════════ Roadmap 2.0 — cadastros [045] ════════════

secao('Roadmap 2.0 — cadastros: canal de aquisição, cliente sem responsável, status e fases do processo, honorários, análise [045]')
await deve('cliente PF com canal de aquisição; sem "responsável" e sem "união estável" no banco', async () => {
  ids.cli045 = await salvar(ids.ana, null, {
    kind: 'INDIVIDUAL', document: '999.045.000-01', origin_organization_id: ids.owner, responsible_user_id: ids.lucas,
    acquisition_channel: 'GOOGLE_ADS', acquisition_detail: 'Campanha consignado', full_name: 'Cliente 045',
    nationality: 'Brasileira', marital_status: 'SINGLE', profession: 'Aposentada', stable_union: true,
    contact: { email: 'c045@dgbrasil.test', phone: '11999990045' },
    address: { postal_code: '01001-000', street: 'Rua A', number: '1', neighborhood: 'Centro', city: 'São Paulo', state: 'SP' },
  })
  const c = await um(db, `select acquisition_channel, acquisition_detail from clients where id = $1`, [ids.cli045])
  igual([c.acquisition_channel, c.acquisition_detail], ['GOOGLE_ADS', 'Campanha consignado'], 'canal')
  const cols = await linhas(db, `select table_name || '.' || column_name c from information_schema.columns
    where (table_name = 'clients' and column_name = 'responsible_user_id') or (table_name = 'individual_client_details' and column_name = 'stable_union')
       or (table_name = 'client_directory' and column_name in ('responsible_user_id', 'acquisition_channel'))`)
  igual(cols.map((r) => r.c).sort(), ['client_directory.acquisition_channel'], 'colunas')
  await salvar(ids.ana, ids.cli045, { acquisition_channel: 'REFERRAL', acquisition_detail: 'Indicação da Dona Maria' })
  igual((await um(db, `select acquisition_channel from clients where id = $1`, [ids.cli045])).acquisition_channel, 'REFERRAL', 'edição do canal')
})
await deveFalhar('canal de aquisição fora da lista é recusado', () =>
  salvar(ids.ana, ids.cli045, { acquisition_channel: 'TV' }), /Canal de aquisição inválido/)
await deveFalhar('…e também direto na tabela (CHECK)', () =>
  db.query(`update clients set acquisition_channel = 'TV' where id = $1`, [ids.cli045]), /acquisition_channel_check/)
await deve('caso herda o canal do cliente; canal informado no caso prevalece', async () => {
  const base = { client_id: ids.cli045, legal_area_id: ids.banking, title: 'Caso 045', origin_organization_id: ids.owner }
  const a = await criarCaso(ids.lucas, randomUUID(), base)
  const b = await criarCaso(ids.lucas, randomUUID(), { ...base, title: 'Caso 045 B', acquisition_channel: 'META_ADS', acquisition_detail: 'Reels' })
  const r = await linhas(db, `select acquisition_channel, acquisition_detail from legal_cases where id = any ($1) order by title`, [[a.legal_case_id, b.legal_case_id]])
  igual(r.map((x) => [x.acquisition_channel, x.acquisition_detail]), [['REFERRAL', 'Indicação da Dona Maria'], ['META_ADS', 'Reels']], 'canais')
  ids.caso045 = a.legal_case_id
})
await deve('portal: cliente novo nasce com nacionalidade, estado civil, profissão e canal; o caso herda o canal', async () => {
  const cli = { document: '999.045.000-02', kind: 'INDIVIDUAL', origin_organization_id: ids.almeida, full_name: 'Cliente Portal 045',
    nationality: 'Brasileira', marital_status: 'MARRIED', profession: 'Pedreiro', acquisition_channel: 'WHATSAPP', email: 'p045@dgbrasil.test' }
  const kase = { legal_area_id: ids.banking, title: 'Caso portal 045', origin_organization_id: ids.almeida }
  const r = await como(ids.almeidaAdm, async (tx) => (await um(tx, `select public.partner_submit_case_once($1, $2, $3) r`, [randomUUID(), JSON.stringify(cli), JSON.stringify(kase)])).r)
  const d = await um(db, `select d.nationality, d.marital_status, d.profession, c.acquisition_channel from individual_client_details d join clients c on c.id = d.client_id where d.client_id = $1`, [r.client_id])
  igual([d.nationality, d.marital_status, d.profession, d.acquisition_channel], ['Brasileira', 'MARRIED', 'Pedreiro', 'WHATSAPP'], 'qualificação')
  igual((await um(db, `select acquisition_channel from legal_cases where id = $1`, [r.legal_case_id])).acquisition_channel, 'WHATSAPP', 'caso herdou')
})
await deve('status e fases antigos são traduzidos (nunca recusados); os novos são aceitos', async () => {
  const novo = (status, phase, n) => criarProc(ids.lucas, randomUUID(), { legal_case_id: ids.caso045, cnj_number: cnj027(45000 + n), status, phase })
  const ids045 = []
  for (const [i, [st, ph]] of [['WAITING_CLIENT', 'PLEADINGS'], ['CLOSED', 'EVIDENCE'], ['SENTENCED', 'PROCEEDINGS'], ['FINAL_JUDGMENT', 'FINAL_JUDGMENT'], ['RECEIVED', 'ENFORCEMENT']].entries()) {
    ids045.push((await novo(st, ph, i)).legal_process_id)
  }
  const r = await linhas(db, `select status, phase from legal_processes where id = any ($1) order by cnj_number`, [ids045])
  igual(r.map((x) => [x.status, x.phase]), [['ACTIVE', 'PROCEEDINGS'], ['ARCHIVED', 'PROCEEDINGS'], ['SENTENCED', 'PROCEEDINGS'], ['FINAL_JUDGMENT', 'FINAL_JUDGMENT'], ['RECEIVED', 'ENFORCEMENT']], 'status e fases')
  await db.query(`update legal_processes set status = 'WAITING_DEADLINE', phase = 'JUDGMENT' where id = $1`, [ids045[2]])
  igual(await um(db, `select status, phase from legal_processes where id = $1`, [ids045[2]]), { status: 'ACTIVE', phase: 'PROCEEDINGS' }, 'na edição também')
  igual((await um(db, `select count(*)::int n from legal_processes where status in ('WAITING_CLIENT', 'WAITING_DEADLINE', 'CLOSED') or phase in ('PLEADINGS', 'EVIDENCE', 'JUDGMENT')`)).n, 0, 'nada antigo sobrou')
})
await deveFalhar('status desconhecido é recusado', () =>
  criarProc(ids.lucas, randomUUID(), { legal_case_id: ids.caso045, status: 'GANHO' }), /legal_processes_status_check/)
await deve('honorários do processo ficam nos dados internos; processo sem nome próprio (usa o do caso)', async () => {
  const r = await criarProc(ids.lucas, randomUUID(), { legal_case_id: ids.caso045, title: '   ' }, { fee_amount: '1500.50', fee_percentage: '30' })
  const p = await um(db, `select p.title, d.fee_amount::text fee, d.fee_percentage::text pct from legal_processes p
    join legal_process_internal_details d on d.legal_process_id = p.id where p.id = $1`, [r.legal_process_id])
  igual([p.title, p.fee, p.pct], [null, '1500.50', '30.00'], 'honorários')
})
await deve('parceiro cria processo: honorários ignorados (dado interno)', async () => {
  const r = await criarProc(ids.almeidaAdm, randomUUID(), { legal_case_id: ids.casoA, title: 'Processo parceiro 045' }, { fee_amount: '999' })
  igual((await um(db, `select count(*)::int n from legal_process_internal_details where legal_process_id = $1`, [r.legal_process_id])).n, 0, 'sem dados internos')
})
await deve('análise: informações adicionais ficam na análise e vão para o agente junto com o pedido (no início e no reenvio)', async () => {
  const r = await como(ids.lucas, async (tx) => (await um(tx, `select public.start_legal_analysis_once($1, $2, $3, '{}', true, 'Verificar portabilidade', '{}', 'Cliente tem 82 anos; banco Pan.') r`,
    [randomUUID(), ids.caso045, ids.tpl029])).r)
  const a = await um(db, `select a.additional_info, i.request_text from legal_analyses a join agent_run_inputs i on i.agent_run_id = a.agent_run_id where a.id = $1`, [r.analysis_id])
  igual(a.additional_info, 'Cliente tem 82 anos; banco Pan.', 'guardado')
  igual(a.request_text, 'Informações adicionais da equipe:\nCliente tem 82 anos; banco Pan.\n\nPedido:\nVerificar portabilidade', 'texto do agente')
  const s = await como(ids.lucas, async (tx) => (await um(tx, `select public.start_legal_analysis_once($1, $2, $3, '{}', false, null, '{}', 'Só contexto') r`, [randomUUID(), ids.caso045, ids.tpl029])).r)
  const e = await enviarAnalise(ids.lucas, randomUUID(), s.analysis_id)
  igual((await um(db, `select request_text from agent_run_inputs where agent_run_id = $1`, [e.agent_run_id])).request_text, 'Informações adicionais da equipe:\nSó contexto', 'reenvio')
})
await deve('contagem por status: uma consulta, com a RLS de quem pede', async () => {
  const soma = (rows) => rows.reduce((t, r) => t + Number(r.total), 0)
  const lucas = await como(ids.lucas, async (tx) => ({ rpc: soma(await linhas(tx, `select * from public.get_process_status_counts()`)),
    tab: (await um(tx, `select count(*)::int n from legal_processes where deleted_at is null`)).n }))
  igual(lucas.rpc, lucas.tab, 'interno')
  const parceiro = await como(ids.almeidaAdm, async (tx) => ({ rpc: soma(await linhas(tx, `select * from public.get_process_status_counts()`)),
    tab: (await um(tx, `select count(*)::int n from legal_processes where deleted_at is null`)).n }))
  igual(parceiro.rpc, parceiro.tab, 'parceiro: só os dele')
  if (!(parceiro.rpc < lucas.rpc)) throw new Error('parceiro deveria ver menos processos que o interno')
})

// ═════════════════════════════ Roadmap 2.0 — financeiro por processo [046] ═

secao('Roadmap 2.0 — financeiro por processo: contrato do processo, despesas e visão consolidada [046]')
await deve('cenário: caso de parceiro aceito com dois processos (valor da causa e honorários)', async () => {
  ids.caso046 = (await um(db, `insert into legal_cases (client_id, legal_area_id, title, partner_organization_id,
      origin_organization_id, created_by_organization_id, status, accepted_at, assigned_lawyer_id)
    values ($1, $2, 'Caso 046', $3, $3, $3, 'ACCEPTED', now(), $4) returning id`, [ids.joao, ids.banking, ids.almeida, ids.lucas])).id
  ids.proc046a = (await um(db, `insert into legal_processes (legal_case_id, title, case_value) values ($1, null, 50000) returning id`, [ids.caso046])).id
  ids.proc046b = (await um(db, `insert into legal_processes (legal_case_id, title, case_value) values ($1, 'Processo B 046', 8000) returning id`, [ids.caso046])).id
  await db.query(`insert into legal_process_internal_details (legal_process_id, fee_amount, fee_percentage) values ($1, 10000, 30)`, [ids.proc046a])
  const cpa = await um(db, `select partner_percentage::text p, owner_percentage::text o from case_partnership_agreements where legal_case_id = $1 and cancelled_at is null`, [ids.caso046])
  if (!cpa) throw new Error('parceria do caso não nasceu no aceite')
  ids.cpa046 = { partner: Number(cpa.p), owner: Number(cpa.o) }
})
await deveFalhar('contrato novo sem processo é recusado (o financeiro é do processo)', () =>
  como(ids.barbara, (tx) => tx.query(`insert into financial_agreements (legal_case_id, status) values ($1, 'DRAFT')`, [ids.caso046])),
  /contrato de honorários é do processo/)
await deveFalhar('processo de outro caso não serve (FK composta processo + caso)', () =>
  como(ids.barbara, (tx) => tx.query(`insert into financial_agreements (legal_case_id, legal_process_id, status) values ($1, $2, 'DRAFT')`, [ids.casoA, ids.proc046a])),
  /financial_agreements_process_fkey/)
await deve('um contrato ATIVO por processo; o outro processo do mesmo caso tem o seu', async () => {
  ids.fa046a = await como(ids.barbara, async (tx) => (await um(tx, `insert into financial_agreements (legal_case_id, legal_process_id, status, fixed_fee) values ($1, $2, 'ACTIVE', 10000) returning id`, [ids.caso046, ids.proc046a])).id)
  await como(ids.barbara, (tx) => tx.query(`insert into financial_agreements (legal_case_id, legal_process_id, status) values ($1, $2, 'ACTIVE')`, [ids.caso046, ids.proc046b]))
})
await deveFalhar('…e um segundo ATIVO no mesmo processo é impedido', () =>
  como(ids.barbara, (tx) => tx.query(`insert into financial_agreements (legal_case_id, legal_process_id, status) values ($1, $2, 'ACTIVE')`, [ids.caso046, ids.proc046a])),
  /one_active_per_process/)
await deveFalhar('contrato não muda de processo', () =>
  como(ids.barbara, (tx) => tx.query(`update financial_agreements set legal_process_id = $2 where id = $1`, [ids.fa046a, ids.proc046b])),
  /não muda de processo/)
await deve('recebimento no processo A: dividido com o parceiro pelo percentual do caso', async () => {
  await como(ids.barbara, async (tx) => {
    const pg = (await um(tx, `insert into payments (financial_agreement_id, amount, payment_type, due_date) values ($1, 6000, 'FIXED', current_date + 10) returning id`, [ids.fa046a])).id
    await tx.query(`insert into payments (financial_agreement_id, amount, payment_type, due_date) values ($1, 4000, 'FIXED', current_date - 5)`, [ids.fa046a])
    await tx.query(`insert into payment_receipts (payment_id, kind, amount) values ($1, 'RECEIPT', 6000)`, [pg])
  })
})
await deve('despesas: ADMIN lança (o caso vem do processo); cancelar exige motivo; cancelada não muda; auditada', async () => {
  const nova = (cat, valor, pago) => como(ids.barbara, async (tx) => (await um(tx,
    `insert into process_expenses (legal_process_id, legal_case_id, category, description, amount, incurred_on, paid_on, reimbursable)
     values ($1, $2, $3, $4, $5, current_date, $6, $7) returning id, legal_case_id`,
    [ids.proc046a, ids.casoA, cat, `Despesa ${cat}`, valor, pago ? '2026-11-01' : null, cat === 'COURT_COSTS'])))
  const custas = await nova('COURT_COSTS', 300, true)
  igual(custas.legal_case_id, ids.caso046, 'caso vem do processo, não do navegador')
  ids.desp046 = custas.id
  await nova('HIRED_LAWYER', 500, false)
  const pericia = (await nova('EXPERT_FEE', 200, true)).id
  await como(ids.barbara, (tx) => tx.query(`update process_expenses set cancelled_at = now(), cancellation_reason = 'Lançada em duplicidade' where id = $1`, [pericia]))
  const a = await um(db, `select action from audit_events where entity_id = $1 order by created_at desc limit 1`, [pericia])
  igual(a.action, 'PROCESS_EXPENSE_CANCELLED', 'auditoria')
  ids.pericia046 = pericia
})
await deveFalhar('cancelar despesa sem motivo é recusado', () =>
  como(ids.barbara, (tx) => tx.query(`update process_expenses set cancelled_at = now() where id = $1`, [ids.desp046])), /cancel_has_reason/)
await deveFalhar('despesa cancelada não muda', () =>
  como(ids.barbara, (tx) => tx.query(`update process_expenses set amount = 1 where id = $1`, [ids.pericia046])), /histórico/)
await deveFalhar('LAWYER não lança despesa', () =>
  como(ids.lucas, (tx) => tx.query(`insert into process_expenses (legal_process_id, legal_case_id, category, description, amount, incurred_on) values ($1, $2, 'OTHER', 'x', 1, current_date)`, [ids.proc046a, ids.caso046])),
  /Somente ADMIN/)
await deve('LAWYER e parceiro não leem despesas (RLS)', async () => {
  for (const uid of [ids.lucas, ids.almeidaAdm]) {
    const n = await como(uid, async (tx) => (await um(tx, `select count(*)::int n from process_expenses`)).n)
    igual(n, 0, 'despesas visíveis')
  }
})
await deve('visão por processo: valor da causa, honorários (escritório × parceiro), contratado, recebido, atraso, despesas e resultado', async () => {
  const v = await como(ids.barbara, async (tx) => um(tx, `select * from process_finance_overview where legal_process_id = $1`, [ids.proc046a]))
  const n = (x) => Number(x)
  const parceiroRecebido = Math.round(6000 * ids.cpa046.partner) / 100
  igual([n(v.case_value), n(v.fee_amount), n(v.fee_percentage)], [50000, 10000, 30], 'valor e honorários')
  igual([n(v.fee_partner_share), n(v.fee_owner_share)], [10000 * ids.cpa046.partner / 100, 10000 * ids.cpa046.owner / 100], 'divisão dos honorários')
  igual([n(v.contracted), n(v.received), n(v.open_balance), n(v.overdue)], [10000, 6000, 4000, 4000], 'contrato')
  igual([n(v.received_partner_share), n(v.received_owner_share)], [parceiroRecebido, 6000 - parceiroRecebido], 'recebido dividido')
  igual([n(v.expenses_total), n(v.expenses_paid), n(v.expenses_open), n(v.expenses_reimbursable), v.expense_count], [800, 300, 500, 300, 2], 'despesas (cancelada fora)')
  igual(n(v.net_result), 6000 - parceiroRecebido - 300, 'resultado = recebido do escritório − despesas pagas')
  igual(v.display_title, 'Caso 046', 'processo sem nome usa o do caso')
  const b = await como(ids.barbara, async (tx) => um(tx, `select display_title, contracted::text c from process_finance_overview where legal_process_id = $1`, [ids.proc046b]))
  igual([b.display_title, b.c], ['Processo B 046', '0.00'], 'processo B')
})
await deve('visão por processo para LAWYER: dinheiro vazio (RLS das tabelas de origem)', async () => {
  const v = await como(ids.lucas, async (tx) => um(tx, `select contracted::text c, received::text r, expenses_total::text e from process_finance_overview where legal_process_id = $1`, [ids.proc046a]))
  igual([v.c, v.r, v.e], ['0.00', '0.00', '0.00'], 'sem valores')
})

await deve('totais do financeiro: uma linha somada no banco; cliente na visão por processo', async () => {
  const t = await como(ids.barbara, async (tx) => um(tx, `select process_count, expenses_total::text e from process_finance_totals`))
  if (!(t.process_count > 0)) throw new Error('sem processos nos totais')
  const v = await como(ids.barbara, async (tx) => um(tx, `select client_name from process_finance_overview where legal_process_id = $1`, [ids.proc046a]))
  if (!v.client_name) throw new Error('sem nome do cliente')
})

// ═════════════════════════════ Roadmap 2.0 — tarefas para os agentes [047] ═

secao('Roadmap 2.0 — tarefas do processo para os agentes: orquestrador, revisão humana e o check [047]')
const tarefa047 = (uid, proc, titulo, o = {}) => como(uid, async (tx) => (await um(tx,
  `select public.create_process_task($1, $2, $3, $4, $5, $6, $7) r`,
  [proc, titulo, o.instrucoes ?? `Fazer: ${titulo}`, o.agente ?? null, o.prazo ?? null, o.prioridade ?? 'NORMAL', o.enviar ?? true])).r)
const status047 = async (id) => (await um(db, `select status, last_error, attempts, agent_run_id from process_tasks where id = $1`, [id]))
await deve('sem agente escolhido e sem orquestrador: a tarefa fica ABERTA, com o motivo; vira movimentação interna', async () => {
  const r = await tarefa047(ids.lucas, ids.proc046a, 'Juntar procuração')
  const t = await status047(r.task_id)
  igual([t.status, t.agent_run_id, !!t.last_error], ['OPEN', null, true], 'aberta')
  const ev = await um(db, `select source, event_type, title from process_events where raw_data ->> 'process_task_id' = $1`, [r.task_id])
  igual([ev.source, ev.event_type, ev.title], ['MANUAL', 'TASK', 'Tarefa para os agentes: Juntar procuração'], 'movimentação')
  ids.tarefaAberta047 = r.task_id
})
await deveFalhar('LAWYER não escolhe o orquestrador', () =>
  como(ids.lucas, (tx) => tx.query(`select public.save_process_task_settings($1)`, [ids.agente])), /Somente ADMIN/)
await deve('ADMIN escolhe o orquestrador; tarefa nova vai para a fila com o pedido completo', async () => {
  await como(ids.barbara, (tx) => tx.query(`select public.save_process_task_settings($1)`, [ids.agente]))
  const r = await tarefa047(ids.lucas, ids.proc046a, 'Réplica', { instrucoes: 'Redigir a réplica à contestação do Banco Pan.', prazo: '2026-12-01T18:00:00-03:00', prioridade: 'HIGH' })
  const t = await status047(r.task_id)
  igual([t.status, t.attempts, r.agent_run_id === t.agent_run_id], ['QUEUED', 1, true], 'na fila')
  const run = await um(db, `select r.operation, r.agent_id, r.legal_process_id, i.request_text, i.parameters from agent_runs r join agent_run_inputs i on i.agent_run_id = r.id where r.id = $1`, [t.agent_run_id])
  igual([run.operation, run.agent_id, run.legal_process_id, run.parameters.process_task_id], ['PROCESS_TASK', ids.agente, ids.proc046a, r.task_id], 'execução')
  for (const trecho of ['TAREFA DO PROCESSO', 'Título: Réplica', 'Redigir a réplica à contestação do Banco Pan.', 'Prazo interno: 01/12/2026 18:00', 'revisão humana']) {
    if (!run.request_text.includes(trecho)) throw new Error(`pedido sem "${trecho}"`)
  }
  ids.tarefa047 = r.task_id
  ids.run047 = t.agent_run_id
})
await deveFalhar('ASSISTANT não cria tarefa para os agentes', () => tarefa047(ids.ana, ids.proc046a, 'X'), /Somente ADMIN ou advogado/)
await deve('parceiro não lê tarefas (dado interno)', async () => {
  const n = await como(ids.almeidaAdm, async (tx) => (await um(tx, `select count(*)::int n from process_tasks`)).n)
  igual(n, 0, 'tarefas visíveis')
})
await deveFalhar('ninguém escreve direto na tabela (só pelas funções)', () =>
  como(ids.barbara, (tx) => tx.query(`update process_tasks set status = 'DONE' where id = $1`, [ids.tarefa047])), /permission denied/)
await deve('a tarefa acompanha a execução: trabalhando → entregue para revisão (movimentação do agente)', async () => {
  await db.query(`update agent_runs set status = 'RUNNING', started_at = now(), claimed_by = 'teste-047', claimed_at = now() where id = $1`, [ids.run047])
  igual((await status047(ids.tarefa047)).status, 'IN_PROGRESS', 'trabalhando')
  await db.query(`update agent_runs set status = 'WAITING_HUMAN' where id = $1`, [ids.run047])
  igual((await status047(ids.tarefa047)).status, 'IN_REVIEW', 'para revisar')
  const ev = await um(db, `select source from process_events where raw_data ->> 'process_task_id' = $1 and title like 'Tarefa entregue%'`, [ids.tarefa047])
  igual(ev.source, 'AGENT', 'movimentação do agente (interna)')
})
await deve('o check: advogado conclui; fica registrado quem e quando', async () => {
  await como(ids.lucas, (tx) => tx.query(`select public.complete_process_task($1, 'Conferido, pode protocolar.')`, [ids.tarefa047]))
  const t = await um(db, `select status, completed_by, completion_note from process_tasks where id = $1`, [ids.tarefa047])
  igual([t.status, t.completed_by, t.completion_note], ['DONE', ids.lucas, 'Conferido, pode protocolar.'], 'concluída')
  const a = await um(db, `select count(*)::int n from audit_events where entity_id = $1`, [ids.tarefa047])
  if (!(a.n >= 2)) throw new Error('sem auditoria da tarefa')
})
await deveFalhar('concluída não volta a ser concluída', () =>
  como(ids.lucas, (tx) => tx.query(`select public.complete_process_task($1)`, [ids.tarefa047])), /já encerrada/)
await deve('agente falhou: tarefa volta a ABERTA com o motivo; reenviar com observação cria nova execução', async () => {
  const r = await tarefa047(ids.barbara, ids.proc046a, 'Cálculo atualizado')
  const run1 = (await status047(r.task_id)).agent_run_id
  await db.query(`update agent_runs set status = 'FAILED', completed_at = now(), error_message = 'Documento ilegível' where id = $1`, [run1])
  const t1 = await status047(r.task_id)
  igual([t1.status, t1.last_error], ['OPEN', 'Documento ilegível'], 'aberta com motivo')
  const s = await como(ids.lucas, async (tx) => (await um(tx, `select public.send_process_task($1, 'Use o extrato novo anexado.') r`, [r.task_id])).r)
  const t2 = await status047(r.task_id)
  igual([t2.status, t2.attempts, t2.agent_run_id === s.agent_run_id, t2.agent_run_id !== run1], ['QUEUED', 2, true, true], 'reenviada')
  const txt = (await um(db, `select request_text from agent_run_inputs where agent_run_id = $1`, [t2.agent_run_id])).request_text
  if (!txt.includes('Use o extrato novo anexado.')) throw new Error('observação não foi para o agente')
  ids.tarefaFila047 = r.task_id
})
await deveFalhar('reenviar tarefa que já está na fila é recusado', () =>
  como(ids.lucas, (tx) => tx.query(`select public.send_process_task($1)`, [ids.tarefaFila047])), /já está com os agentes/)
await deveFalhar('cancelar exige motivo', () =>
  como(ids.lucas, (tx) => tx.query(`select public.cancel_process_task($1, '  ')`, [ids.tarefaFila047])), /motivo/)
await deve('cancelar tarefa na fila: interrompe a execução e registra o motivo', async () => {
  const run = (await status047(ids.tarefaFila047)).agent_run_id
  await como(ids.lucas, (tx) => tx.query(`select public.cancel_process_task($1, 'Cliente desistiu')`, [ids.tarefaFila047]))
  const t = await um(db, `select status, cancel_reason from process_tasks where id = $1`, [ids.tarefaFila047])
  igual([t.status, t.cancel_reason], ['CANCELLED', 'Cliente desistiu'], 'cancelada')
  igual((await um(db, `select status from agent_runs where id = $1`, [run])).status, 'CANCELLED', 'execução interrompida')
  igual((await um(db, `select status from process_tasks where id = $1`, [ids.tarefaFila047])).status, 'CANCELLED', 'continua cancelada (não volta a aberta)')
})
await deve('tarefa aberta sem agente: depois do orquestrador configurado, "enviar" põe na fila', async () => {
  const s = await como(ids.lucas, async (tx) => (await um(tx, `select public.send_process_task($1) r`, [ids.tarefaAberta047])).r)
  igual(s.status, 'QUEUED', 'na fila')
})

await deve('agentes para tarefa: LAWYER vê os ativos e qual é o orquestrador; ASSISTANT e parceiro não veem nada', async () => {
  const l = await como(ids.lucas, async (tx) => linhas(tx, `select id, is_orchestrator from public.list_task_agents()`))
  if (!l.some((a) => a.id === ids.agente && a.is_orchestrator)) throw new Error('orquestrador ausente')
  for (const uid of [ids.ana, ids.almeidaAdm]) {
    igual((await como(uid, async (tx) => linhas(tx, `select id from public.list_task_agents()`))).length, 0, 'lista')
  }
})

// ═════════════════════════════ Roadmap 2.0 — parceiros, convites e OABs [048] ═

secao('Roadmap 2.0 — várias OABs por pessoa, OAB no convite e cadastro do parceiro no primeiro acesso [048]')
await deve('a pessoa cadastra várias OABs; a primeira é a principal e aparece no perfil; trocar a principal e remover', async () => {
  const sp = await como(ids.lucas, async (tx) => (await um(tx, `select public.add_my_oab('225.006', 'rj') id`)).id)
  const mg = await como(ids.lucas, async (tx) => (await um(tx, `select public.add_my_oab('123456A', 'MG') id`)).id)
  const p1 = await um(db, `select oab_number, oab_state from profiles where id = $1`, [ids.lucas])
  igual([p1.oab_number, p1.oab_state], ['225006', 'RJ'], 'principal = primeira')
  await como(ids.lucas, (tx) => tx.query(`select public.set_my_primary_oab($1)`, [mg]))
  igual((await um(db, `select oab_number from profiles where id = $1`, [ids.lucas])).oab_number, '123456A', 'nova principal')
  await como(ids.lucas, (tx) => tx.query(`select public.remove_my_oab($1)`, [mg]))
  const rest = await linhas(db, `select id, is_primary from profile_oabs where user_id = $1`, [ids.lucas])
  igual(rest.map((r) => [r.id, r.is_primary]), [[sp, true]], 'sobrou a do RJ, de novo principal')
  igual((await um(db, `select oab_number from profiles where id = $1`, [ids.lucas])).oab_number, '225006', 'espelho')
})
await deveFalhar('OAB com formato inválido é recusada', () =>
  como(ids.lucas, (tx) => tx.query(`select public.add_my_oab('ABC', 'RJ')`)), /OAB inválido/)
await deveFalhar('ninguém remove OAB de outra pessoa', async () => {
  const id = (await um(db, `select id from profile_oabs where user_id = $1 limit 1`, [ids.lucas])).id
  await como(ids.ana, (tx) => tx.query(`select public.remove_my_oab($1)`, [id]))
}, /não encontrada/)
await deve('quem vê a OAB de quem: a própria pessoa e o ADMIN; o parceiro não vê a do escritório', async () => {
  igual((await como(ids.lucas, async (tx) => linhas(tx, `select 1 from profile_oabs where user_id = $1`, [ids.lucas]))).length, 1, 'própria')
  igual((await como(ids.barbara, async (tx) => linhas(tx, `select 1 from profile_oabs where user_id = $1`, [ids.lucas]))).length, 1, 'ADMIN')
  igual((await como(ids.almeidaAdm, async (tx) => linhas(tx, `select 1 from profile_oabs where user_id = $1`, [ids.lucas]))).length, 0, 'parceiro')
})
await deve('convite de parceiro só com o e-mail: escritório pendente; no 1º acesso o administrador vê que falta o cadastro', async () => {
  ids.parc048 = await como(ids.barbara, async (tx) => (await um(tx, `select public.create_partner_invite_office('Ana Souza', 'dra.ana@parceiro048.test', 40) id`)).id)
  const st = await um(db, `select o.status, o.name, s.default_partner_percentage::text p from organizations o join partner_office_settings s on s.organization_id = o.id where o.id = $1`, [ids.parc048])
  igual([st.status, st.name, st.p], ['PENDING', 'Convite: Ana Souza', '40.00'], 'escritório pendente (nome do contato)')
  igual((await um(db, `select profile_completed_at from partner_office_settings where organization_id = $1`, [ids.parc048])).profile_completed_at, null, 'a completar')
  const inv = await convidar(ids.barbara, 'dra.ana@parceiro048.test', 'PARTNER_ADMIN', ids.parc048)
  await comoServico((tx) => tx.query(`select public.set_invitation_oab($1, '98.765', 'sp')`, [inv.invitation_id]))
  ids.ana048 = await usuarioAuth('dra.ana@parceiro048.test', 'Ana Parceira')
  const ctx = await comoAal1(ids.ana048, async (tx) => (await um(tx, `select public.get_invitation_context($1) r`, [await sha256hex(inv.token)])).r)
  igual([ctx.status, ctx.role, ctx.needs_office_profile, ctx.oab_number, ctx.oab_state], ['PENDING', 'PARTNER_ADMIN', true, '98765', 'SP'], 'contexto')
  igual((await aceitar(ids.ana048, inv.token)).status, 'ACCEPTED', 'aceite')
  const oab = await um(db, `select oab_number, oab_state, is_primary from profile_oabs where user_id = $1`, [ids.ana048])
  igual([oab.oab_number, oab.oab_state, oab.is_primary], ['98765', 'SP', true], 'OAB do convite virou da pessoa')
  ids.tokenAna048 = inv.token
})
await deve('contexto do convite só para o próprio convidado (outra pessoa recebe INVALID)', async () => {
  const r = await comoAal1(ids.lucas, async (tx) => (await um(tx, `select public.get_invitation_context($1) r`, [await sha256hex(ids.tokenAna048)])).r)
  igual(r.status, 'INVALID', 'outro e-mail')
})
await deveFalhar('cadastro do escritório exige CNPJ ou CPF', () =>
  comoAal1(ids.ana048, (tx) => tx.query(`select public.complete_partner_office_profile($1)`, [JSON.stringify({ name: 'Ana Advocacia', document: '123', phone: '11999990048' })])),
  /CNPJ \(14 dígitos\) ou o CPF/)
await deve('o parceiro completa o cadastro no 1º acesso (CPF de advogada sem CNPJ, telefone, OAB); só uma vez', async () => {
  await comoAal1(ids.ana048, (tx) => tx.query(`select public.complete_partner_office_profile($1)`, [JSON.stringify({
    name: 'Ana Advocacia', legal_name: 'Ana Souza', document: '999.048.000-01', phone: '(11) 99999-0048', email: 'contato@parceiro048.test',
    responsible_name: 'Ana Souza', oab_number: '98765', oab_state: 'SP' })]))
  const o = await um(db, `select o.name, o.cpf, o.cnpj, o.phone, o.email, s.profile_completed_at is not null done, s.responsible_oab_number
    from organizations o join partner_office_settings s on s.organization_id = o.id where o.id = $1`, [ids.parc048])
  igual([o.name, o.cpf, o.cnpj, o.phone, o.email, o.done, o.responsible_oab_number], ['Ana Advocacia', '99904800001', null, '11999990048', 'contato@parceiro048.test', true, '98765'], 'escritório')
})
await deveFalhar('…e não completa de novo', () =>
  comoAal1(ids.ana048, (tx) => tx.query(`select public.complete_partner_office_profile($1)`, [JSON.stringify({ name: 'X', document: '99904800001', phone: '11999990048' })])),
  /já foi completado/)
await deveFalhar('usuário comum do parceiro não completa cadastro do escritório', () =>
  como(ids.almeidaAdm, (tx) => tx.query(`select public.complete_partner_office_profile($1)`, [JSON.stringify({ name: 'X', document: '99904800001', phone: '11999990048' })])),
  /já foi completado|não é seu/)
await deveFalhar('LAWYER não convida parceiro', () =>
  como(ids.lucas, (tx) => tx.query(`select public.create_partner_invite_office('X', 'x@y.test')`)), /Somente ADMIN/)
await deve('escritório cadastrado pelo formulário completo (ADMIN) não pede cadastro no 1º acesso', async () => {
  const id = await como(ids.barbara, async (tx) => (await um(tx, `select private.create_partner_office($1, '{}') id`, [JSON.stringify({ name: 'Completo 048' })])).id)
  igual((await um(db, `select profile_completed_at is not null done from partner_office_settings where organization_id = $1`, [id])).done, true, 'completo')
})
await deveFalhar('só o servidor grava a OAB do convite', () =>
  como(ids.barbara, (tx) => tx.query(`select public.set_invitation_oab($1, '1', 'SP')`, [randomUUID()])), /permission denied/)

// ═════════════════════════════ Roadmap 2.0 — indicadores [049] ═══════════

secao('Roadmap 2.0 — indicadores e séries com a RLS de quem pede [049]')
const metricas = (uid, de = null, ate = null) => como(uid, async (tx) => (await um(tx, `select public.get_dashboard_metrics($1, $2) m`, [de, ate])).m)
await deve('totais batem com o que cada um enxerga; parceiro vê só o próprio escritório', async () => {
  for (const uid of [ids.barbara, ids.lucas, ids.almeidaAdm]) {
    const m = await metricas(uid)
    const real = await como(uid, async (tx) => um(tx, `select (select count(*)::int from clients where deleted_at is null) c,
      (select count(*)::int from legal_cases where deleted_at is null) k, (select count(*)::int from legal_processes where deleted_at is null) p`))
    igual([m.clients.total, m.cases.total, m.processes.total], [real.c, real.k, real.p], `totais (${uid === ids.almeidaAdm ? 'parceiro' : 'interno'})`)
  }
  const interno = await metricas(ids.barbara), parceiro = await metricas(ids.almeidaAdm)
  if (!(parceiro.processes.total < interno.processes.total)) throw new Error('parceiro deveria ver menos processos')
  igual([parceiro.tasks.open, parceiro.reviews.pending], [0, 0], 'parceiro não vê tarefas nem revisões')
})
await deve('dinheiro: ADMIN vê o recebido; LAWYER não vê (RLS do financeiro)', async () => {
  const a = await metricas(ids.barbara, '2000-01-01', '2100-12-31'), l = await metricas(ids.lucas, '2000-01-01', '2100-12-31')
  if (!(Number(a.finance.received) > 0)) throw new Error('ADMIN deveria ver recebimentos')
  igual(Number(l.finance.received), 0, 'LAWYER sem recebimentos')
})
await deve('séries: semanas até 120 dias, meses acima; novos do período somam a série', async () => {
  const hoje = (await um(db, `select (now() at time zone 'America/Sao_Paulo')::date::text d`)).d
  const s = await metricas(ids.barbara)
  igual(s.period.unit, 'week', 'unidade')
  igual(s.series.reduce((t, x) => t + Number(x.cases), 0), s.cases.new, 'série de casos = novos do período')
  const ano = await metricas(ids.barbara, '2026-01-01', hoje)
  igual(ano.period.unit, 'month', 'unidade longa')
  igual(ano.series.reduce((t, x) => t + Number(x.clients), 0), ano.clients.new, 'série de clientes = novos')
})
await deve('canal de aquisição dos novos clientes aparece no agrupamento', async () => {
  const m = await metricas(ids.barbara)
  if (!m.clients.by_channel.some((x) => x.key === 'REFERRAL' || x.key === 'GOOGLE_ADS')) throw new Error('sem canal no agrupamento')
})
await deveFalhar('período invertido é recusado', () => metricas(ids.barbara, '2026-12-31', '2026-01-01'), /Período inválido/)

await deve('sem escolha do ADMIN, o orquestrador é o agente ativo "orquestrador" (o do computador do escritório)', async () => {
  const antigo = (await um(db, `select slug from agents where id = $1`, [ids.agente])).slug
  await como(ids.barbara, (tx) => tx.query(`select public.save_process_task_settings(null)`))
  await db.query(`update agents set slug = 'orquestrador' where id = $1`, [ids.agente])
  const r = await tarefa047(ids.lucas, ids.proc046a, 'Organizar a pasta')
  igual((await um(db, `select agent_id from agent_runs where id = $1`, [r.agent_run_id])).agent_id, ids.agente, 'foi para o orquestrador')
  const l = await como(ids.lucas, async (tx) => linhas(tx, `select id, is_orchestrator from public.list_task_agents()`))
  igual(l.find((a) => a.id === ids.agente)?.is_orchestrator, true, 'aparece como orquestrador')
  await db.query(`update agents set slug = $2 where id = $1`, [ids.agente, antigo])
  await como(ids.barbara, (tx) => tx.query(`select public.save_process_task_settings($1)`, [ids.agente]))
})

// ═════════════════════════════ Roadmap 2.0 — correções da validação [050] ═

secao('Roadmap 2.0 — divisão do parceiro vale pela criação do caso (E-14) e índices (R2-12) [050]')
await deve('caso criado a 50/50, divisão muda para 60/40, aceite depois: o caso fica 50/50; caso novo fica 60/40', async () => {
  const p = await parceiro('Parceiro 050', 50)
  const novoCaso = async (titulo) => (await um(db, `insert into legal_cases (client_id, legal_area_id, title, status, partner_organization_id,
      origin_organization_id, created_by_organization_id) values ($1, $2, $3, 'SUBMITTED', $4, $4, $4) returning id`,
    [ids.joao, ids.banking, titulo, p])).id
  const antes = await novoCaso('Caso 050 antes da mudança')
  igual((await um(db, `select partner_split_partner_percentage::text p from legal_cases where id = $1`, [antes])).p, '50.00', 'divisão guardada na criação')
  await db.query(`update partner_office_settings set default_partner_percentage = 60, default_owner_percentage = 40 where organization_id = $1`, [p])
  const depois = await novoCaso('Caso 050 depois da mudança')
  for (const c of [antes, depois]) {
    await como(ids.lucas, (tx) => tx.query(`update legal_cases set status = 'ACCEPTED', assigned_lawyer_id = $2 where id = $1`, [c, ids.lucas]))
  }
  const a = await linhas(db, `select legal_case_id, partner_percentage::text p, owner_percentage::text o from case_partnership_agreements
    where legal_case_id = any ($1) and cancelled_at is null`, [[antes, depois]])
  igual([a.find((x) => x.legal_case_id === antes)?.p, a.find((x) => x.legal_case_id === antes)?.o], ['50.00', '50.00'], 'criado antes: 50/50')
  igual([a.find((x) => x.legal_case_id === depois)?.p, a.find((x) => x.legal_case_id === depois)?.o], ['60.00', '40.00'], 'criado depois: 60/40')
})
await deve('caso do escritório principal não guarda divisão; trocar a origem para um parceiro guarda a divisão dele', async () => {
  const c = (await um(db, `insert into legal_cases (client_id, legal_area_id, title, status, origin_organization_id, created_by_organization_id)
    values ($1, $2, 'Caso 050 proprietário', 'DRAFT', $3, $3) returning id`, [ids.joao, ids.banking, ids.owner])).id
  igual((await um(db, `select partner_split_partner_percentage p from legal_cases where id = $1`, [c])).p, null, 'sem divisão')
  await db.query(`update legal_cases set origin_organization_id = $2 where id = $1`, [c, ids.ferreira])
  const r = await um(db, `select partner_split_organization_id o, partner_split_partner_percentage::text p from legal_cases where id = $1`, [c])
  igual([r.o, r.p], [ids.ferreira, '60.00'], 'divisão do novo parceiro')
})
await deve('chaves estrangeiras novas com índice', async () => {
  const faltam = await linhas(db, `
    select c.conrelid::regclass::text t, a.attname col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and array_length(c.conkey, 1) = 1
      and c.conrelid::regclass::text in ('process_expenses', 'process_tasks', 'process_task_settings')
      and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])`)
  igual(faltam, [], 'FKs sem índice')
})

await deve('convite de parceiro: nova tentativa para o mesmo e-mail reaproveita o escritório que não completou o cadastro (R2-06)', async () => {
  const a = await como(ids.barbara, async (tx) => (await um(tx, `select public.create_partner_invite_office('Carla Lima', 'carla@parceiro050.test', 30) id`)).id)
  await db.query(`update organizations set status = 'INACTIVE' where id = $1`, [a])   // a falha do e-mail desativa
  const b = await como(ids.barbara, async (tx) => (await um(tx, `select public.create_partner_invite_office('Carla Lima Souza', 'Carla@Parceiro050.test', 35) id`)).id)
  igual(b, a, 'mesmo escritório')
  const o = await um(db, `select o.status, o.name, s.default_partner_percentage::text p from organizations o join partner_office_settings s on s.organization_id = o.id where o.id = $1`, [a])
  igual([o.status, o.name, o.p], ['PENDING', 'Convite: Carla Lima Souza', '35.00'], 'reativado e atualizado')
  igual((await um(db, `select count(*)::int n from organizations where email = 'carla@parceiro050.test'`)).n, 1, 'um só escritório')
})
await deveFalhar('convite sem nome do contato é recusado antes de criar o escritório', () =>
  como(ids.barbara, (tx) => tx.query(`select public.create_partner_invite_office('  ', 'z@parceiro050.test')`)), /nome do contato/)

// ═════════════════════════════ Ponte com os agentes da máquina [051] ════

secao('Ponte: pasta do Drive e cadastro do cliente do trabalho, bloqueio do Porteiro, Drive sem duplicata [051]')
const F051 = 'pastaPonteFicticia_0001', F051b = 'pastaPonteFicticia_0002'
await deve('dados da ponte: só do cliente do trabalho reservado, com a pasta ligada; registra o acesso a dado pessoal', async () => {
  await como(ids.lucas, (tx) => tx.query(`select public.drive_link_client_folder($1, $2, 'DG TESTE - JOSE DA SILVA FICTICIO')`, [ids.cli041, F051]))
  ids.r051 = await avulsa040('Ponte: análise de teste'); ids.l051 = lease()
  igual((await reservar040(hA, ids.r051, ids.l051)).claimed, true, 'reservado')
  const b = await ex(`select private.executor_bridge_data($1, $2, $3) r`, [hA, ids.r051, ids.l051])
  const nome = (await um(db, `select coalesce(i.full_name, co.legal_name) n from clients c left join individual_client_details i on i.client_id = c.id
    left join company_client_details co on co.client_id = c.id where c.id = $1`, [ids.cli041])).n
  igual([b.cliente.id, b.cliente.nome, b.pasta_drive.id, b.pasta_drive.nome], [ids.cli041, nome, F051, 'DG TESTE - JOSE DA SILVA FICTICIO'], 'dados')
  const acesso = await um(db, `select count(*)::int n from personal_data_access_events where client_id = $1 and resource_type = 'LEGAL_CASE'
    and resource_id = $2 and action = 'VIEW_DETAIL' and created_at > now() - interval '10 minutes'`, [ids.cli041, ids.casoA])
  igual(acesso.n >= 1, true, 'acesso registrado (um por 10 minutos)')
  await ex(`select private.executor_bridge_data($1, $2, $3) r`, [hB, ids.r051, ids.l051]).then(
    () => { throw new Error('outro computador leu') }, (e) => { if (!/não está reservado|inválido ou revogado/.test(e.message)) throw e })
  await ex(`select private.executor_bridge_data($1, $2, $3) r`, [hA, ids.r051, lease()]).then(
    () => { throw new Error('reserva errada leu') }, (e) => { if (!/não está reservado/.test(e.message)) throw e })
})
await deve('dados da ponte [053]: cadastro completo (CPF, documento, telefone, endereço) e quem assina', async () => {
  await db.query(`update clients set cpf = '99900000005' where id = $1`, [ids.cli041])
  await db.query(`update individual_client_details set nationality = 'brasileira', identity_document_type = 'RG',
    identity_document_number = '00.000.000-0', identity_document_issuer = 'DETRAN', identity_document_state = 'RJ' where client_id = $1`, [ids.cli041])
  await db.query(`delete from client_contacts where client_id = $1 and type in ('PHONE', 'WHATSAPP')`, [ids.cli041])
  await db.query(`insert into client_contacts (client_id, type, value, is_primary) values ($1, 'WHATSAPP', '(00) 99999-0000', false),
    ($1, 'PHONE', '(00) 3333-0000', true)`, [ids.cli041])
  await db.query(`delete from client_addresses where client_id = $1`, [ids.cli041])
  await db.query(`insert into client_addresses (client_id, type, postal_code, street, number, neighborhood, city, state, is_primary)
    values ($1, 'RESIDENTIAL', '25000000', 'Rua Fictícia', '1', 'Centro', 'Cidade Fictícia', 'RJ', true)`, [ids.cli041])
  await db.query(`insert into owner_office_settings (organization_id, principal_lawyer_name, principal_oab_number, principal_oab_state)
    values ($1, 'Advogada Fictícia', '000000', 'RJ') on conflict (organization_id) do update
    set principal_lawyer_name = excluded.principal_lawyer_name, principal_oab_number = excluded.principal_oab_number, principal_oab_state = excluded.principal_oab_state`, [ids.owner])
  const b = await ex(`select private.executor_bridge_data($1, $2, $3) r`, [hA, ids.r051, ids.l051])
  igual([b.cliente.cpf, b.cliente.rg, b.cliente.nacionalidade, b.cliente.telefone, b.cliente.endereco],
    ['999.000.000-05', 'RG 00.000.000-0 DETRAN/RJ', 'brasileira', '(00) 3333-0000', 'Rua Fictícia, 1, Centro, Cidade Fictícia/RJ, CEP 25000-000'], 'cadastro')
  igual([b.escritorio.advogado, b.escritorio.oab], ['Advogada Fictícia', 'OAB/RJ 000000'], 'quem assina')
})
await deve('dados da ponte [055]: forma de pagamento do contrato no código que o gerador entende; sem escolha, vem vazia', async () => {
  const forma = async () => (await ex(`select private.executor_bridge_data($1, $2, $3) r`, [hA, ids.r051, ids.l051])).cliente.forma_de_pagamento
  igual(await forma(), null, 'ainda não combinada')
  for (const [escolha, codigo] of [['PIX_UPFRONT', 'a_vista'], ['BOLETO_INSTALLMENTS', '5x_boleto'], ['CARD_INSTALLMENTS', '5x_cartao'], ['END_OF_CASE', 'final_do_processo']]) {
    await salvar(ids.lucas, ids.cli041, { contract_payment_method: escolha })
    igual(await forma(), codigo, escolha)
  }
  await salvar(ids.lucas, ids.cli041, { contract_payment_method: null })
  igual(await forma(), null, 'escolha apagada')
})
await deve('cliente sem pasta ligada: pasta_drive vem vazia', async () => {
  await como(ids.lucas, (tx) => tx.query(`select public.drive_unlink_client_folder($1)`, [ids.cli041]))
  const b = await ex(`select private.executor_bridge_data($1, $2, $3) r`, [hA, ids.r051, ids.l051])
  igual([b.cliente.id, b.pasta_drive], [ids.cli041, null], 'sem pasta')
  await como(ids.lucas, (tx) => tx.query(`select public.drive_link_client_folder($1, $2, 'DG TESTE - JOSE DA SILVA FICTICIO')`, [ids.cli041, F051]))
})
await deve('Porteiro: pendência registrada e depois PORTEIRO_BLOQUEOU fica com o próprio código (não "entrega parcial") e não volta à fila', async () => {
  const payload = JSON.stringify({ summary: 'Porteiro: arquivo suspeito, conferir', data: { description: 'carta.pdf: texto dirigido à IA' } })
  await ex(`select private.executor_create_proposal($1, $2, $3, 'OTHER', $4, 'k-051-porteiro') r`, [hA, ids.r051, ids.l051, payload])
  const f = await ex(`select private.executor_fail($1, $2, $3, 'PORTEIRO_BLOQUEOU', 'Porteiro bloqueou 1 arquivo', true) r`, [hA, ids.r051, ids.l051])
  igual([f.status, f.error_code], ['FAILED', 'PORTEIRO_BLOQUEOU'], 'bloqueado')
  const r = await um(db, `select status, error_code, progress_message from agent_runs where id = $1`, [ids.r051])
  igual([r.status, r.error_code, r.progress_message], ['FAILED', 'PORTEIRO_BLOQUEOU', 'Parado pelo Porteiro'], 'gravado')
})
await deve('SEM_PASTA_NO_DRIVE não volta à fila mesmo com tentar_de_novo; código desconhecido continua recusado', async () => {
  const run = await avulsa040('Ponte: sem pasta'); const l = lease()
  await reservar040(hA, run, l)
  await ex(`select private.executor_fail($1, $2, $3, 'INVENTADO', 'x', false) r`, [hA, run, l]).then(
    () => { throw new Error('código inventado aceito') }, (e) => { if (!/desconhecido/.test(e.message)) throw e })
  const f = await ex(`select private.executor_fail($1, $2, $3, 'SEM_PASTA_NO_DRIVE', 'Cliente sem pasta ligada', true) r`, [hA, run, l])
  igual([f.status, f.error_code], ['FAILED', 'SEM_PASTA_NO_DRIVE'], 'falhou sem voltar')
})
await deve('Drive: arquivo com o mesmo conteúdo de uma versão do cliente vira "conhecido", não importação; de outro cliente, não', async () => {
  const link = (await um(db, `select id from external_folder_links where client_id = $1 and unlinked_at is null`, [ids.cli041])).id
  const m1 = await exW(`select private.drive_match_existing($1, 'arquivoPonte_00001', $2, 'HISCON.pdf', now(), $3) r`, [link, md5('b'), sha64])
  igual(m1.matched, true, 'reconhecido')
  const dono = (await um(db, `select d.client_id from document_versions v join documents d on d.id = v.document_id where v.id = $1`, [m1.document_version_id])).client_id
  igual(dono, ids.cli041, 'versão do mesmo cliente')
  const m2 = await exW(`select private.drive_match_existing($1, 'arquivoPonte_00001', $2, 'HISCON.pdf', now(), $3) r`, [link, md5('b'), sha64])
  igual(m2.matched, true, 'repetir não quebra')
  if (!(await exW(`select private.drive_known_files($1) r`, [link])).imported.includes(`arquivoPonte_00001:${md5('b')}`)) throw new Error('não ficou conhecido')
  igual((await exW(`select private.drive_match_existing($1, 'arquivoPonte_00002', $2, 'novo.pdf', now(), $3) r`, [link, md5('c'), 'e'.repeat(64)])).matched, false, 'conteúdo novo')
  await como(ids.lucas, (tx) => tx.query(`select public.drive_link_client_folder($1, $2, 'OUTRO CLIENTE')`, [ids.cli041b, F051b]))
  const outro = (await um(db, `select id from external_folder_links where client_id = $1 and unlinked_at is null`, [ids.cli041b])).id
  const temIgual = (await um(db, `select count(*)::int n from document_versions v join documents d on d.id = v.document_id where d.client_id = $1 and v.checksum_sha256 = $2`, [ids.cli041b, sha64])).n
  igual((await exW(`select private.drive_match_existing($1, 'arquivoPonte_00003', $2, 'HISCON.pdf', now(), $3) r`, [outro, md5('d'), sha64])).matched, temIgual > 0, 'só o próprio cliente')
  await exW(`select private.drive_match_existing($1, 'arquivoPonte_00004', $2, 'x.pdf', now(), 'nao-e-sha') r`, [link, md5('e')]).then(
    () => { throw new Error('sha inválido aceito') }, (e) => { if (!/inválido/.test(e.message)) throw e })
})
await deve('funções da ponte fixam search_path; só o dg_worker executa', async () => {
  const r = await linhas(db, `select p.proname f, coalesce(array_to_string(p.proconfig, ','), '') cfg,
      has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('service_role', p.oid, 'execute') srv,
      has_function_privilege('authenticated', p.oid, 'execute') usr, has_function_privilege('dg_worker', p.oid, 'execute') wrk
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = any ($1)`, [['executor_bridge_data', 'executor_fail', 'drive_match_existing']])
  igual(r.length, 3, 'funções')
  igual(r.filter((x) => !x.cfg.includes('search_path=') || x.anon || x.srv || x.usr || !x.wrk).map((x) => x.f), [], 'permissões')
})

// ═════════════════════════════ Verificar agora [052] ═════════════════════

secao('Verificar agora: pedido do escritório, atendido por uma Vigia só [052]')
const wake = (uid) => como(uid, async (tx) => (await um(tx, `select public.dg_request_executor_wake() r`)).r)
const wakeStatus = (uid) => como(uid, async (tx) => (await um(tx, `select public.get_executor_wake_status() r`)).r)
const poll = (hash) => ex(`select private.executor_wake_poll($1) r`, [hash])
await como(ids.barbara, (tx) => tx.query(`select public.set_ai_execution_enabled(true)`))
await db.query(`delete from executor_wake_requests`)
await deve('advogado pede; clicar de novo devolve o mesmo pedido (um pendente por vez)', async () => {
  const a = await wake(ids.lucas)
  igual([a.created, a.can_request, a.last.status, a.last.requested_by_name], [true, true, 'PENDING', 'Lucas'], 'pedido')
  const b = await wake(ids.barbara)
  igual([b.created, b.last.id], [false, a.last.id], 'mesmo pedido')
  igual((await um(db, `select count(*)::int n from executor_wake_requests`)).n, 1, 'uma linha')
  ids.w052 = a.last.id
})
await deve('assistente e parceiro não pedem; assistente vê a situação sem poder pedir', async () => {
  for (const u of [ids.ana, ids.almeidaAdm]) {
    await wake(u).then(() => { throw new Error('pedido aceito') }, (e) => { if (!/administrador ou um advogado/.test(e.message)) throw e })
  }
  igual((await wakeStatus(ids.ana)).can_request, false, 'ASSISTANT sem botão')
  await wakeStatus(ids.almeidaAdm).then(() => { throw new Error('parceiro leu') }, (e) => { if (!/equipe interna/.test(e.message)) throw e })
})
await deve('a primeira Vigia que consulta fica com o pedido; a segunda consulta não acorda ninguém', async () => {
  const p = await poll(hA)
  igual(Object.keys(p).sort(), ['execution_enabled', 'newest_job_at', 'wake'], 'só o necessário, sem dado de cliente')
  igual([p.wake, p.execution_enabled], [true, true], 'acordou')
  igual((await poll(hA)).wake, false, 'mesmo pedido não acorda duas vezes')
  const s = await wakeStatus(ids.lucas)
  igual([s.last.id, s.last.status, s.last.attended_by_name, !!s.last.attended_at], [ids.w052, 'ATTENDED', null, true], 'LAWYER sem o nome do computador')
  igual((await wakeStatus(ids.barbara)).last.attended_by_name, 'Computador A', 'ADMIN vê qual computador atendeu')
})
await deve('outro pedido depois de atendido é um pedido novo', async () => {
  const a = await wake(ids.lucas)
  igual([a.created, a.last.status], [true, 'PENDING'], 'novo')
  igual((await poll(hA)).wake, true, 'atendido')
})
await deve('um pendente por escritório também no banco (índice único)', async () => {
  await db.query(`insert into executor_wake_requests (organization_id, requested_by) values ($1, $2)`, [ids.owner, ids.lucas])
  await db.query(`insert into executor_wake_requests (organization_id, requested_by) values ($1, $2)`, [ids.owner, ids.lucas]).then(
    () => { throw new Error('dois pendentes') }, (e) => { if (!/duplicate|unique/.test(e.message)) throw e })
})
await deve('pedido com mais de 10 minutos vence: não acorda ninguém e libera um pedido novo', async () => {
  await db.query(`delete from executor_wake_requests where status <> 'PENDING'`)
  await db.query(`update executor_wake_requests set requested_at = now() - interval '11 minutes' where status = 'PENDING'`)
  igual((await wakeStatus(ids.lucas)).last.status, 'EXPIRED', 'aparece como vencido')
  igual((await poll(hA)).wake, false, 'vencido não acorda')
  igual((await um(db, `select count(*)::int n from executor_wake_requests where status = 'EXPIRED' and expired_at is not null`)).n, 1, 'gravado como vencido')
  igual((await wake(ids.lucas)).created, true, 'pedido novo')
  await poll(hA)
})
await deve('execução desligada: o botão recusa e a Vigia não é acordada (o pedido não é consumido)', async () => {
  await db.query(`insert into executor_wake_requests (organization_id, requested_by) values ($1, $2)`, [ids.owner, ids.lucas])
  await como(ids.barbara, (tx) => tx.query(`select public.set_ai_execution_enabled(false)`))
  try {
    await wake(ids.lucas).then(() => { throw new Error('pedido aceito desligado') }, (e) => { if (!/desligada/.test(e.message)) throw e })
    const p = await poll(hA)
    igual([p.wake, p.execution_enabled], [false, false], 'desligado')
    igual((await um(db, `select count(*)::int n from executor_wake_requests where status = 'PENDING'`)).n, 1, 'pendente intacto')
  } finally {
    await como(ids.barbara, (tx) => tx.query(`select public.set_ai_execution_enabled(true)`))
  }
  igual((await poll(hA)).wake, true, 'religado: atendido')
})
await deve('computador revogado ou token errado não consulta', async () => {
  for (const h of [hB, h040('errado-052')]) {
    await poll(h).then(() => { throw new Error('consultou') }, (e) => { if (!/inválido ou revogado/.test(e.message)) throw e })
  }
})
await deve('fila: a consulta devolve só a hora do trabalho mais novo da fila', async () => {
  const r = await um(db, `select max(created_at) m from agent_runs where status = 'QUEUED' and cancel_requested_at is null`)
  const p = await poll(hA)
  igual(p.newest_job_at === null ? null : new Date(p.newest_job_at).getTime(), r.m === null ? null : new Date(r.m).getTime(), 'hora')
})
await deve('tabela fechada: usuário logado não lê nem grava direto, só pelas funções', async () => {
  await como(ids.barbara, (tx) => tx.query(`select * from executor_wake_requests`)).then(
    () => { throw new Error('leu a tabela') }, (e) => { if (!/permission denied/.test(e.message)) throw e })
  await como(ids.lucas, (tx) => tx.query(`insert into executor_wake_requests (organization_id, requested_by) values ($1, $2)`, [ids.owner, ids.lucas])).then(
    () => { throw new Error('gravou na tabela') }, (e) => { if (!/permission denied/.test(e.message)) throw e })
})
await deve('funções da 052 fixam search_path; tela para authenticated, consulta só para dg_worker', async () => {
  const r = await linhas(db, `select n.nspname || '.' || p.proname f, coalesce(array_to_string(p.proconfig, ','), '') cfg,
      has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('service_role', p.oid, 'execute') srv,
      has_function_privilege('authenticated', p.oid, 'execute') usr, has_function_privilege('dg_worker', p.oid, 'execute') wrk
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.proname = any ($1)`,
  [['executor_wake_expire', 'get_executor_wake_status', 'dg_request_executor_wake', 'executor_wake_poll']])
  igual(r.length, 6, 'funções')
  igual(r.filter((x) => !x.cfg.includes('search_path=') || x.anon || x.srv).map((x) => x.f), [], 'search_path / anon / service_role')
  const esperado = {
    'private.executor_wake_expire': [false, false], 'private.executor_wake_poll': [false, true],
    'private.get_executor_wake_status': [true, false], 'private.dg_request_executor_wake': [true, false],
    'public.get_executor_wake_status': [true, false], 'public.dg_request_executor_wake': [true, false],
  }
  igual(r.filter((x) => JSON.stringify([x.usr, x.wrk]) !== JSON.stringify(esperado[x.f])).map((x) => x.f), [], 'quem executa')
})

// ═════════════════════════════ Forma de pagamento do contrato [055] ══════

secao('Cadastro do cliente: forma de pagamento do contrato de honorários, dado interno [055]')
const forma055 = async (tx, cliente) => (await um(tx, `select contract_payment_method f from client_internal_details where client_id = $1`, [cliente]))?.f
await deve('equipe interna grava a forma de pagamento no cadastro (criação e edição) e lê nos dados internos', async () => {
  ids.cli055 = await salvar(ids.ana, null, {
    kind: 'INDIVIDUAL', document: '999.055.000-01', origin_organization_id: ids.owner, full_name: 'Cliente 055',
    contract_payment_method: 'END_OF_CASE',
  })
  igual(await como(ids.lucas, (tx) => forma055(tx, ids.cli055)), 'END_OF_CASE', 'criação')
  await salvar(ids.lucas, ids.cli055, { contract_payment_method: 'CARD_INSTALLMENTS' })
  igual(await como(ids.ana, (tx) => forma055(tx, ids.cli055)), 'CARD_INSTALLMENTS', 'edição')
})
await deve('PATCH: chave ausente não mexe na forma de pagamento; vazio ou null apaga (ainda não combinado)', async () => {
  await salvar(ids.ana, ids.cli055, { notes: 'combinou o cartão por telefone' })
  igual(await forma055(db, ids.cli055), 'CARD_INSTALLMENTS', 'chave ausente')
  await salvar(ids.ana, ids.cli055, { contract_payment_method: '' })
  igual(await forma055(db, ids.cli055), null, 'vazio')
  await salvar(ids.ana, ids.cli055, { contract_payment_method: 'PIX_UPFRONT' })
  await salvar(ids.ana, ids.cli055, { contract_payment_method: null })
  igual(await forma055(db, ids.cli055), null, 'null')
  igual((await um(db, `select notes from client_internal_details where client_id = $1`, [ids.cli055])).notes, 'combinou o cartão por telefone', 'observações intactas')
})
await deveFalhar('forma de pagamento fora da lista é recusada (o código do gerador não é valor do banco)', () =>
  salvar(ids.ana, ids.cli055, { contract_payment_method: 'a_vista' }), /contract_payment_method_check/)
await deve('parceiro não vê a forma de pagamento: nem nos dados internos, nem no cadastro que ele lê', async () => {
  await salvar(ids.lucas, ids.joao, { contract_payment_method: 'BOLETO_INSTALLMENTS' })
  await como(ids.almeidaAdm, async (tx) => {
    igual((await linhas(tx, `select 1 from client_internal_details where client_id = $1`, [ids.joao])).length, 0, 'dados internos')
    for (const t of ['clients', 'individual_client_details', 'client_directory']) {
      const chave = t === 'individual_client_details' ? 'client_id' : 'id'
      const cols = Object.keys((await um(tx, `select * from ${t} where ${chave} = $1`, [ids.joao])) ?? {})
      if (cols.length === 0) throw new Error(`${t}: parceiro deveria ler o cadastro básico`)
      if (cols.includes('contract_payment_method')) throw new Error(`${t} expõe a forma de pagamento`)
    }
  })
  igual(await forma055(db, ids.joao), 'BOLETO_INSTALLMENTS', 'gravada para a equipe interna')
})
await deveFalhar('parceiro não grava a forma de pagamento', () =>
  salvar(ids.almeidaAdm, ids.joao, { contract_payment_method: 'PIX_UPFRONT' }), /só altera contato e endereço/)

// ═════════════════════════════ Sequência automática [056] ════════════════

secao('Sequência automática: análise aprovada → próximos agentes do caso, na ordem [056]')
// Agentes e modelos próprios (o kit saiu de cena no começo do arquivo).
const agente056 = async (slug, status = 'ACTIVE') => {
  const a = await um(db, `insert into agents (slug, name, status) values ($1, $2, 'DRAFT') returning id`, [slug, `Agente ${slug}`])
  const v = await um(db, `insert into agent_versions (agent_id, instructions, configuration) values ($1, 'Teste 056', '{}') returning id`, [a.id])
  await db.query(`update agents set current_version_id = $2, status = $3 where id = $1`, [a.id, v.id, status])
  return a.id
}
const modelo056 = async (nome, proximos = [], pedidos = {}) => (await um(db,
  `insert into analysis_templates (legal_area_id, name, primary_agent_id, next_agent_ids, next_agent_requests)
   values ($1, $2, $3, $4, $5) returning id`, [ids.banking, nome, ids.clara056, proximos, JSON.stringify(pedidos)])).id
// Análise enviada, reservada e entregue: a revisão do RESULTADO fica pendente.
const analise056 = async (modelo) => {
  const r = await iniciar(ids.lucas, randomUUID(), ids.casoA, modelo, {}, true, 'Analise o HISCON')
  await reservar039(r.agent_run_id, 'worker-056')
  const e = await entregarAnalise(r.agent_run_id, 'worker-056', 'Resumo da análise 056', resultado039)
  return { analise: r.analysis_id, revisao: e.review_id, resultado: e.result_id }
}
const sequencia056 = (resultado) => linhas(db, `select r.agent_id, r.requested_by, r.legal_case_id, r.operation, r.status, i.request_text, i.parameters
    from agent_runs r join agent_run_inputs i on i.agent_run_id = r.id
   where i.parameters ->> 'legal_analysis_result_id' = $1 order by r.queue_msg_id`, [resultado])
const atividade056 = (resultado) => linhas(db, `select action, metadata from audit_events
   where entity_type = 'legal_cases' and entity_id = $1 and action like 'AUTO_SEQUENCE_%'
     and metadata ->> 'legal_analysis_result_id' = $2 order by created_at, (metadata ->> 'position')::int`, [ids.casoA, resultado])
ids.clara056 = await agente056('clara-056')
ids.lucas056 = await agente056('lucas-056')
ids.alice056 = await agente056('alice-056')
ids.pausado056 = await agente056('pausado-056', 'INACTIVE')
const pedidos056 = {
  [ids.lucas056]: 'Gerar o kit do cliente (procuração, declaração de hipossuficiência e contrato de honorários).',
  [ids.alice056]: 'Redigir as petições iniciais da primeira rodada a partir do roteiro da Clara na pasta do cliente. A segunda rodada não está autorizada neste pedido.',
}
await deve('modelo novo nasce sem sequência (lista e pedidos vazios)', async () => {
  const t = await um(db, `insert into analysis_templates (legal_area_id, name) values ($1, 'Modelo 056 vazio') returning next_agent_ids, next_agent_requests`, [ids.banking])
  igual([t.next_agent_ids, t.next_agent_requests], [[], {}], 'padrão')
})
await deveFalhar('sequência com agente que não existe é recusada', () =>
  modelo056('Modelo 056 inválido', [randomUUID()]), /só aceita agentes cadastrados/)
await deveFalhar('sequência com agente excluído é recusada', async () => {
  const x = await agente056('excluido-056')
  await db.query(`update agents set deleted_at = now() where id = $1`, [x])
  await modelo056('Modelo 056 excluído', [x])
}, /só aceita agentes cadastrados/)
await deveFalhar('o mesmo agente duas vezes é recusado', () =>
  modelo056('Modelo 056 repetido', [ids.lucas056, ids.lucas056]), /duas vezes/)
await deveFalhar('pedido para agente que não está na lista é recusado', () =>
  modelo056('Modelo 056 pedido solto', [ids.lucas056], { [ids.alice056]: 'x' }), /não está na lista/)
await deveFalhar('pedido vazio é recusado', () =>
  modelo056('Modelo 056 pedido vazio', [ids.lucas056], { [ids.lucas056]: '  ' }), /1 a 4000/)
await deveFalhar('LAWYER não muda a sequência (só ADMIN edita modelo)', () =>
  como(ids.lucas, async (tx) => {
    const r = await tx.query(`update analysis_templates set next_agent_ids = $1 where name = 'Modelo 056 vazio'`, [[ids.lucas056]])
    if (r.affectedRows === 0) throw new Error('nenhuma linha (RLS)')
  }), /nenhuma linha|permission denied/)

await deve('aprovar a revisão da análise enfileira Lucas e depois Alice, no mesmo caso, em nome de quem aprovou', async () => {
  ids.tpl056 = await modelo056('Modelo 056', [ids.lucas056, ids.alice056], pedidos056)
  const a = await analise056(ids.tpl056)
  ids.a056 = a
  igual((await sequencia056(a.resultado)).length, 0, 'nada antes da aprovação')
  await decidir(ids.lucas, a.revisao, 'APPROVE')
  igual((await um(db, `select status from reviews where id = $1`, [a.revisao])).status, 'APPROVED', 'aprovada')
  igual((await um(db, `select status from legal_analyses where id = $1`, [a.analise])).status, 'COMPLETED', 'análise concluída')
  const s = await sequencia056(a.resultado)
  igual(s.map((r) => [r.agent_id, r.requested_by, r.legal_case_id, r.operation, r.status]),
    [[ids.lucas056, ids.lucas, ids.casoA, 'EXECUTE', 'QUEUED'], [ids.alice056, ids.lucas, ids.casoA, 'EXECUTE', 'QUEUED']], 'na ordem')
  igual(s.map((r) => r.request_text), [
    'Sequência automática depois da análise aprovada: ' + pedidos056[ids.lucas056],
    'Sequência automática depois da análise aprovada: ' + pedidos056[ids.alice056]], 'pedidos')
  igual(s.map((r) => [r.parameters.sequencia_automatica, r.parameters.review_id, r.parameters.posicao]),
    [['true', a.revisao, '1'], ['true', a.revisao, '2']], 'parâmetros')
  const f = await um(db, `select count(*)::int n from pgmq.q_agent_execution q join agent_run_inputs i on (i.agent_run_id)::text = q.message ->> 'agent_run_id'
    where i.parameters ->> 'legal_analysis_result_id' = $1`, [a.resultado])
  igual(f.n, 2, 'duas mensagens na fila')
  igual((await atividade056(a.resultado)).map((e) => [e.action, e.metadata.agent_id]),
    [['AUTO_SEQUENCE_QUEUED', ids.lucas056], ['AUTO_SEQUENCE_QUEUED', ids.alice056]], 'atividade do caso')
})
await deve('reabrir e aprovar de novo (outra pessoa) não duplica as execuções', async () => {
  await decidir(ids.barbara, ids.a056.revisao, 'REOPEN')
  await decidir(ids.barbara, ids.a056.revisao, 'APPROVE')
  const s = await sequencia056(ids.a056.resultado)
  igual(s.map((r) => [r.agent_id, r.requested_by]), [[ids.lucas056, ids.lucas], [ids.alice056, ids.lucas]], 'as mesmas duas')
  igual((await atividade056(ids.a056.resultado)).length, 2, 'sem registro novo')
})
await deve('agente pausado não entra (fica registrado na atividade); os outros seguem e a aprovação vale', async () => {
  const tpl = await modelo056('Modelo 056 pausado', [ids.pausado056, ids.alice056])
  const a = await analise056(tpl)
  await decidir(ids.lucas, a.revisao, 'APPROVE')
  igual((await um(db, `select status from reviews where id = $1`, [a.revisao])).status, 'APPROVED', 'aprovada')
  const s = await sequencia056(a.resultado)
  igual(s.map((r) => r.agent_id), [ids.alice056], 'só a Alice')
  if (!s[0].request_text.startsWith('Sequência automática depois da análise aprovada: ')) throw new Error('pedido genérico sem o prefixo')
  igual((await atividade056(a.resultado)).map((e) => [e.action, e.metadata.agent_id, e.metadata.reason ?? null]),
    [['AUTO_SEQUENCE_SKIPPED', ids.pausado056, 'Agente pausado (INACTIVE)'], ['AUTO_SEQUENCE_QUEUED', ids.alice056, null]], 'atividade')
})
await deve('rejeitar ou pedir alterações não enfileira ninguém', async () => {
  const a = await analise056(ids.tpl056)
  await decidir(ids.lucas, a.revisao, 'REJECT', 'Extrato de outro cliente.')
  igual((await sequencia056(a.resultado)).length, 0, 'rejeitada')
  const b = await analise056(ids.tpl056)
  await decidir(ids.lucas, b.revisao, 'REQUEST_CHANGES', 'Faltou o bloco D.')
  igual((await sequencia056(b.resultado)).length, 0, 'alterações pedidas')
})
await deve('modelo sem sequência: aprovar funciona como antes, nenhuma execução nova', async () => {
  const tpl = await modelo056('Modelo 056 sem sequência')
  const a = await analise056(tpl)
  const antes = (await um(db, `select count(*)::int n from agent_runs`)).n
  await decidir(ids.lucas, a.revisao, 'APPROVE')
  igual((await um(db, `select status from legal_analyses where id = $1`, [a.analise])).status, 'COMPLETED', 'análise concluída')
  igual((await um(db, `select count(*)::int n from agent_runs`)).n, antes, 'execuções')
  igual((await atividade056(a.resultado)).length, 0, 'atividade')
})
await deve('fila fora do ar: a aprovação vale mesmo assim; a falha fica na atividade do caso e avisa o ADMIN', async () => {
  const a = await analise056(ids.tpl056)
  await db.query(`alter table pgmq.q_agent_execution rename to q_agent_execution_fora_056`)
  try {
    await decidir(ids.lucas, a.revisao, 'APPROVE')
  } finally {
    await db.query(`alter table pgmq.q_agent_execution_fora_056 rename to q_agent_execution`)
  }
  igual((await um(db, `select status from reviews where id = $1`, [a.revisao])).status, 'APPROVED', 'aprovada')
  igual((await um(db, `select status from legal_analyses where id = $1`, [a.analise])).status, 'COMPLETED', 'análise concluída')
  igual((await sequencia056(a.resultado)).length, 0, 'nenhuma execução pela metade')
  const ev = await atividade056(a.resultado)
  igual(ev.map((e) => [e.action, e.metadata.agent_id]), [['AUTO_SEQUENCE_FAILED', ids.lucas056], ['AUTO_SEQUENCE_FAILED', ids.alice056]], 'falhas registradas')
  if (!ev.every((e) => typeof e.metadata.error === 'string' && e.metadata.error.length > 0)) throw new Error('falha sem o motivo')
  const n = await linhas(db, `select user_id from notifications where type = 'AGENT_RUN_ATTENTION' and event_key like $1`, [`auto-sequence-failed:${a.resultado}:%`])
  igual([n.length, n.every((x) => x.user_id === ids.barbara)], [2, true], 'aviso ao ADMIN (quem aprovou não se avisa)')
  // Com a fila de volta, reabrir e aprovar enfileira o que faltou.
  await decidir(ids.lucas, a.revisao, 'REOPEN')
  await decidir(ids.lucas, a.revisao, 'APPROVE')
  igual((await sequencia056(a.resultado)).map((r) => r.agent_id), [ids.lucas056, ids.alice056], 'recuperado')
})
await deve('funções da 056 fixam search_path e ninguém as chama de fora (só o gatilho)', async () => {
  const r = await linhas(db, `select p.proname f, coalesce(array_to_string(p.proconfig, ','), '') cfg, p.prosecdef d,
      has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') usr,
      has_function_privilege('service_role', p.oid, 'execute') srv, has_function_privilege('dg_worker', p.oid, 'execute') wrk
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = any ($1)`,
  [['analysis_templates_validate_sequence', 'analysis_sequence_enqueue', 'reviews_analysis_sequence']])
  igual(r.length, 3, 'funções')
  igual(r.filter((x) => !x.cfg.includes('search_path=') || !x.d || x.anon || x.usr || x.srv || x.wrk).map((x) => x.f), [], 'permissões')
})

secao('Aviso da busca judicial no máximo duas vezes por dia; limpeza do histórico do agendador [057]')

const avisos057 = async (chave) => (await um(db, `select count(*)::int n from notifications where type = 'JUDICIAL_SYNC_FAILED' and event_key = $1`, [chave])).n
const rodada057 = async (situacao, erro = null) => {
  await db.query(`update judicial_sync_runs set status = 'FAILED', finished_at = now() where status = 'RUNNING'`)
  const r = await worker043(`select private.judicial_sync_begin('MANUAL', $1) r`, [ids.barbara])
  if (!r.run_id) throw new Error('rodada não abriu: ' + JSON.stringify(r))
  await worker043(`select private.judicial_sync_finish($1, $2, '{}', $3) r`, [r.run_id, situacao, erro])
  return r.run_id
}
await deve('outra rodada com falha no mesmo período do dia não repete o aviso', async () => {
  const chave = await chaveJsync057()
  await rodada057('PARTIAL', 'DataJud: DataJud não respondeu (tempo esgotado)')
  const antes = await avisos057(chave)
  if (antes < 1) throw new Error('a primeira falha do período deveria avisar')
  const run = await rodada057('FAILED', 'DataJud: DataJud respondeu HTTP 429')
  await rodada057('PARTIAL', 'de novo')
  igual(await avisos057(chave), antes, 'sem aviso novo')
  igual((await um(db, `select count(*)::int n from notifications where event_key = $1`, ['jsync:' + run])).n, 0, 'a chave não é mais a rodada')
  const r = await um(db, `select status, error from judicial_sync_runs where id = $1`, [run])
  igual([r.status, r.error], ['FAILED', 'DataJud: DataJud respondeu HTTP 429'], 'a rodada continua registrada')
})
await deve('no período seguinte a falha avisa de novo (dois períodos por dia = no máximo dois avisos por pessoa)', async () => {
  const chave = await chaveJsync057()
  igual(/^jsync:\d{4}-\d{2}-\d{2}:(am|pm)$/.test(chave), true, 'formato da chave')
  const antes = await avisos057(chave)
  // Simula a virada do período: os avisos já dados passam a ser de um período anterior.
  await db.query(`update notifications set event_key = 'jsync:2000-01-01:am:' || id where event_key = $1`, [chave])
  await rodada057('PARTIAL', 'falha da tarde')
  igual(await avisos057(chave), antes, 'um aviso por ADMIN no período novo')
  const m = await um(db, `select message from notifications where event_key = $1 and user_id = $2`, [chave, ids.barbara])
  igual(m.message, 'falha da tarde', 'mensagem da primeira falha do período')
})
await deve('rodada concluída sem falha não avisa', async () => {
  const chave = await chaveJsync057()
  await db.query(`delete from notifications where event_key = $1`, [chave])
  await rodada057('COMPLETED')
  igual(await avisos057(chave), 0, 'sem aviso')
})
await deve('limpeza do histórico do agendador: apaga o que passou do prazo, inclusive execução sem horário; o recente fica', async () => {
  await db.query(`delete from cron.job_run_details`)
  await db.query(`insert into cron.job_run_details (jobid, status, start_time, end_time) values
    (1, 'succeeded', now() - interval '10 days', now() - interval '10 days'),
    (1, 'failed',    null,                       null),
    (1, 'succeeded', now() - interval '8 days',  now() - interval '8 days'),
    (1, 'failed',    null,                       null),
    (1, 'succeeded', now() - interval '2 days',  now() - interval '2 days'),
    (1, 'running',   now(),                      null)`)
  igual((await um(db, `select private.cron_history_housekeeping() n`)).n, 3, 'apagadas')
  igual((await linhas(db, `select status from cron.job_run_details order by runid`)).map((x) => x.status), ['failed', 'succeeded', 'running'], 'ficaram')
  igual((await um(db, `select private.cron_history_housekeeping() n`)).n, 0, 'nada a apagar')
  igual((await um(db, `select private.cron_history_housekeeping(interval '1 day') n`)).n, 2, 'prazo menor')
})
await deveFalhar('limpeza do histórico não aceita guardar menos de 1 dia', () => db.query(`select private.cron_history_housekeeping(interval '1 hour')`), /pelo menos 1 dia/)
await deve('limpeza do histórico não é chamável por usuário, backend nem worker', async () => {
  const r = await um(db, `select has_function_privilege('authenticated', 'private.cron_history_housekeeping(interval)', 'execute') a,
    has_function_privilege('service_role', 'private.cron_history_housekeeping(interval)', 'execute') s,
    has_function_privilege('dg_worker', 'private.cron_history_housekeeping(interval)', 'execute') w`)
  igual([r.a, r.s, r.w], [false, false, false], 'sem execute')
})

// ═════════════════════════════ Processo para os agentes [058] ════════════

secao('Processo para os agentes: publicações do DJEN só do processo do caso do trabalho; agente de prazos no kit [058]')
const p058 = {}
// CNJs fictícios (TJRJ, 8.19, origem 0999) para os cenários da 058.
const cnj058 = (n) => cnj(5800 + n, '2026', '8', '19', '0999')
const pub058 = (proc, cnjN, n, dia, teor, cancelada = false) => db.query(
  `insert into judicial_publications (external_id, legal_process_id, cnj_number, court, organ, communication_type, available_on, content, link, cancelled_at, cancel_reason)
   values ($1, $2, $3, 'TJRJ', '1ª Vara Cível Fictícia', 'Intimação', $4, $5, $6, case when $7 then now() end, case when $7 then 'Publicada por engano' end)`,
  [String(58000 + n), proc, cnjN, dia, teor, `https://comunica.pje.jus.br/x/${58000 + n}`, cancelada])
const processo058 = (proc) => ex(`select private.executor_get_process($1, $2, $3, $4) r`, [hA, p058.run, p058.reserva, proc])
await deve('cenário: caso com dois processos com CNJ e um sem; 12 publicações no primeiro (uma longa, uma cancelada), 1 no segundo', async () => {
  // Outro caso da MESMA cliente do cenário da 043: as publicações de lá não podem aparecer aqui.
  const cli = (await um(db, `select client_id from legal_cases where id = $1`, [j043.caso])).client_id
  p058.caso = (await um(db, `insert into legal_cases (client_id, legal_area_id, title, status, origin_organization_id, created_by_organization_id, assigned_lawyer_id)
    values ($1, $2, 'Caso fictício 058', 'IN_PROGRESS', $3, $3, $4) returning id`, [cli, ids.banking, ids.owner, ids.lucas])).id
  p058.proc = (await um(db, `insert into legal_processes (legal_case_id, cnj_number, title, court, legal_class) values ($1, $2, 'Fictícia x Banco Fictício', 'TJRJ', 'Procedimento Comum Cível') returning id`,
    [p058.caso, cnj058(1)])).id
  p058.proc2 = (await um(db, `insert into legal_processes (legal_case_id, cnj_number, title) values ($1, $2, 'Fictícia x Outro Banco Fictício') returning id`, [p058.caso, cnj058(2)])).id
  p058.semCnj = (await um(db, `insert into legal_processes (legal_case_id, title) values ($1, 'Em preparação') returning id`, [p058.caso])).id
  await db.query(`insert into process_parties (legal_process_id, party_type, name) values ($1, 'DEFENDANT', 'Banco Fictício S.A.')`, [p058.proc])
  await db.query(`insert into process_events (legal_process_id, event_type, title, description, occurred_at, source)
    values ($1, 'MOVEMENT', 'Conclusos para despacho', 'Conclusos para despacho', '2026-10-05T10:00:00-03:00', 'JUDICIAL_INTEGRATION')`, [p058.proc])
  // Disponibilizadas de 01/10 a 12/10/2026: a de 12/10 é longa; a de 11/10 foi cancelada pelo tribunal.
  for (let n = 1; n <= 12; n++) {
    const teor = n === 12 ? `INICIO-058 ${'x'.repeat(7000)} FIM-058` : n === 11 ? 'TEOR-DA-CANCELADA-058' : `Teor fictício 058 nº ${n}`
    await pub058(p058.proc, cnj058(1), n, `2026-10-${String(n).padStart(2, '0')}`, teor, n === 11)
  }
  await pub058(p058.proc2, cnj058(2), 20, '2026-10-08', 'PUBLICACAO-DO-OUTRO-PROCESSO-058')
  p058.run = (await como(ids.lucas, (tx) => um(tx, `select public.request_agent_run_once($1, $2, $3, $4, 'Conferir o prazo da publicação', '{}', 'EXECUTE') r`,
    [randomUUID(), ids.agente, p058.caso, p058.proc]))).r.run_id
  p058.reserva = lease()
  igual((await reservar040(hA, p058.run, p058.reserva)).claimed, true, 'trabalho reservado pelo computador do escritório')
})
await deve('publicações do processo: da mais nova para a mais antiga, no máximo 10, com as datas, o tipo, o órgão, o link e o teor', async () => {
  const r = await processo058(p058.proc)
  igual(r.publicacoes.map((x) => x.disponibilizada_em),
    ['2026-10-12', '2026-10-11', '2026-10-10', '2026-10-09', '2026-10-08', '2026-10-07', '2026-10-06', '2026-10-05', '2026-10-04', '2026-10-03'], 'as 10 mais novas, em ordem')
  const p9 = r.publicacoes[3]
  igual(Object.keys(p9).sort(), ['cancelada', 'disponibilizada_em', 'link', 'orgao', 'publicada_em', 'teor', 'teor_cortado', 'tipo'], 'campos')
  // Disponibilizada na sexta 09/10; segunda 12/10 é feriado nacional: a publicação é na terça 13/10.
  igual([p9.publicada_em, p9.tipo, p9.orgao, p9.link, p9.teor, p9.teor_cortado, p9.cancelada],
    ['2026-10-13', 'Intimação', '1ª Vara Cível Fictícia', 'https://comunica.pje.jus.br/x/58009', 'Teor fictício 058 nº 9', false, false], 'publicação comum')
  const txt = JSON.stringify(r.publicacoes)
  igual([txt.includes('nº 1"'), txt.includes('nº 2"')], [false, false], 'as duas mais antigas ficam de fora')
})
await deve('teor longo sai cortado em 6.000 caracteres, com o indicador', async () => {
  const p = (await processo058(p058.proc)).publicacoes[0]
  igual([p.teor.length, p.teor.startsWith('INICIO-058 '), p.teor.includes('FIM-058'), p.teor_cortado, p.cancelada], [6000, true, false, true, false], 'cortado')
})
await deve('publicação cancelada: só a informação de que foi cancelada, sem o teor', async () => {
  const r = await processo058(p058.proc)
  const p = r.publicacoes[1]
  igual([p.disponibilizada_em, p.cancelada, p.teor, p.teor_cortado], ['2026-10-11', true, null, false], 'cancelada')
  igual(JSON.stringify(r.publicacoes).includes('TEOR-DA-CANCELADA-058'), false, 'teor da cancelada não sai')
  igual(r.publicacoes.filter((x) => x.cancelada).length, 1, 'só ela')
})
await deve('só as publicações DAQUELE processo: o outro processo do mesmo caso tem as suas; processo sem publicação, lista vazia', async () => {
  igual(JSON.stringify(await processo058(p058.proc)).includes('PUBLICACAO-DO-OUTRO-PROCESSO-058'), false, 'não mistura processos')
  const outro = await processo058(p058.proc2)
  igual(outro.publicacoes.map((x) => [x.disponibilizada_em, x.teor]), [['2026-10-08', 'PUBLICACAO-DO-OUTRO-PROCESSO-058']], 'o outro processo')
  igual((await processo058(p058.semCnj)).publicacoes, [], 'sem publicação')
})
await deve('nunca de outro caso: processo de outro caso (mesmo da mesma cliente) não é entregue, pela porta do computador nem pela do worker', async () => {
  igual((await um(db, `select count(*)::int n from judicial_publications where legal_process_id = $1`, [j043.proc])).n > 0, true, 'o outro caso tem publicações')
  igual(await processo058(j043.proc), null, 'porta do computador do escritório')
  const por = (await um(db, `select claimed_by from agent_runs where id = $1`, [p058.run])).claimed_by
  await comoWorker(async (tx) => {
    igual((await um(tx, `select private.worker_get_process($1, $2, $3) p`, [p058.run, por, j043.proc])).p, null, 'porta do worker')
    igual((await um(tx, `select private.worker_get_process($1, $2, $3) p`, [p058.run, por, p058.proc])).p.publicacoes.length, 10, 'worker: o processo do caso, com as publicações')
  })
  await comoWorker((tx) => tx.query(`select private.worker_get_process($1, 'outro-worker', $2)`, [p058.run, p058.proc])).then(
    () => { throw new Error('worker que não reservou leu') }, (e) => { if (!/não está reservada por este worker/.test(e.message)) throw e })
  igual(JSON.stringify(await processo058(p058.proc)).includes('(910001)'), false, 'nada do outro caso')
  await ex(`select private.executor_get_process($1, $2, $3, $4) r`, [hB, p058.run, p058.reserva, p058.proc]).then(
    () => { throw new Error('outro computador leu') }, (e) => { if (!/não está reservado|inválido ou revogado/.test(e.message)) throw e })
})
await deve('o resto do processo sai como antes (dados, partes e movimentações)', async () => {
  const r = await processo058(p058.proc)
  igual(Object.keys(r).sort(), ['case_value', 'client_side', 'cnj_number', 'court', 'court_unit', 'distribution_date', 'district', 'id', 'legal_case_id',
    'legal_class', 'movimentacoes', 'partes', 'publicacoes', 'state', 'status', 'subject'], 'campos')
  igual([r.id, r.legal_case_id, r.cnj_number, r.court, r.legal_class], [p058.proc, p058.caso, cnj058(1), 'TJRJ', 'Procedimento Comum Cível'], 'dados')
  igual(r.partes.map((x) => [x.tipo, x.nome]), [['DEFENDANT', 'Banco Fictício S.A.']], 'partes')
  igual(r.movimentacoes.map((m) => [m.event_type, m.description, m.source]), [['MOVEMENT', 'Conclusos para despacho', 'JUDICIAL_INTEGRATION']], 'movimentações')
})
await deve('worker_get_process continua uma função só, com search_path fixo e só para o dg_worker', async () => {
  const r = await linhas(db, `select p.proname f, coalesce(array_to_string(p.proconfig, ','), '') cfg, p.prosecdef def,
      has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('service_role', p.oid, 'execute') srv,
      has_function_privilege('authenticated', p.oid, 'execute') usr, has_function_privilege('dg_worker', p.oid, 'execute') wrk
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = any ($1) order by 1`, [['worker_get_process', 'executor_get_process']])
  igual(r.map((x) => x.f), ['executor_get_process', 'worker_get_process'], 'sem versão duplicada')
  igual(r.filter((x) => !x.cfg.includes('search_path=') || !x.def || x.anon || x.srv || x.usr || !x.wrk).map((x) => x.f), [], 'permissões')
})
await deve('pedido de prazo ao agente: logo depois do tipo, quem é o nosso cliente, o polo dele e a parte contrária (do cadastro do processo)', async () => {
  await db.query(`update judicial_settings set deadline_agent_id = $1 where id`, [ids.agente])
  const pub = (await um(db, `select id from judicial_publications where external_id = '58009'`)).id
  const pedido = async (polo, contraria) => {
    await db.query(`update legal_processes set client_side = $2, adverse_party_summary = $3 where id = $1`, [p058.proc, polo, contraria])
    const run = (await um(db, `select private.judicial_request_deadline_proposal($1) r`, [pub])).r
    if (!run) throw new Error(`agente não acionado: ${(await um(db, `select agent_error e from judicial_publications where id = $1`, [pub])).e}`)
    return (await um(db, `select request_text t from agent_run_inputs where agent_run_id = $1`, [run])).t
  }
  const ativo = await pedido('ACTIVE', 'Banco Fictício S.A.\n(e outro)')
  igual(ativo.includes('. Tipo: Intimação.\nNosso cliente: Odete Integração · polo ativo (do cadastro do processo)\nParte contrária: Banco Fictício S.A. (e outro)\n\nO QUE FAZER: '),
    true, 'cliente, polo e parte contrária, uma linha cada')
  igual((await pedido('PASSIVE', 'Banco Fictício S.A.')).includes('\nNosso cliente: Odete Integração · polo passivo (do cadastro do processo)\nParte contrária: Banco Fictício S.A.\n'), true, 'polo passivo')
  igual((await pedido('THIRD_PARTY', null)).includes('\nNosso cliente: Odete Integração · polo terceiro (do cadastro do processo)\n\nO QUE FAZER: '), true, 'terceiro, sem parte contrária')
  const vazio = await pedido(null, '   ')
  igual([vazio.includes('\nNosso cliente: Odete Integração · polo não informado (do cadastro do processo)\n\nO QUE FAZER: '), vazio.includes('Parte contrária')],
    [true, false], 'processo sem polo nem parte contrária no cadastro')
  // O resto do pedido continua como na 043: datas, contagem, link e teor.
  igual([ativo.startsWith(`Publicação do DJEN no processo ${cnj058(1).slice(0, 7)}-`), ativo.includes('disponibilizada em 09/10/2026, publicada em 13/10/2026'),
    ativo.includes('dia 1: 14/10/2026'), ativo.includes('\n\nÍntegra: https://comunica.pje.jus.br/x/58009\n\nTEOR:\nTeor fictício 058 nº 9')], [true, true, true, true], 'resto do pedido')
  await db.query(`update judicial_settings set deadline_agent_id = null where id`)
})
const rodar058 = async () => db.exec(await readFile(new URL('migrations/20261113000058_processo_para_agentes.sql', raiz), 'utf8'))
const prazos058 = async () => (await um(db, `select deadline_agent_id id from judicial_settings where id`)).id
await deve('integração judicial que já tem agente escolhido não muda (a migration, rodada de novo, só recadastra a Diana que faltava)', async () => {
  igual((await um(db, `select count(*)::int n from agents where slug = $1`, [KIT058])).n, 0, 'a Diana saiu de cena lá em cima')
  await db.query(`update judicial_settings set deadline_agent_id = $1 where id`, [ids.agente])
  await rodar058()
  igual(await prazos058(), ids.agente, 'continua o agente escolhido')
  igual((await um(db, `select status from agents where slug = $1`, [KIT058])).status, 'ACTIVE', 'Diana cadastrada')
})
await deve('rodar de novo não duplica a Diana nem mexe no que o escritório editou; integração sem agente passa a apontar para ela', async () => {
  await db.query(`update agents set name = 'Diana editada no site' where slug = $1`, [KIT058])
  await db.query(`update judicial_settings set deadline_agent_id = null where id`)
  await rodar058()
  const a = await um(db, `select count(*)::int n, max(name) nome, (array_agg(id))[1] id from agents where slug = $1`, [KIT058])
  igual([a.n, a.nome], [1, 'Diana editada no site'], 'sem duplicar, sem sobrescrever')
  igual((await um(db, `select count(*)::int n from agent_versions where agent_id = $1`, [a.id])).n, 1, 'uma versão')
  igual(await prazos058(), a.id, 'aponta para a Diana')
})
await deve('Diana pausada no site: a integração sem agente continua sem agente', async () => {
  await db.query(`update judicial_settings set deadline_agent_id = null where id`)
  await db.query(`update agents set status = 'INACTIVE' where slug = $1`, [KIT058])
  await rodar058()
  igual(await prazos058(), null, 'não aponta para agente pausado')
  // O kit sai de cena de novo, como no começo do arquivo.
  await db.query(`update agents set slug = slug || '-kit058', deleted_at = now() where slug = $1`, [KIT058])
})

// ═════════════════════════════ Prazo direto [059] ════════════════════════

secao('Prazo direto: o prazo do agente de prazos entra na agenda sem passar por Revisões [059]')
const d059 = {}
// CNJs fictícios (TJRJ, 8.19, origem 0999) para os cenários da 059.
const cnj059 = (n) => cnj(5900 + n, '2026', '8', '19', '0999')
// As datas são relativas a hoje (Brasília): a regra recusa vencimento no passado.
const dia059 = async (desloc = 0) => (await um(db, `select to_char((now() at time zone 'America/Sao_Paulo')::date + $1::int, 'YYYY-MM-DD') d`, [desloc])).d
const mais059 = (dia, n) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const br059 = (dia) => dia.split('-').reverse().join('/')
const fim059 = (dia) => `${dia}T23:59:00-03:00`
const sabado059 = (dias) => {
  for (let d = dias[0]; d < dias[dias.length - 1]; d = mais059(d, 1)) if (new Date(`${d}T12:00:00Z`).getUTCDay() === 6) return d
  throw new Error('lista sem sábado no meio')
}
// As verificações da 058 rodaram a 058 de novo (e ela redefine o pedido ao agente): a 059 vem depois dela, como no banco de verdade.
const rodar059 = async () => db.exec(await readFile(new URL('migrations/20261113000059_prazo_direto.sql', raiz), 'utf8'))
let seq059 = 0
// Publicação nova → trabalho do agente de prazos (o mesmo pedido que a busca do DJEN faz) → reservado pelo computador do escritório.
async function trabalho059(proc, cnjN, disponibilizadaEm) {
  const n = 59000 + ++seq059
  const pub = (await um(db, `insert into judicial_publications (external_id, legal_process_id, cnj_number, court, organ, communication_type, available_on, content, link)
    values ($1, $2, $3, 'TJRJ', '1ª Vara Cível Fictícia', 'Intimação', $4, $5, $6) returning id`,
    [String(n), proc, cnjN, disponibilizadaEm, `Fica a parte autora intimada para réplica em 15 dias. (${n})`, `https://comunica.pje.jus.br/x/${n}`])).id
  const run = (await um(db, `select private.judicial_request_deadline_proposal($1) r`, [pub])).r
  if (!run) throw new Error(`agente não acionado: ${(await um(db, `select agent_error e from judicial_publications where id = $1`, [pub])).e}`)
  const reserva = lease()
  igual((await reservar040(hA, run, reserva)).claimed, true, 'trabalho reservado pelo computador do escritório')
  const i = await um(db, `select parameters p, request_text t from agent_run_inputs where agent_run_id = $1`, [run])
  return { pub, run, reserva, proc, dias: i.p.business_days, pedido: i.t }
}
const propor059 = (t, tipo, payload, chave) =>
  ex(`select private.executor_create_proposal($1, $2, $3, $4, $5, $6) r`, [hA, t.run, t.reserva, tipo, JSON.stringify(payload), chave])
const prazo059 = (dia, extra = {}) => ({ summary: 'Prazo de 15 dias úteis para réplica',
  data: { title: 'Réplica à contestação', due_at: fim059(dia), description: 'CPC, art. 350: 15 dias úteis contados da publicação.', priority: 'HIGH', ...extra } })
const proposta059 = (id) => um(db, `select p.status, p.requires_human_review rev, p.applied_entity_type ent, p.applied_entity_id prazo,
    (select rv.status from reviews rv where rv.agent_proposal_id = p.id) revisao, (select rv.id from reviews rv where rv.agent_proposal_id = p.id) revisao_id
  from agent_proposals p where p.id = $1`, [id])
const publicacao059 = (t) => um(db, `select triage_status st, triage_outcome res, deadline_id prazo, triaged_by por, triage_notes nota from judicial_publications where id = $1`, [t.pub])
const prazos059 = async (proc) => (await um(db, `select count(*)::int n from deadlines where legal_process_id = $1`, [proc])).n
const motivos059 = async (t) => (await linhas(db, `select message m from agent_run_events where agent_run_id = $1 and message like 'Prazo não entrou direto na agenda (foi para Revisões): %' order by id`, [t.run])).map((x) => x.m)
// Caminho antigo: proposta PENDING exigindo revisão, revisão PENDING em Revisões, nenhum prazo novo, o computador sabe que não foi aplicada.
async function caminhoAntigo059(t, r, prazosAntes, rotulo) {
  const p = await proposta059(r.proposal_id)
  igual([r.created, r.applied, p.status, p.rev, p.revisao, p.prazo], [true, false, 'PENDING', true, 'PENDING', null], `${rotulo}: proposta em Revisões`)
  igual(await prazos059(t.proc), prazosAntes, `${rotulo}: nenhum prazo criado`)
  return p
}

await deve('cenário: caso do escritório (advogado: Lucas) com dois processos — um com responsável (Barbara), outro sem; a integração usa o agente do cenário, com o prazo direto ligado', async () => {
  const cli = (await um(db, `select client_id from legal_cases where id = $1`, [j043.caso])).client_id
  d059.caso = (await um(db, `insert into legal_cases (client_id, legal_area_id, title, status, origin_organization_id, created_by_organization_id, assigned_lawyer_id)
    values ($1, $2, 'Caso fictício 059', 'IN_PROGRESS', $3, $3, $4) returning id`, [cli, ids.banking, ids.owner, ids.lucas])).id
  d059.procA = (await um(db, `insert into legal_processes (legal_case_id, cnj_number, title, court, responsible_user_id) values ($1, $2, 'Fictícia x Banco 059 A', 'TJRJ', $3) returning id`,
    [d059.caso, cnj059(1), ids.barbara])).id
  d059.procB = (await um(db, `insert into legal_processes (legal_case_id, cnj_number, title, court) values ($1, $2, 'Fictícia x Banco 059 B', 'TJRJ') returning id`, [d059.caso, cnj059(2)])).id
  await rodar059()
  await db.query(`update judicial_settings set deadline_agent_id = $1 where id`, [ids.agente])
  igual((await um(db, `select deadline_auto_apply v from judicial_settings where id`)).v, true, 'ligado por padrão')
  d059.hoje = await dia059()
})
await deve('pedido ao agente, com o prazo direto ligado: diz que o prazo ENTRA DIRETO NA AGENDA, que a data tem de ser da lista, o "CONFERIR:" na dúvida e que "Sem prazo:" continua indo para a equipe', async () => {
  const t = d059.t1 = await trabalho059(d059.procA, cnj059(1), d059.hoje)
  igual(t.dias.length, 30, 'lista de dias úteis no pedido')
  igual([t.pedido.includes('ATENÇÃO: o prazo proposto ENTRA DIRETO NA AGENDA do processo, sem revisão de um advogado.'),
    t.pedido.includes('a data de due_at tem de ser um dos dias da lista abaixo'),
    t.pedido.includes('proponha o prazo mais curto cabível e comece a descrição com "CONFERIR:" — prazo a mais custa pouco, prazo perdido custa o processo.'),
    t.pedido.includes('Só quando for claro que não há prazo para o nosso cliente, chame propor tipo OTHER, resumo começando com "Sem prazo:"'),
    t.pedido.includes('esse continua indo para a equipe conferir.'), t.pedido.includes('quem decide é a equipe')], [true, true, true, true, true, false], 'O QUE FAZER')
  // O resto do pedido é o da 058: cliente e polo antes, lista de dias úteis, link e teor depois.
  igual([t.pedido.includes('\nNosso cliente: Odete Integração · polo não informado (do cadastro do processo)\n\nO QUE FAZER: leia o teor e diga se ele abre prazo para o nosso cliente. Se abrir, chame a ferramenta propor UMA vez, tipo CREATE_DEADLINE, dados {title, due_at'),
    t.pedido.includes(`esse continua indo para a equipe conferir.\n\nDIAS ÚTEIS a partir da publicação`), t.pedido.includes(`\n  dia 15: ${br059(t.dias[14])}\n`),
    t.pedido.includes('\n\nÍntegra: https://comunica.pje.jus.br/x/59001\n\nTEOR:\nFica a parte autora intimada para réplica em 15 dias. (59001)')], [true, true, true, true], 'resto do pedido')
})
await deve('prazo direto: CREATE_DEADLINE do trabalho da publicação, com data da lista → nenhuma revisão, proposta aprovada e aplicada na hora, prazo na agenda com caso, processo, título, data e responsável (o do processo)', async () => {
  const t = d059.t1
  const venc = d059.venc1 = t.dias[14]
  const r = await propor059(t, 'CREATE_DEADLINE', prazo059(venc), 'k-059-direto')
  igual([r.created, r.applied], [true, true], 'resposta ao computador: criada e já aplicada')
  d059.prop1 = r.proposal_id
  const p = await um(db, `select status, requires_human_review rev, applied_entity_type ent, applied_entity_id prazo, decided_at is not null dec, applied_at is not null apl,
      legal_case_id caso, legal_process_id proc, payload -> 'data' ->> 'responsible_user_id' resp, payload -> 'data' ->> 'legal_process_id' proc_dados, payload ->> 'summary' resumo
    from agent_proposals where id = $1`, [r.proposal_id])
  igual([p.status, p.rev, p.ent, p.dec, p.apl, p.caso, p.proc], ['APPLIED', false, 'deadlines', true, true, d059.caso, d059.procA], 'proposta: PENDING → APPROVED → APPLIED, sem exigir revisão')
  igual([p.resp, p.proc_dados, p.resumo], [ids.barbara, d059.procA, 'Prazo de 15 dias úteis para réplica'], 'o que foi aplicado fica gravado na proposta')
  igual((await um(db, `select count(*)::int n from reviews where agent_proposal_id = $1`, [r.proposal_id])).n, 0, 'nenhuma revisão criada')
  const d = await um(db, `select legal_case_id, legal_process_id, title, description, priority, status, source, responsible_user_id,
      to_char(due_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') due from deadlines where id = $1`, [p.prazo])
  igual([d.legal_case_id, d.legal_process_id, d.title, d.description, d.priority, d.status, d.source, d.responsible_user_id, d.due],
    [d059.caso, d059.procA, 'Réplica à contestação', 'CPC, art. 350: 15 dias úteis contados da publicação.', 'HIGH', 'OPEN', 'AGENT', ids.barbara, `${venc} 23:59`], 'prazo')
  igual(await prazos059(d059.procA), 1, 'um prazo no processo')
  d059.prazo1 = p.prazo
  const au = await um(db, `select actor_type, agent_run_id, metadata from audit_events where action = 'AGENT_PROPOSAL_EFFECT' and entity_id = $1`, [p.prazo])
  igual([au.actor_type, au.agent_run_id, au.metadata.direct, au.metadata.agent_proposal_id, au.metadata.publication_id], ['AGENT', t.run, true, r.proposal_id, t.pub], 'auditoria: efeito do agente, marcado como prazo direto')
})
await deve('prazo direto: a publicação fica tratada (DONE/DEADLINE) com o prazo, sem revisor (triaged_by vazio) e com a nota de que entrou direto', async () => {
  const p = await publicacao059(d059.t1)
  igual([p.st, p.res, p.prazo, p.por, p.nota], ['DONE', 'DEADLINE', d059.prazo1, null, 'Prazo lançado direto pelo agente de prazos, sem revisão (prazo direto).'], 'triagem')
  const tela = await rpc043(ids.lucas, `select public.get_judicial_publication($1) r`, [d059.t1.pub])
  igual([tela.triage_status, tela.triage_outcome, tela.deadline.id, tela.deadline.title, tela.pending_review_id], ['DONE', 'DEADLINE', d059.prazo1, 'Réplica à contestação', null], 'na tela da publicação')
  const ev = await linhas(db, `select message m from agent_run_events where agent_run_id = $1 and kind = 'OUTPUT' order by id`, [d059.t1.run])
  igual(ev.map((x) => x.m), [`Prazo lançado direto na agenda, sem revisão: Réplica à contestação — vence ${br059(d059.venc1)}`, 'Proposta: Prazo de 15 dias úteis para réplica'], 'linha do tempo do trabalho')
})
await deve('prazo direto: quem recebe o aviso da publicação (responsável do processo e advogado do caso) recebe UM aviso do prazo criado; o aviso genérico "Novo prazo" não sai em dobro', async () => {
  const av = await linhas(db, `select user_id, type, title, message, severity, related_type, event_key, legal_case_id, legal_process_id from notifications where related_id = $1`, [d059.prazo1])
  igual(av.map((x) => x.user_id).sort(), [ids.barbara, ids.lucas].sort(), 'um aviso para cada um')
  for (const a of av) {
    igual([a.type, a.title, a.severity, a.related_type, a.event_key, a.legal_case_id, a.legal_process_id],
      ['DEADLINE_CREATED', `Prazo criado pelo agente: Réplica à contestação — vence ${br059(d059.venc1)}`, 'WARNING', 'deadline', 'prazo-direto:' + d059.prazo1, d059.caso, d059.procA], 'aviso')
    igual(a.message, `Fictícia x Banco 059 A · publicação do DJEN de ${br059(d059.hoje)}. O prazo entrou direto na agenda, sem revisão de um advogado: confira a contagem.`, 'mensagem')
  }
  igual((await um(db, `select count(*)::int n from notifications where event_key = $1`, ['deadline-created:' + d059.prazo1])).n, 0, 'sem o aviso genérico em dobro')
  igual((await um(db, `select coalesce(current_setting('dg.prazo_direto', true), '') v`)).v, '', 'o sinal do prazo direto não vaza da transação')
})
await deve('prazo direto: repetir a mesma chamada (mesma chave de idempotência) não cria segundo prazo, nem revisão, nem segundo aviso', async () => {
  const r = await propor059(d059.t1, 'CREATE_DEADLINE', prazo059(d059.venc1), 'k-059-direto')
  igual([r.created, r.applied, r.proposal_id], [false, true, d059.prop1], 'a mesma proposta, já aplicada')
  igual(await prazos059(d059.procA), 1, 'um prazo só')
  igual((await um(db, `select count(*)::int n from agent_proposals where agent_run_id = $1`, [d059.t1.run])).n, 1, 'uma proposta só')
  igual((await um(db, `select count(*)::int n from reviews where agent_proposal_id = $1`, [d059.prop1])).n, 0, 'sem revisão')
  igual((await um(db, `select count(*)::int n from notifications where related_id = $1`, [d059.prazo1])).n, 2, 'sem segundo aviso')
  igual((await publicacao059(d059.t1)).prazo, d059.prazo1, 'publicação com o mesmo prazo')
})
await deve('só UMA proposta direta por publicação: uma segunda CREATE_DEADLINE do mesmo trabalho vai para Revisões, com o motivo na linha do tempo', async () => {
  const t = d059.t1
  const r = await propor059(t, 'CREATE_DEADLINE', prazo059(t.dias[4], { title: 'Segundo prazo do mesmo trabalho' }), 'k-059-segunda')
  await caminhoAntigo059(t, r, 1, 'segunda proposta')
  igual(await motivos059(t), ['Prazo não entrou direto na agenda (foi para Revisões): este trabalho já tem outra proposta de prazo (só uma entra direto por publicação)'], 'motivo registrado')
  igual((await publicacao059(t)).prazo, d059.prazo1, 'a publicação continua com o primeiro prazo')
  // Com proposta pendente, o trabalho termina aguardando a decisão humana, como sempre.
  igual((await ex(`select private.executor_complete($1, $2, $3) r`, [hA, t.run, t.reserva])).status, 'WAITING_HUMAN', 'aguardando revisão')
})
await deve('data fora da lista (sábado) → caminho antigo; aprovada em Revisões, o prazo nasce pelo aplicador de sempre e a publicação fica tratada por quem aprovou', async () => {
  const t = d059.t2 = await trabalho059(d059.procB, cnj059(2), d059.hoje)
  const sab = sabado059(t.dias)
  const r = await propor059(t, 'CREATE_DEADLINE', prazo059(sab), 'k-059-sabado')
  const p = await caminhoAntigo059(t, r, 0, 'sábado')
  igual(await motivos059(t), [`Prazo não entrou direto na agenda (foi para Revisões): a data ${br059(sab)} não é um dos dias úteis da lista calculada para esta publicação`], 'motivo')
  const pub = await publicacao059(t)
  igual([pub.st, pub.prazo], ['WITH_AGENT', null], 'a publicação continua com o agente, esperando a revisão')
  igual((await rpc043(ids.lucas, `select public.get_judicial_publication($1) r`, [t.pub])).pending_review_id, p.revisao_id, 'a revisão pendente aparece na publicação')
  igual((await ex(`select private.executor_complete($1, $2, $3) r`, [hA, t.run, t.reserva])).status, 'WAITING_HUMAN', 'aguardando revisão')
  await decidir(ids.lucas, p.revisao_id, 'APPROVE')
  await db.query(`select private.maintenance_tick()`)
  const depois = await proposta059(r.proposal_id)
  const pub2 = await publicacao059(t)
  igual([depois.status, depois.rev, depois.ent, pub2.st, pub2.res, pub2.prazo, pub2.por, pub2.nota], ['APPLIED', true, 'deadlines', 'DONE', 'DEADLINE', depois.prazo, ids.lucas, null], 'aprovada por uma pessoa: tratada com o prazo')
  igual(await prazos059(d059.procB), 1, 'o prazo só existe depois da aprovação')
  // No caminho antigo o aviso é o genérico da 037, para o responsável do prazo (aqui, o advogado do caso).
  igual((await linhas(db, `select event_key k from notifications where related_id = $1`, [depois.prazo])).map((x) => x.k), ['deadline-created:' + depois.prazo], 'aviso do caminho antigo')
})
await deve('data além da lista e vencimento sem hora e fuso → caminho antigo, cada um com o seu motivo', async () => {
  const t = d059.t3 = await trabalho059(d059.procB, cnj059(2), d059.hoje)
  const alem = mais059(t.dias[29], 40)
  await caminhoAntigo059(t, await propor059(t, 'CREATE_DEADLINE', prazo059(alem), 'k-059-alem'), 1, 'além da lista')
  igual(await motivos059(t), [`Prazo não entrou direto na agenda (foi para Revisões): a data ${br059(alem)} não é um dos dias úteis da lista calculada para esta publicação`], 'motivo')
  // Com uma proposta de prazo já esperando revisão, a seguinte do mesmo trabalho também vai para Revisões, mesmo com data da lista.
  await caminhoAntigo059(t, await propor059(t, 'CREATE_DEADLINE', prazo059(t.dias[14]), 'k-059-depois-da-pendente'), 1, 'segunda proposta, a primeira pendente')
  igual((await motivos059(t))[1], 'Prazo não entrou direto na agenda (foi para Revisões): este trabalho já tem outra proposta de prazo (só uma entra direto por publicação)', 'motivo')
  igual((await publicacao059(t)).st, 'WITH_AGENT', 'com o agente')
  const t4 = await trabalho059(d059.procB, cnj059(2), d059.hoje)
  const semFuso = prazo059(t4.dias[14])
  semFuso.data.due_at = t4.dias[14]
  await caminhoAntigo059(t4, await propor059(t4, 'CREATE_DEADLINE', semFuso, 'k-059-sem-fuso'), 1, 'sem hora e fuso')
  igual((await motivos059(t4))[0].includes('o vencimento (due_at) não veio com data, hora e fuso'), true, 'motivo')
  const t5 = await trabalho059(d059.procB, cnj059(2), d059.hoje)
  const semTitulo = prazo059(t5.dias[14], { title: '   ' })
  await caminhoAntigo059(t5, await propor059(t5, 'CREATE_DEADLINE', semTitulo, 'k-059-sem-titulo'), 1, 'sem título')
  igual(await motivos059(t5), ['Prazo não entrou direto na agenda (foi para Revisões): o prazo veio sem título'], 'motivo')
})
await deve('data no passado (mesmo sendo dia da lista) → caminho antigo', async () => {
  // Publicação disponibilizada há 60 dias: o primeiro dia útil da lista já passou.
  const t = await trabalho059(d059.procB, cnj059(2), await dia059(-60))
  igual(t.dias[0] < d059.hoje, true, 'o dia 1 da lista já passou')
  await caminhoAntigo059(t, await propor059(t, 'CREATE_DEADLINE', prazo059(t.dias[0]), 'k-059-passado'), 1, 'passado')
  igual(await motivos059(t), [`Prazo não entrou direto na agenda (foi para Revisões): o vencimento (${br059(t.dias[0])}) já passou`], 'motivo')
  igual((await publicacao059(t)).st, 'WITH_AGENT', 'com o agente')
})
await deve('publicação já tratada por uma pessoa (prazo criado pela tela) → a proposta do agente segue o caminho antigo e não cria segundo prazo', async () => {
  const t = await trabalho059(d059.procB, cnj059(2), d059.hoje)
  const h = await rpc043(ids.lucas, `select public.create_deadline_from_publication($1, $2) r`, [t.pub, JSON.stringify({ title: 'Réplica (criado pela equipe)', due_on: t.dias[14] })])
  igual(await prazos059(d059.procB), 2, 'o prazo da equipe')
  await caminhoAntigo059(t, await propor059(t, 'CREATE_DEADLINE', prazo059(t.dias[14]), 'k-059-tratada'), 2, 'já tratada')
  igual(await motivos059(t), ['Prazo não entrou direto na agenda (foi para Revisões): a publicação já foi tratada'], 'motivo')
  const pub = await publicacao059(t)
  igual([pub.st, pub.res, pub.prazo, pub.por], ['DONE', 'DEADLINE', h.deadline_id, ids.lucas], 'a triagem da pessoa não muda')
})
await deve('publicação cancelada pelo tribunal → caminho antigo', async () => {
  const t = await trabalho059(d059.procB, cnj059(2), d059.hoje)
  await db.query(`update judicial_publications set cancelled_at = now(), cancel_reason = 'Publicada por engano' where id = $1`, [t.pub])
  await caminhoAntigo059(t, await propor059(t, 'CREATE_DEADLINE', prazo059(t.dias[14]), 'k-059-cancelada'), 2, 'cancelada')
  igual(await motivos059(t), ['Prazo não entrou direto na agenda (foi para Revisões): a publicação foi cancelada pelo tribunal'], 'motivo')
})
await deve('trabalho que NÃO nasceu de publicação → continua exigindo revisão, mesmo com data válida; pedido avulso que só imita o JSON de publicação também', async () => {
  const avulso = async (params) => {
    const run = (await como(ids.lucas, (tx) => um(tx, `select public.request_agent_run_once($1, $2, $3, $4, 'Conferir o prazo', $5, 'EXECUTE') r`,
      [randomUUID(), ids.agente, d059.caso, d059.procB, JSON.stringify(params)]))).r.run_id
    const reserva = lease()
    igual((await reservar040(hA, run, reserva)).claimed, true, 'trabalho avulso reservado')
    return { run, reserva, proc: d059.procB }
  }
  const venc = d059.t3.dias[14]
  const a = await avulso({})
  await caminhoAntigo059(a, await propor059(a, 'CREATE_DEADLINE', prazo059(venc), 'k-059-avulso'), 2, 'avulso')
  igual(await motivos059(a), [], 'trabalho comum: nada a registrar')
  // d059.t3 continua com o agente (WITH_AGENT): o pedido avulso copia o JSON dela, mas a publicação não aponta para ele.
  const f = await avulso({ kind: 'JUDICIAL_PUBLICATION', publication_id: d059.t3.pub, business_days: [venc] })
  await caminhoAntigo059(f, await propor059(f, 'CREATE_DEADLINE', prazo059(venc), 'k-059-imitado'), 2, 'JSON imitado')
  igual(await motivos059(f), ['Prazo não entrou direto na agenda (foi para Revisões): a publicação não está ligada a este trabalho'], 'motivo')
  const pub = await publicacao059(d059.t3)
  igual([pub.st, pub.prazo], ['WITH_AGENT', null], 'a publicação imitada não é tocada')
})
await deve('"Sem prazo:" (OTHER) → como antes: vai para Revisões, nenhum prazo, e a publicação volta para a triagem da equipe quando o trabalho fecha', async () => {
  const t = await trabalho059(d059.procB, cnj059(2), d059.hoje)
  const r = await propor059(t, 'OTHER', { summary: 'Sem prazo: despacho de mero expediente', data: { description: 'O despacho só determina a juntada; não há prazo para o nosso cliente.' } }, 'k-059-sem-prazo')
  const p = await proposta059(r.proposal_id)
  igual([r.created, r.applied, p.status, p.rev, p.revisao, p.prazo], [true, false, 'PENDING', true, 'PENDING', null], 'proposta em Revisões')
  igual([await prazos059(d059.procB), await motivos059(t), (await publicacao059(t)).st], [2, [], 'WITH_AGENT'], 'nenhum prazo; publicação com o agente até a decisão')
  igual((await ex(`select private.executor_complete($1, $2, $3) r`, [hA, t.run, t.reserva])).status, 'WAITING_HUMAN', 'aguardando revisão')
  await decidir(ids.lucas, p.revisao_id, 'APPROVE')
  await db.query(`select private.maintenance_tick()`)
  const pub = await publicacao059(t)
  igual([(await um(db, `select status from agent_runs where id = $1`, [t.run])).status, pub.st, pub.res, pub.prazo, await prazos059(d059.procB)],
    ['COMPLETED', 'PENDING', null, null, 2], 'de volta à triagem da equipe, sem prazo')
})
await deve('configuração: a tela lê e salva deadline_auto_apply; quem não manda a chave não muda nada; só ADMIN', async () => {
  const antes = (await rpc043(ids.lucas, `select public.get_judicial_overview() r`)).settings
  igual([antes.deadline_auto_apply, antes.deadline_agent_id], [true, ids.agente], 'lê (ligado)')
  await como(ids.lucas, (tx) => tx.query(`select public.save_judicial_settings('{"deadline_auto_apply":false}')`)).then(
    () => { throw new Error('advogado desligou o prazo direto') }, (e) => { if (!/Somente ADMIN/.test(e.message)) throw e })
  igual((await rpc043(ids.barbara, `select public.save_judicial_settings('{"deadline_auto_apply":false}') r`)).ok, true, 'ADMIN salva')
  const s = (await rpc043(ids.barbara, `select public.get_judicial_overview() r`)).settings
  igual([s.deadline_auto_apply, s.deadline_agent_id, s.djen_enabled, s.datajud_enabled, s.lookback_days], [false, antes.deadline_agent_id, antes.djen_enabled, antes.datajud_enabled, antes.lookback_days], 'desligado; o resto como estava')
  await rpc043(ids.barbara, `select public.save_judicial_settings($1) r`, [JSON.stringify({ lookback_days: antes.lookback_days })])
  await rpc043(ids.barbara, `select public.save_judicial_settings('{"deadline_auto_apply":null}') r`)
  igual((await rpc043(ids.barbara, `select public.get_judicial_overview() r`)).settings.deadline_auto_apply, false, 'sem a chave (ou nula): continua desligado')
})
await deve('prazo direto desligado → caminho antigo (sem motivo a registrar), e o texto do pedido volta a ser o da 058', async () => {
  const t = await trabalho059(d059.procB, cnj059(2), d059.hoje)
  igual([t.pedido.includes('(fundamento legal e a contagem: quantos dias úteis e por quê), priority}. Se não houver prazo, chame propor tipo OTHER, resumo começando com "Sem prazo:" e o motivo em dados.description — quem decide é a equipe.\n\nDIAS ÚTEIS a partir da publicação'),
    t.pedido.includes('ENTRA DIRETO'), t.pedido.includes('CONFERIR:')], [true, false, false], 'pedido da 058')
  await caminhoAntigo059(t, await propor059(t, 'CREATE_DEADLINE', prazo059(t.dias[14]), 'k-059-desligado'), 2, 'desligado')
  igual([await motivos059(t), (await publicacao059(t)).st], [[], 'WITH_AGENT'], 'caminho normal, com o agente até a revisão')
  await rpc043(ids.barbara, `select public.save_judicial_settings('{"deadline_auto_apply":true}') r`)
  igual((await rpc043(ids.barbara, `select public.get_judicial_overview() r`)).settings.deadline_auto_apply, true, 'religado')
})
await deve('se a criação do prazo falhar, nada fica pela metade: a proposta passa a exigir revisão e vai para Revisões com o motivo', async () => {
  const t = await trabalho059(d059.procB, cnj059(2), d059.hoje)
  // Prioridade que a agenda não aceita: o aplicador recusa o prazo.
  await caminhoAntigo059(t, await propor059(t, 'CREATE_DEADLINE', prazo059(t.dias[14], { priority: 'MUITO_ALTA' }), 'k-059-falha'), 2, 'falha ao criar')
  igual((await motivos059(t))[0].startsWith('Prazo não entrou direto na agenda (foi para Revisões): não foi possível criar o prazo ('), true, 'motivo')
  const pub = await publicacao059(t)
  igual([pub.st, pub.prazo, pub.nota], ['WITH_AGENT', null, null], 'publicação intacta, com o agente')
  igual((await um(db, `select coalesce(current_setting('dg.prazo_direto', true), '') v`)).v, '', 'o sinal do prazo direto não fica ligado')
})
await deve('orientações do kit: rodar a migration de novo só troca quem ainda tem exatamente o texto da 058 (pelo identificador ou pelo agente do computador); texto editado e agente arquivado ficam como estão; a configuração não volta ao padrão', async () => {
  const versoes = async (slug) => (await linhas(db, `select v.version_number n, v.instructions i, v.configuration c, v.id = a.current_version_id atual
    from agents a join agent_versions v on v.agent_id = a.id where a.slug = $1 order by v.version_number`, [slug]))
  const agente = async (slug, orientacoes, conf) => {
    const id = (await um(db, `insert into agents (slug, name, description, purpose, status) values ($1, $2, 'Agente fictício 059', 'Teste', 'DRAFT') returning id`, [slug, `Agente ${slug}`])).id
    const v = (await um(db, `insert into agent_versions (agent_id, instructions, configuration) values ($1, $2, $3) returning id`, [id, orientacoes, JSON.stringify(conf)])).id
    await db.query(`update agents set current_version_id = $2, status = 'ACTIVE' where id = $1`, [id, v])
  }
  // A Diana, recadastrada como a 058 cadastra (as de antes saíram de cena): versão 1, com o texto da 058.
  await rodar058()
  igual((await versoes(KIT058)).map((x) => [x.n, x.i]), [[1, DIANA058]], 'Diana com o texto da 058')
  await agente('prazos-do-site-059', DIANA058, { local_agent: KIT058, model: 'modelo-do-site' })
  await agente('prazos-editado-059', DIANA058 + '\n- Regra do escritório: avisar a Dra. Barbara por e-mail.', { local_agent: KIT058 })
  await agente('outro-agente-059', DIANA058, { local_agent: 'outro-agente' })
  await db.query(`update judicial_settings set deadline_auto_apply = false where id`)
  await rodar059()
  igual((await versoes(KIT058)).map((x) => [x.n, x.i, x.c.local_agent, x.atual]), [[1, DIANA058, KIT058, false], [2, DIANA059, KIT058, true]], 'Diana: versão nova, atual')
  igual((await versoes('prazos-do-site-059')).map((x) => [x.n, x.i, x.c, x.atual]),
    [[1, DIANA058, { model: 'modelo-do-site', local_agent: KIT058 }, false], [2, DIANA059, { model: 'modelo-do-site', local_agent: KIT058 }, true]], 'cadastrado pelo site: versão nova, mesma configuração (o jsonb devolve as chaves na ordem dele)')
  igual((await versoes('prazos-editado-059')).map((x) => [x.n, x.atual]), [[1, true]], 'orientações editadas: não tocadas')
  igual((await versoes('outro-agente-059')).map((x) => [x.n, x.atual]), [[1, true]], 'agente de outro agente do computador: não tocado')
  igual((await versoes(KIT058 + '-kit058')).map((x) => [x.n, x.i]), [[1, DIANA058]], 'agente arquivado: não tocado')
  await rodar059()
  igual([(await versoes(KIT058)).length, (await versoes('prazos-do-site-059')).length, (await versoes('prazos-editado-059')).length], [2, 2, 1], 'rodar de novo não cria outra versão')
  igual((await um(db, `select deadline_auto_apply v, deadline_agent_id a from judicial_settings where id`)), { v: false, a: ids.agente }, 'a configuração do escritório não volta ao padrão')
  await db.query(`update judicial_settings set deadline_auto_apply = true where id`)
  // Os agentes deste teste saem de cena.
  await db.query(`update agents set slug = slug || '-fim059', status = 'INACTIVE', deleted_at = now() where slug = any($1)`,
    [[KIT058, 'prazos-do-site-059', 'prazos-editado-059', 'outro-agente-059']])
})
await deve('depois de rodar a migration de novo, o prazo direto continua valendo: processo sem responsável → o prazo vai para o advogado do caso; sem nada pendente, o trabalho termina concluído', async () => {
  const t = await trabalho059(d059.procB, cnj059(2), d059.hoje)
  const antes = await prazos059(d059.procB)
  const venc = t.dias[9]
  const r = await propor059(t, 'CREATE_DEADLINE', prazo059(venc, { title: 'Contrarrazões', priority: 'URGENT', responsible_user_id: ids.ana }), 'k-059-advogado-do-caso')
  igual([r.created, r.applied], [true, true], 'aplicada na hora')
  const p = await proposta059(r.proposal_id)
  const d = await um(db, `select title, responsible_user_id resp, legal_process_id proc, source, to_char(due_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') dia from deadlines where id = $1`, [p.prazo])
  igual([p.status, p.rev, p.revisao, d.title, d.resp, d.proc, d.source, d.dia], ['APPLIED', false, null, 'Contrarrazões', ids.lucas, d059.procB, 'AGENT', venc],
    'responsável: o advogado do caso (o que o agente indicou não vale)')
  igual(await prazos059(d059.procB), antes + 1, 'um prazo novo')
  const av = await linhas(db, `select user_id, title, severity from notifications where related_id = $1`, [p.prazo])
  igual(av.map((x) => [x.user_id, x.title, x.severity]), [[ids.lucas, `Prazo criado pelo agente: Contrarrazões — vence ${br059(venc)}`, 'URGENT']], 'um aviso, para o advogado do caso')
  igual((await ex(`select private.executor_complete($1, $2, $3) r`, [hA, t.run, t.reserva])).status, 'COMPLETED', 'trabalho concluído: nada espera revisão')
  const pub = await publicacao059(t)
  igual([pub.st, pub.res, pub.prazo, pub.por], ['DONE', 'DEADLINE', p.prazo, null], 'a publicação continua tratada depois de o trabalho fechar')
})
await deve('catálogo [059]: funções com search_path fixo; nenhuma nova porta para usuário logado, anon ou backend; o computador do escritório só chama as portas de proposta', async () => {
  const r = await linhas(db, `select n.nspname || '.' || p.proname f, coalesce(array_to_string(p.proconfig, ','), '') cfg, p.prosecdef def,
      has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('service_role', p.oid, 'execute') srv,
      has_function_privilege('authenticated', p.oid, 'execute') usr, has_function_privilege('dg_worker', p.oid, 'execute') wrk
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = any ($1) order by 1`,
    [['judicial_direct_deadline_check', 'judicial_direct_deadline_apply', 'judicial_request_deadline_proposal', 'notify_deadlines',
      'worker_create_proposal', 'executor_create_proposal', 'get_judicial_overview', 'save_judicial_settings']])
  igual(r.length, 8, 'uma versão de cada função')
  igual(r.filter((x) => !x.cfg.includes('search_path=') || !x.def || x.anon || x.srv).map((x) => x.f), [], 'search_path, definer, sem anon nem service_role')
  igual(r.filter((x) => x.usr).map((x) => x.f), ['private.get_judicial_overview', 'private.save_judicial_settings'], 'usuário logado: só as duas da tela, como na 043')
  igual(r.filter((x) => x.wrk).map((x) => x.f), ['private.executor_create_proposal', 'private.worker_create_proposal'], 'dg_worker: só as portas de proposta')
  await como(ids.barbara, (tx) => tx.query(`select private.judicial_direct_deadline_apply($1, '{"ok":true}')`, [d059.prop1])).then(
    () => { throw new Error('usuário logado aplicou prazo direto') }, (e) => { if (!/permission denied/.test(e.message)) throw e })
  // A guarda da 012 continua valendo: a exigência de revisão humana não se desliga depois.
  const pend = (await um(db, `select id from agent_proposals where requires_human_review and status = 'PENDING' and proposal_type = 'CREATE_DEADLINE' limit 1`)).id
  await db.query(`update agent_proposals set requires_human_review = false where id = $1`, [pend]).then(
    () => { throw new Error('a exigência de revisão foi desligada') }, (e) => { if (!/não pode ser desligado/.test(e.message)) throw e })
  await db.query(`update judicial_settings set deadline_agent_id = null where id`)
})

// ═════════════════════════════ Origem do cliente na ponte [060] ══════════

secao('Ponte: escritório de origem do cliente, para o nível da origem na pasta do Drive [060]')
const p060 = {}
const ponte060 = (run, reserva) => ex(`select private.executor_bridge_data($1, $2, $3) r`, [hA, run, reserva])
const trabalho060 = async (caso, pedido) => {
  const run = (await como(ids.lucas, (tx) => um(tx, `select public.request_agent_run_once($1, $2, $3, null, $4, '{}', 'EXECUTE') r`, [randomUUID(), ids.agente, caso, pedido]))).r.run_id
  const reserva = lease()
  igual((await reservar040(hA, run, reserva)).claimed, true, 'trabalho reservado pelo computador do escritório')
  return { run, reserva }
}
await deve('cenário: um cliente cadastrado por um parceiro (com caso de origem no escritório) e um cliente do próprio escritório', async () => {
  // O parceiro tem nome fantasia e razão social diferentes do nome: a origem usa o NOME (o que o site mostra em "Origem").
  p060.parceiro = await parceiro('Sá & Souza Advocacia 060', 50)
  await db.query(`update organizations set trade_name = 'Fantasia 060', legal_name = 'Razão Social 060 Ltda' where id = $1`, [p060.parceiro])
  p060.dono = (await um(db, `select name from organizations where id = $1`, [ids.owner])).name
  const cliente = async (cpf, nome, origem) => {
    const id = (await um(db, `insert into clients (kind, cpf, origin_organization_id) values ('INDIVIDUAL', $1, $2) returning id`, [cpf, origem])).id
    await db.query(`insert into individual_client_details (client_id, full_name) values ($1, $2)`, [id, nome])
    return id
  }
  const caso = async (cli, titulo) => (await um(db, `insert into legal_cases (client_id, legal_area_id, title, status, origin_organization_id, created_by_organization_id, assigned_lawyer_id)
    values ($1, $2, $3, 'IN_PROGRESS', $4, $4, $5) returning id`, [cli, ids.banking, titulo, ids.owner, ids.lucas])).id
  p060.cliParceiro = await cliente('99906000001', 'Cliente Fictício do Parceiro 060', p060.parceiro)
  p060.cliDono = await cliente('99906000002', 'Cliente Fictício do Escritório 060', ids.owner)
  // O caso do cliente do parceiro tem origem no ESCRITÓRIO: para a pasta vale a origem do cliente.
  p060.casoParceiro = await caso(p060.cliParceiro, 'Caso fictício 060 (cliente do parceiro)')
  p060.casoDono = await caso(p060.cliDono, 'Caso fictício 060 (cliente do escritório)')
  igual((await um(db, `select origin_organization_id o from legal_cases where id = $1`, [p060.casoParceiro])).o, ids.owner, 'caso com origem diferente da do cliente')
  p060.tParceiro = await trabalho060(p060.casoParceiro, 'Ponte 060: cliente do parceiro')
  p060.tDono = await trabalho060(p060.casoDono, 'Ponte 060: cliente do escritório')
})
await deve('cliente de parceiro: origem com o nome do parceiro e tipo PARCEIRO, mesmo com o caso de origem no escritório', async () => {
  const b = await ponte060(p060.tParceiro.run, p060.tParceiro.reserva)
  igual(b.origem, { nome: 'Sá & Souza Advocacia 060', tipo: 'PARCEIRO' }, 'origem do cadastro do cliente, com o nome como está no site')
  igual(b.cliente.id, p060.cliParceiro, 'do cliente do trabalho')
})
await deve('cliente do próprio escritório: origem com o nome do escritório e tipo ESCRITORIO', async () => {
  const b = await ponte060(p060.tDono.run, p060.tDono.reserva)
  igual(b.origem, { nome: p060.dono, tipo: 'ESCRITORIO' }, 'origem')
  igual(b.cliente.id, p060.cliDono, 'do cliente do trabalho')
})
await deve('só amplia: as chaves e o cadastro saem como na 055; o acesso continua preso à reserva', async () => {
  const b = await ponte060(p060.tParceiro.run, p060.tParceiro.reserva)
  igual(Object.keys(b).sort(), ['cliente', 'escritorio', 'origem', 'pasta_drive'], 'as três chaves de antes e a origem')
  igual(Object.keys(b.cliente).sort(), ['cpf', 'email', 'endereco', 'estado_civil', 'forma_de_pagamento', 'id', 'nacionalidade', 'nome', 'profissao', 'rg', 'telefone', 'tipo'], 'cliente')
  igual([b.cliente.nome, b.cliente.cpf, b.pasta_drive], ['Cliente Fictício do Parceiro 060', '999.060.000-01', null], 'cadastro e pasta do Drive')
  igual(Object.keys(b.escritorio).sort(), ['advogado', 'cidade', 'email', 'endereco', 'nome', 'oab', 'telefone'], 'quem assina')
  await ex(`select private.executor_bridge_data($1, $2, $3) r`, [hB, p060.tParceiro.run, p060.tParceiro.reserva]).then(
    () => { throw new Error('outro computador leu') }, (e) => { if (!/não está reservado|inválido ou revogado/.test(e.message)) throw e })
  // A reserva de um trabalho não lê a origem do cliente de outro.
  await ex(`select private.executor_bridge_data($1, $2, $3) r`, [hA, p060.tParceiro.run, p060.tDono.reserva]).then(
    () => { throw new Error('reserva de outro trabalho leu') }, (e) => { if (!/não está reservado/.test(e.message)) throw e })
})
await deve('a origem é a do cadastro: parceiro renomeado ou arquivado continua sendo a origem; rodar a migration de novo não muda nada', async () => {
  await db.query(`update organizations set name = '  Souza & Sá Advogados 060  ' where id = $1`, [p060.parceiro])
  igual((await ponte060(p060.tParceiro.run, p060.tParceiro.reserva)).origem, { nome: 'Souza & Sá Advogados 060', tipo: 'PARCEIRO' }, 'nome novo, sem espaço sobrando')
  await db.query(`update organizations set status = 'INACTIVE', deleted_at = now() where id = $1`, [p060.parceiro])
  igual((await ponte060(p060.tParceiro.run, p060.tParceiro.reserva)).origem, { nome: 'Souza & Sá Advogados 060', tipo: 'PARCEIRO' }, 'parceiro arquivado: a pasta do cliente não muda de lugar')
  await db.exec(await readFile(new URL('migrations/20261113000060_ponte_origem_do_cliente.sql', raiz), 'utf8'))
  igual((await ponte060(p060.tDono.run, p060.tDono.reserva)).origem, { nome: p060.dono, tipo: 'ESCRITORIO' }, 'depois de rodar de novo')
})
await deve('catálogo [060]: uma versão só da função, search_path fixo, definer; só o dg_worker executa', async () => {
  const r = await linhas(db, `select p.proname f, coalesce(array_to_string(p.proconfig, ','), '') cfg, p.prosecdef def,
      has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('service_role', p.oid, 'execute') srv,
      has_function_privilege('authenticated', p.oid, 'execute') usr, has_function_privilege('dg_worker', p.oid, 'execute') wrk
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'executor_bridge_data'`)
  igual(r.length, 1, 'uma versão')
  igual(r.map((x) => [x.cfg.includes('search_path='), x.def, x.anon, x.srv, x.usr, x.wrk]), [[true, true, false, false, false, true]], 'permissões como na 055')
  // Os dois trabalhos do cenário saem da fila do computador do escritório.
  for (const t of [p060.tParceiro, p060.tDono]) await ex(`select private.executor_fail($1, $2, $3, 'INTERNAL_ERROR', 'fim do cenário 060', false) r`, [hA, t.run, t.reserva])
})

// ═════════════════════════════ O prazo vira tarefa [061] ═════════════════

secao('O prazo do agente de prazos vira tarefa para os agentes: vai ao orquestrador quando o caso tem os autos; sem eles, fica aberta com o aviso [061]')
const t061 = { trabalhos: [] }
// CNJs fictícios (TJRJ, 8.19, origem 0999) para os cenários da 061.
const cnj061 = (n) => cnj(6100 + n, '2026', '8', '19', '0999')
const mascara061 = (c) => `${c.slice(0, 7)}-${c.slice(7, 9)}.${c.slice(9, 13)}.${c.slice(13, 14)}.${c.slice(14, 16)}.${c.slice(16)}`
// As verificações da 058 e da 059 rodaram aquelas migrations de novo (a 059 redefine as funções da tela): a 061 vem depois delas, como no banco de verdade.
const rodar061 = async () => db.exec(await readFile(new URL('migrations/20261113000061_prazo_vira_tarefa.sql', raiz), 'utf8'))
const AVISO061 = {
  autos: 'Anexe os autos do processo e envie a tarefa.',
  conferir: 'Prazo marcado para conferir: confira e envie a tarefa.',
  orquestrador: 'Orquestrador não configurado.',
  vencido: 'O vencimento do prazo já passou: confira e, se ainda couber, envie a tarefa.',
}
// Documento do caso; a origem é a da PRIMEIRA versão (UPLOAD = da equipe ou do parceiro; AGENT = gerado por agente).
async function documento061(caso, titulo, origem) {
  const cli = (await um(db, `select client_id from legal_cases where id = $1`, [caso])).client_id
  const doc = randomUUID(), v = randomUUID()
  await db.query(`insert into documents (id, client_id, category, title) values ($1, $2, 'OTHER', $3)`, [doc, cli, titulo])
  await db.query(`insert into case_documents (legal_case_id, document_id) values ($1, $2)`, [caso, doc])
  await db.query(`insert into document_versions (id, document_id, storage_object_name, source) values ($1, $2, $3, $4)`, [v, doc, `clients/${cli}/documents/${doc}/${v}/arquivo.pdf`, origem])
  return doc
}
const temAutos061 = async (caso) => (await um(db, `select private.case_has_own_document($1) r`, [caso])).r
const tarefas061 = (prazo) => linhas(db, `select t.id, t.status, t.title, t.instructions, t.priority, t.agent_id, t.agent_run_id, t.attempts, t.last_error, t.created_by,
    t.legal_process_id, t.legal_case_id, t.due_at = d.due_at mesmo_venc
  from process_tasks t join deadlines d on d.id = t.source_deadline_id where t.source_deadline_id = $1`, [prazo])
const tarefa061 = async (prazo) => {
  const ts = await tarefas061(prazo)
  igual(ts.length, 1, 'uma tarefa do prazo')
  return ts[0]
}
const automaticas061 = async () => (await um(db, `select count(*)::int n from process_tasks where source_deadline_id is not null`)).n
const execucao061 = (run) => um(db, `select r.operation, r.agent_id, r.status, r.requested_by, r.legal_case_id, r.legal_process_id, i.request_text txt, i.parameters par
  from agent_runs r join agent_run_inputs i on i.agent_run_id = r.id where r.id = $1`, [run])
const movimentacao061 = (tarefa) => um(db, `select source, event_type, title, description, important, raw_data ->> 'status' st from process_events where raw_data ->> 'process_task_id' = $1 and title like 'Tarefa criada pelo agente de prazos: %'`, [tarefa])
const erros061 = async (run) => (await linhas(db, `select message m from agent_run_events where agent_run_id = $1 and kind = 'ERROR' order by id`, [run])).map((x) => x.m)
// Publicação nova → trabalho do agente de prazos → proposta de prazo (os ajudantes da 059).
async function lancar061(proc, n, chave, extra = {}, o = {}) {
  const t = await trabalho059(proc, cnj061(n), o.disponibilizadaEm ?? t061.hoje)
  t061.trabalhos.push(t)
  const venc = t.dias[o.dia ?? 14]
  const r = await propor059(t, 'CREATE_DEADLINE', prazo059(venc, extra), chave)
  return { t, r, venc, p: await proposta059(r.proposal_id) }
}
// Aprovação em Revisões: o trabalho termina aguardando a pessoa, o advogado aprova e a manutenção aplica (018).
async function aprovar061(x) {
  igual([x.r.applied, x.p.status, x.p.revisao, x.p.prazo], [false, 'PENDING', 'PENDING', null], 'proposta esperando em Revisões')
  if (x.t.reserva) igual((await ex(`select private.executor_complete($1, $2, $3) r`, [hA, x.t.run, x.t.reserva])).status, 'WAITING_HUMAN', 'aguardando revisão')
  await decidir(ids.lucas, x.p.revisao_id, 'APPROVE')
  await db.query(`select private.maintenance_tick()`)
  const p = await proposta059(x.r.proposal_id)
  igual([p.status, p.ent, !!p.prazo], ['APPLIED', 'deadlines', true], 'aprovada e aplicada: o prazo existe')
  return p
}

await deve('cenário: a 061 roda de novo sem quebrar; caso COM os autos (processo A com responsável, B sem, C com assistente) e caso SEM documento; orquestrador escolhido; opção ligada por padrão', async () => {
  await rodar061()
  igual((await um(db, `select deadline_auto_task v from judicial_settings where id`)).v, true, 'ligada por padrão')
  igual((await um(db, `select count(*)::int n from pg_trigger where tgname = 'agent_proposals_deadline_task' and not tgisinternal`)).n, 1, 'um gatilho só')
  const cli = (await um(db, `select client_id from legal_cases where id = $1`, [j043.caso])).client_id
  const caso = async (titulo) => (await um(db, `insert into legal_cases (client_id, legal_area_id, title, status, origin_organization_id, created_by_organization_id, assigned_lawyer_id)
    values ($1, $2, $3, 'IN_PROGRESS', $4, $4, $5) returning id`, [cli, ids.banking, titulo, ids.owner, ids.lucas])).id
  const processo = async (c, n, titulo, resp) => (await um(db, `insert into legal_processes (legal_case_id, cnj_number, title, court, responsible_user_id) values ($1, $2, $3, 'TJRJ', $4) returning id`,
    [c, cnj061(n), titulo, resp])).id
  t061.caso = await caso('Caso fictício 061 (com os autos)')
  t061.procA = await processo(t061.caso, 1, 'Fictícia x Banco 061 A', ids.barbara)
  t061.procB = await processo(t061.caso, 2, 'Fictícia x Banco 061 B', null)
  t061.procC = await processo(t061.caso, 3, 'Fictícia x Banco 061 C', ids.ana)
  t061.casoSem = await caso('Caso fictício 061 (sem documento)')
  t061.procSem = await processo(t061.casoSem, 4, 'Fictícia x Banco 061 D', ids.barbara)
  await documento061(t061.caso, 'Autos do processo (cópia integral)', 'UPLOAD')
  igual([await temAutos061(t061.caso), await temAutos061(t061.casoSem)], [true, false], 'quem tem os autos')
  // Orquestrador próprio do cenário, escolhido pelo ADMIN (047).
  t061.orqAntes = (await um(db, `select orchestrator_agent_id o from process_task_settings where id`)).o
  t061.orq = (await um(db, `insert into agents (slug, name, description, purpose, status) values ('orquestrador-061', 'Orquestrador fictício 061', 'Agente fictício 061', 'Teste', 'DRAFT') returning id`)).id
  const v = (await um(db, `insert into agent_versions (agent_id, instructions, configuration) values ($1, 'Distribuir a tarefa.', '{}') returning id`, [t061.orq])).id
  await db.query(`update agents set current_version_id = $2, status = 'ACTIVE' where id = $1`, [t061.orq, v])
  await como(ids.barbara, (tx) => tx.query(`select public.save_process_task_settings($1)`, [t061.orq]))
  await db.query(`update judicial_settings set deadline_agent_id = $1, deadline_auto_apply = true where id`, [ids.agente])
  t061.hoje = await dia059()
})
await deve('prazo direto em caso COM os autos: a tarefa nasce sozinha na lista do processo — "Preparar: <título do prazo>", prioridade e vencimento do prazo, sem agente escolhido e sem autor, ligada ao prazo — e já está na fila', async () => {
  t061.desc = 'CPC, art. 350: 15 dias úteis contados da publicação. Peça: réplica à contestação (agente murilo-replica-dg).'
  const x = t061.a = await lancar061(t061.procA, 1, 'k-061-direto', { description: t061.desc })
  igual([x.r.created, x.r.applied, x.p.status, x.p.rev, x.p.ent], [true, true, 'APPLIED', false, 'deadlines'], 'prazo direto aplicado')
  const t = t061.tarefaA = await tarefa061(x.p.prazo)
  igual([t.status, t.title, t.priority, t.mesmo_venc, t.agent_id, t.created_by, t.attempts, t.last_error, t.legal_process_id, t.legal_case_id, !!t.agent_run_id],
    ['QUEUED', 'Preparar: Réplica à contestação', 'HIGH', true, null, null, 1, null, t061.procA, t061.caso, true], 'tarefa')
  igual(t.instructions, [
    'Tarefa criada sozinha pelo DG Brasil: este prazo nasceu de uma publicação do DJEN e foi lançado na agenda pelo agente de prazos.',
    `Prazo: Réplica à contestação\nVencimento: ${br059(x.venc)} (horário de Brasília)`,
    `Publicação do DJEN: disponibilizada em ${br059(t061.hoje)}\nTipo: Intimação\nÓrgão: TJRJ — 1ª Vara Cível Fictícia`,
    `O que fazer: redigir a peça indicada abaixo para este prazo, com os autos e os documentos do caso. O arquivo PROCESSO_${mascara061(cnj061(1))}.txt da pasta do cliente traz a publicação inteira. Se a peça indicada não couber, dizer por quê na entrega.`,
    `Análise do agente de prazos (descrição do prazo):\n${t061.desc}`].join('\n\n'), 'o que fazer')
  igual(t.instructions.includes('Fica a parte autora intimada'), false, 'o teor da publicação não é copiado')
})
await deve('a execução é do ORQUESTRADOR, pedida em nome do responsável do prazo, com o pedido da tarefa; a linha do tempo do processo registra (interno); o prazo direto segue igual (publicação tratada, um aviso para cada pessoa)', async () => {
  const x = t061.a, t = t061.tarefaA
  const run = await execucao061(t.agent_run_id)
  igual([run.operation, run.agent_id, run.status, run.requested_by, run.legal_case_id, run.legal_process_id, run.par],
    ['PROCESS_TASK', t061.orq, 'QUEUED', ids.barbara, t061.caso, t061.procA, { process_task_id: t.id }], 'execução')
  for (const trecho of ['TAREFA DO PROCESSO (lista de afazeres do DG Brasil)', 'Título: Preparar: Réplica à contestação', `O que fazer:\n${t.instructions}`,
    `Prazo interno: ${br059(x.venc)} 23:59`, 'Tudo vai para revisão humana']) {
    if (!run.txt.includes(trecho)) throw new Error(`pedido sem "${trecho}"`)
  }
  const ev = await movimentacao061(t.id)
  igual([ev.source, ev.event_type, ev.title, ev.description, ev.important, ev.st],
    ['AGENT', 'TASK', 'Tarefa criada pelo agente de prazos: Preparar: Réplica à contestação',
      `Criada sozinha a partir do prazo "Réplica à contestação" (vence ${br059(x.venc)}). Enviada ao orquestrador.`, false, 'QUEUED'], 'movimentação do agente')
  const pub = await publicacao059(x.t)
  igual([pub.st, pub.res, pub.prazo], ['DONE', 'DEADLINE', x.p.prazo], 'a publicação fica tratada com o prazo, como na 059')
  // Pedir a execução fixa o ator da transação; o gatilho devolve o que havia, senão o responsável ficaria sem o aviso do próprio prazo.
  const av = await linhas(db, `select user_id from notifications where related_id = $1 and event_key = $2`, [x.p.prazo, 'prazo-direto:' + x.p.prazo])
  igual(av.map((a) => a.user_id).sort(), [ids.barbara, ids.lucas].sort(), 'aviso do prazo para o responsável e para o advogado do caso')
  igual((await um(db, `select coalesce(current_setting('dg.actor_user_id', true), '') v`)).v, '', 'o ator não vaza da transação')
  igual(await erros061(x.t.run), [], 'nenhum erro na linha do tempo do trabalho')
  const au = await um(db, `select count(*)::int n from audit_events where entity_type = 'process_tasks' and entity_id = $1`, [t.id])
  if (!(au.n >= 1)) throw new Error('sem auditoria da tarefa')
})
await deve('repetição não duplica: a mesma proposta de novo, o criador chamado de novo e a migration rodada de novo deixam UMA tarefa por prazo; o banco recusa uma segunda', async () => {
  const x = t061.a, antes = await automaticas061()
  const r = await propor059(x.t, 'CREATE_DEADLINE', prazo059(x.venc, { description: t061.desc }), 'k-061-direto')
  igual([r.created, r.applied, r.proposal_id], [false, true, x.r.proposal_id], 'a mesma proposta, já aplicada')
  igual((await um(db, `select private.deadline_task_create($1) r`, [x.r.proposal_id])).r, null, 'o criador não cria outra')
  await db.query(`update agent_proposals set status = status where id = $1`, [x.r.proposal_id])
  await rodar061()
  const t = await tarefa061(x.p.prazo)
  igual([t.id, t.status, t.attempts, t.agent_run_id], [t061.tarefaA.id, 'QUEUED', 1, t061.tarefaA.agent_run_id], 'a mesma tarefa, a mesma execução')
  igual(await automaticas061(), antes, 'nenhuma tarefa automática a mais')
  igual((await um(db, `select count(*)::int n from process_events where raw_data ->> 'process_task_id' = $1`, [t.id])).n, 1, 'uma movimentação só')
  await db.query(`insert into process_tasks (legal_process_id, legal_case_id, title, instructions, source_deadline_id) values ($1, $2, 'Segunda', 'Não pode', $3)`,
    [t061.procA, t061.caso, x.p.prazo]).then(() => { throw new Error('segunda tarefa do mesmo prazo foi aceita') },
    (e) => { if (!/process_tasks_source_deadline_key/.test(e.message)) throw e })
})
await deve('caso SEM documento: a tarefa é criada de qualquer jeito, mas fica ABERTA com o aviso "anexe os autos" e nada vai para o orquestrador; documento gerado por agente, arquivado ou excluído não conta', async () => {
  const x = t061.sem = await lancar061(t061.procSem, 4, 'k-061-sem-autos')
  igual([x.r.applied, x.p.status], [true, 'APPLIED'], 'o prazo entra na agenda do mesmo jeito')
  const t = t061.tarefaSem = await tarefa061(x.p.prazo)
  igual([t.status, t.title, t.agent_run_id, t.attempts, t.last_error, t.legal_process_id], ['OPEN', 'Preparar: Réplica à contestação', null, 0, AVISO061.autos, t061.procSem], 'aberta com o aviso')
  const ev = await movimentacao061(t.id)
  igual([ev.source, ev.description, ev.st], ['AGENT', `Criada sozinha a partir do prazo "Réplica à contestação" (vence ${br059(x.venc)}). Ficou aberta: ${AVISO061.autos}`, 'OPEN'], 'movimentação')
  igual((await um(db, `select count(*)::int n from agent_runs where legal_case_id = $1 and operation = 'PROCESS_TASK'`, [t061.casoSem])).n, 0, 'nenhuma execução para o orquestrador')
  // Minuta de agente (mesmo editada depois pela equipe), documento arquivado e documento excluído: o caso continua sem os autos.
  const minuta = await documento061(t061.casoSem, 'Minuta gerada pelo agente', 'AGENT')
  const v2 = randomUUID(), cliSem = (await um(db, `select client_id from legal_cases where id = $1`, [t061.casoSem])).client_id
  await db.query(`insert into document_versions (id, document_id, storage_object_name, source) values ($1, $2, $3, 'MANUAL_EDIT')`, [v2, minuta, `clients/${cliSem}/documents/${minuta}/${v2}/editada.docx`])
  await db.query(`update documents set status = 'ARCHIVED' where id = $1`, [await documento061(t061.casoSem, 'Autos antigos (arquivado)', 'UPLOAD')])
  await db.query(`update documents set deleted_at = now() where id = $1`, [await documento061(t061.casoSem, 'Enviado por engano (excluído)', 'UPLOAD')])
  igual(await temAutos061(t061.casoSem), false, 'só documento de agente, arquivado ou excluído')
  const y = await lancar061(t061.procSem, 4, 'k-061-so-agente', { title: 'Manifestação sobre documentos' })
  const t2 = await tarefa061(y.p.prazo)
  igual([t2.status, t2.title, t2.agent_run_id, t2.last_error], ['OPEN', 'Preparar: Manifestação sobre documentos', null, AVISO061.autos], 'aberta com o aviso')
})
await deve('descrição que começa com "CONFERIR:" (sem diferenciar maiúsculas, ignorando espaços): prazo duvidoso espera uma pessoa — tarefa ABERTA com o aviso, mesmo com os autos no caso', async () => {
  const x = await lancar061(t061.procA, 1, 'k-061-conferir', { title: 'Embargos de declaração', description: '  conferir : não ficou claro se a intimação é para o nosso cliente. Peça: embargos (gabriel-embargos-dg).' })
  igual([x.r.applied, x.p.status], [true, 'APPLIED'], 'o prazo entra na agenda')
  const t = await tarefa061(x.p.prazo)
  igual([t.status, t.title, t.agent_run_id, t.last_error], ['OPEN', 'Preparar: Embargos de declaração', null, AVISO061.conferir], 'aberta para conferir')
  // "Conferir" no meio do texto não segura a tarefa.
  const y = await lancar061(t061.procA, 1, 'k-061-conferir-no-meio', { title: 'Alegações finais', description: 'Prazo comum de 15 dias. Vale conferir: há litisconsorte.' })
  igual((await tarefa061(y.p.prazo)).status, 'QUEUED', 'vai para a fila')
})
await deve('sem orquestrador em vigor: tarefa ABERTA com o motivo; mais de um motivo aparece junto (conferir, autos e orquestrador)', async () => {
  await db.query(`update process_task_settings set orchestrator_agent_id = null where id`)
  await db.query(`update agents set slug = 'orquestrador-fora-061' where slug = 'orquestrador'`)
  try {
    igual((await um(db, `select private.process_task_orchestrator() o`)).o, null, 'sem orquestrador')
    const x = await lancar061(t061.procA, 1, 'k-061-sem-orquestrador', { title: 'Contrarrazões' })
    const t = await tarefa061(x.p.prazo)
    igual([x.p.status, t.status, t.agent_run_id, t.last_error], ['APPLIED', 'OPEN', null, AVISO061.orquestrador], 'aberta: orquestrador não configurado')
    const y = await lancar061(t061.procSem, 4, 'k-061-tudo-junto', { title: 'Impugnação', description: 'CONFERIR: prazo em dobro?' })
    igual((await tarefa061(y.p.prazo)).last_error, [AVISO061.conferir, AVISO061.autos, AVISO061.orquestrador].join(' '), 'todos os motivos')
  } finally {
    await db.query(`update agents set slug = 'orquestrador' where slug = 'orquestrador-fora-061'`)
    await db.query(`update process_task_settings set orchestrator_agent_id = $1 where id`, [t061.orq])
  }
})
await deve('depois de anexar os autos, "Enviar aos agentes" (047) manda a tarefa aberta ao orquestrador e limpa o aviso', async () => {
  await documento061(t061.casoSem, 'Autos do processo', 'UPLOAD')
  igual(await temAutos061(t061.casoSem), true, 'agora o caso tem os autos')
  const s = await como(ids.lucas, async (tx) => (await um(tx, `select public.send_process_task($1) r`, [t061.tarefaSem.id])).r)
  const t = (await tarefas061(t061.sem.p.prazo))[0]
  igual([s.status, t.status, t.attempts, t.last_error, t.agent_run_id], ['QUEUED', 'QUEUED', 1, null, s.agent_run_id], 'na fila')
  const run = await execucao061(t.agent_run_id)
  igual([run.operation, run.agent_id, run.requested_by], ['PROCESS_TASK', t061.orq, ids.lucas], 'execução do orquestrador, pedida por quem enviou')
})
await deve('título e descrição compridos cabem na tarefa (200 e 10 mil, cortados); responsável que não é advogado: quem pede a execução é o advogado do caso', async () => {
  const titulo = 'Manifestação sobre o laudo ' + 'x'.repeat(230)
  const x = await lancar061(t061.procC, 3, 'k-061-comprido', { title: titulo, description: 'Fundamento. ' + 'y'.repeat(12000), priority: 'LOW' })
  igual([x.r.applied, x.p.status], [true, 'APPLIED'], 'prazo direto aplicado')
  igual((await um(db, `select responsible_user_id r from deadlines where id = $1`, [x.p.prazo])).r, ids.ana, 'prazo com a assistente (responsável do processo)')
  const t = await tarefa061(x.p.prazo)
  igual([t.status, t.title, t.priority, t.instructions.length, t.instructions.endsWith('y […cortado]')],
    ['QUEUED', ('Preparar: ' + titulo).slice(0, 199) + '…', 'LOW', 10000, true], 'cortados no limite')
  if (!t.instructions.includes(`\n\nPrazo: ${titulo}\nVencimento: `)) throw new Error('o título inteiro do prazo fica no texto')
  const run = await execucao061(t.agent_run_id)
  igual([run.requested_by, run.txt.length <= 20000], [ids.lucas, true], 'pedida em nome do advogado do caso')
})
await deve('configuração: a tela lê e salva deadline_auto_task; quem não manda a chave não muda nada; só ADMIN. Desligada: o prazo entra na agenda e NENHUMA tarefa é criada', async () => {
  const antes = (await rpc043(ids.lucas, `select public.get_judicial_overview() r`)).settings
  igual([antes.deadline_auto_task, antes.deadline_auto_apply, antes.deadline_agent_id], [true, true, ids.agente], 'lê (ligada)')
  await como(ids.lucas, (tx) => tx.query(`select public.save_judicial_settings('{"deadline_auto_task":false}')`)).then(
    () => { throw new Error('advogado desligou a opção') }, (e) => { if (!/Somente ADMIN/.test(e.message)) throw e })
  igual((await rpc043(ids.barbara, `select public.save_judicial_settings('{"deadline_auto_task":false}') r`)).ok, true, 'ADMIN salva')
  const s = (await rpc043(ids.barbara, `select public.get_judicial_overview() r`)).settings
  igual([s.deadline_auto_task, s.deadline_auto_apply, s.deadline_agent_id, s.djen_enabled, s.datajud_enabled, s.lookback_days],
    [false, true, antes.deadline_agent_id, antes.djen_enabled, antes.datajud_enabled, antes.lookback_days], 'desligada; o resto como estava')
  await rpc043(ids.barbara, `select public.save_judicial_settings($1) r`, [JSON.stringify({ lookback_days: antes.lookback_days, deadline_auto_apply: true })])
  await rpc043(ids.barbara, `select public.save_judicial_settings('{"deadline_auto_task":null}') r`)
  igual((await rpc043(ids.barbara, `select public.get_judicial_overview() r`)).settings.deadline_auto_task, false, 'sem a chave (ou nula): continua desligada')
  const n = await automaticas061()
  const x = await lancar061(t061.procA, 1, 'k-061-desligada', { title: 'Réplica com a opção desligada' })
  igual([x.r.applied, x.p.status, (await tarefas061(x.p.prazo)).length, await automaticas061()], [true, 'APPLIED', 0, n], 'prazo criado, nenhuma tarefa')
  await rpc043(ids.barbara, `select public.save_judicial_settings('{"deadline_auto_task":true}') r`)
  igual((await rpc043(ids.barbara, `select public.get_judicial_overview() r`)).settings.deadline_auto_task, true, 'religada')
})
await deve('prazo aprovado em Revisões (prazo direto desligado) também gera a tarefa — só depois da aprovação; processo sem responsável: a execução é pedida em nome do advogado do caso', async () => {
  await rpc043(ids.barbara, `select public.save_judicial_settings('{"deadline_auto_apply":false}') r`)
  try {
    const n = await automaticas061()
    const x = await lancar061(t061.procB, 2, 'k-061-revisoes', { title: 'Contrarrazões ao recurso', priority: 'URGENT' })
    igual(await automaticas061(), n, 'enquanto a proposta espera em Revisões, nenhuma tarefa')
    const p = await aprovar061(x)
    const t = await tarefa061(p.prazo)
    igual([t.status, t.title, t.priority, t.mesmo_venc, t.legal_process_id, t.created_by, t.last_error],
      ['QUEUED', 'Preparar: Contrarrazões ao recurso', 'URGENT', true, t061.procB, null, null], 'tarefa na fila')
    const run = await execucao061(t.agent_run_id)
    igual([run.operation, run.agent_id, run.requested_by, run.legal_process_id], ['PROCESS_TASK', t061.orq, ids.lucas, t061.procB], 'execução do orquestrador')
    const pub = await publicacao059(x.t)
    igual([pub.st, pub.res, pub.prazo, pub.por], ['DONE', 'DEADLINE', p.prazo, ids.lucas], 'a publicação fica tratada por quem aprovou, como na 043')
    igual(await automaticas061(), n + 1, 'uma tarefa a mais')
  } finally {
    await rpc043(ids.barbara, `select public.save_judicial_settings('{"deadline_auto_apply":true}') r`)
  }
})
await deve('prazo aprovado em Revisões depois de vencido: a tarefa fica ABERTA com o motivo', async () => {
  // Publicação disponibilizada há 60 dias: o dia 1 da lista já passou, e por isso a proposta vai para Revisões (059).
  const x = await lancar061(t061.procA, 1, 'k-061-vencido', { title: 'Prazo que já venceu' }, { disponibilizadaEm: await dia059(-60), dia: 0 })
  igual(x.venc < t061.hoje, true, 'vencimento no passado')
  const p = await aprovar061(x)
  const t = await tarefa061(p.prazo)
  igual([t.status, t.agent_run_id, t.last_error], ['OPEN', null, AVISO061.vencido], 'aberta: vencimento passou')
})
await deve('NÃO geram tarefa: prazo criado à mão pela equipe na tela da publicação; CREATE_DEADLINE de trabalho que não nasceu de publicação (aprovado em Revisões)', async () => {
  const n = await automaticas061()
  const t = await trabalho059(t061.procA, cnj061(1), t061.hoje)
  t061.trabalhos.push(t)
  const h = await rpc043(ids.lucas, `select public.create_deadline_from_publication($1, $2) r`, [t.pub, JSON.stringify({ title: 'Réplica (criado pela equipe)', due_on: t.dias[14] })])
  igual([(await publicacao059(t)).prazo, (await tarefas061(h.deadline_id)).length, await automaticas061()], [h.deadline_id, 0, n], 'prazo da equipe: nenhuma tarefa')
  // Trabalho avulso, pedido por um advogado ao mesmo agente, no mesmo processo.
  const run = (await como(ids.lucas, (tx) => um(tx, `select public.request_agent_run_once($1, $2, $3, $4, 'Conferir o prazo', '{}', 'EXECUTE') r`,
    [randomUUID(), ids.agente, t061.caso, t061.procA]))).r.run_id
  const a = { run, reserva: lease(), proc: t061.procA }
  igual((await reservar040(hA, a.run, a.reserva)).claimed, true, 'trabalho avulso reservado')
  const r = await propor059(a, 'CREATE_DEADLINE', prazo059(t.dias[14], { title: 'Prazo de trabalho avulso' }), 'k-061-avulso')
  const p = await aprovar061({ t: a, r, p: await proposta059(r.proposal_id) })
  igual([(await tarefas061(p.prazo)).length, await automaticas061()], [0, n], 'prazo de trabalho avulso: nenhuma tarefa')
})
await deve('falha ao CRIAR a tarefa não desfaz o prazo nem a proposta: o erro fica na linha do tempo do trabalho; falha ao ENVIAR deixa a tarefa aberta com o motivo', async () => {
  const n = await automaticas061()
  await db.exec(`create function public.falha061() returns trigger language plpgsql as $f$ begin raise exception 'falha simulada 061'; end $f$;
    create trigger falha061 before insert on public.process_tasks for each row when (new.source_deadline_id is not null) execute function public.falha061();`)
  let x
  try {
    x = await lancar061(t061.procA, 1, 'k-061-falha-criar', { title: 'Réplica com falha na tarefa' })
  } finally {
    await db.exec(`drop trigger falha061 on public.process_tasks`)
  }
  igual([x.r.created, x.r.applied, x.p.status, x.p.rev, x.p.revisao], [true, true, 'APPLIED', false, null], 'a proposta continua aplicada, sem ir para Revisões')
  const d = await um(db, `select title, status, legal_process_id from deadlines where id = $1`, [x.p.prazo])
  igual([d.title, d.status, d.legal_process_id], ['Réplica com falha na tarefa', 'OPEN', t061.procA], 'o prazo existe')
  const pub = await publicacao059(x.t)
  igual([pub.st, pub.res, pub.prazo], ['DONE', 'DEADLINE', x.p.prazo], 'a publicação fica tratada com o prazo')
  igual((await linhas(db, `select user_id from notifications where related_id = $1`, [x.p.prazo])).length, 2, 'os avisos do prazo saem')
  igual([(await tarefas061(x.p.prazo)).length, await automaticas061()], [0, n], 'nenhuma tarefa')
  igual(await erros061(x.t.run), ['O prazo foi lançado, mas a tarefa do processo não foi criada: falha simulada 061'], 'erro registrado no trabalho da publicação')
  // Agora a tarefa nasce, mas a fila recusa a execução do orquestrador.
  await db.exec(`create trigger falha061 before insert on public.agent_runs for each row when (new.operation = 'PROCESS_TASK') execute function public.falha061()`)
  let y
  try {
    y = await lancar061(t061.procA, 1, 'k-061-falha-enviar', { title: 'Réplica com falha no envio' })
  } finally {
    await db.exec(`drop trigger falha061 on public.agent_runs; drop function public.falha061();`)
  }
  const t = await tarefa061(y.p.prazo)
  igual([y.p.status, t.status, t.agent_run_id, t.attempts, t.last_error],
    ['APPLIED', 'OPEN', null, 0, 'Não foi possível enviar ao orquestrador (falha simulada 061). Envie a tarefa.'], 'prazo criado; tarefa aberta com o motivo')
  igual(await erros061(y.t.run), [], 'sem erro de criação')
})
await deve('catálogo [061]: funções com search_path fixo e sem porta nova (as duas da tela continuam só para usuário logado); parceiro não lê tarefas nem o vínculo com o prazo', async () => {
  const r = await linhas(db, `select n.nspname || '.' || p.proname f, coalesce(array_to_string(p.proconfig, ','), '') cfg, p.prosecdef def,
      has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('service_role', p.oid, 'execute') srv,
      has_function_privilege('authenticated', p.oid, 'execute') usr, has_function_privilege('dg_worker', p.oid, 'execute') wrk
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = any ($1) order by 1`,
    [['case_has_own_document', 'deadline_task_create', 'agent_proposals_deadline_task', 'get_judicial_overview', 'save_judicial_settings']])
  igual(r.length, 5, 'uma versão de cada função')
  igual(r.filter((x) => !x.cfg.includes('search_path=') || !x.def || x.anon || x.srv || x.wrk).map((x) => x.f), [], 'search_path, definer, sem anon, service_role nem dg_worker')
  igual(r.filter((x) => x.usr).map((x) => x.f), ['private.get_judicial_overview', 'private.save_judicial_settings'], 'usuário logado: só as duas da tela, como na 043')
  await como(ids.barbara, (tx) => tx.query(`select private.deadline_task_create($1)`, [t061.a.r.proposal_id])).then(
    () => { throw new Error('usuário logado chamou o criador da tarefa') }, (e) => { if (!/permission denied/.test(e.message)) throw e })
  igual((await como(ids.almeidaAdm, (tx) => linhas(tx, `select id, source_deadline_id from process_tasks`))).length, 0, 'parceiro não lê')
  igual((await como(ids.lucas, (tx) => linhas(tx, `select id from process_tasks where source_deadline_id = $1`, [t061.a.p.prazo]))).length, 1, 'a equipe lê a tarefa pelo prazo')
  await como(ids.barbara, (tx) => tx.query(`update process_tasks set source_deadline_id = null where id = $1`, [t061.tarefaA.id])).then(
    () => { throw new Error('usuário logado mexeu no vínculo') }, (e) => { if (!/permission denied/.test(e.message)) throw e })
  // Fim do cenário: as tarefas automáticas em aberto ou na fila são canceladas (a execução do orquestrador sai da fila), os trabalhos
  // de publicação ainda reservados terminam e a configuração volta a ser a de antes.
  for (const t of await linhas(db, `select t.id from process_tasks t where t.source_deadline_id is not null and t.status in ('OPEN', 'QUEUED') and t.legal_case_id = any ($1)`, [[t061.caso, t061.casoSem]])) {
    await como(ids.lucas, (tx) => tx.query(`select public.cancel_process_task($1, 'Fim do cenário 061')`, [t.id]))
  }
  igual((await um(db, `select count(*)::int n from agent_runs where operation = 'PROCESS_TASK' and status = 'QUEUED' and legal_case_id = any ($1)`, [[t061.caso, t061.casoSem]])).n, 0, 'nada do cenário fica na fila')
  for (const t of t061.trabalhos) {
    if ((await um(db, `select status from agent_runs where id = $1`, [t.run])).status === 'RUNNING') await ex(`select private.executor_complete($1, $2, $3) r`, [hA, t.run, t.reserva])
  }
  await db.query(`update process_task_settings set orchestrator_agent_id = $1 where id`, [t061.orqAntes])
  await db.query(`update agents set slug = 'orquestrador-fim061', status = 'INACTIVE', deleted_at = now() where id = $1`, [t061.orq])
  await db.query(`update judicial_settings set deadline_agent_id = null where id`)
})

// ═════════════════════════════ fim ═══════════════════════════════════════

console.log(
  falhas === 0
    ? `\n\x1b[32m${total} verificações, todas passaram.\x1b[0m\n`
    : `\n\x1b[31m${falhas} de ${total} verificações falharam.\x1b[0m\n`,
)
await db.close()
process.exit(falhas === 0 ? 0 : 1)
