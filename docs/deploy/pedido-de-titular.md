# Pedido de titular de dados: como atender

Quando uma pessoa pede para saber quais dados dela o escritório guarda, pede uma
cópia, uma correção ou a eliminação. Este documento diz **o que o DG Brasil já
faz**, **o que é manual** e **onde estão os dados**. Não diz o que a lei manda
nem em que prazo: isso quem decide é o escritório, caso a caso.

> O DG Brasil **não tem tela** para pedido de titular. Consultar e corrigir se
> faz pelo site; exportar tudo e anonimizar exigem uma pessoa técnica com acesso
> ao banco, e a anonimização exige um roteiro que **ainda não existe**.

## Quem atende

Pendente de decisão da dona do escritório. Sugestão para preencher antes do
primeiro dado real:

| Papel | Quem | O que faz |
|---|---|---|
| Responsável pelo pedido | (definir: a administradora) | Recebe o pedido, confere a identidade de quem pede, decide o que será atendido e responde |
| Apoio técnico | (definir) | Faz a exportação e, se for o caso, prepara e roda o roteiro de anonimização |
| Canal de entrada | (definir: e-mail de suporte, [producao.md](producao.md), item 5) | Onde o pedido chega e fica registrado |

Pedido de titular que chega a um escritório **parceiro** sobre um cliente dele
no DG Brasil: o parceiro encaminha ao escritório. O parceiro não exporta nem
apaga nada pelo portal.

## Quem pode ser o titular

1. **Cliente** (pessoa física cadastrada, ou representante e sócio de cliente
   pessoa jurídica). É o caso mais comum.
2. **Usuário do sistema** (equipe do escritório e pessoas dos parceiros).
3. **Terceiro citado** em documento ou processo (parte contrária, por exemplo).
   O sistema não tem cadastro estruturado dessas pessoas: os dados delas estão
   dentro dos documentos e dos textos dos processos.

## O que o sistema já registra

| Registro | O que guarda | Quem lê |
|---|---|---|
| `personal_data_access_events` | Quem abriu a ficha de qual cliente, baixou qual documento ou exportou o quê, e quando. Só identificadores e a ação. Abrir a mesma ficha de novo em 10 minutos não gera outro registro. Vale também para o acesso feito por agente | Só ADMIN. Hoje **por consulta ao banco** (ainda sem tela) |
| Download auditado | Todo download de documento passa por uma autorização do banco, que grava o evento `DOCUMENT_DOWNLOADED` e o acesso a dado pessoal na mesma operação | ADMIN |
| `audit_events` | Toda criação, alteração e exclusão em clientes, casos, processos, documentos, financeiro, usuários. Guarda identificadores, situação e o nome dos campos alterados; nunca CPF, e-mail, telefone nem conteúdo de documento. Não pode ser alterado nem apagado | ADMIN. Aparece no histórico da ficha do cliente e do caso, e em Configurações, no registro de auditoria |
| `user_legal_acceptances` | O aceite dos termos de uso e da política de privacidade por cada **usuário do sistema**: versão, data, endereço IP e navegador. Não pode ser alterado nem apagado | ADMIN, por consulta ao banco |

Isso responde a duas perguntas de um titular sem trabalho extra: **quem acessou
os meus dados** e **quando o meu cadastro foi alterado**.

O que o sistema **não** registra: o consentimento ou a base legal do tratamento
dos dados do cliente (isso está no contrato e na procuração, que são documentos
do caso) e o próprio pedido do titular (registre fora, no canal de entrada).

## Onde estão os dados de um cliente

| Onde | O que |
|---|---|
| `clients`, `individual_client_details`, `company_client_details` | Cadastro: nome, CPF ou CNPJ, nascimento, estado civil, profissão |
| `client_contacts`, `client_addresses` | Telefones, e-mails, endereços |
| `company_representatives`, `company_shareholders` | Representantes e sócios de cliente pessoa jurídica |
| `client_internal_details` | Anotações internas (o parceiro não vê) |
| `legal_cases`, `legal_processes` e as tabelas ligadas | Casos, processos, partes, movimentações, publicações, prazos, tarefas |
| `documents`, `document_versions` e o Storage (bucket `legal-documents`) | Os arquivos: documentos pessoais, extratos, procuração, contrato, minutas |
| Financeiro | Contratos de honorários, obrigações, recebimentos |
| `agent_run_inputs` | O texto do pedido feito a um agente, que pode citar o cliente. Apagado sozinho depois de 180 dias |
| **Fora do DG Brasil** | A pasta do cliente no Google Drive e no computador do escritório; as conversas do escritório; os autos nos tribunais; as cópias de segurança |

