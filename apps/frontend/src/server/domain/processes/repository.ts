import type { SupabaseClient } from "@supabase/supabase-js";
import { fromDbError, unwrap } from "@/server/core/db-errors";
import { toRange, type PageInput } from "@/server/core/pagination";
import type { EventRow, PartyRow, ProcessInternalRow, ProcessRow } from "./mappers";

/**
 * Acesso a dados de Processo, Partes e Movimentações (queries diretas com o
 * JWT do usuário). Sem regra de negócio — autorização contextual e
 * invariantes ficam no service; RLS e triggers (legal_processes_guard,
 * deadlines_process_fkey, CNJ único) são a segunda barreira. Colunas sempre
 * explícitas.
 */

/** Colunas que as duas superfícies leem + o cliente do caso (o processo herda o acesso do caso). */
const BASE_COLUMNS =
  "id, legal_case_id, title, cnj_number, technical_origin, court, court_unit, district, state, legal_class, subject, client_side, adverse_party_summary, currency, status, phase, distribution_date, created_at, updated_at, legal_cases!inner(client_id)";
/** Só equipe interna. */
const INTERNAL_COLUMNS = "responsible_user_id, operational_due_at, created_by";

/** Monta o SELECT por superfície; o valor da causa só é lido quando o papel pode vê-lo. */
export function processColumns(scope: "INTERNAL" | "PARTNER", withCaseValue: boolean): string {
  return [BASE_COLUMNS, scope === "INTERNAL" ? INTERNAL_COLUMNS : null, withCaseValue ? "case_value" : null].filter(Boolean).join(", ");
}

const PARTY_COLUMNS = "id, legal_process_id, party_type, name, document_number, client_id, created_at";
const EVENT_COLUMNS = "id, legal_process_id, event_type, title, description, occurred_at, source, important, created_at";

/** Escapa curingas do ILIKE: o texto do usuário nunca vira padrão. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Busca: só dígitos (≥ 3, com ou sem máscara CNJ) → prefixo do CNJ; texto → título. */
export function searchTarget(q: string): { kind: "cnj"; digits: string } | { kind: "title"; text: string } | null {
  const text = q.trim();
  if (!text) return null;
  const digits = text.replace(/\D/g, "");
  if (digits.length >= 3 && digits.length === text.replace(/[\s.-]/g, "").length) return { kind: "cnj", digits };
  return { kind: "title", text };
}

/* ------------------------------------------------------------------ */
/* Processos                                                           */
/* ------------------------------------------------------------------ */

export interface ProcessFilters {
  q?: string;
  status?: string;
  clientId?: string;
  caseId?: string;
  responsibleUserId?: string;
}

export async function listProcesses(
  db: SupabaseClient,
  columns: string,
  filters: ProcessFilters,
  page: PageInput,
  sort: { column: string; ascending: boolean },
): Promise<{ rows: ProcessRow[]; total: number }> {
  let query = db.from("legal_processes").select(columns, { count: "exact" }).is("deleted_at", null);
  const target = filters.q ? searchTarget(filters.q) : null;
  if (target?.kind === "cnj") query = query.like("cnj_number", `${target.digits}%`);
  if (target?.kind === "title") query = query.ilike("title", likePattern(target.text));
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.caseId) query = query.eq("legal_case_id", filters.caseId);
  if (filters.clientId) query = query.eq("legal_cases.client_id", filters.clientId);
  if (filters.responsibleUserId) query = query.eq("responsible_user_id", filters.responsibleUserId);
  const { from, to } = toRange(page);
  const { data, error, count } = await query.order(sort.column, { ascending: sort.ascending, nullsFirst: false }).order("id").range(from, to);
  if (error) throw fromDbError(error);
  return { rows: (data ?? []) as unknown as ProcessRow[], total: count ?? 0 };
}

export async function getProcess(db: SupabaseClient, id: string, columns: string): Promise<ProcessRow | null> {
  const { data, error } = await db.from("legal_processes").select(columns).eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) throw fromDbError(error);
  return data as unknown as ProcessRow | null;
}

export async function getInternalDetails(db: SupabaseClient, id: string): Promise<ProcessInternalRow | null> {
  return unwrap(await db.from("legal_process_internal_details").select("summary, notes").eq("legal_process_id", id).maybeSingle()) as ProcessInternalRow | null;
}

/** Processo visível (RLS) e não excluído, com o caso e o cliente do caso. */
export async function getProcessRef(db: SupabaseClient, id: string): Promise<{ id: string; legalCaseId: string; clientId: string } | null> {
  const data = unwrap(
    await db.from("legal_processes").select("id, legal_case_id, legal_cases!inner(client_id)").eq("id", id).is("deleted_at", null).maybeSingle(),
  ) as { id: string; legal_case_id: string; legal_cases: { client_id: string } | { client_id: string }[] } | null;
  if (!data) return null;
  const legalCase = Array.isArray(data.legal_cases) ? data.legal_cases[0] : data.legal_cases;
  return { id: data.id, legalCaseId: data.legal_case_id, clientId: legalCase?.client_id ?? "" };
}

/** Caso visível (RLS: parceiro só os do próprio escritório) e não excluído. */
export async function getCaseRef(db: SupabaseClient, caseId: string): Promise<{ id: string; clientId: string } | null> {
  const data = unwrap(await db.from("legal_cases").select("id, client_id").eq("id", caseId).is("deleted_at", null).maybeSingle()) as {
    id: string;
    client_id: string;
  } | null;
  return data ? { id: data.id, clientId: data.client_id } : null;
}

