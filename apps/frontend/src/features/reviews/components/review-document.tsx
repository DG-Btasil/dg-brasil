import type { ReactNode } from "react";
import { DemoContentNotice } from "@/components/ui/display";
import type { ReviewContent } from "@/types";

/** Material gerado pelo agente, apresentado como documento jurídico sóbrio. */
export function ReviewDocument({ content, toolbar, notice }: { content: ReviewContent; toolbar?: ReactNode; notice?: ReactNode }) {
  return (
    <article aria-label="Documento em revisão" className="overflow-hidden rounded-lg border border-line bg-surface-muted">
      {toolbar}
      <div className="p-6">
        {notice}
        <div className="mx-auto max-w-[760px] rounded-sm border border-line bg-white px-14 py-12 shadow-soft">
          <DemoContentNotice className="mb-6">{content.disclaimer}</DemoContentNotice>
          <h2 className="font-serif text-[24px] font-medium leading-snug text-navy">{content.title}</h2>
          <div className="mt-8 space-y-7">
            {content.sections.map((section, i) => (
              <section key={`${section.heading}-${i}`}>
                <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-navy-700">{section.heading}</h3>
                <p className="mt-2 whitespace-pre-line text-[14px] leading-[1.75] text-foreground">{section.body}</p>
              </section>
            ))}
          </div>
          <p className="mt-10 border-t border-line pt-4 text-[11.5px] text-muted">{content.disclaimer}</p>
        </div>
      </div>
    </article>
  );
}
