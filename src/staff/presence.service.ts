import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { AuthUser } from '../common/auth-user';
import { requireDormitory, requireUniversity } from '../common/scope';
import { PrismaService } from '../prisma/prisma.service';
import { CheckInDto, ListPresenceDto } from './dto/staff.dto';

const EARLY_MS = 30 * 60_000; // check-in is accepted up to 30 minutes before the shift starts

/** Uses the client-reported time when it is plausible (not in the future, at most 7 days old). */
function actionTime(clientTime?: string): Date {
  const now = new Date();
  if (!clientTime) return now;
  const t = new Date(clientTime);
  if (t.getTime() > now.getTime() + 5 * 60_000) return now;
  if (t.getTime() < now.getTime() - 7 * 86_400_000) throw new BadRequestException('clientTime is too old');
  return t;
}

@Injectable()
export class PresenceService {
  constructor(private prisma: PrismaService) {}

  /** اعلام حضور و تحویل شیفت */
  async checkIn(actor: AuthUser, dto: CheckInDto) {
    const universityId = requireUniversity(actor);
    const dormitoryId = dto.dormitoryId ?? requireDormitory(actor);
    if (await this.prisma.staffPresence.findFirst({ where: { userId: actor.id, checkOutAt: null } })) {
      throw new ConflictException('You are already checked in');
    }
    const dorm = await this.prisma.dormitory.findFirst({ where: { id: dormitoryId, universityId } });
    if (!dorm) throw new NotFoundException('Dormitory not found');

    const now = actionTime(dto.clientTime);
    let shiftId: string | null = null;
    let unscheduled = false;
    if (actor.role === Role.ATTENDANT) {
      const shift = await this.prisma.shift.findFirst({
        where: {
          userId: actor.id, dormitoryId, cancelledAt: null,
          startsAt: { lte: new Date(now.getTime() + EARLY_MS) }, endsAt: { gte: now },
        },
        orderBy: { startsAt: 'asc' },
      });
      if (shift) shiftId = shift.id;
      else if (dormitoryId !== actor.dormitoryId) throw new ForbiddenException('You have no shift in that dormitory right now');
      else unscheduled = true; // allowed, but flagged for the supervisor
    } else if (dormitoryId !== actor.dormitoryId) {
      throw new ForbiddenException('You can only check in at your own dormitory');
    }
    if (dto.handoverFromUserId) {
      const prev = await this.prisma.user.findFirst({ where: { id: dto.handoverFromUserId, universityId, role: Role.ATTENDANT } });
      if (!prev) throw new BadRequestException('handoverFromUserId is not an attendant of your university');
    }
    return this.prisma.staffPresence.create({
      data: {
        universityId, userId: actor.id, dormitoryId, shiftId, unscheduled, checkInAt: now,
        handoverFromUserId: dto.handoverFromUserId, handoverNote: dto.handoverNote,
      },
    });
  }

  async checkOut(actor: AuthUser, clientTime?: string, note?: string) {
    const open = await this.prisma.staffPresence.findFirst({ where: { userId: actor.id, checkOutAt: null } });
    if (!open) throw new ConflictException('You are not checked in');
    const at = actionTime(clientTime);
    return this.prisma.staffPresence.update({ where: { id: open.id }, data: { checkOutAt: at < open.checkInAt ? new Date() : at, checkOutNote: note } });
  }

  current(actor: AuthUser) {
    return this.prisma.staffPresence.findFirst({ where: { userId: actor.id, checkOutAt: null } });
  }

  /** Supervisors see their dormitory, managers the whole university (جریان حضور همکاران). */
  async list(actor: AuthUser, q: ListPresenceDto) {
    const where: Prisma.StaffPresenceWhereInput = {
      ...(q.dormitoryId ? { dormitoryId: q.dormitoryId } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.openOnly ? { checkOutAt: null } : {}),
      ...(q.from || q.to ? { checkInAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
    };
    if (actor.role === Role.ATTENDANT || actor.role === Role.SERVICE_STAFF) where.userId = actor.id;
    else if (actor.role === Role.DORM_SUPERVISOR) where.dormitoryId = requireDormitory(actor);
    else where.universityId = requireUniversity(actor);

    const [items, total] = await Promise.all([
      this.prisma.staffPresence.findMany({
        where, orderBy: { checkInAt: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit,
        include: { user: { select: { id: true, firstName: true, lastName: true, role: true } } },
      }),
      this.prisma.staffPresence.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }
}
