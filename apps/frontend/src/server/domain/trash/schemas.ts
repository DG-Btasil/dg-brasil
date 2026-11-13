import { z } from "zod";
import { pageInputSchema } from "@/server/core/pagination";
import { zUuid } from "@/server/core/validation";

/** O que a Lixeira guarda: cliente, processo e documento (os três têm exclusão lógica pela tela). */
export const TRASH_KINDS = ["CLIENT", "PROCESS", "DOCUMENT"] as const;
export type TrashKind = (typeof TRASH_KINDS)[number];

export const listTrashSchema = pageInputSchema.extend({
  kind: z.enum(TRASH_KINDS),
  /** Nome/título; só dígitos (com ou sem máscara) = CPF/CNPJ do cliente ou trecho do número CNJ. */
  q: z.string().trim().max(120).optional(),
});
export type ListTrashInput = z.infer<typeof listTrashSchema>;

export const restoreTrashSchema = z.object({ kind: z.enum(TRASH_KINDS), id: zUuid() });
export type RestoreTrashInput = z.infer<typeof restoreTrashSchema>;
