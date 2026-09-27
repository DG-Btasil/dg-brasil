import type { AgentScript, StepKey } from "./types";

/**
 * Roteiro do assistente de implantação. Todas as respostas são pré-definidas
 * nesta demonstração; nenhuma chamada a modelo é feita.
 */
export const AGENT_SCRIPTS: Record<StepKey, AgentScript> = {
  identity: {
    intro:
      "Estes dados identificam o escritório nos documentos gerados e definem os estados em que os agentes consideram a atuação possível.",
    questions: [
      {
        question: "Por que os estados de atuação importam?",
        answer:
          "Os agentes usam os estados para sinalizar quando um caso chega de uma UF onde o escritório não atua. Nesses casos, a triagem indica a divergência em vez de seguir com a análise.",
      },
      {
        question: "Preciso informar CNPJ e razão social?",
        answer:
          "Não é obrigatório para concluir a implantação. Eles são usados em cabeçalhos de documentos e podem ser preenchidos depois em Configurações.",
      },
      {
        question: "O que são as unidades?",
        answer: "Sedes ou filiais do escritório. Servem para organizar responsáveis e, no futuro, a distribuição de casos por unidade.",
      },
    ],
  },
  team: {
    intro: "A equipe define quem recebe tarefas, quem revisa o trabalho dos agentes e quem pode aprovar ações.",
    questions: [
      {
        question: "Qual papel devo escolher para cada pessoa?",
        answer:
          "Administrador tem acesso completo, inclusive Financeiro e DG Brasil. Advogado trabalha com clientes, processos e revisões. Assistente cuida de clientes e processos, sem revisões nem financeiro.",
      },
      {
        question: "Os convites são enviados agora?",
        answer: "Nesta demonstração os convites são apenas registrados. Nenhum e-mail é enviado.",
      },
      {
        question: "Posso convidar a equipe depois?",
        answer: "Sim. Use \"Convidar depois\" e faça os convites em Configurações › Equipe quando preferir.",
      },
    ],
  },
  "practice-areas": {
    intro: "As áreas de atuação delimitam o que os agentes podem analisar e quais teses e Skills são ativadas.",
    questions: [
      {
        question: "O que acontece com casos fora das áreas escolhidas?",
        answer:
          "A triagem sinaliza o caso como fora do escopo e o encaminha para decisão humana. Nenhum agente recomenda ação em área não cadastrada.",
      },
      {
        question: "Para que serve a atuação principal?",
        answer: "Ela define a prioridade das Skills iniciais e o conjunto de teses sugerido na etapa de Agentes e Skills.",
      },
    ],
  },
  "client-profile": {
    intro: "O perfil de clientes ajusta a linguagem das comunicações e os filtros da triagem inicial.",
    questions: [
      {
        question: "Por que informar o que o escritório não atende?",
        answer:
          "Essa lista evita que a equipe gaste tempo com casos que seriam recusados. A triagem passa a sinalizar esses perfis logo na entrada.",
      },
      {
        question: "Os canais de entrada mudam algo?",
        answer: "Eles ajudam a registrar a origem de cada cliente e, no futuro, a medir quais canais trazem casos aceitos.",
      },
    ],
  },
  "legal-criteria": {
    intro:
      "Critérios jurídicos são as regras mais sensíveis da implantação. Eles orientam a triagem e nunca são alterados sem aprovação humana.",
    questions: [
      {
        question: "Os agentes podem citar jurisprudência?",
        answer:
          "Somente referências cadastradas pelo escritório. O sistema nunca inventa julgados, números de processo ou ementas; quando não houver referência, o agente declara a ausência.",
      },
      {
        question: "Como escrever uma boa regra para os agentes?",
        answer:
          "Uma frase objetiva, no imperativo, com uma única condição. Exemplo: \"Não concluir pela viabilidade sem extrato legível\".",
      },
      {
        question: "Documentos mínimos bloqueiam a análise?",
        answer: "Sem os documentos mínimos, a análise fica em \"Aguardando documentos\" e o cliente pode ser avisado após aprovação.",
      },
    ],
  },
  "writing-style": {
    intro: "O padrão de redação orienta as Skills de peças e comunicações para que o texto tenha a voz do escritório.",
    questions: [
      {
        question: "Para que servem as peças anteriores?",
        answer:
          "Elas servirão de referência de estrutura e vocabulário. Nesta demonstração os arquivos não são enviados; apenas nome e tamanho ficam registrados.",
      },
      {
        question: "Qual formalidade costuma funcionar melhor?",
        answer:
          "Para peças processuais, a maioria dos escritórios prefere formal com extensão equilibrada: linguagem técnica, sem excesso de adjetivação.",
      },
    ],
    suggestion: {
      title: "Aplicar sugestão: formal, extensão equilibrada",
      description: "Preenche formalidade, extensão e o que evitar com uma configuração usual para peças processuais.",
      values: {
        formality: "FORMAL",
        length: "BALANCED",
        avoid: "Adjetivação excessiva, citações longas sem necessidade, repetição de argumentos.",
      },
    },
  },
  workflow: {
    intro: "O fluxo operacional é a sequência que os agentes usam para saber em que ponto cada cliente está e o que vem a seguir.",
    questions: [
      {
        question: "Posso renomear as etapas?",
        answer: "Sim. Use a nomenclatura que a equipe já conhece; os agentes passam a usar os mesmos nomes nas atualizações.",
      },
      {
        question: "O que acontece com uma etapa marcada como não usada?",
        answer: "Ela é ignorada nas propostas dos agentes e deixa de aparecer nos resumos de andamento.",
      },
    ],
  },
  approvals: {
    intro: "Aqui você define até onde os agentes podem ir sozinhos. A confirmação humana para ações externas é permanente.",
    questions: [
      {
        question: "Por que não posso desmarcar as ações externas?",
        answer:
          "Protocolo, envio a clientes e envio a terceiros têm efeito fora do escritório. No DG Brasil, a IA executa e o humano decide: essas ações sempre passam por confirmação.",
      },
      {
        question: "Qual limite de autonomia recomendam?",
        answer: "Para o início, \"Executa com revisão humana\". Depois de algumas semanas, tarefas internas de baixo risco podem seguir direto.",
      },
    ],
    suggestion: {
      title: "Usar configuração segura recomendada",
      description: "Marca petições, mensagens, prazos, alterações de Skills e documentos a terceiros como itens com aprovação, com autonomia \"Executa com revisão humana\".",
      values: {
        requiresApproval: ["PETITIONS", "CLIENT_MESSAGES", "DEADLINES", "SKILL_CHANGES", "THIRD_PARTY_DOCUMENTS"],
        autonomy: "REVIEW_REQUIRED",
      },
    },
  },
  communication: {
    intro: "Estas preferências orientam os rascunhos de mensagens a clientes, que sempre passam por Revisões antes do envio.",
    questions: [
      {
        question: "Os agentes enviam mensagens sozinhos?",
        answer: "Não. Mensagens a clientes são preparadas como rascunho e só saem após aprovação de uma pessoa da equipe.",
      },
      {
        question: "Para que servem as mensagens frequentes?",
        answer: "Viram modelos de partida, por exemplo \"pedido de documento pendente\" ou \"atualização de andamento\".",
      },
    ],
    suggestion: {
      title: "Aplicar sugestão de tom",
      description: "Tratamento por \"Sr.\" e \"Sra.\", tom cordial e formal.",
      values: { clientTreatment: "Sr. / Sra. seguido do primeiro nome", tone: "FORMAL_CORDIAL" },
    },
  },
  "fee-models": {
    intro: "Modelos de honorários agilizam a criação de acordos financeiros. Esta etapa é opcional.",
    questions: [
      {
        question: "Quem vê esses valores?",
        answer: "Somente perfis com acesso ao Financeiro. Advogados e assistentes não veem honorários.",
      },
      {
        question: "Posso alterar os modelos depois?",
        answer: "Sim, em Configurações › Honorários. Acordos já criados não mudam quando o modelo é editado.",
      },
    ],
  },
  integrations: {
    intro: "As integrações serão configuradas por um backend seguro. Nenhuma credencial é pedida ou guardada no navegador.",
    questions: [
      {
        question: "Preciso informar uma chave de API?",
        answer: "Não. As credenciais serão configuradas no backend seguro durante a implantação assistida, nunca nesta tela.",
      },
      {
        question: "Qual provedor de acompanhamento processual será usado?",
        answer: "O fornecedor ainda não foi definido. A conexão exibida é simulada para demonstrar o fluxo.",
      },
    ],
  },
  "agents-skills": {
    intro: "Esta é a proposta de configuração inicial, montada a partir das suas respostas. Nada é aplicado até você finalizar a implantação.",
    questions: [
      {
        question: "Como a proposta foi montada?",
        answer:
          "A partir das áreas, dos critérios jurídicos e do padrão de redação informados. As regras que você escreveu na etapa de critérios foram incluídas na lista.",
      },
      {
        question: "Posso mudar isso depois?",
        answer: "Sim. Agentes, Skills e regras podem ser ajustados na Central do DG Brasil, com histórico de versões.",
      },
    ],
  },
  review: {
    intro: "Confira o resumo. Etapas puladas podem ser configuradas depois, sem impedir a finalização.",
    questions: [
      {
        question: "O que acontece ao finalizar?",
        answer: "A implantação é marcada como concluída, as escolhas de agentes são aplicadas e você é levado à Home.",
      },
      {
        question: "Posso voltar ao onboarding?",
        answer: "Sim. As respostas ficam salvas e podem ser revisadas a qualquer momento.",
      },
    ],
  },
};

export const CANNED_FREE_TEXT_REPLY =
  "Nesta demonstração, o assistente responde com orientações pré-definidas. Use as perguntas sugeridas acima ou consulte a explicação da etapa; na versão final, sua pergunta será respondida com base nas informações do escritório.";
