import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AssignmentKind, LeaveStatus, Prisma, Role, RoomType } from '@prisma/client';
import { AuthUser } from '../common/auth-user';
import { addDays, dateOnly, dateStr, daysBetween, todayTehran } from '../common/dates';
import { inScope, requireDormitory, requireUniversity } from '../common/scope';
import { PrismaService } from '../prisma/prisma.service';
import { AbsentQueryDto, MaintenanceSummaryQueryDto, ShiftActivityQueryDto, StaffMonthlyQueryDto } from './dto/reports.dto';

const mins = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000));
const overlapMins = (s: Date, e: Date, from: Date, to: Date) => mins(s > from ? s : from, e < to ? e : to);

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  /** Dormitory ids the caller may report on (optionally narrowed to one). */
  private async dormIds(actor: AuthUser, only?: string): Promise<string[]> {
    if (actor.role === Role.DORM_SUPERVISOR) {
      const own = requireDormitory(actor);
      if (only && only !== own) throw new NotFoundException('Dormitory not found');
      return [own];
    }
    const dorms = await this.prisma.dormitory.findMany({
      where: { universityId: requireUniversity(actor), ...(only ? { id: only } : {}) }, select: { id: true },
    });
    if (only && !dorms.length) throw new NotFoundException('Dormitory not found');
    return dorms.map((d) => d.id);
  }

  // ---------- capacity ----------

  /** Per building and room: beds, occupied beds, free beds, floor sleepers and extra persons. */
  async occupancy(actor: AuthUser, dormitoryId: string) {
    const dorm = await this.prisma.dormitory.findUnique({ where: { id: dormitoryId } });
    if (!dorm || !inScope(actor, { universityId: dorm.universityId, dormitoryId: dorm.id })) throw new NotFoundException('Dormitory not found');
    const [rooms, active] = await Promise.all([
      this.prisma.room.findMany({
        where: { type: RoomType.RESIDENTIAL, building: { dormitoryId } },
        select: { id: true, number: true, capacity: true, buildingId: true, building: { select: { name: true } } },
      }),
      this.prisma.assignment.findMany({ where: { dormitoryId, endedAt: null }, select: { roomId: true, kind: true } }),
    ]);
    const byRoom = new Map<string, { bed: number; floor: number; extra: number }>();
    for (const a of active) {
      const c = byRoom.get(a.roomId) ?? { bed: 0, floor: 0, extra: 0 };
      if (a.kind === AssignmentKind.BED) c.bed++; else if (a.kind === AssignmentKind.FLOOR) c.floor++; else c.extra++;
      byRoom.set(a.roomId, c);
    }
    const buildings = new Map<string, { buildingId: string; name: string; capacity: number; occupiedBeds: number; floorSleepers: number; extra: number }>();
    const roomRows = rooms
      .map((r) => {
        const c = byRoom.get(r.id) ?? { bed: 0, floor: 0, extra: 0 };
        const b = buildings.get(r.buildingId) ?? { buildingId: r.buildingId, name: r.building.name, capacity: 0, occupiedBeds: 0, floorSleepers: 0, extra: 0 };
        b.capacity += r.capacity; b.occupiedBeds += c.bed; b.floorSleepers += c.floor; b.extra += c.extra;
        buildings.set(r.buildingId, b);
        return { roomId: r.id, building: r.building.name, number: r.number, capacity: r.capacity, occupiedBeds: c.bed, freeBeds: r.capacity - c.bed, floorSleepers: c.floor, extra: c.extra };
      })
      .sort((a, b) => a.building.localeCompare(b.building) || a.number.localeCompare(b.number, undefined, { numeric: true }));
    const totals = [...buildings.values()].reduce(
      (t, b) => ({ capacity: t.capacity + b.capacity, occupiedBeds: t.occupiedBeds + b.occupiedBeds, floorSleepers: t.floorSleepers + b.floorSleepers, extra: t.extra + b.extra }),
      { capacity: 0, occupiedBeds: 0, floorSleepers: 0, extra: 0 },
    );
    return {
      dormitoryId, name: dorm.name, nominalCapacity: dorm.nominalCapacity, ...totals, freeBeds: totals.capacity - totals.occupiedBeds,
      buildings: [...buildings.values()].map((b) => ({ ...b, freeBeds: b.capacity - b.occupiedBeds })),
      rooms: roomRows,
    };
  }

  /** ظرفیت خالی هر خوابگاه (for the system manager's allocation decisions). */
  async vacancy(actor: AuthUser) {
    const universityId = requireUniversity(actor);
    const dorms = await this.prisma.dormitory.findMany({ where: { universityId }, orderBy: { name: 'asc' } });
    const ids = dorms.map((d) => d.id);
    const [rooms, groups] = await Promise.all([
      this.prisma.room.findMany({ where: { type: RoomType.RESIDENTIAL, building: { dormitoryId: { in: ids } } }, select: { capacity: true, building: { select: { dormitoryId: true } } } }),
      this.prisma.assignment.groupBy({ by: ['dormitoryId', 'kind'], where: { endedAt: null, dormitoryId: { in: ids } }, _count: { _all: true } }),
    ]);
    const cap = new Map<string, number>();
    for (const r of rooms) cap.set(r.building.dormitoryId, (cap.get(r.building.dormitoryId) ?? 0) + r.capacity);
    const count = (id: string, kind: AssignmentKind) => groups.find((g) => g.dormitoryId === id && g.kind === kind)?._count._all ?? 0;
    return dorms.map((d) => {
      const defined = cap.get(d.id) ?? 0;
      const occupied = count(d.id, AssignmentKind.BED);
      return {
        dormitoryId: d.id, name: d.name, gender: d.gender, ownershipType: d.ownershipType, isActive: d.isActive,
        nominalCapacity: d.nominalCapacity, definedBeds: defined, occupiedBeds: occupied, freeBeds: defined - occupied,
        floorSleepers: count(d.id, AssignmentKind.FLOOR), extra: count(d.id, AssignmentKind.EXTRA),
      };
    });
  }

  // ---------- shift activity ----------

  /**
   * Evidence from the attendants' own work during each presence (attendance marks, dormitory reports, referrals,
   * maintenance requests): counts, the longest stretch without work, and the distance recorded at check-in/out.
   * It shows gaps; whether a gap is a problem (night hours are quiet) is for the supervisor to judge.
   */
  async shiftActivity(actor: AuthUser, q: ShiftActivityQueryDto) {
    const ids = await this.dormIds(actor, q.dormitoryId);
    const from = new Date(q.from), to = new Date(q.to);
    if (!(to > from) || to.getTime() - from.getTime() > 93 * 86_400_000) throw new BadRequestException('The range must be 1 to 93 days');
    const presences = await this.prisma.staffPresence.findMany({
      where: { dormitoryId: { in: ids }, checkInAt: { gte: from, lt: to }, user: { role: Role.ATTENDANT } },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { checkInAt: 'desc' }, take: 300,
    });
    if (!presences.length) return [];
    const now = new Date();
    const userIds = [...new Set(presences.map((p) => p.userId))];
    const start = new Date(Math.min(...presences.map((p) => p.checkInAt.getTime())));
    const end = new Date(Math.max(...presences.map((p) => (p.checkOutAt ?? now).getTime())));
    const range = { gte: start, lte: end };
    const [att, reports, referrals, maint, dorms] = await Promise.all([
      this.prisma.attendanceRecord.findMany({ where: { recordedById: { in: userIds }, dormitoryId: { in: ids }, recordedAt: range }, select: { recordedById: true, dormitoryId: true, recordedAt: true } }),
      this.prisma.dormReport.findMany({ where: { authorId: { in: userIds }, dormitoryId: { in: ids }, createdAt: range }, select: { authorId: true, dormitoryId: true, createdAt: true } }),
      this.prisma.referral.findMany({ where: { reportedById: { in: userIds }, dormitoryId: { in: ids }, createdAt: range }, select: { reportedById: true, dormitoryId: true, createdAt: true } }),
      this.prisma.maintenanceRequest.findMany({ where: { requestedById: { in: userIds }, dormitoryId: { in: ids }, createdAt: range }, select: { requestedById: true, dormitoryId: true, createdAt: true } }),
      this.prisma.dormitory.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    ]);
    const dormName = new Map(dorms.map((d) => [d.id, d.name]));
    type Ev = { kind: 'attendance' | 'reports' | 'referrals' | 'maintenance'; userId: string; dormitoryId: string; at: Date };
    const events: Ev[] = [
      ...att.map((x) => ({ kind: 'attendance' as const, userId: x.recordedById, dormitoryId: x.dormitoryId, at: x.recordedAt })),
      ...reports.map((x) => ({ kind: 'reports' as const, userId: x.authorId, dormitoryId: x.dormitoryId, at: x.createdAt })),
      ...referrals.map((x) => ({ kind: 'referrals' as const, userId: x.reportedById, dormitoryId: x.dormitoryId, at: x.createdAt })),
      ...maint.filter((x) => x.requestedById).map((x) => ({ kind: 'maintenance' as const, userId: x.requestedById as string, dormitoryId: x.dormitoryId, at: x.createdAt })),
    ];
    const limit = q.gapHours * 60;
    return presences.map((p) => {
      const stop = p.checkOutAt ?? now;
      const mine = events.filter((e) => e.userId === p.userId && e.dormitoryId === p.dormitoryId && e.at >= p.checkInAt && e.at <= stop).sort((a, b) => a.at.getTime() - b.at.getTime());
      const points = [p.checkInAt, ...mine.map((e) => e.at), stop];
      let gap = { min: 0, from: p.checkInAt, to: stop };
      for (let i = 1; i < points.length; i++) {
        const m = mins(points[i - 1], points[i]);
        if (m > gap.min) gap = { min: m, from: points[i - 1], to: points[i] };
      }
      const count = (k: Ev['kind']) => mine.filter((e) => e.kind === k).length;
      const duration = mins(p.checkInAt, stop);
      return {
        presenceId: p.id, userId: p.userId, name: `${p.user.firstName} ${p.user.lastName}`.trim(),
        dormitoryId: p.dormitoryId, dormitoryName: dormName.get(p.dormitoryId) ?? null,
        checkInAt: p.checkInAt, checkOutAt: p.checkOutAt, open: !p.checkOutAt, unscheduled: p.unscheduled, durationMin: duration,
        attendance: count('attendance'), reports: count('reports'), referrals: count('referrals'), maintenance: count('maintenance'), total: mine.length,
        longestGapMin: gap.min, gapFrom: gap.from, gapTo: gap.to,
        flag: mine.length === 0 && duration >= limit ? 'NO_ACTIVITY' : gap.min >= limit ? 'LONG_GAP' : null,
        checkInDistanceM: p.checkInDistanceM, checkOutDistanceM: p.checkOutDistanceM, closedByManager: !!p.closedById,
      };
    });
  }

  // ---------- attendance ----------

  /** Residents with no PRESENT mark (or move-in) for more than `days` days. Students on approved leave are flagged. */
  async absentStudents(actor: AuthUser, q: AbsentQueryDto) {
    const ids = await this.dormIds(actor, q.dormitoryId);
    const today = todayTehran();
    const assignments = await this.prisma.assignment.findMany({
      where: { endedAt: null, dormitoryId: { in: ids } },
      select: {
        dormitoryId: true, startedAt: true,
        room: { select: { number: true, building: { select: { name: true } } } },
        student: { select: { id: true, firstName: true, lastName: true, nationalId: true, phone: true, status: true } },
      },
    });
    const last = await this.prisma.attendanceRecord.groupBy({
      by: ['studentId'], where: { studentId: { in: assignments.map((a) => a.student.id) }, status: 'PRESENT' }, _max: { date: true },
    });
    const lastPresent = new Map(last.map((l) => [l.studentId, l._max.date ? dateStr(l._max.date) : null]));
    return assignments
      .map((a) => {
        const moveIn = dateStr(a.startedAt);
        const seen = [lastPresent.get(a.student.id), moveIn].filter((x): x is string => !!x).sort().pop()!;
        return {
          studentId: a.student.id, firstName: a.student.firstName, lastName: a.student.lastName, nationalId: a.student.nationalId,
          phone: a.student.phone, dormitoryId: a.dormitoryId, building: a.room.building.name, room: a.room.number,
          lastPresentOrMoveIn: seen, absentDays: daysBetween(seen, today), onLeave: a.student.status === 'ON_LEAVE',
        };
      })
      .filter((x) => x.absentDays > q.days)
      .sort((a, b) => b.absentDays - a.absentDays);
  }

  // ---------- staff monthly work ----------

  /** کارکرد: worked minutes from closed presence records, compared with scheduled shifts and approved leave. */
  async staffMonthly(actor: AuthUser, q: StaffMonthlyQueryDto) {
    const from = new Date(q.from);
    const to = new Date(q.to);
    if (!(to > from)) throw new BadRequestException('"to" must be after "from"');
    if (to.getTime() - from.getTime() > 62 * 86_400_000) throw new BadRequestException('Range is limited to 62 days');
    const ids = await this.dormIds(actor, q.dormitoryId);

    const [presences, shifts, leaves] = await Promise.all([
      this.prisma.staffPresence.findMany({
        where: { dormitoryId: { in: ids }, checkInAt: { gte: from, lt: to }, checkOutAt: { not: null } },
        select: { userId: true, checkInAt: true, checkOutAt: true, unscheduled: true, shift: { select: { type: true, endsAt: true, overtimeMinutes: true } } },
      }),
      this.prisma.shift.findMany({
        where: { dormitoryId: { in: ids }, cancelledAt: null, startsAt: { gte: from, lt: to } },
        select: { userId: true, startsAt: true, endsAt: true, overtimeMinutes: true },
      }),
      this.prisma.leaveRequest.findMany({
        where: { dormitoryId: { in: ids }, status: LeaveStatus.APPROVED, startsAt: { lt: to }, endsAt: { gt: from } },
        select: { requesterId: true, startsAt: true, endsAt: true },
      }),
    ]);
    type Row = { overtimeScheduledMinutes: number; overtimeWorkedMinutes: number; workedMinutes: number; extraShiftMinutes: number; unscheduledMinutes: number; scheduledMinutes: number; leaveMinutes: number; presenceCount: number };
    const rows = new Map<string, Row>();
    const row = (id: string) => rows.get(id) ?? rows.set(id, { overtimeScheduledMinutes: 0, overtimeWorkedMinutes: 0, workedMinutes: 0, extraShiftMinutes: 0, unscheduledMinutes: 0, scheduledMinutes: 0, leaveMinutes: 0, presenceCount: 0 }).get(id)!;
    for (const p of presences) {
      const m = mins(p.checkInAt, p.checkOutAt!);
      const r = row(p.userId);
      r.workedMinutes += m; r.presenceCount++;
      if (p.unscheduled) r.unscheduledMinutes += m;
      if (p.shift && p.shift.type !== 'REGULAR') r.extraShiftMinutes += m;
      if (p.shift && p.shift.overtimeMinutes > 0) {
        // overtime really worked = time stayed after the normal 08:00 hand-over, capped by the planned extension
        const baseEnd = new Date(p.shift.endsAt.getTime() - p.shift.overtimeMinutes * 60_000);
        r.overtimeWorkedMinutes += Math.min(p.shift.overtimeMinutes, mins(baseEnd, p.checkOutAt!));
      }
    }
    for (const s of shifts) { const r = row(s.userId); r.scheduledMinutes += mins(s.startsAt, s.endsAt); r.overtimeScheduledMinutes += s.overtimeMinutes; }
    for (const l of leaves) row(l.requesterId).leaveMinutes += overlapMins(l.startsAt, l.endsAt, from, to);

    const users = await this.prisma.user.findMany({
      where: { id: { in: [...rows.keys()] } }, select: { id: true, firstName: true, lastName: true, role: true, isStudentWorker: true, workerPost: true, dormitoryId: true },
    });
    return {
      from: q.from, to: q.to,
      note: 'Overtime = holiday extension of a shift (stay from 08:00 to 14:00 when the next morning is a holiday). overtimeScheduledMinutes comes from the roster; overtimeWorkedMinutes from the real check-out.',
      staff: users
        .map((u) => ({ ...u, ...rows.get(u.id)! }))
        .sort((a, b) => a.lastName.localeCompare(b.lastName)),
    };
  }

  // ---------- maintenance cost ----------

  async maintenanceSummary(actor: AuthUser, q: MaintenanceSummaryQueryDto) {
    const where: Prisma.MaintenanceRequestWhereInput = {
      universityId: requireUniversity(actor),
      ...(q.dormitoryId ? { dormitoryId: q.dormitoryId } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lt: new Date(q.to) } : {}) } } : {}),
    };
    const [byStatus, byCategory] = await Promise.all([
      this.prisma.maintenanceRequest.groupBy({ by: ['status'], where, _count: { _all: true }, _sum: { estimatedCost: true, actualCost: true } }),
      this.prisma.maintenanceRequest.groupBy({ by: ['kind', 'category'], where, _count: { _all: true } }),
    ]);
    return {
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all, estimatedCost: Number(s._sum.estimatedCost ?? 0), actualCost: Number(s._sum.actualCost ?? 0) })),
      byCategory: byCategory.map((c) => ({ kind: c.kind, category: c.category, count: c._count._all })),
    };
  }
}
