"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { EmptyState } from "@/components/feedback/states";
import { Button, IconButton } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { usePermission } from "@/features/auth/hooks";
import type { ID } from "@/types";

export interface LinkedItem {
  id: ID;
  name: string;
  href: string;
  description?: string;
  meta?: ReactNode;
}

interface LinkedItemsProps {
  title: string;
  description: string;
  emptyTitle: string;
  addLabel: string;
  items: LinkedItem[];
  available: { value: ID; label: string }[];
  onAdd: (id: ID) => Promise<boolean>;
  onRemove: (id: ID) => Promise<boolean>;
}

/** Lista de vínculos (Skills/teses de um agente). Edição apenas com dgbrasil.manage. */
export function LinkedItems({ title, description, emptyTitle, addLabel, items, available, onAdd, onRemove }: LinkedItemsProps) {
  const canManage = usePermission("dgbrasil.manage");
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!selected) return;
    setBusy(true);
    const ok = await onAdd(selected);
    setBusy(false);
    if (ok) setSelected("");
  }

  return (
    <Panel>
      <PanelHeader title={title} description={description} />
      {items.length === 0 ? (
        <EmptyState compact title={emptyTitle} />
      ) : (
        <ul className="divide-y divide-line">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-4 px-5 py-3">
              <div className="min-w-0 flex-1">
                <Link href={item.href} className="text-[13px] font-medium text-navy-700 hover:underline underline-offset-2">
                  {item.name}
                </Link>
                {item.description && <p className="mt-0.5 line-clamp-1 text-[12.5px] text-muted">{item.description}</p>}
              </div>
              {item.meta && <div className="flex shrink-0 items-center gap-3 text-[12px] text-muted">{item.meta}</div>}
              {canManage && (
                <IconButton label={`Remover ${item.name}`} size="sm" disabled={busy} onClick={() => void onRemove(item.id)}>
                  <X className="size-4" aria-hidden />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <div className="flex items-end gap-2 border-t border-line bg-surface-muted px-5 py-3 rounded-b-lg">
          <div className="w-[360px]">
            <label className="sr-only" htmlFor={`add-${title}`}>
              {addLabel}
            </label>
            <Select
              id={`add-${title}`}
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              options={available}
              placeholder={available.length === 0 ? "Todos os itens já estão vinculados" : addLabel}
              disabled={available.length === 0}
            />
          </div>
          <Button variant="secondary" icon={<Plus className="size-4" aria-hidden />} onClick={add} disabled={!selected} loading={busy}>
            Vincular
          </Button>
        </div>
      )}
    </Panel>
  );
}