## Como atender, hoje

### Confirmar que a pessoa é quem diz ser

Manual. O sistema não faz essa conferência.

### "Quais dados vocês têm?" e "quero uma cópia"

1. **Pelo site (ADMIN ou advogado):** a ficha do cliente mostra o cadastro, os
   casos, os processos e os documentos. Dá para imprimir a ficha pelo navegador
   e baixar os documentos um a um. Cada abertura e cada download ficam
   registrados em nome de quem fez.
2. **Exportação completa (pessoa técnica):** não há botão. Faz-se por consulta
   no banco (painel do Supabase → SQL Editor), tabela por tabela, a partir do
   identificador do cliente, e pela cópia dos arquivos dele no Storage (as
   pastas do bucket `legal-documents` são `clients/<id do cliente>/…`).
   Registre a exportação, para ela aparecer na trilha de acessos. É a mesma
   função que o site usa; como aqui ela é chamada à mão, **teste antes no
   projeto de desenvolvimento**:

   ```sql
   select public.record_personal_data_access(
     '<id do cliente>', 'EXPORT', null, 'EXPORT',
     'Pedido do titular de DD/MM/AAAA', '<id do usuário que está exportando>');
   ```

3. **"Quem viu meus dados?"** (pessoa técnica):

   ```sql
   select e.created_at, e.action, e.resource_type, e.actor_type, p.full_name
   from personal_data_access_events e
   left join profiles p on p.id = e.actor_user_id
   where e.client_id = '<id do cliente>'
   order by e.created_at;
   ```

Antes de entregar, uma pessoa do escritório revê o material: anotações internas,
estratégia do caso e dados de terceiros podem não fazer parte do que se entrega.

### "Corrijam meus dados"

Pelo site, na edição do cliente. A alteração fica na auditoria. Trocar o CPF ou
o CNPJ de um cadastro é só do ADMIN.

### "Apaguem meus dados"

É aqui que o sistema ajuda menos, de propósito. O DG Brasil guarda o histórico
de um escritório de advocacia e foi feito para **não perder** registro:

- **Inativar** o cliente (pelo site): ele sai das listas do dia a dia. Nada é
  apagado.
- **Excluir** o cliente (pelo site, só ADMIN): a exclusão é lógica. O cadastro
  some das telas e continua no banco.
- **Apagar de verdade ou anonimizar: não existe função para isso.** As tabelas
  são ligadas entre si com trava contra exclusão, a auditoria e o livro
  financeiro não aceitam alteração, e os arquivos ficam no Storage e nas cópias
  de segurança. Fazer isso à mão, direto no banco, é arriscado: pode quebrar
  casos e o financeiro de outros registros.

Enquanto não houver tela, o caminho é:

1. o escritório decide **o que** pode ser eliminado e o que precisa ser mantido
   (processos em andamento, obrigações do escritório, defesa em eventual
   demanda). Essa decisão é jurídica e é do escritório;
2. o apoio técnico escreve um **roteiro de anonimização para aquele caso**
   (trocar nome, documento, contatos e endereços por marcadores; decidir o que
   fazer com cada arquivo), **testa no projeto de desenvolvimento** e só então
   roda na produção, numa transação, com cópia de segurança feita antes;
3. o que foi feito fica registrado: o que foi trocado, quando, por quem e a
   pedido de quem.

O que **não** dá para anonimizar por este caminho: os eventos de auditoria (que
guardam só identificadores), os documentos já protocolados em juízo e as cópias
de segurança antigas (saem quando vencerem; ver
[restauracao-dos-documentos.md](restauracao-dos-documentos.md)).

### Titular que é usuário do sistema

- Ver e corrigir: Minha conta (a própria pessoa) e Configurações → Equipe (ADMIN).
- Encerrar o acesso: o ADMIN inativa o usuário. O que ele fez continua na
  auditoria em nome dele.
- O aceite dos termos e o histórico de ações não são apagados.

## Pendências

- Definir quem atende e o canal de entrada (tabela do começo).
- Definir os prazos de guarda que ainda não existem (avisos, histórico das
  buscas judiciais): hoje essas tabelas guardam tudo para sempre.
- Tela para o ADMIN ver os acessos a dado pessoal de um cliente e exportar os
  dados de um titular. Entra em [pos-mvp.md](pos-mvp.md) quando for decidido.
- Roteiro de anonimização testado, antes de ele ser necessário.
