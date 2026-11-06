"use client";

import { useEffect, useRef, useState } from "react";
import { callAction } from "@/lib/actions/result";
import { isCnpjFormat, isCpfFormat, taxIdProblem } from "@/lib/validation";
import { lookupCepAction, lookupCnpjAction, lookupCpfAction, type LookupResult } from "@/server/integrations/lookup/actions";
import type { AddressLookup, CompanyLookup, PersonLookup } from "@/server/integrations/lookup/providers";

export type AutofillStatus = "idle" | "loading" | "found" | "not_found" | "not_configured" | "unavailable";

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
): AutofillStatus {
  const [status, setStatus] = useState<AutofillStatus>("idle");
  // O valor que o formulário já trazia (edição) não dispara consulta: só o que a pessoa digitar.
  const last = useRef<string | null>(onlyDigits(value) || null);
  const handler = useRef(onFound);
  handler.current = onFound;
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
        setStatus("found");
      } else setStatus(r.data.reason === "NOT_FOUND" ? "not_found" : r.data.reason === "NOT_CONFIGURED" ? "not_configured" : "unavailable");
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

export function useCpfAutofill(cpf: string | undefined, onFound: (p: PersonLookup) => void, enabled = true) {
  return useAutofill(cpf, (d) => isCpfFormat(d) && !taxIdProblem(d, "cpf"), (d) => callAction(() => lookupCpfAction({ cpf: d })), onFound, enabled);
}

/** Texto curto para mostrar embaixo do campo. */
export function autofillHint(status: AutofillStatus, what: "CEP" | "CNPJ" | "CPF"): string | undefined {
  switch (status) {
    case "loading":
      return what === "CEP" ? "Buscando o endereço…" : "Consultando a Receita Federal…";
    case "found":
      return what === "CEP" ? "Endereço preenchido pelo CEP. Confira e complete o número." : "Dados preenchidos pela Receita Federal. Confira antes de salvar.";
    case "not_found":
      return what === "CEP" ? "CEP não encontrado. Preencha o endereço à mão." : `${what} não encontrado na Receita. Preencha à mão.`;
    case "not_configured":
      return "Consulta de CPF na Receita ainda não contratada: preencha à mão.";
    case "unavailable":
      return "Consulta indisponível agora. Preencha à mão.";
    default:
      return undefined;
  }
}