/** Inserção SEM RETURNING (o id vem do servidor) — mesmo caminho para interno e parceiro. */
/**
 * Criação idempotente e ATÔMICA (processo + dados internos + prazo inicial) —
 * public.create_legal_process_once (027). RLS de legal_processes vale (invoker).
 */
export async function createProcessOnce(
  db: SupabaseClient,
  key: string,
  process: Record<string, unknown>,
  internal: Record<string, unknown> | null,
  deadline: Record<string, unknown> | null,
): Promise<{ legal_process_id: string; deadline_id: string | null; deduplicated: boolean }> {
  return unwrap(await db.rpc("create_legal_process_once", { p_key: key, p_process: process, p_internal: internal, p_deadline: deadline })) as {
    legal_process_id: string;
    deadline_id: string | null;
    deduplicated: boolean;
  };
}

export async function insertProcess(db: SupabaseClient, row: Record<string, unknown>): Promise<void> {
  unwrap(await db.from("legal_processes").insert(row));
}

/** Cria ou altera os dados internos (só as colunas presentes no objeto). */
export async function upsertInternalDetails(db: SupabaseClient, row: Record<string, unknown>): Promise<void> {
  unwrap(await db.from("legal_process_internal_details").upsert(row, { onConflict: "legal_process_id" }));
}

/** PATCH de processo não excluído. Nenhuma linha afetada = não encontrado (ou RLS). */
export async function updateProcess(db: SupabaseClient, id: string, patch: Record<string, unknown>): Promise<void> {
  const { error, count } = await db.from("legal_processes").update(patch, { count: "exact" }).eq("id", id).is("deleted_at", null);
  if (error) throw fromDbError(error);
  if (!count) throw fromDbError({ code: "PGRST116" });
}

/** Exclusão lógica (o trigger só permite a ADMIN). */
export async function softDelete(db: SupabaseClient, id: string): Promise<void> {
  const { error, count } = await db.from("legal_processes").update({ deleted_at: new Date().toISOString() }, { count: "exact" }).eq("id", id).is("deleted_at", null);
  if (error) throw fromDbError(error);
  if (!count) throw fromDbError({ code: "PGRST116" });
}

/** LGPD: abertura da ficha do processo (o banco agrupa aberturas repetidas em 10 min). */
export async function recordDetailAccess(db: SupabaseClient, clientId: string, processId: string): Promise<void> {
  unwrap(
    await db.rpc("record_personal_data_access", {
      p_client_id: clientId,
      p_resource_type: "LEGAL_PROCESS",
      p_resource_id: processId,
      p_action: "VIEW_DETAIL",
      p_purpose: null,
    }),
  );
}

/** Cliente visível ao usuário (RLS) e não excluído. */
export async function clientVisible(db: SupabaseClient, clientId: string): Promise<boolean> {
  const data = unwrap(await db.from("clients").select("id").eq("id", clientId).is("deleted_at", null).maybeSingle()) as { id: string } | null;
  return data !== null;
}

/* ------------------------------------------------------------------ */
/* Partes                                                              */
/* ------------------------------------------------------------------ */

export async function listParties(db: SupabaseClient, processId: string, page: PageInput): Promise<{ rows: PartyRow[]; total: number }> {
  const { from, to } = toRange(page);
  const { data, error, count } = await db
    .from("process_parties")
    .select(PARTY_COLUMNS, { count: "exact" })
    .eq("legal_process_id", processId)
    .order("created_at")
    .order("id")
    .range(from, to);
  if (error) throw fromDbError(error);
  return { rows: (data ?? []) as PartyRow[], total: count ?? 0 };
}

export async function getPartyProcessId(db: SupabaseClient, id: string): Promise<string | null> {
  const data = unwrap(await db.from("process_parties").select("legal_process_id").eq("id", id).maybeSingle()) as { legal_process_id: string } | null;
  return data?.legal_process_id ?? null;
}

export async function insertParty(db: SupabaseClient, row: Record<string, unknown>): Promise<void> {
  unwrap(await db.from("process_parties").insert(row));
}

export async function updateParty(db: SupabaseClient, id: string, patch: Record<string, unknown>): Promise<void> {
  const { error, count } = await db.from("process_parties").update(patch, { count: "exact" }).eq("id", id);
  if (error) throw fromDbError(error);
  if (!count) throw fromDbError({ code: "PGRST116" });
}

/* ------------------------------------------------------------------ */
/* Movimentações                                                       */
/* ------------------------------------------------------------------ */

/**
 * Movimentações do processo, mais recentes primeiro. `sources` restringe a
 * origem (parceiro: só oficiais e do sistema — a RLS já filtra; aqui é a
 * defesa em profundidade). `raw_data` nunca é lido.
 */
export async function listEvents(
  db: SupabaseClient,
  processId: string,
  page: PageInput,
  options: { sources?: readonly string[]; internal: boolean },
): Promise<{ rows: EventRow[]; total: number }> {
  const { from, to } = toRange(page);
  let query = db
    .from("process_events")
    .select(options.internal ? `${EVENT_COLUMNS}, external_provider` : EVENT_COLUMNS, { count: "exact" })
    .eq("legal_process_id", processId);
  if (options.sources) query = query.in("source", [...options.sources]);
  const { data, error, count } = await query.order("occurred_at", { ascending: false }).order("id").range(from, to);
  if (error) throw fromDbError(error);
  return { rows: (data ?? []) as unknown as EventRow[], total: count ?? 0 };
}

export async function insertEvent(db: SupabaseClient, row: Record<string, unknown>): Promise<void> {
  unwrap(await db.from("process_events").insert(row));
}
