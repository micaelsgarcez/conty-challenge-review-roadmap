export const TIMEZONE = "America/Sao_Paulo";

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function todayInSaoPaulo(now: Date): string {
  return formatter.format(now);
}

export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// O dia do prazo ainda vale até 23:59:59.999 em São Paulo.
export function isDeadlineValid(dueDate: string, now: Date): boolean {
  return dueDate >= todayInSaoPaulo(now);
}
