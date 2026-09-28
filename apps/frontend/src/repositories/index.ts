/**
 * Ponto único de troca da fonte de dados.
 * Para conectar o backend: implementar `repositories/api/*` e trocar aqui.
 */
import {
  mockAnalysisRepository,
  mockClientRepository,
  mockDgRepository,
  mockDocumentRepository,
  mockFinanceRepository,
  mockImportRepository,
  mockIntegrationRepository,
  mockNotificationRepository,
  mockOfficeRepository,
  mockPartnerPortalRepository,
  mockPartnerRepository,
  mockProcessRepository,
  mockReviewRepository,
  mockUserRepository,
} from "./mock";

export const repositories = {
  office: mockOfficeRepository,
  users: mockUserRepository,
  clients: mockClientRepository,
  documents: mockDocumentRepository,
  analyses: mockAnalysisRepository,
  processes: mockProcessRepository,
  reviews: mockReviewRepository,
  notifications: mockNotificationRepository,
  finance: mockFinanceRepository,
  dg: mockDgRepository,
  integrations: mockIntegrationRepository,
  imports: mockImportRepository,
  partners: mockPartnerRepository,
  partnerPortal: mockPartnerPortalRepository,
} as const;

export type Repositories = typeof repositories;
export type * from "./contracts";
