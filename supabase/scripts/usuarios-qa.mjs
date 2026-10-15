// Usuários FIXOS para o QA manual no Supabase de DESENVOLVIMENTO (Etapa 4.3).
//
//   cd supabase
//   PowerShell:  $env:QA_SENHA = 'sua-senha-de-teste'; npm run usuarios:qa
//   Bash:        QA_SENHA='sua-senha-de-teste' npm run usuarios:qa
//
// Cria (ou reaproveita) os escritórios parceiros "Parceiro QA A" e "Parceiro QA
// B" e seis usuários @dgbrasil.test, todos com a senha QA_SENHA. Rodar de novo
// não duplica nada: só redefine a senha e confere os vínculos. Termos e MFA
// ficam para o primeiro login, pelo próprio app (como um usuário de verdade).
//
// Os usuários das rodadas automáticas (validar:real, test:integration) têm
// senha aleatória que nunca é gravada; estes aqui existem só para o QA.
//
// Regras: recusa rodar sem DG_ENV=development; nunca imprime senha nem chave.
// Variáveis: supabase/.env.real (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) e
// QA_SENHA no ambiente do terminal.

import { createClient } from '@supabase/supabase-js'

const env = (k) => {
  const v = process.env[k]
  if (!v) { console.error(`variável ausente: ${k}`); process.exit(2) }
  return v
}
if (env('DG_ENV') !== 'development') {
  console.error('Recusado: DG_ENV precisa ser "development". Este script nunca roda em produção.')
  process.exit(2)
}
const SENHA = env('QA_SENHA')
// Mesma política do app (apps/frontend/src/lib/auth/password-policy.ts).
if (SENHA.length < 8 || !/[a-z]/.test(SENHA) || !/[A-Z]/.test(SENHA) || !/[0-9]/.test(SENHA)) {
  console.error('QA_SENHA precisa de ao menos 8 caracteres, com letras maiúsculas, minúsculas e números.')
  process.exit(2)
}

const service = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
})
const r = async (p, oque) => {
  const { data, error } = await p
  if (error) throw new Error(`${oque}: ${error.code ?? ''} ${error.message}`)
  return data
}

const USUARIOS = [
  { email: 'qa.advogado@dgbrasil.test', nome: 'QA Advogado', papel: 'LAWYER', org: 'owner' },
  { email: 'qa.assistente@dgbrasil.test', nome: 'QA Assistente', papel: 'ASSISTANT', org: 'owner' },
  { email: 'qa.parceiro-a.admin@dgbrasil.test', nome: 'QA Admin Parceiro A', papel: 'PARTNER_ADMIN', org: 'A' },
  { email: 'qa.parceiro-a.usuario@dgbrasil.test', nome: 'QA Usuário Parceiro A', papel: 'PARTNER_USER', org: 'A' },
  { email: 'qa.parceiro-b.admin@dgbrasil.test', nome: 'QA Admin Parceiro B', papel: 'PARTNER_ADMIN', org: 'B' },
  { email: 'qa.parceiro-b.usuario@dgbrasil.test', nome: 'QA Usuário Parceiro B', papel: 'PARTNER_USER', org: 'B' },
]

const owner = await r(service.from('organizations').select('id, name').eq('type', 'OWNER').is('deleted_at', null).single(), 'escritório proprietário')
const orgs = { owner: owner.id }
const nomes = { owner: owner.name }

for (const letra of ['A', 'B']) {
  const nome = `Parceiro QA ${letra}`
  const existente = await r(
    service.from('organizations').select('id').eq('type', 'PARTNER').eq('name', nome).is('deleted_at', null).maybeSingle(),
    nome,
  )
  if (existente) {
    orgs[letra] = existente.id
  } else {
    const org = await r(service.from('organizations').insert({ type: 'PARTNER', name: nome, status: 'ACTIVE' }).select('id').single(), nome)
    await r(
      service.from('partner_office_settings').insert({ organization_id: org.id, default_partner_percentage: 40, default_owner_percentage: 60 }),
      `divisão ${nome}`,
    )
    orgs[letra] = org.id
  }
  nomes[letra] = nome
}

// E-mail → id dos usuários já existentes (o Auth não busca por e-mail).
const porEmail = new Map()
for (let page = 1; ; page++) {
  const { users } = await r(service.auth.admin.listUsers({ page, perPage: 1000 }), 'usuários')
  for (const u of users) if (u.email) porEmail.set(u.email.toLowerCase(), u.id)
  if (users.length < 1000) break
}

const linhas = []
for (const u of USUARIOS) {
  let id = porEmail.get(u.email)
  if (id) {
    await r(service.auth.admin.updateUserById(id, { password: SENHA }), `senha ${u.email}`)
  } else {
    const d = await r(
      service.auth.admin.createUser({ email: u.email, password: SENHA, email_confirm: true, user_metadata: { full_name: u.nome } }),
      `usuário ${u.email}`,
    )
    id = d.user.id
  }
  const vinculo = await r(
    service.from('organization_memberships').select('organization_id, role, status').eq('user_id', id).eq('status', 'ACTIVE').maybeSingle(),
    `vínculo ${u.email}`,
  )
  if (!vinculo) {
    await r(service.from('organization_memberships').insert({ organization_id: orgs[u.org], user_id: id, role: u.papel }), `vínculo ${u.email}`)
  } else if (vinculo.organization_id !== orgs[u.org] || vinculo.role !== u.papel) {
    throw new Error(`${u.email} já tem outro vínculo ativo; confira em organization_memberships antes de seguir`)
  }
  linhas.push([u.email, u.papel, nomes[u.org], porEmail.has(u.email) ? 'senha redefinida' : 'criado'])
}

console.log('\nUsuários de QA (senha = QA_SENHA; MFA e termos no primeiro login):\n')
for (const [email, papel, org, situacao] of linhas) console.log(`  ${email.padEnd(38)} ${papel.padEnd(14)} ${org.padEnd(22)} ${situacao}`)
console.log('')
