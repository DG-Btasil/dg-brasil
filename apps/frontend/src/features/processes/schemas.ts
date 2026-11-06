import { z } from "zod";
import { CLIENT_POLES, DEADLINE_TYPES, PROCESS_PHASES, PROCESS_STATUSES } from "@/lib/constants/status";
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

/** "Adicionar prazo". */
export const deadlineSchema = z.object({
  title: zRequired("Informe o título do prazo."),
  type: requiredEnum(DEADLINE_TYPES),
  dueDate: z.string().refine((v) => isoDate.test(v), "Informe o vencimento."),
  responsibleUserId: zRequired("Selecione o responsável."),
  notes: z.string().optional(),
});
export type DeadlineFormInput = z.input<typeof deadlineSchema>;
export type DeadlineFormValues = z.output<typeof deadlineSchema>;
