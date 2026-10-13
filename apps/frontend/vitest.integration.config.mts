import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Integração com o Supabase de DESENVOLVIMENTO (dados fictícios). Os services
 * de domínio rodam com clients autenticados de verdade (senha + TOTP → aal2),
 * RLS e funções do banco reais. Variáveis: supabase/.env.real (DG_ENV=development).
 *
 *   npm run test:integration
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Os services não importam Next.js; o que importa server-only é a fronteira das actions.
      "server-only": fileURLToPath(new URL("./tests/integration/support/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/integration/**/*.int.test.ts"],
    environment: "node",
    globalSetup: ["tests/integration/support/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 300_000,
  },
});
