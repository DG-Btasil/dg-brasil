import { z } from "zod";
import { GENDERS } from "@/lib/constants/legal";
import { isCnpjFormat, isCpfFormat, msg, zCepOptional, zCnpj, zCpf, zPhone, zPhoneOptional, zRequired } from "@/lib/validation";
import type { Address, CompanyClient, IndividualClient } from "@/types";

/*
 * Os formulários trabalham só com strings (valores de inputs); a conversão
 * para o modelo de domínio acontece em to*Input, onde vazio vira undefined.
 */

const text = () => z.string().trim();
const optionalEmail = () => text().refine((v) => !v || z.string().email().safeParse(v).success, msg.email);

export const addressSchema = z.object({
  zipCode: zCepOptional(),
  street: text(),
  number: text(),
  complement: text(),
  district: text(),
  city: text(),
  state: text(),
  country: text(),
});

export const individualSchema = z.object({
  fullName: zRequired("Informe o nome completo."),
  socialName: text(),
  cpf: zCpf(),
  idType: text(),
  idNumber: text(),
  idIssuer: text(),
  idState: text(),
  birthDate: text(),
  nationality: text(),
  birthplace: text(),
  gender: z.enum(["", ...GENDERS]),
  maritalStatus: text(),
  stableUnion: z.enum(["", "yes", "no"]),
  profession: text(),
  email: optionalEmail(),
  phone: zPhone(),
  secondaryPhone: zPhoneOptional(),
  address: addressSchema,
  responsibleUserId: zRequired("Selecione o responsável."),
  originOfficeId: zRequired("Selecione a origem do cliente."),
  legalSummary: text(),
  notes: text(),
});
export type IndividualFormValues = z.infer<typeof individualSchema>;

/**
 * Documento de identidade é um bloco: tipo e número andam juntos (o banco
 * exige os dois ou nenhum). Emissor/UF sem tipo e número não são gravados;
 * para apagar o documento, deixe tipo e número vazios.
 */
export const individualFormSchema = individualSchema.superRefine((v, ctx) => {
  const hasType = !!v.idType.trim();
  const hasNumber = !!v.idNumber.trim();
  if (hasType && !hasNumber) ctx.addIssue({ code: "custom", path: ["idNumber"], message: "Informe o número do documento (ou limpe o tipo)." });
  if (!hasType && hasNumber) ctx.addIssue({ code: "custom", path: ["idType"], message: "Selecione o tipo do documento (ou limpe o número)." });
  if (!hasType && !hasNumber && (v.idIssuer.trim() || v.idState.trim())) {
    ctx.addIssue({ code: "custom", path: ["idNumber"], message: "Informe tipo e número, ou limpe também emissor e UF." });
  }
});

const representativeSchema = z.object({
  id: z.string(),
  name: zRequired("Informe o nome do representante."),
  cpf: zCpf(),
  role: zRequired("Informe o cargo."),
  email: optionalEmail(),
  phone: zPhoneOptional(),
  isPrimary: z.boolean(),
});

const partnerSchema = z.object({
  id: z.string(),
  name: zRequired("Informe o nome do sócio."),
  document: text().refine((v) => !v || isCpfFormat(v) || isCnpjFormat(v), "Informe um CPF (11 dígitos) ou CNPJ (14 dígitos)."),
  qualification: text(),
  sharePercent: text().refine((v) => {
    if (!v) return true;
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) && n >= 0 && n <= 100;
  }, msg.percent),
});

export const companySchema = z.object({
  legalName: zRequired("Informe a razão social."),
  tradeName: text(),
  cnpj: zCnpj(),
  registrationStatus: text(),
  openingDate: text(),
  legalNature: text(),
  mainCnae: text(),
  secondaryCnaes: text(),
  email: optionalEmail(),
  phone: zPhone(),
  website: text(),
  address: addressSchema,
  representatives: z
    .array(representativeSchema)
    .min(1, "Cadastre ao menos um representante legal.")
    .refine((list) => list.filter((r) => r.isPrimary).length === 1, "Marque exatamente um representante como principal."),
  partners: z.array(partnerSchema),
  responsibleUserId: zRequired("Selecione o responsável."),
  originOfficeId: zRequired("Selecione a origem do cliente."),
  legalSummary: text(),
  notes: text(),
});
export type CompanyFormValues = z.infer<typeof companySchema>;
export type AddressFormValues = z.infer<typeof addressSchema>;

/* ------------------------------------------------------------------ */
/* Conversões                                                          */
/* ------------------------------------------------------------------ */

const opt = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

export const EMPTY_ADDRESS: AddressFormValues = { zipCode: "", street: "", number: "", complement: "", district: "", city: "", state: "", country: "Brasil" };

export function toAddress(a: AddressFormValues): Address | undefined {
  const filled = [a.zipCode, a.street, a.number, a.district, a.city, a.state].some((v) => v && v.trim());
  if (!filled) return undefined;
  return {
    zipCode: a.zipCode ?? "",
    street: a.street,
    number: a.number,
    complement: opt(a.complement),
    district: a.district,
    city: a.city,
    state: a.state,
    country: a.country || "Brasil",
  };
}

