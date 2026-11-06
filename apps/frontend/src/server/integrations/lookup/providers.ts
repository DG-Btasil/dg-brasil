import "server-only";

/**
 * Preenchimento automático do cadastro (Roadmap 2.0, bloco 6):
 *   - CEP  → endereço (ViaCEP; reserva: BrasilAPI). Gratuitos.
 *   - CNPJ → dados da empresa (BrasilAPI; reserva: minhareceita.org). Gratuitos.
 *   - CPF  → nome e nascimento na Receita Federal pela API Consulta CPF do
 *            Serpro (PAGA por consulta; o escritório contrata e põe as chaves).
 *            Sem chaves, a consulta diz "não configurada" e nada é preenchido.
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
/* CPF (Serpro — Consulta CPF)                                         */
/* ------------------------------------------------------------------ */

export interface PersonLookup {
  cpf: string;
  fullName?: string;
  /** YYYY-MM-DD */
  birthDate?: string;
  /** Situação na Receita (ex.: "Regular") — só para avisar. */
  status?: string;
}

/** Demonstração pública do Serpro (só CPFs de teste). Útil para validar a integração sem contrato. */
const SERPRO_TRIAL = { base: "https://gateway.apiserpro.serpro.gov.br/consulta-cpf-df-trial/v1", token: "06aef429-a981-3ec5-a1f8-71d38d86481e" };
const SERPRO_TOKEN_URL = "https://gateway.apiserpro.serpro.gov.br/token";

let cachedToken: { value: string; expiresAt: number } | null = null;

export function cpfLookupConfigured(): boolean {
  return process.env.SERPRO_CPF_TRIAL === "1" || (!!process.env.SERPRO_CPF_CONSUMER_KEY && !!process.env.SERPRO_CPF_CONSUMER_SECRET);
}

async function serproToken(): Promise<{ base: string; token: string }> {
  if (process.env.SERPRO_CPF_TRIAL === "1") return SERPRO_TRIAL;
  const base = process.env.SERPRO_CPF_BASE_URL || "https://gateway.apiserpro.serpro.gov.br/consulta-cpf-df/v1";
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

export async function lookupCpf(cpf: string): Promise<PersonLookup | null> {
  const d = digits(cpf);
  if (d.length !== 11) return null;
  const { base, token } = await serproToken();
  const r = await getJson(`${base}/cpf/${d}`, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 404) return null;
  if (r.status === 401 || r.status === 403) {
    cachedToken = null;
    throw new Error("CPF_AUTH_FAILED");
  }
  const b = r.body as { nome?: string; nascimento?: string; situacao?: { descricao?: string } } | null;
  if (r.status !== 200 || !b) throw new Error("CPF_UNAVAILABLE");
  return { cpf: d, fullName: titleCase(str(b.nome)), birthDate: birthFromSerpro(str(b.nascimento)), status: str(b.situacao?.descricao) };
}
