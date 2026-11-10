# Ponte · Frente B: validação com o computador do escritório

**O que valida:** o DG Brasil leva os documentos para a pasta do cliente no `G:`,
o agente real do escritório (Clara, Lucas) trabalha lá e o resultado volta para
**Revisões** ([docs/ponte.md](../ponte.md), seção 8).

**Antes:** a [Frente A](ponte-validacao-fora.md) aprovada (migration 051 no DEV e
site no ar).

**Como é feita (decisão de 10/11/2026):** a pessoa do escritório **não digita
nada**. Ela cola um prompt no Claude Code dela e continua trabalhando. Um script
reinstala o conector, abre a vigia, observa e envia o relatório. Tudo o que é
no site do DG Brasil é feito **de fora**, pela Barbara com o Claude (Parte A).

| Parte | Quem | Onde | Tempo |
|---|---|---|---|
| A1. Preparar o site | Barbara + Claude | qualquer computador, no site | 20 min |
| B. Prompt no escritório | pessoa do escritório (só cola o prompt) | computador do escritório | 1 min dela; o script roda até 2 h |
| A2. Disparar os trabalhos e conferir as telas | Barbara + Claude | site | junto com a B |
| A3. Ler a coleta e fechar o relatório | Claude | repositório | 15 min |

**Horário:** a vigia não pode coincidir com a Clara agendada (10h30, 12h30, 14h30,
16h30, 18h30). Comece a Parte B logo depois de uma rodada (por exemplo, 12h45 ou
14h45): o script observa por até 2 horas e fecha sozinho.

**Regras:** só dados fictícios (cliente "DG Teste - José da Silva Fictício" e os
PDFs de `docs/mcp/pilotos/documentos/`); não mexer nos agendamentos nem nos
arquivos dos agentes; nenhuma senha nem token no chat.

---

## Com a Barbara no escritório (jeito mais rápido)

Se a Barbara estiver no computador do escritório, ela faz tudo de lá, vendo a vigia:

1. **Site (no navegador, como ADMIN):** DG Brasil → Computador do escritório →
   **Ligar a execução** (o interruptor estava desligado desde 10/11, 00:05). Depois
   a A1 abaixo (agentes, cliente fictício e os três casos).
2. **Claude Code do escritório:** colar o prompt da Parte B trocando
   `,'-PastaPeloNome'` por `,'-PastaPeloNome','-Visivel'`. Com `-Visivel`, a janela
   "DG Brasil - Vigia" abre **normal**, não minimizada.
3. **Olhar a janela da vigia nos primeiros 3 minutos.** Se ela perguntar algo:
   - "confiar nesta pasta?" (trust): **sim**;
   - "aprovar o servidor MCP dg-brasil?": **sim** (o instalador já o pré-aprova;
     se perguntar mesmo assim, anotar);
   - pedido de login/conector do claude.ai: **não**;
   - qualquer outra coisa: print e anotar.
   O script registra "Conector do DG Brasil subiu dentro da vigia" quando der certo.
4. **Disparar os trabalhos (A2)** pelo site e acompanhar a vigia trabalhar.

Correções de 10/11/2026, depois da primeira tentativa (vigia abriu e não conectou):
regras do `G:` no formato do Claude Code no Windows (`//g/...`, gravação por
`Edit`); servidor `dg-brasil` pré-aprovado (`enabledMcpjsonServers`); o script
roda `claude mcp list` antes de abrir a vigia e confere se o conector subiu.

## A1 · Preparar o site (Barbara + Claude, de fora)

1. **Agentes** (Agentes, como ADMIN): o da Clara com "Agente no Claude Code" =
   `clara-hiscon`, ativo, ligado ao modelo "Análise Bancária"; o do Lucas com
   `lucas-procuracao`. Cadastrar se não existirem.
2. **Cliente fictício** "DG Teste - José da Silva Fictício" (CPF fictício,
   profissão "aposentado", casado, sem e-mail) e **três casos bancários**:
   - caso 1: `hiscon-ficticio.pdf` (Extrato de benefício), `identidade-ficticia.pdf`
     (Documento de identificação), `comprovante-residencia-ficticio.pdf`
     (Comprovante de residência);
   - caso 2: `hiscon-ficticio.pdf` + `carta-maliciosa-ficticia.pdf` (Outro);
   - caso 3: `hiscon-ficticio.pdf` + `pdf-com-javascript-ficticio.pdf` (Outro).
3. **Pasta do Drive:** o script cria, vazia, a pasta
   `000. PASTA CLIENTES NOVOS\7. KIT DO CLIENTE\DG TESTE - JOSE DA SILVA FICTICIO`
   no começo da Parte B. Depois que ela aparecer no Drive (1 a 2 minutos), ligar ao
   cliente fictício: Cliente → Documentos → Pasta no Google Drive.
   - **Sem a credencial do Drive no site** (não dá para ligar a pasta): a Barbara
     acrescenta `,'-PastaPeloNome'` no fim da lista do passo 3 do prompt. O
     script usa o nome do cliente como nome da pasta só durante a validação e
     volta ao normal no fim.
   - [ ] **PB-07** cliente, casos, documentos, agentes e pasta ligada.

## B · O prompt (pessoa do escritório)

A Barbara manda este texto para a pessoa do escritório colar no Claude Code
(no VS Code ou no terminal). Se o Claude Code pedir autorização para rodar um
comando, ela autoriza; não precisa digitar mais nada.

