import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

export const VERSAO = '1.0.0'

/**
 * Configuração do executor. Ordem: variáveis de ambiente, depois o arquivo
 * %APPDATA%\DGBrasil\executor.json (Windows) ou ~/.config/dg-brasil/executor.json.
 *
 * O token NÃO vai na configuração do Claude Code (~/.claude.json): fica neste
 * arquivo, fora das pastas de trabalho. O guia de instalação manda negar a
 * leitura dele ao Claude Code (regra deny).
 */

export interface Config {
  /** Endereço do DG Brasil, ex.: https://dgbrasil.exemplo.com.br */
  url: string
  token: string
  /** Pasta das pastas de trabalho (uma por trabalho, apagada ao terminar). */
  pastaTrabalhos: string
  versaoCliente: string
  arquivoConfig: string
}

const Arquivo = z.object({
  url: z.string().optional(),
  token: z.string().optional(),
  pasta_trabalhos: z.string().optional(),
}).strict()

export function caminhoConfig(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DG_EXECUTOR_CONFIG) return env.DG_EXECUTOR_CONFIG
  if (process.platform === 'win32' && env.APPDATA) return join(env.APPDATA, 'DGBrasil', 'executor.json')
  return join(homedir(), '.config', 'dg-brasil', 'executor.json')
}

export function pastaTrabalhosPadrao(env: NodeJS.ProcessEnv = process.env): string {
  if (process.platform === 'win32' && env.LOCALAPPDATA) return join(env.LOCALAPPDATA, 'DGBrasil', 'trabalhos')
  return join(homedir(), '.dg-brasil', 'trabalhos')
}

export class ErroConfig extends Error {}

export async function lerConfig(env: NodeJS.ProcessEnv = process.env): Promise<Config> {
  const arquivoConfig = caminhoConfig(env)
  let doArquivo: z.infer<typeof Arquivo> = {}
  try {
    doArquivo = Arquivo.parse(JSON.parse(await readFile(arquivoConfig, 'utf8')))
  } catch (e) {
    const ausente = (e as NodeJS.ErrnoException)?.code === 'ENOENT'
    if (!ausente) throw new ErroConfig(`Arquivo de configuração inválido (${arquivoConfig}): ${e instanceof Error ? e.message : e}`)
  }

  const url = (env.DG_EXECUTOR_URL ?? doArquivo.url ?? '').trim().replace(/\/+$/, '')
  const token = (env.DG_EXECUTOR_TOKEN ?? doArquivo.token ?? '').trim()
  if (!url) throw new ErroConfig(`Falta o endereço do DG Brasil ("url" em ${arquivoConfig} ou DG_EXECUTOR_URL).`)
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new ErroConfig('Endereço do DG Brasil inválido.')
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) {
    throw new ErroConfig('O endereço do DG Brasil precisa ser https:// (http só para localhost).')
  }
  if (!/^dgx_[A-Za-z0-9_-]{20,100}$/.test(token)) {
    throw new ErroConfig(`Falta o token do computador, ou ele está em formato inválido ("token" em ${arquivoConfig}). Gere em DG Brasil → Configurações → Computador do escritório.`)
  }
  return {
    url,
    token,
    pastaTrabalhos: env.DG_EXECUTOR_WORKDIR ?? doArquivo.pasta_trabalhos ?? pastaTrabalhosPadrao(env),
    versaoCliente: `dg-executor/${VERSAO}`,
    arquivoConfig,
  }
}
