import { Settings2 } from "lucide-react";
import { Callout } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { DefinitionGrid } from "@/components/ui/panel";
import { NotAvailable } from "@/components/ui/tooltip";
import { formatNumber } from "@/lib/formatting";
import type { Agent } from "@/types";
import { formatVersion } from "../../utils";
import { Collapsible } from "../shared/collapsible";

/** Área técnica: fora da experiência padrão, somente leitura. */
export function AgentAdvancedTab({ agent }: { agent: Agent }) {
  const { config } = agent;
  const preview = JSON.stringify(
    { agente: agent.name, versao: agent.version, modelo: config.model, max_tokens: config.maxOutputTokens, ferramentas: config.tools, concorrencia: config.concurrency },
    null,
    2,
  );
  return (
    <div className="space-y-4">
      <Callout tone="warning" title="Área técnica">
        Estas configurações definem como o agente é executado. Não é preciso alterá-las no uso diário — ajustes de comportamento são feitos pelas
        Regras, pelas Skills ou com o Tutor DG.
      </Callout>
      <Collapsible title="Configuração técnica do agente" description="Modelo, limites, ferramentas e concorrência (somente leitura)." icon={<Settings2 className="size-4" aria-hidden />}>
        <div className="space-y-5">
          <DefinitionGrid
            columns={4}
            items={[
              { label: "Modelo", value: <span className="font-mono text-[12.5px]">{config.model}</span> },
              { label: "Máx. de tokens por resposta", value: <span className="tabular">{formatNumber(config.maxOutputTokens)}</span> },
              { label: "Execuções simultâneas", value: <span className="tabular">{config.concurrency}</span> },
              { label: "Versão", value: formatVersion(agent.version) },
              {
                label: "Ferramentas",
                wide: true,
                value: (
                  <ul className="flex flex-wrap gap-1.5">
                    {config.tools.map((tool) => (
                      <li key={tool} className="rounded-xs border border-line bg-surface-muted px-1.5 py-0.5 font-mono text-[12px]">
                        {tool}
                      </li>
                    ))}
                  </ul>
                ),
              },
            ]}
          />
          <div>
            <h3 className="mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.06em] text-subtle">Pré-visualização</h3>
            <pre className="overflow-x-auto rounded-md border border-line bg-surface-muted px-4 py-3 font-mono text-[12px] leading-relaxed text-foreground">
              {preview}
            </pre>
          </div>
          <div className="flex justify-end">
            <NotAvailable>
              <Button variant="secondary">Editar configuração técnica</Button>
            </NotAvailable>
          </div>
        </div>
      </Collapsible>
    </div>
  );
}
