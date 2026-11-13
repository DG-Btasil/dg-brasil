# Cópia de segurança e restauração dos documentos

O backup do Supabase cobre o **banco de dados**: cadastros, casos, prazos,
financeiro. Ele **não** cobre os **arquivos** (PDF, DOCX, planilhas), que ficam
no Storage, em quatro buckets: `legal-documents` (documentos dos clientes e
minutas), `reference-materials`, `imports` e `skill-files`.

Sem cópia dos arquivos, um documento apagado ou corrompido no Storage não volta.
O banco continua dizendo que o documento existe, mas o conteúdo se perdeu.

O script é `supabase/scripts/backup-documentos.mjs`. Na origem ele só **lê**
(lista e baixa). A única coisa que escreve no Storage é a restauração, e só com
confirmação.

> **Situação em 13/11/2026:** a lógica foi testada com um Storage simulado
> (`npm run test:scripts`, em `supabase/`). **Ainda não rodou contra o Supabase
> de verdade.** A primeira rodada real tem de ser acompanhada, começando pela
> simulação (passo 2), no projeto de desenvolvimento.

## Decisões da dona do escritório (pendentes)

1. **Para onde vai a cópia.** O script grava numa pasta. Pode ser um disco
   externo, um segundo computador ou uma pasta sincronizada com outro serviço de
   nuvem. O que importa: fora do Supabase e, de preferência, fora do computador
   do escritório. Os arquivos têm dado de cliente: o destino precisa de senha ou
   criptografia e entra na revisão LGPD.
2. **De quanto em quanto tempo.** Recomendado: todo dia útil. Quem roda, e em
   que computador.
3. **Por quanto tempo guardar** as cópias de arquivos que já saíram do sistema.

## Preparar (uma vez)

1. No computador que vai fazer a cópia: Node.js 22 ou mais novo e a pasta do
   projeto. Em `supabase/`, rodar `npm ci`.
2. Criar o arquivo de chaves `supabase/.env.backup` (ele está no `.gitignore`;
   nunca vai para o GitHub):

   ```
   SUPABASE_URL=https://<identificador do projeto>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<chave service role do projeto>
   ```

   A chave service role lê tudo. Guarde esse arquivo como se guarda uma senha.

## Fazer a cópia

```powershell
cd supabase
# 1. Simulação: mostra o que seria copiado e não grava nada.
node --env-file=.env.backup scripts/backup-documentos.mjs --destino "D:\Backup DG Brasil" --simular
# 2. A cópia de verdade.
node --env-file=.env.backup scripts/backup-documentos.mjs --destino "D:\Backup DG Brasil"
```

- A primeira rodada copia tudo. As seguintes copiam só o que é novo ou mudou.
- No fim sai o relatório: por bucket, quantos arquivos havia, quantos foram
  copiados, quantos não mudaram e as falhas. O mesmo relatório fica em
  `_relatorios/` dentro do destino.
- **"Terminou sem falhas."** = pode confiar. **"TERMINOU COM FALHAS"** = ler a
  lista e rodar de novo (o que já foi copiado não é baixado outra vez).
- Arquivo que sumiu do Storage **não** é apagado da cópia. Arquivo que mudou no
  Storage é copiado, e a cópia de antes vai para `_versoes-anteriores/`.

Como fica a pasta de destino:

| Pasta | O que tem |
|---|---|
| `<bucket>/…` | A cópia atual de cada arquivo, no mesmo caminho do Storage |
| `_manifestos/<bucket>.json` | A lista do que foi copiado: tamanho, data e a impressão digital (sha256) de cada arquivo |
| `_versoes-anteriores/` | A cópia de antes, quando um arquivo mudou na origem |
| `_relatorios/` | Um relatório por rodada |

## Restaurar

### Antes de restaurar: o que se perdeu?

- **Só o arquivo** (o cadastro do documento continua no site, mas abrir ou
  baixar dá erro): é este roteiro.
- **O banco** (cadastros, casos, o próprio registro do documento): é a
  restauração do Supabase (painel → Database → Backups), feita primeiro. Depois
  dela, restaure os arquivos por este roteiro.

### Um arquivo ou uma pasta

Use quando souber qual documento falta. No bucket `legal-documents`, o caminho
de cada arquivo é `clients/<id do cliente>/documents/<id do documento>/<id da
versão>/<nome>`; ele está na coluna `storage_object_name` de `document_versions`.

```powershell
cd supabase
# 1. Simulação: mostra o que seria reenviado.
node --env-file=.env.backup scripts/backup-documentos.mjs --restaurar --destino "D:\Backup DG Brasil" --bucket legal-documents --prefixo "clients/<id do cliente>/" --simular
# 2. De verdade.
node --env-file=.env.backup scripts/backup-documentos.mjs --restaurar --destino "D:\Backup DG Brasil" --bucket legal-documents --prefixo "clients/<id do cliente>/" --confirmar
```

### Um bucket inteiro

O mesmo comando, sem `--prefixo`. Repetir para cada bucket.

### O que a restauração garante

- Só reenvia o que **não existe** no Storage. **Nunca sobrescreve** um arquivo
  que está lá.
- Antes de enviar, confere a impressão digital da cópia com a do manifesto.
  Cópia alterada ou corrompida não é enviada e aparece como falha.
- O arquivo volta no mesmo caminho. O site volta a abrir o documento sem mexer
  no banco.

### Conferir depois

1. No site, abrir e baixar dois ou três dos documentos restaurados.
2. O `document_versions.checksum_sha256` do banco, quando preenchido, tem de
   bater com o `sha256` do manifesto para o mesmo caminho.
3. Guardar o relatório da restauração (`_relatorios/restauracao-…json`).

## Ensaio (fazer antes da produção)

No projeto de **desenvolvimento**, com dados fictícios:

1. fazer a cópia completa;
2. apagar um arquivo de teste pelo painel do Supabase (Storage);
3. confirmar no site que o documento não abre;
4. restaurar com `--prefixo` e confirmar que voltou a abrir;
5. anotar quanto tempo levou.

Um backup que nunca foi restaurado não é um backup: é uma esperança.

## O que este roteiro não cobre

- Restauração do banco de dados (é do Supabase; avaliar o PITR em
  [producao.md](producao.md), item 3).
- Os arquivos que ficam só no computador do escritório e no Google Drive (a
  pasta de trabalho dos agentes). O que foi aprovado no DG Brasil está no
  Storage; o resto é da rotina de backup do escritório.
