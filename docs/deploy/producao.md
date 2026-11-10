# Produção: o que mudar quando o DG Brasil entrar em uso

Enquanto o DG Brasil está em teste e desenvolvimento, algumas coisas ficaram de
fora **de propósito**:
- planos pagos;
- automações que o plano gratuito não comporta;
- configurações que só fazem sentido com o sistema no ar e com dados reais.

Esta lista junta tudo isso, com o que fazer e onde mexer. **Nada daqui é para
fazer agora.**

Os preços foram conferidos nas páginas oficiais em 2026-10-29. Confira de novo na
hora de contratar.

## Resumo

| # | O quê | Por que não agora | Custo |
|---|---|---|---|
| 1 | Vercel Pro | O plano gratuito (Hobby) é só para uso pessoal, não comercial | US$ 20 por mês por pessoa que publica |
| 2 | Google Drive a cada 15 minutos | O Hobby só aceita agendamento uma vez por dia | Já vem com o Vercel Pro |
| 3 | Supabase de produção, no plano Pro | O gratuito pausa sem uso e não tem backup | A partir de US$ 25 por mês |
| 4 | Segurança do login | Recursos do Supabase Pro | Já vem com o Supabase Pro |
| 5 | E-mail de suporte e envio de e-mails | O envio que recebe e manda é pago | Plano pago do Zoho Mail |
| 6 | Domínios `app.` e `portal.dgbrasil.adv.br` (já no ar) | Falta só ligar ao Supabase de produção | Já pago |
| 7 | Claude com dados de clientes | Hoje só há dados fictícios | Plano Team ou Enterprise |
| 8 | Variáveis e chaves de produção | Hoje tudo aponta para o DEV | Sem custo |
| 9 | Conferências antes do primeiro dado real | Exigência para dado real | Sem custo |
| 10 | Integração judicial: mais buscas por dia e lotes do DataJud | Hobby: 1 rodada por dia, 60 s | Já vem com o Vercel Pro |
| 11 | ~~Conferir as publicações com o APOGEU~~ | Removido em 2026-11-09: o APOGEU não será usado | — |
| 12 | Consulta de CPF na Receita (Serpro) | Paga por consulta; contrato do escritório | Por consulta (Loja Serpro) |
| 13 | Validação de formato dos documentos (RG, CNH, OAB, dígitos) | Pedido para a atualização final | Sem custo |
| 14 | Agentes reais pelo DG Brasil (variantes `-dg`) | Os agentes atuais gravam no `G:\Meu Drive`; os testes usam agentes fictícios | Sem custo |

---

## 1. Vercel Pro

- **Hoje:** plano Hobby, gratuito. A própria Vercel diz: "Our Hobby plan is for
  personal, non-commercial use". O DG Brasil em produção é uso comercial do
  escritório.
- **Na produção:** assinar o **Pro**.
  - US$ 20 por mês por pessoa que publica.
  - Quem só olha o painel da Vercel não paga.
- **O que mais libera:** agendamentos de até uma vez por minuto, com hora exata.
  Ver o item 2.

## 2. Google Drive: sincronizar a cada 15 minutos

- **Hoje:**
  - `apps/frontend/vercel.json` agenda a rodada do Drive **uma vez por dia**, por
    volta das 6h de Brasília (`0 9 * * *`, em UTC).
  - Cada rodada envia até 5 documentos aprovados e confere até 5 pastas de
    cliente. O resto espera a rodada seguinte, ou alguém usa **Sincronizar
    agora** na ficha do cliente.
- **Por quê:** em 2026-10-29, o deploy foi recusado com o erro "Hobby accounts are
  limited to daily cron jobs". A rodada a cada 15 minutos virou diária só para o
  deploy passar. A rota, a proteção e o botão continuam iguais.
- **Na produção, com o Vercel Pro (item 1):**
  1. Em `apps/frontend/vercel.json`, trocar `"0 9 * * *"` por `"*/15 * * * *"`.
  2. Atualizar os textos que falam em "uma vez por dia":
     - o comentário de `apps/frontend/src/app/api/cron/drive-sync/route.ts`;
     - a seção 4 de [docs/mcp/google-drive.md](../mcp/google-drive.md);
     - a linha da rota agendada em [docs/mcp/relatorio-final.md](../mcp/relatorio-final.md).
  3. Conferir que o `CRON_SECRET` está nas variáveis de produção (item 8).
