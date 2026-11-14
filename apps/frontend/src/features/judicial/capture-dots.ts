import type { Tone } from "@/lib/constants/status";

/**
 * Bolinhas de conferência da captura judicial (074). Regra pura das cores:
 * os componentes só chamam estas funções e desenham o ponto com o rótulo.
 *
 *   verde (success)   conferido e sem erro;
 *   amarelo (warning) ainda não conferido, mas é normal (cedo, recém-cadastrado);
 *   vermelho (danger) falhou, ou não foi conferido quando deveria;
 *   cinza (neutral)   pausado, desligado ou dia sem conferência.
 *
 * Horário sempre de São Paulo, como o servidor (062).
 */
export interface CaptureDot {
  tone: Extract<Tone, "success" | "warning" | "danger" | "neutral">;
  label: string;
}

const TIME_ZONE = "America/Sao_Paulo";
const HOUR_MS = 3_600_000;

const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});

/** Data (YYYY-MM-DD), minutos do dia e dia da semana (0 = domingo) em São Paulo. */
function saoPaulo(at: Date): { day: string; minutes: number; weekday: number } {
  const p = Object.fromEntries(partsFmt.formatToParts(at).map((x) => [x.type, x.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday ?? "");
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), weekday };
}

/** A partir de quando a busca do dia conta (062, item 4): 05:00 de São Paulo. */
const COUNTS_FROM_MINUTES = 5 * 60;
/** A partir de quando a falta de conferência é atraso (062): 08:00 de São Paulo. */
const LATE_FROM_MINUTES = 8 * 60;

/**
 * DJEN por OAB, validade "hoje". `djenEnabled` e `captureApplies` vêm do
 * overview (Integrações); no portal do parceiro não vêm e a regra usa só o
 * relógio. `captureApplies` falso num dia útil depois das 08:00, com o DJEN
 * ligado, é feriado nacional (o servidor não cobra a busca).
 */
export function djenMonitorDot(input: {
  active: boolean;
  lastSuccessAt?: string;
  now: Date;
  djenEnabled?: boolean;
  captureApplies?: boolean;
}): CaptureDot {
  if (!input.active) return { tone: "neutral", label: "Pausada" };
  const today = saoPaulo(input.now);
  if (input.lastSuccessAt) {
    const ok = saoPaulo(new Date(input.lastSuccessAt));
    if (ok.day === today.day && ok.minutes >= COUNTS_FROM_MINUTES) return { tone: "success", label: "Conferida hoje" };
  }
  if (input.djenEnabled === false) return { tone: "neutral", label: "DJEN desligado" };
  if (today.weekday === 0 || today.weekday === 6) return { tone: "neutral", label: "Fim de semana" };
  if (today.minutes < LATE_FROM_MINUTES) return { tone: "warning", label: "Ainda não conferida hoje" };
  if (input.captureApplies === false) return { tone: "neutral", label: "Dia sem expediente" };
  return { tone: "danger", label: "Sem conferência hoje" };
}

/**
 * DataJud por processo, validade 24 h (o DataJud lê pelo número CNJ). 24 h
 * exatas ainda contam, como no banco (`>= now() - interval '24 hours'`).
 */
export function datajudProcessDot(input: {
  hasCnj: boolean;
  tracked: boolean;
  lastSyncedAt?: string;
  lastError?: string;
  now: Date;
}): CaptureDot {
  if (!input.hasCnj) return { tone: "neutral", label: "Sem número CNJ" };
  if (!input.tracked) return { tone: "neutral", label: "Acompanhamento pausado" };
  if (input.lastError) return { tone: "danger", label: "A última leitura falhou" };
  if (!input.lastSyncedAt) return { tone: "warning", label: "Ainda não lido" };
  const age = input.now.getTime() - new Date(input.lastSyncedAt).getTime();
  if (age <= 24 * HOUR_MS) return { tone: "success", label: "Lido nas últimas 24 h" };
  return { tone: "danger", label: "Sem leitura há mais de 24 h" };
}

/**
 * Resumo do DataJud em Integrações: "X de Y processos lidos nas últimas 24 h ·
 * Z com falha". Sem `syncedLast24h` (banco anterior à 074): "Y processos
 * acompanhados · Z com falha", e sem X não dá para dizer verde.
 */
export function datajudSummaryDot(input: {
  datajudEnabled: boolean;
  tracked: number;
  withError: number;
  syncedLast24h?: number;
}): CaptureDot & { text: string } {
  const { tracked: y, withError: z, syncedLast24h: x } = input;
  const text =
    y === 0
      ? "Nenhum processo acompanhado"
      : x === undefined
        ? `${y} ${y === 1 ? "processo acompanhado" : "processos acompanhados"} · ${z} com falha`
        : `${x} de ${y} ${y === 1 ? "processo lido" : "processos lidos"} nas últimas 24 h · ${z} com falha`;
  if (!input.datajudEnabled) return { tone: "neutral", label: "DataJud desligado", text };
  if (y === 0) return { tone: "neutral", label: "Nenhum processo acompanhado", text };
  if (z > 0) return { tone: "danger", label: "Há processo com falha na leitura", text };
  if (x !== undefined && x >= y) return { tone: "success", label: "Todos lidos nas últimas 24 h", text };
  return { tone: "warning", label: x === undefined ? "Leitura das últimas 24 h não informada" : "Há processo ainda não lido nas últimas 24 h", text };
}
