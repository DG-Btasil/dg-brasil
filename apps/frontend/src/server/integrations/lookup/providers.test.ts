import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { CpfBirthMismatch, clearCpfCache, cpfLookupConfigured, lookupCep, lookupCnpj, lookupCpf, titleCase } = await import("./providers");
const { cpfCheckDigitsOk } = await import("@/lib/validation");

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
  clearCpfCache();
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

  it("CPF: só configurado com a demonstração (token próprio) ou com as chaves pagas EM PRODUÇÃO", async () => {
    for (const k of ["SERPRO_CPF_CONSUMER_KEY", "SERPRO_CPF_CONSUMER_SECRET", "SERPRO_CPF_TRIAL", "SERPRO_CPF_TRIAL_TOKEN", "DG_ENV"]) vi.stubEnv(k, "");
    expect(cpfLookupConfigured()).toBe(false);
    vi.stubEnv("SERPRO_CPF_TRIAL", "1");
    expect(cpfLookupConfigured()).toBe(false); // sem o token da demonstração
    vi.stubEnv("SERPRO_CPF_TRIAL", "");
    vi.stubEnv("SERPRO_CPF_CONSUMER_KEY", "chave");
    vi.stubEnv("SERPRO_CPF_CONSUMER_SECRET", "segredo");
    expect(cpfLookupConfigured()).toBe(false); // chaves pagas fora da produção: nada é cobrado
    vi.stubEnv("DG_ENV", "production");
    expect(cpfLookupConfigured()).toBe(true);
  });

  it("CPF v3 (demonstração): CPF e nascimento no caminho; nome, nome social, nascimento e situação; token no cabeçalho", async () => {
    vi.stubEnv("SERPRO_CPF_TRIAL", "1");
    vi.stubEnv("SERPRO_CPF_TRIAL_TOKEN", "token-demo");
    const fetchMock = respond({
      "https://gateway.apiserpro.serpro.gov.br/consulta-cpf-df-trial/v3/cpf/40442820135/14111970": {
        status: 200,
        body: { ni: "40442820135", nome: "RONE PEREIRA", nomeSocial: "RONE", situacao: { codigo: "0", descricao: "Regular" }, nascimento: "14111970" },
      },
    });
    expect(await lookupCpf("404.428.201-35", "1970-11-14")).toEqual({
      cpf: "40442820135", fullName: "Rone Pereira", socialName: "Rone", birthDate: "1970-11-14", status: "Regular",
    });
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("token-demo");
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ Authorization: "Bearer token-demo" });
  });

  it("CPF v3 em produção: token OAuth com as chaves, endereço de produção da v3", async () => {
    vi.stubEnv("DG_ENV", "production");
    vi.stubEnv("SERPRO_CPF_CONSUMER_KEY", "chave");
    vi.stubEnv("SERPRO_CPF_CONSUMER_SECRET", "segredo");
    const fetchMock = respond({
      "https://gateway.apiserpro.serpro.gov.br/token": { status: 200, body: { access_token: "abc", expires_in: 3600 } },
      "https://gateway.apiserpro.serpro.gov.br/consulta-cpf-df/v3/cpf/40442820135/14111970": { status: 200, body: { nome: "RONE PEREIRA", situacao: { descricao: "Suspensa" } } },
    });
    expect((await lookupCpf("40442820135", "1970-11-14"))?.status).toBe("Suspensa");
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      "https://gateway.apiserpro.serpro.gov.br/token",
      "https://gateway.apiserpro.serpro.gov.br/consulta-cpf-df/v3/cpf/40442820135/14111970",
    ]);
  });

  it("CPF v3: nascimento divergente vira aviso próprio; o mesmo par (achado, não achado ou divergente) não paga de novo em 10 minutos", async () => {
    vi.stubEnv("SERPRO_CPF_TRIAL", "1");
    vi.stubEnv("SERPRO_CPF_TRIAL_TOKEN", "token-demo");
    const base = "https://gateway.apiserpro.serpro.gov.br/consulta-cpf-df-trial/v3/cpf/";
    const fetchMock = respond({
      [`${base}40442820135/14111970`]: { status: 200, body: { nome: "RONE PEREIRA", situacao: { descricao: "Regular" } } },
      [`${base}40442820135/01011970`]: { status: 422, body: { erro: "DATA_NASCIMENTO_DIVERGENTE", erroDescricao: "divergente" } },
      [`${base}52998224725/01011980`]: { status: 404, body: { erro: "CPF_INEXISTENTE" } },
    });
    await lookupCpf("404.428.201-35", "1970-11-14");
    await lookupCpf("40442820135", "1970-11-14");
    await expect(lookupCpf("40442820135", "1970-01-01")).rejects.toBeInstanceOf(CpfBirthMismatch);
    await expect(lookupCpf("40442820135", "1970-01-01")).rejects.toBeInstanceOf(CpfBirthMismatch);
    expect(await lookupCpf("529.982.247-25", "1980-01-01")).toBeNull();
    expect(await lookupCpf("52998224725", "1980-01-01")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("CPF v3: sem data de nascimento válida, não consulta", async () => {
    vi.stubEnv("SERPRO_CPF_TRIAL", "1");
    vi.stubEnv("SERPRO_CPF_TRIAL_TOKEN", "token-demo");
    const fetchMock = respond({});
    expect(await lookupCpf("40442820135", "")).toBeNull();
    expect(await lookupCpf("40442820135", "14/11/1970")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("CPF: dígito verificador (para não pagar consulta de número digitado errado)", () => {
    expect(cpfCheckDigitsOk("404.428.201-35")).toBe(true);
    expect(cpfCheckDigitsOk("529.982.247-25")).toBe(true);
    expect(cpfCheckDigitsOk("529.982.247-24")).toBe(false);
    expect(cpfCheckDigitsOk("111.111.111-11")).toBe(false);
    expect(cpfCheckDigitsOk("1234567890")).toBe(false);
  });

  it("nome próprio: preposições ficam minúsculas; texto já misto não muda", () => {
    expect(titleCase("RIO DE JANEIRO")).toBe("Rio de Janeiro");
    expect(titleCase("Maria da Silva")).toBe("Maria da Silva");
  });
});
