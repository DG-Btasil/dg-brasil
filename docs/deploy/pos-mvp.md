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
| 6 | **PRIORIDADE.** Distribuição dos agentes do kit (clones `-dg`): botão "Setup" no site | Só no computador do escritório, fora do repositório (que é público) | Decidir o desenho e construir | Sem custo |
| 7 | Titular do comprovante de residência no cadastro do cliente | O Lucas compara o nome do comprovante com o do cliente | Decidir como o campo deve ser | Sem custo |

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

## 6. Distribuição dos agentes do kit: botão "Setup" no site (PRIORIDADE)

**Primeiro item a resolver depois do lançamento** (decisão de Barbara,
12/11/2026). Dá trabalho e precisa de um bom desenho; por isso não entrou agora.

**Como está no lançamento:** os 13 clones e os scripts deles existem **só no
computador do escritório**, na pasta `agentes/` da cópia local do projeto. Essa
pasta **não vai para o GitHub**: o repositório é público e os clones trazem o
método do escritório (teses, modelos, regras de redação, textos de procuração e
de contrato, material das Lives). O `.gitignore` impede o envio por engano. O
instalador dos clones ([instalacao.md](../mcp/instalacao.md), seção 5.0) lê
dessa pasta local. No site fica só o cadastro de cada agente (migration 054).

**Riscos de ficar assim:**
- não há cópia dos clones fora desse computador;
- instalar num segundo computador exige copiar a pasta à mão;
- o endereço do instalador do conector no site também é público: nada do
  método pode ir para lá.

**A ideia (Barbara, 12/11/2026):** levar os agentes para dentro do DG Brasil.
Em **Computador do escritório → Autorizar computador**, depois do nome, a tela
oferece **Baixar setup** ou **Seguir**. O setup traz o instalador, os agentes,
os scripts e os dados de quem assina.

**Pontos do desenho a decidir:**
- onde guardar os arquivos dos agentes no DG Brasil (área privada, nunca a
  pasta pública do site);
- só ADMIN logado baixa, e fica registrado quem baixou, quando e qual versão;
- a chave do computador **não** vai dentro do arquivo baixado (um setup
  esquecido na pasta de downloads não pode abrir o DG Brasil);
- o mesmo botão na linha de cada computador já autorizado, para atualizar
  quando um agente melhorar;
- de onde vêm os dados de quem assina e as condições do contrato (honorários,
  custo inicial): hoje estão em `C:\DGBrasil\agentes\escritorio.json`, só no
  computador; o cadastro do escritório no site ainda não tem todos;
- se outros escritórios usarem o DG Brasil: o que é kit do DG Brasil e o que é
  método deste escritório.

**Junto disso, pensar:**
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

## Depois do lançamento: o que anotar

Para decidir a versão final, a equipe anota (num canal ou documento combinado):
- telas confusas, campos que faltam e erros, com o print e o horário;
- o que ainda é feito fora do DG Brasil e deveria entrar nele;
- quanto espaço os documentos estão ocupando no Supabase (painel do projeto).

## Como acrescentar um item

Na tabela do resumo (uma linha) e numa seção própria com: o que é, como está no
lançamento, o que falta.
