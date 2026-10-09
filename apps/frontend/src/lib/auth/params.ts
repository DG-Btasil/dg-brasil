/** Primeiro valor de um searchParam como string (ignora arrays e ausentes). */
export function param(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}
