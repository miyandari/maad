import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { AuthUser } from '../common/auth-user';
import { dateStr, todayTehran, weekdayOf } from '../common/dates';
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
    if (actor.role === Role.PSYCHOLOGIST && !dto.dormitoryId) throw new BadRequestException('Choose the dormitory you are visiting');
    const dormitoryId = dto.dormitoryId ?? requireDormitory(actor);
    if (await this.prisma.staffPresence.findFirst({ where: { userId: actor.id, checkOutAt: null } })) {
      throw new ConflictException('You are already checked in');
    }
    const dorm = await this.prisma.dormitory.findFirst({ where: { id: dormitoryId, universityId } });
    if (!dorm) throw new NotFoundException('Dormitory not found');

    const now = actionTime(dto.clientTime);
    let shiftId: string | null = null;
    let unscheduled = false;
    let scheduleId: string | null = null;
    if (actor.role === Role.PSYCHOLOGIST) {
      // a psychologist announces his presence in a dormitory according to the plan set by the counseling office
      scheduleId = await this.matchVisit(actor.id, dormitoryId, now);
      unscheduled = !scheduleId; // allowed, but flagged for the counseling office
    } else if (actor.role === Role.ATTENDANT) {
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
        universityId, userId: actor.id, dormitoryId, shiftId, scheduleId, unscheduled, checkInAt: now,
        handoverFromUserId: dto.handoverFromUserId, handoverNote: dto.handoverNote,
      },
    });
  }

  /** Finds the active weekly plan of this psychologist for this dormitory that covers `now` (30 min early .. 60 min late). */
  private async matchVisit(userId: string, dormitoryId: string, now: Date): Promise<string | null> {
    const day = todayTehran(now);
    const plans = await this.prisma.psychSchedule.findMany({ where: { psychologistId: userId, dormitoryId, isActive: true, weekdays: { has: weekdayOf(day) } } });
    for (const p of plans) {
      if ((p.validFrom && day < dateStr(p.validFrom)) || (p.validTo && day > dateStr(p.validTo))) continue;
      const start = new Date(`${day}T${p.startTime}:00+03:30`);
      const end = new Date(`${day}T${p.endTime}:00+03:30`);
      if (now.getTime() >= start.getTime() - EARLY_MS && now.getTime() <= end.getTime() + 60 * 60_000) return p.id;
    }
    return null;
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
    if (actor.role === Role.ATTENDANT || actor.role === Role.SERVICE_STAFF || actor.role === Role.PSYCHOLOGIST) where.userId = actor.id;
    else if (actor.role === Role.COUNSELING) { where.universityId = requireUniversity(actor); where.user = { role: Role.PSYCHOLOGIST }; }
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
