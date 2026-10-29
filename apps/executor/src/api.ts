/**
 * Cliente da API do DG Brasil para o computador do escritório
 * (/api/executor/v1). Token do computador em todo pedido; token de reserva
 * nas rotas de um trabalho. Quem decide acesso é o servidor e o banco.
 */

export class ErroApi extends Error {
  constructor(readonly status: number, readonly codigo: string, message: string) {
    super(message)
  }
}

export interface Contexto {
  id: string
  legal_case_id: string | null
  legal_process_id: string | null
  operation: string
  attempt: number
  input: { request_text: string | null; parameters: Record<string, unknown> }
  analysis: null | {
    id: string
    template_name: string
    template_description: string | null
    field_values: Record<string, unknown>
    fields: Array<{ key: string; label: string; type: string; help: string | null }>
    previous: null | { summary: string; review_status: string | null; review_notes: string | null }
  }
  agent: { slug: string; name: string; purpose: string | null; version_number: number; version_id: string; local_agent: string | null; instructions: string }
  lease_seconds: number
  max_attempts: number
}

export interface DocumentoDoCaso {
  document_id: string
  title: string
  category: string
  version_id: string
  version_number: number
  filename: string | null
  mime_type: string | null
  size: number | null
  checksum_sha256: string | null
}

type Metodo = 'GET' | 'POST'

export class DgApi {
  private readonly base: string

  constructor(
    url: string,
    private readonly token: string,
    private readonly versaoCliente: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly tempoLimiteMs = 30_000,
  ) {
    this.base = `${url.replace(/\/+$/, '')}/api/executor/v1`
  }

  private async pedir<T>(metodo: Metodo, caminho: string, opcoes: { reserva?: string; corpo?: unknown; tentativas?: number } = {}): Promise<T> {
    const tentativas = opcoes.tentativas ?? (metodo === 'GET' ? 3 : 1)
    let ultimo: unknown
    for (let i = 0; i < tentativas; i++) {
      try {
        const headers: Record<string, string> = {
          authorization: `Bearer ${this.token}`,
          'x-dg-client': this.versaoCliente,
          accept: 'application/json',
        }
        if (opcoes.reserva) headers['x-dg-lease'] = opcoes.reserva
        if (opcoes.corpo !== undefined) headers['content-type'] = 'application/json'
        const r = await this.fetchFn(`${this.base}/${caminho}`, {
          method: metodo,
          headers,
          body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
          signal: AbortSignal.timeout(this.tempoLimiteMs),
        })
        const texto = await r.text()
        let corpo: unknown = null
        try { corpo = texto ? JSON.parse(texto) : null } catch { corpo = null }
        if (r.ok) return corpo as T
        const erro = (corpo as { error?: { code?: string; message?: string } } | null)?.error
        const e = new ErroApi(r.status, erro?.code ?? 'HTTP', erro?.message ?? `O DG Brasil respondeu ${r.status}.`)
        if (r.status >= 500 && r.status !== 501 && i + 1 < tentativas) { ultimo = e; await espera(500 * (i + 1)); continue }
        throw e
      } catch (e) {
        if (e instanceof ErroApi) throw e
        ultimo = new ErroApi(0, 'NETWORK', 'Sem conexão com o DG Brasil. Confira a internet e tente de novo.')
        if (i + 1 < tentativas) { await espera(500 * (i + 1)); continue }
      }
    }
    throw ultimo
  }

