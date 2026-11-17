import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PsychSchedule, Referral, ReferralStatus, Role, Urgency } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth-user';
import { addDays, dateOnly, dateStr, daysBetween, tehranAt, todayTehran, weekdayOf } from '../common/dates';
import { requireDormitory, requireUniversity } from '../common/scope';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreatePsychScheduleDto, CreateReferralDto, ListPsychSchedulesDto, ListReferralsDto, ScheduleReferralDto, SessionDto, UpdatePsychScheduleDto, VisitsQueryDto,
} from './dto/counseling.dto';

const hm = (t: string) => t.split(':').map(Number) as [number, number];
const at = (day: string, t: string) => new Date(`${day}T${t}:00+03:30`);

@Injectable()
export class CounselingService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  // ======================= referrals =======================

  /**
   * Privacy: a referral is visible only to the person who reported it, the counseling office and the psychologist the
   * counseling office assigned it to. Supervisors and managers never see other people's referrals.
   */
  private async visible(actor: AuthUser): Promise<Prisma.ReferralWhereInput> {
    switch (actor.role) {
      case Role.ATTENDANT:
      case Role.DORM_SUPERVISOR:
        return { reportedById: actor.id };
      case Role.COUNSELING:
        return { universityId: requireUniversity(actor) };
      case Role.PSYCHOLOGIST:
        return { universityId: requireUniversity(actor), assignedPsychologistId: actor.id };
      default:
        throw new ForbiddenException();
    }
  }

  private async load(actor: AuthUser, id: string) {
    const r = await this.prisma.referral.findFirst({ where: { AND: [{ id }, await this.visible(actor)] } });
    if (!r) throw new NotFoundException('Referral not found');
    return r;
  }

  /** A psychologist may act only on referrals assigned to him; the counseling office on all. */
  private assertHandler(actor: AuthUser, r: Referral) {
    if (actor.role === Role.PSYCHOLOGIST && r.assignedPsychologistId !== actor.id) throw new ForbiddenException('This referral is not assigned to you');
  }

  async create(actor: AuthUser, dto: CreateReferralDto) {
    const universityId = requireUniversity(actor);
    const dormitoryId = requireDormitory(actor);
    const resident = await this.prisma.assignment.findFirst({ where: { studentId: dto.studentId, dormitoryId, endedAt: null } });
    if (!resident) throw new BadRequestException('The student is not a resident of your dormitory');
    const r = await this.prisma.referral.create({
      data: {
        universityId, dormitoryId, studentId: dto.studentId, reportedById: actor.id,
        concernType: dto.concernType, urgency: dto.urgency ?? Urgency.NORMAL, narrative: dto.narrative,
        status: ReferralStatus.SUBMITTED, // goes straight to the counseling office
      },
    });
    await this.audit.log({ actor, action: 'referral.create', entity: 'Referral', entityId: r.id, universityId });
    return (await this.present(actor, [r]))[0];
  }

  async list(actor: AuthUser, q: ListReferralsDto) {
    const where: Prisma.ReferralWhereInput = {
      AND: [await this.visible(actor), ...(q.status ? [{ status: q.status }] : []), ...(q.urgency ? [{ urgency: q.urgency }] : [])],
    };
    const [rows, total] = await Promise.all([
      this.prisma.referral.findMany({ where, orderBy: [{ urgency: 'desc' }, { createdAt: 'desc' }], skip: (q.page - 1) * q.limit, take: q.limit }),
      this.prisma.referral.count({ where }),
    ]);
    return { items: await this.present(actor, rows), total, page: q.page, limit: q.limit };
  }

  async get(actor: AuthUser, id: string) {
    const r = await this.load(actor, id);
    return (await this.present(actor, [r]))[0];
  }

  async receive(actor: AuthUser, id: string) {
    const r = await this.load(actor, id);
    return this.move(actor, r, [ReferralStatus.SUBMITTED], ReferralStatus.RECEIVED, { receivedById: actor.id, receivedAt: new Date() }, 'referral.receive');
  }

  /** The counseling office hands the case to one of its psychologists (also marks it as received). */
  async assign(actor: AuthUser, id: string, psychologistId: string) {
    const r = await this.load(actor, id);
    if (r.status === ReferralStatus.REJECTED || r.status === ReferralStatus.CLOSED) throw new ConflictException(`A ${r.status} referral cannot be assigned`);
    const psy = await this.prisma.user.findFirst({ where: { id: psychologistId, universityId: r.universityId, role: Role.PSYCHOLOGIST, isActive: true } });
    if (!psy) throw new NotFoundException('Psychologist not found');
    const received = r.status === ReferralStatus.SUBMITTED;
    const res = await this.prisma.referral.updateMany({
      where: { id, status: r.status },
      data: { assignedPsychologistId: psy.id, assignedAt: new Date(), ...(received ? { status: ReferralStatus.RECEIVED, receivedById: actor.id, receivedAt: new Date() } : {}) },
    });
    if (res.count === 0) throw new ConflictException('The referral changed; reload it');
    await this.audit.log({ actor, action: 'referral.assign', entity: 'Referral', entityId: id, universityId: r.universityId, meta: { psychologistId: psy.id } });
    return this.get(actor, id);
  }

  async schedule(actor: AuthUser, id: string, dto: ScheduleReferralDto) {
    const r = await this.load(actor, id);
    this.assertHandler(actor, r);
    return this.move(actor, r, [ReferralStatus.RECEIVED, ReferralStatus.SCHEDULED], ReferralStatus.SCHEDULED, {
      scheduledAt: new Date(dto.scheduledAt), ...(dto.note ? { counselingNote: dto.note } : {}),
    }, 'referral.schedule');
  }

  async close(actor: AuthUser, id: string, note?: string) {
    const r = await this.load(actor, id);
    this.assertHandler(actor, r);
    return this.move(actor, r, [ReferralStatus.RECEIVED, ReferralStatus.SCHEDULED], ReferralStatus.CLOSED, {
      closedAt: new Date(), ...(note ? { counselingNote: note } : {}),
    }, 'referral.close');
  }

  /** A counseling session with the student: confidential summary + optional plain advice for the supervisor. */
  async addSession(actor: AuthUser, id: string, dto: SessionDto) {
    const r = await this.load(actor, id);
    this.assertHandler(actor, r);
    if (r.status !== ReferralStatus.RECEIVED && r.status !== ReferralStatus.SCHEDULED) throw new ConflictException('Sessions can be recorded after the referral is received');
    const heldAt = dto.heldAt ? new Date(dto.heldAt) : new Date();
    if (heldAt.getTime() > Date.now() + 5 * 60_000) throw new BadRequestException('heldAt cannot be in the future');
    await this.prisma.$transaction([
      this.prisma.referralSession.create({
        data: {
          referralId: id, psychologistId: actor.role === Role.PSYCHOLOGIST ? actor.id : r.assignedPsychologistId ?? actor.id,
          heldAt, summary: dto.summary.trim(), recommendation: dto.recommendation?.trim() || null,
        },
      }),
      ...(dto.supervisorFeedback ? [this.prisma.referral.update({ where: { id }, data: { supervisorFeedback: dto.supervisorFeedback.trim() } })] : []),
    ]);
    await this.audit.log({ actor, action: 'referral.session', entity: 'Referral', entityId: id, universityId: r.universityId });
    return this.get(actor, id);
  }

  private async move(actor: AuthUser, r: { id: string; status: ReferralStatus; universityId: string }, from: ReferralStatus[], to: ReferralStatus, data: Prisma.ReferralUpdateManyMutationInput, action: string) {
    if (!from.includes(r.status)) throw new ConflictException(`Cannot go from ${r.status} to ${to}`);
    const res = await this.prisma.referral.updateMany({ where: { id: r.id, status: r.status }, data: { ...data, status: to } });
    if (res.count === 0) throw new ConflictException('The referral changed; reload it');
    await this.audit.log({ actor, action, entity: 'Referral', entityId: r.id, universityId: r.universityId, meta: { from: r.status, to } });
    return this.get(actor, r.id);
  }

  /** Adds student/dormitory info; clinical notes and sessions stay inside the counseling office and its psychologists. */
  private async present(actor: AuthUser, rows: Referral[]) {
    const clinical = actor.role === Role.COUNSELING || actor.role === Role.PSYCHOLOGIST;
    const ids = rows.map((r) => r.id);
    const [students, dorms, psychs, sessions] = await Promise.all([
      this.prisma.student.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.studentId))] } },
        select: {
          id: true, firstName: true, lastName: true, nationalId: true, phone: true, gender: true,
          assignments: { where: { endedAt: null }, take: 1, select: { room: { select: { number: true, building: { select: { name: true } } } } } },
        },
      }),
      this.prisma.dormitory.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.dormitoryId))] } }, select: { id: true, name: true } }),
      this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.assignedPsychologistId).filter((x): x is string => !!x))] } }, select: { id: true, firstName: true, lastName: true } }),
      clinical && ids.length ? this.prisma.referralSession.findMany({ where: { referralId: { in: ids } }, orderBy: { heldAt: 'asc' } }) : Promise.resolve([]),
    ]);
    const sMap = new Map(students.map((s) => [s.id, s]));
    const dMap = new Map(dorms.map((d) => [d.id, d.name]));
    const pMap = new Map(psychs.map((p) => [p.id, `${p.firstName} ${p.lastName}`]));
    return rows.map(({ counselingNote, ...r }) => {
      const s = sMap.get(r.studentId);
      return {
        ...r,
        ...(clinical ? { counselingNote, sessions: sessions.filter((x) => x.referralId === r.id) } : {}),
        dormitoryName: dMap.get(r.dormitoryId) ?? null,
        assignedPsychologistName: r.assignedPsychologistId ? pMap.get(r.assignedPsychologistId) ?? null : null,
        student: s ? { id: s.id, firstName: s.firstName, lastName: s.lastName, nationalId: s.nationalId, phone: s.phone, gender: s.gender, room: s.assignments[0]?.room ?? null } : null,
      };
    });
  }

  // ======================= psychologist weekly plans =======================

  private checkTimes(start: string, end: string, from?: string | null, to?: string | null) {
    if (start >= end) throw new BadRequestException('endTime must be after startTime');
    if (from && to && to < from) throw new BadRequestException('validTo must not be before validFrom');
  }

  async createSchedule(actor: AuthUser, dto: CreatePsychScheduleDto) {
    const universityId = requireUniversity(actor);
    this.checkTimes(dto.startTime, dto.endTime, dto.validFrom, dto.validTo);
    const [psy, dorm] = await Promise.all([
      this.prisma.user.findFirst({ where: { id: dto.psychologistId, universityId, role: Role.PSYCHOLOGIST, isActive: true } }),
      this.prisma.dormitory.findFirst({ where: { id: dto.dormitoryId, universityId } }),
    ]);
    if (!psy) throw new NotFoundException('Psychologist not found');
    if (!dorm) throw new NotFoundException('Dormitory not found');
    const s = await this.prisma.psychSchedule.create({
      data: {
        universityId, psychologistId: psy.id, dormitoryId: dorm.id, weekdays: [...new Set(dto.weekdays)].sort(), startTime: dto.startTime, endTime: dto.endTime,
        validFrom: dto.validFrom ? dateOnly(dto.validFrom) : null, validTo: dto.validTo ? dateOnly(dto.validTo) : null,
        location: dto.location, note: dto.note, createdById: actor.id,
      },
    });
    await this.audit.log({ actor, action: 'psych_schedule.create', entity: 'PsychSchedule', entityId: s.id, universityId, meta: { psychologistId: psy.id, dormitoryId: dorm.id } });
    return s;
  }

  async updateSchedule(actor: AuthUser, id: string, dto: UpdatePsychScheduleDto) {
    const s = await this.prisma.psychSchedule.findFirst({ where: { id, universityId: requireUniversity(actor) } });
    if (!s) throw new NotFoundException('Schedule not found');
    this.checkTimes(dto.startTime ?? s.startTime, dto.endTime ?? s.endTime, dto.validFrom ?? (s.validFrom ? dateStr(s.validFrom) : null), dto.validTo ?? (s.validTo ? dateStr(s.validTo) : null));
    const updated = await this.prisma.psychSchedule.update({
      where: { id },
      data: {
        ...(dto.weekdays ? { weekdays: [...new Set(dto.weekdays)].sort() } : {}),
        ...(dto.startTime ? { startTime: dto.startTime } : {}), ...(dto.endTime ? { endTime: dto.endTime } : {}),
        ...(dto.validFrom ? { validFrom: dateOnly(dto.validFrom) } : {}), ...(dto.validTo ? { validTo: dateOnly(dto.validTo) } : {}),
        ...(dto.location !== undefined ? { location: dto.location } : {}), ...(dto.note !== undefined ? { note: dto.note } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    await this.audit.log({ actor, action: 'psych_schedule.update', entity: 'PsychSchedule', entityId: id, universityId: s.universityId, meta: { ...dto } });
    return updated;
  }

  async deleteSchedule(actor: AuthUser, id: string) {
    const res = await this.prisma.psychSchedule.deleteMany({ where: { id, universityId: requireUniversity(actor) } });
    if (res.count === 0) throw new NotFoundException('Schedule not found');
    await this.audit.log({ actor, action: 'psych_schedule.delete', entity: 'PsychSchedule', entityId: id, universityId: actor.universityId });
    return { ok: true };
  }

  private scheduleScope(actor: AuthUser, q: { dormitoryId?: string; psychologistId?: string }): Prisma.PsychScheduleWhereInput {
    const where: Prisma.PsychScheduleWhereInput = { universityId: requireUniversity(actor) };
    if (q.dormitoryId) where.dormitoryId = q.dormitoryId;
    if (q.psychologistId) where.psychologistId = q.psychologistId;
    if (actor.role === Role.PSYCHOLOGIST) where.psychologistId = actor.id;
    else if (actor.role === Role.DORM_SUPERVISOR || actor.role === Role.ATTENDANT || actor.role === Role.SERVICE_STAFF) { where.dormitoryId = requireDormitory(actor); where.isActive = true; }
    return where;
  }

  listSchedules(actor: AuthUser, q: ListPsychSchedulesDto) {
    return this.prisma.psychSchedule.findMany({
      where: this.scheduleScope(actor, q), orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }], take: 300,
      include: { psychologist: { select: { id: true, firstName: true, lastName: true } }, dormitory: { select: { name: true } } },
    });
  }

private expand<T extends PsychSchedule>(
  schedules: T[],
  from: string,
  to: string,
): { date: string; s: T }[] {
  const out: { date: string; s: T }[] = [];

  for (let i = 0; i <= daysBetween(from, to); i++) {
    const d = addDays(from, i);
    const wd = weekdayOf(d);

    for (const s of schedules) {
      if (!s.weekdays.includes(wd)) continue;
      if (s.validFrom && d < dateStr(s.validFrom)) continue;
      if (s.validTo && d > dateStr(s.validTo)) continue;

      out.push({ date: d, s });
    }
  }

  return out;
}

  /** Concrete visits (date + hours) of the weekly plans, with attendance: attended / missed / upcoming. */
  async visits(actor: AuthUser, q: VisitsQueryDto) {
    if (daysBetween(q.from, q.to) > 62 || daysBetween(q.from, q.to) < 0) throw new BadRequestException('The range must be 1 to 63 days');
    const schedules = await this.prisma.psychSchedule.findMany({
      where: { ...this.scheduleScope(actor, q), isActive: true },
      include: { psychologist: { select: { firstName: true, lastName: true } }, dormitory: { select: { name: true } } },
    });
    const presences = schedules.length
      ? await this.prisma.staffPresence.findMany({
          where: { scheduleId: { in: schedules.map((s) => s.id) }, checkInAt: { gte: tehranAt(q.from, 0), lt: tehranAt(addDays(q.to, 1), 0) } },
          select: { scheduleId: true, checkInAt: true, checkOutAt: true },
        })
      : [];
    const key = (id: string | null, d: string) => `${id}|${d}`;
    const seen = new Map<string, { checkInAt: Date; checkOutAt: Date | null }>();
    for (const p of presences) seen.set(key(p.scheduleId, todayTehran(p.checkInAt)), p);
    const now = new Date();
    return this.expand(schedules, q.from, q.to)
      .map(({ date, s }) => {
        const p = seen.get(key(s.id, date));
        const ended = at(date, s.endTime) < now;
        return {
          date, scheduleId: s.id, psychologistId: s.psychologistId, psychologistName: `${s.psychologist.firstName} ${s.psychologist.lastName}`,
          dormitoryId: s.dormitoryId, dormitoryName: s.dormitory.name, startTime: s.startTime, endTime: s.endTime, location: s.location,
          status: p ? 'ATTENDED' : ended ? 'MISSED' : 'UPCOMING', checkInAt: p?.checkInAt ?? null, checkOutAt: p?.checkOutAt ?? null,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  }

  /** عملکرد روانشناسان: presence against plan, and case work. */
  async performance(actor: AuthUser, q: { from: string; to: string }) {
    const universityId = requireUniversity(actor);
    const span = daysBetween(q.from, q.to);
    if (span < 0 || span > 92) throw new BadRequestException('The range must be 1 to 93 days');
    const from = tehranAt(q.from, 0), to = tehranAt(addDays(q.to, 1), 0);
    const today = todayTehran();
    const psychs = await this.prisma.user.findMany({ where: { universityId, role: Role.PSYCHOLOGIST, isActive: true }, select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: 'asc' } });
    const ids = psychs.map((p) => p.id);
    const [schedules, presences, sessions, referrals] = await Promise.all([
      this.prisma.psychSchedule.findMany({ where: { universityId, isActive: true, psychologistId: { in: ids } } }),
      this.prisma.staffPresence.findMany({ where: { userId: { in: ids }, checkInAt: { gte: from, lt: to } }, select: { userId: true, scheduleId: true, checkInAt: true, checkOutAt: true, unscheduled: true } }),
      this.prisma.referralSession.findMany({ where: { psychologistId: { in: ids }, heldAt: { gte: from, lt: to } }, select: { psychologistId: true } }),
      this.prisma.referral.findMany({ where: { universityId, assignedPsychologistId: { in: ids } }, select: { id: true, assignedPsychologistId: true, assignedAt: true, status: true, closedAt: true } }),
    ]);
    const firstSessions = referrals.length
      ? await this.prisma.referralSession.findMany({ where: { referralId: { in: referrals.map((r) => r.id) } }, orderBy: { heldAt: 'asc' }, select: { referralId: true, heldAt: true } })
      : [];
    const firstOf = new Map<string, Date>();
    for (const s of firstSessions) if (!firstOf.has(s.referralId)) firstOf.set(s.referralId, s.heldAt);

    const seen = new Set(presences.filter((p) => p.scheduleId).map((p) => `${p.scheduleId}|${todayTehran(p.checkInAt)}`));
    const mins = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000));
    return psychs.map((p) => {
      const occ = this.expand(schedules.filter((s) => s.psychologistId === p.id), q.from, q.to < today ? q.to : today)
        .filter(({ date, s }) => date < today || at(date, s.endTime) < new Date());
      const attended = occ.filter(({ date, s }) => seen.has(`${s.id}|${date}`)).length;
      const mine = presences.filter((x) => x.userId === p.id);
      const assigned = referrals.filter((r) => r.assignedPsychologistId === p.id);
      const delays = assigned.filter((r) => r.assignedAt && firstOf.has(r.id)).map((r) => (firstOf.get(r.id)!.getTime() - r.assignedAt!.getTime()) / 3_600_000);
      return {
        psychologistId: p.id, name: `${p.firstName} ${p.lastName}`,
        plannedVisits: occ.length, attendedVisits: attended, missedVisits: occ.length - attended,
        plannedMinutes: occ.reduce((s, { s: sc }) => s + mins(at('2000-01-01', sc.startTime), at('2000-01-01', sc.endTime)), 0),
        presenceMinutes: mine.filter((x) => x.checkOutAt).reduce((s, x) => s + mins(x.checkInAt, x.checkOutAt!), 0),
        unscheduledPresences: mine.filter((x) => x.unscheduled).length,
        sessionsHeld: sessions.filter((x) => x.psychologistId === p.id).length,
        referralsAssigned: assigned.length,
        referralsOpen: assigned.filter((r) => r.status === ReferralStatus.RECEIVED || r.status === ReferralStatus.SCHEDULED).length,
        referralsClosedInRange: assigned.filter((r) => r.closedAt && r.closedAt >= from && r.closedAt < to).length,
        avgHoursToFirstSession: delays.length ? Math.round((delays.reduce((a, b) => a + b, 0) / delays.length) * 10) / 10 : null,
      };
    });
  }
}
