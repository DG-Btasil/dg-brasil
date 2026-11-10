# Ponte com os agentes da máquina: validação

A validação da ponte ([docs/ponte.md](../ponte.md)) tem duas frentes:

| Frente | Onde | Guia | Relatório |
|---|---|---|---|
| **A · Fora da máquina principal** | qualquer computador com o repositório; o `db push` na máquina do Supabase DEV; o Drive pelo site | [ponte-validacao-fora.md](ponte-validacao-fora.md) | `docs/qa/ponte/qa-ponte-fora.md` |
| **B · Na máquina principal** | DESKTOP-9AB21K5 (usuário Micro), com os agentes reais e o `G:` | [ponte-validacao-maquina-principal.md](ponte-validacao-maquina-principal.md) | `docs/qa/ponte/qa-ponte-maquina-principal.md` |

A Frente B só começa depois da Frente A, porque precisa da migration 051 no DEV e
do site no ar com a rota `/bridge`.
