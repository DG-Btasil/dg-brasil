# DG Brasil — Front-end

SaaS jurídico em que **agentes de IA executam e o escritório decide**. Agentes analisam
documentos, preparam minutas e acompanham processos; toda decisão relevante e toda
ação externa passam por **revisão humana**.

Esta pasta é o front-end. **Identidade é real** (Supabase Auth: convite, senha, MFA
obrigatório, termos, papéis lidos do banco a cada requisição — ver
[docs/auth.md](../../docs/auth.md)). Os **módulos jurídicos ainda usam dados fictícios**
(mocks no navegador), recortados pelo papel real, até a Etapa 4.3. Não há integração
processual nem chamada à Claude a partir do front.

> **IA executa. Humano decide.**

## Como rodar

Requer Node.js 20.9+ (desenvolvido com Node 24).

```bash
cd apps/frontend
cp .env.example .env.local   # Supabase de DESENVOLVIMENTO (URL, anon, service role)
npm install
npm run dev          # http://localhost:3000
```

Sem `.env.local` as páginas autenticadas não sobem. O primeiro ADMIN (fictício) e a
configuração do Supabase Auth estão em [docs/auth.md](../../docs/auth.md).

| Script | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento (Turbopack) |
| `npm run lint` | ESLint (flat config do Next 16) |
| `npm run typecheck` | Gera os tipos de rota (`next typegen`) e roda `tsc --noEmit` |
| `npm test` | Testes unitários (vitest): permissões, sessão, redirects, senha |
| `npm run build` | Build de produção |
| `npm run check` | lint + typecheck + test + build |

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript estrito · Tailwind CSS v4 ·
Zustand (estado + `localStorage` só para os mocks) · React Hook Form + Zod · Radix UI
(Dialog, Tooltip) com identidade visual própria · Recharts · Lucide.

## Papéis e dados de demonstração

Login, papel e escritório são **reais** (não há mais "Simular perfil"). Para os módulos
que ainda são mock, a sessão real é associada à persona fictícia **do mesmo papel**
(tabela abaixo), só para recortar os dados de demonstração; quem decide permissão é o
papel real. O ADMIN tem **Restaurar dados de demonstração** no menu do avatar.

| Papel | Persona mock | Acessa |
|---|---|---|
| Administrador | Bárbara Cardoso — `barbara@barbaracardoso.exemplo` | Tudo, inclusive Financeiro, DG Brasil (Referências) e alteração de origem de caso aceito |
| Advogado | Cláudio — `claudio@barbaracardoso.exemplo` | Home, Clientes, Casos (aceite/rejeição), Processos, Revisões |
| Assistente | Renata — `renata@barbaracardoso.exemplo` | Home, Clientes, Casos, Processos |
| Administrador do parceiro | Almeida Advocacia | Portal: Início, Clientes, Casos, Processos, Pendências, Financeiro |
| Usuário do parceiro | Almeida Advocacia | Portal sem valores de parceria |

Um usuário de parceiro real é associado ao escritório mock de mesmo nome, ou ao
Almeida Advocacia.

## Roteiro sugerido para avaliar

1. Entrar como **Administrador** (conta real fictícia do Supabase DEV) → Home (casos ativos, aguardando análise, novos casos de parceiros)
2. Casos → **Novo caso** (cliente, área, tipo, origem, documentos) → *Enviar para análise*
3. No caso: *Iniciar análise* → *Simular conclusão do agente* → revisão em Revisões
4. *Aceitar* → modal "Definir advogado responsável" → caso aceito (origem parceiro cria o acordo de parceria)
5. Aba Processos → *Cadastrar processo* (um caso pode ter vários processos)
6. Caso de parceiro → *Rejeitar* com "Comunicação ao parceiro" e "Nota interna"
7. Entrar com uma conta **Administrador do parceiro** → Casos → ver "Não aceito" com o motivo público; *Novo caso* → *Confirmar e enviar para Bárbara Cardoso Advocacia*
8. DG Brasil → Referências → *Adicionar referência*

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

- Identidade e acesso são reais (servidor + RLS). Os **dados** jurídicos ainda são mock
  no navegador: o isolamento por escritório desses dados é simulado até a Etapa 4.3.
- Upload de documentos registra só metadados; nenhum arquivo é enviado.
- Os agentes não rodam: a conclusão de uma análise é disparada explicitamente por um
  botão de demonstração, sem timers fingindo processamento.
- O Tutor DG responde com cenários pré-definidos.
- Nenhuma credencial é pedida nem guardada. A Conexão Claude é só interface.
- O protótipo **não** é uma declaração de conformidade com a LGPD. Os requisitos estão
  em [docs/BACKEND_HANDOFF.md](docs/BACKEND_HANDOFF.md).
