# Google Drive: configuração

Este guia liga o DG Brasil ao Google Drive do escritório. O **DG Brasil continua o
arquivo oficial**; o Drive é a pasta de trabalho da equipe.

O que a integração faz:
- **Liga cada cliente à pasta dele** pelo **identificador da pasta** (o nome é só
  exibição). Renomear ou mover a pasta no Drive não quebra a ligação.
- **Traz os arquivos novos da pasta para o DG Brasil** (e das subpastas, até 2
  níveis), como documentos **internos** do cliente, na categoria "Outro", para a
  equipe classificar.
  - Não duplica: o mesmo arquivo, com o mesmo conteúdo, entra uma vez só.
  - Não traz de volta o que o próprio DG Brasil mandou para lá.
- **Manda para a pasta, como arquivo novo, toda versão de documento aprovada em
  Revisões**, com o nome "Título (vN, DG Brasil).pdf".
  - Nunca sobrescreve, nunca apaga, nunca muda permissão.
  - **Não envia se a pasta estiver aberta a "qualquer pessoa com o link"**: o
    arquivo ficaria público.

Quem fala com o Drive é o **servidor** do DG Brasil. A credencial do Google fica
só nas variáveis do servidor (Vercel), nunca no navegador nem no computador do
escritório.

---

## 1. Qual é o tipo da conta?

Abra o Google Drive com a conta do escritório.
- **O endereço termina em `@gmail.com`:** é conta **pessoal**. Siga o caminho A.
- **O endereço é do domínio do escritório** (ex.: `@barbaracardoso.adv.br`) e há
  "Drives compartilhados" no menu: é **Google Workspace**. Siga o caminho B, se as
  pastas dos clientes estiverem num Drive compartilhado; senão, o caminho A também
  serve.

> **Por que importa:** conta de serviço (caminho B) não tem espaço próprio e não
> consegue gravar no "Meu Drive" de uma pessoa. Ela só funciona com Drive
> compartilhado.

## 2. Pasta dos clientes

Abra no navegador a pasta que contém as pastas dos clientes (na produção, a pasta
"DG BRASIL", a mesma em que os agentes da ponte trabalham). O identificador é o trecho
depois de `/folders/` no endereço:

```
https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345
                                       └──────── este trecho ────────┘
```

Esse valor vai em `GOOGLE_DRIVE_ROOT_FOLDER_ID`.

## 3A. Conta pessoal (Gmail) ou usuário do Workspace: OAuth

