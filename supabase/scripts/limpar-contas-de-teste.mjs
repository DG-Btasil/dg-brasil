// Apaga do Supabase de DESENVOLVIMENTO as contas criadas pelas rodadas
// automáticas (validar:real e test:integration) e tudo o que elas criaram.
//
//   cd supabase
//   npm run limpar:teste                 simulação: mostra o que sairia e desfaz
//   npm run limpar:teste -- --executar   apaga de verdade
//
// O QUE SAI
//   * Contas com e-mail <rodada>.<papel>@dgbrasil.test, em que <rodada> é "i" ou
//     "r" seguido da hora em base 36 (ex.: imw3qdbkc.lawyer@dgbrasil.test). É o
//     formato que só as rodadas automáticas geram; a senha delas é aleatória e
//     nunca foi gravada.
//   * Escritórios parceiros com a rodada no nome ("Parceiro Int imw3qdbkc 2").
//   * Tudo o que depende dessas contas e escritórios: vínculos, clientes, casos,
//     processos, documentos, avisos, auditoria.
//   * Com --avisos-de-teste: também os avisos JUDICIAL_SYNC_FAILED das contas
//     que ficam (o defeito corrigido na 057 gerou milhares).
//
// O QUE FICA
//   * Qualquer conta fora desse formato: as reais e as fixas de QA (qa.*).
//   * Configuração compartilhada (agentes, teses, materiais, integrações): se
//     foi uma conta de teste que gravou, a autoria passa para --herdeiro.
//
// COMO FUNCIONA
//   O banco não deixa apagar usuário (66 colunas apontam para profiles, todas
//   RESTRICT, mais os gatilhos de imutabilidade). Então, numa transação só:
//     1. desliga gatilhos e chaves (session_replication_role = replica);
//     2. apaga as raízes (perfis e escritórios de teste);
//     3. varre todas as chaves estrangeiras de public/private e resolve o que
//        ficou órfão (apaga, esvazia ou passa ao herdeiro), até não sobrar nada;
//     4. religa as chaves e apaga as contas no Auth;
//     5. confere: nenhuma chave estrangeira órfã e nenhuma linha criada por
//        conta mantida a menos. Se alguma conferência falhar, desfaz tudo.
//        A segunda acusa quando uma conta mantida lançou algo num caso das
//        rodadas automáticas (o caso sai e leva o lançamento junto). Depois de
//        olhar essas linhas na simulação, --aceitar-perdas deixa seguir.
//
// Regras: recusa rodar sem DG_ENV=development; nunca imprime senha nem chave.
// Variáveis: supabase/.env.real (SUPABASE_DB_URL, papel postgres).

import { pathToFileURL } from 'node:url'

/** Contas das rodadas automáticas. */
export const PADRAO_CONTA = '^[ir][0-9a-z]{8}\\.[a-z0-9_.-]+@dgbrasil\\.test$'
/** Escritórios parceiros das rodadas automáticas (a rodada aparece como palavra do nome). */
export const PADRAO_ESCRITORIO = '(^| )[ir][0-9a-z]{8}( |$)'

// Configuração compartilhada: a linha fica e a autoria passa ao herdeiro.
const HERDA = ['agent_versions', 'ai_runtime_settings', 'judicial_settings', 'process_task_settings', 'legal_thesis_versions',
  'reference_material_versions', 'reference_materials', 'skill_versions', 'skill_version_files', 'court_calendar_days',
  'integration_connections']
// Colunas que dizem quem ficou responsável ou quem mexeu depois: a linha é de
// outra pessoa, então fica e a coluna é esvaziada. Qualquer OUTRA coluna que
// aponte para a conta (created_by, requested_by, user_id, actor_user_id…) quer
// dizer que a linha é da conta: sai junto com ela.
const ESVAZIA = ['assigned_lawyer_id', 'responsible_user_id', 'assigned_reviewer_id', 'cancelled_by', 'cancel_requested_by',
  'inactivated_by', 'revoked_by', 'unlinked_by', 'resolved_by', 'confirmed_by', 'triaged_by', 'completed_by', 'accepted_by',
  'updated_by']
// Registros de atividade: sem o caso, o processo ou o pedido a que se referem não
// servem para nada, então saem em vez de ficar com a referência vazia.
const SEM_PAI_SAI = ['notifications', 'agent_runs', 'agent_proposals']

