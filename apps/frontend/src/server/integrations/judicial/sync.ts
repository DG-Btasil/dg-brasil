import type { Logger } from "@/server/core/logger";
import { DatajudError, type DatajudResult } from "./datajud";
import { DjenError, type DjenItem } from "./djen";
import { addDays, safeError } from "./text";

/**
 * Rodada da integração judicial (043), feita pelo SERVIDOR (rota agendada ou
 * "Buscar agora"). O banco decide o escopo e grava (funções private.judicial_*,
 * login dg_worker); aqui só se consulta o DJEN e o DataJud e se entrega o
 * resultado normalizado.
 *
 *  1. judicial_sync_begin: abre a rodada (ou devolve busy/idle) com as OABs a
 *     consultar (cada OAB uma vez, a consultada há mais tempo primeiro) e a
 *     janela de dias. Agendada: só as OABs ainda não conferidas hoje; o
 *     agendador do banco chama a cada 5 min até todas darem certo.
 *  2. DJEN: para cada OAB, as comunicações de [hoje − janela, hoje]. O banco só
 *     guarda as de processos cadastrados (das outras, só conta). Limite de
 *     consultas (429): encerra o DJEN desta rodada; as OABs restantes ficam
 *     para o próximo lote.
 *  3. DataJud: processos cadastrados com CNJ, os há mais tempo sem leitura
 *     primeiro, em paralelo curto, até o tempo da rodada acabar.
 *  4. judicial_sync_finish: COMPLETED, PARTIAL (alguma falha) ou FAILED.
 */

export type JudicialDbFunction =
  | "judicial_sync_begin" | "judicial_datajud_queue" | "judicial_ingest_datajud" | "judicial_ingest_djen" | "judicial_sync_finish";
export const JUDICIAL_DB_FUNCTIONS: readonly JudicialDbFunction[] = [
  "judicial_sync_begin", "judicial_datajud_queue", "judicial_ingest_datajud", "judicial_ingest_djen", "judicial_sync_finish",
];

export interface JudicialSyncDeps {
  db: <T>(fn: JudicialDbFunction, args: unknown[]) => Promise<T>;
  djen: { byOab(oabNumber: string, oabState: string, from: string, to: string, deadline?: number): Promise<DjenItem[]> };
  datajud: { process(cnj: string, deadline?: number): Promise<DatajudResult> };
  log: Logger;
  /** Não começa trabalho novo depois deste instante (ms). */
  deadline?: number;
  now?: () => number;
  datajudLimit?: number;
  datajudConcurrency?: number;
  /** Tempo mínimo para começar uma consulta ao DataJud (a consulta é cortada no prazo da rodada). */
  datajudCallBudgetMs?: number;
  /** Falhas passageiras do DataJud numa rodada a partir das quais não se começa consulta nova (CNJ instável). */
  datajudMaxTransient?: number;
  /** Tempo mínimo para começar uma OAB no DJEN (uma página com intervalo e resposta). */
  djenCallBudgetMs?: number;
}

export interface JudicialSyncOptions {
  trigger: "CRON" | "MANUAL";
  requestedBy?: string | null;
  processId?: string | null;
  /** Lote só do DataJud (agendador do banco, quando não há OAB pendente no dia). */
  onlyDatajud?: boolean;
}

export interface JudicialSyncStats {
  oabs: number;
  oabsChecked: number;
  oabsLeftForNextRun: number;
  djenErrors: number;
  publicationsFound: number;
  publicationsNew: number;
  publicationsDuplicate: number;
  /** Só a contagem: de processo que não está no DG Brasil nada é guardado. */
  publicationsOutsideDgBrasil: number;
  processesQueued: number;
  processesRead: number;
  processesNotFound: number;
  datajudErrors: number;
  movementsNew: number;
  processesLeftForNextRun: number;
}

export type JudicialSyncResult =
  | { busy: true }
  | { busy: false; idle: true }
  | { busy: false; idle?: false; runId: string; status: "COMPLETED" | "PARTIAL" | "FAILED"; stats: JudicialSyncStats; errors: string[] };

interface Begin {
  busy: boolean;
  idle?: boolean;
  run_id?: string;
  djen_enabled?: boolean;
  datajud_enabled?: boolean;
  lookback_days?: number;
  today?: string;
  oabs?: { oab_number: string; oab_state: string }[];
}

interface QueueItem {
  ref_id: string;
  legal_process_id: string;
  cnj: string;
  baseline: boolean;
}

const emptyStats = (): JudicialSyncStats => ({
  oabs: 0, oabsChecked: 0, oabsLeftForNextRun: 0, djenErrors: 0, publicationsFound: 0, publicationsNew: 0,
  publicationsDuplicate: 0, publicationsOutsideDgBrasil: 0, processesQueued: 0, processesRead: 0, processesNotFound: 0,
  datajudErrors: 0, movementsNew: 0, processesLeftForNextRun: 0,
});

