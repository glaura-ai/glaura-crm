export function frenchDate(date: Date | string, withTime = false) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris", dateStyle: "medium", ...(withTime ? { timeStyle: "short" as const } : {}),
  }).format(new Date(date));
}

export function parisDateInput(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

// Date-only deadlines end at 18:00 Paris time, including summer-time dates.
export function parisDeadline(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Date d’échéance invalide.");
  const utc = new Date(`${value}T18:00:00Z`);
  if (!Number.isFinite(utc.getTime()) || utc.toISOString().slice(0, 10) !== value) throw new Error("Date d’échéance invalide.");
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).format(utc));
  return new Date(utc.getTime() - (hour - 18) * 3600000);
}