  eu() { return this.pedir<{ executor_id: string; name: string; capabilities: string[]; execution_enabled: boolean }>('GET', 'me') }
  trabalhos(limite = 20) { return this.pedir<{ jobs: Array<Record<string, unknown> & { id: string }> }>('GET', `jobs?limit=${limite}`) }
  reservar(id: string) {
    return this.pedir<{ claimed: true; lease_token: string; attempt: number; context: Contexto } | { claimed: false; reason: string; status: string | null }>(
      'POST', `jobs/${id}/claim`)
  }
  contexto(id: string, reserva: string) { return this.pedir<Contexto>('GET', `jobs/${id}/context`, { reserva }) }
  batimento(id: string, reserva: string, progresso?: string) {
    return this.pedir<{ ok: boolean; status: string | null; cancel_requested: boolean }>('POST', `jobs/${id}/heartbeat`,
      { reserva, corpo: progresso ? { progress: progresso } : {}, tentativas: 2 })
  }
  caso(id: string, reserva: string) { return this.pedir<Record<string, unknown> | null>('GET', `jobs/${id}/case`, { reserva }) }
  processo(id: string, reserva: string, processoId: string) { return this.pedir<Record<string, unknown>>('GET', `jobs/${id}/processes/${processoId}`, { reserva }) }
  documentos(id: string, reserva: string) { return this.pedir<{ documents: DocumentoDoCaso[] }>('GET', `jobs/${id}/documents`, { reserva }) }
  linkDocumento(id: string, reserva: string, versaoId: string) {
    return this.pedir<{ url: string; filename: string; size: number | null; checksum_sha256: string | null; title: string; category: string; version_number: number }>(
      'POST', `jobs/${id}/documents/${versaoId}/download`, { reserva, tentativas: 2 })
  }
  teses(id: string, reserva: string) { return this.pedir<{ theses: Array<Record<string, unknown>> }>('GET', `jobs/${id}/theses`, { reserva }) }
  referencias(id: string, reserva: string) { return this.pedir<{ references: Array<Record<string, unknown>> }>('GET', `jobs/${id}/references`, { reserva }) }
  abrirReferencia(id: string, reserva: string, refId: string) {
    return this.pedir<{ kind: 'text'; title: string; text: string } | { kind: 'file'; title: string; filename: string; url: string }>(
      'POST', `jobs/${id}/references/${refId}/open`, { reserva })
  }
  entregarAnalise(id: string, reserva: string, resultado: unknown) {
    return this.pedir<{ result_id: string; review_id: string; created: boolean }>('POST', `jobs/${id}/analysis`, { reserva, corpo: { result: resultado } })
  }
  propor(id: string, reserva: string, corpo: unknown) {
    return this.pedir<{ proposal_id: string; created: boolean }>('POST', `jobs/${id}/proposals`, { reserva, corpo })
  }
  prepararMinuta(id: string, reserva: string, corpo: { filename: string; mime_type: string; size: number }) {
    return this.pedir<{ document_id: string; document_version_id: string; storage_object_name: string; upload_url: string }>(
      'POST', `jobs/${id}/outputs`, { reserva, corpo })
  }
  finalizarMinuta(id: string, reserva: string, versaoId: string, corpo: unknown) {
    return this.pedir<{ document_version_id: string; version_number: number; created: boolean }>(
      'POST', `jobs/${id}/outputs/${versaoId}/finalize`, { reserva, corpo, tentativas: 2 })
  }
  registrarConfig(id: string, reserva: string, snapshot: unknown) {
    return this.pedir<{ recorded: boolean }>('POST', `jobs/${id}/config`, { reserva, corpo: { snapshot } })
  }
  concluir(id: string, reserva: string, relatorio: Record<string, unknown>) {
    return this.pedir<{ status: string; error_code: string | null }>('POST', `jobs/${id}/complete`, { reserva, corpo: { report: relatorio } })
  }
  falhar(id: string, reserva: string, codigo: string, mensagem: string, tentarDeNovo: boolean) {
    return this.pedir<{ status: string; error_code: string | null }>('POST', `jobs/${id}/fail`,
      { reserva, corpo: { error_code: codigo, message: mensagem, retryable: tentarDeNovo } })
  }
  devolver(id: string, reserva: string) { return this.pedir<{ status: string }>('POST', `jobs/${id}/release`, { reserva }) }
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))
