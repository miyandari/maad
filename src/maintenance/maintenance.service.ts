import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MaintenanceStatus as S, Prisma, RequestKind, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth-user';
import { requireDormitory, requireUniversity } from '../common/scope';
import { PrismaService } from '../prisma/prisma.service';
import { ApproveMaintenanceDto, AssignMaintenanceDto, CreateMaintenanceDto, FixMaintenanceDto, ListMaintenanceDto } from './dto/maintenance.dto';

/**
 * supervisor submits -> system manager estimates & approves (or rejects) -> work starts -> manager marks it fixed
 * -> supervisor confirms (CLOSED) or sends it back (IN_PROGRESS). Every step is kept as an event (dashboard timeline).
 */
@Injectable()
export class MaintenanceService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  scope(actor: AuthUser): Prisma.MaintenanceRequestWhereInput {
    // collective proposals waiting for the council representative are not the supervisor's business yet
    if (actor.role === Role.DORM_SUPERVISOR) return { dormitoryId: requireDormitory(actor), status: { not: S.PENDING_REP } };
    // facilities / general-affairs staff only see what was referred to them
    if (actor.role === Role.FACILITIES || actor.role === Role.GENERAL_AFFAIRS) return { universityId: requireUniversity(actor), assignedToId: actor.id };
    // managers only see requests after the supervisor approved them
    return { universityId: requireUniversity(actor), status: { notIn: [S.PENDING_REP, S.PENDING_SUPERVISOR] } };
  }

  /** Adds the assignee, the room and (for supervisors/managers only) the name of the student who filed the request. */
  private async decorate<T extends { assignedToId: string | null; requestedByStudentId: string | null; roomId: string | null }>(actor: AuthUser, rows: T[]) {
    const showStudent = actor.role === Role.DORM_SUPERVISOR || actor.role === Role.SYSTEM_MANAGER || actor.role === Role.SENIOR_ADMIN;
    const ids = (f: (r: T) => string | null) => [...new Set(rows.map(f).filter((x): x is string => !!x))];
    const [users, students, rooms] = await Promise.all([
      ids((r) => r.assignedToId).length ? this.prisma.user.findMany({ where: { id: { in: ids((r) => r.assignedToId) } }, select: { id: true, firstName: true, lastName: true, role: true } }) : [],
      showStudent && ids((r) => r.requestedByStudentId).length ? this.prisma.student.findMany({ where: { id: { in: ids((r) => r.requestedByStudentId) } }, select: { id: true, firstName: true, lastName: true, phone: true } }) : [],
      ids((r) => r.roomId).length ? this.prisma.room.findMany({ where: { id: { in: ids((r) => r.roomId) } }, select: { id: true, number: true, building: { select: { name: true } } } }) : [],
    ]);
    const um = new Map(users.map((u) => [u.id, u])), sm = new Map(students.map((x) => [x.id, x])), rm = new Map(rooms.map((x) => [x.id, x]));
    return rows.map((r) => ({
      ...r,
      assignedTo: r.assignedToId ? um.get(r.assignedToId) ?? null : null,
      requestedByStudent: r.requestedByStudentId ? sm.get(r.requestedByStudentId) ?? null : null,
      room: r.roomId ? rm.get(r.roomId) ?? null : null,
    }));
  }

  async create(actor: AuthUser, dto: CreateMaintenanceDto) {
    if (dto.kind === RequestKind.REPAIR && !dto.category) throw new BadRequestException('category is required for repair requests');
    if (dto.kind === RequestKind.EQUIPMENT && dto.category) throw new BadRequestException('category applies to repair requests only');
    const universityId = requireUniversity(actor);
    const dormitoryId = requireDormitory(actor);
    const r = await this.prisma.maintenanceRequest.create({
      data: {
        ...dto, universityId, dormitoryId, requestedById: actor.id,
        events: { create: { actorId: actor.id, toStatus: S.SUBMITTED } },
      },
    });
    await this.audit.log({ actor, action: 'maintenance.create', entity: 'MaintenanceRequest', entityId: r.id, universityId, meta: { kind: r.kind, category: r.category } });
    return r;
  }

  async list(actor: AuthUser, q: ListMaintenanceDto) {
    const where: Prisma.MaintenanceRequestWhereInput = {
      AND: [
        this.scope(actor),
        ...(q.status ? [{ status: q.status }] : []),
        ...(q.kind ? [{ kind: q.kind }] : []),
        ...(q.category ? [{ category: q.category }] : []),
        ...(q.dormitoryId ? [{ dormitoryId: q.dormitoryId }] : []),
      ],
    };
    const [items, total] = await Promise.all([
      this.prisma.maintenanceRequest.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit,
        include: { dormitory: { select: { name: true } }, requestedBy: { select: { firstName: true, lastName: true } } },
      }),
      this.prisma.maintenanceRequest.count({ where }),
    ]);
    return { items: await this.decorate(actor, items), total, page: q.page, limit: q.limit };
  }

  async get(actor: AuthUser, id: string) {
    const r = await this.prisma.maintenanceRequest.findFirst({
      where: { AND: [{ id }, this.scope(actor)] },
      include: {
        dormitory: { select: { name: true } },
        requestedBy: { select: { firstName: true, lastName: true } },
        events: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!r) throw new NotFoundException('Request not found');
    return (await this.decorate(actor, [r]))[0];
  }

  /** The system manager refers an approved request to facilities (repairs) or general affairs (equipment). */
  async assign(actor: AuthUser, id: string, dto: AssignMaintenanceDto) {
    const req = await this.prisma.maintenanceRequest.findFirst({ where: { AND: [{ id }, this.scope(actor)] } });
    if (!req) throw new NotFoundException('Request not found');
    if (req.status !== S.APPROVED && req.status !== S.IN_PROGRESS) throw new ConflictException('Only approved requests can be referred');
    const wanted = req.kind === RequestKind.REPAIR ? Role.FACILITIES : Role.GENERAL_AFFAIRS;
    const user = await this.prisma.user.findFirst({ where: { id: dto.userId, universityId: req.universityId, role: wanted, isActive: true } });
    if (!user) throw new NotFoundException(`${wanted} staff member not found`);
    await this.prisma.$transaction([
      this.prisma.maintenanceRequest.update({ where: { id }, data: { assignedToId: user.id, assignedAt: new Date() } }),
      this.prisma.maintenanceEvent.create({ data: { requestId: id, actorId: actor.id, fromStatus: req.status, toStatus: req.status, note: `ارجاع به ${user.firstName} ${user.lastName}${dto.note ? ' — ' + dto.note : ''}` } }),
    ]);
    await this.audit.log({ actor, action: 'maintenance.assign', entity: 'MaintenanceRequest', entityId: id, universityId: req.universityId, meta: { assignedToId: user.id } });
    return this.get(actor, id);
  }

  /** Progress note ("work done so far") that keeps the status unchanged. */
  async addNote(actor: AuthUser, id: string, note: string) {
    const req = await this.prisma.maintenanceRequest.findFirst({ where: { AND: [{ id }, this.scope(actor)] } });
    if (!req) throw new NotFoundException('Request not found');
    if (req.status !== S.APPROVED && req.status !== S.IN_PROGRESS) throw new ConflictException('Notes can only be added while the work is open');
    if (!note?.trim()) throw new BadRequestException('A note is required');
    await this.prisma.maintenanceEvent.create({ data: { requestId: id, actorId: actor.id, fromStatus: req.status, toStatus: req.status, note: note.trim() } });
    await this.audit.log({ actor, action: 'maintenance.note', entity: 'MaintenanceRequest', entityId: id, universityId: req.universityId });
    return this.get(actor, id);
  }

  /** Supervisor's decision on a request filed by a student. */
  supervisorApprove(actor: AuthUser, id: string, note?: string) {
    return this.transition(actor, id, [S.PENDING_SUPERVISOR], S.SUBMITTED, {}, note ?? 'تأیید سرپرست');
  }
  supervisorReject(actor: AuthUser, id: string, note?: string) {
    return this.transition(actor, id, [S.PENDING_SUPERVISOR], S.REJECTED, {}, note ?? 'رد توسط سرپرست');
  }

  approve(actor: AuthUser, id: string, dto: ApproveMaintenanceDto) {
    return this.transition(actor, id, [S.SUBMITTED], S.APPROVED, { estimatedCost: dto.estimatedCost }, dto.note);
  }
  reject(actor: AuthUser, id: string, note?: string) {
    return this.transition(actor, id, [S.SUBMITTED], S.REJECTED, {}, note);
  }
  start(actor: AuthUser, id: string, note?: string) {
    return this.transition(actor, id, [S.APPROVED], S.IN_PROGRESS, {}, note);
  }
  fix(actor: AuthUser, id: string, dto: FixMaintenanceDto) {
    return this.transition(actor, id, [S.APPROVED, S.IN_PROGRESS], S.FIXED, dto.actualCost !== undefined ? { actualCost: dto.actualCost } : {}, dto.note);
  }
  confirm(actor: AuthUser, id: string, note?: string) {
    return this.transition(actor, id, [S.FIXED], S.CLOSED, {}, note);
  }
  reopen(actor: AuthUser, id: string, note?: string) {
    return this.transition(actor, id, [S.FIXED], S.IN_PROGRESS, {}, note ?? 'Not fixed');
  }

  private async transition(actor: AuthUser, id: string, from: S[], to: S, data: Prisma.MaintenanceRequestUpdateManyMutationInput, note?: string) {
    const req = await this.prisma.maintenanceRequest.findFirst({ where: { AND: [{ id }, this.scope(actor)] } });
    if (!req) throw new NotFoundException('Request not found');
    if (!from.includes(req.status)) throw new ConflictException(`Cannot go from ${req.status} to ${to}`);
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.maintenanceRequest.updateMany({ where: { id, status: req.status }, data: { ...data, status: to } });
      if (res.count === 0) throw new ConflictException('The request changed; reload it');
      await tx.maintenanceEvent.create({ data: { requestId: id, actorId: actor.id, fromStatus: req.status, toStatus: to, note } });
    });
    await this.audit.log({ actor, action: 'maintenance.transition', entity: 'MaintenanceRequest', entityId: id, universityId: req.universityId, meta: { from: req.status, to } });
    return this.get(actor, id);
  }
}
