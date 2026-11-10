# Depois do MVP: o que muda da versão beta para a versão final

O DG Brasil vai para produção em **10/11/2026 como versão beta (MVP)**: o app da
equipe (`app.dgbrasil.adv.br`) e o portal dos parceiros (`portal.dgbrasil.adv.br`),
com dados reais. O que é preciso para **lançar** está em
[producao.md](producao.md). Este arquivo junta o que fica para a **versão final**:
o que já está pronto no código e falta ligar, o que falta construir, e as decisões
pendentes.

## Resumo

| # | O quê | Situação no beta | O que falta | Custo |
|---|---|---|---|---|
| 1 | Agentes do escritório trabalhando pelo DG Brasil (ponte) | Pronto no código, **desligado** | Validar na máquina principal e ligar | Sem custo |
| 2 | Sincronização com o Google Drive | Pronta no código, **desligada** (sem credencial) | Credencial, teste, ligar os clientes aos poucos | Sem custo; a cada 15 min exige o Vercel Pro |
| 3 | Consulta de CPF na Receita (Serpro) | Pronta no código, desligada | Contratar a Consulta CPF | Por consulta |
| 4 | Validação de formato dos documentos | Só o básico | Construir | Sem custo |
| 5 | Domínio consignado (análise do HISCON no DG Brasil) | Fora do MVP | Construir (desenho pronto) | Sem custo |
| 6 | Agendamentos atuais dos agentes (risco R1) | Como estão | Decidir | — |
| 7 | Correções nos arquivos dos agentes do escritório | Defeitos já existentes | Corrigir no repositório dos agentes | Sem custo |
| 8 | Ajustes pequenos | — | Ver a lista | Sem custo |

---

## 1. Agentes do escritório trabalhando pelo DG Brasil (ponte)

**O que é:** a Clara, o Lucas e os redatores (Alice, Murilo, Atlas...) passam a
receber trabalho do DG Brasil e a devolver o resultado em **Revisões**, sem mudar
nada nos arquivos deles. Desenho e implementação: [../ponte.md](../ponte.md).

**No beta:** o código está no ar (migration 051, conector 1.1.0, instalador,
agentes Porteiro, Arquivista e Mensageiro), mas **a ponte fica desligada**. Para
continuar assim até a validação:
- **não** rodar o instalador novo na máquina principal; se precisar reinstalar,
  rodar antes `$env:DG_BRASIL_PONTE = '0'`;
- **não** cadastrar os agentes reais (`clara-hiscon`, `lucas-procuracao`...) no DG
  Brasil de produção, nem ligar a Clara ao modelo "Análise Bancária".

No beta, os agentes continuam trabalhando como hoje, pelos agendamentos.

**Para ligar (versão final):**
1. Na máquina principal, uma sessão de cerca de 2h30 com a Barbara presente:
   [Frente B da validação](../mcp/ponte-validacao-maquina-principal.md)
   (`PB-01` a `PB-25`), com dados fictícios, no DEV.
2. Passou: rodar o instalador na máquina principal apontando para a produção,
   cadastrar os agentes reais no DG Brasil de produção e ligar a Clara à
   "Análise Bancária".
3. Acrescentar ao `ponte.json` a frente **PMP** e a **Fazenda Pública**, depois de
   conferir os nomes exatos dos agentes e a pasta das teses.
4. **Simplificar:** os três ajudantes (Porteiro, Arquivista, Mensageiro) podem
   virar um só, porque a cópia e a volta já são feitas por código. O Porteiro
   (leitura dos documentos) é o único que precisa de IA.

**Já decidido por Barbara (10/11/2026):** `python` e `powershell` liberados para os
agentes; internet liberada para conferir jurisprudência e índices (sem dado do
cliente nas buscas).

## 2. Sincronização com o Google Drive

**O que é:** cada cliente do DG Brasil ligado à pasta dele no Drive do
escritório. Arquivo novo na pasta entra no DG Brasil; documento aprovado em
Revisões vai para a pasta. Guia: [../mcp/google-drive.md](../mcp/google-drive.md).

**No beta:** desligada (sem credencial na Vercel). Nada no Drive é lido nem gravado.

**Para ligar:**
1. Criar a credencial (OAuth para conta Gmail, conta de serviço para Drive
   compartilhado do Workspace) e gravar nas variáveis da Vercel.
2. Testar no DEV com uma pasta "DG TESTE" (itens PA-16 a PA-18 de
   [ponte-validacao-fora.md](../mcp/ponte-validacao-fora.md)).
3. Na produção, ligar os clientes **aos poucos** (5 a 10 primeiro). A primeira
   sincronização de cada um traz tudo o que já está na pasta (até 2 níveis de
   subpasta, 30 arquivos por rodada): isso ocupa espaço no Supabase.
4. Contratar o **Vercel Pro** para sincronizar a cada 15 minutos. No plano
   gratuito, é 1 vez por dia e 5 pastas por rodada
   ([producao.md](producao.md), itens 1 e 2).

Com o Drive ligado, a ponte (item 1) passa a achar a pasta do cliente pela
ligação; sem ele, ela só funciona com `"pasta_pelo_nome": true` no `ponte.json`.

## 3. Consulta de CPF na Receita (Serpro)

Código pronto e desligado. Contratar a **Consulta CPF** na Loja Serpro e pôr as
chaves na Vercel. Detalhes em [producao.md](producao.md), item 12.

## 4. Validação de formato dos documentos

Pedido de Barbara para a versão final: dígito verificador de CPF e CNPJ, RG por
estado, CNH (11 dígitos com verificador), OAB por seccional e número CNJ com
verificador, no formulário e no servidor. Detalhes em
[producao.md](producao.md), item 13.

## 5. Domínio consignado

A análise do HISCON dentro do próprio DG Brasil (blocos de ação, contratos,
cálculos) ficou fora do MVP em 05/11/2026. Hoje quem faz é a Clara. Desenho
pronto em [../futuro/dominio-consignado.md](../futuro/dominio-consignado.md).

## 6. Agendamentos atuais dos agentes (risco R1)

Os agendamentos da máquina principal rodam o Claude Code com
`--dangerously-skip-permissions`. É o maior risco do escritório (segurança e
termos de uso da Anthropic), fora do escopo por decisão
([../mcp/relatorio-final.md](../mcp/relatorio-final.md)). Com a ponte ligada,
parte desse trabalho pode passar a vir pelo DG Brasil, com permissões
controladas. Decidir na versão final.

## 7. Correções nos arquivos dos agentes do escritório

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

## 8. Ajustes pequenos

- **Instalador:** as mensagens com acento podem aparecer estragadas na tela do
  PowerShell (o site serve o arquivo sem codificação declarada). Só exibição.
- **ADMIN consegue ler, pelo banco, o hash da reserva** de cada execução
  (`agent_runs.lease_token_hash`): baixo risco; fechar numa migration futura.
- **Telas do perfil LAWYER** do computador do escritório: conferência pendente
  desde a refatoração MCP.

---

## Durante o beta: o que anotar

Para decidir a versão final, a equipe anota (num canal ou documento combinado):
- telas confusas, campos que faltam e erros, com o print e o horário;
- o que ainda é feito fora do DG Brasil e deveria entrar nele;
- quanto espaço os documentos estão ocupando no Supabase (painel do projeto).

## Como acrescentar um item

Na tabela do resumo (uma linha) e numa seção própria com: o que é, como está no
beta, o que falta para a versão final.
