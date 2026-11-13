import { courtFromAlias, datajudAlias, parseDatajudDate, sha256 } from "./text";

/**
 * DataJud — API pública do CNJ (Elasticsearch).
 * POST https://api-publica.datajud.cnj.jus.br/api_publica_<alias>/_search
 * Authorization: APIKey <chave pública da wiki do CNJ>
 *
 * Fatos conferidos em 2026-11-03:
 *  - um número CNJ devolve VÁRIOS documentos (um por grau: G1, G2, JE, TR…, e
 *    às vezes documentos antigos sem movimentos). `_id` é estável por documento;
 *  - movimento não tem id: a chave contra duplicata é o hash de (documento,
 *    código, data/hora, complementos ordenados, órgão). Movimentos idênticos
 *    repetidos no mesmo documento contam uma vez;
 *  - a cópia pública atrasa de 1 a 3 semanas: quem traz a intimação a tempo é o
 *    DJEN; o DataJud completa o histórico;
 *  - termos de uso: até 120 requisições/min, uso não comercial; a chave pode
 *    mudar a qualquer momento (DATAJUD_API_KEY sobrepõe a padrão).
 */

export const DATAJUD_BASE = "https://api-publica.datajud.cnj.jus.br";
export const DATAJUD_PUBLIC_KEY = "cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==";

export interface DatajudMovement {
  external_id: string;
  occurred_at: string;
  code: number | null;
  name: string;
  description: string;
  grau: string | null;
}

export interface DatajudMeta {
  alias: string;
  court: string;
  court_unit: string | null;
  legal_class: string | null;
  subject: string | null;
  distribution_date: string | null;
  graus: string[];
  source_updated_at: string | null;
}

export type DatajudResult =
  | { kind: "ok"; meta: DatajudMeta; movements: DatajudMovement[] }
  | { kind: "not_found" | "unsupported"; message: string };

export class DatajudError extends Error {
  /**
   * transient: falha passageira (tempo esgotado, 429, 5xx, rede): o banco tenta
   * de novo em 1 h. outOfTime: nem começou, faltou tempo na rodada.
   */
  constructor(message: string, readonly transient = false, readonly outOfTime = false) {
    super(message);
    this.name = "DatajudError";
  }
}

type Src = Record<string, unknown>;
type Hit = { _id?: string; _source?: Src };
const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Src) : {});
const GRAU_ORDER: Record<string, number> = { G1: 1, JE: 1, TR: 2, G2: 2, SUP: 3 };

/** Documentos do DataJud de um processo → dados e movimentos para o banco. */
export function normalizeDatajud(alias: string, cnj: string, hits: Hit[]): DatajudResult {
  const docs = hits
    .map((h) => ({ id: s(h._id) ?? s(obj(h._source).id) ?? "", src: obj(h._source) }))
    .filter((d) => d.id && String(d.src.numeroProcesso ?? "") === cnj);
  if (!docs.length) return { kind: "not_found", message: "Processo ainda não aparece no DataJud (a cópia pública atrasa semanas)." };

  // Documento principal para os dados: o de menor grau com movimentos.
  const withMov = docs.filter((d) => Array.isArray(d.src.movimentos) && (d.src.movimentos as unknown[]).length);
  const main = [...(withMov.length ? withMov : docs)].sort(
    (a, b) => (GRAU_ORDER[String(a.src.grau)] ?? 9) - (GRAU_ORDER[String(b.src.grau)] ?? 9),
  )[0];
  const assuntos = Array.isArray(main.src.assuntos) ? (main.src.assuntos as unknown[]).map((a) => s(obj(a).nome)).filter(Boolean) : [];
  const distribution = docs.map((d) => parseDatajudDate(d.src.dataAjuizamento)).filter((x): x is string => !!x).sort()[0] ?? null;
  const updated = docs.map((d) => s(d.src.dataHoraUltimaAtualizacao)).filter((x): x is string => !!x).sort().at(-1) ?? null;

  const meta: DatajudMeta = {
    alias,
    court: courtFromAlias(alias),
    court_unit: s(obj(main.src.orgaoJulgador).nome)?.slice(0, 300) ?? null,
    legal_class: s(obj(main.src.classe).nome)?.slice(0, 300) ?? null,
    subject: assuntos.length ? (assuntos as string[]).join("; ").slice(0, 500) : null,
    distribution_date: distribution,
    graus: [...new Set(docs.map((d) => String(d.src.grau ?? "")).filter(Boolean))].sort(),
    source_updated_at: updated,
  };

  const seen = new Set<string>();
  const movements: DatajudMovement[] = [];
  for (const d of docs) {
    const grau = s(d.src.grau);
    for (const raw of Array.isArray(d.src.movimentos) ? (d.src.movimentos as unknown[]) : []) {
      const m = obj(raw);
      const name = s(m.nome);
      const when = s(m.dataHora);
      if (!name || !when || Number.isNaN(Date.parse(when))) continue;
      const compl = (Array.isArray(m.complementosTabelados) ? (m.complementosTabelados as unknown[]) : [])
        .map((c) => obj(c))
        .map((c) => ({ codigo: c.codigo ?? null, valor: c.valor ?? null, nome: s(c.nome), descricao: s(c.descricao) }))
        .sort((a, b) => String(a.codigo).localeCompare(String(b.codigo)) || String(a.nome).localeCompare(String(b.nome)));
      const key = sha256(JSON.stringify([d.id, m.codigo ?? null, when, compl, obj(m.orgaoJulgador).codigo ?? null]));
      if (seen.has(key)) continue;
      seen.add(key);
      const extra = compl.map((c) => [c.descricao, c.nome].filter(Boolean).join(": ")).filter(Boolean);
      movements.push({
        external_id: key,
        occurred_at: new Date(when).toISOString(),
        code: typeof m.codigo === "number" ? m.codigo : Number.isFinite(Number(m.codigo)) ? Number(m.codigo) : null,
        name: name.slice(0, 300),
        description: (extra.length ? `${name} — ${extra.join("; ")}` : name).slice(0, 4000),
        grau,
      });
    }
  }
  movements.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  return { kind: "ok", meta, movements };
}

