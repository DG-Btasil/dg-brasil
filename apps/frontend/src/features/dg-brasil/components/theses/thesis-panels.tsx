import Link from "next/link";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";

export function BulletPanel({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <Panel>
      <PanelHeader title={title} />
      <PanelBody>
        {items.length === 0 ? (
          <p className="text-[13px] text-muted">{empty}</p>
        ) : (
          <ul className="list-disc space-y-1.5 pl-4 text-[13px] leading-relaxed text-foreground marker:text-subtle">
            {items.map((item, i) => (
              <li key={`${i}-${item}`}>{item}</li>
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}

export function LinkListPanel({ title, items, empty }: { title: string; items: { id: string; label: string; href: string }[]; empty: string }) {
  return (
    <Panel>
      <PanelHeader title={title} />
      {items.length === 0 ? (
        <PanelBody>
          <p className="text-[13px] text-muted">{empty}</p>
        </PanelBody>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((item) => (
            <li key={item.id} className="px-5 py-2.5">
              <Link href={item.href} className="text-[13px] font-medium text-navy-700 hover:underline underline-offset-2">
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
