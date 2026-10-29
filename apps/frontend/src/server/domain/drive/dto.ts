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