- **Se decidir não assinar o Vercel Pro:** o agendador do próprio Supabase
  (`pg_cron`, que já roda a manutenção do DG Brasil) pode chamar a rota a cada 15
  minutos.
  - Isso exige uma migration nova e guardar o `CRON_SECRET` no cofre do Supabase.
  - Pedir ao Claude quando chegar a hora.
- **Como conferir:**
  - na Vercel, em **Settings → Cron Jobs**, aparece `*/15 * * * *`;
  - no DG Brasil, em **Configurações → Integrações → Google Drive**, a última
    sincronização é recente.

## 3. Supabase de produção (projeto novo, no plano Pro)

- **Hoje:** só existe o projeto **DEV**, em São Paulo, no plano gratuito e com
  dados fictícios. O plano gratuito:
  - pausa o projeto depois de 1 semana sem uso;
  - não tem backup automático.
- **Na produção:**
  1. **Criar um projeto novo de produção**, também em São Paulo. Nunca
     reaproveitar o DEV: ele tem dados de teste e usuários de QA.
  2. **Plano Pro:**
     - a partir de US$ 25 por mês, com backup diário guardado por 7 dias;
     - voltar o banco a qualquer momento (PITR) é um adicional de US$ 100 por mês
       para 7 dias. Avaliar se vale para dado jurídico.
  3. **Aplicar todas as migrations** (`npx supabase db push`, com a CLI ligada ao
     projeto de produção). Se o `pg_cron` não ligar sozinho, ligar em **Database →
     Extensions**.
  4. **Criar a senha do login `dg_worker`**, como foi feito no DEV
     ([supabase/README.md](../../supabase/README.md)).
  5. **Configurar o Auth** como em [docs/auth.md](../auth.md), seção da configuração
     no projeto remoto: cadastro aberto desligado, MFA, política de senha,
     endereços e modelos de e-mail.
  6. **Criar a primeira administradora** ([supabase/README.md](../../supabase/README.md)).
- **Os scripts de teste não servem para a produção:** `validar:real`,
  `usuarios-qa` e os testes de integração recusam rodar fora de
  `DG_ENV=development`. Conferir a produção vai precisar de um roteiro próprio,
  sem dados fictícios. Pedir ao Claude quando chegar a hora.
- **Conexão do servidor com o banco:** no DEV, o `DG_WORKER_DB_URL` usa o pooler
  na porta 5432, que foi o testado. Na produção, avaliar a porta 6543 (pooler de
  transação), que é a recomendada para a Vercel, testando antes.

## 4. Segurança do login (recursos do Supabase Pro)

Ligar no projeto de produção, depois de assinar o Pro (item 3):

- **Proteção contra senha vazada:** recusa senhas que já apareceram em
  vazamentos. Está marcada como adiada em
  [supabase/README.md](../../supabase/README.md) (Supabase Advisors).
- **Tempo máximo de sessão e tempo de inatividade** (*Session timeouts*):
  - limitam quanto tempo vale o "Lembrar de mim";
  - ficam em `[auth.sessions]` no `supabase/config.toml` ou no painel;
  - ver [docs/auth.md](../auth.md) e
    [docs/etapa-4.3.2-relatorio.md](../etapa-4.3.2-relatorio.md).

## 5. E-mail de suporte e envio de e-mails do sistema

- **Hoje:**
  - Os e-mails do sistema (convite e redefinição de senha) saem pelo envio padrão
    do Supabase. Ele só entrega para os e-mails da equipe do projeto e tem limite
    baixo ([docs/auth.md](../auth.md), item 6).
  - O e-mail de suporte está vazio (`supportEmail` em
    `supabase/templates/email.config.json`), então os e-mails não mostram a quem
    pedir ajuda.
- **Por que não agora:** o Zoho Mail que recebe e envia é pago. O plano gratuito
  aceita o domínio próprio, mas não tem IMAP/POP, ou seja, não conecta a outros
  programas.
