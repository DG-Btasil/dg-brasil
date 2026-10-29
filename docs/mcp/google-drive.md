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

Abra no navegador a pasta que contém as pastas dos clientes (hoje,
`01. ADVOCACIA — CLIENTES\CLIENTE - ESCRITÓRIO`). O identificador é o trecho
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

O arquivo `apps/frontend/vercel.json` agenda `/api/cron/drive-sync` **uma vez por
dia**, por volta das 6h de Brasília (`0 9 * * *`; a Vercel usa UTC e, no plano
Hobby, chama em algum momento entre 6h00 e 6h59). Cada rodada:
1. envia até 5 versões aprovadas que estão na fila;
2. confere até 5 pastas ligadas, das mais antigas para as mais novas.

| Variável | Valor |
|---|---|
| `CRON_SECRET` | Um texto aleatório longo. A Vercel envia esse valor na chamada, e a rota recusa sem ele. |
| `DG_WORKER_DB_URL` | Login `dg_worker` pelo pooler do Supabase (o mesmo da API do computador do escritório) |

> Uma vez por dia é o máximo do plano gratuito da Vercel (Hobby): com agendamento
> mais frequente, o deploy é recusado. Enquanto isso, use **Sincronizar agora** na
> ficha do cliente. Na produção, a rodada volta a ser a cada 15 minutos: ver
> [docs/deploy/producao.md](../deploy/producao.md).

## 5. Ligar as pastas que já existem

Em **Configurações → Integrações → Google Drive**:
1. **Testar conexão** (ADMIN): mostra a conta conectada e o nome da pasta dos
   clientes.
2. **Sugerir ligações:** lista os clientes ainda sem pasta, ao lado da pasta com
   o mesmo nome (sem acento, maiúsculas ou pontuação). Confira e clique **Ligar**
   em cada uma. Nada é ligado sozinho.
3. Os casos com várias pastas parecidas, ou sem pasta de nome igual, se ligam pela
   **ficha do cliente → Documentos → Pasta no Google Drive → Ligar pasta**
   (procura pelo nome).

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
