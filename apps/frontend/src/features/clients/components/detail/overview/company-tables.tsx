"use client";

import { Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { formatPercent, maskCPF, maskDocument } from "@/lib/formatting";
import type { CompanyClient } from "@/types";
import { Block } from "./overview-blocks";

export function RepresentativesBlock({ client }: { client: CompanyClient }) {
  return (
    <Block title="Representantes legais" clientId={client.id}>
      {client.representatives.length === 0 ? (
        <p className="text-[13px] text-muted">Nenhum representante informado.</p>
      ) : (
        <div className="-mx-5 -my-4">
          <Table caption="Representantes legais">
            <THead>
              <tr>
                <Th>Nome</Th>
                <Th>CPF</Th>
                <Th>Cargo</Th>
                <Th>Contato</Th>
              </tr>
            </THead>
            <TBody>
              {client.representatives.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <span className="inline-flex items-center gap-2">
                      {r.name}
                      {r.isPrimary && (
                        <Badge tone="navy" icon={<Star className="size-3" aria-hidden />}>
                          Principal
                        </Badge>
                      )}
                    </span>
                  </Td>
                  <Td className="tabular text-muted">{maskCPF(r.cpf)}</Td>
                  <Td>{r.role}</Td>
                  <Td className="text-[12.5px] text-muted">{[r.email, r.phone].filter(Boolean).join(" · ") || "—"}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </Block>
  );
}

export function PartnersBlock({ client }: { client: CompanyClient }) {
  return (
    <Block title="Quadro societário (QSA)" clientId={client.id}>
      {client.partners.length === 0 ? (
        <p className="text-[13px] text-muted">Quadro societário não informado.</p>
      ) : (
        <div className="-mx-5 -my-4">
          <Table caption="Quadro societário">
            <THead>
              <tr>
                <Th>Nome</Th>
                <Th>CPF/CNPJ</Th>
                <Th>Qualificação</Th>
                <Th className="text-right">Participação</Th>
              </tr>
            </THead>
            <TBody>
              {client.partners.map((p) => (
                <Tr key={p.id}>
                  <Td>{p.name}</Td>
                  <Td className="tabular text-muted">{p.document ? maskDocument(p.document) : "—"}</Td>
                  <Td>{p.qualification || "—"}</Td>
                  <Td className="text-right tabular">{formatPercent(p.sharePercent, p.sharePercent && p.sharePercent % 1 ? 1 : 0)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </Block>
  );
}
