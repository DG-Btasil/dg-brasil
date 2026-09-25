import Link from 'next/link'

export function Titulo({ children, acima }: { children: React.ReactNode; acima?: string }) {
  return (
    <div className="mb-6">
      {acima && (
        <p className="mb-1 text-xs tracking-wide text-suave uppercase">{acima}</p>
      )}
      <h1 className="text-2xl font-semibold tracking-tight">{children}</h1>
    </div>
  )
}

export function Secao({
  titulo,
  contador,
  children,
}: {
  titulo: string
  contador?: number
  children: React.ReactNode
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 flex items-baseline gap-2 text-sm font-semibold">
        {titulo}
        {contador !== undefined && (
          <span className="tabular text-xs font-normal text-suave">{contador}</span>
        )}
      </h2>
      {children}
    </section>
  )
}

export function Cartao({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-borda bg-superficie">
      {children}
    </div>
  )
}

export function Vazio({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-borda px-4 py-8 text-center text-sm text-suave">
      {children}
    </div>
  )
}

const TONS = {
  urgente: 'bg-urgente-fraco text-urgente',
  atencao: 'bg-atencao-fraco text-atencao',
  calmo: 'bg-calmo-fraco text-calmo',
  neutro: 'bg-realce-fraco text-realce',
} as const

export function Etiqueta({
  tom = 'neutro',
  children,
}: {
  tom?: keyof typeof TONS
  children: React.ReactNode
}) {
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[11px] leading-tight font-medium whitespace-nowrap ${TONS[tom]}`}
    >
      {children}
    </span>
  )
}

/** Quanto falta, em palavras. É assim que a equipe pensa em prazo. */
export function prazoEmPalavras(dias: number): { texto: string; tom: keyof typeof TONS } {
  if (dias < 0) return { texto: `vencido há ${-dias}d`, tom: 'urgente' }
  if (dias === 0) return { texto: 'vence hoje', tom: 'urgente' }
  if (dias === 1) return { texto: 'vence amanhã', tom: 'urgente' }
  if (dias <= 5) return { texto: `${dias} dias`, tom: 'atencao' }
  return { texto: `${dias} dias`, tom: 'calmo' }
}

export function LinhaCliente({ id, nome }: { id: string; nome: string }) {
  return (
    <Link href={`/contatos/${id}`} className="hover:text-realce hover:underline">
      {nome}
    </Link>
  )
}

export function dataBr(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function cpfBr(v: string | null): string {
  if (!v) return '—'
  if (v.length === 11) return `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6, 9)}-${v.slice(9)}`
  if (v.length === 14)
    return `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8, 12)}-${v.slice(12)}`
  return v
}

export function moedaBr(valor: string | number | null): string {
  if (valor === null || valor === '') return '—'
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export const STATUS_CASO: Record<string, string> = {
  triagem: 'Triagem',
  analise: 'Análise',
  aguardando_documento: 'Aguardando documento',
  pronto_para_peticionar: 'Pronto para peticionar',
  judicializado: 'Judicializado',
  encerrado: 'Encerrado',
  recusado: 'Recusado',
}