export async function runJudicialSync(d: JudicialSyncDeps, opts: JudicialSyncOptions): Promise<JudicialSyncResult> {
  const now = d.now ?? Date.now;
  const outOfTime = () => d.deadline !== undefined && now() > d.deadline;
  const begin = await d.db<Begin>("judicial_sync_begin", [opts.trigger, opts.requestedBy ?? null, opts.processId ?? null, opts.onlyDatajud ?? false]);
  if (begin.busy) return { busy: true };
  if (begin.idle || !begin.run_id) return { busy: false, idle: true };
  const runId = begin.run_id;
  const stats = emptyStats();
  const errors: string[] = [];
  let status: "COMPLETED" | "PARTIAL" | "FAILED" = "COMPLETED";

  try {
    // ── DJEN ──────────────────────────────────────────────────────────
    if (begin.djen_enabled && begin.today) {
      const to = begin.today;
      const from = addDays(to, -Math.max(1, begin.lookback_days ?? 5));
      const oabs = begin.oabs ?? [];
      stats.oabs = oabs.length;
      let stop = false;
      let started = 0;
      for (const o of oabs) {
        if (stop || outOfTime() || (d.deadline !== undefined && now() + (d.djenCallBudgetMs ?? 12_000) > d.deadline)) {
          stats.oabsLeftForNextRun++;
          continue;
        }
        started++;
        try {
          const items = await d.djen.byOab(o.oab_number, o.oab_state, from, to, d.deadline);
          const r = await d.db<{ found: number; new: number; duplicates: number; unmatched: number }>(
            "judicial_ingest_djen", [runId, o.oab_number, o.oab_state, from, to, true, null, items]);
          stats.oabsChecked++;
          stats.publicationsFound += r.found ?? 0;
          stats.publicationsNew += r.new ?? 0;
          stats.publicationsDuplicate += r.duplicates ?? 0;
          stats.publicationsOutsideDgBrasil += r.unmatched ?? 0;
        } catch (e) {
          // Não coube no fim da rodada: fica para o próximo lote, sem falha. Só é
          // falha quando nem com a rodada inteira (primeira OAB) ela coube.
          if (e instanceof DjenError && e.outOfTime && started > 1) {
            stats.oabsLeftForNextRun++;
            stop = true;
            continue;
          }
          const msg = safeError(e);
          stats.djenErrors++;
          errors.push(`OAB ${o.oab_state} ${o.oab_number}: ${msg}`);
          d.log.warn("judicial.djen_failed", { oab: `${o.oab_state}${o.oab_number}`, error: msg });
          await d.db("judicial_ingest_djen", [runId, o.oab_number, o.oab_state, from, to, false, msg, null]).catch(() => undefined);
          if (e instanceof DjenError && e.rateLimited) stop = true;
        }
      }
    }

    // ── DataJud ───────────────────────────────────────────────────────
    if (begin.datajud_enabled && !outOfTime()) {
      const queue = await d.db<QueueItem[]>("judicial_datajud_queue", [d.datajudLimit ?? 150, opts.processId ?? null]);
      stats.processesQueued = queue.length;
      let next = 0;
      let transient = 0;
      let skipped = 0;
      const worker = async () => {
        while (next < queue.length) {
          // Pouco tempo sobrando: nem começa (a consulta costuma levar dezenas de segundos).
          if (outOfTime() || (d.deadline !== undefined && now() + (d.datajudCallBudgetMs ?? 20_000) > d.deadline)) return;
          // CNJ instável: para de insistir nesta rodada (JUD-04); os que falharam voltam em 1 h.
          if (transient >= (d.datajudMaxTransient ?? 3)) return;
          const q = queue[next++];
          try {
            const r = await d.datajud.process(q.cnj, d.deadline);
            if (r.kind === "ok") {
              const x = await d.db<{ ok: boolean; inserted?: number }>(
                "judicial_ingest_datajud", [runId, q.ref_id, true, null, r.meta, r.movements]);
              stats.processesRead++;
              stats.movementsNew += x.inserted ?? 0;
            } else {
              // Não encontrado / sem índice: situação do processo, não falha da rodada.
              stats.processesNotFound++;
              await d.db("judicial_ingest_datajud", [runId, q.ref_id, false, r.message, null, null]);
            }
          } catch (e) {
            // Faltou tempo antes de começar: fica para o próximo lote, sem falha.
            if (e instanceof DatajudError && e.outOfTime) {
              skipped++;
              return;
            }
            const msg = safeError(e);
            const isTransient = e instanceof DatajudError && e.transient;
            if (isTransient) transient++;
            stats.datajudErrors++;
            if (errors.length < 20) errors.push(`DataJud: ${msg}`);
            await d.db("judicial_ingest_datajud", [runId, q.ref_id, false, msg, null, null, isTransient]).catch(() => undefined);
          }
        }
      };
      // O DataJud responde devagar (até ~50 s por consulta): poucas em paralelo.
      await Promise.all(Array.from({ length: Math.max(1, d.datajudConcurrency ?? 2) }, worker));
      stats.processesLeftForNextRun = Math.max(0, queue.length - next) + skipped;
    }
    if (errors.length) status = "PARTIAL";
  } catch (e) {
    status = "FAILED";
    errors.push(safeError(e));
    d.log.error("judicial.sync_crashed", { error: safeError(e) });
  } finally {
    await d.db("judicial_sync_finish", [runId, status, stats, errors.length ? [...new Set(errors)].join("\n").slice(0, 1000) : null])
      .catch((e) => d.log.error("judicial.finish_failed", { error: safeError(e) }));
  }
  return { busy: false, runId, status, stats, errors };
}
