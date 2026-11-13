"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Loader2, Search } from "lucide-react";
import { callAction } from "@/lib/actions/result";
import { cn } from "@/lib/cn";
import { useDebouncedCallback } from "@/lib/hooks/use-server-list";
import { globalSearchAction } from "@/server/domain/search/actions";
import type { GlobalSearchDTO } from "@/server/domain/search/dto";
import { GLOBAL_SEARCH_MIN_LENGTH } from "@/server/domain/search/schemas";
import { flatItems, moveIndex, searchGroups } from "./search-items";

type SearchState = { status: "idle" } | { status: "error"; message: string } | { status: "done"; text: string; result: GlobalSearchDTO };

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * Busca do cabeçalho: clientes (nome, CPF/CNPJ), casos (título, parte
 * contrária) e processos (número CNJ, título), agrupados. Atalho: Ctrl+K
 * (⌘K no Mac) ou "/" fora de um campo. Setas escolhem, Enter abre, Esc fecha.
 *
 * O texto digitado vive só neste componente: vai ao servidor no corpo da
 * Server Action e nunca para a URL, o histórico ou o armazenamento do navegador.
 */
export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const seq = useRef(0);
  const listId = useId();
  const optionId = (index: number) => `${listId}-opt-${index}`;

  const groups = useMemo(() => (state.status === "done" ? searchGroups(state.result, state.text) : []), [state]);
  const items = useMemo(() => flatItems(groups), [groups]);
  /** Posição do primeiro item de cada grupo na lista corrida (as setas andam por ela). */
  const starts = useMemo(() => groups.map((_, g) => groups.slice(0, g).reduce((sum, x) => sum + x.items.length, 0)), [groups]);

  // Busca com atraso que dispara depois de fechar (ou resposta que chega tarde) não mexe mais na tela.
  const openRef = useRef(false);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const run = useCallback(async (value: string) => {
    if (!openRef.current) return;
    const q = value.trim();
    const id = ++seq.current;
    if (q.length < GLOBAL_SEARCH_MIN_LENGTH) {
      setLoading(false);
      setState({ status: "idle" });
      return;
    }
    setLoading(true);
    const r = await callAction(() => globalSearchAction({ q }));
    if (id !== seq.current || !openRef.current) return;
    setLoading(false);
    if (r.ok) {
      setState({ status: "done", text: q, result: r.data });
      setActive(-1);
    } else {
      setState({ status: "error", message: r.error.message });
    }
  }, []);
  const search = useDebouncedCallback(run, 250);

  const close = useCallback(() => {
    openRef.current = false;
    seq.current++;
    setOpen(false);
    setText("");
    setLoading(false);
    setState({ status: "idle" });
    setActive(-1);
  }, []);

  // Atalhos globais: Ctrl+K / ⌘K sempre; "/" quando a pessoa não está digitando em um campo.
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      const shortcut = (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k";
      const slash = event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && !isTyping(event.target);
      if (!shortcut && !slash) return;
      event.preventDefault();
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function go(href: string) {
    close();
    router.push(href);
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = moveIndex(active, event.key === "ArrowDown" ? 1 : -1, items.length);
      setActive(next);
      if (next >= 0) document.getElementById(optionId(next))?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter") {
      const item = items[active >= 0 ? active : 0];
      if (item) {
        event.preventDefault();
        go(item.href);
      }
    }
  }

  const q = text.trim();
  const empty = state.status === "done" && items.length === 0;

  return (
    <RadixDialog.Root open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <RadixDialog.Trigger asChild>
        <button
          type="button"
          aria-label="Buscar clientes, casos e processos (Ctrl+K)"
          title="Buscar (Ctrl+K)"
          className="mr-1 inline-flex h-9 items-center gap-2 rounded-md border border-white/15 px-2.5 text-[12.5px] text-white/75 transition-colors hover:bg-white/10 hover:text-white"
        >
          <Search className="size-4" aria-hidden />
          <span className="hidden xl:inline">Buscar</span>
          <kbd className="hidden rounded-xs border border-white/20 px-1 text-[10.5px] font-medium text-white/60 xl:inline">Ctrl K</kbd>
        </button>
      </RadixDialog.Trigger>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-navy-950/40 animate-fade-in" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[10vh] z-50 flex max-h-[calc(100dvh-10vh-1rem)] w-[calc(100vw-32px)] max-w-[640px] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-overlay animate-panel-down focus:outline-none"
        >
          <RadixDialog.Title className="sr-only">Buscar clientes, casos e processos</RadixDialog.Title>
          <div className="relative shrink-0 border-b border-line">
            <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <input
              type="text"
              role="combobox"
              aria-expanded={items.length > 0}
              aria-controls={listId}
              aria-activedescendant={active >= 0 ? optionId(active) : undefined}
              aria-autocomplete="list"
              aria-label="Buscar por nome, CPF/CNPJ, título do caso ou número do processo"
              placeholder="Nome, CPF/CNPJ, caso ou número do processo"
              autoComplete="off"
              spellCheck={false}
              maxLength={120}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                search(e.target.value);
              }}
              onKeyDown={onInputKeyDown}
              className="h-12 w-full bg-transparent pl-11 pr-11 text-[14px] text-foreground placeholder:text-subtle focus:outline-none"
            />
            {loading && <Loader2 aria-hidden className="absolute right-4 top-1/2 size-4 -translate-y-1/2 animate-spin text-subtle" />}
          </div>

          <div id={listId} role="listbox" aria-label="Resultados da busca" className="min-h-0 flex-1 overflow-y-auto">
            {groups.map((group, g) =>
              group.items.length === 0 ? null : (
                <div key={group.key} role="group" aria-label={group.label} className="border-b border-line last:border-b-0">
                  <div className="flex items-center justify-between gap-3 px-4 pb-1 pt-3">
                    <p className="text-[11.5px] font-semibold uppercase tracking-[0.05em] text-muted">
                      {group.label}
                      {group.total > group.items.length && <span className="ml-1.5 font-normal normal-case tracking-normal text-subtle">{`${group.items.length} de ${group.total}`}</span>}
                    </p>
                    {group.total > group.items.length &&
                      (group.allHref ? (
                        <Link href={group.allHref} onClick={close} className="text-[12px] text-navy-700 underline-offset-2 hover:underline">
                          Ver todos
                        </Link>
                      ) : (
                        <span className="text-[12px] text-subtle">Digite mais para afinar</span>
                      ))}
                  </div>
                  <ul className="pb-1.5">
                    {group.items.map((item, position) => {
                      const i = starts[g] + position;
                      const selected = i === active;
                      return (
                        <li
                          key={item.key}
                          id={optionId(i)}
                          role="option"
                          aria-selected={selected}
                          onMouseMove={() => setActive(i)}
                          onClick={() => go(item.href)}
                          className={cn("cursor-pointer px-4 py-2", selected ? "bg-surface-sunken" : "hover:bg-surface-muted")}
                        >
                          <span className="block truncate text-[13.5px] font-medium text-foreground">{item.title}</span>
                          {item.detail && <span className="block truncate text-[12px] text-muted">{item.detail}</span>}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ),
            )}
            {state.status === "error" && <p className="px-4 py-6 text-center text-[13px] text-danger">{state.message}</p>}
            {empty && <p className="px-4 py-6 text-center text-[13px] text-muted">Nada encontrado. Confira o que foi digitado, ou busque por outro dado (nome, CPF/CNPJ, número do processo).</p>}
            {state.status === "idle" && (
              <p className="px-4 py-6 text-center text-[13px] text-muted">
                {q.length > 0 && q.length < GLOBAL_SEARCH_MIN_LENGTH
                  ? "Digite pelo menos 2 caracteres."
                  : "Busque um cliente pelo nome ou CPF/CNPJ, um caso pelo título ou pela parte contrária, ou um processo pelo número (qualquer trecho) ou título."}
              </p>
            )}
          </div>

          <p className="shrink-0 border-t border-line bg-surface-muted px-4 py-2 text-[11.5px] text-muted" aria-hidden>
            ↑ ↓ para escolher · Enter para abrir · Esc para fechar
          </p>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
