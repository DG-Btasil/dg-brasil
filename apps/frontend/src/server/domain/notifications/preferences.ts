import { z } from "zod";
import type { ServiceContext } from "@/server/core/context";
import { fromDbError } from "@/server/core/db-errors";

/**
 * Preferências de notificação (4.3.1, migration 037) — a tabela que já existia
 * (user_notification_preferences) guarda uma linha por CATEGORIA; o resumo
 * por e-mail fica em user_preferences.digest. Sempre do PRÓPRIO usuário (o
 * id vem da sessão; a RLS confere com aal2).
 *
 * In-app é respeitado pelo produtor do banco na hora de gravar o aviso.
 * E-mail e resumo são GUARDADOS para quando o envio existir: nenhum e-mail é
 * enviado nesta etapa. SECURITY (conta) não se desliga na plataforma — o
 * banco recusa (constraint) e este service nem tenta.
 */

export const NOTIFICATION_CATEGORIES = ["CASES", "DEADLINES", "DOCUMENTS", "REVIEWS", "PARTNER_REQUESTS", "ANALYSES", "FINANCE", "SECURITY"] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export const DIGEST_FREQUENCIES = ["NONE", "DAILY", "WEEKLY"] as const;
export type DigestFrequency = (typeof DIGEST_FREQUENCIES)[number];

export interface CategoryPreference {
  category: NotificationCategory;
  inApp: boolean;
  email: boolean;
  /** SECURITY: sempre in-app (não editável). */
  locked: boolean;
}

export interface NotificationPreferencesDTO {
  categories: CategoryPreference[];
  digest: DigestFrequency;
  /** Há linha gravada (false = usando o padrão do sistema). */
  saved: boolean;
}

export const saveNotificationPreferencesSchema = z.object({
  categories: z
    .array(z.object({ category: z.enum(NOTIFICATION_CATEGORIES), inApp: z.boolean(), email: z.boolean() }))
    .max(NOTIFICATION_CATEGORIES.length)
    .refine((list) => new Set(list.map((c) => c.category)).size === list.length, "Categoria repetida."),
  digest: z.enum(DIGEST_FREQUENCIES),
});
export type SaveNotificationPreferencesInput = z.infer<typeof saveNotificationPreferencesSchema>;

/** Padrão do sistema: tudo na plataforma, nada por e-mail, sem resumo. */
export function defaultPreferences(): NotificationPreferencesDTO {
  return {
    categories: NOTIFICATION_CATEGORIES.map((category) => ({ category, inApp: true, email: false, locked: category === "SECURITY" })),
    digest: "NONE",
    saved: false,
  };
}

export function preferencesFromRows(rows: { notification_type: string; in_app: boolean; email: boolean }[], digest: string | null): NotificationPreferencesDTO {
  const byCategory = new Map(rows.map((r) => [r.notification_type, r]));
  const base = defaultPreferences();
  return {
    categories: base.categories.map((c) => {
      const r = byCategory.get(c.category);
      return r ? { ...c, inApp: c.locked ? true : r.in_app, email: r.email } : c;
    }),
    digest: (DIGEST_FREQUENCIES as readonly string[]).includes(digest ?? "") ? (digest as DigestFrequency) : "NONE",
    saved: rows.length > 0 || (digest !== null && digest !== "NONE"),
  };
}

export async function getNotificationPreferences(ctx: ServiceContext): Promise<NotificationPreferencesDTO> {
  const userId = ctx.session.userId;
  const [prefs, general] = await Promise.all([
    ctx.db.from("user_notification_preferences").select("notification_type, in_app, email").eq("user_id", userId),
    ctx.db.from("user_preferences").select("digest").eq("user_id", userId).maybeSingle(),
  ]);
  if (prefs.error) throw fromDbError(prefs.error);
  if (general.error) throw fromDbError(general.error);
  return preferencesFromRows((prefs.data ?? []) as { notification_type: string; in_app: boolean; email: boolean }[], (general.data as { digest?: string } | null)?.digest ?? null);
}

/** Grava o estado final (todas as categorias enviadas). Segurança fica sempre in-app. */
export async function saveNotificationPreferences(ctx: ServiceContext, input: SaveNotificationPreferencesInput): Promise<NotificationPreferencesDTO> {
  const userId = ctx.session.userId;
  const rows = input.categories.map((c) => ({ user_id: userId, notification_type: c.category, in_app: c.category === "SECURITY" ? true : c.inApp, email: c.email }));
  if (rows.length > 0) {
    const { error } = await ctx.db.from("user_notification_preferences").upsert(rows, { onConflict: "user_id,notification_type" });
    if (error) throw fromDbError(error);
  }
  const { error } = await ctx.db.from("user_preferences").upsert({ user_id: userId, digest: input.digest }, { onConflict: "user_id" });
  if (error) throw fromDbError(error);
  ctx.log.info("notifications.preferences_saved", { categories: rows.length });
  return getNotificationPreferences(ctx);
}
