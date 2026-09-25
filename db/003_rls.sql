-- Núcleo — permissões por papel (Row Level Security).
--
-- O worker de agentes conecta com a service_role, que ignora RLS por natureza.
-- É por isso que o worker precisa da allowlist de ferramentas em `agente.ferramentas`:
-- no banco ele é onipotente, e o limite dele é o código, não a política.
-- O painel conecta sempre como o usuário logado e passa por tudo isto abaixo.

create or replace function papel_atual() returns papel
language sql stable as $$
  select u.papel from usuario u
  where u.auth_id = auth.uid() and u.ativo
$$;

create or replace function usuario_atual() returns uuid
language sql stable as $$
  select u.id from usuario u
  where u.auth_id = auth.uid() and u.ativo
$$;

-- ── quem enxerga o quê ────────────────────────────────────────────
--
-- Regra do escritório: advogado e admin veem tudo. Estagiário vê apenas os
-- casos em que está como responsável — não navega a base inteira de idosos.
-- Financeiro vê dinheiro e o cadastro mínimo, não o conteúdo dos casos.
-- Atendimento vê contatos e conversas, não processos.

alter table contato   enable row level security;
alter table beneficio enable row level security;
alter table caso      enable row level security;
alter table processo  enable row level security;
alter table prazo     enable row level security;
alter table tarefa    enable row level security;
alter table documento enable row level security;
alter table lancamento enable row level security;
alter table conversa  enable row level security;
alter table mensagem  enable row level security;
alter table proposta  enable row level security;
alter table execucao  enable row level security;

-- contato: todos os papéis ativos leem; escrita bloqueada para estagiário
create policy contato_ler on contato for select
  using (papel_atual() is not null);
create policy contato_escrever on contato for all
  using (papel_atual() in ('admin','advogado','atendimento'))
  with check (papel_atual() in ('admin','advogado','atendimento'));

create policy beneficio_ler on beneficio for select
  using (papel_atual() in ('admin','advogado','estagiario','atendimento'));
create policy beneficio_escrever on beneficio for all
  using (papel_atual() in ('admin','advogado'))
  with check (papel_atual() in ('admin','advogado'));

-- caso: estagiário só o que é dele
create policy caso_ler on caso for select
  using (
    papel_atual() in ('admin','advogado')
    or (papel_atual() = 'estagiario' and responsavel_id = usuario_atual())
    or (papel_atual() = 'financeiro')
  );
create policy caso_escrever on caso for all
  using (
    papel_atual() in ('admin','advogado')
    or (papel_atual() = 'estagiario' and responsavel_id = usuario_atual())
  )
  with check (
    papel_atual() in ('admin','advogado')
    or (papel_atual() = 'estagiario' and responsavel_id = usuario_atual())
  );

-- tudo que pende de um caso herda a visibilidade do caso
create policy processo_por_caso on processo for all
  using (exists (select 1 from caso c where c.id = processo.caso_id))
  with check (exists (select 1 from caso c where c.id = processo.caso_id));

create policy prazo_por_processo on prazo for all
  using (exists (select 1 from processo p where p.id = prazo.processo_id))
  with check (exists (select 1 from processo p where p.id = prazo.processo_id));

create policy tarefa_visivel on tarefa for all
  using (
    responsavel_id = usuario_atual()
    or papel_atual() in ('admin','advogado')
    or (caso_id is not null and exists (select 1 from caso c where c.id = tarefa.caso_id))
  )
  with check (papel_atual() is not null);

create policy documento_por_vinculo on documento for all
  using (
    papel_atual() in ('admin','advogado')
    or (caso_id is not null and exists (select 1 from caso c where c.id = documento.caso_id))
    or (contato_id is not null and papel_atual() = 'atendimento')
  )
  with check (papel_atual() in ('admin','advogado','estagiario'));

-- financeiro: só admin e financeiro
create policy lancamento_restrito on lancamento for all
  using (papel_atual() in ('admin','financeiro'))
  with check (papel_atual() in ('admin','financeiro'));

create policy conversa_ler on conversa for all
  using (papel_atual() in ('admin','advogado','atendimento'))
  with check (papel_atual() in ('admin','advogado','atendimento'));

create policy mensagem_por_conversa on mensagem for all
  using (exists (select 1 from conversa c where c.id = mensagem.conversa_id))
  with check (exists (select 1 from conversa c where c.id = mensagem.conversa_id));

-- ── o gate de aprovação ───────────────────────────────────────────
--
-- Quem aprova proposta de agente é quem responde por ela. Estagiário
-- enxerga a fila (é material de aprendizado) mas não carimba.

create policy proposta_ler on proposta for select
  using (papel_atual() is not null);
create policy proposta_decidir on proposta for update
  using (papel_atual() in ('admin','advogado'))
  with check (papel_atual() in ('admin','advogado'));

create policy execucao_ler on execucao for select
  using (papel_atual() is not null);
create policy execucao_disparar on execucao for insert
  with check (papel_atual() in ('admin','advogado','atendimento'));

-- ── auditoria automática de leitura de ficha ──────────────────────
-- Toda vez que alguém abre um contato pelo painel, o painel chama esta função.
-- Não é gatilho de SELECT (Postgres não tem) — é chamada explícita da rota.

create or replace function registrar_acesso(p_contato uuid, p_finalidade text)
returns void language sql security definer as $$
  insert into acesso_dado_pessoal (usuario_id, contato_id, finalidade)
  select usuario_atual(), p_contato, p_finalidade
  where usuario_atual() is not null;
$$;
