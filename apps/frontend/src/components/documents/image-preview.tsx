"use client";

import { useCallback } from "react";

/** A própria imagem, a partir dos bytes já carregados (URL de objeto local, revogada ao sair). */
export function ImagePreview({ blob, mimeType, alt }: { blob: Blob; mimeType: string; alt: string }) {
  const attach = useCallback(
    (image: HTMLImageElement | null) => {
      if (!image) return;
      const url = URL.createObjectURL(blob.slice(0, blob.size, mimeType));
      image.src = url;
      return () => {
        image.removeAttribute("src");
        URL.revokeObjectURL(url);
      };
    },
    [blob, mimeType],
  );

  return (
    <div className="flex max-h-[80vh] justify-center overflow-auto rounded-sm border border-line bg-surface-sunken p-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- bytes locais (blob:), não passam pelo otimizador de imagens */}
      <img ref={attach} alt={alt} className="h-auto max-w-full object-contain" />
    </div>
  );
}
