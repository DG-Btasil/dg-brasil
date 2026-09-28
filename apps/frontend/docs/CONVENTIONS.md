# Convenções do front-end — DG Brasil

Regras curtas para manter o código consistente entre pessoas (e agentes) diferentes.
A visão de arquitetura completa está em [FRONTEND_ARCHITECTURE.md](FRONTEND_ARCHITECTURE.md).

## Camadas

| Onde | O quê | Pode importar o store? |
|---|---|---|
| `src/app/**` | Rotas. Arquivos finos: só compõem componentes de `features/`. | Não |
| `src/features/<x>/components` | UI da feature. | **Não** — usa hooks |
| `src/features/<x>/hooks.ts` | Leitura reativa (selectors do store) e ações. | Sim |
| `src/repositories` | Contratos assíncronos + implementação mock. Escritas passam por aqui. | Só `mock/` |
| `src/store` | Estado do protótipo (Zustand + localStorage). | — |
| `src/components/ui` | Primitives visuais sem regra de negócio. | Não |
| `src/lib` | Status, permissões, formatação, validação, domínio puro. | Não |

- **Escrita:** componentes chamam `repositories.<x>.<método>()` (assíncrono), normalmente via um hook de ações da feature.
- **Leitura:** hooks da feature selecionam arrays do estado **recortado** (`useScopedStore` de `@/store/scope`) e derivam com `useMemo`.
  Nunca leia dados com `useAppStore` em hooks de feature — isso ignoraria o escopo do parceiro. `useAppStore` é só para sessão, preferências e ações.
  Nunca retorne um array novo direto do selector (`useAppStore(s => s.clients.filter(...))`) — isso quebra o Zustand v5 (loop de render).

## Regras de negócio que não se quebram

1. **RBAC:** nunca compare papel (`role === "ADMIN"`). Use `usePermission("finance.view")`, `<Can>`, `<RequirePermission>`.
   Conteúdo sem permissão **não é renderizado** — nada de esconder com CSS.
2. **Status:** nunca escreva string de status solta nem rótulo em português no componente. Use `lib/constants/status.ts`
   (`*_LABEL`, `*_TONE`) e `<StatusBadge>`.
3. **Valor da causa ≠ honorários.** `caseValue` é jurídico (advogado vê). Honorários, pagamentos e contratos só com `finance.view`.
4. **IA executa, humano decide.** Nenhuma ação de agente vira efeito externo sem passar por Revisões ou confirmação explícita.
   Nunca exibir "raciocínio" do modelo — só resumo, evidências e ações propostas.
5. **Nada de conteúdo jurídico inventado.** Textos jurídicos de exemplo levam `<DemoContentNotice />` ou `DEMO_LEGAL_DISCLAIMER`.
6. **Botão sem função não existe.** Se não está implementado: `<NotAvailable>` (desabilitado + "Disponível em uma próxima etapa").
7. **Prioridade nunca só por cor:** sempre ícone e/ou texto junto (`Badge` com texto, `DeadlineBadge`).
8. **Parceiro vê só a própria relação.** Visibilidade de parceiro se decide em `lib/permissions/partner-scope.ts`, nunca no componente.
   Portal do parceiro não usa vocabulário interno ("agente", "Skill", "tenant", "workflow de IA").
9. **Duas origens, nunca misturar:** `origin` (técnica: Manual/Integração/DG Brasil) ≠ `relationshipOrigin` (caso próprio ou de parceiro).

## Next.js 16

- `params` é `Promise`. Página dinâmica:
  ```tsx
  export default async function Page({ params }: PageProps<"/clientes/[id]">) {
    const { id } = await params;
    return <ClientDetail id={id} />;
  }
  ```
  `PageProps`/`LayoutProps` são gerados por `npx next typegen` (rodado pelo `npm run typecheck`).
- Componente que usa `useSearchParams` (ex.: `useUrlTab`) precisa estar dentro de `<Suspense>`.
- Lint: `npm run lint` (ESLint direto; `next lint` não existe mais). O React Compiler lint é rígido:
  sem `setState` síncrono dentro de `useEffect`, sem `Date.now()`/`Math.random()` em render (use `lib/clock`).

## Visual

- Tokens em `src/app/globals.css`. Use classes de token (`bg-navy`, `text-muted`, `border-line`, `bg-gold`), nunca hex.
- Serifada (`font-serif`) só em títulos institucionais. Todo o resto em sans.
- Sem sidebar. Sem gradientes, glassmorphism, emojis, robôs ou balanças decorativas.
- Densidade de software de trabalho: tabelas boas, linhas finas, poucos cards.
- Primitives disponíveis: `Button`, `ButtonLink`, `IconButton`, `Badge`, `StatusBadge`, `Panel*`, `DefinitionGrid`,
  `Field`, `Input`, `MaskedInput`, `Select`, `Textarea`, `Checkbox`, `ChoiceCards`, `FormSection`, `SearchInput`,
  `Dialog`, `Drawer`, `Tooltip`, `NotAvailable`, `Tabs`/`TabPanel`, `Table`/`SortableTh`/`sortBy`, `PageHeader`,
  `Breadcrumbs`, `Stat`, `Avatar`, `DeadlineBadge`, `Timeline`, `Steps`, `DemoContentNotice`,
  `EmptyState`, `Skeleton`, `SkeletonRows`, `ErrorState`, `Callout`, `useToast()`.

## Commits

Mensagens em português, no imperativo, curtas ("Adiciona filtro por origem na lista de processos").
