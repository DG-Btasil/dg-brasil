import type { StepComponent, StepKey } from "../types";
import { AgentsSkillsStep } from "./agents-skills";
import { ApprovalsStep } from "./approvals";
import { ClientProfileStep } from "./client-profile";
import { CommunicationStep } from "./communication";
import { FeeModelsStep } from "./fee-models";
import { IdentityStep } from "./identity";
import { IntegrationsStep } from "./integrations";
import { LegalCriteriaStep } from "./legal-criteria";
import { PracticeAreasStep } from "./practice-areas";
import { ReviewStep } from "./review";
import { TeamStep } from "./team";
import { WorkflowStep } from "./workflow";
import { WritingStyleStep } from "./writing-style";

export const STEP_COMPONENTS: Record<StepKey, StepComponent> = {
  identity: IdentityStep,
  team: TeamStep,
  "practice-areas": PracticeAreasStep,
  "client-profile": ClientProfileStep,
  "legal-criteria": LegalCriteriaStep,
  "writing-style": WritingStyleStep,
  workflow: WorkflowStep,
  approvals: ApprovalsStep,
  communication: CommunicationStep,
  "fee-models": FeeModelsStep,
  integrations: IntegrationsStep,
  "agents-skills": AgentsSkillsStep,
  review: ReviewStep,
};
