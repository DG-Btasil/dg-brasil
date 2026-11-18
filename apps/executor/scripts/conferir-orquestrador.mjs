// Confere se a tabela do orquestrador do DG Brasil está igual ao kit de agentes instalado.
//
//   node apps/executor/scripts/conferir-orquestrador.mjs [orquestrador.md] [--json]
//        [--agentes <pasta>] [--repo <pasta>] [--instalador <arquivo.ps1>]
//
// Padrões: orquestrador.md = docs/mcp/pilotos/agentes/orquestrador.md (relativo à raiz do repositório);
// --agentes = %USERPROFILE%\.claude\agents; --repo = a raiz deste repositório (de onde saem
// agentes/bancario e agentes/geral, se existirem); --instalador = apps/executor/scripts/instalar-agentes-bancario.ps1.
//
// Aponta:
//   (a) agente do kit (*-dg.md, pelo name: do cabeçalho) que não aparece na tabela do orquestrador;
//   (b) agente citado na tabela (ou, com sufixo -dg, nas regras abaixo dela) que não está instalado;
//   (c) agente da ponte (agentes/bancario) sem linha própria no mapa $trazer do instalador.
// Sai com código 1 se houver (a) ou (b); (c) e os demais são só aviso. Código 2: erro de uso ou arquivo faltando.
// Só lê arquivos: não grava nada.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Fora da tabela de propósito: os da ponte, a Diana de prazos (chamada direto pela integração judicial),
// os de teste e o próprio orquestrador.
const EXCECOES = ['porteiro-dg', 'arquivista-dg', 'mensageiro-dg', 'intimacao-dg', 'analista-teste', 'kit-cliente-teste', 'orquestrador-teste', 'orquestrador']
const CABECALHO = /^\|\s*A tarefa ou o despacho pede\s*\|\s*Agente\s*\|/
const NOME_DG = /^[a-z0-9]+(?:-[a-z0-9]+)*-dg$/

const raizDoRepo = fileURLToPath(new URL('../../../', import.meta.url))

function argumentos(lista) {
  const a = { tabela: null, json: false, agentes: join(homedir(), '.claude', 'agents'), repo: raizDoRepo, instalador: null }
  for (let i = 0; i < lista.length; i++) {
    const x = lista[i]
    const valor = () => {
      const v = lista[++i]
      if (!v || v.startsWith('--')) throw new Error(`${x} precisa de um valor`)
      return v
    }
    if (x === '--json') a.json = true
    else if (x === '--agentes') a.agentes = valor()
    else if (x === '--repo') a.repo = valor()
    else if (x === '--instalador') a.instalador = valor()
    else if (x === '--help' || x === '-h') a.ajuda = true
    else if (x.startsWith('--')) throw new Error(`opção desconhecida: ${x}`)
    else if (a.tabela) throw new Error(`só um orquestrador por vez (veio ${a.tabela} e ${x})`)
    else a.tabela = x
  }
  a.repo = resolve(a.repo)
  a.tabela = a.tabela ? resolve(a.tabela) : join(a.repo, 'docs', 'mcp', 'pilotos', 'agentes', 'orquestrador.md')
  a.instalador = a.instalador ? resolve(a.instalador) : join(a.repo, 'apps', 'executor', 'scripts', 'instalar-agentes-bancario.ps1')
  return a
}

const linhas = (texto) => texto.replace(/^﻿/, '').split(/\r?\n/)

/** O name: do cabeçalho (frontmatter) de um agente, ou null. */
function nomeDoAgente(texto) {
  const l = linhas(texto)
  if (l[0]?.trim() !== '---') return null
  for (let i = 1; i < l.length && l[i].trim() !== '---'; i++) {
    const m = /^name:\s*["']?([^"'\s]+)["']?\s*$/.exec(l[i])
    if (m) return m[1]
  }
  return null
}

/** Agentes de uma pasta: [{ nome, arquivo }]. Com soDg, só os arquivos terminados em -dg.md (nunca os .bak). */
function agentesDaPasta(pasta, soDg) {
  if (!existsSync(pasta)) return null
  const r = []
  for (const f of readdirSync(pasta).sort()) {
    if (!f.endsWith('.md') || (soDg && !f.endsWith('-dg.md'))) continue
    let texto
    try { texto = readFileSync(join(pasta, f), 'utf8') } catch { continue }
    const nome = nomeDoAgente(texto)
    if (nome) r.push({ nome, arquivo: f })
  }
  return r
}

