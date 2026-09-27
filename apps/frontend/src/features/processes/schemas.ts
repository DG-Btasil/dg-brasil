import { z } from "zod";
import { CLIENT_POLES, DEADLINE_TYPES, PROCESS_PHASES, PROCESS_STATUSES } from "@/lib/constants/status";
import { LEGAL_AREAS } from "@/lib/constants/legal";
import { msg, zCnjOptional, zCurrencyOptional, zRequired } from "@/lib/validation";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const optionalDate = z
  .string()
  .optional()
  .refine((v) => !v || isoDate.test(v), msg.date);

const requiredEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values, { error: () => ({ message: msg.required }) });

/** Formulário de cadastro manual de processo. */
export const processFormSchema = z
  .object({
    clientId: zRequired("Selecione o cliente."),
    cnj: zCnjOptional(),
    title: zRequired("Informe um nome resumido para o processo."),
    court: z.string().optional(),
    unit: z.string().optional(),
    district: z.string().optional(),
    state: z.string().optional(),
    area: requiredEnum(LEGAL_AREAS),
    actionType: zRequired("Informe o tipo de ação."),
    subject: z.string().optional(),
    clientPole: requiredEnum(CLIENT_POLES),
    opposingParty: z.string().optional(),
    responsibleUserId: zRequired("Selecione o advogado responsável."),
    distributionDate: optionalDate,
    caseValue: zCurrencyOptional(),
    status: requiredEnum(PROCESS_STATUSES),
    phase: requiredEnum(PROCESS_PHASES),
    deadlineTitle: z.string().optional(),
    deadlineType: z.union([z.enum(DEADLINE_TYPES), z.literal("")]).optional(),
    deadlineDueDate: optionalDate,
    notes: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const anyDeadline = Boolean(data.deadlineTitle?.trim() || data.deadlineType || data.deadlineDueDate);
    if (!anyDeadline) return;
    if (!data.deadlineTitle?.trim()) ctx.addIssue({ code: "custom", path: ["deadlineTitle"], message: "Informe o título do prazo." });
    if (!data.deadlineType) ctx.addIssue({ code: "custom", path: ["deadlineType"], message: "Selecione o tipo do prazo." });
    if (!data.deadlineDueDate) ctx.addIssue({ code: "custom", path: ["deadlineDueDate"], message: "Informe o vencimento." });
  });

export type ProcessFormInput = z.input<typeof processFormSchema>;
export type ProcessFormValues = z.output<typeof processFormSchema>;

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
