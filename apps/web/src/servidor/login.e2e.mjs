// Teste de ponta a ponta do login, contra o servidor de desenvolvimento.
//
//   npm run dev            (noutro terminal)
//   node src/servidor/login.e2e.mjs [porta]
//
// Usa o caminho sem JavaScript do formulário — o mesmo que um navegador com JS
// desligado percorreria. Isso testa a server action de verdade, incluindo o
// cookie e a RLS por trás das telas.

const PORTA = process.argv[2] ?? '3000'
const BASE = `http://localhost:${PORTA}`

let falhas = 0
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const erro = (m) => {
  falhas++
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
}

/** Extrai os campos ocultos que o Next põe no form para o caminho sem JS. */
function camposOcultos(html) {
  const campos = {}
  for (const m of html.matchAll(
    /<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?/g,
  )) {
    campos[m[1]] = (m[2] ?? '').replaceAll('&quot;', '"').replaceAll('&amp;', '&')
  }
  return campos
}

async function tentarLogin(email, senha) {
  const pagina = await fetch(`${BASE}/entrar`)
  const html = await pagina.text()
  const corpo = new FormData()
  for (const [k, v] of Object.entries(camposOcultos(html))) corpo.append(k, v)
  corpo.append('email', email)
  corpo.append('senha', senha)

  const r = await fetch(`${BASE}/entrar`, {
    method: 'POST',
    body: corpo,
    redirect: 'manual',
  })
  const cookie = (r.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith('dgb_sessao='))
  return { status: r.status, cookie, texto: await r.text() }
}

const pegar = (rota, cookie) =>
  fetch(`${BASE}${rota}`, {
    headers: cookie ? { cookie } : {},
    redirect: 'manual',
  })

console.log('\nLogin com senha errada')
{
  const r = await tentarLogin('barbara@exemplo.adv.br', 'senha errada mesmo')
  if (!r.cookie) ok('nenhum cookie de sessão é emitido')
  else erro('senha errada devolveu cookie de sessão')
  if (r.texto.includes('E-mail ou senha incorretos'))
    ok('mensagem não revela se o e-mail existe')
  else erro('mensagem de erro inesperada')
}

console.log('\nLogin com e-mail inexistente')
{
  const r = await tentarLogin('ninguem@exemplo.adv.br', 'qualquer coisa aqui')
  if (r.texto.includes('E-mail ou senha incorretos'))
    ok('mesma mensagem do caso anterior — não dá para enumerar a equipe')
  else erro('mensagem diferente entregou que o e-mail não existe')
}

console.log('\nLogin da administradora')
let cookieAdmin
{
  const r = await tentarLogin('barbara@exemplo.adv.br', 'demo')
  cookieAdmin = r.cookie
  if (cookieAdmin) ok('cookie de sessão emitido')
  else erro('login correto não emitiu cookie')

  if (cookieAdmin && !cookieAdmin.includes('demo'))
    ok('o cookie não carrega a senha nem o e-mail')
  else if (cookieAdmin) erro('o cookie vazou credencial')
}

console.log('\nO que a administradora enxerga')
if (cookieAdmin) {
  const hoje = await (await pegar('/', cookieAdmin)).text()
  if (hoje.includes('Barbara')) ok('a tela Hoje a cumprimenta pelo nome')
  else erro('a tela Hoje não reconheceu a sessão')

  const contatos = await (await pegar('/contatos', cookieAdmin)).text()
  const nomes = ['Maria das Dores', 'João Batista', 'Cibélia Ramos'].filter((n) =>
    contatos.includes(n),
  )
  if (nomes.length === 3) ok(`enxerga os 3 contatos`)
  else erro(`deveria ver 3 contatos, viu ${nomes.length}`)

  const equipe = await pegar('/equipe', cookieAdmin)
  if (equipe.status === 200) ok('abre a tela de Equipe')
  else erro(`Equipe devolveu ${equipe.status} para a administradora`)
}

console.log('\nLogin da estagiária')
let cookieEstag
{
  const r = await tentarLogin('renata@exemplo.adv.br', 'demo')
  cookieEstag = r.cookie
  if (cookieEstag) ok('cookie de sessão emitido')
  else erro('login correto não emitiu cookie')
}

console.log('\nO que a estagiária NÃO enxerga')
if (cookieEstag) {
  const equipe = await pegar('/equipe', cookieEstag)
  if (equipe.status === 307 || equipe.status === 302)
    ok('a tela de Equipe a manda embora')
  else erro(`Equipe devolveu ${equipe.status} para a estagiária`)

  // A prova de que a RLS chega na tela: a administradora responde pelos dois
  // casos com processo; a estagiária, por um caso sem processo. A agenda dela
  // tem de vir vazia — e vem do banco, não de um `if` no componente.
  const hoje = await (await pegar('/', cookieEstag)).text()
  if (hoje.includes('Nenhum prazo em aberto'))
    ok('a agenda dela vem vazia — não enxerga prazo de caso alheio')
  else erro('a estagiária enxergou prazo que não é dela')
  if (!hoje.includes('0801234-56.2026.8.05.0001'))
    ok('o processo da outra cliente não aparece para ela')
  else erro('vazou o número do processo de um caso alheio')

  const aprovacoes = await (await pegar('/aprovacoes', cookieEstag)).text()
  if (aprovacoes.includes('quem aprova é advogado'))
    ok('vê a fila de aprovação, mas o aviso diz que não carimba')
  else erro('o aviso de quem aprova não apareceu')
  if (!aprovacoes.includes('>Aprovar<'))
    ok('os botões de aprovar não são renderizados para ela')
  else erro('botão de aprovar apareceu para a estagiária')
}

console.log('\nSessão inválida')
{
  const r = await pegar('/', 'dgb_sessao=token_inventado_que_nao_existe')
  if (r.status === 307 || r.status === 302) ok('cookie forjado manda para o login')
  else erro(`cookie forjado devolveu ${r.status}`)
}

console.log(
  falhas === 0
    ? '\n\x1b[32mLogin de pé.\x1b[0m Todos os testes passaram.\n'
    : `\n\x1b[31m${falhas} falha(s).\x1b[0m\n`,
)
process.exit(falhas === 0 ? 0 : 1)
