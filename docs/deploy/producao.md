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
| 6 | Domínios `app.` e `portal.` | Só com o sistema no ar | O domínio `.adv.br` do escritório |
| 7 | Claude com dados de clientes | Hoje só há dados fictícios | Plano Team ou Enterprise |
| 8 | Variáveis e chaves de produção | Hoje tudo aponta para o DEV | Sem custo |
| 9 | Conferências antes do primeiro dado real | Exigência para dado real | Sem custo |

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

## 6. Domínios

- **Hoje:** o site de teste usa o endereço que a Vercel deu. O Auth do DEV aponta
  para `http://localhost:3000`.
- **Na produção:**
  1. Na Vercel, em **Settings → Domains**, ligar:
     - `app.barbaracardoso.adv.br`, para a equipe;
     - `portal.barbaracardoso.adv.br`, para os parceiros.
  2. Configurar o DNS do domínio como a Vercel pedir.
  3. Variáveis: `NEXT_PUBLIC_APP_HOST` e `NEXT_PUBLIC_PORTAL_HOST` (ver
     `apps/frontend/.env.example`).
  4. No Supabase de produção, em **Authentication → URL Configuration**:
     - Site URL e Redirect URLs com os dois endereços
       ([docs/auth.md](../auth.md), item 4);
     - sem isso, o link do e-mail de convite quebra.
  5. No computador do escritório, o `url` do `executor.json` passa a ser
     `https://app.barbaracardoso.adv.br` (item 8).

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
