/**
 * Acesso ao Supabase Storage pela API REST, com a service role. Só o servidor
 * (worker) usa isto; o navegador nunca recebe a chave.
 */
export interface Armazenamento {
  enviar(bucket: string, objeto: string, conteudo: Uint8Array, mime: string): Promise<void>
  baixar(bucket: string, objeto: string): Promise<Uint8Array>
}

export function armazenamentoSupabase(url: string, chaveServico: string): Armazenamento {
  const base = `${url.replace(/\/$/, '')}/storage/v1/object`
  const caminho = (bucket: string, objeto: string) =>
    `${base}/${bucket}/${objeto.split('/').map(encodeURIComponent).join('/')}`
  const cabecalhos = { Authorization: `Bearer ${chaveServico}`, apikey: chaveServico }

  return {
    async enviar(bucket, objeto, conteudo, mime) {
      const r = await fetch(caminho(bucket, objeto), {
        method: 'POST',
        // x-upsert false: cada versão tem objeto próprio e nunca é sobrescrita.
        headers: { ...cabecalhos, 'Content-Type': mime, 'x-upsert': 'false' },
        body: conteudo,
      })
      if (!r.ok) throw new Error(`Storage recusou o envio (${r.status}): ${await r.text()}`)
    },
    async baixar(bucket, objeto) {
      const r = await fetch(caminho(bucket, objeto), { headers: cabecalhos })
      if (!r.ok) throw new Error(`Storage recusou o download (${r.status})`)
      return new Uint8Array(await r.arrayBuffer())
    },
  }
}

/** Para testes: guarda os objetos em memória. */
export function armazenamentoEmMemoria(): Armazenamento & { objetos: Map<string, Uint8Array> } {
  const objetos = new Map<string, Uint8Array>()
  return {
    objetos,
    async enviar(bucket, objeto, conteudo) {
      const chave = `${bucket}/${objeto}`
      if (objetos.has(chave)) throw new Error(`objeto já existe: ${chave}`)
      objetos.set(chave, conteudo)
    },
    async baixar(bucket, objeto) {
      const v = objetos.get(`${bucket}/${objeto}`)
      if (!v) throw new Error(`objeto não encontrado: ${bucket}/${objeto}`)
      return v
    },
  }
}
