# DG Brasil — Front-end

SaaS jurídico em que **agentes de IA executam e o escritório decide**. Agentes analisam
documentos, preparam minutas e acompanham processos; toda decisão relevante e toda
ação externa passam por **revisão humana**.

Esta pasta é a **fundação do front-end**: navegável, funcional e com dados fictícios.
Não há backend, banco, autenticação real, integração processual nem chamada à Claude
nesta etapa. A arquitetura foi desenhada para trocar os mocks por API sem reescrever
a interface.

> **IA executa. Humano decide.**

## Como rodar

Requer Node.js 20.9+ (desenvolvido com Node 24).

```bash
cd apps/frontend
npm install
npm run dev          # http://localhost:3000
```

| Script | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento (Turbopack) |
| `npm run lint` | ESLint (flat config do Next 16) |
| `npm run typecheck` | Gera os tipos de rota (`next typegen`) e roda `tsc --noEmit` |
| `npm run build` | Build de produção |
| `npm run check` | lint + typecheck + build |

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript estrito · Tailwind CSS v4 ·
Zustand (estado + `localStorage` só para os mocks) · React Hook Form + Zod · Radix UI
(Dialog, Tooltip) com identidade visual própria · Recharts · Lucide.

## Usuários e papéis de demonstração

A sessão é simulada. No menu do avatar, **Simular perfil** troca o papel na hora e a
interface reflete as permissões. **Restaurar dados de demonstração** volta ao estado
inicial.

| Papel | Usuário fictício | Acessa |
|---|---|---|
| Administrador | Dra. Marina Alves — `marina@alvesmoura.exemplo` | Tudo: Home, Clientes, Processos, Revisões, Financeiro, DG Brasil, Configurações |
| Advogado | Dr. Rafael Moura — `rafael@alvesmoura.exemplo` | Home, Clientes, Processos, Revisões, configurações permitidas |
| Assistente | Camila Duarte — `camila@alvesmoura.exemplo` | Home, Clientes, Processos |

Na tela de login, a senha não é verificada (protótipo). O convite de demonstração
fica em `/convite/demo-convite`.

## Roteiro sugerido para avaliar

1. `/criar-escritorio` → onboarding de 13 etapas → Home
2. Clientes → **Ana Cláudia** (documentação completa) → *Iniciar análise jurídica*
3. Na aba Análise: *Simular conclusão do agente (demonstração)* → abre uma revisão
4. Revisões → aprovar → a análise conclui e nasce um processo em pré-ajuizamento
5. Processos → Francisco (prazo de réplica vence hoje) → abas Movimentações e Prazos
6. Financeiro (Admin) → novo contrato a partir de um modelo de honorários
7. DG Brasil → Tutor DG → "Meu agente de petições está fazendo introduções muito longas" → aplicar → Histórico
8. Simular perfil **Assistente** e conferir que Revisões, Financeiro e DG Brasil somem

## Estrutura

```
src/
  app/                 rotas (App Router). (app)/ = área autenticada com header global
  components/
    ui/                primitives visuais (Button, Badge, Table, Tabs, Dialog, Field…)
    layout/            header, guards (auth/permissão), notificações, menu do usuário
    navigation/        menu da casa (navegação principal — não há sidebar)
    feedback/          estados vazios, skeletons, erro, toasts
  features/<domínio>/  componentes, hooks, schemas e utilitários por domínio
  lib/                 status, permissões (RBAC), formatação/máscaras, validação, domínio puro
  repositories/        contratos assíncronos + implementação mock
  services/            contratos futuros (AIProviderService, LegalProcessIntegration)
  store/               Zustand (dados do protótipo) + estado efêmero de UI
  mocks/               dados fictícios (seed), com datas relativas ao dia atual
  types/               modelos de domínio (todos com officeId)
docs/
  CONVENTIONS.md       regras curtas para quem contribui
  FRONTEND_ARCHITECTURE.md
  BACKEND_HANDOFF.md
```

## Dados mockados

`src/mocks/seed/*` cria um escritório fictício com 12 clientes (PF e PJ), 13 processos
nas três origens (DG Brasil, integração, manual), análises em todos os estados, 9
revisões, 5 agentes, 8 Skills, 7 teses, notificações, prazos, modelos de honorários,
contratos, pagamentos e histórico de alterações.

- Todos os nomes, CPFs, CNPJs, endereços e números CNJ são **fictícios** (identificadores
  começam com `000`, e os CNJ usam o código de origem `0000`).
- Instituições financeiras são fictícias e marcadas como tal.
- Conteúdo jurídico (teses, minutas, referências) é identificado como
  **"Conteúdo jurídico fictício para demonstração da interface."** Nenhuma jurisprudência,
  súmula ou decisão real é citada.
- As datas são geradas relativas ao dia atual: um prazo "vence hoje" continua vencendo
  hoje depois de restaurar os dados.

## Services e repositories

Componentes não sabem de onde vêm os dados. Eles leem por hooks da feature e escrevem
por `repositories.<domínio>`, cujos contratos (`src/repositories/contracts.ts`) já são
assíncronos. Hoje a implementação é `repositories/mock`; o backend entra implementando
`repositories/api` com os mesmos contratos. Detalhes em
[docs/FRONTEND_ARCHITECTURE.md](docs/FRONTEND_ARCHITECTURE.md).

## Limitações do protótipo

- Sessão, permissões e isolamento por escritório são simulados no navegador. Esconder
  interface **não** é autorização: o RBAC precisa existir no servidor.
- Upload de documentos registra só metadados; nenhum arquivo é enviado.
- Os agentes não rodam: a conclusão de uma análise é disparada explicitamente por um
  botão de demonstração, sem timers fingindo processamento.
- O Tutor DG e o assistente de onboarding respondem com cenários pré-definidos.
- Nenhuma credencial é pedida nem guardada. A conexão com a Claude Platform é só interface.
- O protótipo **não** é uma declaração de conformidade com a LGPD. Os requisitos estão
  em [docs/BACKEND_HANDOFF.md](docs/BACKEND_HANDOFF.md).
