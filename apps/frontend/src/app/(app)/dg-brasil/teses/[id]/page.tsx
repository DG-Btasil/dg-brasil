import { ThesisDetail } from "@/features/dg-brasil/components/theses/thesis-detail";

export default async function ThesisPage({ params }: PageProps<"/dg-brasil/teses/[id]">) {
  const { id } = await params;
  return <ThesisDetail id={id} />;
}
