# Importação de planilhas (Etapa 7)

Traz clientes e processos de outro sistema (ex.: ADVBOX) ou de planilhas para o
DG Brasil. Só o **administrador** importa. Fica em **Configurações → Integrações
→ Importações** (`/configuracoes/importacoes`).

**Princípio:** nada é gravado antes da confirmação. Linha com erro nunca é
gravada. Duplicata nunca é criada sem decisão humana. Tudo o que entra fica
rastreável até o arquivo e a linha de origem.

## O fluxo

| # | Etapa | O que acontece | Onde |
|---|---|---|---|
| 1 | **Envio do arquivo** | O banco cria a importação e decide o caminho no Storage (`imports/jobs/{id}/source.csv\|xlsx`); o servidor assina o upload só para esse caminho; o navegador envia. | `import_create_job` |
| 2 | **Colunas** | O servidor lê o arquivo do Storage, acha o cabeçalho (pula título acima dele), conta as linhas e sugere o campo de cada coluna pelo nome. Aviso se o **mesmo arquivo** (SHA-256) já foi enviado. XLSX com várias abas: dá para trocar de aba. | `import_register_columns` |
| 3 | **Mapeamento** | A pessoa confere qual coluna é qual campo. Se houver processos: área jurídica dos casos e advogado padrão. | `import_save_mapping` |
| 4 | **Simulação** | O servidor valida o formato de cada linha (CPF/CNPJ, CNJ com dígito verificador, datas, valores, UF, status, responsável) e envia o resultado ao banco, que confronta com o que **já existe** e abre os conflitos. Nada é gravado em clientes, casos ou processos. | `import_stage_rows`, `import_finish_dry_run` |
| 5 | **Conflitos e prévia** | Decisão em cada conflito (ou "todos deste tipo"). A prévia mostra quantos clientes/processos serão criados, atualizados, mantidos e ignorados — calculada **pela mesma regra que grava** (`private.import_row_actions`). | `import_resolve_conflicts`, `get_import_plan` |
| 6 | **Confirmação** | Trava mapeamento e decisões; registra quem confirmou e quando. | `import_confirm` |
| 7 | **Gravação** | Em lotes de 50 linhas (cabe no limite de tempo do usuário no banco). Cada linha numa subtransação: a que falha vira "não importada" com o motivo e não derruba as outras. Fechar a página não perde nada: ao voltar, continua de onde parou, sem duplicar. | `import_process_batch` |
| 8 | **Relatório** | Por linha: importada / ignorada / não importada, o que criou ou atualizou (com links) e os motivos. CSV para o Excel (só as linhas com problema, ou todas). O arquivo enviado é apagado do Storage. | `import_row_results.outcome` |

Estados do job (013): `UPLOADED → COLUMNS_DETECTED → MAPPED → VALIDATED |
CONFLICTS_PENDING → CONFIRMED → PROCESSING → COMPLETED`, mais `FAILED` (arquivo
ilegível) e `CANCELLED` (antes da gravação).

## Regras de negócio

- **Todo processo pertence a um caso, e todo caso a um cliente.** Para cada
  processo novo, a importação cria um caso **em andamento** (encerrado, se o
  processo está encerrado/arquivado), origem no escritório, área escolhida no
  mapeamento e advogado = o "Responsável" da linha quando é advogado/ADMIN da
  equipe, senão o advogado padrão.
- **Mesmo CPF/CNPJ em várias linhas = um cliente.** Vale a primeira linha sem
  erro; se o nome diverge, a linha seguinte ganha um aviso.
- **CPF/CNPJ já cadastrado** → conflito: *Atualizar o cadastro* (só os campos
  preenchidos na planilha; vazio não apaga; endereço é mesclado; observações
  internas não são sobrescritas) ou *Manter como está*. Nos dois casos os
  processos da planilha são vinculados a esse cliente. Nunca cria outro cliente.
- **CNJ já cadastrado** → conflito: *Atualizar o processo* (só campos
  preenchidos; o cliente do processo não muda; nenhum prazo é criado) ou
  *Ignorar*.
- **Nome igual (sem acento/maiúsculas) a cliente com outro documento** →
  possível duplicata: *Criar mesmo assim* ou *Ignorar as linhas desse cliente*.
- **Processo sem CPF/CNPJ na linha** (o relatório de processos do ADVBOX não traz
  CPF): o processo é ligado ao cliente **já cadastrado** com o mesmo nome —
  exatamente um. Nenhum, ou mais de um homônimo: a linha fica de fora, com o
  motivo. A decisão do conflito já nasce "Manter". Migração recomendada: primeiro
  a planilha de **clientes** (com CPF), depois a de **processos**.
