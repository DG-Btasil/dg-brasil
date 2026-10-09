import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Testes unitários das regras PURAS de Auth e permissões (sem rede, sem Supabase). */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
