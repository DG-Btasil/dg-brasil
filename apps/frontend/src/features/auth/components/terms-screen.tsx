"use client";

import { useState } from "react";
import { Callout } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/form";
import { LEGAL_DOCUMENTS } from "@/lib/auth/legal-documents";
import type { LegalDocumentType } from "@/lib/auth/types";
import { acceptLegalTerms } from "@/server/auth/actions";
import { AuthLayout } from "./auth-layout";
import { hardNavigate } from "./navigation";
import { OnboardingSteps } from "./onboarding-steps";
import { SignOutButton } from "./sign-out-button";

/**
 * Aceite dos documentos legais VIGENTES (os pendentes para esta pessoa).
 * O servidor grava tipo, versão, data, IP e navegador — append-only.
 */
export function TermsScreen({ pending, next }: { pending: LegalDocumentType[]; next?: string }) {
  const docs = LEGAL_DOCUMENTS.filter((d) => pending.includes(d.type));
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onAccept() {
    setSubmitting(true);
    setError(null);
    const result = await acceptLegalTerms();
    if (!result.ok) {
      setSubmitting(false);
      return setError(result.error);
    }
    hardNavigate(next ? `/?next=${encodeURIComponent(next)}` : "/");
  }

  return (
    <AuthLayout title="Termos e privacidade" description="Leia e aceite os documentos abaixo para continuar.">
      <OnboardingSteps current="terms" withPassword={false} />
      <div className="max-h-[46vh] space-y-5 overflow-y-auto rounded-md border border-line bg-surface-muted px-4 py-4">
        {docs.map((doc) => (
          <section key={doc.type} aria-labelledby={`doc-${doc.type}`}>
            <h2 id={`doc-${doc.type}`} className="text-[13.5px] font-semibold text-foreground">
              {doc.title} <span className="font-normal text-muted">· versão {doc.version}</span>
            </h2>
            {doc.paragraphs.map((p, i) => (
              <p key={i} className={i === 0 && doc.provisional ? "mt-2 text-[12.5px] font-semibold text-warning" : "mt-2 text-[12.5px] leading-relaxed text-foreground/80"}>
                {p}
              </p>
            ))}
          </section>
        ))}
      </div>
      <div className="mt-5 space-y-4">
        {error && <Callout tone="danger" title={error} />}
        <Checkbox
          label="Li e aceito os documentos acima."
          description="Registramos a versão aceita, a data, o IP e o navegador."
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
        />
        <Button size="lg" className="w-full" disabled={!agreed} loading={submitting} onClick={onAccept}>
          Aceitar e continuar
        </Button>
        <div className="text-center">
          <SignOutButton label="Não aceito — sair" />
        </div>
      </div>
    </AuthLayout>
  );
}
