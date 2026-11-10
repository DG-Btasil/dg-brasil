"use server";

import { z } from "zod";
import { runAction } from "@/server/core/action";
import type { ServiceContext } from "@/server/core/context";
import { DomainError } from "@/server/core/errors";
import { cpfCheckDigitsOk } from "@/lib/validation";
import { SlidingWindowLimiter } from "@/server/core/rate-limit";
import { CpfBirthMismatch, cpfLookupConfigured, lookupCep, lookupCnpj, lookupCpf, type AddressLookup, type CompanyLookup, type PersonLookup } from "./providers";

/**
 * Consultas do preenchimento automático (CEP, CNPJ, CPF). Qualquer sessão
 * liberada (equipe ou parceiro) pode consultar ao cadastrar. Limite por
 * usuário (memória da instância, best-effort) para não virar ferramenta de
 * varredura — a consulta de CPF é paga por chamada.
 */

const limiter = new SlidingWindowLimiter(60_000);
function throttle(ctx: ServiceContext, kind: string, perMinute: number) {
  const r = limiter.consume([{ key: `lookup:${kind}:${ctx.session.userId}`, limit: perMinute }]);
  if (!r.allowed) throw new DomainError("RATE_LIMITED", "Muitas consultas em pouco tempo. Aguarde um minuto.");
}

export type LookupResult<T> = { found: true; data: T } | { found: false; reason: "NOT_FOUND" | "NOT_CONFIGURED" | "UNAVAILABLE" | "INVALID" | "BIRTH_MISMATCH" };

const cepSchema = z.object({ cep: z.string().regex(/^\d{5}-?\d{3}$/, "CEP com 8 dígitos.") });
const cnpjSchema = z.object({ cnpj: z.string().transform((v) => v.replace(/\D/g, "")).refine((v) => v.length === 14, "CNPJ com 14 dígitos.") });
const cpfSchema = z.object({
  cpf: z.string().transform((v) => v.replace(/\D/g, "")).refine((v) => v.length === 11, "CPF com 11 dígitos."),
  // A Consulta CPF v3 confere CPF e nascimento juntos.
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data de nascimento."),
});

export async function lookupCepAction(input: unknown) {
  return runAction({
    name: "lookup.cep",
    schema: cepSchema,
    input,
    handler: async (ctx, { cep }): Promise<LookupResult<AddressLookup>> => {
      throttle(ctx, "cep", 40);
      try {
        const data = await lookupCep(cep);
        return data ? { found: true, data } : { found: false, reason: "NOT_FOUND" };
      } catch {
        return { found: false, reason: "UNAVAILABLE" };
      }
    },
  });
}

export async function lookupCnpjAction(input: unknown) {
  return runAction({
    name: "lookup.cnpj",
    schema: cnpjSchema,
    input,
    handler: async (ctx, { cnpj }): Promise<LookupResult<CompanyLookup>> => {
      throttle(ctx, "cnpj", 20);
      try {
        const data = await lookupCnpj(cnpj);
        return data ? { found: true, data } : { found: false, reason: "NOT_FOUND" };
      } catch {
        return { found: false, reason: "UNAVAILABLE" };
      }
    },
  });
}

export async function lookupCpfAction(input: unknown) {
  return runAction({
    name: "lookup.cpf",
    schema: cpfSchema,
    input,
    handler: async (ctx, { cpf, birthDate }): Promise<LookupResult<PersonLookup>> => {
      if (!cpfLookupConfigured()) return { found: false, reason: "NOT_CONFIGURED" };
      // Dígito verificador errado: nem chega à Receita (a consulta é paga).
      if (!cpfCheckDigitsOk(cpf)) return { found: false, reason: "INVALID" };
      throttle(ctx, "cpf", 15);
      try {
        const data = await lookupCpf(cpf, birthDate);
        return data ? { found: true, data } : { found: false, reason: "NOT_FOUND" };
      } catch (error) {
        if (error instanceof CpfBirthMismatch) return { found: false, reason: "BIRTH_MISMATCH" };
        ctx.log.warn("lookup.cpf_failed", { reason: error instanceof Error ? error.message : "unknown" });
        return { found: false, reason: "UNAVAILABLE" };
      }
    },
  });
}
