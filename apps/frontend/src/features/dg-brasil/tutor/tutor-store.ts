"use client";

import { create } from "zustand";
import { createId } from "@/lib/ids";
import type { SkillChangeProposal } from "@/store/types";
import type { ID } from "@/types";

/**
 * Estado efêmero do Tutor DG (não persistido): painel aberto e conversa.
 * Nenhuma configuração é alterada aqui — só pelo repositório, após confirmação.
 */

export type ProposalState = "open" | "applied" | "cancelled";

export interface TutorProposal {
  proposal: SkillChangeProposal;
  skillName: string;
  parameterLabel: string;
  fromValue: string;
  toValue: string;
  agentNames: string[];
  state: ProposalState;
}

export interface TutorLink {
  label: string;
  href: string;
}

export interface TutorMessage {
  id: ID;
  role: "user" | "tutor";
  text: string;
  proposal?: TutorProposal;
  links?: TutorLink[];
  suggestions?: string[];
}

export interface TutorContext {
  skillId: ID;
  skillName: string;
}

interface TutorState {
  open: boolean;
  messages: TutorMessage[];
  context: TutorContext | null;
  openTutor: (context?: TutorContext, contextMessage?: Omit<TutorMessage, "id">) => void;
  closeTutor: () => void;
  addMessages: (messages: Omit<TutorMessage, "id">[]) => void;
  setProposalState: (messageId: ID, state: ProposalState) => void;
  resetConversation: () => void;
}

const useTutorStore = create<TutorState>()((set) => ({
  open: false,
  messages: [],
  context: null,
  openTutor: (context, contextMessage) =>
    set((s) => {
      const isNewContext = context && context.skillId !== s.context?.skillId;
      return {
        open: true,
        context: context ?? s.context,
        messages: isNewContext && contextMessage ? [...s.messages, { ...contextMessage, id: createId("tmsg") }] : s.messages,
      };
    }),
  closeTutor: () => set({ open: false }),
  addMessages: (messages) => set((s) => ({ messages: [...s.messages, ...messages.map((m) => ({ ...m, id: createId("tmsg") }))] })),
  setProposalState: (messageId, state) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === messageId && m.proposal ? { ...m, proposal: { ...m.proposal, state } } : m)),
    })),
  resetConversation: () => set({ messages: [], context: null }),
}));

/* Hooks de acesso (componentes não importam o store diretamente). */

export function useTutorOpen(): boolean {
  return useTutorStore((s) => s.open);
}

export function useTutorMessages(): TutorMessage[] {
  return useTutorStore((s) => s.messages);
}

export function useTutorContext(): TutorContext | null {
  return useTutorStore((s) => s.context);
}

export function useTutorControls() {
  const openTutor = useTutorStore((s) => s.openTutor);
  const closeTutor = useTutorStore((s) => s.closeTutor);
  const addMessages = useTutorStore((s) => s.addMessages);
  const setProposalState = useTutorStore((s) => s.setProposalState);
  const resetConversation = useTutorStore((s) => s.resetConversation);
  return { openTutor, closeTutor, addMessages, setProposalState, resetConversation };
}
