"use server";

import { sanitizeForLog } from "@/lib/auth/errors";
import { firstCompletion } from "@/lib/onboarding";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "./auth/actions";
import { AuthorizationError, authorizeAction } from "./auth/session";

/**
 * Introdução do produto (tour): estado POR USUÁRIO no banco
 * (`user_preferences.tour_completed_at`, RLS: só o próprio, com aal2).
 */

/** Data em que o usuário concluiu ou pulou a introdução; `null` = nunca. */
export async function getProductTourCompletedAt(): Promise<string | null> {
  const session = await authorizeAction();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("user_preferences")
    .select("tour_completed_at")
    .eq("user_id", session.userId)
    .maybeSingle();
  if (error) {
    // Na dúvida, não insiste com a introdução (falha de leitura não pode virar laço).
    console.error("[tour] leitura", sanitizeForLog(error));
    return new Date(0).toISOString();
  }
  return (data?.tour_completed_at as string | null) ?? null;
}

/** Concluiu ou pulou. Idempotente: rever a introdução não muda a primeira data. */
export async function completeProductTour(): Promise<ActionResult<string>> {
  try {
    const session = await authorizeAction();
    const supabase = await createSupabaseServerClient();
    const { data: current } = await supabase
      .from("user_preferences")
      .select("tour_completed_at")
      .eq("user_id", session.userId)
      .maybeSingle();
    const completedAt = firstCompletion(current?.tour_completed_at as string | null, new Date());
    if (current?.tour_completed_at) return { ok: true, data: completedAt };
    const { error } = await supabase
      .from("user_preferences")
      .upsert({ user_id: session.userId, tour_completed_at: completedAt }, { onConflict: "user_id" });
    if (error) {
      console.error("[tour] gravação", sanitizeForLog(error));
      return { ok: false, error: "Não foi possível salvar. A introdução pode aparecer de novo no próximo acesso." };
    }
    return { ok: true, data: completedAt };
  } catch (error) {
    if (error instanceof AuthorizationError) return { ok: false, error: error.message };
    console.error("[tour] gravação", sanitizeForLog(error));
    return { ok: false, error: "Não foi possível salvar agora." };
  }
}
