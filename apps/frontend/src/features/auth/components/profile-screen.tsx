"use client";

import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Callout } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { PersonalProfileFields } from "@/features/account/components/personal-profile-fields";
import { usePersonalProfileForm } from "@/features/account/components/use-personal-profile-form";
import type { PersonalProfileInput } from "@/lib/account/personal-profile";
import { OAB_UF_OPTIONS, formatOab, normalizeOab } from "@/lib/auth/oab";
import { referenceCode } from "@/lib/actions/result";
import type { MyOabDTO } from "@/server/domain/account/oabs";
import { AuthLayout } from "./auth-layout";
import { hardNavigate } from "./navigation";
import { OnboardingSteps } from "./onboarding-steps";
import { SignOutButton } from "./sign-out-button";

const MAX_NEW_OABS = 5;
type OabRow = { number: string; state: string };

/**
 * Etapa obrigatória "Complete seu cadastro" (079): vem depois da verificação
 * em duas etapas, para todos os papéis, uma vez por conta. O servidor decide
 * o próximo passo depois de gravar (navegação completa, como nos termos).
 */
export function ProfileScreen({ initial, oabs, next }: { initial: PersonalProfileInput; oabs: MyOabDTO[]; next?: string }) {
  const form = usePersonalProfileForm(initial);
  const [rows, setRows] = useState<OabRow[]>(oabs.length ? [] : [{ number: "", state: "" }]);
  const [oabError, setOabError] = useState<string>();
  const [error, setError] = useState<string | null>(null);

  const setRow = (index: number, patch: Partial<OabRow>) => {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setOabError(undefined);
  };

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    // Linha de OAB em branco não conta; linha pela metade é erro.
    const filled = rows.filter((row) => row.number.trim() || row.state.trim());
    const newOabs: OabRow[] = [];
    for (const row of filled) {
      const oab = normalizeOab(row);
      if (!oab || oab === "invalid") return setOabError("Informe o número da OAB (só números) e a UF, ou deixe os dois em branco.");
      newOabs.push(oab);
    }
    const result = await form.submit(newOabs);
    if (!result) return setError("Confira os campos destacados.");
    if (!result.ok) {
      const code = referenceCode(result.requestId);
      return setError(code ? `${result.error.message} (ref. ${code})` : result.error.message);
    }
    hardNavigate(next ? `/?next=${encodeURIComponent(next)}` : "/");
  }

  return (
    <AuthLayout title="Complete seu cadastro" description="Confira seus dados antes de entrar. Você pode alterar tudo depois, em Meu perfil.">
      <OnboardingSteps current="profile" withPassword={false} />
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {error && <Callout tone="danger" title={error} />}
        <PersonalProfileFields value={form.value} errors={form.errors} onChange={form.onChange} disabled={form.submitting} />

        <fieldset className="space-y-3 rounded-lg border border-line p-4">
          <legend className="px-1 text-[12.5px] font-semibold text-foreground">OAB</legend>
          <p className="text-[12.5px] text-muted">É opcional. Você pode cadastrar mais OABs depois em Meu perfil.</p>
          {oabs.length > 0 && (
            <ul className="space-y-1">
              {oabs.map((oab) => (
                <li key={oab.id} className="text-[13px] font-medium tabular text-foreground">
                  {formatOab(oab.number, oab.state)}
                  {oab.isPrimary && <span className="ml-2 font-normal text-muted">principal</span>}
                </li>
              ))}
            </ul>
          )}
          {rows.map((row, index) => (
            <div key={index} className="grid grid-cols-[minmax(0,1fr)_88px_auto] items-end gap-2">
              <Field label={index === 0 && oabs.length === 0 ? "OAB principal" : "Outra OAB"} requirement="optional">
                {(p) => <Input {...p} inputMode="numeric" placeholder="000000" disabled={form.submitting} value={row.number} onChange={(e) => setRow(index, { number: e.target.value })} />}
              </Field>
              <Field label="UF" requirement="optional">
                {(p) => <Select {...p} placeholder="—" options={OAB_UF_OPTIONS} disabled={form.submitting} value={row.state} onChange={(e) => setRow(index, { state: e.target.value })} />}
              </Field>
              <Button
                type="button"
                variant="ghost"
                aria-label="Tirar esta OAB"
                icon={<Trash2 className="size-4" aria-hidden />}
                disabled={form.submitting}
                onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                className="mb-[1px] px-2"
              />
            </div>
          ))}
          {oabError && (
            <p role="alert" className="text-[11.5px] font-medium text-danger">
              {oabError}
            </p>
          )}
          {rows.length < MAX_NEW_OABS && (
            <Button type="button" variant="secondary" size="sm" icon={<Plus className="size-4" aria-hidden />} disabled={form.submitting} onClick={() => setRows((current) => [...current, { number: "", state: "" }])}>
              {rows.length === 0 && oabs.length === 0 ? "Adicionar OAB" : "Adicionar outra OAB"}
            </Button>
          )}
        </fieldset>

        <Button type="submit" size="lg" className="w-full" loading={form.submitting}>
          Salvar e continuar
        </Button>
        <div className="text-center">
          <SignOutButton label="Sair" />
        </div>
      </form>
    </AuthLayout>
  );
}
