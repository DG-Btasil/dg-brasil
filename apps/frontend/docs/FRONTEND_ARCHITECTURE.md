# Arquitetura do front-end

Este documento explica como o front-end do DG Brasil está organizado e por quê.
Regras práticas do dia a dia estão em [CONVENTIONS.md](CONVENTIONS.md).

## 1. Domínio

```
BÁRBARA CARDOSO ADVOCACIA — escritório proprietário único (officeId)
 └─ USUÁRIOS INTERNOS (Administrador · Advogado · Assistente)
 └─ ESCRITÓRIOS PARCEIROS (PartnerOffice)
     └─ USUÁRIOS PARCEIROS (Administrador do parceiro · Usuário do parceiro)
     └─ RELACIONAMENTOS com clientes canônicos (ClientOfficeRelationship)
     └─ CASOS ENVIADOS · SOLICITAÇÕES · ACORDOS POR CASO (snapshot da divisão)
 └─ CLIENTES canônicos (PF | PJ, únicos por CPF/CNPJ)
     └─ DOCUMENTOS
     └─ ANÁLISES JURÍDICAS (a partir de um AnalysisTemplate)
         └─ REVISÃO HUMANA ─► aprovação continua o fluxo
     └─ PROCESSOS (origem técnica: AGENT | INTEGRATION | MANUAL | IMPORT;
                    origem do caso: INTERNAL | PARTNER + originPartnerOfficeId)
         └─ MOVIMENTAÇÕES · PRAZOS · REVISÕES · FINANCEIRO (admin)
 └─ DG BRASIL: AGENTES · SKILLS · TESES · HISTÓRICO DE ALTERAÇÕES
```

A IA trabalha nos bastidores. Fora da área **DG Brasil**, o usuário vê um software
jurídico completo, não um "gerenciador de agentes". O ponto de contato explícito com o
trabalho dos agentes é a fila de **Revisões**.

## 2. Features

Cada domínio vive em `src/features/<domínio>/` com `components/`, `hooks.ts` e, quando
necessário, `schemas.ts` (Zod) e `utils.ts`.

| Feature | Rotas | Observação |
|---|---|---|
| `auth` | `/login`, `/criar-escritorio`, `/convite/[token]` | sessão simulada |
| `onboarding` | `/onboarding` | 13 etapas + assistente de implantação; `tour/` = tour do produto |
| `home` | `/home` | adapta KPIs e seções ao papel |
| `clients`, `analyses` | `/clientes/**` | cadastro PF/PJ, documentos, fluxo de análise |
| `processes` | `/processos/**` | lista, cadastro manual, detalhe com abas |
| `reviews` | `/revisoes/**` | fila e decisão (human-in-the-loop) |
| `finance` | `/financeiro/**` | somente Administrador |
| `dg-brasil` | `/dg-brasil/**` | agentes, Skills, teses, histórico, Tutor DG |
| `settings`, `integrations` | `/configuracoes` | seções por permissão |
| `partners` | `/parceiros/**` | área interna de parceiros; hooks de parceria compartilhados com o portal |
| `partner-portal` | `/home`, `/clientes/**`, `/processos/**`, `/pendencias`, `/financeiro`, `/notificacoes`, `/minha-conta` | Portal do Parceiro (mesmas URLs; a página escolhe a tela pelo público com `AudienceSwitch`) |
| `notifications`, `navigation`, `offices` | — | hooks compartilhados |

Rotas em `src/app` são finas: páginas dinâmicas aguardam `params` (Next 16) e delegam
para um componente da feature. `src/app/(app)/layout.tsx` monta o `AppShell`
(hidratação → guarda de sessão/implantação → header → conteúdo → tour).

## 3. RBAC

`src/lib/permissions/index.ts` é a única fonte da matriz papel → permissões.

- Componentes perguntam por **permissão**, nunca por papel: `usePermission("finance.view")`,
  `useCan()`, `<Can>`, `<RequirePermission>`.
- Sem permissão, o conteúdo **não é renderizado** (não fica escondido por CSS). Isso vale
  para abas (Financeiro do processo), seções (Configurações), itens de menu, KPIs e
  notificações (`Notification.requiredPermission`).
