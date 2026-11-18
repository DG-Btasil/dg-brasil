/**
 * Onde ficam as pastas dos clientes dentro da pasta dos clientes do escritório
 * (GOOGLE_DRIVE_ROOT_FOLDER_ID, na produção "DG BRASIL").
 *
 * Desde a 060 a ponte guarda o cliente em
 *
 *   <raiz>\<ORIGEM>\CLIENTE BANCÁRIO\<NOME DO CLIENTE>
 *
 * (ORIGEM = escritório de origem do cliente: o próprio escritório ou um
 * parceiro). Antes disso as pastas ficavam direto na raiz, e os agentes clonados
 * usavam <raiz>\CLIENTE BANCÁRIO\<NOME>. Os três jeitos continuam valendo:
 *
 *   - filho da raiz chamado "CLIENTE BANCÁRIO": os filhos dele são clientes;
 *   - filho da raiz que tem um filho "CLIENTE BANCÁRIO": é pasta de ORIGEM (não
 *     é cliente) e os filhos desse "CLIENTE BANCÁRIO" são clientes;
 *   - qualquer outro filho da raiz é pasta de cliente (jeito antigo), menos as
 *     pastas de apoio ("BASE DE CONHECIMENTO").
 *
 * Funções puras: quem fala com o Drive é o DriveClient (client.ts).
 */

/** Normaliza nome para comparar pastas e clientes: sem acento, maiúsculas, sem pontuação. */
export function normalizeName(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Pastas de área: os filhos delas são pastas de cliente. */
export const CATEGORY_FOLDER_NAMES: readonly string[] = ["CLIENTE BANCARIO"];
/** Pastas de apoio na raiz, que nunca são cliente. */
export const SUPPORT_FOLDER_NAMES: readonly string[] = ["BASE DE CONHECIMENTO"];

export interface FolderNode {
  id: string;
  name: string;
  parents?: string[];
}

/** Pasta de onde saem pastas de cliente, com o caminho para exibir. */
export interface FolderContainer {
  id: string;
  path: string;
}

export interface ClientFolderTree {
  /** Pastas "CLIENTE BANCÁRIO" (na raiz ou dentro de uma origem). */
  containers: FolderContainer[];
  /** Filhos da raiz que são pasta de cliente (jeito antigo). */
  rootClients: FolderNode[];
  /** Pastas que NUNCA são cliente: origens, áreas e apoio. */
  structural: Set<string>;
}

export const isCategory = (name: string) => CATEGORY_FOLDER_NAMES.includes(normalizeName(name));
const isSupport = (name: string) => SUPPORT_FOLDER_NAMES.includes(normalizeName(name));
export const isStructuralName = (name: string) => isCategory(name) || isSupport(name);

/**
 * Lê a estrutura a partir dos dois primeiros níveis:
 * `level1` = filhos da raiz; `level2` = filhos dos filhos da raiz (com `parents`).
 */
export function readClientFolderTree(level1: FolderNode[], level2: FolderNode[]): ClientFolderTree {
  const containers: FolderContainer[] = [];
  const rootClients: FolderNode[] = [];
  const structural = new Set<string>();
  const childrenOf = new Map<string, FolderNode[]>();
  for (const f of level2) {
    for (const p of f.parents ?? []) childrenOf.set(p, [...(childrenOf.get(p) ?? []), f]);
  }
  for (const f of level1) {
    if (isCategory(f.name)) {
      structural.add(f.id);
      containers.push({ id: f.id, path: f.name });
      continue;
    }
    if (isSupport(f.name)) {
      structural.add(f.id);
      continue;
    }
    const categories = (childrenOf.get(f.id) ?? []).filter((c) => isCategory(c.name));
    if (categories.length) {
      structural.add(f.id);
      for (const c of categories) {
        structural.add(c.id);
        containers.push({ id: c.id, path: `${f.name} / ${c.name}` });
      }
      continue;
    }
    rootClients.push(f);
  }
  return { containers, rootClients, structural };
}

/** Pastas de cliente: as da raiz (jeito antigo) mais os filhos das pastas de área, com o caminho. */
export function clientFoldersFrom(tree: ClientFolderTree, inContainers: FolderNode[]): { id: string; name: string; path?: string }[] {
  const pathOf = new Map(tree.containers.map((c) => [c.id, c.path]));
  const out: { id: string; name: string; path?: string }[] = tree.rootClients.map((f) => ({ id: f.id, name: f.name }));
  const seen = new Set(out.map((f) => f.id));
  for (const f of inContainers) {
    if (seen.has(f.id) || tree.structural.has(f.id) || isStructuralName(f.name)) continue;
    const parent = (f.parents ?? []).find((p) => pathOf.has(p));
    if (!parent) continue;
    seen.add(f.id);
    out.push({ id: f.id, name: f.name, path: pathOf.get(parent) });
  }
  return out;
}
