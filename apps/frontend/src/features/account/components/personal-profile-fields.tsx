"use client";

import { Field, Input, MaskedInput, Select } from "@/components/ui/form";
import { GENDER_OPTIONS, UF_OPTIONS, type PersonalProfileField, type PersonalProfileInput } from "@/lib/account/personal-profile";

/**
 * Campos do cadastro pessoal (079). Um formulário só, usado na etapa
 * obrigatória "Complete seu cadastro" e na tela "Meu perfil". Sem estado
 * próprio: quem usa guarda os valores e os erros.
 */
export function PersonalProfileFields({
  value,
  errors,
  onChange,
  disabled,
}: {
  value: PersonalProfileInput;
  errors: Partial<Record<PersonalProfileField, string>>;
  onChange: (field: PersonalProfileField, value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-4">
      <Field label="Nome completo" requirement="required" error={errors.fullName}>
        {(p) => <Input {...p} autoComplete="name" maxLength={120} disabled={disabled} value={value.fullName} onChange={(e) => onChange("fullName", e.target.value)} />}
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Como prefere ser chamado" requirement="optional" hint="É o nome que aparece no topo da tela." error={errors.preferredName}>
          {(p) => <Input {...p} autoComplete="nickname" maxLength={40} disabled={disabled} value={value.preferredName} onChange={(e) => onChange("preferredName", e.target.value)} />}
        </Field>
        <Field label="Cargo" requirement="optional" hint="Aparece na lista da equipe." error={errors.jobTitle}>
          {(p) => <Input {...p} autoComplete="organization-title" maxLength={80} disabled={disabled} value={value.jobTitle} onChange={(e) => onChange("jobTitle", e.target.value)} />}
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Gênero" requirement="optional" error={errors.gender}>
          {(p) => <Select {...p} placeholder="Selecione" options={GENDER_OPTIONS} disabled={disabled} value={value.gender} onChange={(e) => onChange("gender", e.target.value)} />}
        </Field>
        <Field label="Data de nascimento" requirement="optional" hint="Usada só para o aviso de aniversário à equipe." error={errors.birthDate}>
          {(p) => <Input {...p} type="date" autoComplete="bday" min="1900-01-01" disabled={disabled} value={value.birthDate} onChange={(e) => onChange("birthDate", e.target.value)} />}
        </Field>
      </div>

      <Field label="Telefone / WhatsApp" requirement="optional" error={errors.phone}>
        {(p) => (
          <MaskedInput {...p} mask="phone" autoComplete="tel-national" placeholder="(00) 00000-0000" disabled={disabled} value={value.phone} onChange={(e) => onChange("phone", e.target.value)} />
        )}
      </Field>

      <fieldset className="space-y-3 rounded-lg border border-line p-4">
        <legend className="px-1 text-[12.5px] font-semibold text-foreground">Onde você trabalha</legend>
        <p className="text-[12.5px] text-muted">A cidade do escritório em que você atua, não o seu endereço.</p>
        <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
          <Field label="Cidade" requirement="required" error={errors.officeCity}>
            {(p) => <Input {...p} maxLength={80} disabled={disabled} value={value.officeCity} onChange={(e) => onChange("officeCity", e.target.value)} />}
          </Field>
          <Field label="UF" requirement="required" error={errors.officeState}>
            {(p) => <Select {...p} placeholder="—" options={UF_OPTIONS} disabled={disabled} value={value.officeState} onChange={(e) => onChange("officeState", e.target.value)} />}
          </Field>
        </div>
      </fieldset>
    </div>
  );
}
