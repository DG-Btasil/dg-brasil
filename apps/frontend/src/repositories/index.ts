/**
 * Ponto único de troca da fonte de dados.
 * Para conectar o backend: implementar `repositories/api/*` e trocar aqui.
 */
import {
  mockReferenceRepository,
  mockClientRepository,
  mockDgRepository,
  mockImportRepository,
  mockIntegrationRepository,
  mockNotificationRepository,
  mockOfficeRepository,
  mockUserRepository,
} from "./mock";

export const repositories = {
  office: mockOfficeRepository,
  users: mockUserRepository,
  clients: mockClientRepository,
  notifications: mockNotificationRepository,
  dg: mockDgRepository,
  integrations: mockIntegrationRepository,
  imports: mockImportRepository,
  references: mockReferenceRepository,
} as const;

export type Repositories = typeof repositories;
export type * from "./contracts";
