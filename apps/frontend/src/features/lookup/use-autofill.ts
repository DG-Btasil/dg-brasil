"use client";

import { useEffect, useRef, useState } from "react";
import { callAction } from "@/lib/actions/result";
import { cpfCheckDigitsOk, isCnpjFormat, isCpfFormat, taxIdProblem } from "@/lib/validation";
import { lookupCepAction, lookupCnpjAction, lookupCpfAction, type LookupResult } from "@/server/integrations/lookup/actions";
import type { AddressLookup, CompanyLookup, PersonLookup } from "@/server/integrations/lookup/providers";

export type AutofillStatus =
  | "idle" | "loading" | "found" | "found_attention" | "not_found" | "not_configured" | "unavailable" | "invalid"
  | "needs_birth" | "birth_mismatch";

const onlyDigits = (v: string | undefined) => (v ?? "").replace(/\D/g, "");

/**
 * Dispara a consulta quando o documento fica completo e válido (uma vez por
 * valor) e entrega o resultado a `onFound`. O formulário decide o que
 * preencher; a pessoa sempre pode corrigir à mão.
 */
function useAutofill<T>(
  value: string | undefined,
  ready: (digits: string) => boolean,
  run: (digits: string) => Promise<{ ok: true; data: LookupResult<T> } | { ok: false }>,
  onFound: (data: T) => void,
  enabled = true,
  attention?: (data: T) => boolean,
): AutofillStatus {
  const [status, setStatus] = useState<AutofillStatus>("idle");
  // O valor que o formulário já trazia (edição) não dispara consulta: só o que a pessoa digitar.
  const last = useRef<string | null>(onlyDigits(value) || null);
  const handler = useRef(onFound);
  useEffect(() => {
    handler.current = onFound;
  });
  const digits = onlyDigits(value);

  useEffect(() => {
    if (!enabled || !ready(digits) || last.current === digits) return;
    last.current = digits;
    let alive = true;
    setStatus("loading");
    void run(digits).then((r) => {
      if (!alive) return;
      if (!r.ok) return setStatus("unavailable");
      if (r.data.found) {
        handler.current(r.data.data);
        setStatus(attention?.(r.data.data) ? "found_attention" : "found");
      } else {
        const motivo: Record<string, AutofillStatus> = { NOT_FOUND: "not_found", NOT_CONFIGURED: "not_configured", INVALID: "invalid", BIRTH_MISMATCH: "birth_mismatch" };
        setStatus(motivo[r.data.reason] ?? "unavailable");
      }
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ready/run são estáveis por hook; a consulta depende só do valor.
  }, [digits, enabled]);

  return ready(digits) ? status : "idle";
}

export function useCepAutofill(cep: string | undefined, onFound: (a: AddressLookup) => void, enabled = true) {
  return useAutofill(cep, (d) => d.length === 8, (d) => callAction(() => lookupCepAction({ cep: d })), onFound, enabled);
}

export function useCnpjAutofill(cnpj: string | undefined, onFound: (c: CompanyLookup) => void, enabled = true) {
  return useAutofill(cnpj, (d) => isCnpjFormat(d) && !taxIdProblem(d, "cnpj"), (d) => callAction(() => lookupCnpjAction({ cnpj: d })), onFound, enabled);
}

/**
 * CPF na Receita (Serpro, Consulta CPF v3), paga por consulta
 * (docs/deploy/producao.md, item 12). A v3 confere CPF E data de nascimento
 * juntos: a consulta só sai com os dois preenchidos, e devolve nome, nome
 * social e situação. Enquanto `NEXT_PUBLIC_CPF_LOOKUP` não for "1", o
 * navegador nem chama o servidor e nada aparece embaixo do campo (QA R2-03).
 * CPF com dígito verificador errado não vai à Receita: o campo avisa.
 */
const CPF_LOOKUP_ON = process.env.NEXT_PUBLIC_CPF_LOOKUP === "1";
const INVALID: { ok: true; data: LookupResult<PersonLookup> } = { ok: true, data: { found: false, reason: "INVALID" } };
/** Situação cadastral diferente de "Regular" (suspensa, cancelada, titular falecido...). */
const irregular = (p: PersonLookup) => !!p.status && !/^regular$/i.test(p.status.trim());
/** "1970-11-14" (campo de data) → "19701114"; outra coisa → "". */
const birthDigits = (v: string | undefined) => (/^(19|20)\d{2}-\d{2}-\d{2}$/.test(v ?? "") ? (v as string).replace(/-/g, "") : "");

export function useCpfAutofill(cpf: string | undefined, birthDate: string | undefined, onFound: (p: PersonLookup) => void, enabled = true) {
  const cpfDigits = onlyDigits(cpf);
  const cpfReady = isCpfFormat(cpfDigits) && !taxIdProblem(cpfDigits, "cpf");
  const birth = birthDigits(birthDate);
  // CPF (11) + nascimento AAAAMMDD (8): a consulta dispara uma vez por par.
  const status = useAutofill(
    cpfReady && birth ? `${cpfDigits}${birth}` : cpfDigits,
    (d) => d.length === 19,
    (d) => {
      const n = d.slice(11);
      return cpfCheckDigitsOk(d.slice(0, 11))
        ? callAction(() => lookupCpfAction({ cpf: d.slice(0, 11), birthDate: `${n.slice(0, 4)}-${n.slice(4, 6)}-${n.slice(6, 8)}` }))
        : Promise.resolve(INVALID);
    },
    onFound,
    enabled && CPF_LOOKUP_ON,
    irregular,
  );
  if (enabled && CPF_LOOKUP_ON && cpfReady && !birth) return cpfCheckDigitsOk(cpfDigits) ? "needs_birth" : "invalid";
  return status;
}

/** Texto curto para mostrar embaixo do campo. */
export function autofillHint(status: AutofillStatus, what: "CEP" | "CNPJ" | "CPF"): string | undefined {
  switch (status) {
    case "loading":
      return what === "CEP" ? "Buscando o endereço…" : "Consultando a Receita Federal…";
    case "found":
      return what === "CEP" ? "Endereço preenchido pelo CEP. Confira e complete o número." : "Dados preenchidos pela Receita Federal. Confira antes de salvar.";
    case "found_attention":
      return "Dados preenchidos pela Receita Federal. Atenção: o CPF não está regular na Receita. Confira com o cliente.";
    case "invalid":
      return "CPF com dígito verificador errado. Confira o número.";
    case "needs_birth":
      return "Informe a data de nascimento para buscar o nome na Receita Federal.";
    case "birth_mismatch":
      return "A data de nascimento não confere com a da Receita. Confira o CPF e a data.";
    case "not_found":
      return what === "CEP" ? "CEP não encontrado. Preencha o endereço à mão." : `${what} não encontrado na Receita. Preencha à mão.`;
    case "not_configured":
      // CPF na Receita (Serpro) fica para a produção (docs/deploy/producao.md, item 12): sem aviso na tela.
      return undefined;
    case "unavailable":
      return "Consulta indisponível agora. Preencha à mão.";
    default:
      return undefined;
  }
}
