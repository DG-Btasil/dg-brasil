---
name: kit-documentos-teste
description: Gera a procuração FICTÍCIA de teste em PDF (uma página) a partir dos dados do cliente, com o script scripts/gerar_procuracao.py. Use quando precisar produzir a procuração do kit do cliente no teste da Etapa 5.
---

# Kit de documentos (teste)

Skill de TESTE da Etapa 5. Gera uma procuração fictícia em PDF, sem Word: usa
`reportlab`, que já existe no ambiente isolado.

## Como usar

1. Monte um JSON com os dados do cliente (só o que está no caso):

```json
{"nome": "JOSÉ DA SILVA FICTÍCIO", "cpf": "999.000.000-01", "cidade": "Petrópolis/RJ", "data": "17/10/2026"}
```

2. Rode, a partir da pasta desta skill:

```bash
python scripts/gerar_procuracao.py dados.json "$OUTPUT_DIR/Procuracao_TESTE.pdf"
```

3. Confira a saída do script ("PDF gerado: ...") e entregue o arquivo com
   `entregar_documento` usando o nome `Procuracao_TESTE.pdf`.

O texto da procuração é fixo no script e marcado como FICTÍCIO. Código de
saída 2 = falta campo obrigatório (nome, cpf ou cidade): não invente, peça o
dado com uma proposta.
