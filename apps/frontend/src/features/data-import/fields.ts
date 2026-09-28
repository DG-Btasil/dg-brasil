/**
 * Campos do DG Brasil que podem receber colunas de uma planilha.
 * `synonyms` alimenta a SUGESTÃO automática de mapeamento no protótipo.
 * No backend, a sugestão poderá usar IA sobre cabeçalhos e amostras; o
 * usuário sempre confirma o mapeamento antes de importar.
 */

export const IMPORT_FIELD_KEYS = [
  "client.name",
  "client.document",
  "client.kind",
  "client.email",
  "client.phone",
  "client.street",
  "client.number",
  "client.district",
  "client.city",
  "client.state",
  "client.zipCode",
  "process.cnj",
  "process.title",
  "process.actionType",
  "process.court",
  "process.opposingParty",
  "process.responsible",
  "process.dueDate",
  "process.distributionDate",
  "process.status",
  "process.caseValue",
  "finance.fee",
] as const;
export type ImportFieldKey = (typeof IMPORT_FIELD_KEYS)[number];

export type ImportEntity = "client" | "process" | "finance";

export const IMPORT_ENTITY_LABEL: Record<ImportEntity, string> = {
  client: "Cliente",
  process: "Processo",
  finance: "Financeiro",
};

export interface ImportField {
  key: ImportFieldKey;
  entity: ImportEntity;
  label: string;
  synonyms: string[];
}

export const IMPORT_FIELDS: ImportField[] = [
  { key: "client.name", entity: "client", label: "Nome", synonyms: ["nome", "nome completo", "cliente", "nome do cliente", "razao social", "nome/razao social"] },
  { key: "client.document", entity: "client", label: "CPF/CNPJ", synonyms: ["cpf", "cnpj", "cpf/cnpj", "documento", "cpf cnpj"] },
  { key: "client.kind", entity: "client", label: "Tipo de pessoa (PF/PJ)", synonyms: ["tipo", "tipo de pessoa", "pessoa", "pf/pj"] },
  { key: "client.email", entity: "client", label: "E-mail", synonyms: ["email", "e-mail", "correio eletronico"] },
  { key: "client.phone", entity: "client", label: "Telefone", synonyms: ["telefone", "celular", "fone", "whatsapp", "contato"] },
  { key: "client.street", entity: "client", label: "Endereço (logradouro)", synonyms: ["endereco", "logradouro", "rua"] },
  { key: "client.number", entity: "client", label: "Número do endereço", synonyms: ["numero", "n", "nº"] },
  { key: "client.district", entity: "client", label: "Bairro", synonyms: ["bairro"] },
  { key: "client.city", entity: "client", label: "Cidade", synonyms: ["cidade", "municipio"] },
  { key: "client.state", entity: "client", label: "UF", synonyms: ["uf", "estado"] },
  { key: "client.zipCode", entity: "client", label: "CEP", synonyms: ["cep"] },
  { key: "process.cnj", entity: "process", label: "Número CNJ", synonyms: ["cnj", "numero cnj", "processo", "n processo", "nº processo", "numero do processo", "no processo"] },
  { key: "process.title", entity: "process", label: "Nome resumido", synonyms: ["titulo", "nome do processo", "caso"] },
  { key: "process.actionType", entity: "process", label: "Tipo de ação", synonyms: ["acao", "tipo de acao", "classe", "tipo da acao"] },
  { key: "process.court", entity: "process", label: "Tribunal", synonyms: ["tribunal", "orgao", "foro"] },
  { key: "process.opposingParty", entity: "process", label: "Parte contrária", synonyms: ["parte contraria", "reu", "requerido", "parte adversa"] },
  { key: "process.responsible", entity: "process", label: "Responsável", synonyms: ["responsavel", "advogado", "advogado responsavel"] },
  { key: "process.dueDate", entity: "process", label: "Data de vencimento", synonyms: ["vencimento", "prazo", "data de vencimento", "proximo prazo"] },
  { key: "process.distributionDate", entity: "process", label: "Data de distribuição", synonyms: ["distribuicao", "data de distribuicao", "data"] },
  { key: "process.status", entity: "process", label: "Status", synonyms: ["status", "situacao", "andamento"] },
  { key: "process.caseValue", entity: "process", label: "Valor da causa", synonyms: ["valor da causa", "valor"] },
  { key: "finance.fee", entity: "finance", label: "Honorários (referência)", synonyms: ["honorarios", "valor de honorarios", "honorario"] },
];

export const FIELD_BY_KEY = new Map(IMPORT_FIELDS.map((f) => [f.key, f]));

/** "Cliente → Nome". */
export function fieldLabel(key: ImportFieldKey): string {
  const f = FIELD_BY_KEY.get(key);
  return f ? `${IMPORT_ENTITY_LABEL[f.entity]} → ${f.label}` : key;
}

export function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[._]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Sugestão de mapeamento por cabeçalho. Nunca mapeia o mesmo campo duas vezes. */
export function suggestMapping(headers: string[]): Record<string, ImportFieldKey | ""> {
  const used = new Set<ImportFieldKey>();
  const result: Record<string, ImportFieldKey | ""> = {};
  for (const header of headers) {
    const h = normalizeHeader(header);
    const match = IMPORT_FIELDS.find((f) => !used.has(f.key) && f.synonyms.some((s) => normalizeHeader(s) === h));
    result[header] = match?.key ?? "";
    if (match) used.add(match.key);
  }
  return result;
}
