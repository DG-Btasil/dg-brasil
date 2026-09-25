import 'server-only'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Uma interface, dois motores.
 *
 * Com `DATABASE_URL` no ambiente, fala com o Postgres de verdade (Supabase).
 * Sem ela, sobe um Postgres em WASM (PGlite) já com o schema e dados de
 * demonstração — o painel abre no navegador sem nuvem nenhuma, o que torna
 * possível desenvolver e revisar telas antes de existir projeto no Supabase.
 *
 * O modo de demonstração é efêmero: reinicia o servidor, perde tudo. É de
 * propósito — ninguém vai confundi-lo com o sistema de verdade.
 */

const RAIZ_DB = join(process.cwd(), '..', '..', 'db')
const ARQUIVOS = ['001_schema.sql', '002_agentes.sql', '004_seed_agentes.sql']

export interface Banco {
  consulta<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  um<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>
  readonly demonstracao: boolean
}

// O Next recarrega módulos a cada edição em dev; sem isto, um PGlite novo por
// recarga (e o banco de demonstração voltaria ao zero a cada salvamento).
const global_ = globalThis as unknown as { __banco?: Promise<Banco> }

export function banco(): Promise<Banco> {
  global_.__banco ??= criar()
  return global_.__banco
}

async function criar(): Promise<Banco> {
  const url = process.env.DATABASE_URL
  return url ? await postgres(url) : await demonstracao()
}

async function postgres(connectionString: string): Promise<Banco> {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString, max: 8 })
  return motor(async (sql, params) => (await pool.query(sql, params)).rows, false)
}

async function demonstracao(): Promise<Banco> {
  const { PGlite } = await import('@electric-sql/pglite')
  const db = new PGlite()

  // 003_rls.sql fica de fora: depende do `auth.uid()` do Supabase e, aqui, a
  // conexão é dona das tabelas — as políticas não teriam efeito de todo jeito.
  for (const arquivo of ARQUIVOS) {
    await db.exec(await readFile(join(RAIZ_DB, arquivo), 'utf8'))
  }
  await db.exec(await dadosDeDemonstracao())

  return motor(async (sql, params) => (await db.query(sql, params)).rows as never[], true)
}

function motor(
  executar: (sql: string, params: unknown[]) => Promise<unknown[]>,
  demo: boolean,
): Banco {
  return {
    demonstracao: demo,
    async consulta<T>(sql: string, params: unknown[] = []) {
      return (await executar(sql, params)) as T[]
    },
    async um<T>(sql: string, params: unknown[] = []) {
      const linhas = (await executar(sql, params)) as T[]
      return linhas[0] ?? null
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
  insert into usuario (nome, email, papel, oab) values
    ('Barbara Cardoso', 'barbara@exemplo.adv.br', 'admin', 'BA 00000'),
    ('Renata Alves', 'renata@exemplo.adv.br', 'estagiario', null);
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
    (ex1, 1, 'ferramenta', 'mcp__nucleo__ver_caso', '{"caso_id":"..."}'::jsonb, '{"documentos":[]}'::jsonb),
    (ex1, 2, 'texto', null, null, '"A pasta está vazia: faltam a procuração e a declaração de hipossuficiência. Vou propor as duas."'::jsonb),
    (ex2, 0, 'ferramenta', 'mcp__nucleo__publicacoes_pendentes', '{"limite":30}'::jsonb, '{"encontradas":1}'::jsonb),
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
`
}
