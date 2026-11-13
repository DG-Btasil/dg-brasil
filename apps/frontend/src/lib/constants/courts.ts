/**
 * Tribunais do cadastro de processo. As siglas são as mesmas que a integração
 * judicial usa (índice do DataJud em maiúsculas: "tjsp" → "TJSP",
 * "tre-sp" → "TRE-SP") e passam na regra do calendário forense do sistema
 * (`^[A-Z0-9-]{2,15}$`), para o tribunal do processo casar com os feriados
 * cadastrados por tribunal. O campo do processo é texto livre no sistema:
 * processo importado com outro texto continua como está.
 */

/** UF → nome com a preposição ("do Rio de Janeiro"), na ordem alfabética das siglas. */
const UF_NAME: [string, string][] = [
  ["AC", "do Acre"],
  ["AL", "de Alagoas"],
  ["AP", "do Amapá"],
  ["AM", "do Amazonas"],
  ["BA", "da Bahia"],
  ["CE", "do Ceará"],
  ["DF", "do Distrito Federal"],
  ["ES", "do Espírito Santo"],
  ["GO", "de Goiás"],
  ["MA", "do Maranhão"],
  ["MT", "de Mato Grosso"],
  ["MS", "de Mato Grosso do Sul"],
  ["MG", "de Minas Gerais"],
  ["PA", "do Pará"],
  ["PB", "da Paraíba"],
  ["PR", "do Paraná"],
  ["PE", "de Pernambuco"],
  ["PI", "do Piauí"],
  ["RJ", "do Rio de Janeiro"],
  ["RN", "do Rio Grande do Norte"],
  ["RS", "do Rio Grande do Sul"],
  ["RO", "de Rondônia"],
  ["RR", "de Roraima"],
  ["SC", "de Santa Catarina"],
  ["SP", "de São Paulo"],
  ["SE", "de Sergipe"],
  ["TO", "do Tocantins"],
];

/** Estados de cada Tribunal Regional Federal. */
const TRF_STATES = ["AC, AM, AP, BA, DF, GO, MA, MT, PA, PI, RO, RR e TO", "RJ e ES", "SP e MS", "RS, SC e PR", "PE, AL, CE, PB, RN e SE", "MG"];

/** Estados (ou sede) de cada Tribunal Regional do Trabalho, da 1ª à 24ª Região. */
const TRT_STATES = [
  "RJ",
  "SP, capital e litoral",
  "MG",
  "RS",
  "BA",
  "PE",
  "CE",
  "PA e AP",
  "PR",
  "DF e TO",
  "AM e RR",
  "SC",
  "PB",
  "RO e AC",
  "SP, Campinas e interior",
  "MA",
  "ES",
  "GO",
  "AL",
  "SE",
  "RN",
  "PI",
  "MT",
  "MS",
];

export interface CourtOption {
  /** Sigla gravada no processo (ex.: "TJRJ"). */
  code: string;
  /** Nome por extenso, para a busca e a descrição. */
  name: string;
}

const STATE_COURTS: CourtOption[] = UF_NAME.map(([uf, name]) =>
  uf === "DF" ? { code: "TJDFT", name: "Tribunal de Justiça do Distrito Federal e dos Territórios" } : { code: `TJ${uf}`, name: `Tribunal de Justiça ${name}` },
);
const FEDERAL_COURTS: CourtOption[] = TRF_STATES.map((states, i) => ({ code: `TRF${i + 1}`, name: `Tribunal Regional Federal da ${i + 1}ª Região (${states})` }));
const LABOR_COURTS: CourtOption[] = TRT_STATES.map((states, i) => ({ code: `TRT${i + 1}`, name: `Tribunal Regional do Trabalho da ${i + 1}ª Região (${states})` }));
const SUPERIOR_COURTS: CourtOption[] = [
  { code: "STF", name: "Supremo Tribunal Federal" },
  { code: "STJ", name: "Superior Tribunal de Justiça" },
  { code: "TST", name: "Tribunal Superior do Trabalho" },
  { code: "TSE", name: "Tribunal Superior Eleitoral" },
  { code: "STM", name: "Superior Tribunal Militar" },
];
const ELECTORAL_COURTS: CourtOption[] = UF_NAME.map(([uf, name]) => ({ code: `TRE-${uf}`, name: `Tribunal Regional Eleitoral ${name}` }));
const MILITARY_STATE_COURTS: CourtOption[] = [
  { code: "TJMMG", name: "Tribunal de Justiça Militar de Minas Gerais" },
  { code: "TJMRS", name: "Tribunal de Justiça Militar do Rio Grande do Sul" },
  { code: "TJMSP", name: "Tribunal de Justiça Militar de São Paulo" },
];

/** Estaduais, federais, do trabalho, superiores, eleitorais e militares estaduais. */
export const COURT_OPTIONS: readonly CourtOption[] = [...STATE_COURTS, ...FEDERAL_COURTS, ...LABOR_COURTS, ...SUPERIOR_COURTS, ...ELECTORAL_COURTS, ...MILITARY_STATE_COURTS];

/** Siglas, na ordem da lista (filtros e formulários). */
export const COURTS: readonly string[] = COURT_OPTIONS.map((c) => c.code);

const NAME_BY_CODE = new Map(COURT_OPTIONS.map((c) => [c.code, c.name]));

/** Nome por extenso da sigla; texto fora da lista (processo importado) não tem. */
export function courtName(code: string | undefined): string | undefined {
  return code ? NAME_BY_CODE.get(code) : undefined;
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Busca do campo "Tribunal": por sigla ("tjrj", "trt 1", "tre-sp") ou por
 * nome ("rio de janeiro", "trabalho 15", "eleitoral"). Sem acento e sem
 * diferenciar maiúsculas. Sigla que começa com o texto vem primeiro.
 */
export function searchCourts(query: string, limit = 30): CourtOption[] {
  const q = fold(query);
  if (!q) return COURT_OPTIONS.slice(0, limit);
  const compact = q.replace(/ /g, "");
  const words = q.split(" ");
  const starts: CourtOption[] = [];
  const contains: CourtOption[] = [];
  for (const court of COURT_OPTIONS) {
    const code = fold(court.code).replace(/ /g, "");
    if (code.startsWith(compact)) starts.push(court);
    else {
      const text = `${fold(court.code)} ${fold(court.name)}`;
      if (words.every((w) => text.includes(w))) contains.push(court);
    }
  }
  return [...starts, ...contains].slice(0, limit);
}
