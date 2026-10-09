const formatters = new Map<string, Intl.DateTimeFormat>();

function today(now: Date, timeZone: string): string {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    formatters.set(timeZone, f);
  }
  return f.format(now);
}

export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// O dia do prazo ainda vale até 23:59:59.999 no fuso da marca.
export function isDeadlineValid(dueDate: string, now: Date, timeZone: string): boolean {
  return dueDate >= today(now, timeZone);
}
