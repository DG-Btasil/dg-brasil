import type { Address, ID, ISODateTime, Timestamps } from "./common";

export interface Office extends Timestamps {
  id: ID;
  name: string;
  legalName?: string;
  tradeName?: string;
  cnpj?: string;
  address?: Address;
  phone?: string;
  email?: string;
  website?: string;
  principalLawyer: string;
  oab?: string;
  statesOfPractice: string[];
  units: string[];
  onboarding: OnboardingState;
}

/**
 * Estado da implantação. As respostas são guardadas por etapa, em formato
 * livre, porque cada etapa tem seu próprio schema (ver features/onboarding).
 */
export interface OnboardingState {
  completed: boolean;
  completedAt?: ISODateTime;
  currentStep: number;
  completedSteps: string[];
  skippedSteps: string[];
  answers: Record<string, Record<string, unknown>>;
}

export type SubscriptionStatus = "ACTIVE" | "TRIAL" | "PAST_DUE" | "CANCELLED";
export type ImplementationStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";

export interface Subscription {
  officeId: ID;
  planName: string;
  status: SubscriptionStatus;
  implementationStatus: ImplementationStatus;
  nextBillingAt?: ISODateTime;
  seats: number;
  supportContact: string;
}
