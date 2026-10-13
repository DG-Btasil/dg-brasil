/**
 * Ponto único de troca da fonte de dados.
 * Para conectar o backend: implementar `repositories/api/*` e trocar aqui.
 */
import {
  mockReferenceRepository,
  mockClientRepository,
  mockDgRepository,
  mockFinanceRepository,
  mockImportRepository,
  mockIntegrationRepository,
  mockNotificationRepository,
  mockOfficeRepository,
  mockPartnerRepository,
  mockUserRepository,
} from "./mock";

export const repositories = {
  office: mockOfficeRepository,
  users: mockUserRepository,
  clients: mockClientRepository,
  notifications: mockNotificationRepository,
  finance: mockFinanceRepository,
  dg: mockDgRepository,
  integrations: mockIntegrationRepository,
  imports: mockImportRepository,
  references: mockReferenceRepository,
  partners: mockPartnerRepository,
} as const;

export type Repositories = typeof repositories;
export type * from "./contracts";
