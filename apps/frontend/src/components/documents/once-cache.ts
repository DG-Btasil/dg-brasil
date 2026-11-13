/**
 * Carrega UMA vez por chave e reparte o mesmo resultado entre quem pedir
 * enquanto alguém estiver usando. Serve à prévia de arquivo: cada leitura é
 * registrada no servidor como acesso (LGPD), então remontagens da tela (ex.:
 * o modo estrito do React em desenvolvimento) não podem buscar de novo.
 * Quando o último usuário solta, a entrada é descartada (os bytes saem da
 * memória); abrir de novo é uma leitura nova, registrada de novo.
 */
export interface OnceCacheHandle<T> {
  promise: Promise<T>;
  /** Solta o uso. Pode ser chamado mais de uma vez. */
  release: () => void;
}

interface Entry<T> {
  promise: Promise<T>;
  refs: number;
  timer?: ReturnType<typeof setTimeout>;
}

export function createOnceCache<T>(evictDelayMs = 0) {
  const entries = new Map<string, Entry<T>>();

  return {
    acquire(key: string, load: () => Promise<T>): OnceCacheHandle<T> {
      let entry = entries.get(key);
      if (!entry) {
        entry = { promise: load(), refs: 0 };
        entries.set(key, entry);
      }
      if (entry.timer !== undefined) {
        clearTimeout(entry.timer);
        entry.timer = undefined;
      }
      entry.refs += 1;
      const held = entry;
      let released = false;
      return {
        promise: held.promise,
        release() {
          if (released) return;
          released = true;
          held.refs -= 1;
          if (held.refs > 0 || entries.get(key) !== held) return;
          // Adiado: soltar e pegar de novo no mesmo instante reaproveita a entrada.
          held.timer = setTimeout(() => {
            if (held.refs === 0 && entries.get(key) === held) entries.delete(key);
          }, evictDelayMs);
        },
      };
    },
    /** Esquece o resultado (ex.: "Tentar de novo" depois de um erro). */
    forget(key: string): void {
      const entry = entries.get(key);
      if (entry?.timer !== undefined) clearTimeout(entry.timer);
      entries.delete(key);
    },
    size: () => entries.size,
  };
}