- `caseValue` (valor da causa) é dado jurídico e tem permissão própria
  (`processes.caseValue.view`), separada de `finance.view` (honorários, pagamentos,
  contratos).
- Trocar o que um papel enxerga = editar `ROLE_PERMISSIONS`.
- No backend, a **mesma** matriz precisa ser aplicada no servidor. O front só decide o que desenhar.

### Dois públicos e escopo de dados

- `audienceOf(role)`: `OWNER` (equipe interna) ou `PARTNER` (escritório parceiro). Papéis
  de parceiro (`PARTNER_ADMIN`, `PARTNER_USER`) têm matriz própria em `ROLE_PERMISSIONS`.
- **Escopo:** `store/scope.ts` recorta o estado inteiro para o usuário da sessão antes de
  qualquer leitura (`useScopedStore` nos hooks, `selectScoped` nos repositórios mock). As
  regras ficam em `lib/permissions/partner-scope.ts`. Para o parceiro, revisões, agentes,
  Skills, teses, financeiro global, integrações e auditoria interna **não existem** no
  estado recebido; clientes e processos chegam sem campos internos.
- Hooks de features **nunca** leem dados com `useAppStore` diretamente: usam
  `useScopedStore`. `useAppStore` fica para sessão, preferências e ações.
- Ações do portal (`store/slices/partners.ts`) obtêm o `partnerOfficeId` da sessão
  (`requirePartnerViewer`) — nunca de parâmetro de tela.
- Rotas: `AudienceSwitch` escolhe a tela; `RequirePermission` bloqueia áreas internas
  (`/dg-brasil`, `/parceiros`, `/revisoes`, `/configuracoes`); recurso fora do escopo por
  URL mostra "não encontrado".
- Simulação: o seletor de perfil permite escolher papel interno ou papel de parceiro + o
  escritório parceiro simulado.

## 4. Estado

Dois stores Zustand:

| Store | Conteúdo | Persistência |
|---|---|---|
| `store/app-store.ts` | Dados do escritório (clientes, processos, revisões…) + sessão simulada | `localStorage` (`dg-brasil:demo`), só dados fictícios |
| `store/ui-store.ts` | Toasts e tour guiado | memória |

- As ações ficam em `store/slices/*`, agrupadas por domínio. Elas concentram as regras
  do protótipo (efeitos colaterais, timeline, auditoria), para que o backend saiba
  exatamente o que precisa replicar.
- A hidratação é manual (`skipHydration` + `HydrationGate`) para evitar divergência entre
  servidor e cliente.
- Selectors devolvem fatias cruas; derivações usam `useMemo` nos hooks das features.
- Toda ação relevante gera um `AuditEvent` (cliente criado/editado, documento, análise,
  revisão, processo, honorários, Skill, agente, integração).

### Fluxos implementados nas ações

- **Documentos → análise:** adicionar ou alterar um documento reavalia as análises do
  cliente. Documentação completa leva a análise para "Pronta para análise"; nova
  pendência a devolve para "Aguardando documentos".
- **Análise:** iniciar → (documentos pendentes | agente avaliando) → *simular conclusão*
  (botão de demonstração, sem timer) → revisão criada → decisão humana.
- **Revisão aprovada** continua o fluxo conforme o tipo. Resultado de análise conclui a
  análise, cria o processo em pré-ajuizamento (origem `AGENT`) e abre a tarefa do Agente
  de Petições. Minuta aprovada deixa o processo pronto para protocolo **manual**.
  Alterações solicitadas devolvem ao agente; rejeição interrompe a análise.
- **Tutor DG:** propõe; somente `applySkillChange` (chamado após confirmação explícita)
  altera a Skill, incrementa a versão e registra o histórico. Cancelar também registra.
  Criações e alterações manuais (agente, Skill, tese) também entram no histórico.
- **Financeiro:** status de parcela e de contrato **não são gravados**; são derivados dos
  pagamentos por `lib/domain/finance.ts` (fonte única). Registrar, alterar ou estornar
  recebimento e mudar vencimento atualizam, na mesma leitura, tabela, drawer, KPIs e Home.