const VARREDURA = `
do $$
declare
  v_heir    uuid := (select id from _heir);
  fk        record;
  v_cond    text;
  v_n       bigint;
  v_changed bigint;
  v_round   integer := 0;
  v_action  text;
begin
  loop
    v_round := v_round + 1;
    v_changed := 0;
    if v_round > 40 then raise exception 'varredura não terminou em 40 voltas'; end if;
    for fk in
      select k.oid, k.conrelid::regclass::text child, c.relname child_name, k.confrelid::regclass::text parent,
             k.confrelid = 'public.profiles'::regclass to_profiles,
             (select relname from pg_class where oid = k.confrelid) parent_name,
             (select array_agg(a.attname order by x.ord) from unnest(k.conkey) with ordinality x(num, ord)
                join pg_attribute a on a.attrelid = k.conrelid and a.attnum = x.num) cols,
             (select array_agg(a.attname order by x.ord) from unnest(k.confkey) with ordinality x(num, ord)
                join pg_attribute a on a.attrelid = k.confrelid and a.attnum = x.num) pcols,
             (select bool_or(not a.attnotnull) from unnest(k.conkey) x(num)
                join pg_attribute a on a.attrelid = k.conrelid and a.attnum = x.num) nullable
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      where k.contype = 'f' and n.nspname in ('public', 'private')
      order by k.conrelid::regclass::text, k.conname
    loop
      select string_agg(format('c.%I is not null', col), ' and ') || ' and not exists (select 1 from ' || fk.parent || ' p where '
             || string_agg(format('p.%I = c.%I', pcol, col), ' and ') || ')'
        into v_cond
        from unnest(fk.cols, fk.pcols) t(col, pcol);
      v_n := 0;
      if fk.to_profiles and fk.child_name = any ($heranca$::text[]) then
        v_action := 'herdeiro';
        execute format('update %s c set %I = $1 where %s', fk.child, fk.cols[1], v_cond) using v_heir;
        get diagnostics v_n = row_count;
      elsif array_length(fk.cols, 1) = 1 and fk.nullable
            and ((fk.to_profiles and fk.cols[1] = any ($esvazia$::text[]))
                 or (not fk.to_profiles and not (fk.child_name = any ($sempai$::text[]) and fk.parent_name <> 'organizations'))) then
        v_action := 'esvaziada';
        begin
          execute format('update %s c set %I = null where %s', fk.child, fk.cols[1], v_cond);
          get diagnostics v_n = row_count;
        exception when check_violation or not_null_violation then
          -- A coluna anda junto com outra (ex.: cancelled_at e cancelled_by).
          if fk.to_profiles then
            v_action := 'herdeiro';
            execute format('update %s c set %I = $1 where %s', fk.child, fk.cols[1], v_cond) using v_heir;
          else
            v_action := 'apagada';
            execute format('delete from %s c where %s', fk.child, v_cond);
          end if;
          get diagnostics v_n = row_count;
        end;
      else
        v_action := 'apagada';
        execute format('delete from %s c where %s', fk.child, v_cond);
        get diagnostics v_n = row_count;
      end if;
      if v_n > 0 then
        v_changed := v_changed + v_n;
        insert into _log (tbl, col, action, n) values (fk.child, array_to_string(fk.cols, ','), v_action, v_n);
      end if;
    end loop;
    exit when v_changed = 0;
  end loop;
  insert into _log (tbl, col, action, n) values ('(voltas da varredura)', '', '', v_round);
end
$$`.replace('$heranca$', `'{${HERDA.join(',')}}'`).replace('$esvazia$', `'{${ESVAZIA.join(',')}}'`).replace('$sempai$', `'{${SEM_PAI_SAI.join(',')}}'`)

