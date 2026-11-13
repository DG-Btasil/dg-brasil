import "server-only";

/**
 * Preenchimento automático do cadastro (Roadmap 2.0, bloco 6):
 *   - CEP  → endereço (ViaCEP; reserva: BrasilAPI). Gratuitos.
 *   - CNPJ → dados da empresa (BrasilAPI; reserva: minhareceita.org). Gratuitos.
 *   - CPF  → com CPF e data de nascimento, nome, nome social e situação na
 *            Receita Federal pela API Consulta CPF v3 do Serpro (PAGA por
 *            consulta; só em produção). Sem chaves, a consulta diz "não
 *            configurada" e nada é preenchido.
 *
 * Tudo pelo SERVIDOR: o navegador não fala com essas APIs, a chave do Serpro
 * nunca sai daqui, e o documento consultado não vai para log nem banco (só o
 * que a pessoa salvar no cadastro).
 */

const TIMEOUT_MS = 6000;

async function getJson(url: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, cache: "no-store", headers: { Accept: "application/json", ...(init.headers ?? {}) } });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const digits = (v: string) => v.replace(/\D/g, "");
/** "BRASILIA" → "Brasilia"; mantém preposições minúsculas ("São Paulo", "Rio de Janeiro"). */
export function titleCase(v: string | undefined): string | undefined {
  if (!v) return v;
  if (v !== v.toUpperCase()) return v;
  return v
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && ["de", "da", "do", "das", "dos", "e"].includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/* ------------------------------------------------------------------ */
/* CEP                                                                 */
/* ------------------------------------------------------------------ */

export interface AddressLookup {
  zipCode: string;
  street?: string;
  district?: string;
  city?: string;
  state?: string;
  complement?: string;
}

export async function lookupCep(cep: string): Promise<AddressLookup | null> {
  const d = digits(cep);
  if (d.length !== 8) return null;
  try {
    const via = await getJson(`https://viacep.com.br/ws/${d}/json/`);
    const b = via.body as Record<string, unknown> | null;
    if (via.status === 200 && b && !b.erro) {
      return { zipCode: d, street: str(b.logradouro), district: str(b.bairro), city: str(b.localidade), state: str(b.uf) };
    }
    if (via.status === 200 && b?.erro) return null;
  } catch {
    // cai para a reserva
  }
  try {
    const br = await getJson(`https://brasilapi.com.br/api/cep/v2/${d}`);
    const b = br.body as Record<string, unknown> | null;
    if (br.status === 200 && b) return { zipCode: d, street: str(b.street), district: str(b.neighborhood), city: str(b.city), state: str(b.state) };
    if (br.status === 404) return null;
  } catch {
    // sem resposta das duas
  }
  throw new Error("CEP_UNAVAILABLE");
}

/* ------------------------------------------------------------------ */
/* CNPJ                                                                */
/* ------------------------------------------------------------------ */

export interface CompanyLookup {
  cnpj: string;
  legalName?: string;
  tradeName?: string;
  openingDate?: string;
  legalNature?: string;
  email?: string;
  phone?: string;
  /** Situação na Receita (ex.: "ATIVA") — só para avisar; não é gravada. */
  registrationStatus?: string;
  address?: AddressLookup & { number?: string };
}

function companyFrom(b: Record<string, unknown>, cnpj: string): CompanyLookup {
  const cep = str(b.cep) ? digits(String(b.cep)) : undefined;
  const tipo = str(b.descricao_tipo_de_logradouro);
  const logradouro = str(b.logradouro);
  return {
    cnpj,
    legalName: str(b.razao_social),
    tradeName: str(b.nome_fantasia),
    openingDate: str(b.data_inicio_atividade),
    legalNature: str(b.natureza_juridica) ?? str(b.descricao_natureza_juridica),
    email: str(b.email)?.toLowerCase(),
    phone: str(b.ddd_telefone_1) ? digits(String(b.ddd_telefone_1)) : undefined,
    registrationStatus: str(b.descricao_situacao_cadastral),
    address: cep
      ? {
          zipCode: cep,
          street: titleCase(logradouro && tipo && !logradouro.toUpperCase().startsWith(tipo.toUpperCase()) ? `${tipo} ${logradouro}` : logradouro),
          number: str(b.numero),
          complement: titleCase(str(b.complemento)),
          district: titleCase(str(b.bairro)),
          city: titleCase(str(b.municipio)),
          state: str(b.uf),
        }
      : undefined,
  };
}

export async function lookupCnpj(cnpj: string): Promise<CompanyLookup | null> {
  const d = digits(cnpj);
  if (d.length !== 14) return null;
  for (const url of [`https://brasilapi.com.br/api/cnpj/v1/${d}`, `https://minhareceita.org/${d}`]) {
    try {
      const r = await getJson(url);
      if (r.status === 200 && r.body && typeof r.body === "object") return companyFrom(r.body as Record<string, unknown>, d);
      if (r.status === 404) return null;
    } catch {
      // tenta a próxima
    }
  }
  throw new Error("CNPJ_UNAVAILABLE");
}

/* ------------------------------------------------------------------ */
/* CPF (Serpro — Consulta CPF v3)                                      */
/* ------------------------------------------------------------------ */
/*
 * v3 (desde 29/05/2026; v1 e v2 desativadas em 02/10/2026): a Receita confere
 * CPF E data de nascimento juntos (/cpf/{ni}/{DDMMAAAA}) e devolve nome, nome
 * social e situação. Não existe ambiente de teste no endereço de produção:
 * toda chamada lá é cobrada (200, 206 e 404). Por isso:
 *   - as chaves pagas só valem com DG_ENV=production;
 *   - fora da produção, só a demonstração do Serpro (SERPRO_CPF_TRIAL=1 e o
 *     token de demonstração em SERPRO_CPF_TRIAL_TOKEN), que usa dados fictícios.
 *   - em produção (DG_ENV=production) a demonstração é IGNORADA, mesmo que as
 *     variáveis dela tenham ficado por engano: senão ela venceria as chaves
 *     pagas e o cadastro real receberia os dados fictícios do Serpro.
 * Documentação: https://apicenter.estaleiro.serpro.gov.br/documentacao/consulta-cpf/pt/
 */

export interface PersonLookup {
  cpf: string;
  fullName?: string;
  /** Nome social, quando a pessoa tem um registrado na Receita. */
  socialName?: string;
  /** YYYY-MM-DD */
  birthDate?: string;
  /** Situação na Receita (ex.: "Regular") — só para avisar. */
  status?: string;
}

/** A data de nascimento informada não confere com a da Receita (resposta da v3). */
export class CpfBirthMismatch extends Error {
  constructor() {
    super("CPF_BIRTH_MISMATCH");
  }
}

const SERPRO_TRIAL_BASE = "https://gateway.apiserpro.serpro.gov.br/consulta-cpf-df-trial/v3";
const SERPRO_BASE = "https://gateway.apiserpro.serpro.gov.br/consulta-cpf-df/v3";
const SERPRO_TOKEN_URL = "https://gateway.apiserpro.serpro.gov.br/token";

let cachedToken: { value: string; expiresAt: number } | null = null;

const production = () => process.env.DG_ENV === "production";
/** Demonstração do Serpro (dados fictícios): nunca em produção. */
const trialOn = () => !production() && process.env.SERPRO_CPF_TRIAL === "1" && !!process.env.SERPRO_CPF_TRIAL_TOKEN;
/** Chaves pagas só em produção: nos testes (DEV) nenhuma consulta é cobrada. */
const paidOn = () => production() && !!process.env.SERPRO_CPF_CONSUMER_KEY && !!process.env.SERPRO_CPF_CONSUMER_SECRET;

export function cpfLookupConfigured(): boolean {
  return trialOn() || paidOn();
}

async function serproToken(): Promise<{ base: string; token: string }> {
  if (trialOn()) return { base: SERPRO_TRIAL_BASE, token: process.env.SERPRO_CPF_TRIAL_TOKEN as string };
  if (!paidOn()) throw new Error("CPF_NOT_CONFIGURED");
  const base = process.env.SERPRO_CPF_BASE_URL || SERPRO_BASE;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return { base, token: cachedToken.value };
  const basic = Buffer.from(`${process.env.SERPRO_CPF_CONSUMER_KEY}:${process.env.SERPRO_CPF_CONSUMER_SECRET}`).toString("base64");
  const r = await getJson(SERPRO_TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const b = r.body as { access_token?: string; expires_in?: number } | null;
  if (r.status !== 200 || !b?.access_token) throw new Error("CPF_AUTH_FAILED");
  cachedToken = { value: b.access_token, expiresAt: Date.now() + (b.expires_in ?? 3000) * 1000 };
  return { base, token: b.access_token };
}

/** "14111970" → "1970-11-14". */
function birthFromSerpro(v: string | undefined): string | undefined {
  if (!v || !/^\d{8}$/.test(v)) return undefined;
  return `${v.slice(4, 8)}-${v.slice(2, 4)}-${v.slice(0, 2)}`;
}

/** "1970-11-14" → "14111970" (formato do caminho da v3). */
function birthToSerpro(v: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? `${m[3]}${m[2]}${m[1]}` : null;
}

/**
 * Respostas da Receita guardadas por 10 minutos (memória desta instância do
 * servidor): o mesmo CPF e nascimento digitados de novo (portal e depois o
 * cadastro, ou o formulário reaberto) não pagam outra consulta. Guarda também
 * o "não encontrado", que também é cobrado.
 */
const CPF_CACHE_MS = 10 * 60_000;
const CPF_CACHE_MAX = 500;
const cpfCache = new Map<string, { value: PersonLookup | null | "MISMATCH"; expiresAt: number }>();

export function clearCpfCache() {
  cpfCache.clear();
  cachedToken = null;
}

export async function lookupCpf(cpf: string, birthDate: string): Promise<PersonLookup | null> {
  const d = digits(cpf);
  const nasc = birthToSerpro(birthDate);
  if (d.length !== 11 || !nasc) return null;
  const key = `${d}:${nasc}`;
  const cached = cpfCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.value === "MISMATCH") throw new CpfBirthMismatch();
    return cached.value;
  }
  let value: PersonLookup | null | "MISMATCH";
  try {
    value = await lookupCpfAtReceita(d, nasc);
  } catch (e) {
    if (!(e instanceof CpfBirthMismatch)) throw e;
    value = "MISMATCH";
  }
  if (cpfCache.size >= CPF_CACHE_MAX) cpfCache.delete(cpfCache.keys().next().value as string);
  cpfCache.set(key, { value, expiresAt: Date.now() + CPF_CACHE_MS });
  if (value === "MISMATCH") throw new CpfBirthMismatch();
  return value;
}

async function lookupCpfAtReceita(d: string, nasc: string): Promise<PersonLookup | null> {
  const { base, token } = await serproToken();
  const r = await getJson(`${base}/cpf/${d}/${nasc}`, { headers: { Authorization: `Bearer ${token}` } });
  const b = r.body as {
    nome?: string; nomeSocial?: string; nascimento?: string; situacao?: { descricao?: string }; erro?: string;
  } | null;
  if (b?.erro === "DATA_NASCIMENTO_DIVERGENTE") throw new CpfBirthMismatch();
  if (r.status === 404 || b?.erro === "CPF_INEXISTENTE") return null;
  if (r.status === 401 || r.status === 403) {
    cachedToken = null;
    throw new Error("CPF_AUTH_FAILED");
  }
  if ((r.status !== 200 && r.status !== 206) || !b) throw new Error(r.status === 410 ? "CPF_VERSION_GONE" : "CPF_UNAVAILABLE");
  return {
    cpf: d,
    fullName: titleCase(str(b.nome)),
    socialName: titleCase(str(b.nomeSocial)),
    birthDate: birthFromSerpro(str(b.nascimento)),
    status: str(b.situacao?.descricao),
  };
}
