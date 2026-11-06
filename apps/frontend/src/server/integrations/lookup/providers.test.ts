import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { cpfLookupConfigured, lookupCep, lookupCnpj, lookupCpf, titleCase } = await import("./providers");

function respond(map: Record<string, { status: number; body: unknown }>) {
  const fetchMock = vi.fn(async (url: string) => {
    const hit = Object.entries(map).find(([prefix]) => url.startsWith(prefix));
    if (!hit) throw new Error(`sem resposta simulada para ${url}`);
    return { status: hit[1].status, text: async () => JSON.stringify(hit[1].body) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("preenchimento automático — CEP, CNPJ e CPF (Roadmap 2.0)", () => {
  it("CEP: ViaCEP preenche logradouro, bairro, município e UF; erro do ViaCEP = não encontrado", async () => {
    respond({ "https://viacep.com.br/ws/01001000": { status: 200, body: { logradouro: "Praça da Sé", bairro: "Sé", localidade: "São Paulo", uf: "SP" } } });
    expect(await lookupCep("01001-000")).toEqual({ zipCode: "01001000", street: "Praça da Sé", district: "Sé", city: "São Paulo", state: "SP" });
    respond({ "https://viacep.com.br/ws/99999999": { status: 200, body: { erro: true } } });
    expect(await lookupCep("99999-999")).toBeNull();
  });

  it("CEP: ViaCEP fora do ar → BrasilAPI", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("viacep")) throw new Error("down");
        return { status: 200, text: async () => JSON.stringify({ street: "Rua X", neighborhood: "Centro", city: "Campinas", state: "SP" }) } as Response;
      }),
    );
    expect(await lookupCep("13010000")).toMatchObject({ street: "Rua X", city: "Campinas" });
  });

  it("CNPJ: BrasilAPI vira dados da empresa e sede; maiúsculas da Receita viram nome próprio", async () => {
    respond({
      "https://brasilapi.com.br/api/cnpj/v1/00000000000191": {
        status: 200,
        body: {
          razao_social: "BANCO DO BRASIL SA",
          nome_fantasia: "DIRECAO GERAL",
          data_inicio_atividade: "1966-08-01",
          natureza_juridica: "Sociedade de Economia Mista",
          ddd_telefone_1: "6134939002",
          cep: "70040912",
          logradouro: "SAUN QUADRA 5 BLOCO B",
          numero: "SN",
          bairro: "ASA NORTE",
          municipio: "BRASILIA",
          uf: "DF",
          descricao_situacao_cadastral: "ATIVA",
        },
      },
    });
    const c = await lookupCnpj("00.000.000/0001-91");
    expect(c).toMatchObject({ legalName: "BANCO DO BRASIL SA", phone: "6134939002", registrationStatus: "ATIVA" });
    expect(c?.address).toMatchObject({ zipCode: "70040912", district: "Asa Norte", city: "Brasilia", state: "DF", number: "SN" });
  });

  it("CPF: sem chaves do Serpro a consulta não está configurada; com a demonstração, nome e nascimento", async () => {
    vi.stubEnv("SERPRO_CPF_CONSUMER_KEY", "");
    vi.stubEnv("SERPRO_CPF_CONSUMER_SECRET", "");
    vi.stubEnv("SERPRO_CPF_TRIAL", "");
    expect(cpfLookupConfigured()).toBe(false);
    vi.stubEnv("SERPRO_CPF_TRIAL", "1");
    expect(cpfLookupConfigured()).toBe(true);
    const fetchMock = respond({
      "https://gateway.apiserpro.serpro.gov.br/consulta-cpf-df-trial/v1/cpf/40442820135": {
        status: 200,
        body: { ni: "40442820135", nome: "RONE PEREIRA", situacao: { codigo: "0", descricao: "Regular" }, nascimento: "14111970" },
      },
    });
    expect(await lookupCpf("404.428.201-35")).toEqual({ cpf: "40442820135", fullName: "Rone Pereira", birthDate: "1970-11-14", status: "Regular" });
    // A chave/token vai no cabeçalho; nunca na URL.
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("Bearer");
  });

  it("nome próprio: preposições ficam minúsculas; texto já misto não muda", () => {
    expect(titleCase("RIO DE JANEIRO")).toBe("Rio de Janeiro");
    expect(titleCase("Maria da Silva")).toBe("Maria da Silva");
  });
});
