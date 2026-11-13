# Deploy

O que mexe na publicação do DG Brasil: onde ele roda (Vercel e Supabase), os
planos e o que precisa estar configurado.

| Arquivo | Para quê |
|---|---|
| [checklist-da-virada.md](checklist-da-virada.md) | **A ordem do dia de pôr em uso:** 39 passos, do que contratar ao primeiro trabalho com dado real, cada um apontando o documento que explica como fazer. Comece por aqui no dia. |
| [producao.md](producao.md) | **O que mudar quando o DG Brasil entrar em produção.** Planos pagos, automações que o plano gratuito não comporta, e-mail, domínios, variáveis, cópia de segurança, monitoramento e conferências antes do primeiro dado real. Ficou de fora de propósito na fase de teste. |
| [restauracao-dos-documentos.md](restauracao-dos-documentos.md) | Cópia de segurança dos arquivos do Storage (o backup do Supabase não cobre) e o roteiro para restaurar. |
| [pedido-de-titular.md](pedido-de-titular.md) | Como atender um pedido de titular de dados: o que o sistema já registra, o que é manual e onde estão os dados. |
| [pos-mvp.md](pos-mvp.md) | **Atualizações futuras, depois do lançamento:** validação de formato dos documentos, domínio consignado, decisão sobre os agendamentos dos agentes, correções no repositório dos agentes e ajustes pequenos. |
| [organizacao-pre-producao.md](organizacao-pre-producao.md) | **Revisão do banco antes do lançamento (2026-11-12):** causa do alerta de Disk IO do Supabase DEV e como ganhar tempo sem pagar, estado das migrations, dados de teste que podem sair e achados a corrigir antes da produção. |
| [deploy-de-teste.md](deploy-de-teste.md) | Passo a passo do deploy de teste de 2026-10-29: Claude Code, Google Drive e o agendamento diário. Diz quem faz cada passo e quais são os riscos. |

**Regra:** o que é preciso para lançar entra em [producao.md](producao.md); o que
fica para depois do lançamento entra em [pos-mvp.md](pos-mvp.md).
