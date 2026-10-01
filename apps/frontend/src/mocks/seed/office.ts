import { daysFromNowISO } from "@/lib/clock";
import type { Invitation, Office, User, UserSession } from "@/types";
import { OFFICE_ID, U } from "../ids";

export function buildOffice(): Office {
  return {
    id: OFFICE_ID,
    name: "Bárbara Cardoso Advocacia",
    legalName: "Bárbara Cardoso Sociedade Individual de Advocacia (dados fictícios)",
    tradeName: "Bárbara Cardoso Advocacia",
    cnpj: "00.000.101/0001-00",
    address: {
      zipCode: "01000-000",
      street: "Avenida Exemplo",
      number: "1000",
      complement: "Conjunto 101",
      district: "Centro",
      city: "São Paulo",
      state: "SP",
      country: "Brasil",
    },
    phone: "(11) 3000-0000",
    email: "contato@barbaracardoso.exemplo",
    website: "barbaracardoso.exemplo",
    principalLawyer: "Bárbara Cardoso",
    oab: "OAB/SP 000.101",
    statesOfPractice: ["SP", "MG", "PR"],
    units: ["São Paulo — Sede"],
    createdAt: daysFromNowISO(-62),
    updatedAt: daysFromNowISO(-3),
  };
}

export function buildUsers(): User[] {
  const base = { officeId: OFFICE_ID, createdAt: daysFromNowISO(-60) };
  return [
    {
      ...base,
      id: U.barbara,
      name: "Bárbara Cardoso",
      displayName: "Dra. Bárbara",
      email: "barbara@barbaracardoso.exemplo",
      role: "ADMIN",
      title: "Advogada",
      oab: "OAB/SP 000.101",
      status: "ACTIVE",
      hasCompletedTour: false,
      lastAccessAt: daysFromNowISO(0, 8, 42),
    },
    {
      ...base,
      id: U.claudio,
      name: "Cláudio",
      displayName: "Dr. Cláudio",
      email: "claudio@barbaracardoso.exemplo",
      role: "LAWYER",
      title: "Advogado sênior — Bancário",
      oab: "OAB/SP 000.202",
      status: "ACTIVE",
      hasCompletedTour: false,
      lastAccessAt: daysFromNowISO(0, 9, 5),
    },
    {
      ...base,
      id: U.beatriz,
      name: "Beatriz Nogueira",
      displayName: "Dra. Beatriz",
      email: "beatriz@barbaracardoso.exemplo",
      role: "LAWYER",
      title: "Advogada — Contencioso",
      oab: "OAB/SP 000.303",
      status: "ACTIVE",
      hasCompletedTour: true,
      lastAccessAt: daysFromNowISO(-1, 17, 20),
    },
    {
      ...base,
      id: U.renata,
      name: "Renata",
      displayName: "Renata",
      email: "renata@barbaracardoso.exemplo",
      role: "ASSISTANT",
      title: "Assistente jurídica",
      status: "ACTIVE",
      hasCompletedTour: false,
      lastAccessAt: daysFromNowISO(0, 8, 15),
    },
    {
      ...base,
      id: U.thiago,
      name: "Thiago Prado",
      displayName: "Dr. Thiago",
      email: "thiago@barbaracardoso.exemplo",
      role: "LAWYER",
      title: "Advogado — Previdenciário",
      status: "INVITED",
      hasCompletedTour: false,
      createdAt: daysFromNowISO(-2),
    },
  ];
}

export function buildInvitations(): Invitation[] {
  return [
    {
      id: "inv_thiago",
      officeId: OFFICE_ID,
      token: "demo-convite",
      email: "thiago@barbaracardoso.exemplo",
      name: "Thiago Prado",
      role: "LAWYER",
      invitedBy: U.barbara,
      createdAt: daysFromNowISO(-2),
    },
  ];
}

export function buildSessions(): UserSession[] {
  return [
    {
      id: "ses_1",
      officeId: OFFICE_ID,
      userId: U.barbara,
      device: "Chrome · Windows",
      location: "São Paulo, SP",
      lastActiveAt: daysFromNowISO(0, 9, 30),
      current: true,
    },
    {
      id: "ses_2",
      officeId: OFFICE_ID,
      userId: U.barbara,
      device: "Safari · macOS",
      location: "São Paulo, SP",
      lastActiveAt: daysFromNowISO(-2, 19, 10),
      current: false,
    },
    {
      id: "ses_3",
      officeId: OFFICE_ID,
      userId: U.claudio,
      device: "Edge · Windows",
      location: "Campinas, SP",
      lastActiveAt: daysFromNowISO(0, 9, 5),
      current: false,
    },
  ];
}
