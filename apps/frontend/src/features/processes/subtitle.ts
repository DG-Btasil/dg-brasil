import type { ProcessListItem } from "@/server/domain/processes/dto";

type ProcessNames = Pick<ProcessListItem, "actionType" | "title" | "caseTitle">;

/** 1ª linha da coluna "Tipo / ação": o tipo de ação ou, sem ele, o nome do processo (o do caso, se não houver título próprio). */
export function processHeading(p: ProcessNames): string {
  return p.actionType?.trim() || p.title;
}

/**
 * 2ª linha da coluna "Tipo / ação" da lista de processos. O caso aparece
 * SEMPRE (QA 4.3, BUG-02: com tipo de ação, o caso sumia da lista); com tipo
 * de ação, o título do processo vem antes. Nada se repete: nem título igual
 * ao caso, nem o que já está na 1ª linha (processo sem título próprio é
 * exibido com o título do caso).
 */
export function processSubtitle(p: ProcessNames): string {
  const heading = processHeading(p);
  const parts = [p.actionType ? p.title : null, p.caseTitle].filter((v): v is string => !!v && !!v.trim() && v !== heading);
  return [...new Set(parts)].join(" · ");
}
