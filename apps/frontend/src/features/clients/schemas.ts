import { z } from "zod";
import { ACQUISITION_CHANNELS, GENDERS } from "@/lib/constants/legal";
import { isCepFormat, isCnpjFormat, isCpfFormat, msg, zCepOptional, zCnpj, zCpf, zEmail, zPhone, zPhoneOptional, zRequired } from "@/lib/validation";
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

/**
 * Endereço completo é obrigatório no cadastro (Roadmap 2.0): CEP, logradouro,
 * número, bairro, município e UF. Complemento continua opcional.
 */
export const requiredAddressSchema = z.object({
  zipCode: zRequired("Informe o CEP.").refine(isCepFormat, msg.cep),
  street: zRequired("Informe o logradouro."),
  number: zRequired("Informe o número (ou S/N)."),
  complement: text(),
  district: zRequired("Informe o bairro."),
  city: zRequired("Informe o município."),
  state: zRequired("Selecione a UF."),
  country: text(),
});

/** Canal de aquisição: vazio ou um da lista (o banco confere de novo). */
const channel = () => z.enum(["", ...ACQUISITION_CHANNELS]);

export const individualSchema = z.object({
  fullName: zRequired("Informe o nome completo."),
  socialName: text(),
  cpf: zCpf(),
  idType: text(),
  idNumber: text(),
  idIssuer: text(),
  idState: text(),
  birthDate: text(),
  nationality: zRequired("Informe a nacionalidade."),
  birthplace: text(),
  gender: z.enum(["", ...GENDERS]),
  maritalStatus: zRequired("Selecione o estado civil."),
  profession: zRequired("Informe a profissão."),
  email: zEmail(),
  phone: zPhone(),
  secondaryPhone: zPhoneOptional(),
  address: requiredAddressSchema,
  originOfficeId: zRequired("Selecione o escritório de origem."),
  acquisitionChannel: channel(),
  acquisitionDetail: text().max(300, "Até 300 caracteres."),
  legalSummary: text(),
  notes: text(),
});
export type IndividualFormValues = z.infer<typeof individualSchema>;

/**
 * Documento de identidade é OPCIONAL. Sem número, nada do bloco é gravado
 * (tipo, emissor e UF soltos são ignorados, sem erro). Com número, o tipo é
 * necessário (o banco guarda os dois juntos).
 */
export const individualFormSchema = individualSchema.superRefine((v, ctx) => {
  const hasType = !!v.idType.trim();
  const hasNumber = !!v.idNumber.trim();
  if (!hasType && hasNumber) ctx.addIssue({ code: "custom", path: ["idType"], message: "Selecione o tipo do documento (ou limpe o número)." });
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
  openingDate: text(),
  legalNature: text(),
  email: zEmail(),
  phone: zPhone(),
  address: requiredAddressSchema,
  representatives: z
    .array(representativeSchema)
    .min(1, "Cadastre ao menos um representante legal.")
    .refine((list) => list.filter((r) => r.isPrimary).length === 1, "Marque exatamente um representante como principal."),
  partners: z.array(partnerSchema),
  originOfficeId: zRequired("Selecione o escritório de origem."),
  acquisitionChannel: channel(),
  acquisitionDetail: text().max(300, "Até 300 caracteres."),
  legalSummary: text(),
  notes: text(),
});
export type CompanyFormValues = z.infer<typeof companySchema>;
/** Endereço como os formulários de cliente guardam (todas as chaves presentes). */
export type AddressFormValues = z.infer<typeof requiredAddressSchema>;
/** Endereço de formulários em que ele é opcional (parceiros, edição antiga). */
export type LooseAddressFormValues = z.infer<typeof addressSchema>;

/* ------------------------------------------------------------------ */
/* Conversões                                                          */
/* ------------------------------------------------------------------ */

const opt = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

export const EMPTY_ADDRESS: AddressFormValues = { zipCode: "", street: "", number: "", complement: "", district: "", city: "", state: "", country: "Brasil" };

export function toAddress(a: LooseAddressFormValues): Address | undefined {
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
  return { ...a, zipCode: a.zipCode ?? "", complement: a.complement ?? "", country };
}

export function emptyIndividualValues(originOfficeId = ""): IndividualFormValues {
  return {
    fullName: "", socialName: "", cpf: "", idType: "", idNumber: "", idIssuer: "", idState: "", birthDate: "",
    nationality: "Brasileira", birthplace: "", gender: "", maritalStatus: "", profession: "",
    email: "", phone: "", secondaryPhone: "", address: EMPTY_ADDRESS, originOfficeId, acquisitionChannel: "", acquisitionDetail: "",
    legalSummary: "", notes: "",
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
    profession: c.profession ?? "",
    email: c.contact.email ?? "",
    phone: c.contact.phone ?? "",
    secondaryPhone: c.contact.secondaryPhone ?? "",
    address: fromAddress(c.address),
    originOfficeId: c.originOfficeId ?? "",
    acquisitionChannel: c.acquisitionChannel ?? "",
    acquisitionDetail: c.acquisitionDetail ?? "",
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

export function emptyCompanyValues(originOfficeId = ""): CompanyFormValues {
  return {
    legalName: "", tradeName: "", cnpj: "", openingDate: "", legalNature: "", email: "", phone: "", address: EMPTY_ADDRESS,
    representatives: [newRepresentative(true)], partners: [], originOfficeId, acquisitionChannel: "", acquisitionDetail: "",
    legalSummary: "", notes: "",
  };
}


export function companyToValues(c: CompanyClient): CompanyFormValues {
  return {
    legalName: c.legalName,
    tradeName: c.tradeName ?? "",
    cnpj: c.cnpj,
    openingDate: c.openingDate ?? "",
    legalNature: c.legalNature ?? "",
    email: c.contact.email ?? "",
    phone: c.contact.phone ?? "",
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
    originOfficeId: c.originOfficeId ?? "",
    acquisitionChannel: c.acquisitionChannel ?? "",
    acquisitionDetail: c.acquisitionDetail ?? "",
    legalSummary: c.legalSummary ?? "",
    notes: c.notes ?? "",
  };
}
