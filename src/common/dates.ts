export const TEHRAN = 'Asia/Tehran';

/** Today's calendar date in Tehran as YYYY-MM-DD. */
export function todayTehran(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TEHRAN, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
/** Date-only value for @db.Date columns. */
export const dateOnly = (s: string) => new Date(`${s}T00:00:00.000Z`);
export const dateStr = (d: Date) => d.toISOString().slice(0, 10);
export function addDays(s: string, n: number): string {
  const d = dateOnly(s);
  d.setUTCDate(d.getUTCDate() + n);
  return dateStr(d);
}
export const daysBetween = (a: string, b: string) => Math.round((dateOnly(b).getTime() - dateOnly(a).getTime()) / 86_400_000);
/** Iran has no DST since 2022: Tehran midnight is 20:30 UTC of the previous day. */
export const startOfTehranDay = (s = todayTehran()) => new Date(`${s}T00:00:00+03:30`);
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Wall-clock time in Tehran (fixed +03:30, no DST) as a real Date. */
export const tehranAt = (day: string, hour: number) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00+03:30`);
/** JS weekday (0 = Sunday ... 5 = Friday) of a calendar date. */
export const weekdayOf = (day: string) => dateOnly(day).getUTCDay();
