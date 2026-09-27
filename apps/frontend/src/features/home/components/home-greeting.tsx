"use client";

import { now } from "@/lib/clock";
import { formatDateLong, greeting } from "@/lib/formatting";
import { useCurrentUser } from "@/features/auth/hooks";
import { useOffice } from "@/features/offices/hooks";

const weekdayFmt = new Intl.DateTimeFormat("pt-BR", { weekday: "long" });

/** Saudação discreta no topo da Home. */
export function HomeGreeting() {
  const user = useCurrentUser();
  const office = useOffice();
  const today = now();
  const weekday = weekdayFmt.format(today);
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-serif text-[30px] font-medium leading-tight tracking-[-0.01em] text-navy">
          {greeting(today)}
          {user ? `, ${user.displayName}.` : "."}
        </h1>
        <p className="mt-1.5 text-[13px] text-muted">
          <span className="capitalize">{weekday}</span>, {formatDateLong(today)}
          <span aria-hidden className="mx-2 text-subtle">
            ·
          </span>
          {office.name}
        </p>
      </div>
    </header>
  );
}
