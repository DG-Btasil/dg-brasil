# Problemas encontrados na Etapa 8

Lista de tudo o que a validação da Etapa 8 encontrou (2026-11-04, commit validado `21c0d70`, Supabase DEV).
O relatório completo, com as evidências de cada parte, está em [qa-etapa-8.md](qa-etapa-8.md).

Nenhum problema bloqueia a etapa: o DJEN real funcionou pelo servidor, sem bloqueio de IP, e nenhum dado de processo real foi guardado.

## Resumo

| ID | Problema | Gravidade | Situação |
|---|---|---|---|
| JUD-04 | DataJud esgota o tempo | Atrapalha | **Aberto** (depende do CNJ) |
| JUD-06 | Rodada do DataJud fica presa como `RUNNING` | Atrapalha | **Aberto** |
| JUD-05 | Texto do portal contradiz a regra da etapa | Cosmético | **Aberto** |
| JUD-02 | Contagem da Parte 1 do guia inclui processos excluídos | Cosmético | **Aberto** (texto do guia) |
| JUD-01 | Teste de integração lia tabela fechada com o `service_role` | Atrapalha | Corrigido |
| JUD-03 | `drive-sync` não aparecia nos Cron Jobs da Vercel | Atrapalha | Resolvido, causa não apurada |

## Abertos

### JUD-04: DataJud esgota o tempo

- **Onde:** Parte 5.1 ("Buscar agora", 2ª vez) e 5.3 ("Buscar andamentos agora").
- **Esperado:** "Busca concluída" e o aviso "Processo ainda não aparece no DataJud…".
- **O que aconteceu:** `DataJud não respondeu (tempo esgotado)`, com "Busca concluída com falhas". A rodada levou 77 s (o guia fala em ~60 s).
- **O que já se sabe:** fora da Vercel, o índice TJSP também não respondeu em 40 s, e o TJRJ devolveu `429`. Isso aponta para instabilidade ou limite do CNJ, não para bloqueio do nosso servidor.
- **O que funcionou:** a falha ficou registrada, a rodada saiu como "com falhas" e o DJEN não foi afetado.
- **Impacto:** cada chamada travada consome 35 s da rodada, e os andamentos não chegam enquanto durar. As intimações vêm do DJEN e não dependem dele.
- **Falta:** repetir "Buscar andamentos agora" com o DataJud respondendo, para ver o aviso esperado.

### JUD-06: rodada do DataJud fica presa como `RUNNING`

- **Onde:** Parte 6, nas primeiras rodadas do agendador.
- **Esperado:** rodadas terminando dentro dos 60 s da rota, com `200`.
- **O que aconteceu:** a rodada `CRON`/`DATAJUD` de 00:38:54 UTC levou 57 s e terminou `PARTIAL`. A de 00:40:00 deu `Timeout of 60000 ms reached` no `pg_net` e seguia `RUNNING` quase 6 minutos depois.
- **Causa provável:** com o DataJud lento (JUD-04), a rodada passa do limite de 60 s da Vercel e é encerrada antes de gravar o fim. O prazo interno de 50 s nem sempre segurou. A causa exata não foi apurada.
- **Impacto:** a chamada das 00:45 voltou `200` sem abrir rodada nova, o que é compatível com a trava de rodada em andamento. Pelo código de `judicial_sync_begin`, a trava barra só os lotes do DataJud, as buscas do DJEN seguem e, depois de 15 min, a rodada vira `FAILED`. Esse encerramento não foi observado.
- **Falta:** confirmar que a rodada vira `FAILED` e descobrir por que o prazo interno de 50 s não segurou.

### JUD-05: texto do portal contradiz a regra da etapa

- **Onde:** Parte 5.4, Minha Conta → OABs acompanhadas ([partner-oabs-panel.tsx](../../../apps/frontend/src/features/judicial/components/partner-oabs-panel.tsx), linha 52).
- **Texto atual:** "Publicação de processo que não está no DG Brasil não é importada: aparece só o número."
- **Regra da etapa:** de processo não cadastrado, só a contagem, nem o número. Nenhum número apareceu na tela; o erro é só do texto.
- **Correção:** ajustar a frase.

### JUD-02: contagem da Parte 1 do guia inclui processos excluídos

- **Onde:** Parte 1 de [etapa-8-validacao.md](../../etapa-8-validacao.md).
- **Esperado pelo guia:** `process_external_refs` com `provider = 'DATAJUD'` igual aos processos não excluídos com CNJ.
- **O que aconteceu:** 232 refs × 202 processos. Numa medição posterior, separando: 217 refs de processos ativos (217 processos) e 32 de excluídos.
- **Causa:** o processo excluído mantém a ref. Todo processo ativo com CNJ tem a sua, e a fila do DataJud ignora excluídos, então não há consulta a mais.
- **Correção:** a consulta do guia deve contar só as refs de processos não excluídos.

## Resolvidos

### JUD-01: teste de integração lia tabela fechada com o `service_role`

- **Onde:** Parte 3, `judicial.int.test.ts`. A 1ª rodada deu 241/243.
- **O que aconteceu:** `42501 permission denied for table judicial_publications`. A segunda falha foi consequência da primeira.
- **Causa:** erro do teste. A migration 043 fecha essas tabelas para o `service_role` de propósito.
- **Correção:** o teste passou a conferir como postgres, com `SUPABASE_DB_URL`, como o `validar:real`. Sem mudança em migration nem em código de produção. Depois disso, 243/243.

### JUD-03: `drive-sync` não aparecia nos Cron Jobs da Vercel

- **Onde:** Parte 4.
- **O que aconteceu:** na primeira olhada no painel, só aparecia `judicial-sync`. Depois, o Miguel informou que o item funcionou.
- **Conferido:** `apps/frontend/vercel.json` lista as duas rotas, e as duas respondem `401` sem a senha.
- **Situação:** resolvido, mas a causa da primeira leitura não foi apurada.

## Pendências da validação

Não são problemas, mas ainda não foram feitas:

- **Parte 6:** conferir em 2026-11-05, depois das 05:00, as rodadas agendadas e as OABs RJ e SP com a busca do dia.
- **Parte 7:** conferência com o APOGEU, adiada ([producao.md](../../deploy/producao.md), item 11).
