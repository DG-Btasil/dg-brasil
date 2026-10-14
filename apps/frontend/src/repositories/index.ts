/**
 * Ponto único de troca da fonte de dados.
 * Para conectar o backend: implementar `repositories/api/*` e trocar aqui.
 */
import {
  mockReferenceRepository,
  mockDgRepository,
  mockImportRepository,
  mockIntegrationRepository,
  mockUserRepository,
} from "./mock";

export const repositories = {
  users: mockUserRepository,
  dg: mockDgRepository,
  integrations: mockIntegrationRepository,
  imports: mockImportRepository,
  references: mockReferenceRepository,
} as const;

export type Repositories = typeof repositories;
export type * from "./contracts";
