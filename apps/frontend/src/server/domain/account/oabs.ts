import "server-only";

import { unwrap } from "@/server/core/db-errors";
import type { ServiceContext } from "@/server/core/context";

/** OABs da própria pessoa (Roadmap 2.0, 048). O usuário vem do JWT: nunca do navegador. */

export interface MyOabDTO {
  id: string;
  number: string;
  state: string;
  isPrimary: boolean;
}

export async function listMyOabs(ctx: ServiceContext): Promise<MyOabDTO[]> {
  const rows = (unwrap(
    await ctx.db.from("profile_oabs").select("id, oab_number, oab_state, is_primary").eq("user_id", ctx.session.userId).order("is_primary", { ascending: false }).order("created_at"),
  ) ?? []) as { id: string; oab_number: string; oab_state: string; is_primary: boolean }[];
  return rows.map((r) => ({ id: r.id, number: r.oab_number, state: r.oab_state, isPrimary: r.is_primary }));
}

export async function addMyOab(ctx: ServiceContext, input: { number: string; state: string; primary: boolean }): Promise<void> {
  unwrap(await ctx.db.rpc("add_my_oab", { p_number: input.number, p_state: input.state, p_primary: input.primary }));
}

export async function removeMyOab(ctx: ServiceContext, input: { id: string }): Promise<void> {
  unwrap(await ctx.db.rpc("remove_my_oab", { p_id: input.id }));
}

export async function setMyPrimaryOab(ctx: ServiceContext, input: { id: string }): Promise<void> {
  unwrap(await ctx.db.rpc("set_my_primary_oab", { p_id: input.id }));
}
