export function startOfDay(date = new Date()): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function endOfDay(date = new Date()): Date {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

export function activeDailyPriorityDateFilter(today = new Date()): { lte: Date } {
  return { lte: endOfDay(today) };
}

export function isDailyPriorityActive(priorityDate: Date | string | null | undefined, today = new Date()): boolean {
  if (!priorityDate) return false;
  return startOfDay(new Date(priorityDate)).getTime() <= startOfDay(today).getTime();
}