1. **Crie o projeto e ligue a API.** Em [console.cloud.google.com](https://console.cloud.google.com),
   crie um projeto "DG Brasil" e, em **APIs e serviços → Biblioteca**, ative a
   **Google Drive API**.
2. **Configure a tela de consentimento.** Em **APIs e serviços → Tela de
   consentimento OAuth**:
   - tipo **Externo** (Gmail) ou **Interno** (Workspace);
   - nome do app "DG Brasil";
   - o seu e-mail de contato.
   - **Publique o app** ("Em produção"). Em "Teste", o Google invalida o token em
     7 dias. Por ser uso próprio, o aviso "app não verificado" pode aparecer no
     passo 4: avance como dona da conta.
3. **Crie a credencial.** Em **Credenciais → Criar credenciais → ID do cliente
   OAuth**:
   - tipo **Aplicativo da Web**;
   - URI de redirecionamento autorizado:
     `https://developers.google.com/oauthplayground`.
   - Guarde o **ID do cliente** e a **chave secreta**.
4. **Gere o token de renovação.** Abra o [OAuth Playground](https://developers.google.com/oauthplayground):
   1. clique na engrenagem e marque **Use your own OAuth credentials**;
   2. cole o ID e a chave do passo 3;
   3. no Step 1, digite o escopo `https://www.googleapis.com/auth/drive` e clique
      **Authorize APIs**;
   4. entre com a **conta do escritório**;
   5. no Step 2, clique **Exchange authorization code for tokens** e copie o
      **Refresh token**.
5. **Grave as variáveis na Vercel.** No projeto do DG Brasil (Settings →
   Environment Variables), ambiente de desenvolvimento ou produção conforme o caso:

| Variável | Valor |
|---|---|
| `GOOGLE_DRIVE_CLIENT_ID` | ID do cliente (passo 3) |
| `GOOGLE_DRIVE_CLIENT_SECRET` | Chave secreta (passo 3) |
| `GOOGLE_DRIVE_REFRESH_TOKEN` | Refresh token (passo 4) |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | Pasta dos clientes (seção 2) |

> O token de renovação dá acesso ao Drive inteiro da conta. Trate como senha:
> fica só na Vercel. Para cortar o acesso, remova o app em
> [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

## 3B. Google Workspace com Drive compartilhado: conta de serviço

1. **Crie a conta de serviço.** No mesmo projeto (com a Google Drive API ativa),
   em **IAM e administrador → Contas de serviço**, crie "dg-brasil-drive". Na
   conta criada, abra **Chaves → Adicionar chave → JSON**: um arquivo é baixado.
2. **Dê acesso ao Drive compartilhado.** No Drive compartilhado dos clientes,
   abra **Gerenciar membros** e adicione o e-mail da conta de serviço
   (`...@...iam.gserviceaccount.com`) como **Administrador de conteúdo**.
3. **Grave as variáveis na Vercel:**

| Variável | Valor |
|---|---|
| `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` | Conteúdo do arquivo JSON, ou o mesmo conteúdo em base64 |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | Pasta dos clientes, dentro do Drive compartilhado |

Apague o arquivo JSON do computador depois de colar.

## 4. Rodada automática (Vercel Cron)

O arquivo `apps/frontend/vercel.json` agenda `/api/cron/drive-sync` **a cada 15
minutos** (`*/15 * * * *`, desde 18/11/2026, com o Vercel Pro). Cada rodada:
1. envia até 5 versões aprovadas que estão na fila;
2. confere até 5 pastas ligadas, das mais antigas para as mais novas.

| Variável | Valor |
|---|---|
| `CRON_SECRET` | Um texto aleatório longo. A Vercel envia esse valor na chamada, e a rota recusa sem ele. |
| `DG_WORKER_DB_URL` | Login `dg_worker` pelo pooler do Supabase (o mesmo da API do computador do escritório) |

> No plano gratuito da Vercel (Hobby), o máximo é uma vez por dia: com agendamento
> mais frequente, o deploy é recusado. A produção está no Vercel Pro
> ([docs/deploy/producao.md](../deploy/producao.md), item 2). Para não esperar a
> rodada, use **Sincronizar agora** na ficha do cliente.

Cada pasta traz **até 30 arquivos novos por passada**; o resto vem nas passadas
seguintes. Com 5 pastas a cada 15 minutos, 150 pastas novas levam umas 7 a 8 horas
só pela rodada automática (mais, se houver pasta com muitos arquivos).

**Sincronizar tudo agora** (ADMIN, desde 18/11/2026), em Configurações →
Integrações → Google Drive, faz o mesmo trabalho sem esperar:
- a tela chama o servidor em lotes de até 40 segundos e repete até acabar,
  mostrando as pastas conferidas, o total e os arquivos trazidos;
- primeiro as pastas que ainda têm arquivo novo para trás (passaram dos 30),
  depois as ainda não conferidas, das mais antigas para as mais novas;
- termina quando toda pasta ligada foi conferida depois do clique e nenhuma ficou
  com arquivo para trás (pasta que a rodada automática conferiu nesse meio tempo
  conta como conferida);
- envia também as versões aprovadas que estiverem na fila;
- **Parar**, fechar a página ou cair a conexão só interrompem: o que entrou fica,
  e nada entra duas vezes (cada arquivo é conferido pelo ID e pelo md5). A rodada
  automática continua em paralelo. O estado do lote fica só na tela, nada novo no
  banco (`syncAllBatch` em `apps/frontend/src/server/integrations/google-drive/sync.ts`).

O tempo depende do tamanho dos arquivos: cada arquivo novo é baixado do Drive,
conferido e guardado no DG Brasil. Estimativa, ainda sem medição na produção:
150 pastas com uns 10 arquivos cada devem levar de 20 a 40 minutos.

Se a rodada for chamada **sem o Drive configurado** (ou com a credencial
ilegível), ela não passa em silêncio: registra um erro no log do servidor
(`drive.cron_not_configured`) e responde 503. Com o aviso de erros ligado
([docs/deploy/producao.md](../deploy/producao.md), item 16), alguém fica sabendo.

## 5. Ligar as pastas que já existem

Em **Configurações → Integrações → Google Drive**:
1. **Testar conexão** (ADMIN): mostra a conta conectada e o nome da pasta dos
   clientes.
2. **Sugerir ligações:** lista os clientes ainda sem pasta, ao lado da pasta com
   o mesmo nome (sem acento, maiúsculas ou pontuação) e de onde ela fica. Confira e
   clique **Ligar** em cada uma. Nada é ligado sem um clique.
3. **Ligar todas as sugestões exatas** (ADMIN, desde 18/11/2026): depois de
   conferir a lista, liga de uma vez as sugestões com **uma só** pasta de nome
   **igual**. Cada pasta passa pelas mesmas conferências do **Ligar** (pasta
   ativa, dentro da pasta dos clientes, não aberta a "qualquer pessoa com o
   link"). A que falhar não para as outras e aparece numa lista com o motivo. As
   de nome parecido ou com várias pastas continuam uma a uma.
4. Os casos com várias pastas parecidas, ou sem pasta de nome igual, se ligam pela
   **ficha do cliente → Documentos → Pasta no Google Drive → Ligar pasta**
   (procura pelo nome).

**Onde o DG Brasil procura as pastas dos clientes (desde 18/11/2026).** Dentro da
pasta dos clientes valem os três jeitos de organizar
(`apps/frontend/src/server/integrations/google-drive/folder-tree.ts`):
- `<pasta dos clientes>\<ORIGEM>\CLIENTE BANCÁRIO\<NOME DO CLIENTE>`: o jeito da
  ponte desde a 060, com a pasta do escritório de origem (o próprio escritório ou
  um parceiro);
- `<pasta dos clientes>\CLIENTE BANCÁRIO\<NOME DO CLIENTE>`;
- `<pasta dos clientes>\<NOME DO CLIENTE>`: o jeito antigo.

A pasta de origem (a que tem um "CLIENTE BANCÁRIO" dentro), a própria
"CLIENTE BANCÁRIO" e a "BASE DE CONHECIMENTO" nunca aparecem como pasta de
cliente, nem na sugestão nem na busca. Para trazer os clientes de um parceiro,
coloque as pastas deles em `<pasta dos clientes>\<NOME DO PARCEIRO>\CLIENTE
BANCÁRIO\`, cadastre (ou importe) os clientes e use a sugestão.

**Quem pode ligar qual pasta (desde 13/11/2026).** A conta do Google do
escritório enxerga mais do que as pastas dos clientes. Por isso:
- pasta **dentro** da pasta dos clientes (`GOOGLE_DRIVE_ROOT_FOLDER_ID`), em
  qualquer nível: administradora ou advogado;
- pasta **de fora** dela, ou enquanto a pasta dos clientes não estiver
  configurada: só a administradora;
- a própria pasta dos clientes nunca é ligada a um cliente.

A regra está em `apps/frontend/src/server/domain/drive/folder-scope.ts`.

Na ficha do cliente aparecem:
- a pasta ligada, com o link para abrir no Drive;
- a última sincronização;
- quantos arquivos vieram;
- quantos foram para o Drive;
- o botão **Sincronizar agora**.

## 6. O que não entra e por quê

| Arquivo na pasta | O que acontece |
|---|---|
| Google Docs, Planilhas ou Apresentações (nativos) | Não entra: não tem conteúdo fixo para conferir. Baixe como PDF na própria pasta. |
| Tipo que o DG Brasil não guarda (ex.: `.zip`, `.exe`) | Não entra |
| Maior que 50 MB | Não entra |
| Arquivo que o DG Brasil exportou | Não volta como importação |
| O mesmo arquivo de novo, sem mudança | Não duplica. Se o conteúdo mudar, entra como documento novo. |

## 7. Privacidade

- O DG Brasil nunca torna um arquivo público e nunca muda o compartilhamento.
- Pasta aberta a "qualquer pessoa com o link" é recusada ao ligar e bloqueia o
  envio.
- Os documentos que já estão no Drive continuam lá. O DG Brasil passa a ter uma
  cópia interna, com auditoria de quem abriu.
