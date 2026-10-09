import type { LegalDocumentType } from "./types";

/**
 * Documentos legais exigidos e a versão VIGENTE de cada um. Fonte única: a
 * aplicação inteira pergunta aqui. Nova versão (mudar `version`) = novo aceite
 * obrigatório para todos no próximo acesso (user_legal_acceptances é
 * append-only e guarda a versão aceita).
 *
 * ATENÇÃO: os textos abaixo são PROVISÓRIOS, apenas para o fluxo funcionar.
 * Não foram aprovados pela Dra. Bárbara Cardoso e precisam ser substituídos
 * pelos documentos jurídicos definitivos antes da produção.
 */
export interface LegalDocument {
  type: LegalDocumentType;
  version: string;
  title: string;
  provisional: boolean;
  paragraphs: string[];
}

const AVISO = "Documento jurídico provisório — revisar antes da produção.";

export const LEGAL_DOCUMENTS: readonly LegalDocument[] = [
  {
    type: "TERMS_OF_USE",
    version: "0.1-provisorio",
    title: "Termos de Uso do DG Brasil",
    provisional: true,
    paragraphs: [
      AVISO,
      "O DG Brasil é o sistema interno da Bárbara Cardoso Advocacia e dos escritórios parceiros autorizados. O acesso é pessoal e intransferível.",
      "Você se compromete a usar o sistema apenas para as atividades do seu vínculo profissional e a manter sua senha e seu segundo fator de autenticação em sigilo.",
    ],
  },
  {
    type: "PRIVACY_POLICY",
    version: "0.1-provisorio",
    title: "Política de Privacidade (LGPD)",
    provisional: true,
    paragraphs: [
      AVISO,
      "O sistema trata dados pessoais de clientes, partes e usuários para a prestação de serviços jurídicos. Acessos a dados sensíveis ficam registrados.",
      "Os direitos dos titulares previstos na Lei 13.709/2018 serão atendidos conforme o documento definitivo.",
    ],
  },
  {
    type: "CONFIDENTIALITY",
    version: "0.1-provisorio",
    title: "Termo de Confidencialidade",
    provisional: true,
    paragraphs: [
      AVISO,
      "As informações de clientes, casos, processos e documentos acessadas no DG Brasil são sigilosas e protegidas pelo sigilo profissional.",
      "Você se compromete a não divulgar nem copiar essas informações fora das finalidades do seu trabalho.",
    ],
  },
];

export function currentLegalVersion(type: LegalDocumentType): string {
  const doc = LEGAL_DOCUMENTS.find((d) => d.type === type);
  if (!doc) throw new Error(`Documento legal desconhecido: ${type}`);
  return doc.version;
}

/** Documentos cuja versão vigente ainda não foi aceita. */
export function pendingLegalDocuments(
  accepted: readonly { document_type: string; document_version: string }[],
): LegalDocumentType[] {
  return LEGAL_DOCUMENTS.filter(
    (doc) => !accepted.some((a) => a.document_type === doc.type && a.document_version === doc.version),
  ).map((doc) => doc.type);
}
