/**
 * Contratos da camada de dados.
 *
 * A interface não sabe de onde os dados vêm. Hoje a implementação é
 * `mock/*` (store local); amanhã será `api/*` (backend TypeScript).
 * Todos os métodos são assíncronos desde já, para que a troca não mude
 * a assinatura usada pela interface.
 *
 * O `officeId` e o `partnerOfficeId` não são parâmetros de leitura: no
 * backend virão da sessão autenticada (nunca do cliente). Um usuário de
 * parceiro recebe apenas os registros da própria relação (ver
 * `lib/permissions/partner-scope.ts` e docs/BACKEND_HANDOFF.md).
 */
import type { IntegrationStatus } from "@/lib/constants/status";
import type {
  AgentTask,
  Agent,
  ChangeHistoryEntry,
  ID,
  Integration,
  JudicialSourceState,
  LegalThesis,
  ReferenceMaterial,
  Role,
  Skill,
  User,
} from "@/types";
import type { JudicialSyncResult } from "@/services/judicial-integration";
import type {
  NewReferenceInput,
  ImportPlan,
  ImportResult,
  JudicialSourceConfigInput,
  NewAgentInput,
  NewSkillInput,
  NewThesisInput,
  SkillChangeProposal,
  UserPreferences,
} from "@/store/types";

export interface UserRepository {
  list(): Promise<User[]>;
  invite(input: { name: string; email: string; role: Role }): Promise<string>;
  acceptInvitation(token: string, name: string): Promise<boolean>;
  changeRole(userId: ID, role: Role): Promise<void>;
  savePreferences(userId: ID, prefs: UserPreferences): Promise<void>;
}

export interface DgRepository {
  listAgents(): Promise<Agent[]>;
  createAgent(input: NewAgentInput): Promise<ID>;
  createSkill(input: NewSkillInput): Promise<ID>;
  createThesis(input: NewThesisInput): Promise<ID>;
  updateAgent(id: ID, patch: Partial<Pick<Agent, "status" | "autonomy" | "rules" | "skillIds" | "thesisIds" | "description">>): Promise<void>;
  listAgentTasks(agentId?: ID): Promise<AgentTask[]>;
  listSkills(): Promise<Skill[]>;
  listTheses(): Promise<LegalThesis[]>;
  listChangeHistory(): Promise<ChangeHistoryEntry[]>;
  /** Aplicada somente após confirmação explícita do usuário. */
  applySkillChange(proposal: SkillChangeProposal): Promise<ID>;
  cancelSkillChange(proposal: SkillChangeProposal): Promise<ID>;
}

export interface IntegrationRepository {
  list(): Promise<Integration[]>;
  setStatus(id: ID, status: IntegrationStatus): Promise<void>;
  sync(id: ID): Promise<void>;
  listJudicialSources(): Promise<JudicialSourceState[]>;
  configureJudicialSource(id: ID, config: JudicialSourceConfigInput): Promise<void>;
  /** Dispara a sincronização da fonte pelo provedor registrado e grava o resultado. */
  syncJudicialSource(id: ID): Promise<JudicialSyncResult>;
}

/** Migração de dados de outros sistemas/planilhas. */
export interface ImportRepository {
  /** Aplica um plano já validado (dry run feito na interface). */
  run(plan: ImportPlan): Promise<ImportResult>;
}

/**
 * Casos jurídicos: Client → LegalCase → LegalProcess.
 * Regras no servidor: origem permitida pela sessão; após o aceite só
 * Administrador muda a origem; aceite exige advogado responsável e cria o
 * acordo de parceria (snapshot) quando a origem é parceiro; a nota interna
 * da rejeição nunca é devolvida a parceiros.
 */
/** Referências do DG Brasil (somente Administrador). */
export interface ReferenceRepository {
  list(): Promise<ReferenceMaterial[]>;
  create(input: NewReferenceInput): Promise<ID>;
}