export interface DatajudClientOptions {
  fetch?: typeof fetch;
  apiKey?: string;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Tentativa com menos tempo que isto nem começa (a consulta costuma levar dezenas de segundos). */
const MIN_ATTEMPT_MS = 10_000;
/** Recusa por sobrecarga (429/5xx) ou falha de rede: até 3 tentativas por consulta. */
const MAX_ATTEMPTS = 3;

export class DatajudClient {
  private readonly f: typeof fetch;
  private readonly key: string;
  private readonly timeout: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: DatajudClientOptions = {}) {
    this.f = opts.fetch ?? fetch;
    this.key = opts.apiKey || process.env.DATAJUD_API_KEY || DATAJUD_PUBLIC_KEY;
    // Medido em 2026-11-03: 30–54 s por consulta no TJRJ; em 2026-11-13, 49 s
    // e duas recusas por sobrecarga (429). Com 45 s o site desistia antes de
    // o CNJ responder: agora cada tentativa espera até 2 min, cortada no
    // prazo da rodada (process(cnj, deadline)). Tempo esgotado não tenta de
    // novo (comeria a rodada): volta em 1 h.
    this.timeout = opts.timeoutMs ?? 120_000;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /**
   * Um processo pelo CNJ. `deadline` (ms): nenhuma tentativa passa dele (a
   * rodada precisa de tempo para gravar o fim — JUD-06).
   */
  async process(cnj: string, deadline?: number): Promise<DatajudResult> {
    const alias = datajudAlias(cnj);
    if (!alias) return { kind: "unsupported", message: "Tribunal sem índice público no DataJud (ex.: STF)." };
    const body = JSON.stringify({ size: 20, query: { match: { numeroProcesso: cnj } } });
    // Tempo desta tentativa: o padrão, cortado no prazo da rodada (1,5 s de folga).
    const budget = () => Math.min(this.timeout, deadline === undefined ? Infinity : deadline - Date.now() - 1_500);
    for (let attempt = 1; ; attempt++) {
      const ms = budget();
      if (ms < MIN_ATTEMPT_MS) {
        throw attempt === 1
          ? new DatajudError("Sem tempo na rodada para consultar o DataJud", true, true)
          : new DatajudError("DataJud falhou e não houve tempo para tentar de novo nesta rodada", true);
      }
      let res: Response;
      try {
        res = await this.f(`${DATAJUD_BASE}/api_publica_${alias}/_search`, {
          method: "POST",
          headers: { Authorization: `APIKey ${this.key}`, "Content-Type": "application/json", Accept: "application/json" },
          body,
          signal: AbortSignal.timeout(ms),
          cache: "no-store",
        });
      } catch (e) {
        const timedOut = e instanceof Error && e.name === "TimeoutError";
        if (attempt < MAX_ATTEMPTS && !timedOut) {
          await this.sleep(1500 * attempt);
          continue;
        }
        throw new DatajudError(`DataJud não respondeu (${timedOut ? "tempo esgotado" : "falha de rede"})`, true);
      }
      // 429 e 5xx: o CNJ recusa quando a fila dele está cheia. Espera um pouco
      // mais a cada vez (4 s, 12 s) e tenta de novo; o laço confere o prazo.
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
        await this.sleep(attempt === 1 ? 4_000 : 12_000);
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new DatajudError("DataJud recusou a chave pública (o CNJ pode tê-la trocado: atualize DATAJUD_API_KEY)");
      if (res.status === 404) return { kind: "unsupported", message: `Índice ${alias} não existe no DataJud.` };
      if (!res.ok) throw new DatajudError(`DataJud respondeu HTTP ${res.status}`, res.status === 429 || res.status >= 500);
      let json: { hits?: { hits?: Hit[] } } | null;
      try {
        json = (await res.json()) as { hits?: { hits?: Hit[] } } | null;
      } catch (e) {
        // O corpo também é cortado pelo tempo da tentativa.
        if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) throw new DatajudError("DataJud não respondeu (tempo esgotado)", true);
        json = null;
      }
      if (!json?.hits || !Array.isArray(json.hits.hits)) throw new DatajudError("DataJud devolveu resposta inesperada");
      return normalizeDatajud(alias, cnj, json.hits.hits);
    }
  }
}
