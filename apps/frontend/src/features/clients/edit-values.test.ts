import { describe, expect, it } from "vitest";
import type { CompanyClient, IndividualClient } from "@/types";
import { companyToValues, individualToValues } from "./schemas";

describe("edição do cliente com as mesmas máscaras do cadastro (C8)", () => {
  it("pessoa física: CPF, telefones e CEP formatados", () => {
    const v = individualToValues({
      fullName: "Maria Fictícia",
      cpf: "01234567890",
      contact: { phone: "24999990000", secondaryPhone: "2422223333" },
      address: { zipCode: "25600000", street: "Rua A", number: "1", district: "Centro", city: "Petrópolis", state: "RJ", country: "BR" },
    } as unknown as IndividualClient);
    expect([v.cpf, v.phone, v.secondaryPhone, v.address.zipCode]).toEqual(["012.345.678-90", "(24) 99999-0000", "(24) 2222-3333", "25600-000"]);
  });

  it("pessoa jurídica: CNPJ, telefone e CPF do representante formatados", () => {
    const v = companyToValues({
      legalName: "Empresa Fictícia",
      cnpj: "11222333000181",
      contact: { phone: "24999990000" },
      representatives: [{ id: "r1", name: "João", cpf: "01234567890", role: "Sócio", phone: "24988887777", isPrimary: true }],
      partners: [{ id: "p1", name: "Sócia", document: "01234567890", qualification: "Sócia" }],
    } as unknown as CompanyClient);
    expect([v.cnpj, v.phone, v.representatives[0]?.cpf, v.representatives[0]?.phone, v.partners[0]?.document]).toEqual([
      "11.222.333/0001-81",
      "(24) 99999-0000",
      "012.345.678-90",
      "(24) 98888-7777",
      "012.345.678-90",
    ]);
  });
});
