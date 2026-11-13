import { PageContainer } from "@/components/layout/guards";
import { RequirePermission } from "@/components/layout/server-guards";
import { TrashPage } from "@/features/trash/components/trash-page";
import { TRASH_PAGE_SIZE } from "@/features/trash/labels";
import { listTrashAction } from "@/server/domain/trash/actions";

/** Primeira página (clientes excluídos) carregada no servidor. */
async function Trash() {
  const result = await listTrashAction({ kind: "CLIENT", page: 1, pageSize: TRASH_PAGE_SIZE });
  return <TrashPage initialResult={result} />;
}

/** Lixeira: restaurar o que foi excluído. Só ADMIN (o banco confere de novo, migration 066). */
export default function LixeiraPage() {
  return (
    <RequirePermission permission="trash.manage">
      <PageContainer>
        <Trash />
      </PageContainer>
    </RequirePermission>
  );
}
