import { FileText, Settings2 } from "lucide-react";
import { Callout } from "@/components/feedback/states";
import type { Skill } from "@/types";
import { Collapsible } from "../shared/collapsible";

/** Área técnica da Skill: somente leitura, marcada como etapa futura. */
export function SkillAdvanced({ skill }: { skill: Skill }) {
  return (
    <Collapsible
      title="Configuração avançada"
      description="Instruções, referências, modelos e arquivos da Skill. Não é necessário editar para o uso diário."
      icon={<Settings2 className="size-4" aria-hidden />}
    >
      <div className="space-y-5">
        <Callout tone="neutral">A edição direta de arquivos da Skill estará disponível em uma próxima etapa.</Callout>
        <div>
          <h3 className="mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.06em] text-subtle">Instruções</h3>
          <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap rounded-md border border-line bg-surface-muted px-4 py-3 font-mono text-[12px] leading-relaxed text-foreground">
            {skill.instructions}
          </pre>
        </div>
        <div className="grid grid-cols-3 gap-5">
          <SimpleList title="Referências" items={skill.references} empty="Nenhuma referência." />
          <SimpleList title="Modelos" items={skill.templates} empty="Nenhum modelo." />
          <div>
            <h3 className="mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.06em] text-subtle">Arquivos associados</h3>
            {skill.files.length === 0 ? (
              <p className="text-[12.5px] text-muted">Nenhum arquivo.</p>
            ) : (
              <ul className="space-y-1.5">
                {skill.files.map((f) => (
                  <li key={f.name} className="flex items-center gap-2 text-[12.5px]">
                    <FileText aria-hidden className="size-3.5 text-subtle" />
                    <span className="font-mono text-foreground">{f.name}</span>
                    <span className="ml-auto tabular text-muted">{f.sizeKb} KB</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Collapsible>
  );
}

function SimpleList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div>
      <h3 className="mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.06em] text-subtle">{title}</h3>
      {items.length === 0 ? (
        <p className="text-[12.5px] text-muted">{empty}</p>
      ) : (
        <ul className="list-disc space-y-1 pl-4 text-[12.5px] text-foreground">
          {items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
