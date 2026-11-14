import { createHash, randomBytes } from "node:crypto";
import type { ServiceContext } from "@/server/core/context";
import { fromDbError } from "@/server/core/db-errors";
import { DomainError } from "@/server/core/errors";
import { enforceAccountSecurityLimit } from "@/server/core/rate-limit";

/**
 * Setup do escritório (072): os agentes do kit, os scripts e os dados de quem
 * assina, guardados no DG Brasil. Só a DONA do escritório (o primeiro ADMIN do
 * escritório principal) vê o botão, em Sua conta e sessões; quem decide é o
 * banco (can_use_office_setup / dg_issue_office_setup).
 *
 * "Autorizar" devolve um comando para colar no PowerShell: leva um código de uso
 * único (15 minutos, uma vez) e chama o /executor/setup.ps1, que troca o código
 * pelo pacote em /api/setup/v1/baixar. Nem os agentes nem o token do computador
 * vão no comando. O código só chega ao banco como SHA-256.
 */

export const SETUP_CODE = /^dgs_[A-Za-z0-9_-]{40,60}$/;

export function newSetupCode(): string {
  return `dgs_${randomBytes(32).toString("base64url")}`;
}

export const setupCodeHash = (code: string) => createHash("sha256").update(code).digest("hex");

/** Endereço do site, para o comando voltar a ele. Só https (ou http em localhost). */
export function setupOrigin(host: string | null | undefined, proto: string | null | undefined): string {
  const h = (host ?? "").trim().toLowerCase();
  if (!/^[a-z0-9.-]{1,200}(:\d{1,5})?$/.test(h)) throw new DomainError("VALIDATION", "Endereço do site inválido.");
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h);
  const p = (proto ?? "").split(",")[0].trim();
  return `${local && p !== "https" ? "http" : "https"}://${h}`;
}

/**
 * O comando para colar no PowerShell: roda o setup.ps1 do site com o código.
 * Não é arquivo baixado: o Windows 11 bloqueia .cmd vindo da internet (Controle
 * Inteligente de Aplicativos), e colar o comando é o mesmo caminho do
 * instalador do conector. O código e o endereço vão entre aspas simples do
 * PowerShell: os dois já foram validados (só letras, números, ponto, hífen,
 * sublinhado, dois-pontos e barra).
 */
export function setupCommand(origin: string, code: string): string {
  if (!SETUP_CODE.test(code)) throw new Error("código do setup inválido");
  if (!/^https?:\/\/[a-z0-9.-]+(:\d+)?$/.test(origin)) throw new Error("endereço do setup inválido");
  return `$env:DG_SETUP_CODE='${code}'; $env:DG_BRASIL_URL='${origin}'; irm '${origin}/executor/setup.ps1' | iex`;
}

export async function canUseOfficeSetup(ctx: ServiceContext): Promise<boolean> {
  const { data, error } = await ctx.db.rpc("can_use_office_setup");
  if (error) throw fromDbError(error);
  return data === true;
}

export interface OfficeSetupCommandDTO {
  command: string;
  version: string;
}

export async function issueOfficeSetup(ctx: ServiceContext, origin: string): Promise<OfficeSetupCommandDTO> {
  enforceAccountSecurityLimit(ctx);
  const code = newSetupCode();
  const { data, error } = await ctx.db.rpc("dg_issue_office_setup", { p_code_hash: setupCodeHash(code) });
  if (error) throw fromDbError(error);
  const version = String((data as { version?: unknown } | null)?.version ?? "");
  ctx.log.info("account.office_setup_issued", { version });
  return { command: setupCommand(origin, code), version };
}
