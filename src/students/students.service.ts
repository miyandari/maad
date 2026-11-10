import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AssignmentKind, AssignmentEndReason, Prisma, ResidencyStatus, Role, Student } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth-user';
import { toLatin } from '../common/national-id';
import { normalizeMobile } from '../common/phone';
import { inScope, requireDormitory, requireUniversity } from '../common/scope';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateStudentDto, ListStudentsDto, PlaceDto, StudentLeaveDto, UpdateStudentDto,
} from './dto/student.dto';

const isUnique = (e: unknown): e is Prisma.PrismaClientKnownRequestError =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

const currentSelect = {
  where: { endedAt: null },
  take: 1,
  select: {
    kind: true, dormitoryId: true, startedAt: true,
    room: { select: { id: true, number: true, building: { select: { id: true, name: true } } } },
    bed: { select: { id: true, label: true } },
  },
};

@Injectable()
export class StudentsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /** Supervisors/attendants see students of their dormitory; managers see the whole university. */
  visibility(actor: AuthUser): Prisma.StudentWhereInput {
    const universityId = requireUniversity(actor);
    if (actor.role === Role.DORM_SUPERVISOR || actor.role === Role.ATTENDANT) {
      const dorm = requireDormitory(actor);
      return {
        universityId,
        OR: [{ registeredDormitoryId: dorm }, { assignments: { some: { dormitoryId: dorm, endedAt: null } } }],
      };
    }
    return { universityId };
  }

  async getVisible(actor: AuthUser, id: string): Promise<Student> {
    const s = await this.prisma.student.findFirst({ where: { id, ...this.visibility(actor) } });
    if (!s) throw new NotFoundException('Student not found');
    return s;
  }

  async create(actor: AuthUser, dto: CreateStudentDto) {
    const universityId = requireUniversity(actor);
    let gender = dto.gender;
    if (actor.role === Role.DORM_SUPERVISOR) {
      // the student's gender always follows the dormitory type (boys' / girls')
      const dorm = await this.prisma.dormitory.findUniqueOrThrow({ where: { id: requireDormitory(actor) } });
      gender = dorm.gender;
    }
    if (!gender) throw new BadRequestException('gender is required');
    try {
      const s = await this.prisma.student.create({
        data: {
          ...dto,
          gender,
          nationalId: toLatin(dto.nationalId),
          phone: normalizeMobile(dto.phone) ?? dto.phone,
          guardianPhone: dto.guardianPhone ? normalizeMobile(dto.guardianPhone) ?? dto.guardianPhone : undefined,
          universityId,
          registeredDormitoryId: actor.role === Role.DORM_SUPERVISOR ? requireDormitory(actor) : null,
        },
      });
      await this.audit.log({ actor, action: 'student.create', entity: 'Student', entityId: s.id, universityId });
      return s;
    } catch (e) {
      if (isUnique(e)) {
        throw new ConflictException('A student with this national ID already exists in your university; use /students/lookup');
      }
      throw e;
    }
  }

  /** Exact national-ID match inside the university, minimal fields: lets a supervisor re-house a known student. */
  async lookup(actor: AuthUser, nationalId: string) {
    const s = await this.prisma.student.findUnique({
      where: { universityId_nationalId: { universityId: requireUniversity(actor), nationalId: toLatin(nationalId) } },
      select: {
        id: true, firstName: true, lastName: true, gender: true, status: true,
        assignments: { where: { endedAt: null }, take: 1, select: { dormitoryId: true } },
      },
    });
    if (!s) throw new NotFoundException('Student not found');
    const { assignments, ...rest } = s;
    return { ...rest, housedInDormitoryId: assignments[0]?.dormitoryId ?? null };
  }

  async list(actor: AuthUser, q: ListStudentsDto) {
    const filters: Prisma.StudentWhereInput[] = [this.visibility(actor)];
    if (q.status) filters.push({ status: q.status });
    const active: Prisma.AssignmentWhereInput = { endedAt: null };
    if (q.dormitoryId) active.dormitoryId = q.dormitoryId;
    if (q.roomId) active.roomId = q.roomId;
    if (q.buildingId) active.room = { buildingId: q.buildingId };
    if (q.dormitoryId || q.roomId || q.buildingId) filters.push({ assignments: { some: active } });
    if (q.q) {
      filters.push({
        OR: [
          { firstName: { contains: q.q, mode: 'insensitive' } },
          { lastName: { contains: q.q, mode: 'insensitive' } },
          { nationalId: { startsWith: toLatin(q.q) } },
          { studentNumber: { startsWith: q.q } },
        ],
      });
    }
    const where: Prisma.StudentWhereInput = { AND: filters };
    const [rows, total] = await Promise.all([
      this.prisma.student.findMany({
        where, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        skip: (q.page - 1) * q.limit, take: q.limit,
        include: { assignments: currentSelect },
      }),
      this.prisma.student.count({ where }),
    ]);
    const items = rows.map(({ assignments, ...s }) => ({ ...s, current: assignments[0] ?? null }));
    return { items, total, page: q.page, limit: q.limit };
  }

  async get(actor: AuthUser, id: string) {
    await this.getVisible(actor, id);
    return this.prisma.student.findUniqueOrThrow({
      where: { id },
      include: {
        assignments: {
          orderBy: { startedAt: 'desc' },
          select: {
            id: true, kind: true, dormitoryId: true, startedAt: true, endedAt: true, endReason: true, note: true,
            room: { select: { number: true, building: { select: { name: true } } } },
            bed: { select: { label: true } },
          },
        },
        leaves: { orderBy: { startsAt: 'desc' } },
      },
    });
  }

  async update(actor: AuthUser, id: string, dto: UpdateStudentDto) {
    const s = await this.getVisible(actor, id);
    const updated = await this.prisma.student.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.phone ? { phone: normalizeMobile(dto.phone) ?? dto.phone } : {}),
        ...(dto.guardianPhone ? { guardianPhone: normalizeMobile(dto.guardianPhone) ?? dto.guardianPhone } : {}),
      },
    });
    await this.audit.log({ actor, action: 'student.update', entity: 'Student', entityId: id, universityId: s.universityId, meta: { fields: Object.keys(dto) } });
    return updated;
  }

  // ---------------- housing ----------------

  async assign(actor: AuthUser, studentId: string, dto: PlaceDto) {
    const student = await this.prisma.student.findFirst({ where: { id: studentId, universityId: requireUniversity(actor) } });
    if (!student) throw new NotFoundException('Student not found');
    if (student.status === ResidencyStatus.RESIDENT || student.status === ResidencyStatus.ON_LEAVE) {
      throw new ConflictException('Student is already housed; use /move or /checkout');
    }
    try {
      const a = await this.prisma.$transaction(async (tx) => {
        const created = await this.place(tx, actor, student, dto);
        await tx.student.update({ where: { id: studentId }, data: { status: ResidencyStatus.RESIDENT } });
        return created;
      });
      await this.audit.log({ actor, action: 'student.assign', entity: 'Student', entityId: studentId, universityId: student.universityId, meta: { roomId: dto.roomId, bedId: dto.bedId, kind: dto.kind } });
      return a;
    } catch (e) {
      throw this.mapUnique(e);
    }
  }

  async move(actor: AuthUser, studentId: string, dto: PlaceDto) {
    const student = await this.getVisible(actor, studentId);
    try {
      const a = await this.prisma.$transaction(async (tx) => {
        const current = await this.activeInScope(tx, actor, student);
        if (dto.kind === AssignmentKind.BED && dto.bedId && dto.bedId === current.bedId) {
          throw new BadRequestException('Student is already in this bed');
        }
        await tx.assignment.update({
          where: { id: current.id },
          data: {
            endedAt: new Date(),
            endReason:
              current.kind !== AssignmentKind.BED && dto.kind === AssignmentKind.BED
                ? AssignmentEndReason.FLOOR_TO_BED
                : AssignmentEndReason.ROOM_CHANGE,
            activeStudentKey: null,
            activeBedKey: null,
          },
        });
        return this.place(tx, actor, student, dto);
      });
      await this.audit.log({ actor, action: 'student.move', entity: 'Student', entityId: studentId, universityId: student.universityId, meta: { roomId: dto.roomId, bedId: dto.bedId, kind: dto.kind } });
      return a;
    } catch (e) {
      throw this.mapUnique(e);
    }
  }

  /** تسویه */
  async checkout(actor: AuthUser, studentId: string, note?: string) {
    const student = await this.getVisible(actor, studentId);
    await this.prisma.$transaction(async (tx) => {
      const current = await this.activeInScope(tx, actor, student);
      await tx.assignment.update({
        where: { id: current.id },
        data: { endedAt: new Date(), endReason: AssignmentEndReason.CHECKOUT, note, activeStudentKey: null, activeBedKey: null },
      });
      await tx.studentLeave.updateMany({ where: { studentId, returnedAt: null }, data: { returnedAt: new Date() } });
      await tx.student.update({ where: { id: studentId }, data: { status: ResidencyStatus.CHECKED_OUT } });
    });
    await this.audit.log({ actor, action: 'student.checkout', entity: 'Student', entityId: studentId, universityId: student.universityId });
    return { ok: true };
  }

  async startLeave(actor: AuthUser, studentId: string, dto: StudentLeaveDto) {
    const student = await this.getVisible(actor, studentId);
    if (student.status !== ResidencyStatus.RESIDENT) throw new ConflictException('Only resident students can go on leave');
    await this.activeInScope(this.prisma, actor, student);
    const [leave] = await this.prisma.$transaction([
      this.prisma.studentLeave.create({
        data: {
          studentId, reason: dto.reason, createdById: actor.id,
          expectedReturnAt: dto.expectedReturnAt ? new Date(dto.expectedReturnAt) : null,
        },
      }),
      this.prisma.student.update({ where: { id: studentId }, data: { status: ResidencyStatus.ON_LEAVE } }),
    ]);
    await this.audit.log({ actor, action: 'student.leave_start', entity: 'Student', entityId: studentId, universityId: student.universityId });
    return leave;
  }

  async endLeave(actor: AuthUser, studentId: string) {
    const student = await this.getVisible(actor, studentId);
    if (student.status !== ResidencyStatus.ON_LEAVE) throw new ConflictException('Student is not on leave');
    await this.activeInScope(this.prisma, actor, student);
    await this.prisma.$transaction([
      this.prisma.studentLeave.updateMany({ where: { studentId, returnedAt: null }, data: { returnedAt: new Date() } }),
      this.prisma.student.update({ where: { id: studentId }, data: { status: ResidencyStatus.RESIDENT } }),
    ]);
    await this.audit.log({ actor, action: 'student.leave_end', entity: 'Student', entityId: studentId, universityId: student.universityId });
    return { ok: true };
  }

  /** مشخصات دانشجویان هر اتاق */
  async roomResidents(actor: AuthUser, roomId: string) {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId }, include: { building: { include: { dormitory: true } } },
    });
    const d = room?.building.dormitory;
    if (!room || !d || !inScope(actor, { universityId: d.universityId, dormitoryId: d.id })) throw new NotFoundException('Room not found');
    const residents = await this.prisma.assignment.findMany({
      where: { roomId, endedAt: null },
      orderBy: { startedAt: 'asc' },
      select: {
        id: true, kind: true, startedAt: true, bed: { select: { label: true } },
        student: { select: { id: true, nationalId: true, firstName: true, lastName: true, phone: true, status: true, studentNumber: true } },
      },
    });
    return { roomId, number: room.number, capacity: room.capacity, residents };
  }

  // ---------------- helpers ----------------

  private async activeInScope(db: Prisma.TransactionClient, actor: AuthUser, student: Student) {
    const current = await db.assignment.findFirst({ where: { studentId: student.id, endedAt: null } });
    if (!current || !inScope(actor, { universityId: student.universityId, dormitoryId: current.dormitoryId })) {
      throw new ConflictException('Student has no active assignment in your scope');
    }
    return current;
  }

  private async place(tx: Prisma.TransactionClient, actor: AuthUser, student: Student, dto: PlaceDto) {
    const room = await tx.room.findUnique({ where: { id: dto.roomId }, include: { building: { include: { dormitory: true } } } });
    const dorm = room?.building.dormitory;
    if (!room || !dorm || dorm.universityId !== student.universityId || !inScope(actor, { universityId: dorm.universityId, dormitoryId: dorm.id })) {
      throw new NotFoundException('Room not found');
    }
    if (room.type !== 'RESIDENTIAL') throw new BadRequestException('This room is not a residential room');
    if (!dorm.isActive) throw new BadRequestException('Dormitory is not active');
    if (dorm.gender !== student.gender) throw new BadRequestException('Student gender does not match the dormitory');

    if (dto.kind === AssignmentKind.BED) {
      if (!dto.bedId) throw new BadRequestException('bedId is required when kind is BED');
      const bed = await tx.bed.findFirst({ where: { id: dto.bedId, roomId: room.id } });
      if (!bed) throw new BadRequestException('Bed does not belong to this room');
    } else if (dto.bedId) {
      throw new BadRequestException('bedId must be omitted for FLOOR / EXTRA');
    }
    return tx.assignment.create({
      data: {
        studentId: student.id, dormitoryId: dorm.id, roomId: room.id,
        bedId: dto.kind === AssignmentKind.BED ? dto.bedId : null,
        kind: dto.kind, note: dto.note, createdById: actor.id,
        activeStudentKey: student.id,
        activeBedKey: dto.kind === AssignmentKind.BED ? dto.bedId : null,
      },
    });
  }

  private mapUnique(e: unknown) {
    if (isUnique(e)) {
      const target = String(e.meta?.target ?? '');
      return new ConflictException(target.includes('activeBedKey') ? 'This bed is already occupied' : 'Student already has an active assignment');
    }
    return e;
  }
}
