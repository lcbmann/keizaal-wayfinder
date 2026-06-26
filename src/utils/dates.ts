export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function daysBetween(startDate: string, end = new Date()): number {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const finish = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  return Math.floor((finish.getTime() - start.getTime()) / 86_400_000);
}

export function formatMaybeDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Unknown";
  }

  return new Date(value).toISOString().replace("T", " ").slice(0, 16);
}
