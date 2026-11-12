# Ponte · Frente B (computador do escritório): relatório

**Guia:** [docs/mcp/ponte-validacao-maquina-principal.md](../../mcp/ponte-validacao-maquina-principal.md)
**Quando:** 10 e 11/11/2026 · **Onde:** DESKTOP-9AB21K5 ("Computador principal"), pelo
Claude Code, com a Barbara no computador · **Commit validado:** `13448f6` (master)
**Coleta do script:** branch `qa/ponte-frente-b-20261111-2044`
(`docs/qa/ponte/frente-b/20261111-2044/`)

**Resultado:** APROVADA NO DEV, COM RESSALVAS. Os quatro trabalhos passaram pela ponte
inteira e voltaram para Revisões:
- Clara nos casos 1, 2 e 3;
- Lucas no caso 1.

O Porteiro barrou os dois documentos maliciosos. Nada foi aprovado, enviado nem
protocolado.

**Ressalvas:**
- A pasta do Drive foi resolvida **pelo nome do cliente** (`-PastaPeloNome`), porque o
  site ainda não tem a credencial do Drive. A pasta ligada pelo site (PA-16 a PA-18)
  continua sem teste.
- A primeira tentativa só funcionou depois da correção do atalho da vigia (achado 1).

## Tentativas

| Quando | O que houve |
|---|---|
| 10/11, 14:17 | Instalação OK (PB-01 a PB-06). A vigia abriu e o Claude Code fechou na hora. O interruptor estava desligado e nenhum trabalho foi disparado. |
| 10/11, 17:55 | Mesmo defeito da vigia. A Barbara abriu um `claude` simples na janela, que conectou mas carrega os conectores do claude.ai. A validação foi pausada antes de disparar os trabalhos. |
| 11/11, 20:44 | Com o `13448f6`, a vigia conectou sozinha. Os quatro trabalhos foram processados entre 21:01 e 21:35. |

## Tabela PB

| Item | Resultado | O que se viu |
|---|---|---|
| PA-14 | OK | A 051 está no DEV. Sem token de reserva, a rota `bridge` (só existe com a 051) respondeu 403 "não reservado", igual à `context`; sem a função, seria 500 |
| PB-01 | OK | o passo da ponte apareceu no instalador |
| PB-02 | OK | `ponte.json` com 13 agentes (Clara e Lucas incluídos), raízes `000. PASTA CLIENTES NOVOS` e `01. ADVOCACIA — CLIENTES`, acentos certos |
| PB-03 | OK | `porteiro-dg`, `arquivista-dg` e `mensageiro-dg` instalados |
| PB-04 | OK | ferramentas da ponte e internet no `allow`; conectores do claude.ai no `deny` |
| PB-05, PB-06 | OK | `doctor` sem FALHA; conector 1.1.0 |
| PB-MCP | OK | `claude mcp list` na pasta da sessão: `dg-brasil` conectado |
| PB-07 | OK, com adaptação | Cadastrados os agentes e os dados de teste (detalhes abaixo). Pasta resolvida pelo nome (`-PastaPeloNome`) |
| PB-VIGIA | OK, depois da correção | Antes do `13448f6`, o Claude Code fechava ao abrir (achado 1). Depois, a vigia abriu e o conector subiu 1 s depois (processo `node dg-executor.mjs mcp`, filho do Claude da vigia) |
| PB-CONECTOR | falso negativo do script | O script registrou "não subiu em 3 min", mas o conector estava rodando desde 20:44:58 e o site mostrava "Computador conectado" (achado 2) |
| PB-09 | OK | `porteiro.json` capturado nos 4 trabalhos |
| PB-10 | OK | `HISCON.pdf`, `IDENTIDADE.pdf`, `COMPROVANTE DE RESIDÊNCIA.pdf` e `DADOS DO CADASTRO.txt` na pasta de teste às 21:01 e 21:02. O cadastro saiu com "aposentado", "casado(a)" e `conversa_id` vazio |
| PB-11 | OK | `ROTEIRO_CONSIGNADO_..._2026-11-11.html` (21:04) e `TETO_NORMATIVO_...html` (21:05) na pasta de teste |
| PB-12 | OK | Em Revisões estão a análise (resumo por bloco: A-1, C-1 e D-1; G e H descartados com motivo), "Roteiro de ações (Clara)" e "Análise do teto normativo (Clara)", os dois como PDF convertido do HTML e internos. Mais 6 propostas da Clara (conferir A-1, RMC de 10/2023, titular, teto [CONFERIR], próxima etapa e o achado 6) |
| PB-13 | a conferir pela Barbara | O cadastro levado à pasta não tinha `conversa_id` nem `contact_id`, então a Clara não tinha conversa para anotar. Falta a Barbara confirmar no app do ChatJurídico |
| PB-14 | OK | Os 4 trabalhos terminaram (pasta apagada pela vigia). A vigia não ficou parada pedindo confirmação |
| PB-15 | OK | A linha do tempo mostra: reservado, documentos abertos, Ponte 1 (Porteiro), Ponte 2 (Arquivista), agente, Ponte 4 (Mensageiro), minutas, propostas e "Aguardando decisão humana" |
| PB-16/18 | OK | Caso 2: o script liberou a carta, a leitura do Porteiro a **recusou** ("texto dirigido a uma IA manda ignorar instruções…"). Caso 3: o script marcou o PDF como **suspeito** (`/JavaScript`, `/JS`) e ele não foi lido |
| PB-17 | OK, com ressalva | Nos dois casos: pendência de prioridade alta em Revisões, com o arquivo e o motivo; execução "Falhou · O Porteiro parou o trabalho". Arquivista, Clara e Mensageiro não rodaram e nada foi copiado para a pasta. A aba Análise do caso mostra só "A execução anterior não terminou" (achado 4) |
| PB-20 | OK | `Procuracao_FICTICIO.pdf` e `Declaracao_Hipossuficiencia_FICTICIO.pdf` na pasta de teste (21:33) |
| PB-21 | OK | "Procuração (Lucas)" na categoria Procuração e "Declaração de hipossuficiência (Lucas)" na categoria certa, em Revisões. Mais 6 propostas do Lucas (nome sem o prefixo de teste, nacionalidade, data e local, comprovante, contrato de honorários, travessão do modelo) |

