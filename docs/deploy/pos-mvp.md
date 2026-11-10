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

## 4. Correções nos arquivos dos agentes do escritório

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

---

## Depois do lançamento: o que anotar

Para decidir a versão final, a equipe anota (num canal ou documento combinado):
- telas confusas, campos que faltam e erros, com o print e o horário;
- o que ainda é feito fora do DG Brasil e deveria entrar nele;
- quanto espaço os documentos estão ocupando no Supabase (painel do projeto).

## Como acrescentar um item

Na tabela do resumo (uma linha) e numa seção própria com: o que é, como está no
lançamento, o que falta.
