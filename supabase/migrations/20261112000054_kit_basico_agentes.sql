-- 054 · Kit básico de agentes do DG Brasil (esteira bancária).
--
-- Os agentes da esteira bancária do escritório foram clonados para o DG Brasil
-- (docs/agentes/clonagem). Esta migration CADASTRA no site os 13 clones e o
-- orquestrador, para eles já aparecerem em DG Brasil → Agentes, sem ninguém
-- precisar cadastrar um por um.
--
-- O site guarda só o REGISTRO de cada agente: o nome, qual agente ele chama no
-- computador do escritório (configuration.local_agent, o name do arquivo .md) e
-- as orientações do DG Brasil (o que entregar). As instruções completas do
-- agente ficam no computador do escritório (agentes/bancario/<nome>-dg.md,
-- instalado por apps/executor/scripts/instalar-agentes-bancario.ps1).
--
-- Regras:
--   - nunca sobrescreve: agente com o mesmo identificador (slug) fica como está,
--     inclusive o que alguém já editou no site;
--   - os agentes entram ATIVOS (o trabalho só roda com a execução ligada e o
--     computador do escritório com os clones instalados);
--   - a Análise Bancária passa a usar a Clara do kit só se ainda não tiver
--     agente. Se já tiver (ex.: a Clara da validação da ponte), a troca é em
--     DG Brasil → Agentes → Clara → Visão geral.

do $$
declare
  v_comum constant text := concat_ws(E'\n',
    'Como entregar no DG Brasil:',
    '- Trabalhe na pasta do cliente que a sessão informar (G:\Meu Drive\DG BRASIL\CLIENTE BANCÁRIO\<NOME DO CLIENTE>).',
    '- Dados do cliente: DADOS DO CADASTRO.txt. Quem assina: DADOS DO ESCRITORIO.txt.',
    '- Não pergunte e não espere resposta. O que faltar vira lacuna [COMPLETAR: ...] no texto; o que não der para conferir, [CONFERIR].',
    '- No fim, grave a ficha de revisão (FICHA_REVISAO_*.md, com GERADO, COMPLETAR, DECIDIR, CONFERIR, PRAZO e AVISOS). Cada item de COMPLETAR, DECIDIR e CONFERIR vira uma pendência para o advogado.',
    '- Pedido de refazer: gere a versão _v2 (depois _v3) e mantenha a anterior na pasta.',
    '- Nunca escreva ao cliente nem diga que algo foi enviado ou protocolado: tudo passa por um advogado, em Revisões.');
  v_kit record;
  v_id uuid;
  v_version uuid;
  v_novos integer := 0;
