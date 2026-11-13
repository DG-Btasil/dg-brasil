// Trava dos scripts que ESCREVEM no Supabase de desenvolvimento (cenários de
// teste, usuários de QA, limpeza de contas, testes de integração).
//
// Antes bastava DG_ENV=development, que fica no MESMO arquivo das chaves: quem
// trocasse as chaves pelas de produção e esquecesse (ou copiasse) essa linha
// rodava o script contra dados reais. Agora são duas travas, e a segunda não
// depende de quem escreveu o arquivo das chaves:
//
//   1. DG_ENV=development;
//   2. DG_DEV_PROJECT_REF = o identificador do projeto Supabase de
//      DESENVOLVIMENTO (as letras do endereço https://<identificador>.supabase.co),
//      e TODO endereço que o script vai usar (API e banco) tem de ser desse
//      mesmo projeto. Sem a variável, com endereço de outro projeto ou com
//      endereço que não dá para reconhecer: o script recusa.
//
// O identificador não é segredo. O de produção nunca deve ser posto aqui.

/** Identificador do projeto num endereço do Supabase (API, banco direto ou pooler); null se não reconhecer. */
export function refDoProjeto(endereco) {
  if (typeof endereco !== 'string' || !endereco.trim()) return null
  let u
  try { u = new URL(endereco.trim()) } catch { return null }
  const host = u.hostname.toLowerCase()
  const valido = (ref) => (/^[a-z0-9]{15,30}$/.test(ref ?? '') ? ref : null)
  // https://<ref>.supabase.co  |  postgresql://…@db.<ref>.supabase.co:5432/postgres
  if (host.endsWith('.supabase.co')) {
    const partes = host.slice(0, -'.supabase.co'.length).split('.')
    if (partes.length === 1) return valido(partes[0])
    if (partes.length === 2 && partes[0] === 'db') return valido(partes[1])
    return null
  }
  // Pooler: postgresql://postgres.<ref>:…@aws-…pooler.supabase.com:6543/postgres (ou dg_worker.<ref>)
  if (host.endsWith('.pooler.supabase.com')) {
    const usuario = decodeURIComponent(u.username)
    const ponto = usuario.lastIndexOf('.')
    return ponto > 0 ? valido(usuario.slice(ponto + 1).toLowerCase()) : null
  }
  return null
}

/**
 * Confere as duas travas. `chaves` = nomes das variáveis de endereço que o
 * script usa; as obrigatórias têm de existir, as opcionais são conferidas se
 * existirem. Devolve { ok: true, ref } ou { ok: false, motivo }.
 */
export function conferirProjetoDev(env, { obrigatorias = [], opcionais = [] } = {}) {
  if (env.DG_ENV !== 'development') {
    return { ok: false, motivo: 'DG_ENV precisa ser "development". Este script nunca roda em produção.' }
  }
  const esperado = (env.DG_DEV_PROJECT_REF ?? '').trim().toLowerCase()
  if (!esperado) {
    return { ok: false, motivo: 'falta DG_DEV_PROJECT_REF: o identificador do projeto Supabase de DESENVOLVIMENTO (as letras do endereço https://<identificador>.supabase.co). Sem ele o script não roda.' }
  }
  if (!/^[a-z0-9]{15,30}$/.test(esperado)) {
    return { ok: false, motivo: 'DG_DEV_PROJECT_REF não parece um identificador de projeto do Supabase (só letras minúsculas e números).' }
  }
  if (obrigatorias.length === 0) return { ok: false, motivo: 'nenhum endereço para conferir.' }
  for (const chave of [...obrigatorias, ...opcionais]) {
    const valor = env[chave]
    if (!valor) {
      if (obrigatorias.includes(chave)) return { ok: false, motivo: `variável ausente: ${chave}` }
      continue
    }
    const ref = refDoProjeto(valor)
    if (!ref) return { ok: false, motivo: `${chave} não é um endereço do Supabase que dê para reconhecer. Por segurança, o script não roda.` }
    if (ref !== esperado) return { ok: false, motivo: `${chave} aponta para OUTRO projeto, não para o de desenvolvimento (DG_DEV_PROJECT_REF). Confira se as chaves não são as de produção.` }
  }
  return { ok: true, ref: esperado }
}

/** Para a linha de comando: confere e, se recusar, explica e encerra com código 2. */
export function exigirProjetoDev(env = process.env, chaves = {}) {
  const r = conferirProjetoDev(env, chaves)
  if (!r.ok) {
    console.error(`Recusado: ${r.motivo}`)
    process.exit(2)
  }
  return r.ref
}
