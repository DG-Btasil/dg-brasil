import type { PickerOption } from "@/components/ui/async-picker";
import { callAction } from "@/lib/actions/result";
import { listProcessFinanceAction } from "@/server/domain/finance/actions";
import { processPickerOption } from "./process-label";

/** Busca de processos para os seletores do financeiro (servidor + RLS; ADMIN; no máximo 10 por vez). */
export async function searchFinanceProcesses(q: string): Promise<{ ok: true; options: PickerOption[] } | { ok: false; message: string }> {
  const result = await callAction(() => listProcessFinanceAction({ q: q.trim() || undefined, pageSize: 10, sortBy: "title", sortDirection: "asc" }));
  if (!result.ok) return { ok: false, message: result.error.message };
  return { ok: true, options: result.data.items.map(processPickerOption) };
}
