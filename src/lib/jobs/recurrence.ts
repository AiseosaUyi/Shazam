/**
 * Recurrence for scheduled jobs. Kept to a small, predictable vocabulary the model can use
 * reliably: daily | weekdays | weekly | monthly. Times keep their wall-clock hour in the
 * user's timezone across DST changes.
 */
export type Recurrence = 'daily' | 'weekdays' | 'weekly' | 'monthly';
export const RECURRENCES: Recurrence[] = ['daily', 'weekdays', 'weekly', 'monthly'];

function zonedParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return { y: +parts.year, m: +parts.month, d: +parts.day, h: +parts.hour % 24, min: +parts.minute, s: +parts.second, weekday: parts.weekday };
}

/** Converts a wall-clock time in `timeZone` to a UTC Date. */
export function zonedTimeToUtc(y: number, m: number, d: number, h: number, min: number, timeZone: string): Date {
  let guess = Date.UTC(y, m - 1, d, h, min);
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(guess), timeZone);
    const asIfUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
    guess += Date.UTC(y, m - 1, d, h, min) - asIfUtc;
  }
  return new Date(guess);
}

export function nextOccurrence(previousRunAt: string, recurrence: string | null, timeZone = 'UTC', now = new Date()): string | null {
  if (!recurrence || !RECURRENCES.includes(recurrence as Recurrence)) return null;
  const prev = zonedParts(new Date(previousRunAt), timeZone);
  let { y, m, d } = prev;
  for (let guard = 0; guard < 400; guard++) {
    if (recurrence === 'monthly') {
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    } else {
      const step = recurrence === 'weekly' ? 7 : 1;
      const next = new Date(Date.UTC(y, m - 1, d + step));
      y = next.getUTCFullYear(); m = next.getUTCMonth() + 1; d = next.getUTCDate();
    }
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const candidate = zonedTimeToUtc(y, m, Math.min(recurrence === 'monthly' ? prev.d : d, daysInMonth), prev.h, prev.min, timeZone);
    const dow = zonedParts(candidate, timeZone).weekday;
    if (recurrence === 'weekdays' && (dow === 'Sat' || dow === 'Sun')) continue;
    if (candidate.getTime() > now.getTime()) return candidate.toISOString();
  }
  return null;
}

export function describeNow(timeZone: string): string {
  const now = new Date();
  const local = new Intl.DateTimeFormat('en-US', { timeZone, dateStyle: 'full', timeStyle: 'long' }).format(now);
  return `${local} (timezone ${timeZone}; UTC ${now.toISOString()})`;
}
