import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MaintenanceStatus as S, Prisma, RequestKind, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth-user';
import { requireDormitory, requireUniversity } from '../common/scope';
import { PrismaService } from '../prisma/prisma.service';
import { ApproveMaintenanceDto, CreateMaintenanceDto, FixMaintenanceDto, ListMaintenanceDto } from './dto/maintenance.dto';

/**
 * supervisor submits -> system manager estimates & approves (or rejects) -> work starts -> manager marks it fixed
 * -> supervisor confirms (CLOSED) or sends it back (IN_PROGRESS). Every step is kept as an event (dashboard timeline).
 */
@Injectable()
export class MaintenanceService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  scope(actor: AuthUser): Prisma.MaintenanceRequestWhereInput {
    return actor.role === Role.DORM_SUPERVISOR
      ? { dormitoryId: requireDormitory(actor) }
      : { universityId: requireUniversity(actor) };
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
    return { items, total, page: q.page, limit: q.limit };
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
    return r;
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
