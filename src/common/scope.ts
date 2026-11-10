import { ForbiddenException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { AuthUser } from './auth-user';

/** Roles whose data scope is a single dormitory. */
export const DORMITORY_BOUND: Role[] = [Role.DORM_SUPERVISOR, Role.ATTENDANT, Role.SERVICE_STAFF];

export function requireUniversity(user: AuthUser): string {
  if (!user.universityId) throw new ForbiddenException('No university scope assigned to this account');
  return user.universityId;
}

export function requireDormitory(user: AuthUser): string {
  if (!user.dormitoryId) throw new ForbiddenException('This account is not assigned to a dormitory');
  return user.dormitoryId;
}

export const USER_SELECT = {
  id: true,
  username: true,
  firstName: true,
  lastName: true,
  phone: true,
  jobTitle: true,
  employmentType: true,
  role: true,
  isActive: true,
  mustChangePassword: true,
  isStudentWorker: true,
  workerPost: true,
  permissions: true,
  universityId: true,
  dormitoryId: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export const MANAGERS: Role[] = [Role.SENIOR_ADMIN, Role.SYSTEM_MANAGER];

/** True when the target (university/dormitory) lies inside the caller's data scope. */
export function inScope(actor: AuthUser, t: { universityId: string | null; dormitoryId?: string | null }): boolean {
  if (actor.role === Role.SUPER_ADMIN) return true;
  if (!actor.universityId || t.universityId !== actor.universityId) return false;
  if (DORMITORY_BOUND.includes(actor.role)) return !!actor.dormitoryId && t.dormitoryId === actor.dormitoryId;
  return true;
}
