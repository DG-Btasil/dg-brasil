import { PageContainer } from "@/components/layout/guards";
import { Skeleton, SkeletonRows } from "@/components/feedback/states";
import { Panel } from "@/components/ui/panel";

/**
 * Carregamento de QUALQUER área da equipe e do portal (Roadmap 2.0, bloco 1).
 * Sem isto, ao clicar num indicador ou no menu a tela ficava parada até o
 * servidor terminar todas as consultas da página seguinte. Com o esqueleto,
 * a troca de tela é imediata (o Next pré-carrega este estado junto com o link)
 * e os dados entram assim que chegam. Nunca mostra dado de demonstração.
 */
export default function Loading() {
  return (
    <PageContainer>
      <div className="mb-6 space-y-2" aria-hidden>
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4" aria-hidden>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[88px] w-full rounded-lg" />
        ))}
      </div>
      <Panel>
        <SkeletonRows rows={8} />
      </Panel>
    </PageContainer>
  );
}
