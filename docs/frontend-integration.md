# Etapa 4.3 — Front V1 ligado ao backend real

Substituição **progressiva** dos mocks pelo backend da 4.2/4.2.1, domínio por
domínio. O Front V1 (layout, navegação, identidade) não é redesenhado; só
muda o que o comportamento real exige: carregando, vazio, erro, paginação e
retorno das operações.

## Estado por domínio

| Fase | Domínio | Estado | Observação |
|---|---|---|---|
| A | Diretório (usuário/escritório) | ✅ real | `server/directory.ts`: integrantes ativos, escritório proprietário, parceiros visíveis |
| A | Clientes (equipe interna) | ✅ real | lista, busca, filtros, detalhe, cadastro, edição, inativar/reativar/excluir |
| A | Clientes no Portal do Parceiro | ⏳ Fase D | o portal ainda lê o mock |
| B | Casos, Processos, Prazos, Movimentações | ⏳ | |
| C | Documentos, Pendências documentais | ⏳ | |
| D | Solicitações, Portal do Parceiro | ⏳ | |
| E | Revisões, Análises | ⏳ | Análise só depois de tornar atômico o início (análise + execução) |
| F | Financeiro | ⏳ | mutações só depois de revisar o ciclo de vida do acordo financeiro |
| G | Execuções de agente / Agentes | ⏳ | paginar o read model antes |
| H | Notificações, Auditoria, Home/painéis | ⏳ | painéis por último |

## Padrão de integração (vale para todos os domínios)

**Leitura — server-first.** A página (Server Component) chama a Server Action
de leitura do domínio — a mesma porta do navegador: sessão, permissão, Zod,
RLS — e entrega o DTO pronto ao componente. Rota direta, nova aba e recarregar
funcionam sem estado prévio no navegador. ID inexistente, malformado ou de
outro escritório → "não encontrado" (nunca revela existência).

**Listas.** `useServerList` (`lib/hooks/use-server-list.ts`) + `Pagination`
(`components/ui/pagination.tsx`) — padrão único:

- primeira página vem do servidor; mudança de filtro/página/ordem chama a
  action de listagem (nada de baixar tudo e filtrar no navegador);
- busca com atraso (300 ms); resposta antiga nunca sobrescreve a nova;
- filtros, ordem e página ficam na URL (`history.replaceState`);
- **CPF/CNPJ nunca vai para a URL**: busca com dígitos fica só na tela.

**Escritas.** Componente → Server Action → service → repository. A tela só
muda depois da resposta do banco (sem atualização otimista nas operações
críticas); em seguida, navega para o recurso devolvido pelo servidor ou
recarrega os dados (`router.refresh()`).

- Botão desabilitado durante o envio + guarda contra o segundo clique.
- Erros de campo do Zod do servidor viram mensagens nos campos
  (`mapFieldErrors`); demais erros viram aviso com a mensagem segura e o
  **código de referência** (8 primeiros caracteres do `requestId`, que liga a
  tela ao log do servidor).
