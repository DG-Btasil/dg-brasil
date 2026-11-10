// Publica os agentes da ponte junto do instalador (o instalar.ps1 baixa de
// /executor/agentes/). A fonte é docs/mcp/pilotos/agentes/.
import { copyFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const de = new URL('../../../docs/mcp/pilotos/agentes/', import.meta.url)
const para = new URL('../../frontend/public/executor/agentes/', import.meta.url)
mkdirSync(fileURLToPath(para), { recursive: true })
for (const a of ['porteiro-dg', 'arquivista-dg', 'mensageiro-dg']) {
  copyFileSync(fileURLToPath(new URL(`${a}.md`, de)), fileURLToPath(new URL(`${a}.md`, para)))
  console.log(`  agentes/${a}.md`)
}
