import { BadRequestException, ForbiddenException } from '@nestjs/common';

export interface Fix { lat: number; lng: number; accuracy?: number }

/** Great-circle distance in metres. */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** The device's own accuracy may excuse at most this many metres (indoors GPS drifts, but a vague fix must not pass for anything). */
const MAX_SLACK_M = 150;

/**
 * Geofence for staff check-in / check-out.
 * Returns null when the dormitory has no coordinates or the restriction is switched off (radius 0): nothing to enforce.
 * Throws when a fix is missing or too far away.
 */
export function checkGeofence(
  dorm: { name: string; latitude: number | null; longitude: number | null; geofenceRadiusM: number },
  fix?: Fix,
): { distanceM: number; accuracyM: number | null } | null {
  if (dorm.latitude == null || dorm.longitude == null || dorm.geofenceRadiusM <= 0) return null;
  if (!fix) throw new BadRequestException('موقعیت دستگاه دریافت نشد؛ موقعیت‌یابی (GPS) را روشن کنید و اجازه‌ی دسترسی به موقعیت را به برنامه بدهید.');
  const d = Math.round(distanceM(fix.lat, fix.lng, dorm.latitude, dorm.longitude));
  const acc = fix.accuracy != null ? Math.round(fix.accuracy) : null;
  if (d - Math.min(acc ?? 0, MAX_SLACK_M) > dorm.geofenceRadiusM) {
    throw new ForbiddenException(`شما حدود ${d} متر از «${dorm.name}» فاصله دارید؛ ثبت فقط در محدوده‌ی ${dorm.geofenceRadiusM} متری خوابگاه ممکن است.`);
  }
  return { distanceM: d, accuracyM: acc };
}
