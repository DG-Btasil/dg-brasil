/**
 * Modelo de erro do backend de domínio.
 *
 * Todo erro que sai para o navegador é um `DomainError` com código fixo e
 * mensagem SEGURA (escrita por nós, em português, sem dado técnico, sem PII e
 * sem revelar existência de registro de outro escritório). O erro bruto do
 * Postgres/Supabase fica só no log do servidor, já sanitizado.
 */

export const DOMAIN_ERROR_CODES = [
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "VALIDATION",
  "INVALID_STATE",
  "DUPLICATE_CLIENT",
  "BUSINESS_RULE",
  "INTERNAL",
] as const;
export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

const DEFAULT_MESSAGE: Record<DomainErrorCode, string> = {
  UNAUTHORIZED: "Sua sessão não está liberada. Entre novamente.",
  FORBIDDEN: "Você não tem permissão para esta operação.",
  NOT_FOUND: "Registro não encontrado.",
  CONFLICT: "Já existe um registro com estes dados.",
  VALIDATION: "Confira os dados informados.",
  INVALID_STATE: "Esta operação não é permitida no estado atual do registro.",
  DUPLICATE_CLIENT: "Cliente já cadastrado no sistema.",
  BUSINESS_RULE: "A operação não atende às regras do escritório.",
  INTERNAL: "Não foi possível concluir agora. Tente novamente em instantes.",
};

export type FieldErrors = Record<string, string[]>;

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  /** Mensagem que pode ir para o navegador. */
  readonly publicMessage: string;
  readonly fieldErrors?: FieldErrors;
  /** Código técnico SANITIZADO, só para log (ex.: "23505", "PGRST116"). */
  readonly technicalCode?: string;

  constructor(code: DomainErrorCode, publicMessage?: string, options: { fieldErrors?: FieldErrors; technicalCode?: string; cause?: unknown } = {}) {
    super(publicMessage ?? DEFAULT_MESSAGE[code]);
    this.name = "DomainError";
    this.code = code;
    this.publicMessage = publicMessage ?? DEFAULT_MESSAGE[code];
    this.fieldErrors = options.fieldErrors;
    this.technicalCode = options.technicalCode;
  }
}

export const unauthorized = (message?: string) => new DomainError("UNAUTHORIZED", message);
export const forbidden = (message?: string) => new DomainError("FORBIDDEN", message);
/** Não diz se o registro existe para outro escritório: "não encontrado" para tudo que não se acessa. */
export const notFound = (message?: string) => new DomainError("NOT_FOUND", message);
export const conflict = (message?: string) => new DomainError("CONFLICT", message);
export const validation = (fieldErrors: FieldErrors, message?: string) => new DomainError("VALIDATION", message, { fieldErrors });
export const invalidState = (message?: string) => new DomainError("INVALID_STATE", message);
export const businessRule = (message?: string) => new DomainError("BUSINESS_RULE", message);
export const duplicateClient = () => new DomainError("DUPLICATE_CLIENT");

/** Resultado de uma Server Action de domínio: nunca lança para o navegador. */
export type DomainResult<T> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: { code: DomainErrorCode; message: string; fieldErrors?: FieldErrors }; requestId: string };

export function failure(error: DomainError, requestId: string): DomainResult<never> {
  return {
    ok: false,
    error: { code: error.code, message: error.publicMessage, ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}) },
    requestId,
  };
}
