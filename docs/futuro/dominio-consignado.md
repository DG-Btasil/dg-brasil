# Domínio consignado — atualização futura (fora do MVP)

Decidido em 2026-11-05: **não entra no MVP.** Hoje a análise do HISCON é feita
pela Clara com a skill `roteiro-peticao-consignado` (repositório
`Agents_for_DG_Brasil`), e isso atende. Este arquivo guarda o desenho para quando
a etapa for retomada.

## Como funciona hoje

- As regras dos blocos estão em texto, em
  `Agents_for_DG_Brasil/skills/juridico-consignado-inss/roteiro-peticao-consignado/references/regras-blocos.md`.
- **Quem classifica é o modelo**, lendo essas regras. O script
  `Agents_for_DG_Brasil/scripts/gerar_roteiro_consignado.py` só monta o PDF e o
  HTML ("não classifica e não calcula").
- O DG Brasil guarda o HISCON apenas como documento (tipo `BENEFIT_STATEMENT`).

## Regras atuais, em ordem (um contrato, um bloco)

1. **Caixa:** todo contrato da Caixa nos últimos 10 anos, qualquer situação. Uma ação por ano de inclusão.
2. **E (Tese 1000 Contra):** número terminado em `_0001`/`_0002`/`_0003`. Mesma raiz e mesmo banco = 1 ação; a raiz só como referência.
3. **A (Migrados):** só com migração explícita em "Origem da Averbação". 1 ação por contrato; o contrato de origem é ignorado.
4. **B (2021–2022):** inclusão em 2021 ou 2022, situação diferente de ativo. 1 ação por banco e por ano.
5. **C (2023–2025):** excluído ou encerrado, com par do mesmo banco incluído em até 7 dias. 1 ação por banco e por ano.
6. **D (Cartões):** à parte. Cada RMC/RCC ativo = 1 ação. RMC com "Utilizado no Mês" ≥ limite em 10, 11 ou 12/2023 → sugerir tese de refinanciamento.

## Desenho proposto

| Parte | Quem faz |
|---|---|
| Ler o PDF (contratos, cartões, benefício) | Clara, devolvendo dados estruturados; conferência humana em Revisões |
| Classificar nos blocos | Código puro em `packages/dominio`, com testes; guarda o motivo de cada contrato (inclusive descartados) e a versão das regras |
| Aprovar as ações | Advogado; cada ação aprovada vira caso, com os contratos ligados |
| Teses, pedidos, petição | Clara e as skills de petição, como hoje |

- **Banco:** benefício do cliente; extrato (ligado ao documento); contratos e cartões do extrato; classificação. Migrations a partir da próxima livre.
- **Ganhos:** aviso automático de contrato que já está em outro processo (litispendência); comparação entre HISCONs do mesmo cliente; números por bloco e banco na carteira.
- **Validação:** rodar o motor em paralelo com roteiros já feitos pela Clara e examinar cada diferença, como na conferência em dupla dos prazos.

## Pontos em aberto (a responder antes do código)

1. Bloco C: o par de 7 dias também precisa ser excluído/encerrado de 2023–2025, ou qualquer contrato do mesmo banco serve?
2. Par que cruza o ano (29/12/2023 e 03/01/2024): os dois entram, em ações separadas?
3. Contrato "suspenso": conta como não ativo no B? Entra no C?
4. Contratos de 2020 e de 2026 ficam fora de propósito?
5. Tese 1000 Contra: sufixo `_0004` ou maior conta? A raiz precisa estar excluída?
6. Janela de 10 anos: a partir da data mais recente do extrato ou de hoje?
7. O motor antigo (`esteira-consignado/src/dominio`, 41 testes) não está nesta máquina: localizar ou descartar.
