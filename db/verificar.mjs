// Executa os arquivos de schema contra um Postgres real (PGlite, em WASM) e
// roda um teste de fumaça no motor de agentes. Sem servidor, sem Docker.
//
//   npm install && npm run verificar
//
// O que isto NÃO cobre: o comportamento real das políticas de RLS (aqui a
// conexão é dona das tabelas e passa por cima delas) e as extensões próprias do
// Supabase. Isso só se confirma no projeto de verdade.

import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'

const ARQUIVOS = [
  '001_schema.sql',
  '002_agentes.sql',
  '003_rls.sql',
  '004_seed_agentes.sql',
]

const db = new PGlite()
let falhas = 0

function ok(msg) {
  console.log(`  \x1b[32m✓\x1b[0m ${msg}`)
}
function erro(msg, e) {
  falhas++
  console.log(`  \x1b[31m✗\x1b[0m ${msg}`)
  if (e) console.log(`    ${String(e.message ?? e).split('\n').join('\n    ')}`)
}

// O Supabase fornece o schema `auth` e a função `auth.uid()`. Fora dele, não
// existem — 003_rls.sql depende dos dois.
console.log('\nPreparando o ambiente (stub do schema auth do Supabase)')
await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid
  language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`)
ok('schema auth e auth.uid() criados')

console.log('\nExecutando os arquivos de schema')
for (const arquivo of ARQUIVOS) {
  try {
    await db.exec(await readFile(new URL(arquivo, import.meta.url), 'utf8'))
    ok(arquivo)
  } catch (e) {
    erro(arquivo, e)
    console.log('\n  Interrompido: os arquivos seguintes dependem deste.\n')
    process.exit(1)
  }
}

console.log('\nTeste de fumaça: cadastro')
let ids = {}
try {
  const r = await db.query(
    `insert into usuario (nome, email, papel) values ('Barbara', 'b@exemplo.com', 'admin')
     returning id`,
  )
  ids.usuario = r.rows[0].id

  const c = await db.query(
    `insert into contato (nome, cpf_cnpj, nascimento, is_cliente, criado_por)
     values ('Maria das Dores', '12345678901', '1948-03-12', true, $1) returning id`,
    [ids.usuario],
  )
  ids.contato = c.rows[0].id

  const b = await db.query(
    `insert into beneficio (contato_id, numero_beneficio, especie, valor_mensal)
     values ($1, '1234567890', '41', 1518.00) returning id`,
    [ids.contato],
  )
  ids.beneficio = b.rows[0].id

  const k = await db.query(
    `insert into caso (contato_id, beneficio_id, titulo, responsavel_id)
     values ($1, $2, 'Consignado fraudado — Bloco C', $3) returning id`,
    [ids.contato, ids.beneficio, ids.usuario],
  )
  ids.caso = k.rows[0].id
  ok('contato → benefício → caso encadeados')
} catch (e) {
  erro('cadastro', e)
}

console.log('\nTeste de fumaça: CPF é chave natural')
try {
  await db.query(`insert into contato (nome, cpf_cnpj) values ('Outra pessoa', '12345678901')`)
  erro('CPF duplicado foi aceito — a restrição unique não está valendo')
} catch {
  ok('CPF duplicado rejeitado')
}

console.log('\nTeste de fumaça: processo e prazo')
try {
  const p = await db.query(
    `insert into processo (caso_id, numero_cnj, tribunal, fase)
     values ($1, '0800123-45.2026.8.05.0001', 'TJBA', 'conhecimento') returning id`,
    [ids.caso],
  )
  ids.processo = p.rows[0].id

  await db.query(
    `insert into prazo (processo_id, tipo, data_inicio, dias, data_fatal, responsavel_id, fonte)
     values ($1, 'réplica', '2026-09-25', 15, '2026-10-16', $2, 'agente')`,
    [ids.processo, ids.usuario],
  )
  const abertos = await db.query(
    `select count(*)::int as n from prazo where status = 'aberto'`,
  )
  if (abertos.rows[0].n === 1) ok('prazo aberto registrado e indexado')
  else erro(`esperava 1 prazo aberto, achei ${abertos.rows[0].n}`)
} catch (e) {
  erro('processo/prazo', e)
}

console.log('\nTeste de fumaça: os cinco agentes do seed')
try {
  const r = await db.query(`select slug, politica_aprovacao from agente order by slug`)
  const slugs = r.rows.map((x) => x.slug)
  const esperados = ['esteira', 'lucas', 'peca', 'radar', 'triagem']
  if (JSON.stringify(slugs) === JSON.stringify(esperados)) ok(`agentes: ${slugs.join(', ')}`)
  else erro(`esperava ${esperados.join(', ')} — achei ${slugs.join(', ')}`)

  const soltos = r.rows.filter((x) => x.politica_aprovacao !== 'humana')
  if (soltos.length === 0) ok('todos os agentes exigem aprovação humana')
  else erro(`agente(s) sem gate humano: ${soltos.map((x) => x.slug).join(', ')}`)
} catch (e) {
  erro('seed de agentes', e)
}

console.log('\nTeste de fumaça: a fila')
try {
  const a = await db.query(`select id from agente where slug = 'lucas'`)
  const e = await db.query(
    `insert into execucao (agente_id, gatilho, caso_id, entrada, solicitado_por)
     values ($1, 'manual', $2, '{"teste":true}'::jsonb, $3) returning id`,
    [a.rows[0].id, ids.caso, ids.usuario],
  )
  ids.execucao = e.rows[0].id

  const r1 = await db.query(`select * from reservar_execucao('worker-teste', 900)`)
  if (r1.rows[0]?.id === ids.execucao) ok('reservar_execucao devolveu a execução pendente')
  else erro('reservar_execucao não devolveu a execução', { message: JSON.stringify(r1.rows) })

  const est = await db.query(
    `select status, tentativas, reservado_por from execucao where id = $1`,
    [ids.execucao],
  )
  const l = est.rows[0]
  if (l.status === 'executando' && l.tentativas === 1 && l.reservado_por === 'worker-teste')
    ok('execução marcada como executando, reservada e com tentativa contada')
  else erro(`estado inesperado: ${JSON.stringify(l)}`)

  const r2 = await db.query(`select * from reservar_execucao('outro-worker', 900)`)
  if (!r2.rows[0]?.id) ok('segundo worker não pegou a mesma execução')
  else erro('a mesma execução foi reservada duas vezes')
} catch (e) {
  erro('fila', e)
}

console.log('\nTeste de fumaça: o gate de aprovação')
try {
  await db.query(
    `insert into proposta (execucao_id, tipo, resumo, payload)
     values ($1, 'criar_documento', 'Gerar procuração de Maria das Dores', $2)`,
    [ids.execucao, JSON.stringify({ tipo: 'procuracao', nome: 'procuracao.pdf' })],
  )
  const p = await db.query(
    `select status from proposta where execucao_id = $1`,
    [ids.execucao],
  )
  if (p.rows[0].status === 'pendente') ok('proposta nasce pendente, não aplicada')
  else erro(`proposta nasceu com status "${p.rows[0].status}"`)

  try {
    await db.query(
      `insert into proposta (execucao_id, tipo, resumo, payload, status)
       values ($1, 'abrir_prazo', 'teste de status inválido', '{}'::jsonb, 'inventado')`,
      [ids.execucao],
    )
    erro('status inválido de proposta foi aceito')
  } catch {
    ok('status fora da máquina de estados é rejeitado')
  }
} catch (e) {
  erro('gate de aprovação', e)
}

console.log('\nTeste de fumaça: o painel aprovando e rejeitando')
try {
  const p = await db.query(
    `select id from proposta where execucao_id = $1 and status = 'pendente' limit 1`,
    [ids.execucao],
  )
  const propostaId = p.rows[0].id

  // É exatamente a consulta do painel (apps/web/src/app/aprovacoes/acoes.ts).
  const aprovar = `update proposta
     set status = 'aprovada', revisado_por = $2, revisado_em = now()
     where id = $1 and status = 'pendente'`

  const r1 = await db.query(aprovar, [propostaId, ids.usuario])
  if (r1.affectedRows === 1) ok('aprovação muda pendente → aprovada')
  else erro(`esperava 1 linha afetada, veio ${r1.affectedRows}`)

  // Clique duplo, ou dois advogados abrindo a fila ao mesmo tempo: a segunda
  // aprovação precisa ser inócua, não um segundo efeito.
  const r2 = await db.query(aprovar, [propostaId, ids.usuario])
  if (r2.affectedRows === 0) ok('aprovar de novo não faz nada (guarda de status)')
  else erro('a mesma proposta foi aprovada duas vezes')

  // Rejeitar o que já saiu de pendente também precisa ser inócuo.
  const r3 = await db.query(
    `update proposta set status = 'rejeitada', comentario = $2
     where id = $1 and status = 'pendente'`,
    [propostaId, 'tarde demais'],
  )
  if (r3.affectedRows === 0) ok('não dá para rejeitar o que já foi aprovado')
  else erro('proposta aprovada foi rejeitada depois')
} catch (e) {
  erro('aprovação/rejeição', e)
}

console.log('\nTeste de fumaça: documento gerado por execução')
try {
  await db.query(
    `insert into documento (caso_id, tipo, nome, caminho_storage, gerado_por_execucao)
     values ($1, 'procuracao', 'procuracao.pdf', 'docs/maria/procuracao.pdf', $2)`,
    [ids.caso, ids.execucao],
  )
  ok('documento vinculado à execução que o gerou')
} catch (e) {
  erro('documento', e)
}

console.log('\nTeste de fumaça: esteira do consignado')
try {
  const ex = await db.query(
    `insert into extrato_hiscon (contato_id, beneficio_id, linhas, importado_por)
     values ($1, $2, 12, $3) returning id`,
    [ids.contato, ids.beneficio, ids.usuario],
  )
  const ct = await db.query(
    `insert into contrato_consignado (extrato_id, numero_contrato, banco_nome, tipo,
                                      situacao, data_inclusao, valor_parcela)
     values ($1, '123456_0001', 'BMG', 'emprestimo', 'excluido', '2023-04-10', 89.90)
     returning id`,
    [ex.rows[0].id],
  )
  await db.query(
    `insert into acao_esteira (caso_id, extrato_id, bloco, rotulo, banco_nome, ano,
                               contratos, motor_versao)
     values ($1, $2, 'C', 'BMG 2023', 'BMG', 2023, $3, 'v7')`,
    [ids.caso, ex.rows[0].id, [ct.rows[0].id]],
  )
  ok('extrato → contrato → ação da esteira (array de uuid funciona)')
} catch (e) {
  erro('esteira', e)
}

console.log('\nTeste de fumaça: worker que morreu')
try {
  await db.query(
    `update execucao set reservado_ate = now() - interval '1 minute' where id = $1`,
    [ids.execucao],
  )
  const r = await db.query(`select liberar_execucoes_expiradas() as n`)
  if (r.rows[0].n === 1) ok('execução presa devolvida à fila')
  else erro(`esperava 1 execução liberada, veio ${r.rows[0].n}`)

  const st = await db.query(`select status from execucao where id = $1`, [ids.execucao])
  if (st.rows[0].status === 'pendente') ok('voltou para pendente (ainda tem tentativas)')
  else erro(`status após liberação: ${st.rows[0].status}`)

  await db.query(
    `update execucao set tentativas = max_tentativas, status = 'executando',
            reservado_ate = now() - interval '1 minute' where id = $1`,
    [ids.execucao],
  )
  await db.query(`select liberar_execucoes_expiradas()`)
  const st2 = await db.query(`select status, erro from execucao where id = $1`, [ids.execucao])
  if (st2.rows[0].status === 'falhou') ok('esgotadas as tentativas, marca como falhou')
  else erro(`esperava falhou, veio ${st2.rows[0].status}`)
} catch (e) {
  erro('recuperação de worker morto', e)
}

console.log('\nTeste de fumaça: auditoria LGPD')
try {
  await db.query(
    `insert into acesso_dado_pessoal (usuario_id, contato_id, finalidade)
     values ($1, $2, 'conferência de procuração')`,
    [ids.usuario, ids.contato],
  )
  await db.query(
    `insert into evento_auditoria (usuario_id, acao, tabela, registro_id, depois)
     values ($1, 'update', 'caso', $2, '{"status":"analise"}'::jsonb)`,
    [ids.usuario, ids.caso],
  )
  ok('registro de acesso a dado pessoal e trilha de auditoria')
} catch (e) {
  erro('auditoria', e)
}

console.log('\nTeste de fumaça: agente novo entra sem tocar em código')
try {
  // Um agente que só usa ferramentas já existentes é um INSERT. Nada além.
  await db.query(
    `insert into agente (slug, nome, modelo, politica_aprovacao, ferramentas, prompt_sistema)
     values ('aniversarios', 'Felicitações de aniversário', 'claude-opus-5', 'humana',
             array['buscar_contato'], 'Você prepara mensagens de aniversário para clientes.')`,
  )
  const a = await db.query(`select id from agente where slug = 'aniversarios'`)
  await db.query(
    `insert into execucao (agente_id, gatilho, entrada) values ($1, 'cron', '{}'::jsonb)`,
    [a.rows[0].id],
  )
  const r = await db.query(`select * from reservar_execucao('worker-teste', 900)`)
  if (r.rows[0]?.agente_id === a.rows[0].id)
    ok('agente recém-cadastrado já é atendido pela mesma fila')
  else erro('a fila não pegou a execução do agente novo')

  const n = await db.query(`select count(*)::int as n from agente`)
  if (n.rows[0].n === 6) ok(`catálogo cresceu para ${n.rows[0].n} agentes sem migração`)
  else erro(`esperava 6 agentes, achei ${n.rows[0].n}`)
} catch (e) {
  erro('agente novo', e)
}

console.log('\nTeste de fumaça: exclusão de contato')
try {
  // Cliente com caso aberto não se apaga por acidente — `on delete restrict`.
  try {
    await db.query(`delete from contato where id = $1`, [ids.contato])
    erro('contato com caso aberto foi apagado — a proteção não está valendo')
  } catch {
    ok('contato com caso aberto é protegido contra exclusão')
  }

  // Apagado o caso, o contato sai e leva junto o que é só dele.
  await db.query(`delete from caso where id = $1`, [ids.caso])
  await db.query(`delete from contato where id = $1`, [ids.contato])
  const r = await db.query(`select count(*)::int as n from beneficio`)
  if (r.rows[0].n === 0) ok('apagado o caso, o contato sai e leva o benefício junto')
  else erro(`sobraram ${r.rows[0].n} benefício(s) órfão(s)`)
} catch (e) {
  erro('exclusão de contato', e)
}

console.log(
  falhas === 0
    ? '\n\x1b[32mSchema de pé.\x1b[0m Todos os testes passaram.\n'
    : `\n\x1b[31m${falhas} falha(s).\x1b[0m\n`,
)
await db.close()
process.exit(falhas === 0 ? 0 : 1)
