/**
 * Campos do DG Brasil que podem receber colunas de uma planilha (Etapa 7).
 *
 * Lista canônica, usada pela tela (mapeamento e sugestão) e pelo servidor
 * (validação). O banco tem a mesma lista em `private.import_target_fields()`
 * (migration 042) e recusa qualquer outro destino — um teste confere que as
 * duas listas são iguais.
 *
 * `synonyms` alimenta a SUGESTÃO automática pelo cabeçalho; a pessoa sempre
 * confere e confirma o mapeamento antes da simulação.
 */

export const IMPORT_FIELD_KEYS = [
  "client.name",
  "client.document",
  "client.kind",
  "client.email",
  "client.phone",
  "client.zipCode",
  "client.street",
  "client.number",
  "client.complement",
  "client.district",
  "client.city",
  "client.state",
  "client.notes",
  "process.cnj",
  "process.title",
  "process.actionType",
  "process.subject",
  "process.court",
  "process.courtUnit",
  "process.district",
  "process.state",
  "process.opposingParty",
  "process.clientSide",
  "process.responsible",
  "process.status",
  "process.distributionDate",
  "process.caseValue",
  "process.dueDate",
  "process.notes",
] as const;
export type ImportFieldKey = (typeof IMPORT_FIELD_KEYS)[number];

export type ImportEntity = "client" | "process";

export const IMPORT_ENTITY_LABEL: Record<ImportEntity, string> = {
  client: "Cliente",
  process: "Processo",
};

export interface ImportField {
  key: ImportFieldKey;
  entity: ImportEntity;
  label: string;
  /** Explicação curta exibida no mapeamento. */
  hint?: string;
  required?: boolean;
  synonyms: string[];
}

