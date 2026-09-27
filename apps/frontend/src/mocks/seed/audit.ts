import { daysFromNowISO } from "@/lib/clock";
import type { AuditEvent } from "@/types";
import { A, AN, C, OFFICE_ID, P, R, S, U } from "../ids";

const o = { officeId: OFFICE_ID };
const marina = { type: "USER" as const, id: U.marina, name: "Dra. Marina Alves" };
const rafael = { type: "USER" as const, id: U.rafael, name: "Dr. Rafael Moura" };
const beatriz = { type: "USER" as const, id: U.beatriz, name: "Dra. Beatriz Nogueira" };
const camila = { type: "USER" as const, id: U.camila, name: "Camila Duarte" };

export function buildAuditEvents(): AuditEvent[] {
  return [
    { ...o, id: "aud_01", at: daysFromNowISO(0, 8, 30), actor: camila, action: "CLIENT_CREATED", entityType: "client", entityId: C.panificadora, description: "Cliente Panificadora Bom Grão cadastrado." },
    { ...o, id: "aud_02", at: daysFromNowISO(0, 8, 45), actor: beatriz, action: "ANALYSIS_STARTED", entityType: "analysis", entityId: AN.marlene, description: "Análise bancária iniciada para Marlene Aparecida Costa." },
    { ...o, id: "aud_03", at: daysFromNowISO(0, 9, 5), actor: camila, action: "DOCUMENT_ADDED", entityType: "document", entityId: "doc_016", description: "Extratos bancários adicionados para Ana Cláudia Souza Lima." },
    { ...o, id: "aud_04", at: daysFromNowISO(-1, 16, 40), actor: camila, action: "CLIENT_CREATED", entityType: "client", entityId: C.ana, description: "Cliente Ana Cláudia Souza Lima cadastrada." },
    { ...o, id: "aud_05", at: daysFromNowISO(-3, 10, 40), actor: beatriz, action: "ANALYSIS_INTERRUPTED", entityType: "analysis", entityId: AN.luiza, description: "Análise de Luiza Helena Barros interrompida por divergência documental." },
    { ...o, id: "aud_06", at: daysFromNowISO(-3, 12, 0), actor: beatriz, action: "REVIEW_REJECTED", entityType: "review", entityId: R.mensagemLuiza, description: "Mensagem ao cliente rejeitada." },
    { ...o, id: "aud_07", at: daysFromNowISO(-6, 15, 0), actor: rafael, action: "REVIEW_CHANGES_REQUESTED", entityType: "review", entityId: R.peticaoFerragens, description: "Alterações solicitadas na minuta de manifestação." },
    { ...o, id: "aud_08", at: daysFromNowISO(-10, 14, 51), actor: marina, action: "SKILL_UPDATED", entityType: "skill", entityId: S.redacaoBancaria, description: "Skill Redação Bancária atualizada (v2 → v3) via Tutor DG." },
    { ...o, id: "aud_09", at: daysFromNowISO(-20, 15, 0), actor: rafael, action: "REVIEW_APPROVED", entityType: "review", entityId: R.analiseHelena, description: "Parecer de Helena Martins Ribeiro aprovado." },
    { ...o, id: "aud_10", at: daysFromNowISO(-20, 15, 1), actor: { type: "SYSTEM", id: "system", name: "DG Brasil" }, action: "PROCESS_CREATED", entityType: "process", entityId: P.helenaRevisional, description: "Processo revisional criado a partir da análise aprovada." },
    { ...o, id: "aud_11", at: daysFromNowISO(-25, 11, 0), actor: marina, action: "AGENT_UPDATED", entityType: "agent", entityId: A.triagem, description: "Agente de Triagem Bancária atualizado para a versão 4." },
  ];
}
