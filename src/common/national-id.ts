import { registerDecorator, ValidationOptions } from 'class-validator';

export const toLatin = (s: string) =>
  s.replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660));

export function isValidNationalId(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  const s = toLatin(v);
  if (!/^\d{10}$/.test(s) || /^(\d)\1{9}$/.test(s)) return false;
  const sum = [...s.slice(0, 9)].reduce((a, d, i) => a + Number(d) * (10 - i), 0);
  const r = sum % 11;
  const check = Number(s[9]);
  return r < 2 ? check === r : check === 11 - r;
}

export function IsNationalId(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isNationalId',
      target: object.constructor,
      propertyName,
      options: { message: `${propertyName} must be a valid 10-digit Iranian national ID`, ...options },
      validator: { validate: (v: unknown) => isValidNationalId(v) },
    });
}
