import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Referral, ReferralStatus, Role, Urgency } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth-user';
import { requireDormitory, requireUniversity } from '../common/scope';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreatePsychScheduleDto, CreateReferralDto, ListPsychSchedulesDto, ListReferralsDto, ScheduleReferralDto,
} from './dto/counseling.dto';

/** The counseling office only sees referrals a supervisor approved — except urgent ones, which it sees at once. */
const COUNSELING_STATUSES: ReferralStatus[] = [ReferralStatus.APPROVED, ReferralStatus.RECEIVED, ReferralStatus.SCHEDULED, ReferralStatus.CLOSED];

@Injectable()
export class CounselingService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private visible(actor: AuthUser): Prisma.ReferralWhereInput {
    switch (actor.role) {
      case Role.ATTENDANT:
        return { reportedById: actor.id };
      case Role.DORM_SUPERVISOR:
        return { dormitoryId: requireDormitory(actor) };
      case Role.COUNSELING:
        return {
          universityId: requireUniversity(actor),
          OR: [{ status: { in: COUNSELING_STATUSES } }, { urgency: Urgency.URGENT, status: ReferralStatus.SUBMITTED }],
        };
      default:
        throw new ForbiddenException();
    }
  }

  private async load(actor: AuthUser, id: string) {
    const r = await this.prisma.referral.findFirst({ where: { AND: [{ id }, this.visible(actor)] } });
    if (!r) throw new NotFoundException('Referral not found');
    return r;
  }

  async create(actor: AuthUser, dto: CreateReferralDto) {
    const universityId = requireUniversity(actor);
    const dormitoryId = requireDormitory(actor);
    const resident = await this.prisma.assignment.findFirst({ where: { studentId: dto.studentId, dormitoryId, endedAt: null } });
    if (!resident) throw new BadRequestException('The student is not a resident of your dormitory');
    const bySupervisor = actor.role === Role.DORM_SUPERVISOR;
    const r = await this.prisma.referral.create({
      data: {
        universityId, dormitoryId, studentId: dto.studentId, reportedById: actor.id,
        concernType: dto.concernType, urgency: dto.urgency ?? Urgency.NORMAL, narrative: dto.narrative,
        status: bySupervisor ? ReferralStatus.APPROVED : ReferralStatus.SUBMITTED,
        ...(bySupervisor ? { supervisorId: actor.id, supervisorAt: new Date() } : {}),
      },
    });
    await this.audit.log({ actor, action: 'referral.create', entity: 'Referral', entityId: r.id, universityId, meta: { urgency: r.urgency, concernType: r.concernType } });
    return this.present(actor, [r]).then((x) => x[0]);
  }

  async list(actor: AuthUser, q: ListReferralsDto) {
    const where: Prisma.ReferralWhereInput = {
      AND: [this.visible(actor), ...(q.status ? [{ status: q.status }] : []), ...(q.urgency ? [{ urgency: q.urgency }] : [])],
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

  /** Supervisor step. Urgent referrals cannot be rejected here: the counseling office already sees them. */
  async decide(actor: AuthUser, id: string, approve: boolean, note?: string) {
    const r = await this.load(actor, id);
    if (r.status !== ReferralStatus.SUBMITTED) throw new ConflictException('This referral was already handled');
    if (!approve && r.urgency === Urgency.URGENT) throw new BadRequestException('Urgent referrals cannot be rejected; the counseling office decides');
    return this.move(actor, r, [ReferralStatus.SUBMITTED], approve ? ReferralStatus.APPROVED : ReferralStatus.REJECTED, {
      supervisorId: actor.id, supervisorAt: new Date(), supervisorNote: note,
    }, 'referral.decide');
  }

  async receive(actor: AuthUser, id: string) {
    const r = await this.load(actor, id);
    return this.move(actor, r, [ReferralStatus.APPROVED, ReferralStatus.SUBMITTED], ReferralStatus.RECEIVED, { receivedById: actor.id, receivedAt: new Date() }, 'referral.receive');
  }

  async schedule(actor: AuthUser, id: string, dto: ScheduleReferralDto) {
    const r = await this.load(actor, id);
    return this.move(actor, r, [ReferralStatus.RECEIVED, ReferralStatus.SCHEDULED], ReferralStatus.SCHEDULED, {
      scheduledAt: new Date(dto.scheduledAt), ...(dto.note ? { counselingNote: dto.note } : {}),
    }, 'referral.schedule');
  }

  async close(actor: AuthUser, id: string, note?: string) {
    const r = await this.load(actor, id);
    return this.move(actor, r, [ReferralStatus.RECEIVED, ReferralStatus.SCHEDULED], ReferralStatus.CLOSED, {
      closedAt: new Date(), ...(note ? { counselingNote: note } : {}),
    }, 'referral.close');
  }

  private async move(actor: AuthUser, r: { id: string; status: ReferralStatus; universityId: string }, from: ReferralStatus[], to: ReferralStatus, data: Prisma.ReferralUpdateManyMutationInput, action: string) {
    if (!from.includes(r.status)) throw new ConflictException(`Cannot go from ${r.status} to ${to}`);
    const res = await this.prisma.referral.updateMany({ where: { id: r.id, status: r.status }, data: { ...data, status: to } });
    if (res.count === 0) throw new ConflictException('The referral changed; reload it');
    await this.audit.log({ actor, action, entity: 'Referral', entityId: r.id, universityId: r.universityId, meta: { from: r.status, to } });
    return this.get(actor, r.id);
  }

  /** Adds student/dormitory info; clinical notes stay inside the counseling office. */
  private async present(actor: AuthUser, rows: Referral[]) {
    const students = await this.prisma.student.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.studentId))] } },
      select: {
        id: true, firstName: true, lastName: true, nationalId: true, phone: true, gender: true,
        assignments: { where: { endedAt: null }, take: 1, select: { room: { select: { number: true, building: { select: { name: true } } } } } },
      },
    });
    const dorms = await this.prisma.dormitory.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.dormitoryId))] } }, select: { id: true, name: true } });
    const sMap = new Map(students.map((s) => [s.id, s]));
    const dMap = new Map(dorms.map((d) => [d.id, d.name]));
    return rows.map(({ counselingNote, ...r }) => {
      const s = sMap.get(r.studentId);
      return {
        ...r,
        ...(actor.role === Role.COUNSELING ? { counselingNote } : {}),
        dormitoryName: dMap.get(r.dormitoryId) ?? null,
        student: s ? { id: s.id, firstName: s.firstName, lastName: s.lastName, nationalId: s.nationalId, phone: s.phone, gender: s.gender, room: s.assignments[0]?.room ?? null } : null,
      };
    });
  }

  // ---------------- psychologist schedule ----------------

  async createSchedule(actor: AuthUser, dto: CreatePsychScheduleDto) {
    const universityId = requireUniversity(actor);
    const start = new Date(dto.startsAt);
    const end = new Date(dto.endsAt);
    if (!(end > start)) throw new BadRequestException('endsAt must be after startsAt');
    const dorm = await this.prisma.dormitory.findFirst({ where: { id: dto.dormitoryId, universityId } });
    if (!dorm) throw new NotFoundException('Dormitory not found');
    const s = await this.prisma.psychologistSchedule.create({
      data: { universityId, dormitoryId: dorm.id, psychologistName: dto.psychologistName, startsAt: start, endsAt: end, location: dto.location, note: dto.note, createdById: actor.id },
    });
    await this.audit.log({ actor, action: 'psych_schedule.create', entity: 'PsychologistSchedule', entityId: s.id, universityId });
    return s;
  }

  listSchedules(actor: AuthUser, q: ListPsychSchedulesDto) {
    const where: Prisma.PsychologistScheduleWhereInput = {
      endsAt: { gte: q.from ? new Date(q.from) : new Date() },
      ...(q.to ? { startsAt: { lte: new Date(q.to) } } : {}),
      ...(q.dormitoryId ? { dormitoryId: q.dormitoryId } : {}),
    };
    if (actor.role === Role.COUNSELING || actor.role === Role.SYSTEM_MANAGER || actor.role === Role.SENIOR_ADMIN) where.universityId = requireUniversity(actor);
    else where.dormitoryId = requireDormitory(actor);
    return this.prisma.psychologistSchedule.findMany({
      where, orderBy: { startsAt: 'asc' }, take: 200,
      include: { dormitory: { select: { name: true } } },
    });
  }

  async deleteSchedule(actor: AuthUser, id: string) {
    const s = await this.prisma.psychologistSchedule.findFirst({ where: { id, universityId: requireUniversity(actor) } });
    if (!s) throw new NotFoundException('Schedule not found');
    await this.prisma.psychologistSchedule.delete({ where: { id } });
    await this.audit.log({ actor, action: 'psych_schedule.delete', entity: 'PsychologistSchedule', entityId: id, universityId: s.universityId });
    return { ok: true };
  }
}
