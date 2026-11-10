import { SetMetadata } from '@nestjs/common';
export const FEATURE_KEY = 'requiredFeature';
/** Modules a university's feature flags can switch off (managed by the super admin). */
export const FEATURES = ['messaging', 'counseling', 'maintenance', 'checklists', 'health'] as const;
export type Feature = (typeof FEATURES)[number];
export const RequireFeature = (f: Feature) => SetMetadata(FEATURE_KEY, f);