/** Agentes citados na tabela "| A tarefa ou o despacho pede | Agente |" e, com sufixo -dg, no resto do arquivo. */
function citadosNoOrquestrador(texto) {
  const l = linhas(texto)
  const inicio = l.findIndex((x) => CABECALHO.test(x))
  if (inicio < 0) return null
  const citados = []
  let fim = inicio + 1
  for (let i = inicio + 1; i < l.length && l[i].trim().startsWith('|'); i++, fim = i) {
    const celulas = l[i].trim().replace(/^\||\|$/g, '').split('|')
    const agente = celulas[celulas.length - 1] ?? ''
    if (/^\s*:?-{3,}/.test(agente)) continue
    for (const m of agente.matchAll(/`([^`]+)`/g)) {
      const nome = m[1].trim()
      if (nome !== 'nenhum') citados.push({ nome, linha: i + 1, onde: 'tabela' })
    }
  }
  for (let i = 0; i < l.length; i++) {
    if (i >= inicio && i < fim) continue
    for (const m of l[i].matchAll(/`([^`]+)`/g)) {
      const nome = m[1].trim()
      if (NOME_DG.test(nome)) citados.push({ nome, linha: i + 1, onde: 'regras' })
    }
  }
  return citados
}

/** Chaves do mapa $trazer = @{ ... } do instalador, ou { motivo } quando não dá para ler com segurança. */
function mapaDoInstalador(caminho) {
  if (!existsSync(caminho)) return { motivo: `não achei o instalador (${caminho})` }
  const l = linhas(readFileSync(caminho, 'utf8'))
  const inicio = l.findIndex((x) => /^\s*\$trazer\s*=\s*@\{\s*$/.test(x))
  if (inicio < 0) return { motivo: 'não achei a linha "$trazer = @{" no instalador' }
  const chaves = []
  for (let i = inicio + 1; i < l.length; i++) {
    const x = l[i].trim()
    if (x === '}') return { chaves }
    if (!x || x.startsWith('#')) continue
    const m = /^'([^']+)'\s*=/.exec(x)
    if (!m) return { motivo: `linha ${i + 1} do mapa $trazer fora do formato 'nome' = @(...)` }
    chaves.push(m[1])
  }
  return { motivo: 'o mapa $trazer do instalador não fecha' }
}

function conferir(a) {
  if (!existsSync(a.tabela)) throw new Error(`não achei o orquestrador em ${a.tabela}`)
  const citados = citadosNoOrquestrador(readFileSync(a.tabela, 'utf8'))
  if (!citados) throw new Error(`${a.tabela} não tem a tabela "| A tarefa ou o despacho pede | Agente |"`)

  const instalados = agentesDaPasta(a.agentes, false)
  if (!instalados) throw new Error(`não achei a pasta dos agentes instalados (${a.agentes})`)
  const bancario = agentesDaPasta(join(a.repo, 'agentes', 'bancario'), true)
  const geral = agentesDaPasta(join(a.repo, 'agentes', 'geral'), true)

  // O kit: todo *-dg.md instalado e, se a fonte existir, os de agentes/bancario e agentes/geral.
  const kit = new Map()
  const marcar = (lista, onde) => { for (const x of lista ?? []) (kit.get(x.nome) ?? kit.set(x.nome, []).get(x.nome)).push(onde) }
  marcar(instalados.filter((x) => x.arquivo.endsWith('-dg.md')), 'instalado')
  marcar(bancario, 'agentes/bancario')
  marcar(geral, 'agentes/geral')
  const nomesInstalados = new Set(instalados.map((x) => x.nome))
  const naTabela = new Set(citados.filter((c) => c.onde === 'tabela').map((c) => c.nome))

  const foraDaTabela = [...kit].filter(([n]) => !EXCECOES.includes(n) && !naTabela.has(n)).map(([nome, onde]) => ({ nome, onde }))
  const vistos = new Set()
  const naoInstalados = citados.filter((c) => !nomesInstalados.has(c.nome) && !vistos.has(`${c.onde}:${c.nome}`) && vistos.add(`${c.onde}:${c.nome}`))
  const fonteSemInstalar = [...kit].filter(([n, onde]) => !onde.includes('instalado')).map(([nome, onde]) => ({ nome, onde }))

  // (c) Só os agentes de agentes/bancario passam pela ponte; sem a fonte, vale o *-dg.md instalado que não é de agentes/geral.
  const mapa = mapaDoInstalador(a.instalador)
  let semLinhaNoInstalador = null
  let sobrandoNoInstalador = null
  if (mapa.chaves) {
    const gerais = new Set((geral ?? []).map((x) => x.nome))
    const daPonte = bancario ? bancario.map((x) => x.nome) : [...kit.keys()].filter((n) => !gerais.has(n))
    const ponte = [...new Set(daPonte)].filter((n) => !EXCECOES.includes(n))
    semLinhaNoInstalador = ponte.filter((n) => !mapa.chaves.includes(n))
    sobrandoNoInstalador = mapa.chaves.filter((n) => !kit.has(n))
  }

  return {
    ok: foraDaTabela.length === 0 && naoInstalados.length === 0,
    orquestrador: a.tabela,
    pastaDosAgentes: a.agentes,
    fonte: { 'agentes/bancario': bancario !== null, 'agentes/geral': geral !== null },
    kit: [...kit].map(([nome, onde]) => ({ nome, onde })),
    citados,
    foraDaTabela,
    naoInstalados,
    fonteSemInstalar,
    instalador: mapa.chaves ? { lido: true, caminho: a.instalador } : { lido: false, caminho: a.instalador, motivo: mapa.motivo },
    semLinhaNoInstalador,
    sobrandoNoInstalador,
  }
}

