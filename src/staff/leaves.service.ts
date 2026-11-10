import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { LeaveStatus, Prisma, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth-user';
import { requireDormitory, requireUniversity } from '../common/scope';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLeaveDto, ListLeavesDto } from './dto/staff.dto';

const OPEN: LeaveStatus[] = [LeaveStatus.PENDING_SUPERVISOR, LeaveStatus.PENDING_MANAGER, LeaveStatus.APPROVED];

@Injectable()
export class LeavesService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /** attendant/service -> supervisor -> system manager. A supervisor's own request goes straight to the manager. */
  async create(actor: AuthUser, dto: CreateLeaveDto) {
    const universityId = requireUniversity(actor);
    const dormitoryId = requireDormitory(actor);
    const start = new Date(dto.startsAt);
    const end = new Date(dto.endsAt);
    if (!(end > start)) throw new BadRequestException('endsAt must be after startsAt');
    const overlap = await this.prisma.leaveRequest.findFirst({
      where: { requesterId: actor.id, status: { in: OPEN }, startsAt: { lt: end }, endsAt: { gt: start } },
    });
    if (overlap) throw new ConflictException('You already have a leave request overlapping this period');

    const leave = await this.prisma.leaveRequest.create({
      data: {
        universityId, dormitoryId, requesterId: actor.id, kind: dto.kind, startsAt: start, endsAt: end, reason: dto.reason,
        status: actor.role === Role.DORM_SUPERVISOR ? LeaveStatus.PENDING_MANAGER : LeaveStatus.PENDING_SUPERVISOR,
      },
    });
    await this.audit.log({ actor, action: 'leave.create', entity: 'LeaveRequest', entityId: leave.id, universityId });
    return leave;
  }

  async list(actor: AuthUser, q: ListLeavesDto) {
    const where: Prisma.LeaveRequestWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.dormitoryId ? { dormitoryId: q.dormitoryId } : {}),
    };
    if (actor.role === Role.ATTENDANT || actor.role === Role.SERVICE_STAFF || q.mine) where.requesterId = actor.id;
    else if (actor.role === Role.DORM_SUPERVISOR) where.dormitoryId = requireDormitory(actor);
    else where.universityId = requireUniversity(actor);

    const [items, total] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit,
        include: { requester: { select: { id: true, firstName: true, lastName: true, role: true } } },
      }),
      this.prisma.leaveRequest.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  async decide(actor: AuthUser, id: string, approve: boolean, note?: string) {
    const leave = await this.prisma.leaveRequest.findFirst({ where: { id, universityId: requireUniversity(actor) } });
    if (!leave) throw new NotFoundException('Leave request not found');

    let next: LeaveStatus;
    let data: Prisma.LeaveRequestUpdateManyMutationInput;
    if (actor.role === Role.DORM_SUPERVISOR) {
      if (leave.dormitoryId !== requireDormitory(actor) || leave.requesterId === actor.id) throw new NotFoundException('Leave request not found');
      if (leave.status !== LeaveStatus.PENDING_SUPERVISOR) throw new ConflictException('This request is not waiting for the supervisor');
      next = approve ? LeaveStatus.PENDING_MANAGER : LeaveStatus.REJECTED;
      data = { status: next, supervisorId: actor.id, supervisorAt: new Date(), supervisorNote: note };
    } else if (actor.role === Role.SYSTEM_MANAGER) {
      if (leave.status !== LeaveStatus.PENDING_MANAGER) throw new ConflictException('This request is not waiting for the system manager');
      next = approve ? LeaveStatus.APPROVED : LeaveStatus.REJECTED;
      data = { status: next, managerId: actor.id, managerAt: new Date(), managerNote: note };
    } else {
      throw new ForbiddenException();
    }
    // the status in the WHERE clause makes double decisions impossible
    const res = await this.prisma.leaveRequest.updateMany({ where: { id, status: leave.status }, data });
    if (res.count === 0) throw new ConflictException('The request was already decided');
    await this.audit.log({ actor, action: 'leave.decide', entity: 'LeaveRequest', entityId: id, universityId: leave.universityId, meta: { from: leave.status, to: next } });
    return this.prisma.leaveRequest.findUnique({ where: { id } });
  }

  async cancel(actor: AuthUser, id: string) {
    const leave = await this.prisma.leaveRequest.findFirst({ where: { id, requesterId: actor.id } });
    if (!leave) throw new NotFoundException('Leave request not found');
    if (!OPEN.includes(leave.status) || leave.startsAt <= new Date()) throw new ConflictException('This request can no longer be cancelled');
    const res = await this.prisma.leaveRequest.updateMany({ where: { id, status: leave.status }, data: { status: LeaveStatus.CANCELLED } });
    if (res.count === 0) throw new ConflictException('The request changed; reload it');
    await this.audit.log({ actor, action: 'leave.cancel', entity: 'LeaveRequest', entityId: id, universityId: leave.universityId });
    return { ok: true };
  }
}
