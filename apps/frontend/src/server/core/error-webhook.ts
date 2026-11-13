import { consoleSink, redact, type LogFields, type LogLevel, type LogSink } from "./logger";

/**
 * Aviso de erros por webhook (opcional): com `ERROR_WEBHOOK_URL` definida, todo
 * log de nível "error" do servidor vira um POST para esse endereço, além da
 * linha de sempre no console. Serve para alguém ser avisado quando algo quebra,
 * sem depender de abrir os logs da Vercel.
 *
 * Regras:
 *   - só o que já passou pela sanitização do logger (sem CPF, e-mail, nome,
 *     token, conteúdo): os campos chegam aqui prontos;
 *   - limite de envios por minuto, por instância do servidor; o que passar do
 *     limite é contado e informado no envio seguinte ("suprimidos");
 *   - nunca derruba nem atrasa a requisição: o envio não é aguardado por quem
 *     loga, tem tempo máximo e toda falha é engolida (fica uma linha de aviso
 *     no console, nunca outro POST).
 *
 * O corpo traz `text` e `content` (uma frase curta) para funcionar direto num
 * webhook de chat (Slack, Teams, Discord), e os campos estruturados para quem
 * quiser tratar.
 */

export interface ErrorWebhookOptions {
  url: string;
  /** Rótulo do ambiente no aviso ("production", "development"…). */
  environment?: string;
  /** Máximo de envios por minuto nesta instância. Padrão: 5. */
  maxPerMinute?: number;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  now?: () => number;
  /** Mantém a função viva até o envio terminar (em serverless: `after` do Next). */
  keepAlive?: (pending: Promise<void>) => void;
  /** Destino que continua recebendo tudo. Padrão: console. */
  next?: LogSink;
}

export interface ErrorWebhookPayload {
  text: string;
  content: string;
  source: "dg-brasil";
  environment: string;
  level: LogLevel;
  event: string;
  at: string;
  suppressed: number;
  fields: LogFields;
}

const WINDOW_MS = 60_000;

/** Só http(s); qualquer outra coisa (vazio, texto solto) = desligado. */
export function errorWebhookUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export interface ErrorWebhook {
  /** Destino para `setLogSink`: repassa tudo ao console e envia os erros. */
  sink: LogSink;
  /** Registra e envia UM erro, respeitando o limite; a promessa termina quando o envio termina (ou na hora, se foi suprimido). */
  report: (event: string, fields: LogFields) => Promise<void>;
}

export function createErrorWebhook(options: ErrorWebhookOptions): ErrorWebhook {
  const fetchFn = options.fetchFn ?? fetch;
  const now = options.now ?? Date.now;
  const next = options.next ?? consoleSink;
  const max = options.maxPerMinute ?? 5;
  const environment = options.environment ?? "desconhecido";
  let sent: number[] = [];
  let suppressed = 0;

  const deliver = async (payload: ErrorWebhookPayload): Promise<void> => {
    try {
      const response = await fetchFn(options.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(options.timeoutMs ?? 3_000),
        cache: "no-store",
      });
      if (!response.ok) next("warn", "error_webhook.rejected", { status: response.status });
    } catch (error) {
      next("warn", "error_webhook.failed", { reason: error instanceof Error ? redact(error.name) : "unknown" });
    }
  };

  /** Aplica o limite e dispara o envio. `null` = suprimido. */
  const send = (level: LogLevel, event: string, fields: LogFields): Promise<void> | null => {
    const t = now();
    sent = sent.filter((at) => t - at < WINDOW_MS);
    if (sent.length >= max) {
      suppressed += 1;
      return null;
    }
    sent.push(t);
    const summary = `[DG Brasil · ${environment}] erro no servidor: ${event}${suppressed ? ` (mais ${suppressed} não enviados por limite)` : ""}`;
    const payload: ErrorWebhookPayload = {
      text: summary, content: summary, source: "dg-brasil", environment, level, event, at: new Date(t).toISOString(), suppressed, fields,
    };
    suppressed = 0;
    return deliver(payload);
  };

  const sink: LogSink = (level, event, fields) => {
    next(level, event, fields);
    if (level !== "error") return;
    try {
      const pending = send(level, event, fields);
      if (pending) options.keepAlive?.(pending);
    } catch {
      // Logar nunca pode quebrar quem chamou. Fora de uma requisição não há o que manter vivo: o envio segue sozinho.
    }
  };

  const report = async (event: string, fields: LogFields): Promise<void> => {
    next("error", event, fields);
    try {
      await send("error", event, fields);
    } catch {
      // idem
    }
  };

  return { sink, report };
}
