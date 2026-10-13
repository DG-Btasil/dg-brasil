import { DomainError } from "./errors";

/**
 * Erro do Supabase/PostgREST/Postgres → `DomainError` com mensagem segura.
 *
 * As mensagens que NÓS escrevemos nas funções e triggers do banco (português,
 * `raise exception '...'`) são seguras para o usuário e passam adiante. As da
 * plataforma ("new row violates row-level security policy for table x",
 * "duplicate key value violates unique constraint y") NUNCA passam: viram
 * texto genérico — elas revelam nomes de tabela/coluna e, às vezes, existência.
 */

export interface DbErrorLike {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

/** Constraints únicas com mensagem própria. Nome do índice → erro de domínio. */
const UNIQUE_CONSTRAINTS: Record<string, () => DomainError> = {
  clients_cpf_key: () => new DomainError("DUPLICATE_CLIENT", undefined, { technicalCode: "23505" }),
  clients_cnpj_key: () => new DomainError("DUPLICATE_CLIENT", undefined, { technicalCode: "23505" }),
  legal_processes_cnj_key: () => new DomainError("CONFLICT", "Já existe um processo com este número CNJ.", { technicalCode: "23505" }),
  legal_processes_cnj_unique: () => new DomainError("CONFLICT", "Já existe um processo com este número CNJ.", { technicalCode: "23505" }),
};

const PLATFORM_TEXT = /violates|relation "|column "|constraint "|function |syntax|permission denied|does not exist|null value|invalid input|duplicate key|JSON|schema cache|PGRST/i;

/** Mensagem escrita por nós no banco (segura para o usuário)? */
export function isOurDbMessage(message: string | undefined): message is string {
  if (!message) return false;
  if (message.length > 240) return false;
  if (PLATFORM_TEXT.test(message)) return false;
  // Nossos textos são frases em português; códigos internos (ex.: EMAIL_ALREADY_HAS_ACCESS) não passam.
  return /[a-zà-ú]/i.test(message) && !/^[A-Z0-9_]+$/.test(message);
}

export function fromDbError(error: DbErrorLike | null | undefined): DomainError {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  const technicalCode = code || undefined;

  if (code === "PGRST116") return new DomainError("NOT_FOUND", undefined, { technicalCode });
  if (code === "23505") {
    const constraint = /constraint "([^"]+)"/.exec(message)?.[1] ?? /\(([^)]+)\)/.exec(error?.details ?? "")?.[1];
    const mapped = constraint ? UNIQUE_CONSTRAINTS[constraint] : undefined;
    if (mapped) return mapped();
    // `raise ... using errcode = '23505'` com texto nosso (ex.: duplicidade de negócio).
    return new DomainError("CONFLICT", isOurDbMessage(message) ? message : undefined, { technicalCode });
  }
  if (code === "42501") {
    // RLS da plataforma ou nossa função recusando o ator: nunca diz POR QUE não existe/acessa.
    return new DomainError("FORBIDDEN", isOurDbMessage(message) ? message : undefined, { technicalCode });
  }
  if (code === "23503") return new DomainError("VALIDATION", "Registro relacionado não encontrado.", { technicalCode });
  if (code === "22P02" || code === "22007" || code === "22008" || code === "22003") {
    return new DomainError("VALIDATION", undefined, { technicalCode });
  }
  if (code === "23514" || code === "22023" || code === "P0001") {
    return new DomainError(isOurDbMessage(message) ? "INVALID_STATE" : "VALIDATION", isOurDbMessage(message) ? message : undefined, { technicalCode });
  }
  if (code === "23502") return new DomainError("VALIDATION", undefined, { technicalCode });
  // Idempotência (027): o envio com a mesma chave ainda está em andamento.
  if (code === "55P03") return new DomainError("CONFLICT", isOurDbMessage(message) ? message : undefined, { technicalCode });
  return new DomainError("INTERNAL", undefined, { technicalCode });
}

/** Lança `DomainError` se a resposta do Supabase trouxe erro; devolve os dados. */
export function unwrap<T>(result: { data: T; error: DbErrorLike | null }): T {
  if (result.error) throw fromDbError(result.error);
  return result.data;
}