function relatorio(r, repo) {
  const rel = (p) => { const x = relative(repo, p); return x && !x.startsWith('..') ? x.replace(/\\/g, '/') : p }
  const out = []
  out.push(`Conferência do orquestrador: ${rel(r.orquestrador)}`)
  const fonte = Object.entries(r.fonte).filter(([, tem]) => tem).map(([p]) => p)
  out.push(`  Kit: ${r.kit.length} agentes (instalados em ${r.pastaDosAgentes}${fonte.length ? `; fonte em ${fonte.join(' e ')}` : '; sem a pasta agentes/ neste repositório'})`)
  out.push(`  Tabela: ${new Set(r.citados.filter((c) => c.onde === 'tabela').map((c) => c.nome)).size} agentes citados`)
  out.push('')
  if (r.foraDaTabela.length) {
    out.push('ERRO  Agente do kit que não está na tabela do orquestrador (o orquestrador nunca vai indicá-lo):')
    for (const x of r.foraDaTabela) out.push(`  - ${x.nome}  (${x.onde.join(', ')})`)
  }
  if (r.naoInstalados.length) {
    out.push('ERRO  Agente citado no orquestrador que não está instalado:')
    for (const x of r.naoInstalados) out.push(`  - ${x.nome}  (${x.onde}, linha ${x.linha})`)
  }
  if (r.fonteSemInstalar.length) {
    out.push('AVISO Agente na fonte do repositório que ainda não foi instalado (rode o instalador):')
    for (const x of r.fonteSemInstalar) out.push(`  - ${x.nome}  (${x.onde.join(', ')})`)
  }
  if (!r.instalador.lido) {
    out.push(`AVISO Não conferi o mapa do instalador: ${r.instalador.motivo}.`)
  } else {
    if (r.semLinhaNoInstalador.length) {
      out.push('AVISO Agente da ponte sem linha própria no mapa $trazer do instalador. A ponte traz dele só o padrão de minuta')
      out.push('      (MINUTA_*.docx e .pdf, Memoria_Calculo_*.xlsx, FICHA_REVISAO_*.md); se ele entrega outro arquivo, precisa de linha própria:')
      out.push(`      ${r.semLinhaNoInstalador.join(', ')}`)
    }
    if (r.sobrandoNoInstalador.length) {
      out.push('AVISO Linha no mapa $trazer do instalador para agente que não está no kit:')
      for (const n of r.sobrandoNoInstalador) out.push(`  - ${n}`)
    }
  }
  if (out[out.length - 1] !== '') out.push('')
  const n = r.foraDaTabela.length + r.naoInstalados.length
  out.push(r.ok ? 'OK    A tabela do orquestrador está igual ao kit.' : `Resultado: ${n} ${n === 1 ? 'problema' : 'problemas'} entre a tabela do orquestrador e o kit.`)
  return out.join('\n')
}

let a
try {
  a = argumentos(process.argv.slice(2))
} catch (e) {
  console.log(`Erro: ${e.message}. Use --help para ver as opções.`)
  process.exit(2)
}
if (a.ajuda) {
  const l = linhas(readFileSync(fileURLToPath(import.meta.url), 'utf8'))
  console.log(l.slice(0, l.findIndex((x) => !x.startsWith('//'))).map((x) => x.replace(/^\/\/ ?/, '')).join('\n'))
  process.exit(0)
}
let r
try {
  r = conferir(a)
} catch (e) {
  if (a.json) console.log(JSON.stringify({ ok: false, erro: e.message }, null, 2))
  else console.log(`Erro: ${e.message}.`)
  process.exit(2)
}
console.log(a.json ? JSON.stringify(r, null, 2) : relatorio(r, a.repo))
process.exit(r.ok ? 0 : 1)
