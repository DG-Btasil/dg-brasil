import { SkillDetail } from "@/features/dg-brasil/components/skills/skill-detail";

export default async function SkillPage({ params }: PageProps<"/dg-brasil/skills/[id]">) {
  const { id } = await params;
  return <SkillDetail id={id} />;
}
