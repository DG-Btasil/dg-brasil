"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CalendarX2, Newspaper, Pause, Play, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { ActionErrorState } from "@/components/feedback/action-error";
import { Callout, EmptyState, SkeletonRows } from "@/components/feedback/states";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { DefinitionGrid, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { BRAZILIAN_STATES } from "@/lib/constants/legal";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { formatDate, formatEventTime, formatNumber } from "@/lib/formatting";
import { useResponsibleUserOptions } from "@/features/directory/directory-context";
import {
  deleteCourtCalendarDayAction, getJudicialOverviewAction, saveCourtCalendarDayAction, saveJudicialMonitorAction,
  saveJudicialSettingsAction, setJudicialMonitorActiveAction, syncJudicialNowAction,
} from "@/server/domain/judicial/actions";
import type { JudicialMonitorDTO, JudicialOverviewDTO } from "@/server/domain/judicial/dto";
import { useToast } from "@/store/ui-store";
import { RUN_SCOPE_LABEL, RUN_STATUS_LABEL, RUN_STATUS_TONE, runSummary } from "../labels";
import { CoverageDialog } from "./coverage-dialog";
import { MonitorStatus } from "./monitor-status";

/**
 * Integração judicial em Configurações → Integrações (043). DJEN (publicações
 * pelas OABs) e DataJud (andamentos pelo número CNJ), só para processos que já
 * estão no DG Brasil. ADMIN configura; advogado acompanha.
 */
export function JudicialSettingsPanel() {
  const toast = useToast();
  const failed = useActionFeedback();
  const [data, setData] = useState<ActionResult<JudicialOverviewDTO> | null>(null);
  const [version, setVersion] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [coverage, setCoverage] = useState<JudicialMonitorDTO | null>(null);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let alive = true;
    callAction(() => getJudicialOverviewAction()).then((r) => alive && setData(r));
    return () => {
      alive = false;
    };
  }, [version]);

  async function syncNow() {
    setSyncing(true);
    const r = await callAction(() => syncJudicialNowAction({}));
    setSyncing(false);
    if (!r.ok) return failed(r, "A busca não pôde ser feita.");
    if (r.data.busy) toast({ tone: "info", title: "Já existe uma busca em andamento", description: "Aguarde alguns minutos e atualize." });
    else toast({ tone: r.data.status === "COMPLETED" ? "success" : "warning", title: r.data.status === "COMPLETED" ? "Busca concluída" : "Busca concluída com falhas", description: runSummary(r.data.stats) });
    reload();
  }

  async function toggle(m: JudicialMonitorDTO) {
    const r = await callAction(() => setJudicialMonitorActiveAction({ id: m.id, active: !m.active }));
    if (!r.ok) return failed(r, "Não foi possível alterar a OAB.");
    reload();
  }

  if (!data) return <SkeletonRows rows={4} />;
  if (!data.ok) return <ActionErrorState error={data} title="Não foi possível ler a integração judicial." />;
  const d = data.data;
  const last = d.runs.find((r) => r.scope === "ALL" && r.status !== "RUNNING");
  const own = d.monitors.filter((m) => m.organizationType === "OWNER");
  const partners = d.monitors.filter((m) => m.organizationType !== "OWNER");

  return (
    <section aria-labelledby="judicial-title" className="space-y-3">
      <h3 id="judicial-title" className="text-[15px] font-semibold text-foreground">
        Integração judicial (DJEN e DataJud)
      </h3>

      <Panel>
        <PanelHeader
          title="Publicações e andamentos"
          description="Só atualiza processos que já estão no DG Brasil: o advogado cadastra o número CNJ ao protocolar e, daí em diante, o processo recebe as publicações do DJEN (pelas OABs abaixo) e os andamentos do DataJud. Nada é importado de quem não é cliente."
          actions={
            d.canManage && (
              <Button size="sm" variant="secondary" icon={<RefreshCw className="size-4" aria-hidden />} loading={syncing} onClick={syncNow}>
                Buscar agora
              </Button>
            )
          }
        />
        <PanelBody className="space-y-3">
          <DefinitionGrid
            columns={4}
            items={[
              { label: "Última busca completa", value: last ? `${formatEventTime(last.finishedAt ?? last.startedAt)} · ${RUN_STATUS_LABEL[last.status]}` : "Ainda não" },
              { label: "Processos acompanhados", value: `${formatNumber(d.processes.tracked)}${d.processes.neverSynced ? ` · ${d.processes.neverSynced} ainda sem leitura` : ""}` },
              {
                label: "Publicações a tratar",
                value: (
                  <Link href="/publicacoes" className="font-medium text-navy hover:underline underline-offset-2">
                    {formatNumber(d.publications.pending)}
                    {d.publications.withAgent ? ` · ${d.publications.withAgent} com o agente` : ""}
                  </Link>
                ),
              },
              { label: "Processos com aviso", value: formatNumber(d.processes.withError) },
            ]}
          />
          <p className="text-[12px] text-muted">
            Publicações: uma vez por dia, de manhã, revendo os últimos {d.settings.lookbackDays} dias (o DJEN libera parte das publicações com atraso). Andamentos: o DataJud atualiza a cópia pública com 1 a 3 semanas de atraso; quem traz a intimação a tempo é o DJEN.
          </p>
          {d.canManage && <SettingsForm overview={d} onSaved={reload} />}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader
          title="OABs acompanhadas"
          description="Do escritório (cadastradas aqui) e dos parceiros (cada parceiro cadastra a própria OAB no portal). Publicação de processo que não está no DG Brasil não é importada: aparece só o número, para o advogado decidir se cadastra."
          actions={
            d.canManage && (
              <Button size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setAdding(true)}>
                Adicionar OAB
              </Button>
            )
          }
        />
        {d.monitors.length === 0 ? (
          <EmptyState compact icon={Newspaper} title="Nenhuma OAB acompanhada." description="Cadastre a OAB de cada advogado do escritório para receber as publicações do DJEN." />
        ) : (
          <MonitorTable rows={[...own, ...partners]} canManage={d.canManage} onToggle={toggle} onCoverage={setCoverage} />
        )}
      </Panel>

      <Panel>
        <PanelHeader title="Últimas buscas" description="Rodada da manhã (publicações e andamentos), lotes extras do DataJud e buscas pedidas na tela." />
        {d.runs.length === 0 ? (
          <EmptyState compact title="Nenhuma busca ainda." />
        ) : (
          <Table caption="Últimas buscas da integração judicial">
            <THead>
              <tr>
                <Th>Início</Th>
                <Th>Tipo</Th>
                <Th>Situação</Th>
                <Th>Resultado</Th>
              </tr>
            </THead>
            <TBody>
              {d.runs.map((r) => (
                <Tr key={r.id}>
                  <Td className="whitespace-nowrap text-[12.5px]">{formatEventTime(r.startedAt)}</Td>
                  <Td className="text-[12.5px]">
                    {RUN_SCOPE_LABEL[r.scope]}
                    {r.trigger === "MANUAL" ? " · pedida na tela" : ""}
                  </Td>
                  <Td>
                    <StatusBadge status={r.status} labels={RUN_STATUS_LABEL} tones={RUN_STATUS_TONE} />
                  </Td>
                  <Td className="text-[12.5px] text-muted">
                    {runSummary(r.stats)}
                    {r.error && <span className="mt-0.5 block whitespace-pre-line text-danger">{r.error}</span>}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>

      <CalendarPanel overview={d} onChanged={reload} />

      {adding && <AddMonitorDialog onClose={() => setAdding(false)} onSaved={reload} />}
      {coverage && <CoverageDialog monitor={coverage} onClose={() => setCoverage(null)} />}
    </section>
  );
}

function SettingsForm({ overview, onSaved }: { overview: JudicialOverviewDTO; onSaved: () => void }) {
  const failed = useActionFeedback();
  const toast = useToast();
  const s = overview.settings;
  const [djen, setDjen] = useState(s.djenEnabled);
  const [datajud, setDatajud] = useState(s.datajudEnabled);
  const [lookback, setLookback] = useState(String(s.lookbackDays));
  const [agent, setAgent] = useState(s.deadlineAgentId ?? "");
  const [saving, setSaving] = useState(false);
  const dirty = djen !== s.djenEnabled || datajud !== s.datajudEnabled || Number(lookback) !== s.lookbackDays || agent !== (s.deadlineAgentId ?? "");

  async function save() {
    setSaving(true);
    const r = await callAction(() => saveJudicialSettingsAction({ djenEnabled: djen, datajudEnabled: datajud, lookbackDays: Number(lookback), deadlineAgentId: agent || null }));
    setSaving(false);
    if (!r.ok) return failed(r, "Não foi possível salvar.");
    toast({ tone: "success", title: "Configuração salva" });
    onSaved();
  }

  return (
    <div className="rounded-md border border-line bg-surface-muted p-4">
      <div className="grid gap-4 md:grid-cols-[1fr_1fr_160px]">
        <div className="space-y-2">
          <Checkbox label="Publicações do DJEN" description="Busca diária pelas OABs acompanhadas." checked={djen} onChange={(e) => setDjen(e.target.checked)} />
          <Checkbox label="Andamentos do DataJud" description="Dados e movimentações pelo número CNJ." checked={datajud} onChange={(e) => setDatajud(e.target.checked)} />
        </div>
        <Field label="Agente que propõe prazos" hint="Cada publicação nova vira um trabalho do agente no computador do escritório; a proposta vai para Revisões e só a aprovação cria o prazo. Sem agente, a equipe cria o prazo na tela.">
          {(a) => (
            <Select {...a} value={agent} onChange={(e) => setAgent(e.target.value)} options={[{ value: "", label: "Nenhum (a equipe trata)" }, ...overview.agents.map((x) => ({ value: x.id, label: x.name }))]} />
          )}
        </Field>
        <Field label="Dias revistos" hint="A cada busca no DJEN.">
          {(a) => <Select {...a} value={lookback} onChange={(e) => setLookback(e.target.value)} options={[1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: String(n), label: `${n} dia(s)` }))} />}
        </Field>
      </div>
      <div className="mt-3 flex justify-end">
        <Button size="sm" disabled={!dirty} loading={saving} onClick={save}>
          Salvar configuração
        </Button>
      </div>
    </div>
  );
}

export function MonitorTable({
  rows, canManage, onToggle, onCoverage, showOrganization = true,
}: {
  rows: JudicialMonitorDTO[];
  canManage: boolean;
  onToggle: (m: JudicialMonitorDTO) => void;
  onCoverage: (m: JudicialMonitorDTO) => void;
  showOrganization?: boolean;
}) {
  return (
    <Table caption="OABs acompanhadas">
      <THead>
        <tr>
          <Th>OAB</Th>
          {showOrganization && <Th>Escritório</Th>}
          <Th>Última busca</Th>
          <Th className="text-right">Ações</Th>
        </tr>
      </THead>
      <TBody>
        {rows.map((m) => (
          <Tr key={m.id}>
            <Td>
              <span className="tabular font-medium">
                {m.oabState} {m.oabNumber}
              </span>
              {m.lawyerName && <span className="block text-[12px] text-muted">{m.lawyerName}</span>}
              {!m.active && (
                <Badge tone="neutral" className="mt-1">
                  Pausada
                </Badge>
              )}
            </Td>
            {showOrganization && (
              <Td className="text-[12.5px]">
                {m.organizationName ?? "—"}
                {m.organizationType === "PARTNER" && <span className="block text-[11.5px] text-subtle">Parceiro</span>}
              </Td>
            )}
            <Td className="text-[12.5px]">
              <MonitorStatus monitor={m} />
            </Td>
            <Td className="text-right">
              <div className="flex justify-end gap-1.5">
                <Button size="sm" variant="ghost" icon={<ShieldCheck className="size-3.5" aria-hidden />} onClick={() => onCoverage(m)}>
                  Cobertura
                </Button>
                {canManage && (
                  <Button size="sm" variant="ghost" icon={m.active ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />} onClick={() => onToggle(m)}>
                    {m.active ? "Pausar" : "Retomar"}
                  </Button>
                )}
              </div>
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}

export function AddMonitorDialog({ onClose, onSaved, partner = false }: { onClose: () => void; onSaved: () => void; partner?: boolean }) {
  const failed = useActionFeedback();
  const toast = useToast();
  const [oab, setOab] = useState("");
  const [uf, setUf] = useState("");
  const [name, setName] = useState("");
  const [responsible, setResponsible] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function save() {
    const next: Record<string, string> = {};
    if (!/^\d{1,8}[A-Za-z]?$/.test(oab.replace(/[.\s-]/g, ""))) next.oab = "Use só os números da inscrição (e a letra, se houver).";
    if (!uf) next.uf = "Selecione a UF.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    const r = await callAction(() => saveJudicialMonitorAction({ oabNumber: oab, oabState: uf, lawyerName: name || undefined, responsibleUserId: partner ? undefined : responsible || undefined }));
    setSaving(false);
    if (!r.ok) return failed(r, "Não foi possível cadastrar a OAB.");
    toast({ tone: "success", title: r.data.created ? "OAB cadastrada" : "OAB reativada", description: "As publicações entram na próxima busca (de manhã)." });
    onSaved();
    onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Adicionar OAB acompanhada"
      description="As publicações do DJEN desta OAB passam a ser buscadas todo dia. Só entram no DG Brasil as de processos já cadastrados."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={saving} onClick={save}>
            Adicionar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-4">
          <Field label="Número da OAB" requirement="required" error={errors.oab}>
            {(a) => <Input {...a} value={oab} onChange={(e) => setOab(e.target.value)} placeholder="225006" className="tabular" inputMode="numeric" />}
          </Field>
          <Field label="UF" requirement="required" error={errors.uf}>
            {(a) => <Select {...a} value={uf} onChange={(e) => setUf(e.target.value)} options={BRAZILIAN_STATES.map((s) => ({ value: s, label: s }))} placeholder="UF" />}
          </Field>
        </div>
        <Field label="Nome do advogado" requirement="recommended">
          {(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />}
        </Field>
        {!partner && <ResponsibleField value={responsible} onChange={setResponsible} />}
      </div>
    </Dialog>
  );
}

/** Só do lado do escritório (usa o diretório da equipe interna). */
function ResponsibleField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const responsibleOptions = useResponsibleUserOptions();
  return (
    <Field label="Responsável" requirement="recommended" hint="Quem acompanha esta OAB no escritório.">
      {(a) => <Select {...a} value={value} onChange={(e) => onChange(e.target.value)} options={responsibleOptions} placeholder="Selecione" />}
    </Field>
  );
}

function CalendarPanel({ overview, onChanged }: { overview: JudicialOverviewDTO; onChanged: () => void }) {
  const failed = useActionFeedback();
  const [open, setOpen] = useState(false);
  const [court, setCourt] = useState("");
  const [day, setDay] = useState("");
  const [kind, setKind] = useState<"HOLIDAY" | "SUSPENSION">("HOLIDAY");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const r = await callAction(() => saveCourtCalendarDayAction({ court, day, kind, description }));
    setSaving(false);
    if (!r.ok) return failed(r, "Não foi possível salvar o dia.");
    setOpen(false);
    setCourt("");
    setDay("");
    setDescription("");
    onChanged();
  }

  async function remove(id: string) {
    const r = await callAction(() => deleteCourtCalendarDayAction({ id }));
    if (!r.ok) return failed(r, "Não foi possível remover o dia.");
    onChanged();
  }

  return (
    <Panel>
      <PanelHeader
        title="Calendário de prazos"
        description="A contagem já pula fins de semana, feriados nacionais, a Sexta-feira Santa e o recesso de 20/12 a 20/01 (art. 220 do CPC). Cadastre aqui feriados locais e suspensões de cada tribunal. Sem o cadastro, a data calculada pode sair antes da real, nunca depois — e é sempre conferida por uma pessoa."
        actions={
          overview.canManage && (
            <Button size="sm" variant="secondary" icon={<CalendarX2 className="size-4" aria-hidden />} onClick={() => setOpen(true)}>
              Adicionar dia
            </Button>
          )
        }
      />
      {overview.calendar.length === 0 ? (
        <EmptyState compact title="Nenhum dia cadastrado." description="Ex.: 25/01 (aniversário de São Paulo) no TJSP; segunda e terça de Carnaval, se o tribunal suspender." />
      ) : (
        <Table caption="Dias sem expediente cadastrados">
          <THead>
            <tr>
              <Th>Dia</Th>
              <Th>Tribunal</Th>
              <Th>Motivo</Th>
              {overview.canManage && <Th className="text-right">Ação</Th>}
            </tr>
          </THead>
          <TBody>
            {overview.calendar.map((c) => (
              <Tr key={c.id}>
                <Td className="tabular">{formatDate(c.day)}</Td>
                <Td>{c.court ?? "Todos"}</Td>
                <Td className="text-[12.5px]">
                  {c.description}
                  <span className="ml-1.5 text-subtle">({c.kind === "HOLIDAY" ? "feriado" : "suspensão"})</span>
                </Td>
                {overview.canManage && (
                  <Td className="text-right">
                    <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" aria-hidden />} onClick={() => remove(c.id)}>
                      Remover
                    </Button>
                  </Td>
                )}
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
      {open && (
        <Dialog
          open
          onOpenChange={(o) => !o && setOpen(false)}
          title="Dia sem contagem de prazo"
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button loading={saving} disabled={!day || !description.trim()} onClick={save}>
                Salvar
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Dia" requirement="required">
                {(a) => <Input {...a} type="date" value={day} onChange={(e) => setDay(e.target.value)} />}
              </Field>
              <Field label="Tribunal" hint="Sigla (TJSP, TRF3…). Vazio = todos.">
                {(a) => <Input {...a} value={court} onChange={(e) => setCourt(e.target.value.toUpperCase())} placeholder="TJSP" maxLength={15} />}
              </Field>
            </div>
            <Field label="Tipo">
              {(a) => (
                <Select {...a} value={kind} onChange={(e) => setKind(e.target.value as "HOLIDAY" | "SUSPENSION")} options={[{ value: "HOLIDAY", label: "Feriado" }, { value: "SUSPENSION", label: "Suspensão de prazos / expediente" }]} />
              )}
            </Field>
            <Field label="Motivo" requirement="required">
              {(a) => <Input {...a} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder="Aniversário da cidade de São Paulo" />}
            </Field>
            <Callout tone="info">Vale para as próximas contagens; prazos já criados não mudam.</Callout>
          </div>
        </Dialog>
      )}
    </Panel>
  );
}
