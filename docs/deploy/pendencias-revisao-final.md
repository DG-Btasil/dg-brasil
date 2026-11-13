# Pendências da revisão final (13/11/2026)

O review final do perfil administrador apontou 37 problemas. As correções estão no ramo local
`revisao-final-pre-producao`, em commits locais. Nada foi enviado ao GitHub, nada foi aplicado
no Supabase e o site no ar não mudou.

Este arquivo junta o que ficou para decidir ou fazer junto com a Barbara. O passo a passo da
produção continua em [checklist-da-virada.md](checklist-da-virada.md).

## 1. Para publicar no DEV (fazer juntos)

Na ordem. Banco sempre antes do site: o painel novo usa tabelas e funções que só existem com as
migrations novas.

1. **Conferir o conector do computador principal.** O servidor passa a recusar conector abaixo
   da versão 1.3.4. Rodar o `doctor` antes de publicar.
2. **Aplicar as migrations 062 a 068 no Supabase DEV**, em ordem (`npx supabase db push`).
   - A 063 liga o aviso diário de todo prazo vencido em aberto, para o responsável e para todos os
     administradores. Antes de aplicar, encerrar os prazos de teste vencidos (há 4 no DEV), senão
     chovem avisos.
   - Na primeira manhã depois da 062, cada OAB relê até 30 dias de publicações: mais buscas
     naquele dia.
3. **Conferir os agendamentos novos** em `cron.job`: `dg-judicial-vigia`, `dg-vigia-da-plataforma`
   e `dg-expurgo-de-pedidos`, além dos que já existiam.
4. **Variáveis na Vercel:** `DG_ENV=development` no site de teste (sem ela, a subida registra
   erro). `NEXT_PUBLIC_DEMO_MODE` pode ser apagada: não é mais lida.
5. **`supabase/.env.real`:** acrescentar `DG_DEV_PROJECT_REF=<identificador do projeto DEV>`. Sem
   isso, `validar:real`, `usuarios:qa`, `limpar:teste` e `test:integration` passam a recusar
   (trava nova contra rodar teste na produção).
6. **Rodar `npm run test:integration`** em `apps/frontend` contra o DEV. Os testes de integração
   foram atualizados, mas nenhum rodou: dependem das migrations aplicadas.
7. **Enviar o ramo e publicar o site** (merge no `master` e push).
8. **Olhar as telas novas no navegador** (nenhuma foi aberta com sessão real):
   - Prazos (agenda, filtros, cumprir, reabrir, conferido, audiência, exportar);
   - Publicações (gaveta com tempo de espera e "Tratar eu mesmo");
   - Financeiro (abas Contratos, A receber, Recebimentos, Despesas; reabrir contrato; repasse);
   - Revisões (fila agrupada por execução e decisão em conjunto);
   - Configurações (Lixeira, acessos LGPD), busca no cabeçalho (Ctrl+K), página não encontrada;
   - Home (faixa da captura judicial, prazos vencidos, financeiro igual ao da tela Financeiro).
9. **Instalador do conector:** testar a pergunta nova (manter ou trocar o token). Enter mantém.
10. **Modelos de e-mail no painel do Supabase:** colar de novo `invite.html` e `recovery.html` e o
    assunto do convite, agora "Barbara Cardoso Advocacia" sem acento.
11. **Nome do escritório no cadastro:** a migration 019 gravou "Bárbara Cardoso Advocacia" com
    acento. Corrigir pela tela, em Configurações → Geral, e o nome do perfil da administradora.

## 2. Decisões da Barbara

Cada agente escolheu a opção mais conservadora e seguiu. Vale confirmar.

**Prazos e publicações**
- Publicação "com o agente" volta para a equipe depois de **4 horas corridas** sem proposta
  (configurável em DG Brasil → Integrações).
- O trabalho do agente que atrasou não é cancelado: se ele responder depois, a proposta cai em
  Revisões com o aviso "a publicação já foi tratada". Aprovar por engano cria um segundo prazo.
- Avisos da captura judicial saem na categoria Judicial, que a pessoa pode desligar (a faixa na
  Home continua). Alternativa: categoria de segurança, que não desliga.
- Prazo vencido avisa todo dia útil, sem teto de repetição.
- A categoria Prazos deixou de poder ser desligada nas preferências.
- Reabrir vale para prazo cumprido, cancelado e perdido. "Conferido" não tem desfazer.
- Calendário de feriados: só vale feriado ou suspensão do tribunal inteiro. Os dias já
  cadastrados precisam ser revistos (o sistema não distingue feriado municipal lançado antes).
- O tipo do prazo vindo do agente (réplica, recurso...) só aparece quando o pedido da publicação e
  a ferramenta `propor` do conector citarem `deadline_type`. Até lá, prazo do agente sai como
  "Prazo interno".

**Financeiro**
- Estorno e ajuste exigem contrato ativo: contrato concluído ou cancelado é reaberto pela
  administradora (com motivo), estornado e concluído de novo.
- Dados antigos do DEV com contrato fechado e parcela em aberto continuam "em aberto" até alguém
  reabrir e resolver.
- "1.500" sem vírgula é lido como mil e quinhentos; "1500.00" é recusado com "Use vírgula para os
  centavos".
- Colunas das planilhas exportadas foram escolhidas pelos agentes; trocar é simples.

**Lixeira, exportação e busca**
- CPF/CNPJ de cliente excluído não pode ser recadastrado: o caminho é restaurar pela Lixeira (só
  administradora). Liberar mexeria na importação de planilhas e no portal do parceiro.
- CNJ de processo excluído pode ser recadastrado: o excluído solta o número. O histórico já
  capturado fica com o processo excluído.
