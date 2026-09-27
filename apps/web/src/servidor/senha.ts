import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/**
 * Senha: derivação, conferência e crítica.
 *
 * Módulo puro de propósito — sem banco, sem `server-only`. É o que permite
 * testá-lo direto (`npm test`), e criptografia sem teste é um mau negócio.
 */

// Parâmetros do scrypt. N=2^15 leva ~100ms numa máquina comum — caro o
// suficiente para força bruta, barato o suficiente para um login.
const N = 32768
const r = 8
const p = 1
const TAM_CHAVE = 32

export function hashSenha(senha: string): string {
  const sal = randomBytes(16)
  const chave = scryptSync(senha.normalize('NFKC'), sal, TAM_CHAVE, { N, r, p, maxmem: 128 * N * r * 2 })
  return `scrypt$${N}$${r}$${p}$${sal.toString('base64')}$${chave.toString('base64')}`
}

export function conferirSenha(senha: string, armazenado: string | null): boolean {
  if (!armazenado) return false
  const partes = armazenado.split('$')
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false

  const [, sN, sr, sp, sal, chave] = partes
  const esperado = Buffer.from(chave!, 'base64')
  const calculado = scryptSync(
    senha.normalize('NFKC'),
    Buffer.from(sal!, 'base64'),
    esperado.length,
    { N: Number(sN), r: Number(sr), p: Number(sp), maxmem: 128 * Number(sN) * Number(sr) * 2 },
  )
  // Comparação em tempo constante: o tempo de resposta não conta quantos bytes
  // bateram.
  return timingSafeEqual(esperado, calculado)
}

/**
 * Regra de senha curta de propósito. Exigir símbolo e maiúscula produz
 * "Senha@123" e um post-it no monitor; comprimento é o que de fato protege.
 */
export function criticarSenha(senha: string): string | null {
  if (senha.length < 10) return 'A senha precisa de pelo menos 10 caracteres.'
  if (senha.length > 200) return 'Senha longa demais.'
  const fracas = ['senha', 'password', '123456', 'advocacia', 'dgbrasil', 'dg brasil']
  const s = senha.toLowerCase()
  if (fracas.some((f) => s.includes(f))) return 'Essa senha é fácil demais de adivinhar.'
  return null
}
