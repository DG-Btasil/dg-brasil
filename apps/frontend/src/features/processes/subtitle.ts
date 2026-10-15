import type { ProcessListItem } from "@/server/domain/processes/dto";

/**
 * 2ª linha da coluna "Tipo / ação" da lista de processos. O caso aparece
 * SEMPRE (QA 4.3, BUG-02: com tipo de ação, o caso sumia da lista); com tipo
 * de ação, o título do processo vem antes. Sem repetir título igual ao caso.
 */
export function processSubtitle(p: Pick<ProcessListItem, "actionType" | "title" | "caseTitle">): string {
  const parts = [p.actionType ? p.title : null, p.caseTitle].filter((v): v is string => !!v && !!v.trim());
  return [...new Set(parts)].join(" · ");
}
