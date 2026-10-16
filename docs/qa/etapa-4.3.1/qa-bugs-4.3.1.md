# QA 4.3.1 — Defeitos e observações

Nenhum código de produção foi alterado.

## BUG-07 — ASSISTANT não acessa as próprias preferências de notificação (média)

- **Esperado (checklist B):** "Configurações → Notificações (interno): só as categorias do perfil
  (ASSISTANT sem Revisões/Análises)".
- **Observado:** com o ASSISTANT, `/configuracoes?secao=notificacoes` → "Acesso restrito. Seu perfil não
  tem permissão para acessar esta área."; o menu do usuário não tem "Configurações".
- **Causa (código):** `apps/frontend/src/lib/permissions/index.ts:161-171`. O papel ASSISTANT não tem
  `settings.view` (exigido por `app/(app)/configuracoes/page.tsx`) nem `settings.notifications.edit`
  (exigido pela seção, `features/settings/hooks.ts:16`).
- **Impacto:** o ASSISTANT recebe avisos (Casos, Prazos, Documentos, Solicitações) e não consegue
  desligá-los. Segurança e dados não são afetados.
- **Sugestão:** dar ao ASSISTANT `settings.notifications.edit` e permitir a página `/configuracoes` só com
  as seções que ele pode ver (ou uma rota própria de preferências).

## Defeitos de teste (o produto se comporta conforme a regra nova)

| Id | Arquivo | Problema | Sugestão |
|---|---|---|---|
| TEST-01 | `apps/frontend/tests/integration/agents.int.test.ts:150-160` | Espera FORBIDDEN para o LAWYER cancelar e INVALID_STATE ao repetir; a 033 permite o LAWYER (caso que acessa) e torna a repetição idempotente. | Atualizar para a regra da 033. |
| TEST-02 | `apps/frontend/tests/integration/frontend-431-notifications.int.test.ts:51` | `type: "DOCUMENT"` não existe no enum (`DOCUMENT_REQUEST`, …) → ZodError. | Usar `DOCUMENT_REQUEST`. |
| TEST-03 | `apps/frontend/tests/integration/support/env.ts` (harness) | O código de Storage lê `SUPABASE_SERVICE_ROLE_KEY` e `NEXT_PUBLIC_SUPABASE_URL` de `process.env`, e o harness não os exporta. Com as variáveis exportadas, `frontend-431-review-edit` passa 3/3. | O global setup copiar `SUPABASE_URL`/chaves do `.env.real` para `process.env` (nomes do app). |

## Observações (baixa)

- **OBS-05 (BUG-05 parcial):** a OAB guarda todos os dígitos, mas é exibida como "OAB/SP 123456" depois de
  recarregar; o checklist espera "OAB/SP 123.456".
- **OBS-08:** na revisão antiga ("Alterações solicitadas") de uma minuta que já ganhou versão nova pela
  edição manual, a tela ainda oferece "Editar conteúdo"; ao salvar, o servidor recusa corretamente
  ("Existe uma versão mais nova deste documento: abra a revisão dela"). Sugestão: esconder ou desabilitar
  o editor quando a versão revisada não é a atual.
- **OBS-09:** análise interrompida aparece como "Cancelada" (com "Execução interrompida a pedido"); o
  checklist fala em "Interrompida".
- **OBS-10 (F-05):** obrigação com recebimento não oferece "Cancelar obrigação" (a opção some); o checklist
  fala em "pede estorno antes". Funciona, mas sem explicar por que a opção não aparece.
