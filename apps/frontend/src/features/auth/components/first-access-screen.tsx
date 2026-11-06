"use client";

import { useState, type FormEvent } from "react";
import { Callout } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, MaskedInput, Select } from "@/components/ui/form";
import { passwordProblem } from "@/lib/auth/password-policy";
import { BRAZILIAN_STATES } from "@/lib/constants/legal";
import { formatCNPJ, formatCPF } from "@/lib/formatting";
import { taxIdProblem } from "@/lib/validation";
import { completeInvitation, type InvitationContext } from "@/server/auth/actions";
import { AuthLayout } from "./auth-layout";
import { hardNavigate } from "./navigation";
import { OnboardingSteps } from "./onboarding-steps";
import { PasswordFields } from "./password-fields";

const UF_OPTIONS = BRAZILIAN_STATES.map((uf) => ({ value: uf, label: uf }));
/** Papéis em que a OAB é obrigatória (advogado da casa e usuário do parceiro). */
const OAB_REQUIRED_ROLES = new Set(["LAWYER", "PARTNER_USER"]);
/** Papéis que podem ter OAB (administradores: opcional). */
const OAB_OPTIONAL_ROLES = new Set(["ADMIN", "PARTNER_ADMIN"]);

/**
 * Primeiro acesso por convite: nome + senha e, conforme o convite (048):
 * - OAB da pessoa (já sugerida por quem convidou; obrigatória para advogado);
 * - para o administrador de um parceiro convidado só por e-mail, os dados do
 *   escritório (nome, razão social, CNPJ ou CPF, telefone).
 * Em seguida o servidor leva aos termos e ao MFA — só então o sistema abre.
 */
export function FirstAccessScreen({
  inviteRef,
  email,
  defaultName,
  invitation,
}: {
  inviteRef: string;
  email?: string;
  defaultName?: string;
  invitation?: InvitationContext;
}) {
  const role = invitation?.role ?? "";
  const oabRequired = OAB_REQUIRED_ROLES.has(role);
  const oabAllowed = oabRequired || OAB_OPTIONAL_ROLES.has(role);
  const needsOffice = !!invitation?.needsOfficeProfile;

  const [fullName, setFullName] = useState(defaultName ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [noOab, setNoOab] = useState(false);
  const [oabNumber, setOabNumber] = useState(invitation?.oabNumber ?? "");
  const [oabState, setOabState] = useState(invitation?.oabState ?? "");
  const [office, setOffice] = useState({ name: "", legalName: "", document: "", phone: "", email: "" });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const setOfficeField = (k: keyof typeof office, v: string) => setOffice((o) => ({ ...o, [k]: v }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (fullName.trim().length < 3) return setError("Informe seu nome completo.");
    const problem = passwordProblem(password, { email, name: fullName });
    if (problem) return setError(problem);
    if (password !== confirm) return setError("As senhas não coincidem.");
    const wantsOab = oabAllowed && !noOab && (oabRequired || needsOffice || oabNumber.trim() !== "");
    if (wantsOab && (!oabNumber.trim() || !oabState)) return setError("Informe o número e a UF da OAB.");
    if (needsOffice) {
      if (!office.name.trim()) return setError("Informe o nome do escritório.");
      const digits = office.document.replace(/\D/g, "");
      const docProblem = digits.length === 11 ? taxIdProblem(office.document, "cpf") : digits.length === 14 ? taxIdProblem(office.document, "cnpj") : "Informe o CNPJ ou o CPF do escritório.";
      if (docProblem) return setError(docProblem);
      if (office.phone.replace(/\D/g, "").length < 10) return setError("Informe o telefone do escritório com DDD.");
    }
    setError(null);
    setSubmitting(true);
    const result = await completeInvitation({
      ref: inviteRef,
      fullName,
      password,
      oab: wantsOab ? { number: oabNumber, state: oabState } : undefined,
      office: needsOffice ? office : undefined,
    });
    if (!result.ok) {
      setSubmitting(false);
      return setError(result.error);
    }
    hardNavigate("/");
  }

  return (
    <AuthLayout
      title={needsOffice ? "Cadastro do seu escritório" : "Primeiro acesso"}
      description={email ? `Convite para ${email}${invitation?.organizationName && !needsOffice ? ` · ${invitation.organizationName}` : ""}` : "Conclua seu cadastro para acessar o DG Brasil."}
    >
      <OnboardingSteps current="password" />
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {error && <Callout tone="danger" title={error} />}
        <Field label="Nome completo" requirement="required">
          {(p) => <Input {...p} autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />}
        </Field>

        {oabAllowed && (
          <fieldset className="space-y-3 rounded-lg border border-line p-4">
            <legend className="px-1 text-[12.5px] font-semibold text-foreground">Sua OAB</legend>
            {!oabRequired && !needsOffice && (
              <Checkbox checked={noOab} onChange={(e) => setNoOab(e.target.checked)} label="Não sou advogado(a)" description="Você pode cadastrar OABs depois, em Minha conta." />
            )}
            {!noOab && (
              <div className="grid grid-cols-[1fr_96px] gap-3">
                <Field label="Número da OAB" requirement={oabRequired || needsOffice ? "required" : "optional"} hint="Outras seccionais você cadastra depois, em Minha conta.">
                  {(p) => <Input {...p} inputMode="numeric" value={oabNumber} onChange={(e) => setOabNumber(e.target.value)} placeholder="000000" />}
                </Field>
                <Field label="UF" requirement={oabRequired || needsOffice ? "required" : "optional"}>
                  {(p) => <Select {...p} placeholder="—" options={UF_OPTIONS} value={oabState} onChange={(e) => setOabState(e.target.value)} />}
                </Field>
              </div>
            )}
          </fieldset>
        )}

        {needsOffice && (
          <fieldset className="space-y-3 rounded-lg border border-line p-4">
            <legend className="px-1 text-[12.5px] font-semibold text-foreground">Seu escritório</legend>
            <p className="text-[12.5px] text-muted">Estes dados identificam o seu escritório na parceria com a Bárbara Cardoso Advocacia.</p>
            <Field label="Nome do escritório" requirement="required">
              {(p) => <Input {...p} value={office.name} onChange={(e) => setOfficeField("name", e.target.value)} maxLength={200} />}
            </Field>
            <Field label="Razão social" requirement="optional" hint="Se o escritório tiver CNPJ.">
              {(p) => <Input {...p} value={office.legalName} onChange={(e) => setOfficeField("legalName", e.target.value)} maxLength={200} />}
            </Field>
            <Field label="CNPJ ou CPF" requirement="required" hint="Advogado(a) sem CNPJ: informe o seu CPF.">
              {(p) => (
                <Input
                  {...p}
                  inputMode="numeric"
                  value={office.document}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "").slice(0, 14);
                    setOfficeField("document", digits.length <= 11 ? formatCPF(digits) : formatCNPJ(digits));
                  }}
                  placeholder="000.000.000-00 ou 00.000.000/0000-00"
                />
              )}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Telefone" requirement="required">
                {(p) => <MaskedInput {...p} mask="phone" value={office.phone} onChange={(e) => setOfficeField("phone", e.target.value)} placeholder="(00) 00000-0000" />}
              </Field>
              <Field label="E-mail do escritório" requirement="optional">
                {(p) => <Input {...p} type="email" value={office.email} onChange={(e) => setOfficeField("email", e.target.value)} />}
              </Field>
            </div>
          </fieldset>
        )}

        <PasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
        <Button type="submit" size="lg" className="w-full" loading={submitting}>
          Continuar
        </Button>
      </form>
    </AuthLayout>
  );
}
