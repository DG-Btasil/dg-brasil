import { DomainError } from "@/server/core/errors";

/**
 * Quem pode ligar QUAL pasta do Drive a um cliente.
 *
 * A credencial do Google do escritório enxerga muito mais do que as pastas dos
 * clientes. Como a ligação é feita pelo ID da pasta, sem esta regra qualquer
 * advogado poderia ligar a um cliente uma pasta qualquer do Drive do
 * escritório (financeiro, pessoal, de outro cliente), e o sistema passaria a
 * importar os arquivos dela.
 *
 * Regra:
 *   - a própria pasta dos clientes (GOOGLE_DRIVE_ROOT_FOLDER_ID) nunca é ligada
 *     a um cliente: ela contém as pastas de todos;
 *   - pasta DENTRO da pasta dos clientes (em qualquer nível): ADMIN ou advogado;
 *   - pasta de FORA dela: ninguém, nem o ADMIN. Decisão de 18/11/2026: o DG
 *     Brasil e o escritório são coisas separadas, e o DG Brasil só trabalha
 *     abaixo da pasta DG BRASIL (até 13/11 o ADMIN podia ligar pasta de fora);
 *   - pasta dos clientes não configurada: nenhuma ligação.
 *
 * A rodada (sync.ts) confere de novo antes de ler ou gravar: pasta ligada que
 * saiu da DG BRASIL no Drive fica parada, com o motivo na ficha do cliente.
 *
 * "Dentro" = subindo pelas pastas-mãe chega-se à pasta dos clientes em até
 * MAX_LEVELS níveis. Pasta-mãe que a credencial não consegue ler conta como
 * fora.
 */

export const MAX_LEVELS = 8;
/** Teto de consultas ao Drive por conferência (pasta com vários atalhos de pasta-mãe). */
const MAX_LOOKUPS = 24;

export type FolderScope = "INSIDE_ROOT";

export async function isInsideRoot(
  folderId: string,
  rootFolderId: string,
  parentsOf: (id: string) => Promise<string[]>,
  maxLevels: number = MAX_LEVELS,
): Promise<boolean> {
  if (folderId === rootFolderId) return false;
  let level = [folderId];
  const seen = new Set<string>(level);
  let lookups = 0;
  for (let depth = 0; depth < maxLevels && level.length > 0; depth++) {
    const next: string[] = [];
    for (const id of level) {
      if (lookups++ >= MAX_LOOKUPS) return false;
      let parents: string[];
      try {
        parents = await parentsOf(id);
      } catch {
        parents = [];
      }
      if (parents.includes(rootFolderId)) return true;
      for (const p of parents) {
        if (!seen.has(p)) {
          seen.add(p);
          next.push(p);
        }
      }
    }
    level = next;
  }
  return false;
}

export async function assertFolderAllowed(input: {
  role: string;
  folderId: string;
  rootFolderId: string | undefined;
  parentsOf: (id: string) => Promise<string[]>;
}): Promise<FolderScope> {
  const { folderId, rootFolderId } = input;
  if (!rootFolderId) {
    throw new DomainError("INVALID_STATE", "A pasta DG BRASIL ainda não foi configurada (GOOGLE_DRIVE_ROOT_FOLDER_ID). Sem ela, nenhuma pasta é ligada.");
  }
  if (folderId === rootFolderId) {
    throw new DomainError("BUSINESS_RULE", "Esta é a pasta que contém as pastas de todos os clientes. Escolha a pasta deste cliente.");
  }
  if (await isInsideRoot(folderId, rootFolderId, input.parentsOf)) return "INSIDE_ROOT";
  throw new DomainError("FORBIDDEN", "Esta pasta fica fora da pasta DG BRASIL. O DG Brasil só liga pastas que estão dentro dela, nem o administrador liga pasta de fora.");
}
