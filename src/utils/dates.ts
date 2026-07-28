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

export function formatElapsedSince(value: string | null | undefined, now = new Date()): string {
  if (!value) {
    return "unknown duration";
  }

  const elapsedMs = Math.max(0, now.getTime() - new Date(value).getTime());
  const totalMinutes = Math.floor(elapsedMs / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}
