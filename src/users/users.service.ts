import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth-user';
import { DORMITORY_BOUND, requireDormitory, requireUniversity, USER_SELECT } from '../common/scope';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto, ListUsersDto, PERMISSIONS, UpdateUserDto } from './dto/user.dto';

/** Who may create (and therefore manage) which role. This encodes the hierarchy of the project document. */
const CREATABLE: Record<Role, Role[]> = {
  [Role.SUPER_ADMIN]: [Role.SENIOR_ADMIN],
  [Role.SENIOR_ADMIN]: [Role.SYSTEM_MANAGER],
  [Role.SYSTEM_MANAGER]: [Role.DORM_SUPERVISOR, Role.ATTENDANT, Role.SERVICE_STAFF, Role.COUNSELING, Role.HEALTH_LIAISON],
  [Role.DORM_SUPERVISOR]: [Role.ATTENDANT, Role.SERVICE_STAFF],
  [Role.ATTENDANT]: [],
  [Role.SERVICE_STAFF]: [],
  [Role.COUNSELING]: [],
  [Role.HEALTH_LIAISON]: [],
};

/** Roles that may hold a student-work contract. */
const STUDENT_WORKER_ROLES: Role[] = [Role.ATTENDANT, Role.HEALTH_LIAISON];

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async create(actor: AuthUser, dto: CreateUserDto) {
    if (!CREATABLE[actor.role].includes(dto.role)) {
      throw new ForbiddenException(`Role ${actor.role} cannot create ${dto.role}`);
    }

    if ((dto.isStudentWorker || dto.workerPost) && !STUDENT_WORKER_ROLES.includes(dto.role)) {
      throw new BadRequestException('Student-work contracts apply to attendants and health liaisons only');
    }
    if (dto.workerPost && !dto.isStudentWorker) throw new BadRequestException('workerPost requires isStudentWorker');

    const needsEmployment = dto.role === Role.DORM_SUPERVISOR || dto.role === Role.SERVICE_STAFF || (dto.role === Role.ATTENDANT && !dto.isStudentWorker);
    if (needsEmployment && !dto.employmentType) throw new BadRequestException('employmentType is required for this role');

    // --- university scope ---
    let universityId: string;
    if (actor.role === Role.SUPER_ADMIN) {
      if (!dto.universityId) throw new BadRequestException('universityId is required');
      const uni = await this.prisma.university.findUnique({ where: { id: dto.universityId } });
      if (!uni) throw new NotFoundException('University not found');
      universityId = uni.id;
    } else {
      universityId = requireUniversity(actor);
    }

    // --- dormitory scope ---
    let dormitoryId: string | null = null;
    if (DORMITORY_BOUND.includes(dto.role)) {
      dormitoryId = actor.role === Role.DORM_SUPERVISOR ? requireDormitory(actor) : dto.dormitoryId ?? null;
      if (dormitoryId) await this.assertDormitoryAssignable(dormitoryId, universityId, dto.role);
    } else if (dto.dormitoryId) {
      throw new BadRequestException(`${dto.role} cannot be bound to a dormitory`);
    }

    try {
      const user = await this.prisma.user.create({
        data: {
          username: dto.username,
          passwordHash: await bcrypt.hash(dto.password, 12),
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
          jobTitle: dto.jobTitle,
          employmentType: dto.employmentType,
          role: dto.role,
          isStudentWorker: dto.isStudentWorker ?? false,
          workerPost: dto.workerPost,
          universityId,
          dormitoryId,
        },
        select: USER_SELECT,
      });
      await this.audit.log({
        actor, action: 'user.create', entity: 'User', entityId: user.id, universityId,
        meta: { username: user.username, role: user.role, dormitoryId },
      });
      return user;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Username already exists');
      }
      throw e;
    }
  }

  async list(actor: AuthUser, q: ListUsersDto) {
    const filters: Prisma.UserWhereInput[] = [];

    if (actor.role === Role.SUPER_ADMIN) {
      if (q.universityId) filters.push({ universityId: q.universityId });
    } else {
      filters.push({ universityId: requireUniversity(actor) });
      if (actor.role === Role.DORM_SUPERVISOR) {
        // own staff + unassigned attendants/service staff of the university (so they can be attached)
        filters.push({
          OR: [
            { dormitoryId: requireDormitory(actor) },
            { dormitoryId: null, role: { in: [Role.ATTENDANT, Role.SERVICE_STAFF] } },
          ],
        });
      }
    }
    if (q.role) filters.push({ role: q.role });
    if (q.dormitoryId) filters.push({ dormitoryId: q.dormitoryId });

    const where: Prisma.UserWhereInput = { AND: filters };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where, select: USER_SELECT, orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.limit, take: q.limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  async setDormitory(actor: AuthUser, id: string, dormitoryId: string | null) {
    const target = await this.manageableTarget(actor, id);
    if (!DORMITORY_BOUND.includes(target.role)) {
      throw new BadRequestException(`${target.role} cannot be bound to a dormitory`);
    }
    if (actor.role === Role.DORM_SUPERVISOR && dormitoryId !== null && dormitoryId !== requireDormitory(actor)) {
      throw new ForbiddenException('You can only attach staff to your own dormitory');
    }
    if (dormitoryId) await this.assertDormitoryAssignable(dormitoryId, target.universityId!, target.role, target.id);

    const user = await this.prisma.user.update({ where: { id }, data: { dormitoryId }, select: USER_SELECT });
    await this.audit.log({
      actor, action: 'user.set_dormitory', entity: 'User', entityId: id, universityId: target.universityId,
      meta: { from: target.dormitoryId, to: dormitoryId },
    });
    return user;
  }

  /** Upper roles edit details and roles of the people they manage (same rule as creation). */
  async update(actor: AuthUser, id: string, dto: UpdateUserDto) {
    const target = await this.manageableTarget(actor, id);
    const data: Prisma.UserUncheckedUpdateInput = {};
    for (const k of ['username', 'firstName', 'lastName', 'phone', 'jobTitle', 'employmentType'] as const) {
      if (dto[k] !== undefined) (data as Record<string, unknown>)[k] = dto[k];
    }
    const role = dto.role ?? target.role;
    if (dto.role && dto.role !== target.role) {
      if (!CREATABLE[actor.role].includes(dto.role)) throw new ForbiddenException(`You cannot assign the role ${dto.role}`);
      data.role = dto.role;
      if (!DORMITORY_BOUND.includes(dto.role)) data.dormitoryId = null;
      else if (dto.role === Role.DORM_SUPERVISOR && target.dormitoryId) {
        await this.assertDormitoryAssignable(target.dormitoryId, target.universityId!, dto.role, target.id);
      }
    }
    if (STUDENT_WORKER_ROLES.includes(role)) {
      const isSW = dto.isStudentWorker ?? target.isStudentWorker;
      const post = dto.workerPost ?? target.workerPost;
      if (post && !isSW) throw new BadRequestException('workerPost requires isStudentWorker');
      data.isStudentWorker = isSW;
      data.workerPost = isSW ? post : null;
    } else {
      data.isStudentWorker = false;
      data.workerPost = null;
    }
    try {
      const user = await this.prisma.user.update({ where: { id }, data, select: USER_SELECT });
      await this.audit.log({
        actor, action: 'user.update', entity: 'User', entityId: id, universityId: target.universityId,
        meta: { fields: Object.keys(dto), roleFrom: target.role, roleTo: user.role },
      });
      return user;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Username already exists');
      throw e;
    }
  }

  /** Reset a forgotten password; also clears a login lockout. */
  async resetPassword(actor: AuthUser, id: string, newPassword: string) {
    const target = await this.manageableTarget(actor, id);
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: await bcrypt.hash(newPassword, 12), mustChangePassword: true, failedLogins: 0, lockedUntil: null },
    });
    await this.audit.log({ actor, action: 'user.reset_password', entity: 'User', entityId: id, universityId: target.universityId });
    return { ok: true };
  }

  /** Permissions can only be granted by someone who holds them (the super admin holds all). */
  async setPermissions(actor: AuthUser, id: string, permissions: string[]) {
    const target = await this.manageableTarget(actor, id);
    const wanted = [...new Set(permissions)];
    const added = wanted.filter((p) => !target.permissions.includes(p));
    const held = actor.role === Role.SUPER_ADMIN ? [...PERMISSIONS] : actor.permissions ?? [];
    const missing = added.filter((p) => !held.includes(p));
    if (missing.length) throw new ForbiddenException(`You cannot grant permissions you do not hold: ${missing.join(', ')}`);
    const user = await this.prisma.user.update({ where: { id }, data: { permissions: wanted }, select: USER_SELECT });
    await this.audit.log({
      actor, action: 'user.set_permissions', entity: 'User', entityId: id, universityId: target.universityId,
      meta: { from: target.permissions, to: wanted },
    });
    return user;
  }

  async setActive(actor: AuthUser, id: string, isActive: boolean) {
    const target = await this.manageableTarget(actor, id);
    const user = await this.prisma.user.update({ where: { id }, data: { isActive }, select: USER_SELECT });
    await this.audit.log({
      actor, action: isActive ? 'user.activate' : 'user.deactivate', entity: 'User', entityId: id,
      universityId: target.universityId,
    });
    return user;
  }

  // ---------- helpers ----------

  /** A caller may manage exactly the users whose role they are allowed to create, inside their own scope. */
  private async manageableTarget(actor: AuthUser, id: string) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    const inScope =
      target &&
      (actor.role === Role.SUPER_ADMIN || target.universityId === requireUniversity(actor)) &&
      CREATABLE[actor.role].includes(target.role) &&
      (actor.role !== Role.DORM_SUPERVISOR ||
        target.dormitoryId === null ||
        target.dormitoryId === requireDormitory(actor));
    if (!target || !inScope) throw new NotFoundException('User not found'); // 404 so other tenants' ids aren't revealed
    return target;
  }

  private async assertDormitoryAssignable(dormitoryId: string, universityId: string, role: Role, exceptUserId?: string) {
    const dorm = await this.prisma.dormitory.findFirst({ where: { id: dormitoryId, universityId } });
    if (!dorm) throw new NotFoundException('Dormitory not found');
    if (role === Role.DORM_SUPERVISOR) {
      const existing = await this.prisma.user.count({
        where: { dormitoryId, role: Role.DORM_SUPERVISOR, isActive: true, ...(exceptUserId ? { id: { not: exceptUserId } } : {}) },
      });
      if (existing > 0) throw new ConflictException('This dormitory already has an active supervisor');
    }
  }
}
