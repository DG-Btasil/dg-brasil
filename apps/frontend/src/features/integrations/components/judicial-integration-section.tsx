"use client";

import { useState } from "react";
import { Database, Newspaper, RefreshCw, Scale, Settings2, type LucideIcon } from "lucide-react";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { DefinitionGrid, Panel, PanelFooter } from "@/components/ui/panel";
import { Callout } from "@/components/feedback/states";
import { BRAZILIAN_STATES, COURTS } from "@/lib/constants/legal";
import { INTEGRATION_STATUS_LABEL, INTEGRATION_STATUS_TONE, JUDICIAL_CAPABILITY_LABEL, type JudicialSource } from "@/lib/constants/status";
import { formatDateTime, formatNumber } from "@/lib/formatting";
import { JUDICIAL_PROVIDERS, type JudicialIntegrationProvider } from "@/services/judicial-integration";
import { useResponsibleOptions, useUserMap } from "@/features/offices/hooks";
import type { JudicialSourceState } from "@/types";
import { CheckboxList } from "@/components/ui/checkbox-list";
import { useJudicialActions, useJudicialSources } from "../hooks";

const SOURCE_ICON: Record<JudicialSource, LucideIcon> = { DJEN: Newspaper, DATAJUD: Database };

/** Configuração (mock). DJEN: OAB + UF; DataJud: tribunais consultados. */
function ConfigureDialog({ source, provider, onClose }: { source: JudicialSourceState; provider: JudicialIntegrationProvider; onClose: () => void }) {
  const { configure } = useJudicialActions();
  const responsibleOptions = useResponsibleOptions();
  const [oabNumber, setOabNumber] = useState(source.oabNumber ?? "");
  const [oabState, setOabState] = useState(source.oabState ?? "");
  const [courts, setCourts] = useState<string[]>(source.courts ?? []);
  const [responsible, setResponsible] = useState(source.responsibleUserId ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const byOab = provider.queryMode === "BY_OAB";

  async function save() {
    const next: Record<string, string> = {};
    if (byOab && !oabNumber.trim()) next.oab = "Informe o número da OAB monitorada.";
    if (byOab && !oabState) next.uf = "Selecione a UF da OAB.";
    if (!byOab && courts.length === 0) next.courts = "Selecione ao menos um tribunal.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    const ok = await configure(source, byOab ? { oabNumber: oabNumber.trim(), oabState, responsibleUserId: responsible || undefined } : { courts, responsibleUserId: responsible || undefined });
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Configurar ${provider.name}`}
      description={`${provider.fullName}. Configuração simulada nesta etapa: nenhuma credencial é pedida e nenhuma consulta externa é feita.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={saving} onClick={save}>
            Salvar configuração
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {byOab ? (
          <div className="grid grid-cols-[minmax(0,1fr)_140px] gap-4">
            <Field label="OAB monitorada" requirement="required" hint="Número de inscrição usado para localizar comunicações." error={errors.oab}>
              {(a) => <Input {...a} value={oabNumber} onChange={(e) => setOabNumber(e.target.value)} placeholder="000.000" className="tabular" />}
            </Field>
            <Field label="UF da OAB" requirement="required" error={errors.uf}>
              {(a) => <Select {...a} value={oabState} onChange={(e) => setOabState(e.target.value)} options={BRAZILIAN_STATES.map((s) => ({ value: s, label: s }))} placeholder="UF" />}
            </Field>
          </div>
        ) : (
          <div>
            <CheckboxList legend="Tribunais consultados" hint="Os processos já cadastrados nesses tribunais serão enriquecidos pelo número CNJ." options={COURTS.map((c) => ({ value: c, label: c }))} value={courts} onChange={setCourts} />
            {errors.courts && (
              <p role="alert" className="mt-1 text-[11.5px] font-medium text-danger">
                {errors.courts}
              </p>
            )}
          </div>
        )}
        <Field label="Responsável" requirement="recommended" hint="Quem acompanha falhas e novidades desta fonte.">
          {(a) => <Select {...a} value={responsible} onChange={(e) => setResponsible(e.target.value)} options={responsibleOptions} placeholder="Selecione" />}
        </Field>
      </div>
    </Dialog>
  );
}

function SourceCard({ source, canManage }: { source: JudicialSourceState; canManage: boolean }) {
  const provider = JUDICIAL_PROVIDERS[source.source];
  const users = useUserMap();
  const { sync } = useJudicialActions();
  const [configuring, setConfiguring] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const Icon = SOURCE_ICON[source.source];
  const responsible = source.responsibleUserId ? users.get(source.responsibleUserId)?.name : undefined;
  const lastSync = source.lastSyncAt ? <span className="tabular">{formatDateTime(source.lastSyncAt)}</span> : "Nunca sincronizado";

  const items =
    provider.queryMode === "BY_OAB"
      ? [
          { label: "OAB monitorada", value: source.oabNumber ? <span className="tabular">{source.oabNumber}</span> : "Não configurada" },
          { label: "UF da OAB", value: source.oabState ?? "—" },
          { label: "Responsável", value: responsible ?? "—" },
          { label: "Última sincronização", value: lastSync },
          { label: "Última comunicação encontrada", value: source.lastCommunicationAt ? <span className="tabular">{formatDateTime(source.lastCommunicationAt)}</span> : "Nenhuma" },
          { label: provider.importedLabel, value: <span className="tabular">{formatNumber(source.importedCount)}</span> },
        ]
      : [
          { label: "Tribunais consultados", value: source.courts?.length ? source.courts.join(", ") : "Não configurados" },
          { label: "Responsável", value: responsible ?? "—" },
          { label: "Última sincronização", value: lastSync },
          { label: provider.importedLabel, value: <span className="tabular">{formatNumber(source.importedCount)}</span> },
        ];

  return (
    <Panel className="flex flex-col">
      <div className="flex items-start gap-3 border-b border-line px-5 py-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-line bg-surface-muted text-navy-700">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-semibold text-foreground">{provider.name}</h3>
          <p className="text-[12px] text-muted">{provider.fullName}</p>
        </div>
        <StatusBadge status={source.status} labels={INTEGRATION_STATUS_LABEL} tones={INTEGRATION_STATUS_TONE} />
      </div>
      <div className="flex-1 space-y-3 px-5 py-4">
        <p className="text-[12.5px] leading-relaxed text-muted">{provider.description}</p>
        <DefinitionGrid items={items} />
        <div>
          <p className="mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.06em] text-subtle">Dados fornecidos por esta fonte</p>
          <div className="flex flex-wrap gap-1.5">
            {provider.capabilities.map((c) => (
              <Badge key={c} tone="neutral">
                {JUDICIAL_CAPABILITY_LABEL[c]}
              </Badge>
            ))}
          </div>
        </div>
        {source.statusMessage && <Callout tone={source.status === "ERROR" ? "danger" : "warning"}>{source.statusMessage}</Callout>}
      </div>
      {canManage && (
        <PanelFooter className="justify-start">
          <Button size="sm" variant="secondary" icon={<Settings2 className="size-3.5" aria-hidden />} onClick={() => setConfiguring(true)}>
            Configurar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw className="size-3.5" aria-hidden />}
            loading={syncing}
            disabled={source.status !== "CONNECTED"}
            title={source.status !== "CONNECTED" ? "Configure a fonte antes de sincronizar" : undefined}
            onClick={async () => {
              setSyncing(true);
              await sync(source);
              setSyncing(false);
            }}
          >
            Sincronizar agora
          </Button>
        </PanelFooter>
      )}
      {configuring && <ConfigureDialog source={source} provider={provider} onClose={() => setConfiguring(false)} />}
    </Panel>
  );
}

/**
 * Integração Judicial: fontes que alimentarão o DG Brasil com processos,
 * movimentações, comunicações, publicações, intimações e prazos derivados.
 * Cada fonte declara o que fornece; nenhuma é tratada como fonte única.
 */
export function JudicialIntegrationSection({ canManage }: { canManage: boolean }) {
  const sources = useJudicialSources();
  return (
    <section aria-labelledby="judicial-title" className="space-y-3">
      <div className="flex items-start gap-3">
        <Scale className="mt-0.5 size-4 text-navy-700" aria-hidden />
        <div>
          <h3 id="judicial-title" className="text-[15px] font-semibold text-foreground">
            Integração Judicial
          </h3>
          <p className="mt-0.5 text-[12.5px] text-muted">
            Dados jurídicos externos: processos, movimentações, comunicações, publicações, intimações, prazos derivados e informações processuais. Cada fonte fornece
            uma parte; prazos derivados sempre passam por revisão humana.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {sources.map((s) => (
          <SourceCard key={s.id} source={s} canManage={canManage} />
        ))}
      </div>
      <p className="text-[12px] text-subtle">Integração simulada nesta etapa: nenhuma API externa é chamada. Os valores exibidos são de demonstração.</p>
    </section>
  );
}
