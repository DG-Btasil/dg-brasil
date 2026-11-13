"use client";

import { useEffect, useState } from "react";
import { Callout } from "@/components/feedback/states";
import { ButtonLink } from "@/components/ui/button";
import { callAction } from "@/lib/actions/result";
import { useCan } from "@/features/auth/hooks";
import { getJudicialCaptureAlertAction } from "@/server/domain/judicial/actions";
import type { JudicialCaptureAlertDTO, JudicialCaptureDTO } from "@/server/domain/judicial/dto";
import { captureNotice } from "../labels";

/**
 * Alerta da captura do DJEN (062): aparece quando, em dia útil depois das 08:00,
 * há OAB sem busca concluída no dia, ou quando o agendador está sem
 * configuração. Sem nada a avisar, não ocupa espaço.
 *
 * `detailed`: na tela de Integrações (o detalhe está logo abaixo, sem botão).
 */
export function JudicialCaptureCallout({
  capture, canManage, detailed = false, className,
}: {
  capture: JudicialCaptureDTO;
  canManage: boolean;
  detailed?: boolean;
  className?: string;
}) {
  const notice = captureNotice(capture, canManage);
  if (!notice) return null;
  return (
    <div role="alert" className={className}>
      <Callout
        tone={notice.tone}
        title={notice.title}
        action={
          detailed ? undefined : (
            <ButtonLink href="/dg-brasil/integracoes" variant="secondary" size="sm">
              Ver integrações
            </ButtonLink>
          )
        }
      >
        {notice.message}
        {capture.late && canManage && capture.configProblem && ` O agendador também está sem configuração (${capture.configProblem}).`}
      </Callout>
    </div>
  );
}

/**
 * Faixa da Home (ADMIN e advogado): busca o estado da captura por conta própria,
 * para a Home não depender dela. Falha ao buscar = sem faixa (o aviso também
 * chega pelas notificações).
 */
export function JudicialCaptureAlert({ className }: { className?: string }) {
  const can = useCan();
  const allowed = can("settings.integrations.view");
  const [data, setData] = useState<JudicialCaptureAlertDTO | null>(null);

  useEffect(() => {
    if (!allowed) return;
    let alive = true;
    callAction(() => getJudicialCaptureAlertAction()).then((r) => {
      if (alive && r.ok) setData(r.data);
    });
    return () => {
      alive = false;
    };
  }, [allowed]);

  if (!allowed || !data) return null;
  return <JudicialCaptureCallout capture={data} canManage={data.canManage} className={className} />;
}
