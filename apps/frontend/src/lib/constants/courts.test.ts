import { describe, expect, it } from "vitest";
import { courtFromAlias, datajudAlias } from "@/server/integrations/judicial/text";
import { TOUR_STEPS } from "@/features/tour/tour-steps";
import { NAV_ITEMS } from "@/components/navigation/nav-config";
import { COURT_OPTIONS, COURTS, courtName, searchCourts } from "./courts";
import { BRAZILIAN_STATES } from "./legal";

describe("tribunais do cadastro de processo", () => {
  const count = (re: RegExp) => COURTS.filter((c) => re.test(c)).length;

  it("lista completa: 27 TJs, 6 TRFs, 24 TRTs, superiores, 27 TREs e 3 militares estaduais", () => {
    expect(count(/^TJ([A-Z]{2}|DFT)$/)).toBe(27);
    expect(count(/^TRF[1-6]$/)).toBe(6);
    expect(count(/^TRT\d{1,2}$/)).toBe(24);
    expect(count(/^TRE-[A-Z]{2}$/)).toBe(27);
    expect(count(/^TJM[A-Z]{2}$/)).toBe(3);
    for (const superior of ["STF", "STJ", "TST", "TSE", "STM"]) expect(COURTS).toContain(superior);
    expect(COURTS).toHaveLength(92);
    expect(new Set(COURTS).size).toBe(COURTS.length);
  });

  it("há um TJ e um TRE por estado (o do DF é TJDFT)", () => {
    for (const uf of BRAZILIAN_STATES) {
      expect(COURTS).toContain(uf === "DF" ? "TJDFT" : `TJ${uf}`);
      expect(COURTS).toContain(`TRE-${uf}`);
    }
  });

  it("toda sigla passa na regra do calendário forense do sistema (court ~ '^[A-Z0-9-]{2,15}$')", () => {
    for (const code of COURTS) expect(code).toMatch(/^[A-Z0-9-]{2,15}$/);
  });

  it("as siglas são as mesmas da integração judicial (índice do DataJud pelo número CNJ)", () => {
    const fromIntegration = new Set<string>();
    for (const segment of ["3", "4", "5", "6", "7", "8", "9"]) {
      for (let tr = 0; tr <= 27; tr += 1) {
        const alias = datajudAlias(`0000000002026${segment}${String(tr).padStart(2, "0")}0001`);
        if (alias) fromIntegration.add(courtFromAlias(alias));
      }
    }
    expect(fromIntegration.size).toBeGreaterThan(80);
    expect([...fromIntegration].filter((code) => !COURTS.includes(code)).sort()).toEqual([]);
  });

  it("todo tribunal tem nome por extenso; texto fora da lista não tem", () => {
    for (const c of COURT_OPTIONS) expect(c.name.length).toBeGreaterThan(10);
    expect(courtName("TJRJ")).toBe("Tribunal de Justiça do Rio de Janeiro");
    expect(courtName("TRT1")).toBe("Tribunal Regional do Trabalho da 1ª Região (RJ)");
    expect(courtName("Tribunal antigo importado")).toBeUndefined();
    expect(courtName(undefined)).toBeUndefined();
  });

  it("busca por sigla, com ou sem espaço e hífen, sem diferenciar maiúsculas", () => {
    expect(searchCourts("tjrj")[0].code).toBe("TJRJ");
    expect(searchCourts("TRT 15")[0].code).toBe("TRT15");
    expect(searchCourts("tre sp")[0].code).toBe("TRE-SP");
    expect(searchCourts("trf").map((c) => c.code)).toEqual(["TRF1", "TRF2", "TRF3", "TRF4", "TRF5", "TRF6"]);
  });

  it("busca por nome, sem acento", () => {
    expect(searchCourts("sao paulo").map((c) => c.code)).toEqual(expect.arrayContaining(["TJSP", "TRE-SP", "TJMSP"]));
    expect(searchCourts("rio de janeiro").map((c) => c.code)).toEqual(expect.arrayContaining(["TJRJ", "TRE-RJ"]));
    expect(searchCourts("trabalho campinas").map((c) => c.code)).toEqual(["TRT15"]);
    expect(searchCourts("supremo").map((c) => c.code)).toEqual(["STF"]);
    expect(searchCourts("não existe")).toEqual([]);
  });

  it("sem texto, devolve a lista na ordem (e respeita o limite)", () => {
    expect(searchCourts("", 100)).toHaveLength(92);
    expect(searchCourts("  ", 5).map((c) => c.code)).toEqual(["TJAC", "TJAL", "TJAP", "TJAM", "TJBA"]);
  });
});

describe("tour do produto", () => {
  const byId = new Map(TOUR_STEPS.map((s) => [s.id, s]));

  it("tem passo para Casos, Publicações e Parceiros, na ordem do menu", () => {
    const order = TOUR_STEPS.map((s) => s.id);
    for (const id of ["clients", "cases", "processes", "publications", "reviews", "finance", "partners", "dgbrasil"]) expect(order).toContain(id);
    expect(order.indexOf("cases")).toBeGreaterThan(order.indexOf("clients"));
    expect(order.indexOf("publications")).toBeGreaterThan(order.indexOf("processes"));
    expect(order.indexOf("partners")).toBeGreaterThan(order.indexOf("finance"));
  });

  it("cada passo de módulo aponta para um item que existe no menu interno, com a mesma permissão", () => {
    const internal = NAV_ITEMS.filter((i) => i.audience === "OWNER");
    for (const step of TOUR_STEPS) {
      for (const anchor of step.anchors.filter((a) => a.startsWith("nav-") && a !== "nav-panel")) {
        const item = internal.find((i) => `nav-${i.key}` === anchor);
        expect(item, `${step.id}: ${anchor}`).toBeDefined();
        expect(step.permission, step.id).toBe(item?.permission);
      }
    }
  });

  it("os textos acompanham o sistema atual", () => {
    expect(byId.get("clients")?.text).not.toMatch(/análises/);
    expect(byId.get("dgbrasil")?.text).not.toMatch(/Skills|Central/);
    expect(byId.get("settings")?.text).not.toMatch(/integrações/);
    for (const step of TOUR_STEPS) expect(step.text, step.id).not.toMatch(/movimenta|Home\b/i);
  });
});
