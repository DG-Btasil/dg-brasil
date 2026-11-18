-- 080 · Vera · Viabilidade recursal entra no kit de agentes do DG Brasil.
--
-- Mesmo molde da 054: o site guarda só o REGISTRO do agente (nome, o agente que
-- ele chama no computador do escritório e as orientações de entrega). As
-- instruções completas ficam no computador do escritório
-- (agentes/bancario/vera-viabilidade-dg.md, instalado por
-- apps/executor/scripts/instalar-agentes-bancario.ps1).
--
-- A Vera lê a decisão, confere cabimento e prazo de embargos, recurso e agravo,
-- busca no DJEN e no DataJud os julgados reais do mesmo tribunal e entrega o
-- parecer de viabilidade. Não redige o recurso: isso continua com o Gabriel,
-- o Rafael e o Paulo, num pedido próprio.
--
-- Regras: nunca sobrescreve (agente com o mesmo slug fica como está, inclusive o
-- que alguém já editou no site); entra ATIVO.

do $$
declare
  v_id uuid;
  v_version uuid;
begin
  if exists (select 1 from public.agents a where a.slug = 'vera-viabilidade-dg') then
    raise notice 'Vera já cadastrada: nada a fazer';
    return;
  end if;
  v_id := gen_random_uuid();
  insert into public.agents (id, slug, name, description, purpose, status)
  values (v_id, 'vera-viabilidade-dg', 'Vera · Viabilidade recursal',
          'Diz se vale a pena recorrer de uma decisão (embargos, recurso inominado, apelação, agravo), com cabimento, prazo e a taxa real de êxito de recursos iguais no mesmo tribunal, tirada do DJEN e do DataJud.',
          'Decidir se recorre, por qual caminho e com que chance, antes de pedir a peça.',
          'DRAFT');
  insert into public.agent_versions (agent_id, instructions, configuration)
  values (v_id,
          concat_ws(E'\n',
            'Como entregar no DG Brasil:',
            '- Trabalhe na pasta do cliente que a sessão informar.',
            '- Dados do cliente: DADOS DO CADASTRO.txt. Quem assina: DADOS DO ESCRITORIO.txt.',
            '- Não pergunte e não espere resposta. O que faltar vira lacuna [COMPLETAR: ...] no texto; o que não der para conferir, [CONFERIR].',
            '- No fim, grave a ficha de revisão (FICHA_REVISAO_*.md, com GERADO, COMPLETAR, DECIDIR, CONFERIR, PRAZO e AVISOS). Cada item de COMPLETAR, DECIDIR e CONFERIR vira uma pendência para o advogado.',
            '- Pedido de refazer: gere a versão _v2 (depois _v3) e mantenha a anterior na pasta.',
            '- Nunca escreva ao cliente nem diga que algo foi enviado ou protocolado: tudo passa por um advogado, em Revisões.',
            '',
            'Precisa da decisão nos autos (AUTOS_*.pdf). Entregue: PARECER_VIABILIDADE_*.html (o DG Brasil converte em PDF) e a ficha FICHA_REVISAO_VIABILIDADE_*. Toda taxa com fonte, período, órgão e número de julgados; todo julgado citado com o link oficial. Não redige o recurso: diga na ficha quem redige cada peça.'),
          jsonb_build_object('local_agent', 'vera-viabilidade-dg'))
  returning id into v_version;
  update public.agents set current_version_id = v_version, status = 'ACTIVE' where id = v_id;
end
$$;
