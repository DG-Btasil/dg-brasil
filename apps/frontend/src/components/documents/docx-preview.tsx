"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { SkeletonRows } from "@/components/feedback/states";
import { safeLinkHref } from "./preview-rules";

/**
 * Opções do docx-preview. `renderAltChunks: false` é de segurança: sem isso a
 * biblioteca põe HTML embutido no arquivo dentro de um iframe. Imagens viram
 * `data:` (nada fica pendurado em URL de objeto) e fontes embutidas são
 * ignoradas.
 */
const RENDER_OPTIONS = {
  className: "docx",
  inWrapper: true,
  breakPages: true,
  ignoreLastRenderedPageBreak: false,
  ignoreFonts: true,
  useBase64URL: true,
  renderAltChunks: false,
  renderComments: false,
  renderChanges: false,
  experimental: false,
  debug: false,
} as const;

const FRAME_PADDING = 16;

/** Moldura das páginas. Vale só dentro do shadow root (não vaza para a tela, nem a tela vaza para cá). */
const FRAME_CSS = `
:host { display: block; }
.docx-wrapper { background: transparent; padding: ${FRAME_PADDING}px ${FRAME_PADDING}px 0; }
.docx-wrapper > section.docx { box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.12), 0 2px 6px rgba(15, 23, 42, 0.08); margin-bottom: ${FRAME_PADDING}px; }
`;

/**
 * O que a biblioteca montou a partir do arquivo é conferido ANTES de entrar
 * na tela: nada que rode script ou carregue algo de fora; link só http, https
 * e mailto, em outra aba.
 */
function hardenRenderedDocument(root: ParentNode): void {
  root.querySelectorAll("script, iframe, frame, object, embed, link, meta, base, form").forEach((el) => el.remove());
  root.querySelectorAll("*").forEach((el) => {
    for (const name of el.getAttributeNames()) {
      if (name.toLowerCase().startsWith("on")) el.removeAttribute(name);
    }
  });
  root.querySelectorAll("a").forEach((link) => {
    const href = safeLinkHref(link.getAttribute("href"));
    link.removeAttribute("xlink:href");
    if (!href) return link.removeAttribute("href");
    link.setAttribute("href", href);
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
  });
  root.querySelectorAll("img, image").forEach((image) => {
    for (const name of ["src", "href", "xlink:href", "srcset"]) {
      const value = image.getAttribute(name);
      if (value !== null && !value.startsWith("data:")) image.removeAttribute(name);
    }
  });
}

/** Encolhe as páginas para caberem na largura da área (nunca amplia). */
function fitPagesToWidth(host: HTMLElement, root: ShadowRoot): ResizeObserver | undefined {
  const wrapper = root.querySelector<HTMLElement>(".docx-wrapper");
  if (!wrapper || typeof ResizeObserver === "undefined") return undefined;
  let pageWidth = 0;
  const observer = new ResizeObserver(() => {
    const available = host.clientWidth;
    if (!available) return;
    if (!pageWidth) {
      // Medida feita uma vez, sem zoom aplicado.
      wrapper.style.removeProperty("zoom");
      pageWidth = Math.max(0, ...Array.from(wrapper.querySelectorAll<HTMLElement>(":scope > section"), (section) => section.offsetWidth));
      if (!pageWidth) return;
    }
    const scale = Math.min(1, available / (pageWidth + 2 * FRAME_PADDING));
    wrapper.style.setProperty("zoom", scale.toFixed(4));
  });
  observer.observe(host);
  return observer;
}

/**
 * Documento Word (.docx) desenhado no navegador a partir dos bytes já
 * carregados. A área tem altura de uma página: a primeira aparece inteira e
 * as demais ficam roláveis. A biblioteca é carregada só quando há um .docx
 * para mostrar, e o resultado fica num shadow root (CSS isolado).
 */
export function DocxPreview({ blob, label, fallback }: { blob: Blob; label: string; fallback: ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"RENDERING" | "READY" | "FAILED">("RENDERING");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let alive = true;
    let observer: ResizeObserver | undefined;
    const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });

    void (async () => {
      try {
        const { parseAsync, renderDocument } = await import("docx-preview");
        const parsed: unknown = await parseAsync(blob, RENDER_OPTIONS);
        const nodes = await renderDocument(parsed, RENDER_OPTIONS);
        if (!alive) return;
        const fragment = document.createDocumentFragment();
        fragment.append(...nodes);
        hardenRenderedDocument(fragment);
        const frame = document.createElement("style");
        frame.textContent = FRAME_CSS;
        root.replaceChildren(fragment, frame);
        observer = fitPagesToWidth(host, root);
        setStatus("READY");
      } catch {
        if (alive) setStatus("FAILED");
      }
    })();

    return () => {
      alive = false;
      observer?.disconnect();
      root.replaceChildren();
    };
  }, [blob]);

  if (status === "FAILED") return <>{fallback}</>;

  return (
    <>
      {status === "RENDERING" && <SkeletonRows rows={8} />}
      <div
        role="region"
        aria-label={label}
        tabIndex={0}
        className={cn(
          "aspect-[210/297] max-h-[80vh] min-h-[420px] w-full overflow-auto rounded-sm border border-line bg-surface-sunken [scrollbar-gutter:stable]",
          status !== "READY" && "hidden",
        )}
      >
        <div ref={hostRef} />
      </div>
    </>
  );
}
