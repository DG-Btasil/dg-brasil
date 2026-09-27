import 'server-only'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Uma interface, dois motores, dois níveis de acesso.
 *
 * Com `DATABASE_URL`, fala com o Postgres de verdade. Sem ela, sobe um Postgres
 * em WASM (PGlite) com schema e dados fictícios — o painel abre sem nuvem
 * nenhuma, o que permite desenvolver e revisar telas antes de existir Supabase.
 *
 * Os dois níveis importam mais que os dois motores:
 *
 *   consulta()/um()  — conexão dona do banco. Ignora RLS. É o que o login usa,
 *                      porque ele acontece ANTES de existir identidade.
 *   comoUsuario()    — abre transação, vira o papel `painel` (sem bypass) e
 *                      declara quem é o usuário. A partir daí a RLS vale.
 *
 * Toda consulta que serve uma tela passa por `comoUsuario`. Se alguém puxar
 * dados de cliente por `consulta()` direto, as permissões de papel somem sem
 * ninguém perceber — é o erro mais fácil de cometer aqui.
 */

const RAIZ_DB = join(process.cwd(), '..', '..', 'db')
const ARQUIVOS = [
  '001_schema.sql',
  '002_agentes.sql',
  '003_rls.sql',
  '004_seed_agentes.sql',
  '005_auth.sql',
]

export interface Escopo {
  consulta<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  um<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>
}

export interface Banco extends Escopo {
  comoUsuario<T>(usuarioId: string, fn: (db: Escopo) => Promise<T>): Promise<T>
  readonly demonstracao: boolean
}

const global_ = globalThis as unknown as { __banco?: Promise<Banco> }

export function banco(): Promise<Banco> {
  global_.__banco ??= criar()
  return global_.__banco
}

async function criar(): Promise<Banco> {
  const url = process.env.DATABASE_URL
  return url ? await postgres(url) : await demonstracao()
}

function escopo(rodar: (sql: string, params: unknown[]) => Promise<unknown[]>): Escopo {
  return {
    async consulta<T>(sql: string, params: unknown[] = []) {
      return (await rodar(sql, params)) as T[]
    },
    async um<T>(sql: string, params: unknown[] = []) {
      const linhas = (await rodar(sql, params)) as T[]
      return linhas[0] ?? null
    },
  }
}

async function postgres(connectionString: string): Promise<Banco> {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString, max: 8 })
  const dono = escopo(async (sql, params) => (await pool.query(sql, params)).rows)

  return {
    ...dono,
    demonstracao: false,
    async comoUsuario(usuarioId, fn) {
      const cliente = await pool.connect()
      try {
        await cliente.query('begin')
        // Ordem importa: declara a identidade AINDA como dono, e só então
        // baixa para `painel`. Assim ninguém que já esteja em `painel`
        // consegue reescrever quem é — e a RLS passa a valer a partir daqui.
        // `set local` morre com a transação, então nenhuma sobra de identidade
        // volta para o pool junto com a conexão.
        await cliente.query('select set_config($1, $2, true)', ['app.usuario_id', usuarioId])
        await cliente.query('set local role painel')
        const r = await fn(escopo(async (sql, p) => (await cliente.query(sql, p)).rows))
        await cliente.query('commit')
        return r
      } catch (e) {
        await cliente.query('rollback').catch(() => {})
        throw e
      } finally {
        cliente.release()
      }
    },
  }
}

async function demonstracao(): Promise<Banco> {
  const { PGlite } = await import('@electric-sql/pglite')
  const db = new PGlite()

  for (const arquivo of ARQUIVOS) {
    await db.exec(await readFile(join(RAIZ_DB, arquivo), 'utf8'))
  }
  await db.exec(await dadosDeDemonstracao())

  const dono = escopo(async (sql, params) => (await db.query(sql, params)).rows as never[])

  return {
    ...dono,
    demonstracao: true,
    async comoUsuario(usuarioId, fn) {
      return db.transaction(async (tx) => {
        await tx.query('select set_config($1, $2, true)', ['app.usuario_id', usuarioId])
        await tx.query('set local role painel')
        return fn(escopo(async (sql, p) => (await tx.query(sql, p)).rows as never[]))
      }) as Promise<Awaited<ReturnType<typeof fn>>>
    },
  }
}

