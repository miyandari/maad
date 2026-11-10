const toLatin = (s: string) =>
  s.replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660));

/** Returns 09xxxxxxxxx or null when the value is not an Iranian mobile number. */
export function normalizeMobile(v?: string | null): string | null {
  if (!v) return null;
  const m = toLatin(v).replace(/\D/g, '').match(/^(?:98|0)?(9\d{9})$/);
  return m ? `0${m[1]}` : null;
}
export const MOBILE_RE = /^(\+98|0098|98|0)?[9۹][0-9۰-۹]{9}$/;