// Linhas órfãs em qualquer chave estrangeira de public/private. Tem de dar zero.
const ORFAOS = `
do $$
declare
  fk     record;
  v_cond text;
  v_n    bigint;
begin
  for fk in
    select k.conname, k.conrelid::regclass::text child, k.confrelid::regclass::text parent,
           (select array_agg(a.attname order by x.ord) from unnest(k.conkey) with ordinality x(num, ord)
              join pg_attribute a on a.attrelid = k.conrelid and a.attnum = x.num) cols,
           (select array_agg(a.attname order by x.ord) from unnest(k.confkey) with ordinality x(num, ord)
              join pg_attribute a on a.attrelid = k.confrelid and a.attnum = x.num) pcols
    from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
    where k.contype = 'f' and n.nspname in ('public', 'private')
  loop
    select string_agg(format('c.%I is not null', col), ' and ') || ' and not exists (select 1 from ' || fk.parent || ' p where '
           || string_agg(format('p.%I = c.%I', pcol, col), ' and ') || ')'
      into v_cond from unnest(fk.cols, fk.pcols) t(col, pcol);
    execute format('select count(*) from %s c where %s', fk.child, v_cond) into v_n;
    if v_n > 0 then insert into _orphans (fk, n) values (fk.child || '.' || fk.conname, v_n); end if;
  end loop;
end
$$`

// Linhas com created_by de conta mantida, por tabela (antes e depois).
const CONTAGEM_MANTIDOS = (fase) => `
do $$
declare
  t   record;
  v_n bigint;
begin
  for t in select c.table_name from information_schema.columns c join information_schema.tables b using (table_schema, table_name)
           where c.table_schema = 'public' and c.column_name = 'created_by' and b.table_type = 'BASE TABLE'
  loop
    execute format('select count(*) from public.%I x where x.created_by in (select id from _k)', t.table_name) into v_n;
    insert into _kept (fase, tbl, n) values ('${fase}', t.table_name, v_n);
  end loop;
end
$$`

/**
 * Faz a limpeza dentro da transação já aberta por quem chama. Não confirma nem
 * desfaz: devolve o relatório e `ok` (as duas conferências passaram).
 * @param q            (sql, params?) => linhas
 * @param opcoes.contas        ids das contas a apagar; sem isso, usa PADRAO_CONTA
 * @param opcoes.escritorios   ids dos escritórios a apagar; sem isso, usa PADRAO_ESCRITORIO
 * @param opcoes.herdeiro      id da conta que herda a configuração compartilhada; sem isso, o ADMIN ativo mais antigo
 * @param opcoes.avisosDeTeste também apaga JUDICIAL_SYNC_FAILED das contas mantidas
 * @param opcoes.aceitarPerdas a conferência 2 vira aviso (depois de olhar as linhas na simulação)
 */
