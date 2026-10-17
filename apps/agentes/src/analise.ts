import { z } from 'zod'

/**
 * Contrato do resultado estruturado de uma análise (schema_version 1).
 * O mesmo formato vai para legal_analysis_results.result e para
 * legal_analyses.result_data (lido pela tela). Nunca raciocínio interno:
 * só a síntese que um advogado revisa.
 *
 * Dois níveis de validação: o provedor valida pelo JSON Schema estrito
 * (structured outputs) e o worker revalida com zod — inclusive regras que o
 * JSON Schema não expressa (referência citada precisa ter sido consultada).
 */
export const VERSAO_RESULTADO = 1

const texto = (max: number) => z.string().trim().min(1).max(max)

export const ResultadoAnalise = z.object({
  summary: texto(4000),
  recommendation: texto(4000),
  findings: z.array(z.object({
    title: texto(300),
    detail: texto(4000),
    relevance: z.enum(['HIGH', 'MEDIUM', 'LOW']),
    document_version_ids: z.array(z.string().uuid()).max(50),
  })).max(50),
  missing_information: z.array(texto(1000)).max(50),
  recommendations: z.array(texto(2000)).max(50),
  proposed_actions: z.array(z.object({
    description: texto(2000),
    proposal_type: z.enum(['CREATE_DEADLINE', 'REQUEST_DOCUMENT', 'UPDATE_CASE', 'CREATE_PROCESS', 'OTHER']).nullable(),
  })).max(30),
  references_used: z.array(z.object({
    reference_id: z.string().uuid(),
    title: texto(300),
    how_used: texto(1000),
  })).max(50),
  theses_considered: z.array(z.object({
    thesis_id: z.string().uuid(),
    applicable: z.boolean(),
    rationale: texto(2000),
  })).max(50),
})
export type ResultadoAnalise = z.infer<typeof ResultadoAnalise>

const str = (descricao: string) => ({ type: 'string', description: descricao })
const lista = (itens: Record<string, unknown>, descricao: string) => ({ type: 'array', items: itens, description: descricao })
const objeto = (props: Record<string, unknown>) => ({
  type: 'object', additionalProperties: false, properties: props, required: Object.keys(props),
})

/**
 * JSON Schema escrito à mão (e não gerado) para caber nas regras de saída
 * estruturada do provedor: todo objeto fechado, todo campo obrigatório,
 * sem restrição numérica nem de tamanho (essas o zod confere depois).
 */
export const ESQUEMA_RESULTADO_ANALISE = objeto({
  summary: str('Síntese da análise para o advogado revisor, em português, em poucos parágrafos.'),
  recommendation: str('Recomendação principal, em uma ou duas frases.'),
  findings: lista(objeto({
    title: str('Achado, em poucas palavras.'),
    detail: str('O que foi encontrado e onde.'),
    relevance: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
    document_version_ids: lista({ type: 'string', format: 'uuid' }, 'Versões de documento do caso que sustentam o achado.'),
  }), 'Achados relevantes.'),
  missing_information: lista({ type: 'string' }, 'Informações ou documentos que faltam.'),
  recommendations: lista({ type: 'string' }, 'Recomendações complementares.'),
  proposed_actions: lista(objeto({
    description: str('Providência sugerida.'),
    proposal_type: {
      anyOf: [{ type: 'string', enum: ['CREATE_DEADLINE', 'REQUEST_DOCUMENT', 'UPDATE_CASE', 'CREATE_PROCESS', 'OTHER'] }, { type: 'null' }],
      description: 'Se a providência também foi registrada com a ferramenta propor, o tipo; senão null.',
    },
  }), 'Providências sugeridas (as que exigem efeito no sistema também vão por propor).'),
  references_used: lista(objeto({
    reference_id: { type: 'string', format: 'uuid', description: 'Id de uma referência ABERTA nesta execução.' },
    title: str('Título da referência.'),
    how_used: str('Como a referência sustenta a análise.'),
  }), 'Só referências que você realmente abriu nesta execução. Vazio se não usou nenhuma.'),
  theses_considered: lista(objeto({
    thesis_id: { type: 'string', format: 'uuid', description: 'Id de uma tese CONSULTADA nesta execução.' },
    applicable: { type: 'boolean' },
    rationale: str('Por que a tese se aplica ou não, pelos critérios dela.'),
  }), 'Teses consultadas e avaliadas. Vazio se não houve tese.'),
})

/** O que vai para o banco: o resultado + ids das teses aplicáveis (a tela antiga lê esse campo). */
export function paraGravar(r: ResultadoAnalise): Record<string, unknown> {
  return {
    ...r,
    identified_thesis_ids: r.theses_considered.filter((t) => t.applicable).map((t) => t.thesis_id),
  }
}
