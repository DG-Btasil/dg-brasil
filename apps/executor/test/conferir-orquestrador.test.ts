import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

/** A conferência do orquestrador (scripts/conferir-orquestrador.mjs), com um kit e um orquestrador fictícios. */

const script = fileURLToPath(new URL('../scripts/conferir-orquestrador.mjs', import.meta.url))
const pastas: string[] = []
afterEach(() => { for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true }) })

const agente = (nome: string) => `---\r\nname: ${nome}\r\ndescription: agente fictício\r\ntools: Read\r\n---\r\n\r\nCorpo.\r\n`

const ORQUESTRADOR = (linhas: string[], regras = '') => [
  '---', 'name: orquestrador', '---', '', '## Agentes', '',
  '| A tarefa ou o despacho pede | Agente |', '|---|---|', ...linhas,
  '| Recado sem providência | nenhum: não pede peça |', '', '## Regras', '', regras,
].join('\n')

const INSTALADOR = (chaves: string[]) => [
  "$ficha = 'FICHA_REVISAO_*.md'",
  '$trazer = @{',
  ...chaves.map((c) => `  '${c}' = @('X_*.pdf', $ficha)`),
  '}',
].join('\r\n')

function montar(opcoes: { instalados: string[]; bancario?: string[]; geral?: string[]; tabela: string[]; regras?: string; instalador?: string }) {
  const raiz = mkdtempSync(join(tmpdir(), 'conferir-orq-'))
  pastas.push(raiz)
  const instalados = join(raiz, 'agents')
  mkdirSync(instalados)
  for (const n of opcoes.instalados) writeFileSync(join(instalados, `${n}.md`), agente(n))
  // .bak e agente do escritório (sem -dg) não entram no kit
  writeFileSync(join(instalados, 'alice-inicial-dg.md.bak-x'), agente('alice-inicial-dg'))
  writeFileSync(join(instalados, '87-vera-viabilidade.md'), agente('vera-viabilidade'))
  const repo = join(raiz, 'repo')
  for (const [sub, lista] of [['bancario', opcoes.bancario], ['geral', opcoes.geral]] as const) {
    if (!lista) continue
    mkdirSync(join(repo, 'agentes', sub), { recursive: true })
    for (const n of lista) writeFileSync(join(repo, 'agentes', sub, `${n}.md`), agente(n))
  }
  mkdirSync(repo, { recursive: true })
  const tabela = join(raiz, 'orquestrador.md')
  writeFileSync(tabela, ORQUESTRADOR(opcoes.tabela, opcoes.regras))
  const instalador = join(raiz, 'instalar.ps1')
  writeFileSync(instalador, opcoes.instalador ?? INSTALADOR([]))
  return { tabela, instalados, repo, instalador }
}

function rodar(m: ReturnType<typeof montar>, json = true) {
  const args = [script, m.tabela, '--agentes', m.instalados, '--repo', m.repo, '--instalador', m.instalador]
  const r = spawnSync(process.execPath, json ? [...args, '--json'] : args, { encoding: 'utf8' })
  return { codigo: r.status, texto: r.stdout, json: json ? JSON.parse(r.stdout) : null }
}

const PONTE = ['porteiro-dg', 'arquivista-dg', 'mensageiro-dg', 'orquestrador', 'intimacao-dg']

