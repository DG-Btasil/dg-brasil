import { isPartner, type ServiceContext } from "./context";
import { DomainError } from "./errors";

/**
 * Limite de taxa NA APLICAÇÃO (Next.js), antes do service — Etapa 4.2.1.
 *
 * BEST-EFFORT application-level throttling, NÃO barreira de segurança
 * absoluta: o contador vive na memória da instância. Em serverless/várias
 * instâncias, cada uma conta separado, e um usuário autenticado que chame a
 * API do Supabase direto contorna esta camada. Risco aceito conscientemente
 * na V1 (produto fechado, parceiros convidados e conhecidos) — ver
 * docs/backend.md, "Rate limit". Sem Redis, sem tabela, sem trigger.
 *
 * Algoritmo: janela deslizante (registro dos instantes de cada uso, por
 * chave). Chaves só com IDs (usuário, escritório) — nunca o CPF/CNPJ.
 *
 * Exceção (migration 065): a consulta de CPF na Receita é PAGA por consulta,
 * então o limite dela é contado no banco, somando todas as instâncias
 * (`enforceSharedLimit`, no fim deste arquivo). Os outros limites continuam em
 * memória.
 */

export interface RateRule {
  key: string;
  limit: number;
}

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Consome UM uso em todas as regras, só se todas permitirem. */
  consume(rules: RateRule[]): { allowed: true } | { allowed: false; retryAfterMs: number } {
    const t = this.now();
    let retryAfterMs = 0;
    const windows = rules.map((rule) => {
      const recent = (this.hits.get(rule.key) ?? []).filter((at) => t - at < this.windowMs);
      if (recent.length >= rule.limit) retryAfterMs = Math.max(retryAfterMs, this.windowMs - (t - recent[0]));
      return { rule, recent };
    });
    if (retryAfterMs > 0) {
      windows.forEach(({ rule, recent }) => this.store(rule.key, recent));
      return { allowed: false, retryAfterMs };
    }
    windows.forEach(({ rule, recent }) => this.store(rule.key, [...recent, t]));
    this.sweep(t);
    return { allowed: true };
  }

  /** Chaves conhecidas (para teste/inspeção: só IDs, nunca documento). */
  keys(): string[] {
    return [...this.hits.keys()];
  }

  private store(key: string, times: number[]) {
    if (times.length) this.hits.set(key, times);
    else this.hits.delete(key);
  }

  /** Limpeza ocasional para a memória não crescer com usuários inativos. */
  private sweep(t: number) {
    if (this.hits.size < 1000) return;
    for (const [key, times] of this.hits) {
      if (!times.some((at) => t - at < this.windowMs)) this.hits.delete(key);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Consulta/cadastro por CPF/CNPJ feita por parceiro                   */
/* ------------------------------------------------------------------ */

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Configuração central (env, com padrão). Valores documentados em docs/backend.md. */
export const PARTNER_TAX_ID_LIMITS = {
  windowMs: 60_000,
  perUser: positiveInt(process.env.PARTNER_TAX_ID_LIMIT_PER_USER, 10),
  perOrganization: positiveInt(process.env.PARTNER_TAX_ID_LIMIT_PER_ORGANIZATION, 30),
} as const;

const partnerTaxIdLimiter = new SlidingWindowLimiter(PARTNER_TAX_ID_LIMITS.windowMs);

export const RATE_LIMITED_MESSAGE = "Muitas consultas em pouco tempo. Aguarde alguns instantes e tente novamente.";

/** Regras por usuário e por escritório (só IDs). */
export function partnerTaxIdRules(
  session: { userId: string; organizationId: string },
  limits: { perUser: number; perOrganization: number } = PARTNER_TAX_ID_LIMITS,
): RateRule[] {
  return [
    { key: `partner-tax-id:user:${session.userId}`, limit: limits.perUser },
    { key: `partner-tax-id:org:${session.organizationId}`, limit: limits.perOrganization },
  ];
}

/**
 * Aplica o limite a usuários do PARCEIRO (equipe interna não é limitada aqui).
 * Chamado na Server Action, antes do service. Excedeu → RATE_LIMITED.
 */
export function enforcePartnerTaxIdLimit(ctx: Pick<ServiceContext, "session" | "log">, limiter: SlidingWindowLimiter = partnerTaxIdLimiter): void {
  if (!isPartner(ctx)) return;
  const result = limiter.consume(partnerTaxIdRules(ctx.session));
  if (!result.allowed) {
    ctx.log.warn("rate_limit.partner_tax_id", { retryAfterMs: result.retryAfterMs });
    throw new DomainError("RATE_LIMITED", RATE_LIMITED_MESSAGE);
  }
}

/* ------------------------------------------------------------------ */
/* Ações de segurança da própria conta (4.3.2)                         */
/* ------------------------------------------------------------------ */

/** Encerrar sessões: poucas por minuto por usuário (cada uma audita e avisa). */
export const ACCOUNT_SECURITY_LIMITS = { windowMs: 60_000, perUser: 5 } as const;

const accountSecurityLimiter = new SlidingWindowLimiter(ACCOUNT_SECURITY_LIMITS.windowMs);

export const ACCOUNT_SECURITY_RATE_LIMITED_MESSAGE = "Muitas ações de segurança em pouco tempo. Aguarde um minuto e tente novamente.";

export function enforceAccountSecurityLimit(ctx: Pick<ServiceContext, "session" | "log">, limiter: SlidingWindowLimiter = accountSecurityLimiter): void {
  const result = limiter.consume([{ key: `account-security:user:${ctx.session.userId}`, limit: ACCOUNT_SECURITY_LIMITS.perUser }]);
  if (!result.allowed) {
    ctx.log.warn("rate_limit.account_security", { retryAfterMs: result.retryAfterMs });
    throw new DomainError("RATE_LIMITED", ACCOUNT_SECURITY_RATE_LIMITED_MESSAGE);
  }
}

/* ------------------------------------------------------------------ */
/* Limite contado no banco (vale para todas as instâncias) — 065       */
/* ------------------------------------------------------------------ */

/** Limites que o banco conhece (lista fechada em private.consume_rate_limit). */
export type SharedLimitScope = "lookup.cpf";

/**
 * Consome UM uso do limite no banco, com o JWT do usuário (a chave é o id da
 * pessoa, decidido pelo banco). Excedeu → RATE_LIMITED.
 *
 * Se o banco não responder ou a função ainda não existir (migration 065 não
 * aplicada), vale o `fallback`: o contador em memória de sempre. Nunca fica
 * sem limite nenhum, e uma falha do contador não impede a consulta.
 */
export async function enforceSharedLimit(
  ctx: Pick<ServiceContext, "db" | "log">,
  scope: SharedLimitScope,
  fallback: () => void,
  message: string = RATE_LIMITED_MESSAGE,
): Promise<void> {
  let allowed: boolean | null = null;
  let technicalCode: string | null = null;
  try {
    const { data, error } = await ctx.db.rpc("consume_rate_limit", { p_scope: scope });
    const answer = data as { allowed?: unknown } | null;
    if (!error && typeof answer?.allowed === "boolean") allowed = answer.allowed;
    else technicalCode = error?.code ?? "sem_resposta";
  } catch {
    technicalCode = "excecao";
  }
  if (allowed === null) {
    ctx.log.warn("rate_limit.shared_unavailable", { scope, technicalCode });
    fallback();
    return;
  }
  if (!allowed) {
    ctx.log.warn("rate_limit.shared", { scope });
    throw new DomainError("RATE_LIMITED", message);
  }
}