- **CPF/CNPJ ou CNJ de cadastro excluído** → erro (restaure antes; não se
  reaproveita cadastro excluído por baixo dos panos).
- **Vencimento** vira prazo (tipo interno, 18h do dia, responsável do processo)
  só em processo **novo** e com data de hoje em diante.
- **Formato:** CPF/CNPJ pela quantidade de dígitos, como no cadastro; dígito
  verificador errado só gera aviso. Zero à esquerda que o Excel tirou de CPF/CNPJ
  numérico é recolocado, com aviso. CNJ precisa do dígito verificador correto
  (o banco recusa). E-mail, telefone, CEP, UF, datas e valores inválidos são
  descartados com aviso — a linha continua.
- **Cadastrado entre a simulação e a gravação** (alguém criou o mesmo CPF ou CNJ
  pela tela): a linha falha com o motivo; refaça a importação para decidir.

## Campos aceitos

Cliente: nome/razão social\*, CPF/CNPJ, tipo (PF/PJ), e-mail, telefone, CEP,
logradouro, número, complemento, bairro, cidade, UF, observações internas.
Processo: número CNJ, nome resumido, tipo de ação/classe, assunto, tribunal,
vara, comarca, UF, parte contrária, polo do cliente, responsável, status, data de
distribuição, valor da causa, próximo vencimento, observações internas.

A lista é a mesma no front (`src/lib/domain/import-fields.ts`) e no banco
(`private.import_target_fields()`); um teste unitário confere.

**Fora da V1, por decisão:** contratos de honorários e lançamentos financeiros
(têm ciclo de vida próprio no Financeiro), documentos PDF/DOCX e a API do ADVBOX
(a migração é pela planilha exportada).

## Limites

- CSV (UTF-8 ou Windows-1252, separador `;`, `,` ou tabulação) e Excel `.xlsx`.
  `.xls` antigo: salvar como `.xlsx`.
- 20 MB (limite do bucket), 5.000 linhas e 200 colunas por importação.
- Planilha protegida por senha não é lida.

## Segurança e rastro

- **Permissão** `imports.manage`, só ADMIN, no servidor (`runAction`) e de novo
  no banco (toda função `import_*` confere `private.is_admin()`). Advogado,
  assistente e parceiro não leem nem operam importações (RLS da 016).
- **Storage:** o bucket `imports` continua fechado ao navegador (017). O
  servidor usa a service role **só** no caminho que o banco devolveu
  (`server/domain/imports/storage.ts`, inventário em [backend.md](backend.md)).
- **Nada de conteúdo da planilha no log** do servidor: só ids e contagens.
- **Rastro:** o job e as decisões de conflito ficam na auditoria (gatilhos da
  013) e o resumo final em `IMPORT_JOB_SUMMARY`; cada cliente, caso, processo e
  prazo criado é auditado pelos gatilhos de sempre, com o mesmo `request_id`; o
  processo ganha a movimentação "Cadastro por importação" (origem `IMPORT`) e as
  observações internas citam o arquivo e a linha; `import_row_results.outcome`
  guarda os ids do que cada linha criou ou atualizou.
- **Retenção (LGPD):** o arquivo é apagado do Storage quando a importação termina
  ou é cancelada. A linha original e a normalizada (dado pessoal) são apagadas 30
  dias depois do fim; a procedência (ids, situação, motivos) fica. Importação
  parada antes da confirmação por 7 dias é cancelada. Rotina diária no `pg_cron`
  (`dg-importacoes`, 06:17 UTC → `private.import_housekeeping()`).
- **Avisos no sino:** o prazo criado avisa o responsável, como qualquer prazo
  novo (quem importa não recebe aviso do que ele mesmo criou).

## Código

| Parte | Onde |
|---|---|
| Banco | `supabase/migrations/20261031000042_spreadsheet_import.sql` |
| Leitura do arquivo (CSV, XLSX via `zlib` do Node, sem dependência nova) | `apps/frontend/src/server/domain/imports/parse/` |
| Validação/normalização da linha | `apps/frontend/src/server/domain/imports/normalize.ts` |
| Serviço e actions | `apps/frontend/src/server/domain/imports/{service,actions,repository,mappers}.ts` |
| Telas | `apps/frontend/src/features/data-import/`, `src/app/(app)/configuracoes/importacoes/` |
| Testes | `supabase/tests/verificar.mjs` (seções `[042]`), `supabase/tests/real/validar-real.mjs` (41h), `src/server/domain/imports/imports.test.ts`, `tests/integration/imports.int.test.ts` |
