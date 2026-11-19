import type { ISODateTime } from "@/types";

/** Google Drive do escritório (041). */
export interface DriveStatusDTO {
  configured: boolean;
  mode?: "oauth" | "service_account";
  rootFolderConfigured: boolean;
  linkedClients: number;
  imports: number;
  exportsPending: number;
  exportsFailed: number;
  lastSyncAt?: ISODateTime;
  syncErrors: number;
}

export interface DriveFolderDTO {
  id: string;
  name: string;
  /** Onde a pasta fica dentro da pasta dos clientes (ex.: "PARCEIRO X / CLIENTE BANCÁRIO"). Vazio = direto na raiz. */
  path?: string;
}

export interface ClientDriveDTO {
  configured: boolean;
  link?: {
    id: string;
    folderId: string;
    folderName?: string;
    folderUrl: string;
    linkedAt: ISODateTime;
    lastSyncedAt?: ISODateTime;
    lastSyncError?: string;
  };
  imports: number;
  recentImports: { name: string; at: ISODateTime; documentVersionId: string }[];
  exports: { pending: number; exported: number; failed: number };
}

export interface DriveSuggestionDTO {
  clientId: string;
  clientName: string;
  folders: DriveFolderDTO[];
  exact: boolean;
}

export interface DriveSyncResultDTO {
  imported: number;
  skipped: number;
  failed: number;
  exported: number;
}

/** "Ligar todas as sugestões exatas": um lote. */
export interface DriveLinkManyDTO {
  linked: string[];
  failed: { clientId: string; reason: string }[];
  /** Não deu tempo neste lote: mandar de novo. */
  notProcessed: string[];
}

/** "Sincronizar tudo agora": um lote. A tela manda de volta `visited` e `pending` até `done`. */
export interface DriveSyncAllDTO {
  visited: string[];
  pending: string[];
  links: number;
  imported: number;
  skipped: number;
  failed: number;
  exported: number;
  done: boolean;
  /** Pastas ligadas no total (para o progresso). */
  total: number;
}
