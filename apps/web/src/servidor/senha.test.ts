// Testes do módulo de senha. Node 24 executa .ts direto:
//
//   npm test
//
// Criptografia sem teste é um mau negócio — especialmente a que guarda o acesso
// a dados de clientes idosos.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { conferirSenha, criticarSenha, hashSenha } from './senha.ts'

test('senha correta é aceita', () => {
  const h = hashSenha('uma frase que só eu sei')
  assert.equal(conferirSenha('uma frase que só eu sei', h), true)
})

test('senha errada é recusada', () => {
  const h = hashSenha('uma frase que só eu sei')
  assert.equal(conferirSenha('uma frase que só eu se', h), false)
  assert.equal(conferirSenha('', h), false)
})

test('o mesmo texto gera hashes diferentes — o sal é aleatório', () => {
  const a = hashSenha('mesma senha')
  const b = hashSenha('mesma senha')
  assert.notEqual(a, b, 'sem sal, senhas iguais teriam hash igual no banco')
  assert.equal(conferirSenha('mesma senha', a), true)
  assert.equal(conferirSenha('mesma senha', b), true)
})

test('a senha em claro nunca aparece no que é guardado', () => {
  const h = hashSenha('batata frita com alecrim')
  assert.ok(!h.includes('batata'))
  assert.ok(h.startsWith('scrypt$'))
})

test('hash corrompido ou ausente não derruba o login', () => {
  assert.equal(conferirSenha('x', null), false)
  assert.equal(conferirSenha('x', ''), false)
  assert.equal(conferirSenha('x', 'lixo'), false)
  assert.equal(conferirSenha('x', 'md5$1$2$3$4$5'), false)
  assert.equal(conferirSenha('x', 'scrypt$curto'), false)
})

test('acentuação normalizada: é digitado de dois jeitos entra igual', () => {
  // "José" com e-agudo composto vs. decomposto. Sem NFKC, o mesmo nome digitado
  // num Mac e num Windows daria senhas diferentes.
  const composto = 'José 1948 pensão'
  const decomposto = 'José 1948 pensão'
  assert.notEqual(composto, decomposto)
  assert.equal(conferirSenha(decomposto, hashSenha(composto)), true)
})

test('crítica de senha rejeita o que é fácil de adivinhar', () => {
  assert.ok(criticarSenha('curta'))
  assert.ok(criticarSenha('senha123456'))
  assert.ok(criticarSenha('DGBrasil2026'))
  assert.ok(criticarSenha('x'.repeat(201)))
})

test('crítica de senha aceita uma frase comum e longa', () => {
  assert.equal(criticarSenha('meu cachorro chama pretinho'), null)
  assert.equal(criticarSenha('almoço de domingo na casa da vó'), null)
})

test('sequência de dígitos é recusada', () => {
  // '0123456789' tem exatamente 10 caracteres e passaria pelo tamanho mínimo.
  assert.ok(criticarSenha('0123456789'))
})
