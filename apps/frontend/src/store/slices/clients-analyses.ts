import { type Client } from "@/types";
import {
} from "../helpers";

export function clientName(client: Client | undefined): string {
  if (!client) return "Cliente";
  return client.kind === "INDIVIDUAL" ? client.fullName : (client.tradeName ?? client.legalName);
}
