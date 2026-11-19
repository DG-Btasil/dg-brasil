# Depois do lançamento: atualizações futuras

**Decisão de 10/11/2026:** o DG Brasil é lançado **completo** (não como beta). O
que é preciso para lançar está em [producao.md](producao.md): inclusive a
consulta de CPF na Receita (item 12), o Google Drive (item 2) e os agentes do
escritório pela ponte (item 14), que entram depois das validações que faltam.
Este arquivo junta só o que fica **para depois do lançamento**.

## Resumo

| # | O quê | Situação no lançamento | O que falta | Custo |
|---|---|---|---|---|
| 1 | Validação de formato dos documentos | Só o básico (o dígito do CPF já é conferido antes da Receita) | Construir; prioridade baixa | Sem custo |
| 2 | Domínio consignado (análise do HISCON no DG Brasil) | Atualização futura (decisão de 10/11/2026) | Responder 7 dúvidas de regra, construir e validar com roteiros da Clara | Sem custo |
| 3 | Agendamentos atuais dos agentes (risco R1) | Como estão | Decidir | — |
| 4 | Correções nos arquivos dos agentes do escritório | Defeitos já existentes | Corrigir no repositório dos agentes | Sem custo |
| 5 | Ajustes pequenos | — | Ver a lista | Sem custo |
| 6 | Distribuição dos agentes do kit (clones `-dg`): botão "Setup" no site | **Feito em 14/11/2026** (072): Sua conta e sessões → Setup, só para a dona do escritório | Publicar a primeira versão e instalar pelo botão | Sem custo |
| 7 | Titular do comprovante de residência no cadastro do cliente | O Lucas compara o nome do comprovante com o do cliente | Decidir como o campo deve ser | Sem custo |
| 8 | Cópia de segurança dos documentos (Storage) | Script pronto (`supabase/scripts/backup-documentos.mjs`), sem destino | Escolher destino, frequência e responsável; ensaiar a restauração | Depende do destino |
| 9 | Monitoramento (monitor externo e destino dos erros) | `/api/health` e `ERROR_WEBHOOK_URL` prontos, sem conta ligada | Escolher o monitor e o destino; ligar na produção | Há opções gratuitas |
| 10 | Prazos de guarda dos dados | Nada é apagado sozinho, salvo os pedidos aos agentes (180 dias) e o histórico do agendador (7 dias) | Decidir por quanto tempo guardar cada registro | Sem custo |
| 11 | Pedido de titular de dados (LGPD) | Procedimento escrito, sem tela | Definir quem atende e por qual canal | Sem custo |
| 12 | Resumo diário por e-mail | Avisos só no sino do site | Depende do e-mail do escritório (SMTP) | Plano pago do Zoho |
| 13 | Termos de uso e política de privacidade definitivos | Texto provisório (versão `0.1-provisorio`), só depois do login | Texto jurídico definitivo e **página pública** de termos e condições (o Google aponta para ela) | Sem custo |
| 16 | Segurança da captura judicial: como a equipe fica sabendo quando o DJEN ou o DataJud falham | Releitura de 30 dias, vigia, faixa, avisos no sino e Cobertura já existem | Conversa com a dona do escritório: aviso fora do site, monitor externo, tribunais que intimam fora do DJEN | Sem custo, salvo o canal de aviso |
| 15 | **URGENTE:** integração do Google Drive pelo site (B.1) | **Ligada na produção em 18/11/2026** (Testar conexão ok, rodada a cada 15 min) | Ligar as pastas dos clientes (Sugerir ligações) e conferir uma sincronização e uma exportação | Sem custo |
| 14 | OAB e assinatura nas peças de caso de parceiro | Os dados de quem assina vêm do `escritorio.json` (dentro do setup) | Decidir como a peça e a procuração levam a OAB do advogado parceiro, dono do cliente | Sem custo |

---

## 1. Validação de formato dos documentos

Prioridade baixa (10/11/2026): com a consulta à Receita no lançamento, o CPF já
é conferido na fonte e o dígito verificador do CPF já é conferido antes da
consulta. Falta: dígito verificador do CNPJ, RG por estado, CNH (11 dígitos com verificador), OAB por seccional e número CNJ com
verificador, no formulário e no servidor. Detalhes em
[producao.md](producao.md), item 13.

