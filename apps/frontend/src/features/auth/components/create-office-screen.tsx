"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { HydrationGate } from "@/components/layout/guards";
import { Callout } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { Field, Input, MaskedInput } from "@/components/ui/form";
import { isPhoneFormat, msg, zEmail, zOptional, zRequired } from "@/lib/validation";
import { repositories } from "@/repositories";
import { useToast } from "@/store/ui-store";
import { AuthLayout, AuthLoading } from "./auth-layout";

const schema = z.object({
  officeName: zRequired("Informe o nome do escritório."),
  adminName: zRequired("Informe seu nome completo."),
  adminEmail: zEmail(),
  oab: zOptional(),
  phone: zOptional().refine((v) => !v || isPhoneFormat(v), msg.phone),
});
type FormInput = z.input<typeof schema>;
type FormOutput = z.output<typeof schema>;

function CreateOfficeForm() {
  const router = useRouter();
  const toast = useToast();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: { officeName: "", adminName: "", adminEmail: "", oab: "", phone: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await repositories.office.create(values);
      toast({ tone: "success", title: "Escritório criado", description: "Vamos à implantação." });
      router.push("/onboarding");
    } catch {
      setError("root", { message: "Não foi possível criar o escritório. Tente novamente." });
    }
  });

  return (
    <AuthLayout
      title="Criar escritório"
      description="Quem cria o escritório se torna o primeiro Administrador. Em seguida vem a implantação, em que você configura equipe, áreas e rotinas."
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {errors.root?.message && <Callout tone="danger">{errors.root.message}</Callout>}
        <Field label="Nome do escritório" requirement="required" error={errors.officeName?.message}>
          {(p) => <Input {...p} autoComplete="organization" placeholder="Ex.: Alves & Moura Advocacia" {...register("officeName")} />}
        </Field>
        <Field label="Seu nome completo" requirement="required" error={errors.adminName?.message}>
          {(p) => <Input {...p} autoComplete="name" {...register("adminName")} />}
        </Field>
        <Field label="E-mail" requirement="required" error={errors.adminEmail?.message} hint="Será o seu login de Administrador.">
          {(p) => <Input {...p} type="email" autoComplete="email" {...register("adminEmail")} />}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="OAB" requirement="optional" error={errors.oab?.message}>
            {(p) => <MaskedInput {...p} mask="oab" placeholder="SP 123456" {...register("oab")} />}
          </Field>
          <Field label="Telefone" requirement="optional" error={errors.phone?.message}>
            {(p) => <MaskedInput {...p} mask="phone" type="tel" autoComplete="tel" placeholder="(11) 99999-9999" {...register("phone")} />}
          </Field>
        </div>
        <Callout tone="neutral">Neste protótipo, os dados de demonstração continuam associados ao novo escritório.</Callout>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Criar escritório e iniciar implantação
        </Button>
      </form>
      <p className="mt-8 text-[13px] text-muted">
        Já tem acesso?{" "}
        <Link href="/login" className="font-medium text-navy-700 underline-offset-4 hover:underline">
          Entrar
        </Link>
      </p>
    </AuthLayout>
  );
}

export function CreateOfficeScreen() {
  return (
    <HydrationGate fallback={<AuthLoading />}>
      <CreateOfficeForm />
    </HydrationGate>
  );
}
