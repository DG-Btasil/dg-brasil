import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import type { NextConfig } from 'next'

const config: NextConfig = {
  // PGlite e pg carregam WASM/binários: não devem passar pelo bundler.
  serverExternalPackages: ['@electric-sql/pglite', 'pg'],

  // Sem isto, o Turbopack sobe até a home procurando lockfile e acha um alheio.
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
}

export default config