- **Cliente ↔ processo:** ciclos de vida independentes. Excluir cliente mantém os
  processos com vínculo pendente + alerta `DATA_INTEGRITY`; excluir processo mantém o cliente.
  Inativar (status `INACTIVE`) é o caminho preferencial.
- **Revisões:** edição manual cria nova versão (a anterior fica guardada); reabrir leva a
  `REOPENED` sem apagar a decisão anterior; aprovação vale apenas para a versão aprovada.
- **Importação:** `features/data-import` valida, detecta conflitos e monta um `ImportPlan`;
  `importData` cria clientes, processos e vínculos numa única operação.

## 5. Abstração de repositório

```
Componente ──► hook da feature ──► (leitura) useAppStore
     │
     └────────► repositories.<domínio>.<ação>()  ──► mock/*  ──► store
                                                  └─► api/*   (futuro)
```

- `repositories/contracts.ts` define interfaces **assíncronas** por domínio
  (`ClientRepository`, `ProcessRepository`, `ReviewRepository`, `DgRepository`,
  `FinanceRepository`, `NotificationRepository`…).
- `repositories/index.ts` escolhe a implementação. Para o backend: criar `repositories/api/*`
  e trocar a exportação.
- O `officeId` não é parâmetro dos contratos: virá da sessão autenticada no servidor.
- Leitura: hoje os hooks leem o store diretamente (ele faz o papel de cache). Na migração,
  os hooks passam a usar uma camada de cache de servidor (ex.: TanStack Query) chamando os
  mesmos repositórios. Os componentes não mudam, porque só conhecem os hooks.
- Os componentes de estado (`EmptyState`, `SkeletonRows`, `ErrorState`, `Callout`) já existem
  para quando as leituras passarem a ter loading e erro de verdade.

`services/` guarda contratos de integrações que não são CRUD:
`AIProviderService` (Claude Platform, sempre via backend) e `JudicialIntegrationProvider`
(`judicial-integration.ts`: DJEN, DataJud e futuros fornecedores, cada um declarando o que
fornece; a tela de Integração Judicial se monta a partir do registro `JUDICIAL_PROVIDERS`).

## 6. Design system

- **Tokens:** `src/app/globals.css` define as variáveis CSS (navy, dourado, superfícies,
  semânticas, gráficos) e as expõe ao Tailwind v4 via `@theme inline`. Componentes usam
  classes de token (`bg-navy`, `text-muted`, `border-line`), nunca hex.
- **Tipografia:** IBM Plex Sans (interface), Newsreader (serifada, só em títulos
  institucionais) e IBM Plex Mono.
- **Tom semântico:** `lib/constants/status.ts` mapeia cada status para um `Tone`;
  `components/ui/tone.ts` converte tom em classes. Prioridade sempre com texto/ícone.
- **Navegação:** header navy persistente e o **menu da casa** (painel que desliza para
  baixo: hover abre, clique fixa, ESC/clique fora fecha, setas navegam). Não há sidebar.
  O acionador mostra ícone e rótulo da **área atual**, vindos do mapa central
  `components/navigation/route-areas.ts` (rota → rótulo → ícone); subrotas herdam a área pai.
- **Primitives:** `components/ui/*`, construídos do zero ou sobre Radix (Dialog, Tooltip)
  com visual próprio.
- **Densidade:** tabelas semânticas com cabeçalhos ordenáveis (`aria-sort`), linhas finas e
  poucos cards. Desktop first (1280–1920), com `min-width` de 1024px no `body`.

## 7. Mocks

- `src/mocks/seed/*`: um arquivo por domínio, com IDs estáveis em `mocks/ids.ts`.
- `createSeedData()` gera tudo relativo à data atual. "Restaurar dados de demonstração"
  chama o seed de novo.
- Nenhum dado real: identificadores fictícios, instituições marcadas como fictícias e
  conteúdo jurídico sinalizado como demonstração.

## 8. Acessibilidade

Foco visível (anel dourado), link "Pular para o conteúdo", `aria-label` em botões de ícone,
labels associados a todos os campos (`Field`), mensagens de erro com `role="alert"`, abas
no padrão WAI-ARIA, ESC em popovers e modais, tabelas com `caption`/`scope`, e
`prefers-reduced-motion` respeitado.
