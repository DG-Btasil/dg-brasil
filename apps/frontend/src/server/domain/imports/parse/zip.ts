import { inflateRawSync } from "node:zlib";
import { ImportFileError } from "./errors";

/**
 * Leitor mínimo de ZIP (o .xlsx é um ZIP de XMLs), só com o `zlib` do Node —
 * sem dependência nova. Lê o diretório central e extrai, sob demanda, só as
 * entradas pedidas. Limites contra arquivo-bomba: tamanho descompactado por
 * entrada e no total.
 */

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export const MAX_ENTRY_BYTES = 120 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 240 * 1024 * 1024;

interface Entry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

export interface ZipReader {
  names(): string[];
  has(name: string): boolean;
  /** Conteúdo da entrada como texto UTF-8; undefined se não existe. */
  text(name: string): string | undefined;
}

export function openZip(bytes: Uint8Array): ZipReader {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length < 22 || buf.readUInt32LE(0) !== LOCAL) {
    throw new ImportFileError("O arquivo não é uma planilha .xlsx válida. Se for .xls antigo ou estiver protegido por senha, abra no Excel e salve como .xlsx sem senha.");
  }

  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ImportFileError("O arquivo .xlsx está corrompido (fim do arquivo não encontrado).");

  const count = buf.readUInt16LE(eocd + 10);
  const dirSize = buf.readUInt32LE(eocd + 12);
  const dirOffset = buf.readUInt32LE(eocd + 16);
  if (dirOffset === 0xffffffff || dirSize === 0xffffffff || dirOffset + dirSize > buf.length) {
    throw new ImportFileError("O arquivo .xlsx está corrompido ou é grande demais.");
  }

  const entries = new Map<string, Entry>();
  let p = dirOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL) throw new ImportFileError("O arquivo .xlsx está corrompido (diretório interno).");
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen).replace(/\\/g, "/");
    entries.set(name, { name, method, compressedSize, size, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  let total = 0;
  return {
    names: () => [...entries.keys()],
    has: (name) => entries.has(name),
    text(name) {
      const e = entries.get(name);
      if (!e) return undefined;
      if (e.size > MAX_ENTRY_BYTES || e.compressedSize === 0xffffffff) throw new ImportFileError("A planilha é grande demais para importar. Divida o arquivo.");
      const lp = e.localOffset;
      if (lp + 30 > buf.length || buf.readUInt32LE(lp) !== LOCAL) throw new ImportFileError("O arquivo .xlsx está corrompido (entrada interna).");
      const start = lp + 30 + buf.readUInt16LE(lp + 26) + buf.readUInt16LE(lp + 28);
      const data = buf.subarray(start, start + e.compressedSize);
      let out: Buffer;
      if (e.method === 0) out = data;
      else if (e.method === 8) {
        try {
          out = inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
        } catch {
          throw new ImportFileError("O arquivo .xlsx está corrompido ou é grande demais.");
        }
      } else throw new ImportFileError("O arquivo .xlsx usa uma compressão não suportada. Salve de novo pelo Excel.");
      total += out.length;
      if (total > MAX_TOTAL_BYTES) throw new ImportFileError("A planilha é grande demais para importar. Divida o arquivo.");
      return out.toString("utf8");
    },
  };
}