export async function limpar(q, opcoes = {}) {
  await q(`create temp table _g (id uuid primary key) on commit drop`)
  await q(`create temp table _o (id uuid primary key) on commit drop`)
  await q(`create temp table _k (id uuid primary key) on commit drop`)
  await q(`create temp table _heir (id uuid primary key) on commit drop`)
  await q(`create temp table _log (seq serial, tbl text, col text, action text, n bigint) on commit drop`)
  await q(`create temp table _orphans (fk text, n bigint) on commit drop`)
  await q(`create temp table _kept (fase text, tbl text, n bigint) on commit drop`)
  await q(`create temp table _sizes (fase text, tbl text, n bigint) on commit drop`)

  if (opcoes.contas) await q(`insert into _g select unnest($1::uuid[])`, [opcoes.contas])
  else await q(`insert into _g select id from auth.users where email ~ $1`, [PADRAO_CONTA])
  if (opcoes.escritorios) await q(`insert into _o select unnest($1::uuid[])`, [opcoes.escritorios])
  else {
    // Escritório de teste: a rodada no nome e nenhuma conta mantida vinculada.
    await q(`insert into _o select o.id from public.organizations o where o.type = 'PARTNER' and o.name ~ $1
               and not exists (select 1 from public.organization_memberships m where m.organization_id = o.id and m.user_id not in (select id from _g))`,
      [PADRAO_ESCRITORIO])
  }
  await q(`insert into _k select p.id from public.profiles p where p.id not in (select id from _g)`)

  if (opcoes.herdeiro) await q(`insert into _heir values ($1)`, [opcoes.herdeiro])
  else {
    await q(`insert into _heir select m.user_id from public.organization_memberships m
               join public.organizations o on o.id = m.organization_id and o.type = 'OWNER'
               join public.profiles p on p.id = m.user_id and p.active
              where m.role = 'ADMIN' and m.status = 'ACTIVE' and m.user_id in (select id from _k)
              order by m.created_at limit 1`)
  }
  const herdeiro = (await q(`select h.id, (select email from auth.users u where u.id = h.id) email from _heir h`))[0]
  if (!herdeiro) throw new Error('Sem herdeiro: nenhum ADMIN ativo entre as contas mantidas. Indique um com --herdeiro <e-mail>.')
  if ((await q(`select 1 from _g where id = $1`, [herdeiro.id])).length) throw new Error('O herdeiro está na lista de contas a apagar.')

  const mantidas = await q(`
    select u.email, u.last_sign_in_at, u.created_at,
           (select string_agg(m.role || case when m.status <> 'ACTIVE' then ' (' || m.status || ')' else '' end || ' · ' || o.name, '; ')
              from public.organization_memberships m join public.organizations o on o.id = m.organization_id where m.user_id = u.id) vinculos
      from auth.users u where u.id not in (select id from _g) order by u.created_at`)
  const contas = (await q(`select count(*)::int n from _g`))[0].n
  const escritorios = (await q(`select count(*)::int n from _o`))[0].n

  const TAMANHOS = (fase) => `
    do $$
    declare t record; v_n bigint;
    begin
      for t in select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where c.relkind = 'r' and n.nspname in ('public', 'private') loop
        execute format('select count(*) from %I.%I', t.nspname, t.relname) into v_n;
        insert into _sizes (fase, tbl, n) values ('${fase}', t.relname, v_n);
      end loop;
    end
    $$`
  await q(TAMANHOS('antes'))
  await q(CONTAGEM_MANTIDOS('antes'))

  await q(`set local session_replication_role = replica`)
  if (opcoes.avisosDeTeste) {
    const r = await q(`with d as (delete from public.notifications where type = 'JUDICIAL_SYNC_FAILED' returning 1) select count(*)::int n from d`)
    await q(`insert into _log (tbl, col, action, n) values ('notifications', 'type = JUDICIAL_SYNC_FAILED', 'apagada', $1)`, [r[0].n])
  }
  // Avisos primeiro: é a tabela grande, e sair daqui poupa a varredura.
  await q(`delete from public.notifications where user_id in (select id from _g)`)
  await q(`delete from public.profiles where id in (select id from _g)`)
  await q(`delete from public.organizations where id in (select id from _o)`)
  await q(VARREDURA)
  await q(`set local session_replication_role = origin`)
  // No Auth as chaves cuidam do resto (identidades, sessões, fatores de MFA).
  await q(`delete from auth.sessions where user_id in (select id from _g)`)
  await q(`delete from auth.mfa_factors where user_id in (select id from _g)`)
  await q(`delete from auth.users where id in (select id from _g)`)

  await q(ORFAOS)
  await q(CONTAGEM_MANTIDOS('depois'))
  await q(TAMANHOS('depois'))

  const orfaos = await q(`select fk, n from _orphans order by fk`)
  const perdas = await q(`select a.tbl, a.n antes, d.n depois from _kept a join _kept d on d.tbl = a.tbl and d.fase = 'depois'
                           where a.fase = 'antes' and d.n < a.n order by a.tbl`)
  const tabelas = await q(`select a.tbl, a.n antes, d.n depois, a.n - d.n apagadas from _sizes a join _sizes d on d.tbl = a.tbl and d.fase = 'depois'
                            where a.fase = 'antes' and a.n <> d.n order by a.n - d.n desc`)
  const acoes = await q(`select tbl, col, action, sum(n)::bigint n from _log where action in ('herdeiro', 'esvaziada') group by 1, 2, 3 order by 4 desc`)
  const voltas = (await q(`select n from _log where tbl = '(voltas da varredura)'`))[0]?.n
  const restam = await q(`select o.name, o.status from public.organizations o where o.type = 'PARTNER' order by o.name`)
  return { ok: orfaos.length === 0 && (perdas.length === 0 || opcoes.aceitarPerdas === true), contas, escritorios, herdeiro: herdeiro.email ?? herdeiro.id, mantidas, tabelas, acoes, orfaos, perdas, voltas, parceirosQueFicam: restam }
}

