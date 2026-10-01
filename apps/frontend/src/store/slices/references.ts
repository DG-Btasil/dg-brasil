import { nowISO } from "@/lib/clock";
import { REFERENCE_MATERIAL_TYPE_LABEL } from "@/lib/constants/status";
import { createId } from "@/lib/ids";
import { can } from "@/lib/permissions";
import { auditEvent, requireOwnerViewer, type GetState, type SetState } from "../helpers";
import type { ReferenceActions } from "../types";

/** Referências do DG Brasil (somente Administrador). Sem indexação/RAG nesta etapa. */
export function createReferenceSlice(set: SetState, get: GetState): ReferenceActions {
  return {
    createReference: (input) => {
      const s = get();
      const viewer = requireOwnerViewer(s);
      if (!can(viewer.role, "dgbrasil.manage")) throw new Error("Somente Administrador pode adicionar referências.");
      const at = nowISO();
      const id = createId("ref");
      set({
        references: [{ ...input, id, officeId: s.office.id, status: "ACTIVE", createdAt: at, createdBy: viewer.userId, updatedAt: at }, ...s.references],
        auditEvents: [
          auditEvent(s, "REFERENCE_CREATED", "reference", id, `Referência “${input.title}” adicionada (${REFERENCE_MATERIAL_TYPE_LABEL[input.type]}).`),
          ...s.auditEvents,
        ],
      });
      return id;
    },
  };
}