/** Nomes fictícios, de propósito. Nenhum dado de cliente real vive aqui. */
async function dadosDeDemonstracao(): Promise<string> {
  return `
do $$
declare
  u_barbara uuid; u_estag uuid;
  c1 uuid; c2 uuid; c3 uuid;
  b1 uuid; b2 uuid; b3 uuid;
  k1 uuid; k2 uuid; k3 uuid;
  p1 uuid; p2 uuid;
  ag_lucas uuid; ag_radar uuid;
  ex1 uuid; ex2 uuid;
begin
  -- Senha das duas contas de demonstração: "demo".
  -- Hash gerado pelo mesmo scrypt de apps/web/src/servidor/auth.ts.
  insert into usuario (nome, email, papel, oab, senha_hash, senha_definida_em) values
    ('Barbara Cardoso', 'barbara@exemplo.adv.br', 'admin', 'BA 00000', :hash_demo, now()),
    ('Renata Alves', 'renata@exemplo.adv.br', 'estagiario', null, :hash_demo, now());
  select id into u_barbara from usuario where papel = 'admin';
  select id into u_estag from usuario where papel = 'estagiario';

  insert into contato (nome, cpf_cnpj, nascimento, telefone, is_cliente, origem, criado_por)
  values ('Maria das Dores Siqueira', '11122233344', '1948-03-12', '+5571988880001', true, 'indicação', u_barbara)
  returning id into c1;
  insert into contato (nome, cpf_cnpj, nascimento, telefone, is_cliente, origem, criado_por)
  values ('João Batista Nogueira', '55566677788', '1951-11-02', '+5571988880002', true, 'anúncio', u_barbara)
  returning id into c2;
  insert into contato (nome, cpf_cnpj, nascimento, telefone, is_cliente, origem, criado_por)
  values ('Cibélia Ramos Prado', '99988877766', '1956-07-24', '+5571988880003', false, 'whatsapp', u_barbara)
  returning id into c3;

  insert into beneficio (contato_id, numero_beneficio, especie, dib, valor_mensal, banco_pagador)
  values (c1, '1234567890', '41', '2009-05-01', 1518.00, 'Banco do Brasil') returning id into b1;
  insert into beneficio (contato_id, numero_beneficio, especie, dib, valor_mensal, banco_pagador)
  values (c2, '2234567890', '42', '2013-02-15', 2310.45, 'Caixa') returning id into b2;
  insert into beneficio (contato_id, numero_beneficio, especie, dib, valor_mensal, banco_pagador)
  values (c3, '3234567890', '21', '2018-09-30', 1712.00, 'Bradesco') returning id into b3;

  -- Caso de Cibélia fica com a estagiária: é o que torna visível, na tela, que
  -- a RLS está valendo (ela não enxerga os outros dois).
  insert into caso (contato_id, beneficio_id, titulo, status, responsavel_id, valor_causa)
  values (c1, b1, 'Consignado fraudado — Bloco C (BMG, Itaú)', 'judicializado', u_barbara, 48000.00)
  returning id into k1;
  insert into caso (contato_id, beneficio_id, titulo, status, responsavel_id, valor_causa)
  values (c2, b2, 'Consignado Caixa — Justiça Federal', 'pronto_para_peticionar', u_barbara, 31500.00)
  returning id into k2;
  insert into caso (contato_id, beneficio_id, titulo, status, responsavel_id, valor_causa)
  values (c3, b3, 'Cartão RMC — análise inicial', 'triagem', u_estag, null)
  returning id into k3;

  insert into processo (caso_id, numero_cnj, tribunal, vara, comarca, classe, fase, valor_causa, distribuido_em)
  values (k1, '0801234-56.2026.8.05.0001', 'TJBA', '3ª Vara Cível', 'Salvador',
          'Procedimento Comum', 'conhecimento', 48000.00, '2026-04-18')
  returning id into p1;
  insert into processo (caso_id, numero_cnj, tribunal, vara, comarca, classe, fase, valor_causa, distribuido_em)
  values (k2, '5009876-21.2026.4.01.3300', 'TRF1', '2ª Vara Federal', 'Salvador',
          'Procedimento Comum', 'conhecimento', 31500.00, '2026-08-05')
  returning id into p2;

  insert into movimentacao (processo_id, data, descricao, origem, hash) values
    (p1, current_date - 21, 'Juntada de contestação pelo réu Banco BMG S/A.', 'tribunal', 'h1'),
    (p1, current_date - 40, 'Citação cumprida.', 'tribunal', 'h2'),
    (p2, current_date - 9,  'Distribuído por sorteio.', 'tribunal', 'h3');

  insert into publicacao (processo_id, numero_cnj, diario, data_publicacao, conteudo, oab_destinatario, tratada)
  values (p1, '0801234-56.2026.8.05.0001', 'DJe TJBA', current_date - 3,
          'Intimação da parte autora para, querendo, apresentar réplica à contestação no prazo legal.',
          'BA 00000', false);

  insert into prazo (processo_id, tipo, descricao, data_inicio, dias, dias_uteis, data_fatal, responsavel_id, fonte)
  values
    (p1, 'Réplica', 'Impugnação à contestação do BMG', current_date - 3, 15, true, current_date + 2, u_barbara, 'agente'),
    (p2, 'Emenda à inicial', 'Juntar procuração atualizada', current_date - 1, 15, true, current_date + 11, u_barbara, 'manual');

  insert into tarefa (caso_id, processo_id, titulo, descricao, responsavel_id, prazo_em, prioridade, status)
  values
    (k1, p1, 'Conferir cálculo do dano material', 'Confrontar TED com a coluna LIBERADO do HISCON.', u_estag, now() + interval '1 day', 'alta', 'aberta'),
    (k3, null, 'Ligar para a cliente e pedir o extrato do HISCON', null, u_estag, now() + interval '3 days', 'normal', 'aberta'),
    (k2, p2, 'Protocolar emenda', null, u_barbara, now() + interval '10 days', 'normal', 'fazendo');

  insert into documento (caso_id, contato_id, tipo, nome, caminho_storage, assinado, criado_por) values
    (k1, c1, 'procuracao', 'procuracao-maria.pdf', 'docs/maria/procuracao.pdf', true, u_barbara),
    (k1, c1, 'declaracao_hipossuficiencia', 'declaracao-maria.pdf', 'docs/maria/declaracao.pdf', true, u_barbara),
    (k2, c2, 'hiscon', 'hiscon-joao.pdf', 'docs/joao/hiscon.pdf', false, u_barbara);

  insert into lancamento (tipo, categoria, contato_id, caso_id, descricao, valor, vencimento, pago_em, criado_por)
  values
    ('receita', 'honorario', c1, k1, 'Honorários contratuais — entrada', 1500.00, current_date - 30, current_date - 28, u_barbara),
    ('receita', 'honorario', c2, k2, 'Honorários contratuais — entrada', 1200.00, current_date + 5, null, u_barbara),
    ('despesa', 'custas', null, k2, 'Custas iniciais — Justiça Federal', 320.00, current_date - 5, current_date - 5, u_barbara);

  select id into ag_lucas from agente where slug = 'lucas';
  select id into ag_radar from agente where slug = 'radar';

  insert into execucao (agente_id, gatilho, caso_id, entrada, status, iniciado_em, terminado_em, custo_usd, tokens_entrada, tokens_saida)
  values (ag_lucas, 'cron', k3, '{"pasta":"2. CONTRATO ASSINADO"}'::jsonb, 'aguardando_aprovacao',
          now() - interval '2 hours', now() - interval '2 hours' + interval '48 seconds', 0.1842, 38200, 2900)
  returning id into ex1;
  insert into execucao (agente_id, gatilho, caso_id, entrada, status, iniciado_em, terminado_em, custo_usd, tokens_entrada, tokens_saida)
  values (ag_radar, 'cron', k1, '{}'::jsonb, 'aguardando_aprovacao',
          now() - interval '5 hours', now() - interval '5 hours' + interval '71 seconds', 0.2610, 51100, 4100)
  returning id into ex2;

  insert into passo_execucao (execucao_id, ordem, tipo, ferramenta, entrada, saida) values
    (ex1, 0, 'texto', null, null, '"Vou conferir quais documentos já existem na pasta da cliente antes de gerar qualquer coisa."'::jsonb),
    (ex1, 1, 'ferramenta', 'mcp__dgbrasil__ver_caso', '{"caso_id":"..."}'::jsonb, '{"documentos":[]}'::jsonb),
    (ex1, 2, 'texto', null, null, '"A pasta está vazia: faltam a procuração e a declaração de hipossuficiência. Vou propor as duas."'::jsonb),
    (ex2, 0, 'ferramenta', 'mcp__dgbrasil__publicacoes_pendentes', '{"limite":30}'::jsonb, '{"encontradas":1}'::jsonb),
    (ex2, 1, 'texto', null, null, '"Intimação para réplica. O prazo é de 15 dias úteis; a publicação não diz o termo inicial expressamente, então contei da disponibilização."'::jsonb);

  insert into proposta (execucao_id, tipo, resumo, payload) values
    (ex1, 'criar_documento',
     'Gerar procuração de Cibélia Ramos Prado — a pasta dela não tem nenhuma',
     '{"tipo":"procuracao","nome":"procuracao-cibelia.pdf","caminho_storage":"docs/cibelia/procuracao.pdf"}'::jsonb),
    (ex1, 'criar_documento',
     'Gerar declaração de hipossuficiência de Cibélia Ramos Prado',
     '{"tipo":"declaracao_hipossuficiencia","nome":"declaracao-cibelia.pdf","caminho_storage":"docs/cibelia/declaracao.pdf"}'::jsonb),
    (ex2, 'abrir_prazo',
     'Abrir prazo de réplica no processo de Maria das Dores — vence em 2 dias',
     '{"tipo":"Réplica","dias":15,"dias_uteis":true,"observacao":"termo inicial contado da disponibilização; conferir"}'::jsonb);
end $$;
`.replaceAll(':hash_demo', `'${await hashDemo()}'`)
}

async function hashDemo(): Promise<string> {
  const { hashSenha } = await import('./auth')
  return hashSenha('demo')
}
