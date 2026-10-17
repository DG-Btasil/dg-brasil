import { Sparkles } from "lucide-react";
import { Callout } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import type { AnalysisResult } from "@/types";

const RELEVANCE: Record<"HIGH" | "MEDIUM" | "LOW", { label: string; tone: "danger" | "warning" | "neutral" }> = {
  HIGH: { label: "Alta", tone: "danger" },
  MEDIUM: { label: "Média", tone: "warning" },
  LOW: { label: "Baixa", tone: "neutral" },
};

const REVIEW_LABEL: Record<string, string> = {
  PENDING: "aguardando revisão humana",
  REOPENED: "revisão reaberta",
  APPROVED: "aprovado na revisão",
  REJECTED: "rejeitado na revisão",
  CHANGES_REQUESTED: "alterações pedidas na revisão",
};

/**
 * Resultado de análise entregue pelo agente (039). Texto sempre como texto
 * (React escapa; nada de HTML do modelo). O cabeçalho separa o resultado da
 * IA da decisão humana: enquanto a revisão não aprova, ele NÃO vale.
 */
export function AnalysisResultView({ result, reviewStatus }: { result: AnalysisResult; reviewStatus?: string }) {
  const approved = reviewStatus === "APPROVED";
  const structured = result.schemaVersion !== undefined;
  return (
    <section aria-label="Resultado da análise pelo agente" className="space-y-4">
      <Callout
        tone={approved ? "success" : "warning"}
        title={
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="size-4" aria-hidden />
            Resultado da IA{reviewStatus ? ` · ${REVIEW_LABEL[reviewStatus] ?? reviewStatus}` : ""}
          </span>
        }
      >
        {approved
          ? "Aprovado por um advogado na revisão."
          : "Produzido pelo agente. Não está aprovado: só vale depois da decisão humana em Revisões."}
      </Callout>

      <Block title="Resumo">
        <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-foreground">{result.summary || "—"}</p>
      </Block>
      {result.recommendation && (
        <Block title="Recomendação">
          <p className="whitespace-pre-wrap text-[13.5px] font-medium text-navy">{result.recommendation}</p>
        </Block>
      )}

      {structured && (
        <>
          {!!result.findings?.length && (
            <Block title="Achados">
              <ul className="space-y-2.5">
                {result.findings.map((f, i) => (
                  <li key={`${i}-${f.title}`} className="rounded-md border border-line px-3.5 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[13px] font-semibold text-foreground">{f.title}</span>
                      <Badge tone={RELEVANCE[f.relevance].tone}>Relevância {RELEVANCE[f.relevance].label.toLowerCase()}</Badge>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-[13px] text-muted">{f.detail}</p>
                    {f.documentVersionIds.length > 0 && (
                      <p className="mt-1 text-[11.5px] text-subtle">Baseado em {f.documentVersionIds.length} documento(s) do caso.</p>
                    )}
                  </li>
                ))}
              </ul>
            </Block>
          )}
          <TextList title="Informações ou documentos que faltam" items={result.missingInformation} empty="Nenhuma falta apontada." />
          <TextList title="Recomendações complementares" items={result.recommendations} />
          {!!result.proposedActions?.length && (
            <Block title="Providências sugeridas">
              <ul className="list-disc space-y-1 pl-5 text-[13px] text-foreground">
                {result.proposedActions.map((a, i) => (
                  <li key={`${i}-${a.description}`}>
                    {a.description}
                    {a.proposalType && <span className="ml-1.5 text-[11.5px] text-subtle">(registrada como proposta para revisão)</span>}
                  </li>
                ))}
              </ul>
            </Block>
          )}
          {!!result.thesesConsidered?.length && (
            <Block title="Teses avaliadas">
              <ul className="space-y-2">
                {result.thesesConsidered.map((t) => (
                  <li key={t.thesisId} className="text-[13px]">
                    <span className="font-medium text-foreground">{t.title ?? "Tese"}</span>{" "}
                    <Badge tone={t.applicable ? "success" : "neutral"}>{t.applicable ? "Aplicável" : "Não aplicável"}</Badge>
                    <p className="mt-0.5 whitespace-pre-wrap text-muted">{t.rationale}</p>
                  </li>
                ))}
              </ul>
            </Block>
          )}
          <Block title="Fontes consultadas">
            {result.referencesUsed?.length ? (
              <ul className="space-y-1.5 text-[13px]">
                {result.referencesUsed.map((r) => (
                  <li key={r.referenceId}>
                    <span className="font-medium text-foreground">{r.title}</span>
                    <span className="text-muted"> — {r.howUsed}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">Nenhuma referência citada pelo agente.</p>
            )}
          </Block>
        </>
      )}
      {!structured && result.identifiedThesisIds.length > 0 && (
        <p className="text-[12.5px] text-muted">Teses identificadas: {result.identifiedThesisIds.length}</p>
      )}
    </section>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.06em] text-subtle">{title}</h3>
      {children}
    </div>
  );
}

function TextList({ title, items, empty }: { title: string; items?: string[]; empty?: string }) {
  if (!items?.length && !empty) return null;
  return (
    <Block title={title}>
      {items?.length ? (
        <ul className="list-disc space-y-1 pl-5 text-[13px] text-foreground">
          {items.map((x, i) => (
            <li key={`${i}-${x}`} className="whitespace-pre-wrap">{x}</li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted">{empty}</p>
      )}
    </Block>
  );
}
