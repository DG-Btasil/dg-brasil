# Roadmap — da ADVBOX ao DG Brasil

Seis fases. Cada uma entrega algo que a equipe usa de verdade; nenhuma depende
de a seguinte existir. A ADVBOX só é desligada na fase 6, por decisão sua, com
data marcada.

---

### Fase 0 — Fundação ✅ *(feito nesta sessão)*

- Repositório, arquitetura e schema do banco (`db/001` a `db/004`).
- Motor de agentes: fila, executor com Claude Agent SDK, ferramentas, aplicador.

**Falta você fazer:** criar o projeto no Supabase (região São Paulo), rodar os
quatro arquivos SQL em ordem e preencher o `.env`.

---

### Fase 1 — Espelho e painel de leitura

Importar da ADVBOX contatos, processos, prazos e movimentações para o DG Brasil,
e mostrar isso num painel. Nada é escrito de volta na ADVBOX.

- Script de importação usando o conector ADVBOX que você já tem (as colunas
  `advbox_id` no schema existem para isso: reimportar não duplica).
- Sincronização diária, para o espelho não envelhecer.
- Painel Next.js: busca de contato, ficha do cliente, lista de casos, agenda de
  prazos, login por papel.

**Você ganha:** uma segunda fonte para conferir prazo, e a equipe já começa a
usar a interface nova sem risco nenhum.

---

### Fase 2 — Primeiro agente na nuvem: Lucas

O agente mais isolado do conjunto — só lê pasta e gera dois documentos. É o
teste de fumaça do motor inteiro.

- Deploy do worker no Fly.io.
- Armazenamento de documentos no Supabase Storage (substituindo o Drive, ou
  sincronizando com ele — decisão sua na hora).
- **Fila de aprovação no painel**: a tela mais importante do sistema.

**Você ganha:** o Lucas roda sozinho às 9h, todo dia útil, sem seu computador
ligado.

---

### Fase 3 — Esteira e peças

- `packages/dominio` recebe o motor de classificação do `esteira-consignado`,
  com os 41 testes.
- Importação do HISCON pelo painel; o agente `esteira` confere e propõe.
- Agente `peca` gera minuta de inicial e réplica, sempre para revisão.

**Você ganha:** o caminho extrato → blocos → minuta, com um humano em cada
curva.

---

### Fase 4 — WhatsApp e triagem

- Ponte com o ChatJuridico (ou direto com a API do WhatsApp).
- Agente `triagem` classifica lead e propõe encaminhamento.
- `aplicar.ts` ganha o aplicador de `enviar_mensagem` — hoje ele falha de
  propósito, para não fingir que enviou.

---

### Fase 5 — Radar e prazos

- Captura DJEN pelo conector de publicações.
- Agente `radar` propõe prazos com contagem em dias úteis.
- **Duplo registro:** por um período, prazo aberto no DG Brasil também é conferido
  contra a ADVBOX. É essa fase que dá segurança para a fase 6.

---

### Fase 6 — Financeiro e desligamento

- Lançamentos, honorários, relatórios.
- Migração final e conferência: contagem de clientes, processos e prazos
  abertos nos dois sistemas, item a item.
- **Você decide a data.** A recomendação é manter a ADVBOX ativa por mais um
  ciclo completo de prazos depois que os números baterem.

---

## Onde o risco realmente mora

Não é no código — é na fase 6. Enquanto os dois sistemas convivem, um prazo
perdido no DG Brasil ainda aparece na ADVBOX. Depois do desligamento, não aparece
em lugar nenhum.

Por isso a fase 5 tem duplo registro e a fase 6 exige conferência item a item
antes da data. Se em algum momento a conferência não bater, a resposta certa é
adiar o desligamento, não explicar a diferença.
