import type { ReceiptDTO } from "@/server/domain/finance/dto";

/**
 * Quanto ainda resta de cada recebimento (lançamento positivo), descontados
 * os estornos e os ajustes para menos que apontam para ele. Recebimento já
 * estornado por inteiro não oferece "Estornar" nem aparece como "Recebimento
 * corrigido" no ajuste (achado F5). Puro e testado (receipts.test.ts).
 */
export function receiptRemaining(entries: readonly Pick<ReceiptDTO, "id" | "amount" | "originalReceiptId">[]): Map<string, number> {
  const remaining = new Map<string, number>();
  for (const e of entries) if (e.amount > 0) remaining.set(e.id, Math.round(e.amount * 100));
  for (const e of entries) {
    if (e.amount < 0 && e.originalReceiptId && remaining.has(e.originalReceiptId)) {
      remaining.set(e.originalReceiptId, (remaining.get(e.originalReceiptId) ?? 0) + Math.round(e.amount * 100));
    }
  }
  return new Map([...remaining].map(([id, cents]) => [id, Math.max(0, cents) / 100]));
}

/**
 * Legenda do "Disponível" conforme o estado (sugestão dos testes): antes dizia
 * "Ainda sem repasse" mesmo com repasse registrado e ainda não pago.
 */
export function availableHint(available: number, pendingTransfer: number): string {
  if (available < 0) return "Repassado a mais: recebimento estornado depois do repasse";
  if (pendingTransfer > 0) return available > 0 ? "Além do que já está em repasse" : "Tudo já está em repasse";
  return available > 0 ? "Pronto para repassar" : "Nada a repassar agora";
}