- Falha de rede vira erro recuperável (`callAction`), nunca tela quebrada;
  exceção inesperada cai no `app/(app)/error.tsx` (menu continua, "Tentar
  novamente").
- Nenhum ID de domínio é gerado no navegador (exceção futura:
  `idempotencyKey`, uma por intenção de envio).

**Diretório.** `loadOrgDirectory()` roda no layout autenticado e alimenta
`OrgDirectoryProvider`: nomes de responsáveis, opções de responsável e de
origem. Equipe interna sem `partners.view` (ASSISTANT) vê só o escritório
proprietário como origem.

**Sem fallback para mock.** Erro do backend aparece como erro. Domínio
migrado não tem mais escrita no mock.

## Fase A — Clientes

- Lista: busca por nome/razão social ou CPF/CNPJ (prefixo), tipo, situação
  (ativos/inativos/todos), responsável, origem (com `partners.view`); ordem
  por nome, cadastro, atualização; 25 por página.
- Colunas que dependiam de outros domínios ainda em mock (análise, processos
  ativos, progresso documental) e seus filtros **saíram da lista**: o
  backend de clientes não os fornece e não pode haver duas fontes. Voltam
  com os domínios correspondentes, se fizer sentido, via read model.
- Detalhe: `getClientAction` (registro LGPD de acesso no banco). As abas de
  Documentos, Casos, Processos e Atividade ainda leem os módulos de
  demonstração (fases C, B e H) — para clientes reais, ficam vazias até lá.
- Edição: PATCH só com o que a tela edita; CPF/CNPJ só vai quando muda (só
  ADMIN corrige — a tela avisa no campo, o servidor recusa de todo modo).
  Data de nascimento, gênero, estado civil e documento de identidade não são
  apagáveis pela edição (o schema do servidor não aceita nulo nesses campos).
- **Lacuna real encontrada:** representantes e sócios de PJ só são gravados no
  cadastro (`save_client`, comentário "edição tem tela própria depois"; sem
  política de DELETE). A edição mostra a lista só para leitura. Resolver
  exige migration nova (028) com função atômica de substituição — decisão
  pendente.
- Mock: removidas as escritas de cliente do store, do contrato e do
  repositório mock. Os clientes do seed continuam porque Casos, Processos,
  Financeiro e o Portal (ainda mock) os referenciam; saem quando esses
  domínios migrarem.

## Testes

- Unitários: `src/features/clients/clients-ui.test.ts` (URL ↔ filtros, CPF
  fora da URL, formulário → schema real do servidor, PATCH, erros de campo,
  falha de rede).
- Integração (Supabase DEV): `tests/integration/frontend-clients.int.test.ts`
  (formulário → service real, PATCH que apaga, LAWYER sem correção de CPF,
  URL da lista → listagem, diretório por papel).

## QA manual — Fase A (Supabase DEV, dados fictícios)

Marque cada item com os cinco papéis indicados.

**ADMIN / LAWYER / ASSISTANT**

- [ ] `/clientes` abre sem flash de dados de demonstração; banco vazio mostra
      "Nenhum cliente cadastrado."
- [ ] Busca por nome responde após parar de digitar; busca por parte do CPF
      encontra; a URL **não** mostra os dígitos.
- [ ] Filtros (tipo, situação, responsável, origem) e ordenação refazem a
      consulta; recarregar a página mantém filtros e página.
- [ ] Paginação com mais de 25 clientes.
- [ ] Cadastrar PF e PJ: botão fica em "carregando", duplo clique não cria
      dois; ao terminar, abre a ficha do cliente criado.
- [ ] CPF já cadastrado: mensagem no campo CPF ("Cliente já cadastrado no
      sistema.").
- [ ] Editar: salvar volta para a ficha com os dados novos; apagar o nome
      social apaga de fato.
- [ ] LAWYER/ASSISTANT alterando o CPF: aviso no campo, nada é salvo.
      ADMIN: corrige.
- [ ] Inativar/reativar: a ficha muda depois da resposta; lista "Inativos"
      mostra o cliente.
- [ ] ADMIN exclui: volta para a lista; o cliente sumiu. LAWYER/ASSISTANT não
      veem "Ações perigosas".
- [ ] ASSISTANT: "Origem" só oferece o escritório proprietário.
- [ ] Abrir `/clientes/<uuid inexistente>` e `/clientes/abc` → "Cliente não
      encontrado."
- [ ] Ficha em nova aba e após recarregar funciona.
- [ ] Desligar a rede e mudar um filtro → erro com "Tentar novamente"; religar
      e tentar → volta.

**PARTNER_ADMIN / PARTNER_USER**

- [ ] `/clientes` continua mostrando o portal (ainda em demonstração até a
      Fase D); `/clientes/<id de cliente interno>` não mostra dados internos.
- [ ] `/clientes/<id>/editar` → acesso negado.