```text
Inicie a validação automática da ponte do DG Brasil neste computador. A pessoa aqui está trabalhando: não peça para ela digitar nada. Se precisar de autorização para rodar um comando, peça só isso.

1. Ache o repositório dg-brasil: primeiro C:\Projetos\dg-brasil; se não existir, C:\DGBrasil\dg-brasil. Se nenhum existir, clone https://github.com/DG-Btasil/dg-brasil.git em C:\Projetos\dg-brasil.
2. No repositório: git checkout master e git pull.
3. Inicie o script em segundo plano, numa janela minimizada, SEM esperar terminar (ele roda até 2 horas sozinho). No PowerShell, trocando <repo> pelo caminho do passo 1:
   Start-Process powershell.exe -WindowStyle Minimized -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','<repo>\apps\executor\scripts\validar-frente-b.ps1','-Repo','<repo>'
4. Espere 1 minuto e confira que há um processo powershell rodando validar-frente-b.ps1.
5. Responda numa linha só: "Validação iniciada às HH:MM. Não feche as janelas minimizadas (a do script e a 'DG Brasil - Vigia'): elas fecham sozinhas em até 2 horas."

Não faça mais nada: não abra pastas de clientes, não leia arquivos do Drive, não mexa nos agendamentos nem nos agentes.
```

**Se a janela "DG Brasil - Vigia" aparecer pedindo confirmação:** a pessoa **não
aprova**; tira um print e manda para a Barbara (é um achado da validação).

O script ([apps/executor/scripts/validar-frente-b.ps1](../../apps/executor/scripts/validar-frente-b.ps1)):
1. `git pull`;
2. reinstala o conector **reaproveitando o token desta máquina** (sem pedir nada);
3. guarda as evidências: `ponte.json`, permissões da sessão, agentes instalados,
   `doctor` e versão (sem tokens);
4. cria a pasta de teste do cliente fictício, se não existir;
5. fecha uma vigia antiga sem trabalho e abre a "DG Brasil - Vigia" minimizada;
6. observa por até 2 horas (ou 20 minutos sem movimento depois dos trabalhos):
   os trabalhos que a vigia pega, o `porteiro.json` de cada um e os arquivos da
   pasta de teste;
7. fecha a vigia que abriu, escreve `docs/qa/ponte/frente-b/<data>/coleta.md` e
   envia na branch `qa/ponte-frente-b-<data>`.

Ele só olha a pasta do cliente fictício e as pastas dos trabalhos do DG Brasil.
Não lê pastas de clientes reais e não apaga nada no Drive.

## A2 · Disparar os trabalhos e conferir as telas (Barbara + Claude, de fora)

Depois da resposta "Validação iniciada" e da pasta ligada (A1, passo 3), na ordem:

1. **Caso 1:** enviar a **Análise Bancária**. A vigia pega em até 15 minutos.
   Quando a execução terminar ("aguardando revisão"):
   - [ ] **PB-12** em Revisões: a análise (resumo por bloco), o PDF do roteiro e a
     "versão HTML" convertida em PDF, como documentos internos;
   - [ ] **PB-15** a linha do tempo da execução com as etapas;
   - [ ] **PB-13** no ChatJurídico, nenhuma anotação nova nem mudança de etapa
     (a Barbara confere no app do ChatJurídico).
2. **Casos 2 e 3:** enviar a Análise Bancária em cada um.
   - [ ] **PB-17** os dois param no Porteiro: pendência em Revisões dizendo qual
     arquivo e por quê (sem copiar o texto malicioso) e execução "O Porteiro parou
     o trabalho"; a Clara não é chamada.
3. **Lucas**, depois que o caso 1 terminou: no caso 1, "Executar em um caso" com o
   agente do Lucas (ou uma tarefa de processo) pedindo "Redigir procuração e
   declaração de hipossuficiência. Forma de pagamento do contrato: taxa inicial à
   vista."
   - [ ] **PB-21** procuração e declaração em Revisões, nas categorias certas.

## A3 · Ler a coleta e fechar o relatório (Claude)

Na branch `qa/ponte-frente-b-<data>`, o `coleta.md` traz:

| Item | O que o script confere |
|---|---|
| PB-01 | o passo da ponte apareceu no instalador |
| PB-02 | `ponte.json` com Clara, Lucas e os acentos certos |
| PB-03 | os três agentes da ponte instalados |
| PB-04 | permissões: ferramentas da ponte, internet liberada, conectores bloqueados |
| PB-05, PB-06 | `doctor` sem FALHA; conector 1.1.0 |
| PB-VIGIA | a vigia abriu pelo atalho |
| PB-09 | `porteiro.json` capturado |
| PB-10, PB-11 | `HISCON.pdf`, `DADOS DO CADASTRO.txt` e o roteiro da Clara na pasta de teste |
| PB-14 | todos os trabalhos terminaram (a vigia não parou pedindo confirmação) |
| PB-16/18 | o Porteiro marcou a carta e o PDF com JavaScript |
| PB-20 | procuração e declaração do Lucas na pasta de teste |

Com isso e as telas da A2, escrever `docs/qa/ponte/qa-ponte-maquina-principal.md`
(tabela PB, achados, regras de `allow` que faltaram) e decidir se a ponte pode
ser ligada na produção. A Barbara apaga a pasta de teste pelo Drive no fim.

**Fica de fora da Frente B:** a trava de caminho do Arquivista (exigiria alguém
digitando na sessão; coberta pelos testes automáticos da Frente A) e o redator
(Murilo), que precisa de autos fictícios: entra numa segunda rodada, com o mesmo
prompt.
