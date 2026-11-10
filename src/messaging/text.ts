/** Number of SMS parts: 70/67 chars for Unicode (Persian), 160/153 for plain ASCII. */
export function smsParts(text: string): number {
  const unicode = /[^\x00-\x7F]/.test(text);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  const len = [...text].length;
  return len <= single ? 1 : Math.ceil(len / multi);
}

/** Replaces {{firstName}}, {{lastName}}, {{fullName}}, {{dormitoryName}}, {{date}}. Unknown variables are left as typed. */
export function render(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => vars[k] ?? m);
}

export const persianDate = (d = new Date()) =>
  new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', dateStyle: 'medium' }).format(d);
