"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Newspaper } from "lucide-react";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState, SkeletonRows } from "@/components/feedback/states";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { formatCNJ, formatDate } from "@/lib/formatting";
import { listJudicialPublicationsAction } from "@/server/domain/judicial/actions";
import type { PublicationPageDTO } from "@/server/domain/judicial/dto";
import { TRIAGE_LABEL, TRIAGE_TONE } from "../labels";
import { PublicationDrawer } from "./publication-drawer";

type View = "minhas" | "abertas" | "agente" | "tratadas";
const VIEWS: TabItem<View>[] = [
  { key: "minhas", label: "Minhas a tratar" },
  { key: "abertas", label: "Todas a tratar" },
  { key: "agente", label: "Com o agente" },
  { key: "tratadas", label: "Tratadas" },
];
const FILTER: Record<View, { status: "OPEN" | "WITH_AGENT" | "DONE"; mine?: boolean }> = {
  minhas: { status: "OPEN", mine: true },
  abertas: { status: "OPEN" },
  agente: { status: "WITH_AGENT" },
  tratadas: { status: "DONE" },
};
const PAGE = 25;
/** Parâmetro da URL com a aba escolhida ("aba" já é a aba da ficha do processo). */
const VIEW_PARAM = "lista";
const isView = (v: string | null): v is View => v === "minhas" || v === "abertas" || v === "agente" || v === "tratadas";

/** Lista vazia: a frase diz qual aba está vazia. */
const EMPTY_TITLE: Record<View, string> = {
  minhas: "Nenhuma publicação sua a tratar.",
  abertas: "Nenhuma publicação a tratar.",
  agente: "Nenhuma publicação com o agente.",
  tratadas: "Nenhuma publicação tratada.",
};
const EMPTY_DESCRIPTION: Partial<Record<View, string>> = {
  minhas: "Publicações dos processos em que você é o responsável aparecem aqui.",
  agente: "Publicação enviada a um agente para ler e propor o prazo fica aqui até a resposta chegar em Revisões.",
};

/**
 * Caixa de publicações do DJEN (equipe interna). Cada publicação de processo
 * cadastrado chega aqui "a tratar" até uma pessoa criar o prazo ou registrar
 * que não há prazo. `processId`: só as de um processo (aba do processo).
 */
export function PublicationsInbox({ processId }: { processId?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // A aba escolhida vai para a URL: recarregar ou mandar o link abre na mesma aba.
  const fromUrl = params.get(VIEW_PARAM);
  const view: View = isView(fromUrl) && !(processId && fromUrl === "minhas") ? fromUrl : processId ? "abertas" : "minhas";
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ActionResult<PublicationPageDTO> | null>(null);
  const [version, setVersion] = useState(0);
  const openId = params.get("id");
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let alive = true;
    const f = processId ? { status: view === "tratadas" ? "DONE" : view === "agente" ? "WITH_AGENT" : "OPEN" } : FILTER[view];
    callAction(() => listJudicialPublicationsAction({ ...f, processId, page, pageSize: PAGE })).then((r) => alive && setData(r));
    return () => {
      alive = false;
    };
  }, [view, page, processId, version]);

  const open = (id: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("id", id);
    else next.delete("id");
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };

  const setView = (v: View) => {
    const next = new URLSearchParams(params.toString());
    next.set(VIEW_PARAM, v);
    // Até a lista da aba nova chegar, nada da aba anterior fica na tela.
    setData(null);
    router.replace(`${pathname}?${next}`, { scroll: false });
  };

  const tabs = processId ? VIEWS.filter((v) => v.key !== "minhas") : VIEWS;

  return (
    <Panel>
      <PanelHeader
        title={processId ? "Publicações do processo" : "Publicações do DJEN"}
        description="Publicações dos processos cadastrados, capturadas pelas OABs acompanhadas. Toda publicação é tratada por uma pessoa: criar o prazo ou registrar que não há prazo."
      />
      <div className="px-5 pt-3">
        <Tabs
          items={tabs}
          value={view}
          onChange={(v) => {
            setView(v);
            setPage(1);
          }}
          label="Filtro das publicações"
        />
      </div>
      {!data ? (
        <div className="p-5">
          <SkeletonRows rows={5} />
        </div>
      ) : !data.ok ? (
        <ActionErrorState error={data} title="Não foi possível carregar as publicações." />
      ) : data.data.items.length === 0 ? (
        <EmptyState compact icon={Newspaper} title={EMPTY_TITLE[view]} description={EMPTY_DESCRIPTION[view]} />
      ) : (
        <>
          <Table caption="Publicações">
            <THead>
              <tr>
                <Th>Disponibilizada</Th>
                {!processId && <Th>Processo</Th>}
                <Th>Publicação</Th>
                <Th>Situação</Th>
                <Th className="text-right">Ação</Th>
              </tr>
            </THead>
            <TBody>
              {data.data.items.map((p) => (
                <Tr key={p.id} className="cursor-pointer" onClick={() => open(p.id)}>
                  <Td className="whitespace-nowrap tabular text-[12.5px]">{formatDate(p.availableOn)}</Td>
                  {!processId && (
                    <Td className="text-[12.5px]">
                      <Link href={`/processos/${p.legalProcessId}`} onClick={(e) => e.stopPropagation()} className="font-medium text-navy hover:underline underline-offset-2">
                        {/* Processo sem título próprio leva o nome do caso. */}
                        {p.processTitle || p.caseTitle || formatCNJ(p.cnjNumber)}
                      </Link>
                      <span className="block text-muted">{p.clientName ?? ""}</span>
                    </Td>
                  )}
                  <Td className="text-[12.5px]">
                    <span className="font-medium text-foreground">
                      {p.communicationType ?? "Publicação"} · {p.court ?? ""}
                    </span>
                    {p.cancelledAt && (
                      <Badge tone="danger" className="ml-1.5">
                        Cancelada
                      </Badge>
                    )}
                    <span className="mt-0.5 block line-clamp-2 text-muted">{p.excerpt}</span>
                  </Td>
                  <Td>
                    <StatusBadge status={p.triageStatus} labels={TRIAGE_LABEL} tones={TRIAGE_TONE} />
                  </Td>
                  <Td className="text-right">
                    {/* A linha inteira abre com o mouse; o botão abre pelo teclado e por leitor de tela. */}
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Abrir a publicação de ${formatDate(p.availableOn)}, ${p.processTitle || p.caseTitle || formatCNJ(p.cnjNumber)}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        open(p.id);
                      }}
                    >
                      Abrir
                    </Button>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <div className="px-5 py-3">
            <Pagination page={page} pageSize={PAGE} total={data.data.total} onPageChange={setPage} noun={{ one: "publicação", many: "publicações" }} />
          </div>
        </>
      )}
      {openId && <PublicationDrawer key={openId} id={openId} onClose={() => open(null)} onChanged={reload} />}
    </Panel>
  );
}