begin
  for v_kit in
    select * from (values
      ('clara-hiscon-dg', 'Clara · Análise do HISCON',
       'Análise do extrato HISCON/HISCREN: classifica os contratos nos blocos de tese e gera o roteiro de ações e a análise do teto normativo.',
       'Primeiro passo da esteira bancária: dizer quais ações cabem e por quê.',
       'Entregue: ROTEIRO_CONSIGNADO_* e TETO_NORMATIVO_* (o DG Brasil converte o HTML em PDF) e a ficha FICHA_REVISAO_ANALISE_*. Sem viabilidade: gere o roteiro mesmo assim e diga isso na ficha.'),
      ('lucas-procuracao-dg', 'Lucas · Kit do cliente',
       'Procuração, declaração de hipossuficiência, contrato de honorários e, quando o comprovante está em nome de terceiro, declaração de residência, em PDF.',
       'Documentos para o cliente assinar.',
       'Entregue: Procuracao_*.pdf, Declaracao_Hipossuficiencia_*.pdf, Contrato_Honorarios_*.pdf, Declaracao_Residencia_*.pdf e a ficha FICHA_REVISAO_KIT_*. Forma de pagamento do contrato: vale só se estiver no pedido ou no cadastro; sem ela, o contrato fica em DECIDIR.'),
      ('alice-inicial-dg', 'Alice · Petição inicial (fraude de consignado)',
       'Petição inicial de fraude de consignado INSS por bloco de tese (A a H, Caixa, Nemo), com valor da causa, foro e minuta DOCX.',
       'Iniciais da esteira bancária, a partir do roteiro da Clara.',
       'Entregue: MINUTA_INICIAL_*.docx, as planilhas e pareceres da tese (quando houver) e a ficha FICHA_REVISAO_INICIAL_*. A segunda rodada de ações só sai se o pedido mandar.'),
      ('atlas-revisional-dg', 'Atlas · Petição inicial revisional',
       'Petição inicial revisional: empréstimo pessoal pela taxa média do BACEN, consignado de trabalhador CLT e consignado INSS pelo teto normativo.',
       'Revisionais bancárias que não são fraude.',
       'Entregue: MINUTA_INICIAL_REVISIONAL_*.docx, o cálculo e a ficha FICHA_REVISAO_INICIAL_REVISIONAL_*.'),
      ('vicente-agregados-dg', 'Vicente · Produtos agregados',
       'Petição inicial de seguro sem contratação, conta aberta sem autorização e troca do banco pagador sem pedido do titular.',
       'Ações contra a ré que não é o banco do consignado impugnado.',
       'Entregue: MINUTA_INICIAL_*.docx e a ficha FICHA_REVISAO_INICIAL_AGREGADOS_*. Se o produto é do mesmo banco do consignado, diga na ficha que o pedido vai na inicial da Alice.'),
      ('murilo-replica-dg', 'Murilo · Réplica',
       'Réplica ou impugnação à contestação em fraude de consignado e refinanciamento compulsório de RMC, com análise forense por contrato.',
       'Responder à contestação do banco pelos autos.',
       'Precisa dos autos (AUTOS_*.pdf). Entregue: MINUTA_REPLICA_*.docx e a ficha FICHA_REVISAO_REPLICA_*.'),
      ('pedro-provas-dg', 'Pedro · Manifestação em provas',
       'Especificação de provas, manifestação sobre a decisão saneadora, impugnação a documentos e quesitos.',
       'Fase de provas nas ações bancárias.',
       'Precisa dos autos (AUTOS_*.pdf). Entregue: MINUTA_*.docx e a ficha FICHA_REVISAO_PROVAS_*. No Juizado, nunca perícia.'),
      ('teresa-audiencia-dg', 'Teresa · Audiência de instrução',
       'Preparação da audiência de instrução: orientações ao cliente e roteiro do advogado (abertura, perguntas ao preposto, alegações finais).',
       'Preparar o mérito da audiência.',
       'Precisa dos autos (AUTOS_*.pdf). Entregue: MINUTA_AIJ_CLIENTE_*.pdf, MINUTA_AIJ_ADVOGADO_*.pdf e a ficha FICHA_REVISAO_AIJ_*. Nada é enviado ao cliente.'),
      ('laura-emenda-dg', 'Laura · Emenda à inicial',
       'Emenda à inicial e cumprimento de despacho inicial: mapa item a item, cálculo, valor da causa e pendências do cliente.',
       'Responder ao juiz antes da citação.',
       'Precisa do despacho nos autos (AUTOS_*.pdf). Entregue: MINUTA_*.docx e a ficha FICHA_REVISAO_EMENDA_*.'),
      ('rafael-recurso-dg', 'Rafael · Recurso',
       'Recurso inominado, apelação, contrarrazões e recurso adesivo contra sentença nas ações bancárias.',
       'Recorrer da sentença ou responder ao recurso do banco.',
       'Precisa da sentença nos autos (AUTOS_*.pdf). Entregue: MINUTA_*.docx e a ficha FICHA_REVISAO_RECURSO_*.'),
      ('gabriel-embargos-dg', 'Gabriel · Embargos de declaração',
       'Embargos de declaração contra sentença ou acórdão e contrarrazões a embargos do banco.',
       'Corrigir omissão, contradição, obscuridade ou erro material.',
       'Precisa da decisão nos autos (AUTOS_*.pdf). Entregue: MINUTA_*.docx e a ficha FICHA_REVISAO_EMBARGOS_*. Prazo de 5 dias úteis: a data da intimação deve vir no pedido.'),
      ('paulo-agravo-dg', 'Paulo · Agravo',
       'Agravo de instrumento, contraminuta, agravo interno e comunicação do art. 1.018 contra decisão interlocutória.',
       'Atacar decisão interlocutória na Justiça Comum.',
       'Precisa da decisão nos autos (AUTOS_*.pdf). Entregue: MINUTA_*.docx e a ficha FICHA_REVISAO_AGRAVO_*. A comunicação do art. 1.018 é um segundo pedido, com o número do agravo.'),
      ('beatriz-cumprimento-dg', 'Beatriz · Cumprimento de sentença',
       'Cumprimento e liquidação de sentença, resposta à impugnação, depósito do banco e execução dos honorários de sucumbência.',
       'Receber o que a sentença deu.',
       'Precisa do título nos autos (AUTOS_*.pdf). Entregue: MINUTA_*.docx, Memoria_Calculo_*.xlsx e a ficha FICHA_REVISAO_CUMPRIMENTO_*.'),
      ('orquestrador', 'Orquestrador',
       'Recebe as tarefas da lista de afazeres dos processos e decide qual agente do kit faz cada uma.',
       'Distribuir as tarefas dos processos.',
       'Responda só no formato AGENTE / INSTRUÇÕES / OBSERVAÇÕES PARA A EQUIPE. Peça do processo sem os autos: AGENTE: nenhum, dizendo que faltam os autos.')
    ) as k(slug, nome, descricao, objetivo, especifico)
  loop
    continue when exists (select 1 from public.agents a where a.slug = v_kit.slug);
    v_id := gen_random_uuid();
    insert into public.agents (id, slug, name, description, purpose, status)
    values (v_id, v_kit.slug, v_kit.nome, v_kit.descricao, v_kit.objetivo, 'DRAFT');
    insert into public.agent_versions (agent_id, instructions, configuration)
    values (v_id,
            case when v_kit.slug = 'orquestrador' then v_kit.especifico
                 else v_comum || E'\n\n' || v_kit.especifico end,
            jsonb_build_object('local_agent', v_kit.slug))
    returning id into v_version;
    update public.agents set current_version_id = v_version, status = 'ACTIVE' where id = v_id;
    v_novos := v_novos + 1;
  end loop;

  -- Análise Bancária: a Clara do kit, se o modelo ainda não tem agente.
  update public.analysis_templates t
     set primary_agent_id = (select a.id from public.agents a where a.slug = 'clara-hiscon-dg' and a.deleted_at is null)
   where t.name = 'Análise Bancária' and t.primary_agent_id is null;

  raise notice 'Kit básico de agentes: % cadastrado(s)', v_novos;
end
$$;
