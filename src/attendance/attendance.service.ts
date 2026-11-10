import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceStatus, ResidencyStatus, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth-user';
import { addDays, dateOnly, daysBetween, todayTehran } from '../common/dates';
import { inScope } from '../common/scope';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsService } from '../students/students.service';
import { HistoryQueryDto, RecordAttendanceDto } from './dto/attendance.dto';

/** How far back each role may record/correct attendance (days). */
const BACKDATE_DAYS: Partial<Record<Role, number>> = {
  [Role.ATTENDANT]: 3,
  [Role.DORM_SUPERVISOR]: 7,
  [Role.SYSTEM_MANAGER]: 3650,
};

@Injectable()
export class AttendanceService {
  constructor(private prisma: PrismaService, private audit: AuditService, private students: StudentsService) {}

  private async dormitory(actor: AuthUser, id: string) {
    const d = await this.prisma.dormitory.findUnique({ where: { id } });
    if (!d || !inScope(actor, { universityId: d.universityId, dormitoryId: d.id })) throw new NotFoundException('Dormitory not found');
    return d;
  }

  /** Tablet screen: every active resident with the mark already recorded for the day (if any). */
  async roster(actor: AuthUser, dormitoryId: string, date = todayTehran()) {
    await this.dormitory(actor, dormitoryId);
    const [assignments, marks] = await Promise.all([
      this.prisma.assignment.findMany({
        where: { dormitoryId, endedAt: null },
        select: {
          kind: true,
          bed: { select: { label: true } },
          room: { select: { number: true, building: { select: { name: true } } } },
          student: { select: { id: true, firstName: true, lastName: true, status: true } },
        },
      }),
      this.prisma.attendanceRecord.findMany({ where: { dormitoryId, date: dateOnly(date) } }),
    ]);
    const byStudent = new Map(marks.map((m) => [m.studentId, m]));
    const items = assignments
      .map((a) => {
        const m = byStudent.get(a.student.id);
        return {
          studentId: a.student.id,
          firstName: a.student.firstName,
          lastName: a.student.lastName,
          building: a.room.building.name,
          room: a.room.number,
          bed: a.bed?.label ?? null,
          kind: a.kind,
          residencyStatus: a.student.status,
          recorded: !!m,
          // students on leave default to ON_LEAVE until a mark is recorded
          status: m?.status ?? (a.student.status === ResidencyStatus.ON_LEAVE ? AttendanceStatus.ON_LEAVE : null),
          note: m?.note ?? null,
        };
      })
      .sort((x, y) => x.building.localeCompare(y.building) || x.room.localeCompare(y.room, undefined, { numeric: true }));
    return { dormitoryId, date, total: items.length, recorded: items.filter((i) => i.recorded).length, items };
  }

  async record(actor: AuthUser, dormitoryId: string, dto: RecordAttendanceDto) {
    const d = await this.dormitory(actor, dormitoryId);
    const today = todayTehran();
    const date = dto.date ?? today;
    if (date > today) throw new BadRequestException('Attendance cannot be recorded for a future date');
    const maxBack = BACKDATE_DAYS[actor.role] ?? 0;
    if (date < addDays(today, -maxBack)) throw new ForbiddenException(`Your role may only record attendance up to ${maxBack} day(s) back`);

    const ids = dto.records.map((r) => r.studentId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Duplicate studentId in records');
    const residents = await this.prisma.assignment.findMany({
      where: { dormitoryId, endedAt: null, studentId: { in: ids } }, select: { studentId: true },
    });
    const ok = new Set(residents.map((r) => r.studentId));
    const unknown = ids.filter((i) => !ok.has(i));
    if (unknown.length) throw new BadRequestException(`Not residents of this dormitory: ${unknown.join(', ')}`);

    await this.prisma.$transaction(
      dto.records.map((r) =>
        this.prisma.attendanceRecord.upsert({
          where: { studentId_date: { studentId: r.studentId, date: dateOnly(date) } },
          create: { studentId: r.studentId, dormitoryId, date: dateOnly(date), status: r.status, note: r.note, recordedById: actor.id },
          update: { dormitoryId, status: r.status, note: r.note, recordedById: actor.id },
        }),
      ),
    );
    await this.audit.log({
      actor, action: 'attendance.record', entity: 'Dormitory', entityId: dormitoryId, universityId: d.universityId,
      meta: { date, count: dto.records.length, absent: dto.records.filter((r) => r.status === AttendanceStatus.ABSENT).length },
    });
    return { date, saved: dto.records.length };
  }

  async studentHistory(actor: AuthUser, studentId: string, q: HistoryQueryDto) {
    await this.students.getVisible(actor, studentId);
    if (q.to < q.from) throw new BadRequestException('"to" must be >= "from"');
    if (daysBetween(q.from, q.to) > 366) throw new BadRequestException('Range is limited to one year');
    return this.prisma.attendanceRecord.findMany({
      where: { studentId, date: { gte: dateOnly(q.from), lte: dateOnly(q.to) } },
      orderBy: { date: 'desc' },
      select: { date: true, status: true, note: true, dormitoryId: true, recordedAt: true },
    });
  }
}
