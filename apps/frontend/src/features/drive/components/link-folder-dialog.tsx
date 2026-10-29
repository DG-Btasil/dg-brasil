"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { Callout } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { callAction } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { cn } from "@/lib/cn";
import { linkDriveFolderAction, searchDriveFoldersAction } from "@/server/domain/drive/actions";
import type { DriveFolderDTO } from "@/server/domain/drive/dto";
import { useToast } from "@/store/ui-store";

/**
 * Procurar a pasta do cliente no Drive (dentro da pasta dos clientes) e
 * ligar. O servidor confere que é uma pasta ativa e que não está aberta a
 * "qualquer pessoa com o link" antes de gravar o ID.
 */
export function LinkFolderDialog({ clientId, onClose, onLinked, initialTerm = "" }: { clientId: string; onClose: () => void; onLinked: () => void; initialTerm?: string }) {
  const toast = useToast();
  const failed = useActionFeedback();
  const [term, setTerm] = useState(initialTerm);
  const [results, setResults] = useState<DriveFolderDTO[] | null>(null);
  const [chosen, setChosen] = useState<DriveFolderDTO | null>(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);

  async function search() {
    setSearching(true);
    const r = await callAction(() => searchDriveFoldersAction({ term }));
    setSearching(false);
    if (!r.ok) {
      failed(r, "Não foi possível procurar no Drive.");
      return;
    }
    setResults(r.data);
    setChosen(null);
  }

  async function link() {
    if (!chosen) return;
    setSaving(true);
    const r = await callAction(() => linkDriveFolderAction({ clientId, folderId: chosen.id }));
    setSaving(false);
    if (!r.ok) {
      failed(r, "Não foi possível ligar a pasta.");
      return;
    }
    toast({ tone: "success", title: "Pasta ligada", description: `${chosen.name}. A primeira sincronização traz os arquivos de lá.` });
    onLinked();
    onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Ligar pasta do Google Drive"
      description="Procure pelo nome da pasta. A ligação fica pelo identificador da pasta: renomear ou mover no Drive não quebra."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={saving} disabled={!chosen} onClick={link}>
            Ligar esta pasta
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <Field label="Nome da pasta" requirement="optional" className="flex-1">
            {(a) => <Input {...a} value={term} maxLength={100} onChange={(e) => setTerm(e.target.value)} placeholder="Ex.: JOSE DA SILVA" />}
          </Field>
          <Button type="submit" variant="secondary" icon={<Search className="size-4" aria-hidden />} loading={searching}>
            Procurar
          </Button>
        </form>
        {results && results.length === 0 && <Callout tone="neutral">Nenhuma pasta encontrada com esse nome.</Callout>}
        {results && results.length > 0 && (
          <ul role="listbox" aria-label="Pastas encontradas" className="max-h-72 divide-y divide-line overflow-y-auto rounded-md border border-line">
            {results.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={chosen?.id === f.id}
                  onClick={() => setChosen(f)}
                  className={cn("w-full px-3 py-2 text-left text-[13px] hover:bg-surface-2", chosen?.id === f.id && "bg-surface-2 font-semibold text-navy")}
                >
                  {f.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
