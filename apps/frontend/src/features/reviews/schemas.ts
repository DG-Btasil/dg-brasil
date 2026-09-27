import { z } from "zod";

export const approveSchema = z.object({
  comment: z.string().max(1000, "Use no máximo 1.000 caracteres.").optional(),
});
export type ApproveValues = z.infer<typeof approveSchema>;

export const changesSchema = z.object({
  comment: z
    .string()
    .trim()
    .min(1, "Descreva as alterações que o agente deve fazer.")
    .min(15, "Detalhe um pouco mais as alterações (mínimo de 15 caracteres)."),
});
export type ChangesValues = z.infer<typeof changesSchema>;

export const rejectSchema = z.object({
  comment: z
    .string()
    .trim()
    .min(1, "Informe o motivo da rejeição.")
    .min(10, "Explique o motivo com um pouco mais de detalhe (mínimo de 10 caracteres)."),
});
export type RejectValues = z.infer<typeof rejectSchema>;
