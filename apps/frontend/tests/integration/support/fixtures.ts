import type { z } from "zod";
import type { partnerClientSchema } from "@/server/domain/cases/schemas";
import type { createClientSchema } from "@/server/domain/clients/schemas";
import { world } from "./world";

/**
 * Cadastros válidos para o Roadmap 2.0 (migration 045 e schemas do servidor):
 * cliente NOVO exige e-mail, endereço completo (CEP, logradouro, número,
 * bairro, município e UF), telefone no portal (QA R2-14) e, na PF,
 * nacionalidade, estado civil e profissão. Sem responsável e sem união estável (colunas apagadas), e PJ sem situação
 * cadastral, CNAEs e site.
 *
 * Cada helper devolve a ENTRADA do schema (ainda não validada): o teste chama
 * `createClientSchema.parse(...)` / `partnerSubmitCaseSchema.parse(...)` como
 * a tela faz. `contact` e `address` dos overrides são mesclados com o padrão.
 */

type ClientInput = z.input<typeof createClientSchema>;
type PfInput = Extract<ClientInput, { kind: "INDIVIDUAL" }>;
type PjInput = Extract<ClientInput, { kind: "COMPANY" }>;
type PartnerClientInput = z.input<typeof partnerClientSchema>;
type PartnerPfInput = Extract<PartnerClientInput, { kind: "INDIVIDUAL" }>;
type PartnerPjInput = Extract<PartnerClientInput, { kind: "COMPANY" }>;

type Overrides<T extends { contact?: unknown; address?: unknown }> = Partial<Omit<T, "kind" | "contact" | "address">> & {
  contact?: Partial<NonNullable<T["contact"]>>;
  address?: Partial<NonNullable<T["address"]>>;
};

/** Endereço completo fictício (o mesmo da tela de exemplo). */
export const TEST_ADDRESS = { zipCode: "01001000", street: "Praça da Sé", number: "1", district: "Sé", city: "São Paulo", state: "SP" } as const;

export const TEST_EMAIL = "cliente.teste@dgbrasil.test";
/** Telefone com DDD: o portal exige no cliente novo (QA R2-14); no escritório vai junto, como a tela. */
export const TEST_PHONE = "11999990000";

/** Cliente PF novo (equipe interna), origem = escritório proprietário. */
export function validPfClient(cpf: string, over: Overrides<PfInput> = {}): PfInput {
  const { contact, address, ...rest } = over;
  return {
    kind: "INDIVIDUAL",
    cpf,
    fullName: "Cliente Teste",
    nationality: "Brasileira",
    maritalStatus: "SINGLE",
    profession: "Aposentada",
    originOfficeId: world.owner,
    ...rest,
    contact: { email: TEST_EMAIL, phone: TEST_PHONE, ...contact },
    address: { ...TEST_ADDRESS, ...address },
  };
}

/** Cliente PJ novo (equipe interna), origem = escritório proprietário. */
export function validPjClient(cnpj: string, over: Overrides<PjInput> = {}): PjInput {
  const { contact, address, ...rest } = over;
  return {
    kind: "COMPANY",
    cnpj,
    legalName: "Empresa Teste Ltda",
    originOfficeId: world.owner,
    ...rest,
    contact: { email: TEST_EMAIL, phone: TEST_PHONE, ...contact },
    address: { ...TEST_ADDRESS, ...address },
  };
}

/** Cliente PF NOVO no envio de caso do portal (partnerSubmitCaseSchema). */
export function validPartnerPfClient(document: string, over: Overrides<PartnerPfInput> = {}): PartnerPfInput {
  const { address, ...rest } = over;
  return {
    kind: "INDIVIDUAL",
    document,
    fullName: "Cliente do Parceiro",
    nationality: "Brasileira",
    maritalStatus: "SINGLE",
    profession: "Aposentada",
    email: TEST_EMAIL,
    phone: TEST_PHONE,
    ...rest,
    address: { ...TEST_ADDRESS, ...address },
  };
}

/** Cliente PJ NOVO no envio de caso do portal (partnerSubmitCaseSchema). */
export function validPartnerPjClient(document: string, over: Overrides<PartnerPjInput> = {}): PartnerPjInput {
  const { address, ...rest } = over;
  return {
    kind: "COMPANY",
    document,
    legalName: "Empresa do Parceiro Ltda",
    email: TEST_EMAIL,
    phone: TEST_PHONE,
    ...rest,
    address: { ...TEST_ADDRESS, ...address },
  };
}
