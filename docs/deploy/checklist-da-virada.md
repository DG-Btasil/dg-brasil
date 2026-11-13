# Checklist do dia da virada

A ordem para pôr o DG Brasil em uso real, num lugar só. Cada passo aponta o
documento que explica como fazer. Os passos estavam espalhados em
[producao.md](producao.md), [organizacao-pre-producao.md](organizacao-pre-producao.md)
(seção 7), [supabase/README.md](../../supabase/README.md),
[docs/auth.md](../auth.md), [docs/mcp/instalacao.md](../mcp/instalacao.md) e
[docs/mcp/google-drive.md](../mcp/google-drive.md). Os marcados **[novo]** vieram
da revisão final de 13/11/2026 e não estavam em nenhum.

**Regra de ordem:** primeiro o banco, depois o site, depois o computador do
escritório. O site publicado antes do banco pronto mostra erro para todo mundo.

Marque cada passo quando terminar. Se um passo falhar, pare: não pule.

## Antes do dia

- [ ] **1. Contratar:** Vercel Pro, Supabase Pro, Zoho Mail com SMTP, Claude
  Team ou Enterprise e a Consulta CPF do Serpro
  ([producao.md](producao.md), itens 1, 3, 5, 7 e 12).
- [ ] **2. Textos jurídicos definitivos** dos termos de uso e da política de
  privacidade, com versão nova em
  `apps/frontend/src/lib/auth/legal-documents.ts`
  ([producao.md](producao.md), item 9; [docs/auth.md](../auth.md)).
- [ ] **3. Revisão LGPD** do provedor de IA e do Google Drive
  ([producao.md](producao.md), itens 7 e 9).
- [ ] **4. Next.js atualizado e `npm run check` passando.** Feito em 13/11/2026
  (Next.js 16.4.6, commit `ee1e831`). Repetir o `npm run check` no commit que
  vai para a produção. **[novo]**
- [ ] **5. Ensaiar todas as migrations num projeto vazio** e apagar o projeto
  depois ([organizacao-pre-producao.md](organizacao-pre-producao.md), seções 4 e 7).
- [ ] **6. Fechar as validações pendentes:** clones, Google Drive e prazo direto
  ao vivo ([producao.md](producao.md), itens 2 e 14;
  [docs/mcp/validacao.md](../mcp/validacao.md)).
- [ ] **7. Decidir as pendências de robustez** de
  [docs/backend.md](../backend.md), "Hardening pendente por domínio"
  ([producao.md](producao.md), item 9).
- [ ] **8. Cópia de segurança dos documentos:** decidir o destino, decidir se
  contrata o PITR do Supabase e **ensaiar uma restauração**
  ([producao.md](producao.md), item 15;
  [restauracao-dos-documentos.md](restauracao-dos-documentos.md)). **[novo]**
- [ ] **9. Monitoramento:** escolher o monitor que consulta `/api/health` e o
  destino dos erros (`ERROR_WEBHOOK_URL`)
  ([producao.md](producao.md), item 16). **[novo]**
- [ ] **10. Pedido de titular de dados:** ler e ajustar o procedimento
  ([pedido-de-titular.md](pedido-de-titular.md)). **[novo]**

## Banco de produção

- [ ] **11. Criar o projeto** em São Paulo, plano Pro, com a máquina escolhida
  ([producao.md](producao.md), item 3;
  [organizacao-pre-producao.md](organizacao-pre-producao.md), seção 3).
