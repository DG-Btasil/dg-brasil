import { ACQUISITION_CHANNEL_LABEL } from "@/lib/constants/legal";
import { CLIENT_KIND_LABEL, CLIENT_STATUS_LABEL } from "@/lib/constants/status";
import { formatDocument, formatPhone } from "@/lib/formatting/masks";
import { csvDate, type CsvColumn } from "@/server/domain/exports/csv";
import type { ClientListItem } from "./dto";
import type { ClientExportExtraRow } from "./repository";

/** Linha da planilha de clientes: a linha da lista + contato e município principais + nome da origem. */
export interface ClientExportRow extends ClientListItem {
  email?: string;
  phone?: string;
  city?: string;
  state?: string;
  originName?: string;
}

/** Contato e endereço PRINCIPAIS de cada cliente (o mesmo critério da ficha). */
export function exportExtrasById(rows: readonly ClientExportExtraRow[]): Map<string, Pick<ClientExportRow, "email" | "phone" | "city" | "state">> {
  return new Map(
    rows.map((r) => {
      const contact = (type: string) => (r.client_contacts ?? []).find((c) => c.type === type && c.is_primary)?.value;
      const address = (r.client_addresses ?? []).find((a) => a.is_primary);
      return [r.id, { email: contact("EMAIL"), phone: contact("PHONE"), city: address?.city ?? undefined, state: address?.state ?? undefined }];
    }),
  );
}

/**
 * Colunas da planilha de clientes. O CPF/CNPJ sai COMPLETO e com máscara (é
 * para isso que a exportação serve; sem máscara o Excel corta os zeros).
 */
export const CLIENT_EXPORT_COLUMNS: readonly CsvColumn<ClientExportRow>[] = [
  { header: "Nome", value: (c) => c.name },
  { header: "Nome fantasia", value: (c) => c.tradeName },
  { header: "Tipo", value: (c) => CLIENT_KIND_LABEL[c.kind] },
  { header: "CPF/CNPJ", value: (c) => (c.document ? formatDocument(c.document) : "") },
  { header: "Situação", value: (c) => CLIENT_STATUS_LABEL[c.status] },
  { header: "E-mail", value: (c) => c.email },
  { header: "Telefone", value: (c) => (c.phone ? formatPhone(c.phone) : "") },
  { header: "Município", value: (c) => c.city },
  { header: "UF", value: (c) => c.state },
  { header: "Origem", value: (c) => c.originName },
  { header: "Como chegou", value: (c) => (c.acquisitionChannel ? ACQUISITION_CHANNEL_LABEL[c.acquisitionChannel] : "") },
  { header: "Cadastrado em", value: (c) => csvDate(c.createdAt) },
  { header: "Atualizado em", value: (c) => csvDate(c.updatedAt) },
];
