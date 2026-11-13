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
 *   - pasta de FORA dela, ou quando a pasta dos clientes não está configurada:
 *     só o ADMIN (decisão consciente de quem responde pelo escritório; fica
 *     registrada no log e na auditoria da ligação).
 *
 * "Dentro" = subindo pelas pastas-mãe chega-se à pasta dos clientes em até
 * MAX_LEVELS níveis. Pasta-mãe que a credencial não consegue ler conta como
 * fora.
 */

export const MAX_LEVELS = 8;
/** Teto de consultas ao Drive por conferência (pasta com vários atalhos de pasta-mãe). */
const MAX_LOOKUPS = 24;

export type FolderScope = "INSIDE_ROOT" | "OUTSIDE_ROOT_BY_ADMIN";

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
  const { role, folderId, rootFolderId } = input;
  if (rootFolderId && folderId === rootFolderId) {
    throw new DomainError("BUSINESS_RULE", "Esta é a pasta que contém as pastas de todos os clientes. Escolha a pasta deste cliente.");
  }
  if (rootFolderId && (await isInsideRoot(folderId, rootFolderId, input.parentsOf))) return "INSIDE_ROOT";
  if (role === "ADMIN") return "OUTSIDE_ROOT_BY_ADMIN";
  throw new DomainError(
    "FORBIDDEN",
    rootFolderId
      ? "Esta pasta fica fora da pasta dos clientes do escritório. Só o administrador pode ligar uma pasta de fora dela."
      : "A pasta dos clientes do escritório ainda não foi configurada. Até lá, só o administrador pode ligar uma pasta do Drive.",
  );
}