export function imprimir(r) {
  const n = (x) => Number(x).toLocaleString('pt-BR')
  console.log(`\nContas a apagar: ${n(r.contas)} · escritórios parceiros a apagar: ${n(r.escritorios)} · herdeiro da configuração: ${r.herdeiro}`)
  console.log(`\nContas que FICAM (${r.mantidas.length}):`)
  for (const u of r.mantidas) {
    console.log(`  ${String(u.email).padEnd(42)} último login: ${u.last_sign_in_at ? new Date(u.last_sign_in_at).toISOString().slice(0, 10) : 'nunca     '}  ${u.vinculos ?? 'sem vínculo'}`)
  }
  console.log(`\nEscritórios parceiros que FICAM (${r.parceirosQueFicam.length}):`)
  for (const o of r.parceirosQueFicam.slice(0, 40)) console.log(`  ${o.name} (${o.status})`)
  if (r.parceirosQueFicam.length > 40) console.log(`  … e mais ${r.parceirosQueFicam.length - 40}`)
  console.log(`\nLinhas por tabela (antes → depois), em ${r.voltas} voltas da varredura:`)
  for (const t of r.tabelas) console.log(`  ${t.tbl.padEnd(40)} ${n(t.antes).padStart(9)} → ${n(t.depois).padStart(9)}   (-${n(t.apagadas)})`)
  if (r.acoes.length) {
    console.log(`\nLinhas mantidas com referência ajustada:`)
    for (const a of r.acoes) console.log(`  ${(a.tbl + '.' + a.col).padEnd(52)} ${a.action.padEnd(10)} ${n(a.n)}`)
  }
  console.log(`\nConferência 1, chaves estrangeiras órfãs: ${r.orfaos.length === 0 ? 'nenhuma' : 'FALHOU'}`)
  for (const o of r.orfaos) console.log(`  ${o.fk}: ${n(o.n)}`)
  console.log(`Conferência 2, linhas criadas por contas mantidas: ${r.perdas.length === 0 ? 'todas preservadas' : r.ok ? 'há perdas, aceitas com --aceitar-perdas' : 'FALHOU'}`)
  for (const p of r.perdas) console.log(`  ${p.tbl}: ${n(p.antes)} → ${n(p.depois)}`)
}

// ───────────────────────────── linha de comando ─────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = (k) => {
    const v = process.env[k]
    if (!v) { console.error(`variável ausente: ${k}`); process.exit(2) }
    return v
  }
  // Duas travas (scripts/trava-dev.mjs): DG_ENV=development E o banco tem de ser o do
  // projeto de desenvolvimento declarado em DG_DEV_PROJECT_REF.
  const { exigirProjetoDev } = await import('./trava-dev.mjs')
  exigirProjetoDev(process.env, { obrigatorias: ['SUPABASE_DB_URL'] })
  const args = process.argv.slice(2)
  const executar = args.includes('--executar')
  const avisosDeTeste = args.includes('--avisos-de-teste')
  const aceitarPerdas = args.includes('--aceitar-perdas')
  const emailHerdeiro = args.includes('--herdeiro') ? args[args.indexOf('--herdeiro') + 1] : null

  const { default: pg } = await import('pg')
  const c = new pg.Client({ connectionString: env('SUPABASE_DB_URL'), ssl: { rejectUnauthorized: false } })
  await c.connect()
  const q = async (sql, params) => (await c.query(sql, params)).rows
  let codigo = 0
  try {
    await q(`set statement_timeout = 0`)
    await q(`set lock_timeout = '15s'`)
    await q(`begin`)
    let herdeiro
    if (emailHerdeiro) {
      herdeiro = (await q(`select id from auth.users where lower(email) = lower($1)`, [emailHerdeiro]))[0]?.id
      if (!herdeiro) throw new Error(`--herdeiro: não existe conta com o e-mail ${emailHerdeiro}`)
    }
    const r = await limpar(q, { herdeiro, avisosDeTeste, aceitarPerdas })
    imprimir(r)
    if (!r.ok) {
      await q(`rollback`)
      console.log('\nNada foi apagado: uma conferência falhou e a transação foi desfeita.')
      codigo = 1
    } else if (!executar) {
      await q(`rollback`)
      console.log('\nSimulação: nada foi apagado. Para apagar de verdade: npm run limpar:teste -- --executar')
    } else {
      await q(`commit`)
      console.log('\nApagado. Devolvendo o espaço das tabelas maiores…')
      for (const t of ['public.notifications', 'public.audit_events']) await q(`vacuum (full, analyze) ${t}`)
      await q(`analyze`)
      console.log('Pronto.')
    }
  } catch (e) {
    await q(`rollback`).catch(() => {})
    console.error(`\nFalhou e nada foi apagado: ${e.message}`)
    codigo = 1
  } finally {
    await c.end()
  }
  process.exit(codigo)
}
