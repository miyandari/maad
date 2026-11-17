import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ResidencyStatus, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth-user';
import { dateOnly } from '../common/dates';
import { requireDormitory, requireUniversity } from '../common/scope';
import { PrismaService } from '../prisma/prisma.service';
import { AppointRepDto, ListFeedbackDto } from './dto/portal.dto';

/** نماینده شورای صنفی (appointed by the senior admin, one per dormitory, normally for one year) and the staff-feedback view. */
@Injectable()
export class CouncilService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async appoint(actor: AuthUser, dto: AppointRepDto) {
    const universityId = requireUniversity(actor);
    const dorm = await this.prisma.dormitory.findFirst({ where: { id: dto.dormitoryId, universityId } });
    if (!dorm) throw new NotFoundException('Dormitory not found');
    const student = await this.prisma.student.findFirst({
      where: { id: dto.studentId, universityId, status: { in: [ResidencyStatus.RESIDENT, ResidencyStatus.ON_LEAVE] }, assignments: { some: { dormitoryId: dorm.id, endedAt: null } } },
    });
    if (!student) throw new NotFoundException('The student must currently live in this dormitory');
    const endsAt = dto.endsAt ? dateOnly(dto.endsAt) : new Date(Date.now() + 365 * 86_400_000);
    if (endsAt.getTime() <= Date.now()) throw new ConflictException('endsAt must be in the future');
    const rep = await this.prisma.$transaction(async (tx) => {
      await tx.councilRep.updateMany({ where: { dormitoryId: dorm.id, endedAt: null }, data: { endedAt: new Date() } }); // one active representative per dormitory
      return tx.councilRep.create({ data: { universityId, dormitoryId: dorm.id, studentId: student.id, endsAt, appointedById: actor.id } });
    });
    await this.audit.log({ actor, action: 'council.appoint', entity: 'CouncilRep', entityId: rep.id, universityId, meta: { dormitoryId: dorm.id, studentId: student.id } });
    return rep;
  }

  async end(actor: AuthUser, id: string) {
    const res = await this.prisma.councilRep.updateMany({ where: { id, universityId: requireUniversity(actor), endedAt: null }, data: { endedAt: new Date() } });
    if (res.count === 0) throw new NotFoundException('Representative not found');
    await this.audit.log({ actor, action: 'council.end', entity: 'CouncilRep', entityId: id, universityId: actor.universityId });
    return { ok: true };
  }

  async list(actor: AuthUser) {
    const rows = await this.prisma.councilRep.findMany({
      where: { endedAt: null, endsAt: { gte: new Date() }, ...(actor.role === Role.DORM_SUPERVISOR ? { dormitoryId: requireDormitory(actor) } : { universityId: requireUniversity(actor) }) },
      orderBy: { startsAt: 'desc' },
    });
    const [students, dorms] = await Promise.all([
      this.prisma.student.findMany({ where: { id: { in: rows.map((r) => r.studentId) } }, select: { id: true, firstName: true, lastName: true, phone: true } }),
      this.prisma.dormitory.findMany({ where: { id: { in: rows.map((r) => r.dormitoryId) } }, select: { id: true, name: true } }),
    ]);
    const sm = new Map(students.map((s) => [s.id, s])), dm = new Map(dorms.map((d) => [d.id, d.name]));
    return rows.map((r) => ({ ...r, student: sm.get(r.studentId) ?? null, dormitoryName: dm.get(r.dormitoryId) ?? null }));
  }

  // ---------------- staff feedback (system manager / senior admin) ----------------

  async feedback(actor: AuthUser, q: ListFeedbackDto) {
    const where = {
      universityId: requireUniversity(actor),
      ...(q.dormitoryId ? { dormitoryId: q.dormitoryId } : {}), ...(q.targetUserId ? { targetUserId: q.targetUserId } : {}), ...(q.kind ? { kind: q.kind } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.staffFeedback.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit }),
      this.prisma.staffFeedback.count({ where }),
    ]);
    const [students, users, dorms] = await Promise.all([
      this.prisma.student.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.studentId))] } }, select: { id: true, firstName: true, lastName: true } }),
      this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.targetUserId))] } }, select: { id: true, firstName: true, lastName: true, role: true } }),
      this.prisma.dormitory.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.dormitoryId))] } }, select: { id: true, name: true } }),
    ]);
    const sm = new Map(students.map((s) => [s.id, s])), um = new Map(users.map((u) => [u.id, u])), dm = new Map(dorms.map((d) => [d.id, d.name]));
    return {
      items: rows.map((r) => ({ ...r, student: sm.get(r.studentId) ?? null, target: um.get(r.targetUserId) ?? null, dormitoryName: dm.get(r.dormitoryId) ?? null })),
      total, page: q.page, limit: q.limit,
    };
  }

  /** Praise / suggestion counts per staff member. */
  async feedbackSummary(actor: AuthUser) {
    const universityId = requireUniversity(actor);
    const groups = await this.prisma.staffFeedback.groupBy({ by: ['targetUserId', 'kind'], where: { universityId }, _count: { _all: true } });
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(groups.map((g) => g.targetUserId))] } }, select: { id: true, firstName: true, lastName: true, role: true, dormitoryId: true } });
    const dorms = await this.prisma.dormitory.findMany({ where: { id: { in: [...new Set(users.map((u) => u.dormitoryId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
    const dm = new Map(dorms.map((d) => [d.id, d.name]));
    return users.map((u) => ({
      userId: u.id, name: `${u.firstName} ${u.lastName}`, role: u.role, dormitoryName: u.dormitoryId ? dm.get(u.dormitoryId) ?? null : null,
      praise: groups.find((g) => g.targetUserId === u.id && g.kind === 'PRAISE')?._count._all ?? 0,
      suggestions: groups.find((g) => g.targetUserId === u.id && g.kind === 'SUGGESTION')?._count._all ?? 0,
    })).sort((a, b) => b.praise - a.praise);
  }
}
