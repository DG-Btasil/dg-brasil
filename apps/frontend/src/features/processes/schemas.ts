import { z } from "zod";
import { CLIENT_POLES, DEADLINE_TYPES, HEARING_MODES, PROCESS_PHASES, PROCESS_STATUSES } from "@/lib/constants/status";
import { msg, zCnjOptional, zCurrencyOptional, zRequired } from "@/lib/validation";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const optionalDate = z
  .string()
  .optional()
  .refine((v) => !v || isoDate.test(v), msg.date);

const requiredEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values, { error: () => ({ message: msg.required }) });

/** Percentual digitado ("20", "12,5", "12,5%") → número; vazio → undefined; texto inválido → NaN. */
export function parsePercentInput(value: string | undefined): number | undefined {
  const v = value?.replace("%", "").trim();
  if (!v) return undefined;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

/** Percentual opcional 0–100, até 2 casas. */
const percentOptional = () =>
  z
    .string()
    .trim()
    .optional()
    .refine((v) => {
      const n = parsePercentInput(v);
      return n === undefined || (n >= 0 && n <= 100 && Math.round(n * 100) === Number((n * 100).toFixed(6)));
    }, msg.percent);

/**
 * Formulário de cadastro manual de processo. Sem nome próprio (o processo é
 * exibido com o título do caso) e sem prazo inicial (prazos na aba Prazos).
 */
export const processFormSchema = z
  .object({
    /** Todo processo pertence a um caso (o cliente é o do caso). */
    legalCaseId: zRequired("Selecione o caso relacionado."),
    cnj: zCnjOptional(),
    court: z.string().optional(),
    unit: z.string().optional(),
    district: z.string().optional(),
    state: z.string().optional(),
    actionType: zRequired("Informe o tipo de ação."),
    subject: z.string().optional(),
    clientPole: requiredEnum(CLIENT_POLES),
    opposingParty: z.string().optional(),
    responsibleUserId: zRequired("Selecione o advogado responsável."),
    distributionDate: optionalDate,
    caseValue: zCurrencyOptional(),
    /** Honorários do processo (R$) — dado interno, parceiro nunca vê. */
    feeAmount: zCurrencyOptional(),
    /** Honorários de êxito (% do proveito, 0–100) — dado interno. */
    feePercentage: percentOptional(),
    status: requiredEnum(PROCESS_STATUSES),
    phase: requiredEnum(PROCESS_PHASES),
    notes: z.string().optional(),
  });

export type ProcessFormInput = z.input<typeof processFormSchema>;
export type ProcessFormValues = z.output<typeof processFormSchema>;

/** Edição: o caso do processo não muda. */
export const processEditSchema = processFormSchema.omit({ legalCaseId: true });
export type ProcessEditInput = z.input<typeof processEditSchema>;
export type ProcessEditValues = z.output<typeof processEditSchema>;

/** "Registrar andamento". */
export const processEventSchema = z.object({
  title: zRequired("Informe o título do andamento."),
  description: z.string().optional(),
  important: z.boolean(),
});
export type ProcessEventValues = z.infer<typeof processEventSchema>;

/**
 * "Adicionar prazo" e "Editar prazo". Audiência pede hora e modalidade (local e
 * link ajudam, mas podem ficar para depois); nos outros tipos o prazo vale até
 * o fim do dia e os campos de audiência nem aparecem.
 */
export const deadlineSchema = z
  .object({
    title: zRequired("Informe o título do prazo."),
    type: requiredEnum(DEADLINE_TYPES),
    dueDate: z.string().refine((v) => isoDate.test(v), "Informe o vencimento."),
    dueTime: z.string().optional(),
    responsibleUserId: zRequired("Selecione o responsável."),
    hearingMode: z.string().optional(),
    hearingLocation: z.string().max(500, "Máximo de 500 caracteres.").optional(),
    hearingLink: z.string().max(1000, "Máximo de 1000 caracteres.").optional(),
    notes: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type !== "HEARING") return;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.dueTime ?? "")) ctx.addIssue({ code: "custom", path: ["dueTime"], message: "Informe a hora da audiência." });
    if (!(HEARING_MODES as readonly string[]).includes(v.hearingMode ?? "")) ctx.addIssue({ code: "custom", path: ["hearingMode"], message: "Selecione a modalidade." });
    const link = v.hearingLink?.trim();
    if (link && !/^https?:\/\/\S+$/i.test(link)) ctx.addIssue({ code: "custom", path: ["hearingLink"], message: "Informe um link que comece com http:// ou https://." });
  });
export type DeadlineFormInput = z.input<typeof deadlineSchema>;
export type DeadlineFormValues = z.output<typeof deadlineSchema>;

/**
 * Formulário de prazo → campos das Server Actions (o servidor valida de novo).
 * Fora da audiência, hora e dados de audiência não são enviados.
 */
export function deadlineFormFields(v: DeadlineFormValues) {
  const hearing = v.type === "HEARING";
  return {
    title: v.title.trim(),
    type: v.type,
    dueDate: v.dueDate,
    dueTime: hearing ? v.dueTime : undefined,
    responsibleUserId: v.responsibleUserId,
    description: v.notes?.trim() ?? "",
    hearingMode: hearing ? v.hearingMode : undefined,
    hearingLocation: hearing ? (v.hearingLocation?.trim() ?? "") : undefined,
    hearingLink: hearing ? (v.hearingLink?.trim() ?? "") : undefined,
  };
}
