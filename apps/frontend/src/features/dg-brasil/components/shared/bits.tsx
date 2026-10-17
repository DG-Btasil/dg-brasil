import Link from "next/link";
import { formatDateTime } from "@/lib/formatting";
import type { NamedRef, VersionItemDTO } from "@/server/domain/dg/dto";
import { formatVersion } from "../../utils";

/** Histórico de versões (append-only): a atual primeiro. */
export function VersionsList({ versions, current }: { versions: VersionItemDTO[]; current?: string }) {
  if (versions.length === 0) return <p className="text-[13px] text-muted">Sem versões.</p>;
  return (
    <ol className="divide-y divide-line rounded-md border border-line">
      {versions.map((v) => (
        <li key={v.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
          <span className="font-medium text-foreground">
            {formatVersion(v.number)}
            {v.id === current && <span className="ml-2 text-[11.5px] font-normal text-success">em uso</span>}
          </span>
          <span className="text-[12px] text-muted">
            {formatDateTime(v.createdAt)}
            {v.createdByName ? ` · ${v.createdByName}` : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Nomes vinculados (com link quando há rota). */
export function LinkedNames({ ids, catalog, href, empty }: { ids: string[]; catalog: NamedRef[]; href?: (id: string) => string; empty: string }) {
  const byId = new Map(catalog.map((c) => [c.id, c.name]));
  const items = ids.map((id) => ({ id, name: byId.get(id) })).filter((x): x is { id: string; name: string } => !!x.name);
  if (items.length === 0) return <p className="text-[13px] text-muted">{empty}</p>;
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((x) => (
        <li key={x.id}>
          {href ? (
            <Link href={href(x.id)} className="inline-flex rounded-full border border-line bg-surface px-3 py-1 text-[12.5px] text-navy hover:border-navy-600/40">
              {x.name}
            </Link>
          ) : (
            <span className="inline-flex rounded-full border border-line bg-surface px-3 py-1 text-[12.5px] text-foreground">{x.name}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Texto longo de instruções, só leitura (monoespaçado, sem HTML). */
export function InstructionsView({ text }: { text: string }) {
  return (
    <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-surface-2 p-4 font-mono text-[12.5px] leading-relaxed text-foreground">
      {text || "—"}
    </pre>
  );
}
