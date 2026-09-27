import type { ReactNode } from "react";
import { Wordmark } from "@/components/layout/wordmark";

const FACTS = [
  "Clientes, documentos, processos e prazos em um único ambiente.",
  "Agentes executam tarefas; toda decisão jurídica passa por revisão humana.",
  "Cada perfil vê apenas o que sua função exige.",
];

/** Estrutura das páginas públicas: painel institucional + área de formulário. */
export function AuthLayout({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-screen grid-cols-1 bg-surface lg:grid-cols-[minmax(420px,5fr)_7fr]">
      <aside className="hidden flex-col justify-between bg-navy px-12 py-10 text-white lg:flex">
        <Wordmark tone="light" />
        <div className="max-w-[440px]">
          <span aria-hidden className="mb-6 block h-px w-12 bg-gold" />
          <p className="font-serif text-[34px] font-medium leading-[1.15] tracking-[-0.01em]">Escritório jurídico digital operacional.</p>
          <ul className="mt-8 space-y-3.5">
            {FACTS.map((fact) => (
              <li key={fact} className="flex gap-3 text-[13.5px] leading-relaxed text-white/75">
                <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-gold-300" />
                {fact}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[12px] text-white/50">Ambiente de demonstração — dados fictícios.</p>
      </aside>

      <main className="flex flex-col px-6 py-10 sm:px-12">
        <div className="mb-10 lg:hidden">
          <Wordmark tone="dark" />
        </div>
        <div className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center">
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-foreground">{title}</h1>
          {description && <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{description}</p>}
          <div className="mt-8">{children}</div>
        </div>
        <p className="mt-10 text-center text-[11.5px] text-subtle lg:hidden">Ambiente de demonstração — dados fictícios.</p>
      </main>
    </div>
  );
}

/** Fallback enquanto o estado local é carregado. */
export function AuthLoading() {
  return (
    <AuthLayout title="Carregando…">
      <div role="status" aria-label="Carregando" className="space-y-3">
        <div className="h-9 animate-pulse-soft rounded-md bg-surface-sunken" />
        <div className="h-9 animate-pulse-soft rounded-md bg-surface-sunken" />
      </div>
    </AuthLayout>
  );
}