- **Na produção:**
  1. **Contratar o Zoho Mail** num plano pago (Mail Lite ou Mail Premium,
     cobrados por pessoa e por ano; a página anuncia "a partir de R$ 5").
     Confirmar na contratação que o plano permite **SMTP**: é o que deixa o
     Supabase mandar e-mail pela conta do escritório.
  2. **Criar o endereço de suporte** no domínio do escritório.
  3. **Configurar o DNS do domínio** com os registros que o Zoho mostrar (MX, SPF e
     DKIM). Sem eles, os e-mails caem no spam.
  4. **Ligar o envio no Supabase de produção:** em **Authentication → SMTP
     Settings**, preencher servidor, porta, usuário e senha de aplicativo do Zoho e
     o remetente.
  5. **Pôr o endereço nos e-mails do sistema:**
     - preencher `supportEmail` em `supabase/templates/email.config.json`;
     - rodar `npm run emails` na pasta `supabase`;
     - colar os modelos no painel ([docs/auth.md](../auth.md), "E-mails do Auth").
  6. **Testar:** convidar uma conta de teste e pedir redefinição de senha. Os dois
     e-mails devem chegar, fora do spam, com a seção de suporte.

## 6. Domínios (já no ar)

- **Hoje, já funcionando na Vercel:**
  - **`app.dgbrasil.adv.br`**, para a equipe;
  - **`portal.dgbrasil.adv.br`**, para os parceiros;
  - `dgbrasil.adv.br` e `www.dgbrasil.adv.br` redirecionam para o `app.`;
  - o site está ligado ao Supabase **DEV**.
- **Nomes antigos no código:** os exemplos e textos antigos do repositório ainda
  citam `app.barbaracardoso.adv.br`. O que vale é o que está gravado em
  `NEXT_PUBLIC_APP_HOST` e `NEXT_PUBLIC_PORTAL_HOST` na Vercel.
- **Na produção, os domínios ficam os mesmos.** Falta:
  1. **Supabase de produção (item 3):** em **Authentication → URL Configuration**,
     preencher:
     - Site URL: `https://app.dgbrasil.adv.br`;
     - Redirect URLs: `https://app.dgbrasil.adv.br/auth/confirm**` e
       `https://portal.dgbrasil.adv.br/auth/confirm**`
       ([docs/auth.md](../auth.md), item 4).

     Sem isso, o link do e-mail de convite quebra.
  2. **Computador do escritório:** o `url` do `executor.json` é
     `https://app.dgbrasil.adv.br`, sempre com o `app.` (item 8). O domínio sem
     `app.` redireciona, e o token do computador não vai junto no
     redirecionamento.

## 7. Claude com dados de clientes

- **Hoje:** o computador do escritório usa a assinatura do Claude, e o DG Brasil
  só tem dados fictícios.
- **Antes do primeiro caso real:**
  - em claude.ai → **Configurações → Privacidade**, conferir que o uso das
    conversas para treinamento está **desligado**;
  - para dados de clientes, o mais adequado é o plano **Team ou Enterprise**
    (termos comerciais). Conferir o preço na página da Anthropic;
  - fazer a revisão LGPD do provedor de IA.
- Ver o risco R3 em [docs/mcp/relatorio-final.md](../mcp/relatorio-final.md).

## 8. Variáveis e chaves de produção

Na Vercel, em **Settings → Environment Variables**, ambiente *Production*. Tudo
apontando para o projeto Supabase **de produção**, nunca para o DEV:

| Variável | O quê |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Do projeto de produção |
| `SUPABASE_SERVICE_ROLE_KEY` | Do projeto de produção. Só no servidor |
| `DG_WORKER_DB_URL` | Login `dg_worker` do projeto de produção, pelo pooler (item 3) |
| `CRON_SECRET` | Um texto aleatório **novo**, diferente do usado em teste |
| `GOOGLE_DRIVE_*` | Credencial do Google ([docs/mcp/google-drive.md](../mcp/google-drive.md)) |
| `NEXT_PUBLIC_APP_HOST`, `NEXT_PUBLIC_PORTAL_HOST` | Os domínios (item 6) |
| `NEXT_PUBLIC_DEMO_MODE` | Ausente ou `false`: na produção não há ferramentas de demonstração |

