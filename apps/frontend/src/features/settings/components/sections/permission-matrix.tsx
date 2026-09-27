import { Fragment } from "react";
import { Check, Minus } from "lucide-react";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { ROLES, ROLE_DESCRIPTION, ROLE_LABEL, can } from "@/lib/permissions";
import { PERMISSION_GROUPS, PERMISSION_LABEL } from "../../permission-groups";

/** Matriz somente leitura gerada a partir de ROLE_PERMISSIONS. */
export function PermissionMatrix() {
  return (
    <Panel>
      <PanelHeader title="Matriz de permissões" description="O que cada papel pode fazer. Definida pelo DG Brasil; não é editável nesta etapa." />
      <div className="grid grid-cols-3 divide-x divide-line border-b border-line">
        {ROLES.map((role) => (
          <div key={role} className="px-5 py-3.5">
            <p className="text-[13px] font-semibold text-foreground">{ROLE_LABEL[role]}</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{ROLE_DESCRIPTION[role]}</p>
          </div>
        ))}
      </div>
      <Table caption="Matriz de permissões por papel">
        <THead>
          <tr>
            <Th>Permissão</Th>
            {ROLES.map((role) => (
              <Th key={role} className="w-[140px] text-center">
                {ROLE_LABEL[role]}
              </Th>
            ))}
          </tr>
        </THead>
        <TBody>
          {PERMISSION_GROUPS.map((group) => (
            <Fragment key={group.label}>
              <tr className="bg-surface-muted">
                <th scope="colgroup" colSpan={ROLES.length + 1} className="px-5 py-1.5 text-left text-[11.5px] font-semibold uppercase tracking-[0.05em] text-muted">
                  {group.label}
                </th>
              </tr>
              {group.permissions.map((permission) => (
                <Tr key={permission}>
                  <Th scope="row" className="h-auto py-2 text-[13px] font-normal normal-case tracking-normal text-foreground">
                    {PERMISSION_LABEL[permission]}
                  </Th>
                  {ROLES.map((role) => {
                    const allowed = can(role, permission);
                    return (
                      <Td key={role} className="py-2 text-center">
                        {allowed ? (
                          <>
                            <Check className="mx-auto size-4 text-success" aria-hidden />
                            <span className="sr-only">Permitido</span>
                          </>
                        ) : (
                          <>
                            <Minus className="mx-auto size-4 text-subtle" aria-hidden />
                            <span className="sr-only">Não permitido</span>
                          </>
                        )}
                      </Td>
                    );
                  })}
                </Tr>
              ))}
            </Fragment>
          ))}
        </TBody>
      </Table>
    </Panel>
  );
}