## 2. Domínio consignado

A análise do HISCON dentro do próprio DG Brasil (blocos de ação, contratos,
cálculos) ficou fora do MVP em 05/11/2026 e, em 10/11/2026, confirmada como
atualização futura. Hoje quem faz é a Clara. Desenho
pronto em [../futuro/dominio-consignado.md](../futuro/dominio-consignado.md).

## 3. Agendamentos atuais dos agentes (risco R1)

Os agendamentos da máquina principal rodam o Claude Code com
`--dangerously-skip-permissions`. É o maior risco do escritório (segurança e
termos de uso da Anthropic), fora do escopo por decisão
([../mcp/relatorio-final.md](../mcp/relatorio-final.md)). Com a ponte ligada,
parte desse trabalho pode passar a vir pelo DG Brasil, com permissões
controladas. Decidir na versão final.

**Estado em 14/11/2026 (conferido no Agendador de Tarefas, só leitura):** só um
está ligado, "BC - Beto tarefas do Caio" (seg/qua/sex, 11h,
`rodar_beto.cmd`). Bruno, Clara, Lucas, as duas da Luísa e o "Sistema BC -
Otavio" estão desligados. O que a flag faz: o Claude roda sem pedir permissão
para nada (qualquer comando, qualquer arquivo, internet). Se um documento ou
mensagem de cliente trouxer instrução maliciosa, não há trava nem pessoa para
barrar. Caminhos, do mais barato ao mais seguro: (a) aceitar como está, só para
o Beto; (b) trocar a flag por uma lista fechada de ferramentas
(`--allowedTools` ou `permissions` no `settings.json` da pasta do Beto), com
internet e apagar arquivo negados; (c) levar o trabalho do Beto para dentro do
DG Brasil, pela ponte, com as permissões da pasta da sessão.

**Decisão de 14/11/2026: risco aceito pela dona do escritório.** O argumento: a ponte e o
Porteiro conferem se os documentos têm conteúdo malicioso antes de um agente tocar neles.
Ressalva registrada: o Porteiro protege os trabalhos que vêm do DG Brasil. O "BC - Beto" roda
fora da ponte, pelo Agendador do Windows, e lê mensagens e arquivos do ChatJurídico e do Drive
sem passar pelo Porteiro. Se o Beto um dia passar a rodar pela ponte, a ressalva acaba.

## 4. Correções nos arquivos dos agentes do escritório

Desde 11/11/2026 o DG Brasil usa clones dos agentes, e esses defeitos (e os
demais achados na clonagem) **já foram corrigidos nos clones**. A lista
completa, por agente, está na seção "Defeitos do original corrigidos no clone"
de cada relatório em [../agentes/clonagem/](../agentes/clonagem/README.md). Falta
corrigir nos **originais do escritório**, que não foram tocados.

Achados no levantamento de 10/11/2026, no repositório `Agents_for_DG_Brasil`.
Não são do DG Brasil e já acontecem hoje:
- `verificar_redacao.py` não aceita a opção `--nemo`: a checagem da Tese Nemo
  pedida pela Alice sempre dá erro;
- faltam no disco o `PROMPT_1000_IDENTIFICADOR`, o modelo da Caixa e as duas
  listas de bancos em `.xlsx` (as versões `.md` existem);
- o Tomás e o Henrique citam pastas que não existem: "DOCUMENTOS PARA JUNTAR NOS
  PROCESSOS REAJUSTE" (a real é "DOCUMENTOS PARA REAJUSTE 6,2") e "MODELO
  CONTRATO";
- o Lucas depende do ChatJurídico para saber a forma de pagamento do contrato:
  pela ponte, ela precisa vir escrita no pedido.

## 5. Ajustes pequenos

- **Instalador:** as mensagens com acento podem aparecer estragadas na tela do
  PowerShell (o site serve o arquivo sem codificação declarada). Só exibição.
