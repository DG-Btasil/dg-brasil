import { fixCase, htmlToText, onlyDigits } from "./text";

/**
 * DJEN — Comunica API do CNJ (pública, sem credencial).
 * GET https://comunicaapi.pje.jus.br/api/v1/comunicacao?numeroOab&ufOab&dataDisponibilizacaoInicio&dataDisponibilizacaoFim&pagina&itensPorPagina
 *
 * Fatos conferidos em 2026-11-03 (especificação djen.yml v1.0.4 e chamadas reais):
 *  - itensPorPagina válido: 5 ou 100. `count` nem sempre é o total: pagina até
 *    vir menos que 100 itens;
 *  - limite de 20 requisições por minuto POR IP (429 → esperar 1 minuto; usar
 *    vários IPs para fugir do limite é abuso). Aqui: uma requisição por vez,
 *    com intervalo mínimo, e 429 encerra a consulta da rodada;
 *  - `texto` vem em texto puro, com <br /> ou como documento HTML inteiro;
 *  - `id` numérico e global (chave contra duplicata); `hash` abre a certidão;
 *  - comunicação cancelada continua na API, com o teor trocado pelo motivo
 *    (ativo=false / data_cancelamento / motivo_cancelamento).
 */

export const DJEN_BASE = "https://comunicaapi.pje.jus.br/api/v1";
const PAGE_SIZE = 100;
const MAX_PAGES = 30;

export interface DjenItem {
  external_id: string;
  cnj: string;
  court: string | null;
  organ: string | null;
  communication_type: string | null;
  class_name: string | null;
  available_on: string;
  content: string;
  link: string | null;
  hash: string | null;
  cancelled: boolean;
  cancel_reason: string | null;
}

export class DjenError extends Error {
  /** outOfTime: a OAB não coube no tempo da rodada (não é falha do DJEN). */
  constructor(message: string, readonly rateLimited = false, readonly outOfTime = false) {
    super(message);
    this.name = "DjenError";
  }
}

type RawItem = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Item cru da API → o que o banco recebe. Item sem id, processo ou data: descartado. */
export function normalizeDjenItem(raw: RawItem): DjenItem | null {
  const id = raw.id;
  const external_id = typeof id === "number" || typeof id === "string" ? String(id).trim() : "";
  const cnj = onlyDigits(raw.numero_processo ?? raw.numeroprocessocommascara);
  const available_on = str(raw.data_disponibilizacao);
  if (!/^[0-9A-Za-z_-]{1,100}$/.test(external_id) || cnj.length !== 20 || !available_on || !/^\d{4}-\d{2}-\d{2}/.test(available_on)) return null;
  const hash = str(raw.hash);
  const cancelled = raw.ativo === false || !!str(raw.data_cancelamento) || (typeof raw.status === "string" && raw.status !== "P" && raw.status.trim() !== "");
  return {
    external_id,
    cnj,
    court: str(raw.siglaTribunal)?.toUpperCase().slice(0, 40) ?? null,
    organ: str(raw.nomeOrgao)?.slice(0, 300) ?? null,
    communication_type: fixCase(str(raw.tipoComunicacao))?.slice(0, 100) ?? null,
    class_name: fixCase(str(raw.nomeClasse))?.slice(0, 300) ?? null,
    available_on: available_on.slice(0, 10),
    content: htmlToText(str(raw.texto) ?? "").slice(0, 200_000) || "Publicação sem texto.",
    link: (() => {
      const l = str(raw.link);
      return l && /^https?:\/\//i.test(l) ? l.slice(0, 1000) : null;
    })(),
    hash: hash && /^[0-9A-Za-z_-]{8,100}$/.test(hash) ? hash : null,
    cancelled,
    cancel_reason: cancelled ? htmlToText(str(raw.motivo_cancelamento) ?? "").slice(0, 2000) || null : null,
  };
}

export interface DjenClientOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Intervalo mínimo entre requisições (ms). Padrão 3 s: o DJEN aceita 20 por minuto por IP. */
  minIntervalMs?: number;
  timeoutMs?: number;
}

export class DjenClient {
  private last = 0;
  private readonly f: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly gap: number;
  private readonly timeout: number;

  constructor(opts: DjenClientOptions = {}) {
    this.f = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.gap = opts.minIntervalMs ?? 3000;
    this.timeout = opts.timeoutMs ?? 20_000;
  }

  private async get(params: Record<string, string>, deadline?: number): Promise<RawItem[]> {
    const wait = this.last + this.gap - Date.now();
    if (wait > 0) await this.sleep(wait);
    this.last = Date.now();
    // Nenhuma consulta passa do prazo da rodada (JUD-06): 1,5 s de folga, mínimo 3 s.
    const ms = Math.max(3_000, Math.min(this.timeout, deadline === undefined ? Infinity : deadline - Date.now() - 1_500));
    const url = `${DJEN_BASE}/comunicacao?${new URLSearchParams(params).toString()}`;
    let res: Response;
    try {
      res = await this.f(url, {
        headers: { Accept: "application/json", "User-Agent": "DG-Brasil/1.0 (sistema interno de escritorio de advocacia)" },
        signal: AbortSignal.timeout(ms),
        cache: "no-store",
      });
    } catch (e) {
      throw new DjenError(`DJEN não respondeu (${e instanceof Error && e.name === "TimeoutError" ? "tempo esgotado" : "falha de rede"})`);
    }
    if (res.status === 429) throw new DjenError("DJEN: limite de consultas por minuto atingido; a próxima rodada continua", true);
    if (!res.ok) throw new DjenError(`DJEN respondeu HTTP ${res.status}`);
    const body = (await res.json().catch(() => null)) as { items?: unknown } | null;
    if (!body || !Array.isArray(body.items)) throw new DjenError("DJEN devolveu uma resposta sem a lista de comunicações");
    return body.items as RawItem[];
  }

  /**
   * Comunicações de uma OAB num período (datas AAAA-MM-DD, inclusivas), sem
   * repetição. `deadline` (ms): não pede a página seguinte se ela não couber
   * até lá; a OAB fica com falha e é tentada de novo no próximo lote.
   */
  async byOab(oabNumber: string, oabState: string, from: string, to: string, deadline?: number): Promise<DjenItem[]> {
    const out = new Map<string, DjenItem>();
    for (let page = 1; page <= MAX_PAGES; page++) {
      // Reserva: o intervalo + 8 s de resposta (o DJEN costuma responder em < 1 s;
      // a rota ainda tem ~10 s de folga depois do prazo).
      if (page > 1 && deadline !== undefined && Date.now() + this.gap + 8_000 > deadline) {
        throw new DjenError(`DJEN: a OAB tem mais de ${(page - 1) * PAGE_SIZE} comunicações na janela e não coube numa rodada`, false, true);
      }
      const items = await this.get({
        numeroOab: oabNumber,
        ufOab: oabState.toUpperCase(),
        dataDisponibilizacaoInicio: from,
        dataDisponibilizacaoFim: to,
        pagina: String(page),
        itensPorPagina: String(PAGE_SIZE),
      }, deadline);
      for (const raw of items) {
        const n = normalizeDjenItem(raw);
        if (n) out.set(n.external_id, n);
      }
      if (items.length < PAGE_SIZE) return [...out.values()];
    }
    throw new DjenError(`DJEN: mais de ${MAX_PAGES * PAGE_SIZE} comunicações no período; reduza a janela`);
  }
}