**Computador do escritório:**
1. No site de produção, em **Configurações → Computador do escritório**, gerar um
   token novo.
2. Revogar o token de teste.
3. Trocar `url` e `token` no `executor.json`
   ([docs/mcp/instalacao.md](../mcp/instalacao.md)).

## 9. Conferências antes do primeiro dado real

Não custam nada, mas precisam estar feitas antes de entrar o primeiro cliente de
verdade:

- **Textos jurídicos definitivos** dos termos de uso e da política de privacidade.
  Hoje são provisórios.
- **Revisão LGPD:** provedor de IA (item 7) e Google Drive.
- **Agendamentos atuais do computador do escritório**, que rodam com
  `--dangerously-skip-permissions`: decidir o que fazer (risco R1 em
  [docs/mcp/relatorio-final.md](../mcp/relatorio-final.md)).
- **Pendências de robustez** listadas em [docs/backend.md](../backend.md), seção
  "Hardening pendente por domínio". Exemplo: o ciclo de vida do acordo financeiro
  e o limite de consultas de CPF/CNPJ, que hoje vale por instância do servidor.
- **Prazos em dupla:** enquanto os prazos também forem controlados fora do DG
  Brasil, conferir item a item por um ciclo completo antes de o DG Brasil virar a
  fonte única ([ROADMAP.md](../../ROADMAP.md), "Onde o risco realmente mora").

## 10. Integração judicial (DJEN e DataJud): frequência

- **Hoje:**
  - o pg_cron do Supabase (`dg-judicial`, a cada 5 min, migration 043) chama a
    rota `/api/cron/judicial-sync` em lotes:
    - a partir das 05:00 de Brasília, enquanto houver OAB não conferida no dia,
      busca as publicações do DJEN dessas OABs (revendo os últimos 5 dias);
    - depois, só os andamentos do DataJud (cada processo uma vez a cada 20 h);
    - sem nada pendente, nem chama a rota;
  - cada lote tem 60 s, e o DJEN aceita 20 consultas por minuto: cabem umas 15
    consultas (umas 5 OABs) por lote. Com 50 OABs, a conferência termina por
    volta das 06:00;
  - a Vercel Cron às 06:30 (`30 9 * * *` em `apps/frontend/vercel.json`) fica
    como reserva.
- **Obrigatório para os lotes** (DEV e produção), no projeto Supabase. Sem isto,
  só a rodada das 06:30 roda, e nela cabem umas 5 OABs por dia:
  1. **Database → Extensions:** ligar `pg_net`.
  2. **SQL Editor**, com o mesmo `CRON_SECRET` da Vercel daquele ambiente:

     ```sql
     select vault.create_secret('https://app.dgbrasil.adv.br', 'dg_app_url');
     select vault.create_secret('<CRON_SECRET>', 'dg_cron_secret');
     select private.judicial_cron_kick();   -- 'chamado: publicações', 'chamado: andamentos' ou 'nada a ler'
     ```

  Para trocar um segredo depois: `select vault.update_secret(id, '<novo>') from
  vault.secrets where name = 'dg_cron_secret';`.
- **Na produção, com o Vercel Pro (item 1):**
  1. Mais conferências de publicações por dia, se o escritório quiser: trocar a
     regra "uma vez com sucesso por dia" de `private.judicial_djen_due()` (por
     exemplo, também à tarde).
  2. `maxDuration` da rota `/api/cron/judicial-sync` de 60 para 300 s e o prazo
     interno (`started + 50_000`) para ~280 s: cabem muito mais OABs e processos
     por lote.
  3. Atualizar os textos de frequência em `route.ts`, em
     [docs/judicial.md](../judicial.md) e nas telas (Configurações → Integrações).
- **Chave do DataJud:** é a pública da wiki do CNJ e pode mudar. Se a tela
  mostrar "DataJud recusou a chave pública", pôr a nova em `DATAJUD_API_KEY`
  na Vercel.

---

## 11. (Removido) Conferência das publicações com o APOGEU

