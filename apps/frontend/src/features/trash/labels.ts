import { formatNumber } from "@/lib/formatting";
import type { RestoreResultDTO, TrashBlockReason } from "@/server/domain/trash/dto";
import type { TrashKind } from "@/server/domain/trash/schemas";

/** Textos da Lixeira (puros, testados em trash.test.ts). */

export const TRASH_HREF = "/configuracoes/lixeira";
export const TRASH_PAGE_SIZE = 25;

export const TRASH_KIND_LABEL: Record<TrashKind, { tab: string; one: string; many: string; empty: string; search: string }> = {
  CLIENT: { tab: "Clientes", one: "cliente", many: "clientes", empty: "Nenhum cliente excluído.", search: "Buscar por nome ou CPF/CNPJ" },
  PROCESS: { tab: "Processos", one: "processo", many: "processos", empty: "Nenhum processo excluído.", search: "Buscar por número CNJ ou nome do caso" },
  DOCUMENT: { tab: "Documentos", one: "documento", many: "documentos", empty: "Nenhum documento excluído.", search: "Buscar por título ou nome do cliente" },
};

/** Por que não dá para restaurar agora (o servidor confere de novo ao restaurar). */
export const TRASH_BLOCK_LABEL: Record<TrashBlockReason, string> = {
  CLIENT_DELETED: "O cliente está na Lixeira. Restaure primeiro o cliente.",
  CASE_DELETED: "O caso deste processo foi excluído. Não dá para restaurar só o processo.",
  CNJ_IN_USE: "Outro processo ativo usa este número CNJ. Este só volta se o outro for excluído.",
};

/** O que a pessoa lê antes de confirmar a restauração: o que volta e o que não dá para desfazer. */
export const RESTORE_EXPLANATION: Record<TrashKind, { title: string; body: string[] }> = {
  CLIENT: {
    title: "Restaurar cliente",
    body: [
      "O cadastro volta para a lista de clientes e a ficha volta a abrir, com os casos, processos, prazos e documentos que já eram dele. A exclusão não mexeu em nenhum deles.",
      "Se o cliente era de um parceiro, o parceiro volta a enxergá-lo.",
      "Processo ou documento que foi excluído à parte continua na Lixeira até ser restaurado também.",
    ],
  },
  PROCESS: {
    title: "Restaurar processo",
    body: [
      "O processo volta para a lista com o número CNJ, as movimentações, os documentos e os prazos que tinha. Os prazos em aberto voltam a aparecer na agenda.",
      "A busca de publicações e de andamentos volta a acompanhar o número.",
      "O que saiu no tribunal enquanto o processo esteve excluído não foi capturado. Confira esse período direto no tribunal.",
    ],
  },
  DOCUMENT: {
    title: "Restaurar documento",
    body: ["O documento volta para a ficha do cliente, com as versões e os vínculos com casos e processos que tinha. Nenhum arquivo foi apagado."],
  },
};

const n = (count: number, one: string, many: string) => `${formatNumber(count)} ${count === 1 ? one : many}`;

/** Aviso depois de restaurar: o que voltou a aparecer e o que ainda está na Lixeira. */
export function restoreNotice(result: RestoreResultDTO): { title: string; description: string } {
  if (result.kind === "CLIENT") {
    const back = [n(result.cases, "caso", "casos"), n(result.processes, "processo", "processos"), n(result.documents, "documento", "documentos")].join(", ");
    const left = [
      result.trashedProcesses > 0 ? n(result.trashedProcesses, "processo", "processos") : "",
      result.trashedDocuments > 0 ? n(result.trashedDocuments, "documento", "documentos") : "",
    ].filter(Boolean);
    return {
      title: "Cliente restaurado",
      description: `Com ele: ${back}.${left.length ? ` Ainda na Lixeira: ${left.join(" e ")}.` : ""}`,
    };
  }
  if (result.kind === "PROCESS") {
    const parts = [
      result.cnjReturned ? "O número CNJ voltou para este processo." : "",
      result.openDeadlines > 0 ? `${n(result.openDeadlines, "prazo em aberto voltou", "prazos em aberto voltaram")} para a agenda.` : "",
      "Confira no tribunal o que saiu enquanto ele esteve excluído.",
    ].filter(Boolean);
    return { title: "Processo restaurado", description: parts.join(" ") };
  }
  return { title: "Documento restaurado", description: "Voltou para a ficha do cliente." };
}
