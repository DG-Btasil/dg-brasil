# Roadmap 2.0 — fechamento do MVP

Pedido da Barbara em 2026-11-06, depois da validação final do sistema. São 8 blocos
de trabalho e 1 de validação. A ordem segue a dependência: primeiro o que é rápido
e destrava o uso, depois o banco (cadastros), o que depende dele (financeiro,
tarefas, parceiros) e, por último, os números e gráficos, que leem tudo.

Cada bloco vira um commit e, quando mexe no banco, uma migration nova (a partir da
**045**), com verificação no Postgres local (`npm run verificar`). No fim, **um
guia único** para o validador da outra máquina: [roadmap-2.0-validacao.md](roadmap-2.0-validacao.md).

| # | Bloco | Banco | O que muda para quem usa |
|---|---|---|---|
| 1 | Correções rápidas e velocidade | — | Olhinho na senha, número do documento opcional, "prazo" no lugar de "vencimento", sem "Tipo" no caso, documentos usando a tela toda, telas abrindo na hora |
| 2 | Cadastros | 045 | Cliente: canal de origem e escritório de origem, sem advogado responsável, campos obrigatórios, PJ enxuta, sem "união estável". Processo: sem nome próprio, status e fases novos, honorários, sem prazo no cadastro. Análise: caixa de informações para os agentes |
| 3 | Financeiro por processo (prioridade) | 046 | Tudo ligado ao processo: valor da causa, honorários (escritório × parceiro), contrato, recebimentos e despesas (custas, advogado contratado, perícia/avaliação, audiência). Modelos de honorários saem de Configurações e vão para o Financeiro |
| 4 | Tarefas para os agentes | 047 | No processo, a equipe escreve o que precisa ser feito; o orquestrador pega na fila, o agente faz, entrega para revisão humana e a tarefa ganha o check |
| 5 | Parceiros e equipe | 048 | Convidar parceiro só com o e-mail; ele completa o cadastro (escritório, CNPJ/CPF, telefone, OAB) no primeiro acesso; OAB por usuário (várias); atuação sem "unidade"; enviar documento dentro da conversa de Pendências |
| 6 | Preenchimento automático | — | CEP completa o endereço e CNPJ completa a empresa, no escritório e no portal. CPF na Receita (Serpro): pronto e desligado, fica para a produção |
| 7 | Central DG Brasil | — | A aba DG Brasil mostra se tudo está ligado: computador do escritório, esteira, agentes, DJEN, DataJud, Drive. Integrações saem de Configurações. Conectar o computador do escritório com um comando só |
| 8 | Números e gráficos | 049 | Indicadores com filtro de período em Início, Clientes, Casos, Processos, Financeiro, Parceiros e no portal do parceiro. Gráfico de processos com os status novos e gráfico novo no espaço vazio da Início |
| 9 | Validação e testes | — | Guia único para o validador; depois, produção |

## Decisões tomadas (podem ser revistas)

- **Status do processo (condução)**, nesta ordem: Pré-ajuizamento, Em preparação,
  Distribuído, Em andamento, Com sentença, Recurso, Trânsito em julgado, Execução,
  Recebido, Arquivado e, à parte, Suspenso. "Aguardando cliente" e "Aguardando
  prazo" viram "Em andamento"; "Encerrado" vira "Arquivado". "Ativos" = tudo
  menos Recebido e Arquivado.
- **Fase processual**: Pré-processual, Processual, Recursal, Trânsito em julgado,
  Cumprimento de sentença, Arquivado. Postulatória, Instrutória e Decisória viram
  "Processual".
- **Duas origens, sempre separadas**: *canal* (como o cliente chegou: indicação,
  Google Ads, Meta Ads, outro tráfego pago, redes sociais, site/busca, WhatsApp,
  cliente antigo, evento, outro + detalhe livre) e *escritório de origem*
  (escritório principal ou parceiro A/B — o que já existe). O caso herda o canal
  do cliente e pode ter o próprio.
- **Campos obrigatórios** no cadastro manual (escritório e portal): nacionalidade,
  estado civil, profissão, e-mail, CEP e endereço completo. A importação de
  planilha continua aceitando cadastro incompleto (senão o ADVBOX não entra).
- **Advogado responsável sai do cliente** (tela, servidor e banco). Continua no
  caso e no processo.
- **Financeiro**: o contrato de honorários passa a ser do processo (um contrato
  ativo por processo). A divisão com o parceiro continua vindo do caso (é a
  parceria do caso) e vale para todos os processos dele.
- **Convite do parceiro**: em vez de mandar uma senha gerada por e-mail, segue o
  link de uso único que já existe (vale 7 dias e só funciona uma vez) — na
  prática é a "primeira senha", sem a senha circular por e-mail. No primeiro
  acesso o parceiro cria a senha dele e completa o cadastro.
- **CPF na Receita**: não existe consulta gratuita de nome por CPF. O caminho
  oficial é a API Consulta CPF do Serpro (paga por consulta). Atualização futura
  (decisão de 2026-11-09): o código fica pronto e desligado, e entra na lista de
  produção (`docs/deploy/producao.md`, item 12). CEP (ViaCEP/BrasilAPI) e CNPJ
  (BrasilAPI) são gratuitos e funcionam já.
- **Orquestrador**: é um agente do Claude Code no computador do escritório. As
  tarefas do processo entram na fila do DG Brasil endereçadas a ele; pelo MCP, o
  Claude Code do escritório pega a tarefa, o orquestrador decide qual agente
  local faz cada parte, e a entrega volta ao DG Brasil para revisão humana. No DG
  Brasil basta cadastrar o agente com o identificador `orquestrador` (ou
  escolhê-lo em DG Brasil → Conexões). Modelo do agente:
  `docs/mcp/pilotos/agentes/orquestrador.md`.
- **Validação de formato de documentos** (RG por estado, etc.): fica para a
  atualização final de produção (`docs/deploy/producao.md`).

## O que a Barbara precisa fazer

1. Ler as decisões acima e dizer se alguma muda.
2. No computador do escritório: copiar o agente `orquestrador` para
   `%USERPROFILE%\.claude\agents\` e cadastrá-lo no DG Brasil (ver o guia de
   validação, Parte 4).
3. Na produção: contratar a Consulta CPF do Serpro (`docs/deploy/producao.md`, item 12).
