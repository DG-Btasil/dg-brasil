/**
 * Log estruturado do servidor (uma linha JSON por evento).
 *
 * Contém: requestId, ação, IDs de entidade, ator (UUID), resultado, duração e
 * código técnico sanitizado. NUNCA: CPF, CNPJ, e-mail, telefone, nome, conteúdo
 * de documento, prompt, senha, token, chave, TOTP, payload jurídico.
 *
 * Campos são filtrados por NOME (denylist) e todo texto passa por redação.
 * `setLogSink` permite plugar Sentry/observabilidade depois sem mudar quem loga.
 */

export type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, string | number | boolean | null | undefined>;
export type LogSink = (level: LogLevel, event: string, fields: LogFields) => void;

const FORBIDDEN_KEY = /cpf|cnpj|document_number|email|phone|telefone|name|nome|password|senha|token|secret|key|totp|otp|content|conteudo|prompt|input|payload|body|address|endereco|birth|notes|summary/i;
const ALLOWED_KEY_SUFFIX = /(^|_)(id|ids)$|Id$|Ids$/;

/** Remove do texto o que nunca pode ir para log. */
export function redact(value: string): string {
  return value
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[jwt]")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[cpf]")
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, "[cnpj]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/(token|secret|password|senha|code|codigo|key|ref)=([^&\s"]+)/gi, "$1=[oculto]")
    .slice(0, 300);
}

export function sanitizeFields(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (FORBIDDEN_KEY.test(key) && !ALLOWED_KEY_SUFFIX.test(key)) {
      out[key] = "[oculto]";
      continue;
    }
    out[key] = typeof value === "string" ? redact(value) : value;
  }
  return out;
}

const consoleSink: LogSink = (level, event, fields) => {
  const line = JSON.stringify({ level, event, at: new Date().toISOString(), ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
};

let sink: LogSink = consoleSink;

/** Troca o destino dos logs (ex.: Sentry). Em testes, captura os eventos. */
export function setLogSink(next: LogSink | null) {
  sink = next ?? consoleSink;
}

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export function createLogger(base: LogFields = {}): Logger {
  const emit = (level: LogLevel) => (event: string, fields: LogFields = {}) => sink(level, event, sanitizeFields({ ...base, ...fields }));
  return {
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
    child: (fields) => createLogger({ ...base, ...fields }),
  };
}