**Dados de teste cadastrados no site (A1):**
- agentes "Clara · Análise do HISCON (ponte)" (`clara-hiscon`, ligada à Análise Bancária) e "Lucas · Kit do cliente (ponte)" (`lucas-procuracao`), ativos;
- cliente "DG Teste - José da Silva Fictício";
- três casos bancários;
- interruptor geral ligado em 10/11, às 17:53, pela Barbara.

## Achados

1. **Atalho da vigia fechava o Claude Code na hora. Corrigido no `13448f6`.**
   - **O defeito:** o `--mcp-config` aceita vários arquivos. Escrito depois dele, o texto
     do `/loop` era lido como outro arquivo. Reproduzido com `claude -p`: "MCP config file
     not found: C:\DGBrasil\sessao\responda apenas: ok".
   - **A correção:** o atalho agora roda `claude '<loop>' --strict-mcp-config --mcp-config .mcp.json`.
   - **Efeito:** é a causa das duas falhas de 10/11. Sem a correção, a vigia nunca
     funcionaria por atalho em nenhum computador.
2. **Checagem PB-CONECTOR do `validar-frente-b.ps1` deu falso negativo.**
   - O processo `node C:\DGBrasil\executor\dg-executor.mjs mcp` existia desde 20:44:58.
     Rodada à mão depois, a mesma expressão do script o encontra.
   - Causa ainda não identificada. Vale registrar também a lista de processos no
     momento da checagem, para investigar.
3. **A Análise Bancária não envia sem identidade e comprovante.**
   - O guia previa só HISCON e o arquivo malicioso nos casos 2 e 3. O assistente avisa
     que "a análise será criada e enviada depois" (mesmo ponto do MP-06).
   - Nesta rodada, a identidade e o comprovante fictícios foram acrescentados aos dois
     casos.
   - Ajustar a A1 do guia.
4. **Aba Análise do caso com mensagem genérica.**
   - Quando o Porteiro para, a análise mostra "Falhou | A execução anterior não terminou".
   - A tela da execução mostra o certo ("O Porteiro parou o trabalho: um documento parece
     inseguro").
   - Levar o motivo também para a aba Análise.
5. **O Arquivista traz de volta para a pasta do cliente os PDFs que a Clara entregou.**
   - Na execução do Lucas, os documentos do caso incluíam "Roteiro de ações (Clara)" e
     "Análise do teto normativo (Clara)". Eles foram copiados com o nome do título, ao
     lado dos `.html` originais.
   - Não confunde a fila da Clara (o padrão dela é `ROTEIRO_CONSIGNADO_*`), mas duplica
     arquivos na pasta.
   - Avaliar se o Arquivista deve pular documentos que vieram de um agente.
6. **Apontado pela própria Clara:** o `ler_roteiro.py` não lê o HTML gerado pelo
   `gerar_roteiro_consignado.py` (código 3). Fica no repositório dos agentes do
   escritório, não no DG Brasil.
7. **Dados fictícios:**
   - O CPF 999.000.000-01 dos PDFs tem dígito verificador inválido. O cadastro usou
     999.000.000-05.
   - O guia pede cliente "sem e-mail", mas o cadastro exige um. Foi usado um `@example.com`.
   - O Lucas e a Clara notaram a diferença de nome ("DG Teste -" no cadastro e não nos
     PDFs) e pediram conferência. Esse é o comportamento esperado.
8. **Porteiro na carta maliciosa:** o motivo descreve o que o texto pedia, sem copiar o
   texto. Atende à regra do guia.

## Regras de `allow` que faltaram

Nenhuma. A vigia processou os quatro trabalhos sem parar em pedido de permissão (PB-14).

## Pode ligar na produção?

**Ainda não**, por três motivos:

1. **Drive pelo site:** falta testar a pasta ligada pelo site (PA-16 a PA-18, depois da
   credencial). Esta validação usou `-PastaPeloNome`.
2. **PB-13:** a Barbara confirma no ChatJurídico.
3. **Atalho corrigido nos outros computadores:** reinstalar o conector (`irm .../instalar.ps1 | iex`) em
   todo computador que já tem o atalho antigo.

Os achados 3, 4 e 5 não impedem a ligação.

## Limpeza (Barbara)

- Desligar o interruptor geral, se a execução não for continuar.
- Apagar pelo Drive a pasta `7. KIT DO CLIENTE\DG TESTE - JOSE DA SILVA FICTICIO`.
- Decidir se arquiva o cliente, os casos e os dois agentes "(ponte)", ou se os mantém para
  a segunda rodada (Murilo, com autos fictícios).