export function fromAddress(a: Address | undefined): AddressFormValues {
  if (!a) return EMPTY_ADDRESS;
  // O banco guarda o código ISO ("BR"); o formulário mostra o nome.
  const country = !a.country || a.country.toUpperCase() === "BR" ? "Brasil" : a.country;
  return { ...a, complement: a.complement ?? "", country };
}

export function emptyIndividualValues(responsibleUserId = "", originOfficeId = ""): IndividualFormValues {
  return {
    fullName: "", socialName: "", cpf: "", idType: "", idNumber: "", idIssuer: "", idState: "", birthDate: "",
    nationality: "Brasileira", birthplace: "", gender: "", maritalStatus: "", stableUnion: "", profession: "",
    email: "", phone: "", secondaryPhone: "", address: EMPTY_ADDRESS, responsibleUserId, originOfficeId, legalSummary: "", notes: "",
  };
}


export function individualToValues(c: IndividualClient): IndividualFormValues {
  return {
    fullName: c.fullName,
    socialName: c.socialName ?? "",
    cpf: c.cpf,
    idType: c.identityDocument?.type ?? "",
    idNumber: c.identityDocument?.number ?? "",
    idIssuer: c.identityDocument?.issuer ?? "",
    idState: c.identityDocument?.state ?? "",
    birthDate: c.birthDate ?? "",
    nationality: c.nationality ?? "",
    birthplace: c.birthplace ?? "",
    gender: c.gender ?? "",
    maritalStatus: c.maritalStatus ?? "",
    stableUnion: c.stableUnion === undefined ? "" : c.stableUnion ? "yes" : "no",
    profession: c.profession ?? "",
    email: c.contact.email ?? "",
    phone: c.contact.phone ?? "",
    secondaryPhone: c.contact.secondaryPhone ?? "",
    address: fromAddress(c.address),
    responsibleUserId: c.responsibleUserId,
    originOfficeId: c.originOfficeId ?? "",
    legalSummary: c.legalSummary ?? "",
    notes: c.notes ?? "",
  };
}

/**
 * Item novo: `id` vazio. Só linha que já existe no banco tem id (o do banco);
 * a chave visual da lista é do useFieldArray (keyName "key"), não um id de domínio.
 */
export function newRepresentative(isPrimary: boolean): CompanyFormValues["representatives"][number] {
  return { id: "", name: "", cpf: "", role: "", email: "", phone: "", isPrimary };
}

export function newPartner(): CompanyFormValues["partners"][number] {
  return { id: "", name: "", document: "", qualification: "", sharePercent: "" };
}

/** Só o bloco societário (edição própria, operação atômica da 028). */
export const companyPeopleSchema = companySchema.pick({ representatives: true, partners: true });
export type CompanyPeopleFormValues = z.infer<typeof companyPeopleSchema>;

export function companyPeopleToValues(c: CompanyClient): CompanyPeopleFormValues {
  const v = companyToValues(c);
  return { representatives: v.representatives, partners: v.partners };
}

export function emptyCompanyValues(responsibleUserId = "", originOfficeId = ""): CompanyFormValues {
  return {
    legalName: "", tradeName: "", cnpj: "", registrationStatus: "", openingDate: "", legalNature: "", mainCnae: "",
    secondaryCnaes: "", email: "", phone: "", website: "", address: EMPTY_ADDRESS,
    representatives: [newRepresentative(true)], partners: [], responsibleUserId, originOfficeId, legalSummary: "", notes: "",
  };
}


export function companyToValues(c: CompanyClient): CompanyFormValues {
  return {
    legalName: c.legalName,
    tradeName: c.tradeName ?? "",
    cnpj: c.cnpj,
    registrationStatus: c.registrationStatus ?? "",
    openingDate: c.openingDate ?? "",
    legalNature: c.legalNature ?? "",
    mainCnae: c.mainCnae ?? "",
    secondaryCnaes: (c.secondaryCnaes ?? []).join("\n"),
    email: c.contact.email ?? "",
    phone: c.contact.phone ?? "",
    website: c.contact.website ?? "",
    address: fromAddress(c.address),
    representatives: c.representatives.length
      ? c.representatives.map((r) => ({ ...r, email: r.email ?? "", phone: r.phone ?? "" }))
      : [newRepresentative(true)],
    partners: c.partners.map((p) => ({
      id: p.id,
      name: p.name,
      document: p.document,
      qualification: p.qualification,
      sharePercent: p.sharePercent === undefined ? "" : String(p.sharePercent).replace(".", ","),
    })),
    responsibleUserId: c.responsibleUserId,
    originOfficeId: c.originOfficeId ?? "",
    legalSummary: c.legalSummary ?? "",
    notes: c.notes ?? "",
  };
}
