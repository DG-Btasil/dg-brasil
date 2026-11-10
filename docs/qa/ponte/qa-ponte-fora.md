# Ponte · Frente A (fora da máquina principal): relatório

**Guia:** [docs/mcp/ponte-validacao-fora.md](../../mcp/ponte-validacao-fora.md)
**Quando:** 10/11/2026 · **Onde:** máquina BARBARACARDOSO (não é a principal),
pelo Claude Code · **Commit validado:** `79f3d24` (master)

**Resultado:** APROVADA ATÉ ONDE DÁ PARA TESTAR DAQUI. Falta o `db push` da 051
no DEV (PA-14, PA-15: esta máquina não tem o Supabase CLI ligado ao DEV) e o
Drive real (PA-16 a PA-18: a credencial está sendo criada).

| Item | Resultado | O que se viu |
|---|---|---|
| PA-01 | OK | `npm run verificar`: 846 verificações, todas passaram; as 6 da seção [051] passaram |
| PA-02 | OK | conector: `tsc` sem erro, 36 de 36 testes |
| PA-03 | OK | site: `tsc` sem erro, 626 de 626 testes (48 arquivos); eslint sem erro nos arquivos alterados |
| PA-04 | OK | `npm run bundle` depois do commit: nenhum arquivo mudou |
| PA-05 | OK | o instalador passa no analisador do PowerShell lido em UTF-8 e em ISO-8859-1 |
| PA-06 | OK | `ponte.json` simulado: raízes `000. PASTA CLIENTES NOVOS` e `01. ADVOCACIA — CLIENTES`; Clara em `7. KIT DO CLIENTE` e `3. PROCURAÇÃO ASSINADA`; redatores em `...\CLIENTE - ESCRITÓRIO`; 13 agentes; `pasta_pelo_nome: false`. Acentos certos nas duas codificações |
| PA-07 | OK | `settings.json` simulado a partir de um antigo com `WebFetch`, `WebSearch` e `Read(D:/segredo/**)` no `deny`: `WebFetch`/`WebSearch` no `allow` e fora do `deny`; a regra extra foi mantida; `mcp__claude_ai_*` e o arquivo do token continuam bloqueados; as 4 ferramentas da ponte e as 12 regras do `G:` presentes |
| PA-08 | OK | com `DG_BRASIL_PONTE=0`: sem `ponte.json`, sem regras da ponte, internet continua no `deny` |
| PA-09 | OK | segunda rodada manteve o `ponte.json` existente |
| PA-10 | OK | script do Porteiro: `hiscon`, `identidade`, `comprovante` e `carta-maliciosa` liberados (a carta é texto, fica para a leitura na Frente B); `pdf-com-javascript-ficticio.pdf` suspeito (`/JavaScript`, `/JS`) |
| PA-11 | OK | 40 PDFs reais da pasta Downloads: 39 liberados, 1 recusado por ter mais de 50 MB, nenhum suspeito. A primeira versão marcava 9 de 40 como suspeitos por acaso (bytes de imagem e fonte formando `/JS`); corrigido antes deste relatório: a busca agora olha só os objetos e os "object streams" |
| PA-12 | OK | `doctor` com uma ponte de teste: `FALHA` para a raiz inexistente e para a etapa que falta, `FALHA` para os três agentes da ponte (não instalados nesta máquina), `AVISO` para o `.md` da Clara, `OK` para antivírus e Edge. `ponte.json` com JSON inválido também vira `FALHA` com a posição do erro |
| PA-13 | OK | deploy do `79f3d24` no ar às 01:46: o `dg-executor.mjs` publicado tem `verificar_arquivos`, `/executor/agentes/porteiro-dg.md` responde 200 e o `instalar.ps1` publicado tem a ponte. O teste do guia ("/bridge responde 401") foi trocado: sem token, qualquer rota da API responde 401 (conferido com uma rota inexistente) |
| PA-14 | NÃO TESTADO | precisa da máquina com o Supabase CLI ligado ao DEV |
| PA-15 | NÃO TESTADO | idem |
| PA-16 a PA-18 | NÃO TESTADO | esperando a credencial do Drive |
| PA-19 | OK, depois de correção | o `--blink-settings=scriptEnabled=false` do plano impedia o Edge de gerar o PDF (Edge sai com código 0 e não grava nada). Trocado por uma cópia do HTML com CSP `default-src 'none'`: PDF de 14,8 KB em 1,5 s, e o `--dump-dom` mostra que o script do HTML não rodou |
| PA-20 | OK | `MpCmdRun.exe -Scan -ScanType 3 -File ... -DisableRemediation` respondeu "limpo" para o HISCON fictício em 0,1 s |

## Observações

- **O site serve o `instalar.ps1` como `application/octet-stream`**, sem
  codificação declarada. O PowerShell 5.1 então tende a ler o texto em
  ISO-8859-1: por isso os caminhos com acento são montados por código de
  caractere (PA-05 a PA-07).
- **Mensagens do instalador com acento:** se o `irm | iex` entregar o texto em
  ISO-8859-1, as mensagens na tela saem com o acento estragado ("Nǜo deu...").
  É só exibição, e já acontecia antes. Os caminhos gravados (`ponte.json`,
  `settings.json`) ficam certos, porque são montados por código de caractere.
- **Site antes da 051:** a sincronização do Drive foi feita para continuar
  importando como antes enquanto a 051 não estiver no DEV (teste novo no site).
  A rota `/bridge` e os códigos novos de falha só funcionam depois da 051. A
  Frente B não pode começar antes do PA-14.
- **Antivírus com ameaça de verdade** (EICAR) não foi testado, para não disparar
  a quarentena desta máquina. O código 2 = ameaça está coberto pelo teste
  automático, com o antivírus simulado.