Removido em 2026-11-09, por decisão da Barbara: o APOGEU não será usado. O
número fica reservado para não mudar as referências aos itens 12 e 13. A
conferência das publicações antes de o DG Brasil virar a fonte única continua no
ciclo de conferência em dupla ([docs/judicial.md](../judicial.md)), comparando com
o controle atual do escritório.

---

## Como acrescentar um item

Sempre que algo for deixado para a produção (plano pago, automação, configuração),
acrescente:
1. uma linha no **Resumo**;
2. uma seção com:
   - **Hoje:** como está e onde fica no código;
   - **Por que não agora;**
   - **Na produção:** os passos;
   - **Como conferir.**

---

## 12. Consulta de CPF na Receita (Serpro) — Roadmap 2.0

- **Hoje:** atualização futura, por decisão da Barbara (2026-11-09). O código
  está pronto e DESLIGADO: sem as chaves do Serpro, o CPF não consulta nada e a
  tela não mostra aviso. CEP (ViaCEP/BrasilAPI) e CNPJ (BrasilAPI) são gratuitos
  e já funcionam.
- **Por que não agora:** a API Consulta CPF do Serpro é paga por consulta e o
  contrato é do escritório (Loja Serpro, contratação online, pós-pago).
- **Na produção:** contratar a **Consulta CPF** na Loja Serpro e pôr na Vercel:
  `SERPRO_CPF_CONSUMER_KEY` e `SERPRO_CPF_CONSUMER_SECRET` (opcional:
  `SERPRO_CPF_BASE_URL`, se o Serpro indicar outro endereço). Para testar sem
  contrato, `SERPRO_CPF_TRIAL=1` usa a demonstração pública do Serpro (só CPFs
  de teste, ex.: 404.428.201-35).
- **Como conferir:** novo cliente PF → digitar um CPF real → o nome e a data de
  nascimento aparecem com o aviso "Dados preenchidos pela Receita Federal".

## 13. Validação de formato dos documentos — Roadmap 2.0

- **Hoje:** CPF e CNPJ conferem tamanho e dígitos repetidos; RG/CNH/OAB só o
  básico. O número do documento de identidade é opcional.
- **Por que não agora:** pedido da Barbara para a atualização final de produção.
- **Na produção:** dígito verificador de CPF/CNPJ, formato de RG por estado,
  CNH (11 dígitos com verificador), OAB por seccional, CNJ com verificador em
  todos os campos — no formulário e no servidor.
- **Como conferir:** tentar cadastrar documentos com dígito errado e ver a recusa.

## 14. Agentes reais pelo DG Brasil (variantes `-dg`)

- **Hoje:** o orquestrador e os trabalhos do DG Brasil foram testados só com os
  agentes fictícios (`analista-teste`, `kit-cliente-teste`, `orquestrador-teste`;
  guia em [docs/mcp/maquina-principal.md](../mcp/maquina-principal.md)). Os agentes
  reais (`lucas`, `clara`, …) leem e gravam no `G:\Meu Drive` e usam o
  ChatJurídico, por isso não podem ser chamados por um trabalho do DG Brasil.
- **Por que não agora:** primeiro a ponta a ponta com os agentes de teste na
  máquina principal.
- **Na produção, para os agentes trabalharem pelo DG Brasil:**
  1. Criar as variantes `lucas-dg`, `clara-dg` (e, se for o caso, `alice-dg`,
     `murilo-dg`), com o mesmo método, entrada na pasta `entrada` e saída na
     `saida` do trabalho, e ferramentas mínimas
     ([docs/adicionar-agente.md](../adicionar-agente.md)). Pedir ao Claude.
  2. Instalar em `%USERPROFILE%\.claude\agents\` da máquina principal, junto com
     o [orquestrador.md](../mcp/pilotos/agentes/orquestrador.md) (a tabela dele já
     aponta para as variantes `-dg`).
  3. No DG Brasil de produção: cadastrar cada variante e o orquestrador
     (identificador `orquestrador`, agente local `orquestrador`).
- **Como conferir:** uma tarefa de processo "Redigir uma procuração" vai para o
  `lucas-dg`, a minuta aparece em Revisões, e nada é gravado no `G:\Meu Drive`.