- Exportar planilha: só administradora, até 5.000 linhas, CPF/CNPJ completo, registrado na
  auditoria.
- A busca do cabeçalho aparece também para o parceiro, limitada ao que ele já enxerga.

**Plataforma**
- Vigia diária às 08:30 em dia útil: fila parada há mais de 24 h, computador sem contato há mais
  de 3 dias. Sai como aviso de segurança (não desliga).
- Pasta do Google Drive fora da pasta dos clientes: só a administradora pode ligar.
- Limite de consulta de CPF no Serpro: 15 por minuto por pessoa. Um teto diário por escritório,
  para controlar o gasto, é decisão sua.

**Interface**
- Aviso no computador do escritório: "Antes de enviar dados reais de clientes aos agentes,
  conclua a revisão LGPD do provedor de IA." Manter até a revisão ser feita?
- Reabrir caso e reconsiderar rejeição: só administradora, com motivo. Arquivar caso continua sem
  volta pela tela.
- Lista de tribunais com 92 opções (inclui TREs e Tribunais de Justiça Militar), com busca.
- Os textos novos de confirmação, auditoria e tour foram escritos pelos agentes: vale uma leitura.

## 3. O que só a Barbara resolve

- **Backup dos documentos:** o script existe (`supabase/scripts/backup-documentos.mjs`, roteiro em
  [restauracao-dos-documentos.md](restauracao-dos-documentos.md)), mas falta escolher destino,
  frequência e responsável. Nunca rodou contra o Supabase.
- **Monitoramento:** escolher o monitor externo para `/api/health` (UptimeRobot, Better Stack) e o
  destino dos erros (`ERROR_WEBHOOK_URL`, ou Sentry, que pede conta e dependência).
- **Prazos de guarda dos dados:** nenhum foi definido. Recomendação dos agentes: avisos lidos 12
  meses; rodadas da busca judicial e fila arquivada 90 dias; auditoria e acessos a dados pessoais
  não apagar sem orientação jurídica.
- **Pedido de titular (LGPD):** quem atende e por qual canal
  ([pedido-de-titular.md](pedido-de-titular.md)). Não há tela de exportação por titular nem
  anonimização.
- **Resumo diário por e-mail:** depende do SMTP (Zoho). Os avisos hoje são só no sino do site.
- **Termos de uso e política de privacidade:** continuam provisórios (versão `0.1-provisorio`).

## 4. O que não foi testado

- Nenhuma tela nova foi aberta no navegador com sessão real.
- Nada rodou contra o Supabase real: migrations, views e funções novas só foram exercitadas no
  simulador local (PGlite), com pg_cron, pg_net e Vault simulados.
- Testes de integração atualizados e não executados.
- Workflows novos do GitHub (CI do conector, `npm audit`) não rodaram no GitHub.
- Script de backup e instalador do conector: testados em partes, nunca de ponta a ponta.
- A API real do DJEN não foi chamada.

## 5. Ficou para depois

- Busca de publicações para processo recém-cadastrado (rever 30 dias daquele número): pede consulta
  por número de processo no DJEN e porta nova no banco.
- Marcar "desatualizado" na lista de computadores do escritório.
- Conector antigo mostra só "respondeu 426" no comando `esperar`; melhorar exige gerar o conector
  de novo.
- Limites de consulta além do CPF continuam em memória, por instância do servidor.
- Os totais de repasse do parceiro e o gráfico "A receber por vencimento" ainda são somados no
  servidor do painel, com teto de leitura.
- Motivo do cancelamento do contrato continua não sendo pedido.
- A auditoria diz "Planilha exportada" sem dizer de qual lista (o dado está gravado).
- `src/types/review.ts` está sem uso; ficou para não colidir com a área de Revisões.
- `apps/frontend/docs/` (BACKEND_HANDOFF, CONVENTIONS, FRONTEND_ARCHITECTURE) ainda citam arquivos
  do protótipo que saíram.
- Quatro pastas vazias de agentes em `.claude/worktrees` (`agent-a20e…`, `agent-a483…`,
  `agent-a4c5…`, `agent-af49…`) e os ramos `worktree-agent-*`, de uma tentativa que falhou:
  apagar. As pastas `rf-*` e os ramos `rf/*` podem ser apagados depois do merge no `master`.

## 6. Fila de Revisões (migration 067)

O que mudou: a fila abre agrupada por execução do agente (alterna com "Lista"), tem busca por
texto e decisão em conjunto dentro do grupo. Cada item continua decidido um a um pelo sistema, na
sessão da pessoa, com auditoria de cada um. Revisão nova nasce atribuída ao advogado do caso.

Decisões a confirmar:
- **Aprovar em conjunto** vale só para pedido de documento (sem mensagem ao parceiro) e proposta
  sem efeito automático. Prazo, cadastro de processo, atualização do caso e mudança de agente
  exigem abrir o item. **Rejeitar em conjunto** vale para qualquer proposta.
- **Proposta do agente** agora só aceita "Aprovar" ou "Rejeitar"; "Solicitar alterações" continua
  para documentos e análises.
- As revisões de proposta que estavam paradas em "alterações solicitadas" voltam para a fila como
  reabertas, sem decisão de ninguém (correção de estado, auditada). Na hora de aplicar a 067, ela
  avisa quantas voltaram.
- A atribuição automática vale só para revisões novas: as 334 que existem no DEV continuam sem
  responsável. Atribuir em massa é decisão sua.

Ao juntar os ramos, uma conferência da área judicial precisou mudar: o caso "publicação presa
porque a revisão pediu alterações" deixou de existir para revisões novas. Ele continua coberto pela
vigia para dados antigos.
