"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Callout } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { invitePartnerOffice } from "@/server/auth/team-actions";
import { useToast } from "@/store/ui-store";

/**
 * Convidar parceiro só com o e-mail (Roadmap 2.0). O parceiro recebe o link
 * de uso único (vale 7 dias); no primeiro acesso cria a própria senha e
 * completa o cadastro do escritório e a OAB dele. Para cadastrar tudo pelo
 * escritório principal, continua existindo o formulário completo.
 */
export function InvitePartnerDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [percentage, setPercentage] = useState("50");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (contactName.trim().length < 3) return setError("Informe o nome do contato.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("Informe um e-mail válido.");
    const pct = Number(percentage.replace(",", "."));
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return setError("Percentual do parceiro entre 0 e 100.");
    setError(null);
    setSending(true);
    const result = await invitePartnerOffice({ email, contactName, partnerPercentage: pct });
    setSending(false);
    if (!result.ok) return setError(result.error);
    toast({ tone: "success", title: "Convite enviado", description: `${email.trim()} recebe o link para criar a senha e completar o cadastro.` });
    router.refresh();
    onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !sending && onClose()}
      title="Convidar parceiro"
      description="Basta o e-mail. O parceiro cria a senha e completa os dados do escritório (nome, CNPJ ou CPF, telefone) e a OAB no primeiro acesso."
      footer={
        <>
          <Button variant="ghost" disabled={sending} onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={sending} onClick={() => submit()}>
            Enviar convite
          </Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        {error && <Callout tone="danger" title={error} />}
        <Field label="Nome do contato" requirement="required" hint="Quem vai administrar o escritório parceiro no DG Brasil.">
          {(p) => <Input {...p} autoComplete="off" value={contactName} onChange={(e) => setContactName(e.target.value)} />}
        </Field>
        <Field label="E-mail" requirement="required">
          {(p) => <Input {...p} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label="Participação do parceiro (%)" requirement="required" hint="Divisão padrão dos honorários dos casos deste parceiro. O escritório fica com o restante.">
          {(p) => <Input {...p} inputMode="decimal" value={percentage} onChange={(e) => setPercentage(e.target.value)} className="max-w-[120px]" />}
        </Field>
        <Callout tone="info">
          Por segurança, o convite vai como um link de uso único (vale 7 dias) em vez de uma senha por e-mail: é o link que faz o papel da primeira senha.
        </Callout>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
