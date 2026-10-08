import { daysFromNowISO } from "@/lib/clock";
import { DEMO_REFERENCE_LABEL } from "@/lib/constants/legal";
import type { Agent, AgentTask, AnalysisTemplate, ChangeHistoryEntry, LegalThesis, Skill } from "@/types";
import { A, C, OFFICE_ID, P, R, S, T, TPL, U } from "../ids";

const o = { officeId: OFFICE_ID };

/* ------------------------------------------------------------------ */
/* Agentes                                                             */
/* ------------------------------------------------------------------ */

export function buildAgents(): Agent[] {
  return [
    {
      ...o,
      id: A.triagem,
      name: "Agente de Triagem Bancária",
      role: "Avalia contratos e extratos e identifica possíveis teses",
      description:
        "Recebe a documentação de uma análise bancária, cruza contrato, extrato e relato do cliente, e produz um parecer preliminar com as teses aplicáveis para revisão do advogado.",
      status: "ACTIVE",
      skillIds: [S.triagemContratos, S.conferenciaDocumental, S.resumoProcessual],
      thesisIds: [T.juros, T.descontoNaoContratado, T.tarifas, T.seguroPrestamista, T.portabilidade, T.cartaoConsignado],
      permissions: ["Ler documentos do cliente", "Consultar teses do escritório", "Enviar resultado para Revisões"],
      autonomy: "REVIEW_REQUIRED",
      rules: [
        "Nunca concluir pela viabilidade sem contrato ou extrato legível.",
        "Indicar expressamente quando um documento estiver ilegível ou divergente.",
        "Não recomendar ação fora das áreas de atuação cadastradas.",
      ],
      lastRunAt: daysFromNowISO(0, 8, 50),
      version: 4,
      config: { model: "claude-sonnet-5", maxOutputTokens: 8000, tools: ["leitura_documentos", "consulta_teses", "propor_revisao"], concurrency: 3 },
      updatedAt: daysFromNowISO(-10),
    },
    {
      ...o,
      id: A.documentacao,
      name: "Agente de Documentação",
      role: "Confere documentos recebidos e aponta pendências",
      description:
        "Classifica cada documento enviado, verifica legibilidade, validade e coerência entre documentos, e mantém atualizado o checklist de cada análise.",
      status: "ACTIVE",
      skillIds: [S.conferenciaDocumental, S.comunicacaoCliente],
      thesisIds: [],
      permissions: ["Ler documentos do cliente", "Classificar documentos", "Sugerir mensagem ao cliente"],
      autonomy: "REVIEW_REQUIRED",
      rules: [
        "Classificação e checklist podem ser atualizados sem revisão.",
        "Qualquer mensagem ao cliente exige aprovação humana.",
        "Comprovante de residência com mais de 90 dias deve ser marcado como 'precisa atualização'.",
      ],
      lastRunAt: daysFromNowISO(0, 9, 10),
      version: 2,
      config: { model: "claude-haiku-4-5", maxOutputTokens: 4000, tools: ["leitura_documentos", "classificar_documento", "propor_mensagem"], concurrency: 5 },
      updatedAt: daysFromNowISO(-18),
    },
    {
      ...o,
      id: A.peticoes,
      name: "Agente de Petições",
      role: "Elabora minutas de peças a partir de análises aprovadas",
      description:
        "Redige minutas de petições iniciais e manifestações seguindo o padrão de redação do escritório. Toda minuta segue para revisão; nenhuma peça é protocolada pelo agente.",
      status: "ACTIVE",
      skillIds: [S.peticaoInicial, S.redacaoBancaria],
      thesisIds: [T.juros, T.tarifas, T.seguroPrestamista, T.descontoNaoContratado],
      permissions: ["Ler análise aprovada", "Consultar teses e modelos", "Enviar minuta para Revisões"],
      autonomy: "REVIEW_REQUIRED",
      rules: [
        "Toda minuta é enviada para Revisões. O protocolo é sempre humano.",
        "Usar apenas teses com status Vigente.",
        "Não inserir citação jurisprudencial que não esteja cadastrada nas referências da tese.",
      ],
      lastRunAt: daysFromNowISO(-4, 16, 30),
      version: 5,
      config: { model: "claude-opus-5-5", maxOutputTokens: 16000, tools: ["leitura_analise", "consulta_teses", "modelos_pecas", "propor_revisao"], concurrency: 2 },
      updatedAt: daysFromNowISO(-10),
    },
    {
      ...o,
      id: A.prazos,
      name: "Agente de Prazos",
      role: "Lê movimentações e propõe prazos processuais",
      description:
        "Acompanha as movimentações recebidas pela integração processual, identifica intimações e propõe o prazo correspondente com a contagem sugerida, para confirmação do responsável.",
      status: "ACTIVE",
      skillIds: [S.contagemPrazos, S.leituraMovimentacoes],
      thesisIds: [],
      permissions: ["Ler movimentações", "Propor prazo", "Notificar responsável"],
      autonomy: "REVIEW_REQUIRED",
      rules: [
        "Todo prazo proposto exige confirmação do advogado responsável.",
        "Prazos com vencimento em até 2 dias geram alerta crítico.",
      ],
      lastRunAt: daysFromNowISO(0, 7, 40),
      version: 3,
      config: { model: "claude-sonnet-5", maxOutputTokens: 4000, tools: ["leitura_movimentacoes", "calendario_forense", "propor_prazo"], concurrency: 4 },
      updatedAt: daysFromNowISO(-25),
    },
    {
      ...o,
      id: A.revisoes,
      name: "Agente de Revisões Processuais",
      role: "Resume movimentações relevantes e sugere próximos passos",
      description:
        "Monitora processos ativos, resume movimentações relevantes em linguagem objetiva e sugere a próxima providência ao responsável.",
      status: "PAUSED",
      skillIds: [S.resumoProcessual, S.leituraMovimentacoes],
      thesisIds: [],
      permissions: ["Ler processos e movimentações", "Enviar sugestão para Revisões"],
      autonomy: "SUGGEST_ONLY",
      rules: ["Nunca alterar status de processo diretamente.", "Resumos com no máximo 8 linhas."],
      lastRunAt: daysFromNowISO(-1, 11, 0),
      version: 1,
      config: { model: "claude-haiku-4-5", maxOutputTokens: 3000, tools: ["leitura_processos", "propor_revisao"], concurrency: 2 },
      updatedAt: daysFromNowISO(-30),
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Skills                                                              */
/* ------------------------------------------------------------------ */

function skill(data: Omit<Skill, "officeId">): Skill {
  return { ...o, ...data };
}

export function buildSkills(): Skill[] {
  return [
    skill({
      id: S.triagemContratos,
      name: "Triagem de Contratos Bancários",
      description: "Define como contratos e extratos são lidos e confrontados durante a análise bancária.",
      purpose: "Extrair dados do contrato (taxas, parcelas, datas) e compará-los com o extrato e o relato do cliente.",
      status: "ACTIVE",
      version: 4,
      parameters: [
        { key: "campos_obrigatorios", label: "Campos extraídos do contrato", value: "Taxa mensal, CET, parcelas, data de contratação, valor liberado" },
        { key: "tolerancia_divergencia", label: "Tolerância para divergência de valores", value: "Até 1% do valor da parcela" },
      ],
      instructions:
        "1. Identifique o tipo de contrato.\n2. Extraia os campos obrigatórios.\n3. Compare com o extrato e aponte divergências.\n4. Relacione com as teses vigentes do escritório.\n5. Produza parecer preliminar em linguagem objetiva.",
      references: ["Manual interno de triagem bancária (demonstração)"],
      templates: ["Parecer preliminar — bancário"],
      files: [{ name: "SKILL.md", sizeKb: 6 }, { name: "checklist-triagem.md", sizeKb: 3 }],
      updatedAt: daysFromNowISO(-14),
      updatedBy: U.barbara,
    }),
    skill({
      id: S.conferenciaDocumental,
      name: "Conferência Documental",
      description: "Regras de verificação de legibilidade, validade e coerência dos documentos recebidos.",
      purpose: "Manter o checklist de documentos de cada análise sempre correto.",
      status: "ACTIVE",
      version: 2,
      parameters: [
        { key: "validade_comprovante", label: "Validade do comprovante de residência", value: "90 dias" },
        { key: "formatos_aceitos", label: "Formatos aceitos", value: "PDF, JPG, PNG" },
      ],
      instructions: "Classifique o documento, verifique legibilidade, datas de validade e coerência de nomes e números entre documentos.",
      references: [],
      templates: ["Mensagem de solicitação de documento"],
      files: [{ name: "SKILL.md", sizeKb: 4 }],
      updatedAt: daysFromNowISO(-18),
      updatedBy: U.barbara,
    }),
    skill({
      id: S.peticaoInicial,
      name: "Redação de Petição Inicial",
      description: "Define estrutura e padrões utilizados na elaboração das petições iniciais do escritório.",
      purpose: "Garantir que toda inicial siga a mesma ordem de seções, pedidos e formatação.",
      status: "ACTIVE",
      version: 6,
      parameters: [
        { key: "estrutura", label: "Estrutura", value: "Endereçamento, qualificação, fatos, fundamentos, pedidos, valor da causa, requerimentos finais" },
        { key: "pedidos", label: "Formato dos pedidos", value: "Lista numerada, um pedido por item" },
      ],
      instructions: "Siga a estrutura definida. Fatos em ordem cronológica. Pedidos numerados e específicos.",
      references: ["Modelo de inicial revisional (demonstração)"],
      templates: ["Inicial — revisional bancária", "Inicial — declaratória de inexistência de débito"],
      files: [{ name: "SKILL.md", sizeKb: 9 }, { name: "modelo-inicial.docx", sizeKb: 48 }],
      updatedAt: daysFromNowISO(-10),
      updatedBy: U.barbara,
    }),
    skill({
      id: S.redacaoBancaria,
      name: "Redação Bancária",
      description: "Padrão de linguagem, extensão e argumentação das peças de Direito Bancário do escritório.",
      purpose: "Manter tom, extensão e vocabulário consistentes nas peças bancárias.",
      status: "ACTIVE",
      version: 3,
      parameters: [
        { key: "extensao_introducao", label: "Extensão da introdução", value: "Até 5 parágrafos" },
        { key: "tom", label: "Tom", value: "Formal, objetivo, sem adjetivação excessiva" },
        { key: "citacoes", label: "Citações", value: "Somente referências cadastradas nas teses" },
      ],
      instructions:
        "Introdução contextualiza o cliente e a relação contratual.\nEvite repetição de fatos entre seções.\nPrefira frases curtas.",
      references: [],
      templates: [],
      files: [{ name: "SKILL.md", sizeKb: 5 }],
      updatedAt: daysFromNowISO(-10),
      updatedBy: U.barbara,
    }),
    skill({
      id: S.contagemPrazos,
      name: "Contagem de Prazos Processuais",
      description: "Regras de contagem de prazos em dias úteis e identificação do termo inicial.",
      purpose: "Propor vencimentos consistentes para confirmação do advogado.",
      status: "ACTIVE",
      version: 3,
      parameters: [
        { key: "contagem", label: "Contagem", value: "Dias úteis, excluindo o dia do começo" },
        { key: "alerta", label: "Antecedência do alerta", value: "5 dias úteis" },
      ],
      instructions: "Identifique a intimação, o termo inicial e a natureza do prazo. Proponha o vencimento e indique a regra aplicada.",
      references: ["Calendário forense do escritório (demonstração)"],
      templates: [],
      files: [{ name: "SKILL.md", sizeKb: 4 }],
      updatedAt: daysFromNowISO(-25),
      updatedBy: U.barbara,
    }),
    skill({
      id: S.leituraMovimentacoes,
      name: "Leitura de Movimentações",
      description: "Como interpretar movimentações recebidas e classificar sua relevância.",
      purpose: "Separar movimentações que exigem providência das meramente informativas.",
      status: "ACTIVE",
      version: 2,
      parameters: [{ key: "relevancia", label: "Critério de relevância", value: "Intimações, decisões, audiências e juntadas da parte contrária" }],
      instructions: "Classifique cada movimentação em: exige providência, informativa ou irrelevante.",
      references: [],
      templates: [],
      files: [{ name: "SKILL.md", sizeKb: 3 }],
      updatedAt: daysFromNowISO(-40),
      updatedBy: U.barbara,
    }),
    skill({
      id: S.comunicacaoCliente,
      name: "Comunicação com Clientes",
      description: "Tom, forma de tratamento e estrutura das mensagens enviadas aos clientes.",
      purpose: "Garantir mensagens claras, respeitosas e sem jargão jurídico desnecessário.",
      status: "ACTIVE",
      version: 2,
      parameters: [
        { key: "tratamento", label: "Forma de tratamento", value: "Sr./Sra. seguido do primeiro nome" },
        { key: "assinatura", label: "Assinatura", value: "Equipe Bárbara Cardoso Advocacia" },
      ],
      instructions: "Mensagens curtas, com uma solicitação por vez e prazo claro quando houver.",
      references: [],
      templates: ["Solicitação de documentos", "Atualização de andamento"],
      files: [{ name: "SKILL.md", sizeKb: 3 }],
      updatedAt: daysFromNowISO(-22),
      updatedBy: U.barbara,
    }),
    skill({
      id: S.resumoProcessual,
      name: "Resumo Processual",
      description: "Formato padrão de resumo de processos e análises para leitura rápida.",
      purpose: "Permitir que qualquer advogado entenda o caso em menos de um minuto.",
      status: "DRAFT",
      version: 1,
      parameters: [{ key: "tamanho", label: "Tamanho máximo", value: "8 linhas" }],
      instructions: "Resuma: partes, pedido, fase atual, última movimentação relevante e próxima providência.",
      references: [],
      templates: [],
      files: [{ name: "SKILL.md", sizeKb: 2 }],
      updatedAt: daysFromNowISO(-30),
      updatedBy: U.barbara,
    }),
  ];
}

/* ------------------------------------------------------------------ */
/* Teses — conteúdo fictício, sem jurisprudência real                  */
/* ------------------------------------------------------------------ */

function demoRef(title: string): { title: string; note: string } {
  return { title: `${DEMO_REFERENCE_LABEL} — ${title}`, note: "Referência fictícia, sem correspondência com decisão real." };
}

function thesis(data: Omit<LegalThesis, "officeId">): LegalThesis {
  return { ...o, ...data };
}

export function buildTheses(): LegalThesis[] {
  return [
    thesis({
      id: T.juros,
      name: "Juros remuneratórios acima da média de mercado",
      area: "BANKING",
      status: "ACTIVE",
      version: 3,
      summary:
        "Tese de demonstração: revisão de contratos cuja taxa de juros contratada se distancie significativamente da taxa média praticada para a mesma modalidade no período.",
      foundations: [
        "Fundamento de demonstração: dever de informação clara ao consumidor sobre o custo efetivo do crédito.",
        "Fundamento de demonstração: equilíbrio contratual nas relações de consumo.",
      ],
      applicationCriteria: [
        "Contrato com taxa mensal informada.",
        "Diferença relevante em relação à taxa média da modalidade (critério definido pelo escritório).",
        "Parcelas pagas ou em curso.",
      ],
      requiredDocuments: ["Contrato bancário", "Extrato de pagamentos", "Documento de identificação"],
      references: [demoRef("parâmetro de taxa média"), demoRef("critério de abusividade adotado pelo escritório")],
      relatedTemplates: ["Inicial — revisional bancária"],
      skillIds: [S.triagemContratos, S.peticaoInicial, S.redacaoBancaria],
      versions: [
        { version: 1, at: daysFromNowISO(-200), authorId: U.barbara, note: "Versão inicial." },
        { version: 2, at: daysFromNowISO(-90), authorId: U.claudio, note: "Critério de diferença revisado." },
        { version: 3, at: daysFromNowISO(-20), authorId: U.barbara, note: "Inclusão de documentos obrigatórios." },
      ],
      updatedAt: daysFromNowISO(-20),
    }),
    thesis({
      id: T.descontoNaoContratado,
      name: "Desconto consignado sem contratação reconhecida",
      area: "BANKING",
      status: "ACTIVE",
      version: 2,
      summary:
        "Tese de demonstração: descontos em benefício ou folha referentes a contrato que o cliente afirma não ter celebrado.",
      foundations: [
        "Fundamento de demonstração: ônus de comprovar a contratação recai sobre quem a alega.",
        "Fundamento de demonstração: restituição de valores descontados indevidamente.",
      ],
      applicationCriteria: [
        "Cliente não reconhece a contratação.",
        "Descontos identificados no extrato de benefício.",
        "Ausência de contrato assinado apresentado pelo banco.",
      ],
      requiredDocuments: ["Extrato de benefício", "Documento de identificação", "Declaração do cliente"],
      references: [demoRef("distribuição do ônus da prova")],
      relatedTemplates: ["Inicial — declaratória de inexistência de débito"],
      skillIds: [S.triagemContratos, S.peticaoInicial],
      versions: [
        { version: 1, at: daysFromNowISO(-180), authorId: U.barbara, note: "Versão inicial." },
        { version: 2, at: daysFromNowISO(-45), authorId: U.claudio, note: "Critérios de aplicação detalhados." },
      ],
      updatedAt: daysFromNowISO(-45),
    }),
    thesis({
      id: T.tarifas,
      name: "Tarifas bancárias não informadas",
      area: "BANKING",
      status: "ACTIVE",
      version: 1,
      summary: "Tese de demonstração: cobrança de tarifas não previstas ou não informadas de forma clara no contrato.",
      foundations: ["Fundamento de demonstração: transparência na cobrança de serviços bancários."],
      applicationCriteria: ["Tarifa identificada no extrato.", "Ausência de previsão contratual clara."],
      requiredDocuments: ["Contrato bancário", "Extrato bancário"],
      references: [demoRef("transparência tarifária")],
      relatedTemplates: ["Inicial — revisional bancária"],
      skillIds: [S.triagemContratos],
      versions: [{ version: 1, at: daysFromNowISO(-60), authorId: U.claudio, note: "Versão inicial." }],
      updatedAt: daysFromNowISO(-60),
    }),
    thesis({
      id: T.seguroPrestamista,
      name: "Seguro prestamista contratado em conjunto com o crédito",
      area: "BANKING",
      status: "ACTIVE",
      version: 2,
      summary:
        "Tese de demonstração: seguro incluído no contrato de crédito sem opção clara de recusa ou escolha de seguradora.",
      foundations: ["Fundamento de demonstração: liberdade de escolha do consumidor."],
      applicationCriteria: ["Seguro embutido no valor financiado.", "Ausência de termo de adesão separado."],
      requiredDocuments: ["Contrato bancário", "Apólice ou certificado, se houver"],
      references: [demoRef("contratação conjunta de seguro")],
      relatedTemplates: ["Inicial — revisional bancária"],
      skillIds: [S.triagemContratos, S.redacaoBancaria],
      versions: [
        { version: 1, at: daysFromNowISO(-150), authorId: U.barbara, note: "Versão inicial." },
        { version: 2, at: daysFromNowISO(-35), authorId: U.barbara, note: "Ajuste nos critérios." },
      ],
      updatedAt: daysFromNowISO(-35),
    }),
    thesis({
      id: T.portabilidade,
      name: "Portabilidade de crédito sem benefício ao cliente",
      area: "BANKING",
      status: "ACTIVE",
      version: 1,
      summary: "Tese de demonstração: portabilidade ou refinanciamento que aumentou o custo total sem vantagem ao cliente.",
      foundations: ["Fundamento de demonstração: dever de informação sobre o custo total da operação."],
      applicationCriteria: ["Contrato de origem e contrato de destino disponíveis.", "Aumento do custo total ou do prazo."],
      requiredDocuments: ["Contrato de origem", "Contrato de destino", "Extrato"],
      references: [demoRef("comparação de custo efetivo total")],
      relatedTemplates: [],
      skillIds: [S.triagemContratos],
      versions: [{ version: 1, at: daysFromNowISO(-70), authorId: U.claudio, note: "Versão inicial." }],
      updatedAt: daysFromNowISO(-70),
    }),
    thesis({
      id: T.superendividamento,
      name: "Repactuação de dívidas por superendividamento",
      area: "CONSUMER",
      status: "IN_REVIEW",
      version: 1,
      summary: "Tese de demonstração em revisão: plano de repactuação para consumidor com comprometimento excessivo de renda.",
      foundations: ["Fundamento de demonstração: preservação do mínimo existencial."],
      applicationCriteria: ["Comprometimento de renda acima do critério do escritório.", "Dívidas de consumo."],
      requiredDocuments: ["Comprovante de renda", "Relação de dívidas", "Extratos"],
      references: [demoRef("mínimo existencial")],
      relatedTemplates: [],
      skillIds: [],
      versions: [{ version: 1, at: daysFromNowISO(-8), authorId: U.beatriz, note: "Rascunho enviado para revisão." }],
      updatedAt: daysFromNowISO(-8),
    }),
    thesis({
      id: T.cartaoConsignado,
      name: "Cartão de crédito consignado contratado como empréstimo",
      area: "BANKING",
      status: "DRAFT",
      version: 1,
      summary: "Tese de demonstração em elaboração: cliente acreditava contratar empréstimo, mas recebeu cartão com reserva de margem.",
      foundations: ["Fundamento de demonstração: vício de informação na contratação."],
      applicationCriteria: ["Reserva de margem para cartão.", "Cliente relata intenção de contratar empréstimo."],
      requiredDocuments: ["Contrato", "Faturas", "Extrato de benefício"],
      references: [],
      relatedTemplates: [],
      skillIds: [S.triagemContratos],
      versions: [{ version: 1, at: daysFromNowISO(-3), authorId: U.claudio, note: "Rascunho inicial." }],
      updatedAt: daysFromNowISO(-3),
    }),
  ];
}

/* ------------------------------------------------------------------ */
/* Templates de análise                                                */
/* ------------------------------------------------------------------ */

export function buildTemplates(): AnalysisTemplate[] {
  return [
    {
      ...o,
      id: TPL.bancaria,
      name: "Análise Bancária",
      area: "BANKING",
      description:
        "Avalia contratos bancários (consignado, crédito pessoal, cartão, cédula de crédito) e identifica possíveis teses aplicáveis.",
      requiredDocuments: [
        { category: "IDENTIFICATION", label: "Documento de identificação", description: "RG, CNH ou documento do representante legal." },
        { category: "ADDRESS_PROOF", label: "Comprovante de residência", description: "Emitido nos últimos 90 dias.", appliesTo: ["INDIVIDUAL"] },
        { category: "CORPORATE_DOCUMENTS", label: "Contrato social", description: "Versão consolidada.", appliesTo: ["COMPANY"] },
        { category: "LOAN_CONTRACT", label: "Contrato bancário", description: "Contrato ou cédula objeto da análise." },
        { category: "BANK_STATEMENT", label: "Extrato bancário", description: "Período que abranja os descontos ou pagamentos." },
      ],
      recommendedDocuments: [
        { category: "BENEFIT_STATEMENT", label: "Extrato de benefício", appliesTo: ["INDIVIDUAL"] },
        { category: "INCOME_PROOF", label: "Comprovante de renda" },
        { category: "POWER_OF_ATTORNEY", label: "Procuração" },
      ],
      fields: [
        { key: "instituicao", label: "Instituição financeira", type: "text", required: true },
        {
          key: "tipo_contrato",
          label: "Tipo de contrato",
          type: "select",
          required: true,
          options: [
            { value: "consignado", label: "Empréstimo consignado" },
            { value: "pessoal", label: "Crédito pessoal" },
            { value: "cartao_consignado", label: "Cartão de crédito consignado" },
            { value: "ccb", label: "Cédula de crédito bancário" },
            { value: "veiculo", label: "Financiamento de veículo" },
          ],
        },
        { key: "numero_contrato", label: "Número do contrato", type: "text", required: false },
        { key: "data_contratacao", label: "Data da contratação", type: "date", required: false },
        { key: "valor_contratado", label: "Valor contratado", type: "currency", required: false },
        { key: "parcela", label: "Valor da parcela", type: "currency", required: false },
        { key: "taxa_mensal", label: "Taxa de juros informada (% a.m.)", type: "number", required: false },
        {
          key: "relato",
          label: "Relato do cliente",
          type: "textarea",
          required: true,
          helpText: "Descreva o que o cliente relata sobre a contratação e os descontos.",
        },
      ],
      primaryAgentId: A.triagem,
      skillIds: [S.triagemContratos, S.conferenciaDocumental],
      thesisIds: [T.juros, T.descontoNaoContratado, T.tarifas, T.seguroPrestamista, T.portabilidade],
      active: true,
    },
    {
      ...o,
      id: TPL.consumidor,
      name: "Análise de Relação de Consumo",
      area: "CONSUMER",
      description: "Template em configuração para análises de consumo não bancárias. Disponível após a implantação da área.",
      requiredDocuments: [
        { category: "IDENTIFICATION", label: "Documento de identificação" },
        { category: "OTHER", label: "Comprovantes da relação de consumo" },
      ],
      recommendedDocuments: [],
      fields: [{ key: "relato", label: "Relato do cliente", type: "textarea", required: true }],
      primaryAgentId: A.triagem,
      skillIds: [],
      thesisIds: [T.superendividamento],
      active: false,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Tarefas recentes dos agentes                                        */
/* ------------------------------------------------------------------ */

export function buildAgentTasks(): AgentTask[] {
  const t = (id: string, agentId: string, title: string, status: AgentTask["status"], at: string, extra: Partial<AgentTask> = {}): AgentTask => ({
    ...o,
    id,
    agentId,
    title,
    status,
    at,
    ...extra,
  });
  return [
    t("tsk_01", A.triagem, "Análise bancária em execução — Marlene Aparecida Costa", "RUNNING", daysFromNowISO(0, 8, 50), { clientId: C.marlene }),
    t("tsk_02", A.prazos, "Nova intimação identificada — prazo de réplica proposto", "WAITING_REVIEW", daysFromNowISO(0, 7, 40), {
      processId: P.franciscoDeclaratoria,
      reviewId: R.prazoFrancisco,
    }),
    t("tsk_03", A.documentacao, "Mensagem de solicitação de documentos preparada — Clínica Vida Plena", "WAITING_REVIEW", daysFromNowISO(0, 9, 10), {
      clientId: C.clinica,
      reviewId: R.mensagemClinica,
    }),
    t("tsk_04", A.documentacao, "Checklist atualizado — Ana Cláudia Souza Lima", "COMPLETED", daysFromNowISO(0, 9, 5), { clientId: C.ana }),
    t("tsk_05", A.revisoes, "Movimentação resumida — Transportadora Via Sul", "WAITING_REVIEW", daysFromNowISO(-1, 11, 0), {
      processId: P.transportesCobranca,
      reviewId: R.movimentacaoTransportes,
    }),
    t("tsk_06", A.triagem, "Análise concluída — Roberto Carlos Menezes", "WAITING_REVIEW", daysFromNowISO(-2, 14, 0), {
      clientId: C.roberto,
      reviewId: R.analiseRoberto,
    }),
    t("tsk_07", A.documentacao, "Divergência entre contrato e extrato — Luiza Helena Barros", "BLOCKED", daysFromNowISO(-3, 10, 20), { clientId: C.luiza }),
    t("tsk_08", A.peticoes, "Minuta de inicial enviada para revisão — Helena Martins Ribeiro", "WAITING_REVIEW", daysFromNowISO(-4, 16, 30), {
      processId: P.helenaTarifas,
      reviewId: R.peticaoHelena,
    }),
    t("tsk_09", A.documentacao, "Extrato ilegível sinalizado — João Batista Ferreira", "WAITING_REVIEW", daysFromNowISO(-2, 11, 0), {
      clientId: C.joao,
      reviewId: R.documentosJoao,
    }),
    t("tsk_10", A.peticoes, "Minuta de manifestação revisada — Ferragens Horizonte", "COMPLETED", daysFromNowISO(-6, 15, 0), {
      processId: P.ferragensRevisional,
      reviewId: R.peticaoFerragens,
    }),
    t("tsk_11", A.prazos, "Sincronização de movimentações concluída (6 processos)", "COMPLETED", daysFromNowISO(0, 6, 0)),
    t("tsk_12", A.triagem, "Análise concluída — Helena Martins Ribeiro", "COMPLETED", daysFromNowISO(-22, 10, 0), {
      clientId: C.helena,
      reviewId: R.analiseHelena,
    }),
  ];
}

/* ------------------------------------------------------------------ */
/* Histórico de alterações do DG                                       */
/* ------------------------------------------------------------------ */

export function buildChangeHistory(): ChangeHistoryEntry[] {
  return [
    {
      ...o,
      id: "chg_01",
      at: daysFromNowISO(-10, 14, 51),
      requestedBy: U.barbara,
      originalRequest: "As petições bancárias estão citando referências que não estão nas nossas teses.",
      suggestedChange: "Restringir citações às referências cadastradas nas teses vigentes.",
      entityType: "SKILL",
      entityId: S.redacaoBancaria,
      entityName: "Redação Bancária",
      fromVersion: 2,
      toVersion: 3,
      responsible: "TUTOR_DG",
      status: "APPLIED",
      diff: [
        { type: "context", text: "Tom: Formal, objetivo, sem adjetivação excessiva" },
        { type: "removed", text: "Citações: Referências pertinentes ao caso" },
        { type: "added", text: "Citações: Somente referências cadastradas nas teses" },
      ],
      impact: "Afeta minutas produzidas pelo Agente de Petições.",
      affectedAgentIds: [A.peticoes],
    },
    {
      ...o,
      id: "chg_02",
      at: daysFromNowISO(-18, 9, 20),
      requestedBy: U.barbara,
      originalRequest: "O agente aceitou um comprovante de residência de seis meses atrás.",
      suggestedChange: "Definir validade de 90 dias para comprovante de residência.",
      entityType: "SKILL",
      entityId: S.conferenciaDocumental,
      entityName: "Conferência Documental",
      fromVersion: 1,
      toVersion: 2,
      responsible: "TUTOR_DG",
      status: "APPLIED",
      diff: [
        { type: "removed", text: "Validade do comprovante de residência: não verificada" },
        { type: "added", text: "Validade do comprovante de residência: 90 dias" },
      ],
      impact: "Afeta o checklist de todas as análises em andamento.",
      affectedAgentIds: [A.documentacao, A.triagem],
    },
    {
      ...o,
      id: "chg_03",
      at: daysFromNowISO(-5, 17, 5),
      requestedBy: U.barbara,
      originalRequest: "Quero que o agente de prazos avise com mais antecedência.",
      suggestedChange: "Aumentar a antecedência do alerta de 5 para 10 dias úteis.",
      entityType: "SKILL",
      entityId: S.contagemPrazos,
      entityName: "Contagem de Prazos Processuais",
      fromVersion: 3,
      toVersion: 4,
      responsible: "TUTOR_DG",
      status: "CANCELLED",
      diff: [
        { type: "removed", text: "Antecedência do alerta: 5 dias úteis" },
        { type: "added", text: "Antecedência do alerta: 10 dias úteis" },
      ],
      impact: "Aumentaria o volume de alertas para todos os advogados.",
      affectedAgentIds: [A.prazos],
    },
  ];
}
