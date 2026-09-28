import { dateFromNow, daysFromNowISO } from "@/lib/clock";
import type { FeeModel, FinancialAgreement, Payment } from "@/types";
import { C, FEE, OFFICE_ID, P } from "../ids";

const o = { officeId: OFFICE_ID };

export function buildFeeModels(): FeeModel[] {
  return [
    {
      ...o,
      id: FEE.bancarioA,
      name: "Bancário — Modelo A",
      description: "Entrada na assinatura e percentual sobre o proveito econômico.",
      area: "BANKING",
      upfrontFee: 1500,
      fixedFee: 0,
      installments: 1,
      successFeePercent: 30,
      billingMoment: "ON_SIGNING",
      notes: "Entrada pode ser parcelada em até 3 vezes mediante aprovação.",
      active: true,
      updatedAt: daysFromNowISO(-40),
    },
    {
      ...o,
      id: FEE.bancarioB,
      name: "Bancário — Êxito",
      description: "Sem entrada; honorários apenas no êxito.",
      area: "BANKING",
      successFeePercent: 35,
      billingMoment: "ON_SUCCESS",
      active: true,
      updatedAt: daysFromNowISO(-40),
    },
    {
      ...o,
      id: FEE.empresarialMensal,
      name: "Empresarial — Mensalidade",
      description: "Mensalidade para acompanhamento contencioso de empresas.",
      area: "CORPORATE",
      monthlyFee: 4500,
      successFeePercent: 10,
      billingMoment: "MONTHLY",
      active: true,
      updatedAt: daysFromNowISO(-90),
    },
    {
      ...o,
      id: FEE.consultivo,
      name: "Valor fixo parcelado",
      description: "Valor fixo por ação, parcelado.",
      fixedFee: 6000,
      installments: 6,
      billingMoment: "CUSTOM",
      active: true,
      updatedAt: daysFromNowISO(-120),
    },
  ];
}

export function buildAgreements(): FinancialAgreement[] {
  return [
    {
      ...o,
      id: "agr_helena",
      clientId: C.helena,
      processId: P.helenaRevisional,
      feeModelId: FEE.bancarioA,
      customized: false,
      upfrontFee: 1500,
      fixedFee: 0,
      installments: 3,
      successFeePercent: 30,
      totalContracted: 1500,
      estimatedSuccessFee: 11526,
      startDate: dateFromNow(-20),
      createdAt: daysFromNowISO(-20),
    },
    {
      ...o,
      id: "agr_ferragens",
      clientId: C.ferragens,
      processId: P.ferragensRevisional,
      feeModelId: FEE.consultivo,
      customized: true,
      upfrontFee: 5000,
      fixedFee: 18000,
      installments: 6,
      successFeePercent: 8,
      totalContracted: 23000,
      estimatedSuccessFee: 33000,
      startDate: dateFromNow(-135),
      notes: "Valores personalizados em razão do valor da causa.",
      createdAt: daysFromNowISO(-135),
    },
    {
      ...o,
      id: "agr_transportes",
      clientId: C.transportes,
      feeModelId: FEE.empresarialMensal,
      customized: false,
      upfrontFee: 0,
      fixedFee: 0,
      installments: 0,
      monthlyFee: 4500,
      successFeePercent: 10,
      totalContracted: 27000,
      startDate: dateFromNow(-150),
      notes: "Mensalidade cobre todos os processos contenciosos do cliente.",
      createdAt: daysFromNowISO(-150),
    },
    {
      ...o,
      id: "agr_francisco",
      clientId: C.francisco,
      processId: P.franciscoDeclaratoria,
      feeModelId: FEE.bancarioB,
      customized: false,
      upfrontFee: 0,
      fixedFee: 0,
      installments: 0,
      successFeePercent: 35,
      totalContracted: 0,
      estimatedSuccessFee: 4970,
      startDate: dateFromNow(-45),
      createdAt: daysFromNowISO(-45),
    },
    {
      ...o,
      id: "agr_pedro",
      clientId: C.pedro,
      processId: P.pedroEncerrado,
      feeModelId: FEE.consultivo,
      customized: false,
      upfrontFee: 0,
      fixedFee: 6000,
      installments: 6,
      totalContracted: 6000,
      startDate: dateFromNow(-300),
      createdAt: daysFromNowISO(-300),
    },
    {
      ...o,
      id: "agr_clinica",
      clientId: C.clinica,
      processId: P.clinicaTributario,
      customized: true,
      upfrontFee: 3000,
      fixedFee: 9000,
      installments: 3,
      totalContracted: 12000,
      startDate: dateFromNow(-40),
      createdAt: daysFromNowISO(-40),
    },
  ];
}

export function buildPayments(): Payment[] {
  let n = 0;
  // Grava só os fatos (quanto foi pago e quando). O status é derivado em lib/domain/finance.
  const pay = (agreementId: string, description: string, amount: number, dueIn: number, paid: "PAID" | "OPEN" | number): Payment => {
    n += 1;
    return {
      ...o,
      id: `pay_${String(n).padStart(3, "0")}`,
      agreementId,
      description,
      amount,
      dueDate: dateFromNow(dueIn),
      paidAmount: paid === "PAID" ? amount : paid === "OPEN" ? 0 : paid,
      paidAt: paid === "OPEN" ? undefined : daysFromNowISO(Math.min(dueIn, 0)),
    };
  };
  return [
    pay("agr_helena", "Entrada — parcela 1/3", 500, -20, "PAID"),
    pay("agr_helena", "Entrada — parcela 2/3", 500, 10, "OPEN"),
    pay("agr_helena", "Entrada — parcela 3/3", 500, 40, "OPEN"),

    pay("agr_ferragens", "Entrada", 5000, -135, "PAID"),
    pay("agr_ferragens", "Parcela 1/6", 3000, -105, "PAID"),
    pay("agr_ferragens", "Parcela 2/6", 3000, -75, "PAID"),
    pay("agr_ferragens", "Parcela 3/6", 3000, -45, "OPEN"),
    pay("agr_ferragens", "Parcela 4/6", 3000, -15, "OPEN"),
    pay("agr_ferragens", "Parcela 5/6", 3000, 15, "OPEN"),
    pay("agr_ferragens", "Parcela 6/6", 3000, 45, "OPEN"),

    pay("agr_transportes", "Mensalidade", 4500, -120, "PAID"),
    pay("agr_transportes", "Mensalidade", 4500, -90, "PAID"),
    pay("agr_transportes", "Mensalidade", 4500, -60, "PAID"),
    pay("agr_transportes", "Mensalidade", 4500, -30, "PAID"),
    pay("agr_transportes", "Mensalidade", 4500, 0, "OPEN"),
    pay("agr_transportes", "Mensalidade", 4500, 30, "OPEN"),

    ...[1, 2, 3, 4, 5, 6].map((i) => pay("agr_pedro", `Parcela ${i}/6`, 1000, -300 + i * 30, "PAID")),

    pay("agr_clinica", "Entrada", 3000, -40, "PAID"),
    pay("agr_clinica", "Parcela 1/3", 3000, -10, "OPEN"),
    pay("agr_clinica", "Parcela 2/3", 3000, 20, 1200),
    pay("agr_clinica", "Parcela 3/3", 3000, 50, "OPEN"),
  ];
}