- **ADMIN consegue ler, pelo banco, o hash da reserva** de cada execução
  (`agent_runs.lease_token_hash`): baixo risco; fechar numa migration futura.
- **Telas do perfil LAWYER** do computador do escritório: conferência pendente
  desde a refatoração MCP.
- **"Verificar agora" da Vigia** (052, [instalacao.md](../mcp/instalacao.md),
  seção 6): a opção de acordar também com trabalho novo (`esperar_fila`) fica
  desligada no lançamento. Decidir depois de medir o gasto da assinatura.
- **Isolamento da sessão:** na FASE 0 do "Verificar agora", o servidor
  `claude-in-chrome` apareceu numa sessão aberta com `--strict-mcp-config`.
  Conferir se ele também carrega na Vigia e, se carregar, bloquear no `deny`.
- **Tela da sequência automática** (056,
  [clonagem](../agentes/clonagem/README.md#sequência-automática-decisão-de-12112026)):
  hoje os agentes que entram depois da análise aprovada (e o pedido de cada
  um) só se configuram pelo banco. Pôr ao lado de onde já se escolhe o agente
  da análise (DG Brasil → Agentes → Visão geral).
- **Disco do banco de teste (Supabase DEV):** em 12/11/2026 o Supabase avisou que o
  projeto DEV está gastando o orçamento de leitura e gravação de disco. Olhar o
  consumo por hora no painel e reduzir: o intervalo do comando de espera da Vigia
  (052), a sincronização do DataJud que tenta de novo os processos com erro (285 no
  DEV) e as rotinas do `pg_cron`. Na produção, dimensionar a máquina do banco antes
  de ligar a Vigia o dia todo.
- **Tela da atividade do caso:** os eventos da sequência automática
  (`AUTO_SEQUENCE_*`) aparecem com o nome técnico em inglês.
- **Gênero no cadastro do cliente:** a procuração do Lucas sai "brasileira" para
  cliente homem quando o cadastro não traz o gênero.

- **Publicações (integração judicial), achados de 13/11/2026:**
  - o teor de algumas publicações do DJEN aparece com `&emsp;` escrito na
    tela e no pedido ao agente: limpar as entidades HTML na captura;
  - publicação que chegou **antes** de o escritório escolher o "Agente que
    propõe prazos" (ou com o agente pausado) não vai para ele depois. Criar o
    botão "Pedir o prazo ao agente" na tela da publicação, ou repassar as
    pendentes quando o agente é escolhido;
  - DataJud lento: **feito em 13/11/2026** (cada consulta espera até 2 min e
    insiste 3 vezes na recusa; a rodada agendada trabalha 4 min). Falta medir
    por alguns dias quantos processos por lote isso lê;
  - caso sem nenhum documento não passa pela ponte (o Porteiro não tem o que
    conferir e o Arquivista recusa): dizer isso ao advogado com clareza, ou
    deixar passar quando o trabalho só precisa do `PROCESSO_<CNJ>.txt`;
  - `ver_processo` ainda mostra o teor de publicação cancelada pelo tribunal
    dentro dos andamentos (no `PROCESSO_<CNJ>.txt` ela já sai sem teor).

- **Revisões, prévia e download (13/11/2026):**
  - baixar no OUTRO formato pelo SITE (Word de um PDF, PDF de um Word) não
    existe: o site não tem como converter. Desde o conector 1.3.4 o PDF de
    cada minuta em Word fica na pasta do cliente (gerado pelo Word do
    computador); para o site continua indo só o Word;
  - esse PDF é o da minuta ANTES da revisão. Depois de aprovada (ou editada e
    reenviada pelo site), nada volta para a pasta do cliente: falta gravar lá
    o PDF final quando a revisão é aprovada;
  - anexar o documento pedido numa revisão do tipo "Pedido de documento" não
    marca a pendência como atendida: aprovar a proposta ainda cria o pedido;
  - a prévia registra um acesso do tipo "download" ao abrir a revisão (usa a
    mesma porta do botão de baixar). Separar "visualizou" de "baixou" pede
    mudança no banco;
  - a prévia de Word é aproximada (quebra de página e fontes): vale para ler,
    não para conferir diagramação.
- **Do prazo à peça:** **feito em 13/11/2026** (migration 061: o prazo vira
  tarefa do processo e vai ao orquestrador). Falta: reenviar sozinha a tarefa
  que ficou aberta por falta dos autos quando o documento chega; mostrar na
  tarefa o link para o prazo de origem.

## 6. Distribuição dos agentes do kit: botão "Setup" no site (FEITO em 14/11/2026, migration 072)

Antecipado para antes da produção (decisão de 14/11/2026). Os 13 clones, a
Diana, os agentes da ponte, os scripts e os dados de quem assina saem do
computador do escritório e passam a morar no DG Brasil, no bucket **privado**
`office-setup`. A pasta `agentes/` continua fora do GitHub (o repositório é
público).

**Quem usa:** só a dona do escritório, que é o **primeiro ADMIN do escritório
principal** (o vínculo ADMIN ativo mais antigo; na instalação, o que o
`bootstrap_owner_admin` criou). Se ele for desativado, o próximo ADMIN mais
antigo assume. Para os outros, a linha nem aparece.

**Como a dona instala ou atualiza:** **Sua conta e sessões → Setup**. A
pergunta é "Você deseja instalar o setup?" (se já estiver instalado, ele é
removido e atualizado para a versão mais recente), com **Autorizar** ou
**Negar**. Autorizar copia um comando; ela abre o PowerShell no computador,
cola (Ctrl+V) e aperta Enter. Não é arquivo baixado: o Windows 11 bloqueia
`.cmd` vindo da internet (Controle Inteligente de Aplicativos) sem opção de
liberar, e a 1ª versão, com o arquivo `Setup DG Brasil.cmd`, esbarrou nisso
em 14/11/2026.

**Segurança, sem senha:**
- o comando não traz os agentes nem o token do computador: traz só um código
  de **uso único** que vence em **15 minutos**. Copiado e esquecido, ou mandado
  para alguém, não serve para nada;
- o código troca, uma vez, por um link de 2 minutos para o pacote
  (`/api/setup/v1/baixar`), e o pacote é conferido pelo SHA-256 antes de
  instalar;
- a dona recebe aviso no sino (Segurança) quando o setup é instalado e quando
  sai versão nova. Tudo fica na auditoria (`OFFICE_SETUP_ISSUED`,
  `OFFICE_SETUP_REDEEMED`, `OFFICE_SETUP_PUBLISHED`);
- a instalação guarda o setup anterior e o devolve se algo falhar no meio.
  Nunca toca em `C:\DGBrasil\agentes\trabalho` nem nos agentes do escritório
  (só nos `-dg.md` e no `orquestrador.md`).

**Como publicar uma versão nova** (quando um agente melhorar), no computador do
escritório já autorizado, de dentro da cópia local do projeto:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File apps\executor\scripts\publicar-setup.ps1
```

`-Simular` monta o pacote sem enviar. O script recusa o `escritorio.json` com
os dados fictícios do exemplo. Depois de publicar, a dona aperta **Setup** de
novo no computador que deve receber a versão.

**Ainda em aberto:**
- se outros escritórios usarem o DG Brasil: o que é kit do DG Brasil e o que é
  método deste escritório;
- a procuração do Lucas cobre só a revisional de consignado do INSS; o Atlas
  (empréstimo pessoal, consignado de trabalhador CLT) e o Vicente (seguro,
  conta) precisam de outro objeto de procuração;
- o conector DJEN na sessão do DG Brasil (os clones já consultam; hoje seguem
  pelos autos).

## 7. Titular do comprovante de residência

Quando o comprovante de residência está em nome de outra pessoa (filho,
cônjuge, dono do imóvel), o kit do cliente leva uma declaração de residência
assinada pelo cliente. No escritório, quem informa isso é o atendente. No DG
Brasil, o Lucas lê o nome no comprovante e compara com o do cliente, o que pode
errar com documento ruim.

Falta decidir (Barbara, 12/11/2026) como isso entra no cadastro do cliente: um
campo simples "comprovante em nome de", ou uma opção que, marcada, pede de quem
é e o vínculo com o cliente (parentesco, com quem mora). O arquivo
`DADOS DO CADASTRO.txt` já tem a linha `comprovante_residencia_em_nome_de`,
hoje vazia.

---

## 8 a 13. Itens que vão direto para a produção (decisão de 13/11/2026)

A Barbara decidiu que estes itens não serão montados no ambiente de teste: dependem de conta,
gasto ou decisão, e entram já na produção, depois do lançamento. O que já está pronto no código
fica como está.

> **Pós-MVP não é "depois de ter clientes" (definição da dona, 14/11/2026).** É a última etapa
> antes do primeiro cliente real: os preparativos finais, já com as assinaturas pagas. Tudo
> desta seção, a revisão LGPD (provedor de IA e Google Drive) e os termos definitivos ficam
> prontos antes do primeiro dado real.

- **8. Cópia de segurança dos documentos.** O backup do Supabase Pro guarda o banco, não os
  arquivos enviados (procurações, minutas, extratos). O script copia esses arquivos para outro
  lugar. Falta escolher o destino e ensaiar a restauração
  ([restauracao-dos-documentos.md](restauracao-dos-documentos.md); [producao.md](producao.md), item 15).
- **9. Monitoramento.** Um serviço de fora consulta o site a cada poucos minutos e avisa se ele
  cair; os erros do servidor podem ir para um endereço de aviso ([producao.md](producao.md), item 16).
- **10. Prazos de guarda.** Por quanto tempo o sistema guarda registros antigos antes de apagar
  sozinho: avisos já lidos, o histórico das buscas de publicações, a fila de trabalhos já
  terminados. Sem prazo, eles crescem para sempre. Sugestão: avisos lidos 12 meses; histórico
  de buscas e fila 90 dias; auditoria e registro de acesso a dados pessoais não apagar sem
  orientação jurídica ([producao.md](producao.md), item 18).
- **11. Pedido de titular.** Quando um cliente pede para ver ou apagar os próprios dados (LGPD):
  quem atende e como ([pedido-de-titular.md](pedido-de-titular.md)).
- **12. Resumo diário por e-mail.** Precisa do e-mail do escritório configurado para envio
  ([producao.md](producao.md), item 5).
- **13. Termos de uso e política de privacidade.** O texto provisório diz isso na própria tela.
  Atenção: [producao.md](producao.md), item 9, recomenda ter o texto definitivo antes do
  primeiro cliente real. **Decisão de 14/11/2026:** fica no pós-MVP, que pela definição acima
  já é antes do primeiro cliente real; lança tecnicamente com o provisório.
  **Para o texto definitivo, dados da própria equipe e dos parceiros (cadastro pessoal, migration 079):**
  a política precisa dizer que o sistema guarda, de cada pessoa com acesso, nome, como prefere ser
  chamada, cargo, telefone, cidade e UF onde trabalha e OAB; e, **só se a pessoa informar**, o
  **gênero** (finalidade: tratá-la corretamente nos textos do sistema) e a **data de nascimento**
  (finalidade: aviso de aniversário à equipe, função ainda não implementada). Os dois são opcionais,
  a pessoa altera ou apaga em "Meu perfil", e não há CPF, endereço residencial nem documento pessoal.
  **Página pública de termos e condições (pedido de 18/11/2026):** criar uma página que abra **sem
  login**, com os termos de uso e a política de privacidade. Hoje `/termos` só abre depois do login
  (quem não entrou vai para `/login`). Motivo: ao publicar o app OAuth "DG Brasil" no Google Cloud
  (integração do Drive, item 15), o Google exigiu o link da política de privacidade, e foi usado
  `https://app.dgbrasil.adv.br/termos`. Quando a página pública existir, trocar esse link em Google
  Cloud → Google Auth Platform → Branding. Se um dia o app pedir a verificação do Google (por
  exemplo, ao enviar um logotipo), a página pública passa a ser obrigatória.
- **Revisão LGPD** do provedor de IA e do Google Drive ([producao.md](producao.md), itens 7 e
  9): também pós-MVP desde 14/11/2026, obrigatória antes do primeiro dado real.

## 14. OAB e assinatura nas peças de caso de parceiro

Regra de 14/11/2026, para decidir depois (não trava o lançamento). No caso que
o parceiro mandou e virou processo, **o processo continua sendo do parceiro**:
o cliente contratou aquele advogado e deu poderes a ele. A petição inicial, a
procuração e as outras peças usam a **OAB do advogado parceiro**, dono do
cliente. O escritório auxilia, mas a OAB da dona do escritório não vai em todas
as peças.

Hoje os dados de quem assina vêm do `escritorio.json` que vai no setup (item 6).
Falta decidir de onde o agente tira a OAB e o nome do advogado parceiro em cada
caso (o cadastro do parceiro no site já tem as OABs das pessoas, migration 048).
Junto, mais tarde: termos de uso e LGPD da parceria (item 13).

## 15. URGENTE: integração do Google Drive pelo site (decisão de 14/11/2026)

> **Ligada na produção em 18/11/2026:** projeto "DG Brasil" no Google Cloud (separado do
> projeto da esteira), app OAuth publicado "Em produção" sem logotipo e sem escopo cadastrado
> (para não exigir a verificação do Google), cliente "DG Brasil servidor", refresh token pelo
> OAuth Playground, as 4 variáveis em Production, Redeploy e **Testar conexão** ok na pasta
> "DG BRASIL". Rodada a cada 15 minutos. Falta: ligar as pastas dos clientes e conferir uma
> sincronização e uma exportação de versão aprovada. **19/11/2026:** "Sugerir ligações" na produção
> voltou "Nenhuma sugestão" (a importação real dos clientes do parceiro ainda não foi feita); ligar
> logo depois da importação e rodar "Sincronizar tudo agora" duas vezes (a segunda traz 0 arquivos). Para cortar o acesso: remover o app
> "DG Brasil" em myaccount.google.com/permissions da conta do escritório.

Saiu da frente do lançamento porque criar a credencial exige a dona da conta Google, com a
verificação em duas etapas, e ela não estava disponível. É o primeiro item do pós-MVP: tem de
estar pronto antes do primeiro cliente real.

- **O que já se sabe:** a pasta "DG BRASIL", onde os agentes da ponte trabalham, é de uma conta
  **Gmail** do escritório e fica no "Meu Drive". Então o caminho é o **A (OAuth)** de
  [../mcp/google-drive.md](../mcp/google-drive.md), seção 3A. O caminho B (conta de serviço) não
  serve: ela não grava em "Meu Drive".
- **Raiz (`GOOGLE_DRIVE_ROOT_FOLDER_ID`):** usar a pasta "DG BRASIL", para a sincronização olhar
  as mesmas pastas que os agentes usam (o guia cita `01. ADVOCACIA — CLIENTES`, que é a pasta
  dos agentes do escritório, fora do DG Brasil).
- **A ponte não depende disto** ([producao.md](producao.md), item 2): sem a integração, o arquivo
  posto na pasta pela equipe não entra sozinho no DG Brasil e a versão aprovada não vai sozinha
  para a pasta. Não economiza tokens: roda no servidor, sem Claude, e não substitui o Arquivista
  nem o Mensageiro.
- **Custo:** nenhum (projeto do Google Cloud e Drive API são grátis; a rodada a cada 15 minutos
  vem com o Vercel Pro).
- **Passos:** seção 3A do guia (projeto, tela de consentimento **publicada**, credencial,
  refresh token no OAuth Playground), as 4 variáveis `GOOGLE_DRIVE_*` na Vercel, Redeploy e a
  Parte 4 de [../qa/maquina-principal/qa-maquina-principal.md](../qa/maquina-principal/qa-maquina-principal.md)
  (as telas o Claude testa).

## 16. Segurança da captura judicial (conversa, 14/11/2026)

Preocupação do usuário: muita gente vai depender da atualização do DJEN e do DataJud para
trabalhar. Se a busca der erro de novo e de novo, a publicação não aparece, ninguém fica
sabendo, e um prazo aberto pelo juiz passa sem ser visto. Fica como conversa com a dona do
escritório, depois do lançamento técnico e antes do primeiro cliente real.

**Distinção:** o prazo nasce de publicação do **DJEN**. O **DataJud** só traz andamentos
(juntada, conclusão, sentença); falha nele atrasa a linha do tempo do processo, não o prazo.

**O que já existe** ([../judicial.md](../judicial.md)):
- um dia do DJEN só fica "assentado" depois de conferido com sucesso a partir de D+5; enquanto
  isso, toda rodada relê os dias não assentados, até 30 dias para trás. Falha de 2 ou 3 dias é
  recuperada na primeira busca que der certo;
- vigia a cada 15 min (`private.judicial_watchdog`, 062): em dia útil, depois das 08:00, avisa
  os ADMIN se uma OAB ficou sem busca concluída no dia. Roda no banco, então avisa mesmo com o
  site fora;
- faixa de alerta na Home e em Integrações; aviso de rodada com falha, no máximo dois por dia
  por pessoa (057); botão "Cobertura" com a conferência dia a dia;
- publicação "com o agente" volta para a equipe depois de 4 h; prazo vencido avisa todo dia útil.

**Brechas:**
1. os avisos ficam só no sino do site: sem alguém abrir o DG Brasil, ninguém vê;
2. nada de fora vigia o sistema: se o banco cair, a vigia cai junto;
3. intimação feita fora do DJEN (portal do tribunal, ciência automática em alguns sistemas) não
   entra no DG Brasil.

**Propostas para a conversa:**
- (a) aviso fora do site quando a captura falhar ou um dia ficar sem conferência: e-mail
  (depende do item 12, SMTP) ou WhatsApp pelo ChatJurídico;
- (b) monitor externo gratuito em `/api/health` (item 9);
- (c) prazos em dupla no primeiro ciclo ([checklist-da-virada.md](checklist-da-virada.md),
  passo 38);
- (d) lista dos tribunais em que o escritório atua e de como cada um intima, para saber se
  algum intima fora do DJEN e como cobrir;
- (e) na tela do processo, "andamentos sem atualizar há X dias" quando o DataJud falhar seguido
  para aquele processo (a contagem de falhas já existe com a migration 073).

**Bolinhas de conferência (desenho decidido em 14/11/2026, a programar no pós-MVP).** Encaixar
nas telas que existem, sem mudar o layout: nada de coluna, card ou cor nova; usar o `Badge`
com `dot` que o card judicial do processo já usa ("Ativo").
- **DJEN, por OAB, validade "hoje":** em DG Brasil → Integrações, na coluna da última busca
  (`features/judicial/components/monitor-status.tsx`), a bolinha entra antes do horário que já
  aparece; o texto fica igual.
- **DataJud, por processo, validade 24 h** (o DataJud não é por OAB): uma linha a mais, no cinza
  da descrição, logo abaixo da opção "Andamentos do DataJud" em Integrações ("42 de 45
  processos lidos nas últimas 24 h · 3 com falha"); e a bolinha na frente da linha "DataJud:
  lido em ..." do card judicial do processo (`process-judicial-card.tsx`).
- **Cores:** verde = conferido (DJEN hoje; DataJud nas últimas 24 h) e sem erro; amarelo =
  ainda não conferido hoje, antes das 08:00 (normal); vermelho = falhou ou sem conferência
  depois das 08:00 de dia útil (DataJud: falhando ou mais de 24 h sem ler); cinza = pausada ou
  fim de semana sem busca.
- **Home:** nada muda; a faixa de alerta que já existe continua.
- **Esforço:** pequeno, quase só tela. Talvez falte só um campo "último sucesso" por OAB.
- Só ajuda quem abre o site: combina com a proposta (a), o aviso fora do site.

## Depois do lançamento: o que anotar

Para decidir a versão final, a equipe anota (num canal ou documento combinado):
- telas confusas, campos que faltam e erros, com o print e o horário;
- o que ainda é feito fora do DG Brasil e deveria entrar nele;
- quanto espaço os documentos estão ocupando no Supabase (painel do projeto).

## Como acrescentar um item

Na tabela do resumo (uma linha) e numa seção própria com: o que é, como está no
lançamento, o que falta.
