# agentes-claude

O `.claude/` do escritório, versionado. O worker aponta `cwd` para cá e carrega
tudo daqui com `settingSources: ['project']`.

Copie para `.claude/agents/` e `.claude/skills/` os agentes e skills que hoje
rodam na máquina da Barbara — eles funcionam aqui sem alteração:

```
.claude/agents/lucas.md
.claude/skills/replica-consignado-inss/
.claude/skills/roteiro-peticao-consignado/
...
```

Uma diferença importante: na nuvem **não há ninguém para responder a
AskUserQuestion**. Agente que hoje pergunta algo à Barbara no meio do caminho
precisa, aqui, propor uma tarefa com a pergunta e encerrar.
