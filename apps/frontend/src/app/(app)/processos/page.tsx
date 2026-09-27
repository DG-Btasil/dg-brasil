import { RequirePermission } from "@/components/layout/guards";
import { ProcessList } from "@/features/processes/components/process-list";

export default function ProcessesPage() {
  return (
    <RequirePermission permission="processes.view">
      <ProcessList />
    </RequirePermission>
  );
}