export const IMPORT_FIELDS: ImportField[] = [
  { key: "client.name", entity: "client", label: "Nome / razão social", required: true, synonyms: ["nome", "nome completo", "cliente", "nome do cliente", "razao social", "nome razao social", "nome/razao social", "contato", "nome do contato"] },
  { key: "client.document", entity: "client", label: "CPF/CNPJ", hint: "11 dígitos = pessoa física; 14 = jurídica. Sem ele, o processo é ligado ao cliente já cadastrado com o mesmo nome.", synonyms: ["cpf", "cnpj", "cpf/cnpj", "cpf cnpj", "documento", "cpf do cliente", "identificacao", "cpf ou cnpj"] },
  { key: "client.kind", entity: "client", label: "Tipo de pessoa (PF/PJ)", hint: "Opcional: o tipo sai do CPF/CNPJ.", synonyms: ["tipo", "tipo de pessoa", "pessoa", "pf/pj", "pf pj", "tipo pessoa"] },
  { key: "client.email", entity: "client", label: "E-mail", synonyms: ["email", "e-mail", "e mail", "correio eletronico", "email do cliente"] },
  { key: "client.phone", entity: "client", label: "Telefone", synonyms: ["telefone", "celular", "fone", "whatsapp", "telefone celular", "tel", "telefone 1"] },
  { key: "client.zipCode", entity: "client", label: "CEP", synonyms: ["cep"] },
  { key: "client.street", entity: "client", label: "Endereço (logradouro)", synonyms: ["endereco", "logradouro", "rua", "endereco completo"] },
  { key: "client.number", entity: "client", label: "Número do endereço", synonyms: ["numero", "n", "nº", "no", "num"] },
  { key: "client.complement", entity: "client", label: "Complemento", synonyms: ["complemento", "compl"] },
  { key: "client.district", entity: "client", label: "Bairro", synonyms: ["bairro"] },
  { key: "client.city", entity: "client", label: "Cidade", synonyms: ["cidade", "municipio", "cidade do cliente"] },
  { key: "client.state", entity: "client", label: "UF", synonyms: ["uf", "estado", "uf do cliente"] },
  { key: "client.notes", entity: "client", label: "Observações do cliente (internas)", synonyms: ["observacoes", "observacao", "obs", "anotacoes", "observacoes do cliente"] },
  { key: "process.cnj", entity: "process", label: "Número CNJ", hint: "20 dígitos; o dígito verificador é conferido.", synonyms: ["cnj", "numero cnj", "processo", "n processo", "nº processo", "numero do processo", "no processo", "numero processo", "n do processo", "nº do processo", "autos", "numero dos autos"] },
  { key: "process.title", entity: "process", label: "Nome resumido do processo", synonyms: ["titulo", "nome do processo", "caso", "titulo do processo", "nome do caso"] },
  { key: "process.actionType", entity: "process", label: "Tipo de ação / classe", synonyms: ["acao", "tipo de acao", "classe", "tipo da acao", "classe processual", "natureza", "tipo de processo"] },
  { key: "process.subject", entity: "process", label: "Assunto", synonyms: ["assunto", "objeto"] },
  { key: "process.court", entity: "process", label: "Tribunal", synonyms: ["tribunal", "orgao", "foro", "justica"] },
  { key: "process.courtUnit", entity: "process", label: "Vara / órgão julgador", synonyms: ["vara", "orgao julgador", "juizo", "vara/juizo", "unidade"] },
  { key: "process.district", entity: "process", label: "Comarca", synonyms: ["comarca", "cidade do processo"] },
  { key: "process.state", entity: "process", label: "UF do processo", synonyms: ["uf do processo", "estado do processo"] },
  { key: "process.opposingParty", entity: "process", label: "Parte contrária", synonyms: ["parte contraria", "reu", "requerido", "parte adversa", "banco", "adverso", "parte re", "contrario"] },
  { key: "process.clientSide", entity: "process", label: "Polo do cliente", hint: "Autor/ativo, réu/passivo ou terceiro. Vazio = autor.", synonyms: ["polo", "polo do cliente", "posicao do cliente", "polo ativo/passivo"] },
  { key: "process.responsible", entity: "process", label: "Responsável", hint: "Nome de alguém da equipe. Vale para o processo e para o cliente novo.", synonyms: ["responsavel", "advogado", "advogado responsavel", "responsavel pelo processo"] },
  { key: "process.status", entity: "process", label: "Status do processo", synonyms: ["status", "situacao", "andamento", "fase", "situacao do processo"] },
  { key: "process.distributionDate", entity: "process", label: "Data de distribuição", synonyms: ["distribuicao", "data de distribuicao", "data distribuicao", "ajuizamento", "data de ajuizamento"] },
  { key: "process.caseValue", entity: "process", label: "Valor da causa", synonyms: ["valor da causa", "valor", "valor causa", "valor da causa r$", "expectativa/valor da causa r$", "expectiva/valor da causa r$"] },
  { key: "process.dueDate", entity: "process", label: "Próximo vencimento (vira prazo)", hint: "Só em processo novo e com data de hoje em diante.", synonyms: ["vencimento", "prazo", "data de vencimento", "proximo prazo", "data do prazo", "prazo fatal"] },
  { key: "process.notes", entity: "process", label: "Observações do processo (internas)", synonyms: ["observacoes do processo", "notas", "notas do processo", "anotacoes do processo", "anotacoes gerais"] },
];

export const FIELD_BY_KEY = new Map(IMPORT_FIELDS.map((f) => [f.key, f]));

export function isImportFieldKey(value: string): value is ImportFieldKey {
  return FIELD_BY_KEY.has(value as ImportFieldKey);
}

/** "Cliente → Nome". */
export function fieldLabel(key: ImportFieldKey): string {
  const f = FIELD_BY_KEY.get(key);
  return f ? `${IMPORT_ENTITY_LABEL[f.entity]} → ${f.label}` : key;
}

/** Texto comparável: sem acento, minúsculo, pontuação vira espaço. */
export function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9º/]+/g, " ")
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

/** Algum campo de processo (fora "Responsável", que também vale para o cliente) foi mapeado? */
export function mapsProcess(targets: Iterable<string>): boolean {
  for (const t of targets) if (t.startsWith("process.") && t !== "process.responsible") return true;
  return false;
}