describe('conferir-orquestrador', () => {
  it('tabela igual ao kit: sai com 0; os da ponte, a Diana e o orquestrador não precisam estar na tabela', () => {
    const m = montar({
      instalados: [...PONTE, 'alice-inicial-dg', 'murilo-replica-dg'],
      bancario: ['alice-inicial-dg', 'murilo-replica-dg'],
      geral: ['intimacao-dg'],
      tabela: ['| Inicial | `alice-inicial-dg` |', '| Réplica | `murilo-replica-dg` (com alerta) |'],
      regras: 'A inicial é da `alice-inicial-dg`; a pasta `entrada` não é agente.',
      instalador: INSTALADOR(['alice-inicial-dg', 'murilo-replica-dg']),
    })
    const r = rodar(m)
    expect(r.codigo).toBe(0)
    expect(r.json.ok).toBe(true)
    expect(r.json.foraDaTabela).toEqual([])
    expect(r.json.naoInstalados).toEqual([])
    expect(r.json.semLinhaNoInstalador).toEqual([])
    expect(r.json.kit.map((k: { nome: string }) => k.nome)).not.toContain('vera-viabilidade')
  })

  it('agente do kit fora da tabela e agente da tabela não instalado: sai com 1 e diz quais', () => {
    const m = montar({
      instalados: [...PONTE, 'alice-inicial-dg', 'vera-viabilidade-dg'],
      bancario: ['alice-inicial-dg', 'vera-viabilidade-dg'],
      tabela: ['| Inicial | `alice-inicial-dg` |', '| Prazo | `prazos-dg` |'],
      regras: 'Antigo: `renomeado-dg` fazia isso.',
    })
    const r = rodar(m)
    expect(r.codigo).toBe(1)
    expect(r.json.foraDaTabela.map((x: { nome: string }) => x.nome)).toEqual(['vera-viabilidade-dg'])
    expect(r.json.naoInstalados.map((x: { nome: string; onde: string }) => [x.nome, x.onde])).toEqual([['prazos-dg', 'tabela'], ['renomeado-dg', 'regras']])
    const texto = rodar(m, false).texto
    expect(texto).toContain('ERRO  Agente do kit que não está na tabela do orquestrador')
    expect(texto).toContain('- prazos-dg  (tabela, linha 10)')
    expect(texto).toContain('Resultado: 3 problemas')
  })

  it('mapa do instalador: agente da ponte sem linha própria e linha sobrando são só aviso', () => {
    const m = montar({
      instalados: [...PONTE, 'alice-inicial-dg', 'teresa-audiencia-dg'],
      bancario: ['alice-inicial-dg', 'teresa-audiencia-dg'],
      geral: ['intimacao-dg'],
      tabela: ['| Inicial | `alice-inicial-dg` |', '| AIJ | `teresa-audiencia-dg` |'],
      instalador: INSTALADOR(['alice-inicial-dg', 'clara-hiscon-dg']),
    })
    const r = rodar(m)
    expect(r.codigo).toBe(0)
    expect(r.json.instalador.lido).toBe(true)
    expect(r.json.semLinhaNoInstalador).toEqual(['teresa-audiencia-dg'])
    expect(r.json.sobrandoNoInstalador).toEqual(['clara-hiscon-dg'])
  })

  it('instalador fora do formato: pula a conferência do mapa e diz por quê', () => {
    const m = montar({ instalados: ['alice-inicial-dg'], tabela: ['| Inicial | `alice-inicial-dg` |'], instalador: '$trazer = Get-Mapa' })
    const r = rodar(m)
    expect(r.codigo).toBe(0)
    expect(r.json.instalador).toMatchObject({ lido: false })
    expect(r.json.semLinhaNoInstalador).toBeNull()
  })

  it('sem a pasta agentes/ no repositório: o kit é o que está instalado; fonte não instalada vira aviso', () => {
    const sem = montar({ instalados: ['alice-inicial-dg'], tabela: ['| Inicial | `alice-inicial-dg` |'] })
    expect(rodar(sem).json.fonte).toEqual({ 'agentes/bancario': false, 'agentes/geral': false })
    const novo = montar({ instalados: ['alice-inicial-dg'], bancario: ['alice-inicial-dg', 'novo-dg'], tabela: ['| Inicial | `alice-inicial-dg` |', '| Novo | `novo-dg` |'] })
    const r = rodar(novo)
    expect(r.codigo).toBe(1)
    expect(r.json.fonteSemInstalar.map((x: { nome: string }) => x.nome)).toEqual(['novo-dg'])
    expect(r.json.naoInstalados.map((x: { nome: string }) => x.nome)).toEqual(['novo-dg'])
  })

  it('orquestrador sem a tabela ou opção errada: sai com 2', () => {
    const m = montar({ instalados: [], tabela: [] })
    writeFileSync(m.tabela, '# sem tabela')
    expect(rodar(m).codigo).toBe(2)
    expect(spawnSync(process.execPath, [script, '--nada'], { encoding: 'utf8' }).status).toBe(2)
  })
})
