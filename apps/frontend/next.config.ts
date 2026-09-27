import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sem isto, o Turbopack sobe diretórios procurando lockfile e encontra um alheio.
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
};

export default nextConfig;
