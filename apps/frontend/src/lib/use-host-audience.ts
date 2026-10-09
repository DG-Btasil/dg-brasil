"use client";

import { useSyncExternalStore } from "react";
import type { Audience } from "@/lib/permissions";
import { audienceForHost } from "./hosts";

const noop = () => () => {};

/** Público do host atual (cliente). No servidor: undefined. Só ajusta textos. */
export function useHostAudience(): Audience | undefined {
  return useSyncExternalStore(
    noop,
    () => audienceForHost(window.location.hostname),
    () => undefined,
  );
}
