import { describe, expect, it } from "vitest";
import { acceptedInviteMetadata, buildInviteMetadata, normalizePersonName, personNameProblem } from "./invite-metadata";
import { isInviteRef, mfaReturnPath } from "./redirects";

describe("nome de pessoa (mesma regra de private.valid_person_name, migration 023)", () => {
  const refused = [
    "X",
    "Acesse www.golpe.com",
    "João http://x.y",
    "Pague R$ 100",
    "Ana <b>",
    "Ana@mail",
    "Nome--Duplo",
    "Ana  .",
    "A".repeat(50) + " Silva",
    "1234",
    "'Ana",
  ];
  for (const name of refused) {
    it(`recusa ${JSON.stringify(name.slice(0, 24))}`, () => expect(personNameProblem(name)).not.toBeNull());
  }
  for (const name of ["Maria José da Silva", "Ana D'Ávila", "Dr. João Pereira-Lima", "Zoë Łukasiewicz", "J. R. Tolkien Jr.", "Conceição Brandão"]) {
    it(`aceita ${name}`, () => expect(personNameProblem(name)).toBeNull());
  }
  it("normaliza espaços", () => {
    expect(normalizePersonName("  Maria   José ")).toBe("Maria José");
  });
});

describe("dados de e-mail do convite", () => {
  it("monta saudação, papel do texto e marca de reconvite", () => {
    const m = buildInviteMetadata({ fullName: "Dra. Mariana Prado", role: "PARTNER_ADMIN", organizationName: "Almeida\u0007 Advogados", reinviteOfConfirmedAccount: true });
    expect(m).toEqual({
      full_name: "Dra. Mariana Prado",
      first_name: "Mariana",
      invite_role: "PARTNER_ADMIN",
      organization_name: "Almeida Advogados",
      invite_pending: true,
    });
    expect(buildInviteMetadata({ fullName: "Ana Lima", role: "LAWYER", organizationName: null, reinviteOfConfirmedAccount: false }).invite_pending).toBeNull();
  });
  it("no aceite, apaga papel, escritório e marca (null remove a chave no Auth)", () => {
    expect(acceptedInviteMetadata("Ana Lima")).toEqual({
      full_name: "Ana Lima",
      first_name: "Ana",
      invite_role: null,
      organization_name: null,
      invite_pending: null,
    });
  });
});

describe("retornos da verificação de MFA (lista fechada)", () => {
  const ref = "Xq3v9LwP2mZt8RkA1cYb7NdE4hJsQ0uVfGo5TiWe6Ly";
  it("só senha e convite com ref válido", () => {
    expect(mfaReturnPath("senha", undefined)).toBe("/nova-senha");
    expect(mfaReturnPath("convite", ref)).toBe(`/primeiro-acesso?ref=${ref}`);
    expect(mfaReturnPath("convite", "curto")).toBeNull();
    expect(mfaReturnPath("convite", `${ref}&next=//evil.com`)).toBeNull();
    expect(mfaReturnPath("https://evil.com", ref)).toBeNull();
    expect(mfaReturnPath(undefined, undefined)).toBeNull();
  });
  it("isInviteRef só aceita base64url", () => {
    expect(isInviteRef(ref)).toBe(true);
    expect(isInviteRef("../../etc/passwd/aaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(false);
    expect(isInviteRef(null)).toBe(false);
  });
});
