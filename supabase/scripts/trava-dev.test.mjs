// node --test scripts/   (npm run test:scripts)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { conferirProjetoDev, refDoProjeto } from './trava-dev.mjs'

const DEV = 'abcdefghijklmnopqrst'
const PROD = 'zyxwvutsrqponmlkjihg'
const base = {
  DG_ENV: 'development',
  DG_DEV_PROJECT_REF: DEV,
  SUPABASE_URL: `https://${DEV}.supabase.co`,
  SUPABASE_DB_URL: `postgresql://postgres:senha@db.${DEV}.supabase.co:5432/postgres`,
  DG_WORKER_DB_URL: `postgresql://dg_worker.${DEV}:senha@aws-1-sa-east-1.pooler.supabase.com:5432/postgres`,
}
const chaves = { obrigatorias: ['SUPABASE_URL', 'SUPABASE_DB_URL'], opcionais: ['DG_WORKER_DB_URL'] }

test('reconhece o projeto no endereço da API, do banco direto e do pooler', () => {
  assert.equal(refDoProjeto(`https://${DEV}.supabase.co`), DEV)
  assert.equal(refDoProjeto(`https://${DEV}.supabase.co/rest/v1/`), DEV)
  assert.equal(refDoProjeto(`postgresql://postgres:s@db.${DEV}.supabase.co:5432/postgres`), DEV)
  assert.equal(refDoProjeto(`postgresql://postgres.${DEV}:s@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`), DEV)
  assert.equal(refDoProjeto(`postgresql://dg_worker.${DEV}:s@aws-1-sa-east-1.pooler.supabase.com:5432/postgres`), DEV)
})

test('endereço que não é do Supabase, incompleto ou disfarçado: não reconhece', () => {
  for (const v of [undefined, '', 'isto não é url', 'http://127.0.0.1:54321', `https://${DEV}.supabase.co.exemplo.dev`,
    `https://exemplo.dev/${DEV}.supabase.co`, 'postgresql://postgres:s@aws-0-sa-east-1.pooler.supabase.com:6543/postgres',
    `https://a.b.${DEV}.supabase.co`, 'https://curto.supabase.co']) {
    assert.equal(refDoProjeto(v), null, String(v))
  }
})

test('tudo do projeto de desenvolvimento: libera', () => {
  assert.deepEqual(conferirProjetoDev(base, chaves), { ok: true, ref: DEV })
  const semWorker = { ...base, DG_WORKER_DB_URL: undefined }
  assert.equal(conferirProjetoDev(semWorker, chaves).ok, true, 'opcional ausente não impede')
})

test('primeira trava: DG_ENV', () => {
  for (const v of [undefined, 'production', 'Development', '']) {
    const r = conferirProjetoDev({ ...base, DG_ENV: v }, chaves)
    assert.equal(r.ok, false)
    assert.match(r.motivo, /DG_ENV precisa ser "development"/)
  }
})

test('segunda trava: sem DG_DEV_PROJECT_REF, ou com valor que não é identificador, recusa', () => {
  assert.match(conferirProjetoDev({ ...base, DG_DEV_PROJECT_REF: undefined }, chaves).motivo, /falta DG_DEV_PROJECT_REF/)
  assert.match(conferirProjetoDev({ ...base, DG_DEV_PROJECT_REF: '  ' }, chaves).motivo, /falta DG_DEV_PROJECT_REF/)
  assert.match(conferirProjetoDev({ ...base, DG_DEV_PROJECT_REF: 'https://x.supabase.co' }, chaves).motivo, /não parece um identificador/)
})

test('chaves de produção com DG_ENV=development (o engano que a trava evita): recusa, em qualquer um dos endereços', () => {
  const api = conferirProjetoDev({ ...base, SUPABASE_URL: `https://${PROD}.supabase.co` }, chaves)
  assert.equal(api.ok, false)
  assert.match(api.motivo, /SUPABASE_URL aponta para OUTRO projeto/)
  const banco = conferirProjetoDev({ ...base, SUPABASE_DB_URL: `postgresql://postgres.${PROD}:s@aws-0-sa-east-1.pooler.supabase.com:6543/postgres` }, chaves)
  assert.match(banco.motivo, /SUPABASE_DB_URL aponta para OUTRO projeto/)
  const worker = conferirProjetoDev({ ...base, DG_WORKER_DB_URL: `postgresql://dg_worker.${PROD}:s@aws-1-sa-east-1.pooler.supabase.com:5432/postgres` }, chaves)
  assert.match(worker.motivo, /DG_WORKER_DB_URL aponta para OUTRO projeto/)
  // O motivo nunca traz o endereço nem a senha.
  for (const r of [api, banco, worker]) assert.doesNotMatch(r.motivo, new RegExp(`${PROD}|senha|postgres:`))
})

test('endereço obrigatório ausente ou irreconhecível: recusa', () => {
  assert.match(conferirProjetoDev({ ...base, SUPABASE_DB_URL: undefined }, chaves).motivo, /variável ausente: SUPABASE_DB_URL/)
  assert.match(conferirProjetoDev({ ...base, SUPABASE_URL: 'http://127.0.0.1:54321' }, chaves).motivo, /não é um endereço do Supabase/)
  assert.equal(conferirProjetoDev(base, {}).ok, false, 'sem endereço para conferir não libera')
})

test('maiúsculas no identificador configurado não atrapalham', () => {
  assert.equal(conferirProjetoDev({ ...base, DG_DEV_PROJECT_REF: DEV.toUpperCase() }, chaves).ok, true)
})
