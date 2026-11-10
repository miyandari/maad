import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { LeaveStatus, Prisma, Role, ShiftType } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth-user';
import { addDays, dateOnly, dateStr, daysBetween, tehranAt, todayTehran, weekdayOf } from '../common/dates';
import { inScope, requireDormitory, requireUniversity } from '../common/scope';
import { PrismaService } from '../prisma/prisma.service';
import { CreateHolidaysDto, CreateShiftDto, GenerateShiftsDto, ListHolidaysDto, ListShiftsDto, ShiftSettingsDto } from './dto/staff.dto';

const DEFAULTS = { startHour: 14, workdayEndHour: 8, holidayEndHour: 14, weeklyOffDays: [5] };
type Rules = typeof DEFAULTS;

/**
 * Shift rules: an attendant works 14:00 -> 08:00 next day and hands over to the supervisor. When the next morning is
 * a holiday (weekly off day or listed holiday) he stays until 14:00 and hands over to the next attendant; those
 * extra hours (08:00-14:00 = 6 h) are overtime.
 */
@Injectable()
export class ShiftsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  // ---------------- rules & holidays ----------------

  private async rulesFor(universityId: string): Promise<Rules> {
    const s = await this.prisma.shiftSettings.findUnique({ where: { universityId } });
    return s ? { startHour: s.startHour, workdayEndHour: s.workdayEndHour, holidayEndHour: s.holidayEndHour, weeklyOffDays: s.weeklyOffDays } : DEFAULTS;
  }

  getSettings(actor: AuthUser) {
    return this.rulesFor(requireUniversity(actor));
  }

  async saveSettings(actor: AuthUser, dto: ShiftSettingsDto) {
    const universityId = requireUniversity(actor);
    if (dto.holidayEndHour < dto.workdayEndHour) throw new BadRequestException('holidayEndHour must not be earlier than workdayEndHour');
    const data = { ...dto, weeklyOffDays: [...new Set(dto.weeklyOffDays)] };
    const s = await this.prisma.shiftSettings.upsert({ where: { universityId }, create: { universityId, ...data }, update: data });
    await this.audit.log({ actor, action: 'shift.settings', entity: 'ShiftSettings', entityId: universityId, universityId, meta: { ...data } });
    return s;
  }

  async listHolidays(actor: AuthUser, q: ListHolidaysDto) {
    const from = q.from ?? addDays(todayTehran(), -30);
    return this.prisma.holiday.findMany({
      where: { universityId: requireUniversity(actor), date: { gte: dateOnly(from), ...(q.to ? { lte: dateOnly(q.to) } : {}) } },
      orderBy: { date: 'asc' }, take: 500,
    });
  }

  async addHolidays(actor: AuthUser, dto: CreateHolidaysDto) {
    const universityId = requireUniversity(actor);
    const res = await this.prisma.holiday.createMany({
      data: dto.items.map((i) => ({ universityId, date: dateOnly(i.date), title: i.title.trim() })), skipDuplicates: true,
    });
    await this.audit.log({ actor, action: 'shift.holidays_add', entity: 'Holiday', universityId, meta: { requested: dto.items.length, added: res.count } });
    return { added: res.count, ignoredDuplicates: dto.items.length - res.count };
  }

  async deleteHoliday(actor: AuthUser, id: string) {
    const res = await this.prisma.holiday.deleteMany({ where: { id, universityId: requireUniversity(actor) } });
    if (res.count === 0) throw new NotFoundException('Holiday not found');
    return { ok: true };
  }

  private async holidaySet(universityId: string, from: string, to: string) {
    const rows = await this.prisma.holiday.findMany({ where: { universityId, date: { gte: dateOnly(from), lte: dateOnly(to) } }, select: { date: true } });
    return new Set(rows.map((r) => dateStr(r.date)));
  }

  private isOff(day: string, rules: Rules, holidays: Set<string>) {
    return rules.weeklyOffDays.includes(weekdayOf(day)) || holidays.has(day);
  }

  /** Start/end/overtime of the standard shift that STARTS on `day`. */
  private standard(day: string, rules: Rules, holidays: Set<string>) {
    const next = addDays(day, 1);
    const off = this.isOff(next, rules, holidays);
    return {
      startsAt: tehranAt(day, rules.startHour),
      endsAt: tehranAt(next, off ? rules.holidayEndHour : rules.workdayEndHour),
      overtimeMinutes: off ? Math.max(0, (rules.holidayEndHour - rules.workdayEndHour) * 60) : 0,
    };
  }

  // ---------------- shifts ----------------

  private async dormitory(actor: AuthUser, id: string) {
    const dorm = await this.prisma.dormitory.findUnique({ where: { id } });
    if (!dorm || !inScope(actor, { universityId: dorm.universityId, dormitoryId: dorm.id })) throw new NotFoundException('Dormitory not found');
    return dorm;
  }

  private async conflicts(userIds: string[], from: Date, to: Date) {
    const [shifts, leaves] = await Promise.all([
      this.prisma.shift.findMany({ where: { userId: { in: userIds }, cancelledAt: null, startsAt: { lt: to }, endsAt: { gt: from } }, select: { userId: true, startsAt: true, endsAt: true } }),
      this.prisma.leaveRequest.findMany({ where: { requesterId: { in: userIds }, status: LeaveStatus.APPROVED, startsAt: { lt: to }, endsAt: { gt: from } }, select: { requesterId: true, startsAt: true, endsAt: true } }),
    ]);
    return { shifts, leaves };
  }

  /**
   * Supervisors schedule their own attendants. The system manager can schedule any attendant of the
   * university into any dormitory — that is how an "extra shift in another dormitory" (جابجایی) is done.
   */
  async create(actor: AuthUser, dto: CreateShiftDto) {
    const dorm = await this.dormitory(actor, dto.dormitoryId);
    const user = await this.prisma.user.findFirst({ where: { id: dto.userId, universityId: dorm.universityId, role: Role.ATTENDANT, isActive: true } });
    if (!user) throw new NotFoundException('Attendant not found');
    if (actor.role === Role.DORM_SUPERVISOR && user.dormitoryId !== actor.dormitoryId) {
      throw new ForbiddenException('You can only schedule your own attendants; ask the system manager for extra shifts');
    }

    let start: Date, end: Date, overtimeMinutes = 0;
    if (dto.date) {
      const rules = await this.rulesFor(dorm.universityId);
      ({ startsAt: start, endsAt: end, overtimeMinutes } = this.standard(dto.date, rules, await this.holidaySet(dorm.universityId, dto.date, addDays(dto.date, 1))));
    } else {
      if (!dto.startsAt || !dto.endsAt) throw new BadRequestException('Provide date (standard shift) or both startsAt and endsAt');
      start = new Date(dto.startsAt);
      end = new Date(dto.endsAt);
      if (!(end > start)) throw new BadRequestException('endsAt must be after startsAt');
      if (end.getTime() - start.getTime() > 30 * 3_600_000) throw new BadRequestException('A shift cannot exceed 30 hours');
    }
    const c = await this.conflicts([user.id], start, end);
    if (c.shifts.length) throw new ConflictException('The attendant already has a shift in this period');
    if (c.leaves.length) throw new ConflictException('The attendant is on approved leave in this period');

    const shift = await this.prisma.shift.create({
      data: {
        dormitoryId: dorm.id, userId: user.id, startsAt: start, endsAt: end, overtimeMinutes, note: dto.note, createdById: actor.id,
        type: dto.type ?? (user.dormitoryId === dorm.id ? ShiftType.REGULAR : ShiftType.EXTRA),
      },
    });
    await this.audit.log({ actor, action: 'shift.create', entity: 'Shift', entityId: shift.id, universityId: dorm.universityId, meta: { userId: user.id, dormitoryId: dorm.id, type: shift.type, overtimeMinutes } });
    return shift;
  }

  /** Rotation roster: day by day, one attendant, in the given order. Conflicts are reported, never overwritten. */
  async generate(actor: AuthUser, dto: GenerateShiftsDto) {
    const dorm = await this.dormitory(actor, dto.dormitoryId);
    const ids = dto.attendantIds;
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Duplicate attendant in the rotation');
    const days = daysBetween(dto.from, dto.to) + 1;
    if (days < 1) throw new BadRequestException('"to" must not be before "from"');
    if (days > 93) throw new BadRequestException('At most 93 days per roster');

    const users = await this.prisma.user.findMany({ where: { id: { in: ids }, universityId: dorm.universityId, role: Role.ATTENDANT, isActive: true } });
    if (users.length !== ids.length) throw new NotFoundException('Some attendants were not found');
    if (actor.role === Role.DORM_SUPERVISOR && users.some((u) => u.dormitoryId !== actor.dormitoryId)) {
      throw new ForbiddenException('You can only schedule your own attendants');
    }
    const byId = new Map(users.map((u) => [u.id, u]));
    const rules = await this.rulesFor(dorm.universityId);
    const holidays = await this.holidaySet(dorm.universityId, dto.from, addDays(dto.to, 1));
    const existing = await this.conflicts(ids, tehranAt(addDays(dto.from, -1), 0), tehranAt(addDays(dto.to, 3), 0));
    const overlaps = (a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }) => a.startsAt < b.endsAt && a.endsAt > b.startsAt;

    const first = dto.firstIndex ?? 0;
    const rows = Array.from({ length: days }, (_, i) => {
      const date = addDays(dto.from, i);
      const userId = ids[(first + i) % ids.length];
      const std = this.standard(date, rules, holidays);
      const u = byId.get(userId)!;
      const reason = existing.shifts.some((s) => s.userId === userId && overlaps(s, std)) ? 'SHIFT_OVERLAP'
        : existing.leaves.some((l) => l.requesterId === userId && overlaps({ startsAt: l.startsAt, endsAt: l.endsAt }, std)) ? 'ON_LEAVE' : null;
      return { date, userId, userName: `${u.firstName} ${u.lastName}`, ...std, skipped: reason };
    });
    const toCreate = rows.filter((r) => !r.skipped);
    if (!dto.dryRun && toCreate.length) {
      await this.prisma.shift.createMany({
        data: toCreate.map((r) => ({
          dormitoryId: dorm.id, userId: r.userId, startsAt: r.startsAt, endsAt: r.endsAt, overtimeMinutes: r.overtimeMinutes, createdById: actor.id,
          type: byId.get(r.userId)!.dormitoryId === dorm.id ? ShiftType.REGULAR : ShiftType.EXTRA,
        })),
      });
      await this.audit.log({
        actor, action: 'shift.generate', entity: 'Dormitory', entityId: dorm.id, universityId: dorm.universityId,
        meta: { from: dto.from, to: dto.to, attendants: ids.length, created: toCreate.length, skipped: rows.length - toCreate.length },
      });
    }
    return {
      dryRun: !!dto.dryRun, days, created: dto.dryRun ? 0 : toCreate.length, wouldCreate: toCreate.length,
      skipped: rows.filter((r) => r.skipped).map((r) => ({ date: r.date, userName: r.userName, reason: r.skipped })),
      overtimeHoursTotal: toCreate.reduce((s, r) => s + r.overtimeMinutes, 0) / 60,
      shifts: rows,
    };
  }

  async list(actor: AuthUser, q: ListShiftsDto) {
    const where: Prisma.ShiftWhereInput = {
      ...(q.dormitoryId ? { dormitoryId: q.dormitoryId } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.from || q.to ? { startsAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
    };
    if (actor.role === Role.ATTENDANT) where.userId = actor.id;
    else if (actor.role === Role.DORM_SUPERVISOR) where.dormitoryId = requireDormitory(actor);
    else where.dormitory = { universityId: requireUniversity(actor) };

    const [items, total] = await Promise.all([
      this.prisma.shift.findMany({
        where, orderBy: { startsAt: 'asc' }, skip: (q.page - 1) * q.limit, take: q.limit,
        include: { user: { select: { id: true, firstName: true, lastName: true, isStudentWorker: true, workerPost: true } } },
      }),
      this.prisma.shift.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  async cancel(actor: AuthUser, id: string) {
    const shift = await this.prisma.shift.findUnique({ where: { id }, include: { dormitory: true } });
    if (!shift || !inScope(actor, { universityId: shift.dormitory.universityId, dormitoryId: shift.dormitoryId })) {
      throw new NotFoundException('Shift not found');
    }
    if (shift.cancelledAt) return shift;
    const updated = await this.prisma.shift.update({ where: { id }, data: { cancelledAt: new Date() } });
    await this.audit.log({ actor, action: 'shift.cancel', entity: 'Shift', entityId: id, universityId: shift.dormitory.universityId });
    return updated;
  }
}
