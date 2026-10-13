import type { PickerOption } from "@/components/ui/async-picker";
import { callAction } from "@/lib/actions/result";
import { maskCNPJ, maskCPF } from "@/lib/formatting";
import { listClientsAction } from "@/server/domain/clients/actions";

/** Busca de clientes ATIVOS para seletores (servidor + RLS; no máximo 10 por vez). */
export async function searchActiveClients(q: string): Promise<{ ok: true; options: PickerOption[] } | { ok: false; message: string }> {
  const result = await callAction(() =>
    listClientsAction({ q: q.trim() || undefined, status: "ACTIVE", pageSize: 10, sortBy: "name", sortDirection: "asc" }),
  );
  if (!result.ok) return { ok: false, message: result.error.message };
  return {
    ok: true,
    options: result.data.items.map((c) => ({
      id: c.id,
      label: c.name,
      // Identificador MASCARADO só para diferenciar homônimos.
      description: c.kind === "INDIVIDUAL" ? maskCPF(c.document) : maskCNPJ(c.document),
    })),
  };
}