- [ ] **12. Ligar as extensões** `pgmq`, `pg_cron` e `pg_net` em Database →
  Extensions ([supabase/README.md](../../supabase/README.md), "Aplicar no
  Supabase"; [producao.md](producao.md), itens 3 e 10).
- [ ] **13. `supabase link` e `supabase db push`:** todas as migrations, em
  ordem ([supabase/README.md](../../supabase/README.md);
  [producao.md](producao.md), item 3).
- [ ] **14. Conferir os agendamentos:**

  ```sql
  select jobname, schedule from cron.job order by jobname;
  ```

  Esperado, no mínimo: `dg-expurgo-de-pedidos`, `dg-importacoes`, `dg-judicial`,
  `dg-lembretes-de-prazo`, `dg-limpeza-do-agendador`, `dg-manutencao` e
  `dg-vigia-da-plataforma`, mais os que as outras migrations da revisão final
  criarem (o cabeçalho de cada uma diz). `dg-deadline-reminders` **não** deve
  aparecer ([organizacao-pre-producao.md](organizacao-pre-producao.md), seção 7).
- [ ] **15. Criar a senha do `dg_worker`**
  ([supabase/README.md](../../supabase/README.md), "Papel do servidor").
- [ ] **16. Configurar o Auth:** cadastro aberto desligado, política de senha,
  TOTP, proteção contra senha vazada, tempo de sessão, SMTP e modelos de
  e-mail. Em URL Configuration, **só** estes endereços, sem `localhost` e sem
  curinga no nome do site: Site URL `https://app.dgbrasil.adv.br`; Redirect URLs
  `https://app.dgbrasil.adv.br/auth/confirm**` e
  `https://portal.dgbrasil.adv.br/auth/confirm**`
  ([docs/auth.md](../auth.md), "Supabase Auth";
  [producao.md](producao.md), itens 4, 5 e 6).
- [ ] **17. E-mails do sistema:** preencher `supportEmail`, rodar
  `npm run emails` e colar os modelos no painel
  ([producao.md](producao.md), item 5).
- [ ] **18. Segredos do cofre** `dg_app_url` e `dg_cron_secret`, e testar
  `select private.judicial_cron_kick();`
  ([producao.md](producao.md), item 10).
- [ ] **19. Criar a primeira administradora**
  ([supabase/README.md](../../supabase/README.md), "Primeira administradora").
  Depois do passo 24, criar também uma **segunda conta de administrador**: quem
  redefine a verificação em duas etapas de uma pessoa é outro administrador, e
  ninguém altera o próprio acesso ([docs/auth.md](../auth.md)). Com uma conta
  só, perder o celular é perder o acesso. **[novo]**
- [ ] **20. Conferir que não há usuário nem escritório de teste**
  ([organizacao-pre-producao.md](organizacao-pre-producao.md), seção 7, item 6).

## Site (sempre depois do banco)

- [ ] **21. Variáveis do ambiente Production na Vercel**, conforme a tabela de
  [producao.md](producao.md), item 8. Conferir também as que devem estar
  **ausentes**: `SERPRO_CPF_TRIAL`, `SERPRO_CPF_TRIAL_TOKEN`,
  `NEXT_PUBLIC_DEMO_MODE` e `AUTH_FALLBACK_SITE_URL`. **[novo]**
- [ ] **22. `vercel.json`:** Google Drive a cada 15 minutos e os textos de
  frequência ([producao.md](producao.md), itens 2 e 10).
- [ ] **23. Novo deploy** (as variáveis `NEXT_PUBLIC_` entram no build) e
  conferir os agendamentos em Settings → Cron Jobs
  ([producao.md](producao.md), itens 2 e 12).
- [ ] **23a. Conferir a subida.** `https://app.dgbrasil.adv.br/api/health`
  responde `{"status":"ok","database":"ok"}`. Nos logs da Vercel não há linha
  `env.check` com `"level":"error"` (cada uma diz o nome da variável que falta)
  ([producao.md](producao.md), item 16). **[novo]**

## Dentro do site

- [ ] **24. Primeiro login** da administradora: termos e verificação em duas
  etapas ([supabase/README.md](../../supabase/README.md)).
- [ ] **25. Convite de teste e redefinição de senha:** os dois e-mails chegam,
  fora do spam ([producao.md](producao.md), item 5).
- [ ] **26. Cadastrar o escritório, a equipe e os parceiros.** A produção é um
  projeto novo: nada vem do banco de teste. **[novo]**
- [ ] **27. A administradora cadastra a própria OAB** em Minha conta → Minhas
  OABs. Achado da revisão final: sem isso ela não aparece como advogada
  responsável. Conferir escolhendo-a como responsável de um caso. **[novo]**
- [ ] **28. Integração judicial**, nesta ordem: OABs acompanhadas; feriados
  locais e suspensões do tribunal no Calendário de prazos (a contagem já traz os
  feriados nacionais, a Sexta-feira Santa e o recesso; **Carnaval e Corpus
  Christi não estão na base** e entram aqui, se o tribunal suspender); agente de
  prazos; "prazo entra direto na agenda"; "prazo vira tarefa". Só então ligar
  DJEN e DataJud ([docs/judicial.md](../judicial.md);
  [producao.md](producao.md), itens 10 e 14).
- [ ] **29. Google Drive:** pasta dos clientes e as ligações das pastas
  ([docs/mcp/google-drive.md](../mcp/google-drive.md), seções 2 e 5). Advogado
  só liga pasta de dentro da pasta dos clientes; de fora, só a administradora.
- [ ] **30. Sequência automática** (análise aprovada chama os próximos
  agentes): ainda não tem tela, a configuração é por SQL
  ([pos-mvp.md](pos-mvp.md), item 5).
- [ ] **31. Consulta de CPF** conferida com um cliente real
  ([producao.md](producao.md), item 12).

## Computador do escritório

- [ ] **32. Gerar um token novo** no site de produção e **revogar o de teste**
  ([producao.md](producao.md), item 8).
- [ ] **33. Rodar o instalador de novo e escolher TROCAR o token.** O site de
  teste e o de uso real ficam no mesmo endereço; o instalador encontra o token
  de teste guardado e pergunta se mantém ou troca: responder **T** e colar o
  token novo ([docs/mcp/instalacao.md](../mcp/instalacao.md), "Jeito rápido").
  Conector abaixo da versão 1.3.4 é recusado pelo site, com a instrução de rodar
  o instalador. **[novo]**
- [ ] **34. Instalar os clones** e preencher o `escritorio.json`
  ([producao.md](producao.md), item 14;
  [docs/mcp/instalacao.md](../mcp/instalacao.md), seção 5.0).
- [ ] **35. Rodar o diagnóstico** (`doctor`) e conferir, em DG Brasil →
  Agentes, que a "Análise Bancária" usa a Clara do kit
  ([producao.md](producao.md), item 14).
- [ ] **36. Decidir os agendamentos antigos** do computador do escritório
  ([producao.md](producao.md), item 9; [pos-mvp.md](pos-mvp.md), item 3).

## Depois

- [ ] **37. Um trabalho de ponta a ponta com dado real**, com roteiro próprio
  de produção: os scripts de teste recusam rodar fora do projeto de
  desenvolvimento ([producao.md](producao.md), item 3).
- [ ] **38. Prazos em dupla** por um ciclo completo antes de o DG Brasil virar
  a fonte única ([producao.md](producao.md), item 9;
  [docs/judicial.md](../judicial.md)).
- [ ] **39. Primeira semana:** memória e swap do banco; espaço do Storage; a
  primeira cópia de segurança dos documentos feita e conferida; o aviso diário
  da vigia chegando quando provocado; e a decisão sobre os prazos de guarda que
  ainda não existem ([organizacao-pre-producao.md](organizacao-pre-producao.md),
  seções 3 e 6, item 5; [producao.md](producao.md), itens 15 e 16). **[novo em
  parte]**
