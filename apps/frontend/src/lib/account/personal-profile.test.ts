import { describe, expect, it } from "vitest";
import { EMPTY_PERSONAL_PROFILE, ageOn, nameCameFromEmail, normalizePersonalProfile, personalProfileProblems, todayInSaoPaulo, type PersonalProfileInput } from "./personal-profile";

const TODAY = "2026-11-18";
const valid = (over: Partial<PersonalProfileInput> = {}): PersonalProfileInput => ({
  ...EMPTY_PERSONAL_PROFILE,
  fullName: "Ana Maria Teste",
  officeCity: "São Paulo",
  officeState: "SP",
  ...over,
});
const problems = (over: Partial<PersonalProfileInput> = {}) => personalProfileProblems(valid(over), TODAY);

describe("cadastro pessoal (079)", () => {
  it("só nome, cidade e UF são obrigatórios", () => {
    expect(problems()).toEqual({});
    expect(Object.keys(personalProfileProblems(EMPTY_PERSONAL_PROFILE, TODAY)).sort()).toEqual(["fullName", "officeCity", "officeState"]);
  });

  it("nome completo: com sobrenome e sem texto de golpe", () => {
    expect(problems({ fullName: "Ana" }).fullName).toMatch(/sobrenome/);
    expect(problems({ fullName: "Acesse www.golpe.com" }).fullName).toBeTruthy();
    expect(problems({ fullName: "  Ana   Maria  d'Ávila-Souza " })).toEqual({});
  });

  it("opcionais: vazio passa, inválido aponta o campo", () => {
    expect(problems({ preferredName: "Aninha", gender: "FEMALE", birthDate: "1990-05-17", phone: "(11) 98888-7777", jobTitle: "Advogada" })).toEqual({});
    expect(problems({ preferredName: "x".repeat(41) }).preferredName).toBeTruthy();
    expect(problems({ preferredName: "Ana123" }).preferredName).toBeTruthy();
    expect(problems({ gender: "X" }).gender).toBeTruthy();
    expect(problems({ jobTitle: "c".repeat(81) }).jobTitle).toBeTruthy();
  });

  it("telefone: DDD + número, 10 ou 11 dígitos", () => {
    expect(problems({ phone: "(11) 3333-4444" })).toEqual({});
    expect(problems({ phone: "98888-7777" }).phone).toBeTruthy();
    expect(problems({ phone: "(01) 98888-7777" }).phone).toBeTruthy();
    expect(problems({ phone: "119888877776" }).phone).toBeTruthy();
  });

  it("data de nascimento: existe e dá entre 16 e 120 anos", () => {
    expect(problems({ birthDate: "2010-11-18" })).toEqual({});
    expect(problems({ birthDate: "2010-11-19" }).birthDate).toBeTruthy();
    expect(problems({ birthDate: "1990-02-31" }).birthDate).toBe("Data inválida.");
    expect(problems({ birthDate: "17/05/1990" }).birthDate).toBe("Data inválida.");
    expect(problems({ birthDate: "1850-01-01" }).birthDate).toBeTruthy();
    expect(ageOn("1990-05-17", "2026-05-16")).toBe(35);
    expect(ageOn("1990-05-17", "2026-05-17")).toBe(36);
  });

  it("cidade e UF de onde a pessoa trabalha", () => {
    expect(problems({ officeCity: "Rua 9, 123" }).officeCity).toBeTruthy();
    expect(problems({ officeCity: "S" }).officeCity).toBeTruthy();
    expect(problems({ officeState: "XX" }).officeState).toBeTruthy();
    expect(problems({ officeState: "sp" })).toEqual({});
  });

  it("normaliza como o banco grava", () => {
    expect(normalizePersonalProfile(valid({ fullName: " Ana   Teste ", phone: "(11) 98888-7777", officeCity: " São  Paulo ", officeState: "sp", gender: "female" }))).toMatchObject({
      fullName: "Ana Teste",
      phone: "11988887777",
      officeCity: "São Paulo",
      officeState: "SP",
      gender: "FEMALE",
    });
  });

  it("nome tirado do e-mail não é pré-preenchido", () => {
    expect(nameCameFromEmail("miguelcardosock", "MiguelCardosoCK@gmail.com")).toBe(true);
    expect(nameCameFromEmail("Miguel Cardoso", "miguelcardosock@gmail.com")).toBe(false);
    expect(nameCameFromEmail("Miguel", undefined)).toBe(false);
  });

  it("hoje em Brasília sai como AAAA-MM-DD", () => {
    expect(todayInSaoPaulo(new Date("2026-11-18T02:30:00Z"))).toBe("2026-11-17");
  });
});
