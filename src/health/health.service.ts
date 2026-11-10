import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { HealthFollowStatus, Prisma, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth-user';
import { requireDormitory, requireUniversity } from '../common/scope';
import { PrismaService } from '../prisma/prisma.service';
import { CreateHealthItemDto, CreateInspectionDto, FollowUpDto, ListAlertsDto, ListInspectionsDto, UpdateHealthItemDto } from './dto/health.dto';

const OPEN: HealthFollowStatus[] = [HealthFollowStatus.OPEN, HealthFollowStatus.IN_PROGRESS];

/**
 * Health liaison (رابط بهداشت): keeps his own checklist titles, inspects any dormitory of the university and
 * fills the list. Supervisor, system manager, senior admin and super admin see the results; the supervisor
 * is alerted about problem items and records the action taken and the obstacles.
 */
@Injectable()
export class HealthService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  // ---------------- visibility ----------------

  private scope(actor: AuthUser): { universityId?: string; dormitoryId?: string } {
    switch (actor.role) {
      case Role.SUPER_ADMIN: return {};
      case Role.SENIOR_ADMIN:
      case Role.SYSTEM_MANAGER:
      case Role.HEALTH_LIAISON: return { universityId: requireUniversity(actor) };
      case Role.DORM_SUPERVISOR: return { dormitoryId: requireDormitory(actor) };
      default: throw new ForbiddenException();
    }
  }

  private async dormNames(ids: string[]) {
    const dorms = await this.prisma.dormitory.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
    return new Map(dorms.map((d) => [d.id, d.name]));
  }

  // ---------------- checklist titles (liaison) ----------------

  listItems(actor: AuthUser) {
    return this.prisma.healthItem.findMany({ where: { universityId: requireUniversity(actor) }, orderBy: { order: 'asc' } });
  }

  async createItem(actor: AuthUser, dto: CreateHealthItemDto) {
    const universityId = requireUniversity(actor);
    const max = await this.prisma.healthItem.aggregate({ _max: { order: true }, where: { universityId } });
    const item = await this.prisma.healthItem.create({ data: { universityId, title: dto.title.trim(), order: (max._max.order ?? 0) + 1 } });
    await this.audit.log({ actor, action: 'health.item_create', entity: 'HealthItem', entityId: item.id, universityId });
    return item;
  }

  async updateItem(actor: AuthUser, id: string, dto: UpdateHealthItemDto) {
    const res = await this.prisma.healthItem.updateMany({
      where: { id, universityId: requireUniversity(actor) },
      data: { ...(dto.title ? { title: dto.title.trim() } : {}), ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}), ...(dto.order ? { order: dto.order } : {}) },
    });
    if (res.count === 0) throw new NotFoundException('Checklist item not found');
    return this.prisma.healthItem.findUnique({ where: { id } });
  }

  async deleteItem(actor: AuthUser, id: string) {
    // inspections keep their own copy of the title, so deleting never changes history
    const res = await this.prisma.healthItem.deleteMany({ where: { id, universityId: requireUniversity(actor) } });
    if (res.count === 0) throw new NotFoundException('Checklist item not found');
    return { ok: true };
  }

  // ---------------- inspection ----------------

  async inspect(actor: AuthUser, dto: CreateInspectionDto) {
    const universityId = requireUniversity(actor);
    const dorm = await this.prisma.dormitory.findFirst({ where: { id: dto.dormitoryId, universityId } });
    if (!dorm) throw new NotFoundException('Dormitory not found');

    const items = await this.prisma.healthItem.findMany({ where: { universityId, isActive: true }, orderBy: { order: 'asc' } });
    if (!items.length) throw new BadRequestException('Define at least one checklist item first');
    const answers = new Map(dto.results.map((r) => [r.itemId, r]));
    if (answers.size !== dto.results.length || answers.size !== items.length || !items.every((i) => answers.has(i.id))) {
      throw new BadRequestException('Provide exactly one result for every active checklist item');
    }
    for (const i of items) {
      const a = answers.get(i.id)!;
      if (!a.ok && !a.description?.trim()) throw new BadRequestException(`Describe the problem for "${i.title}"`);
    }

    let inspectedAt = new Date();
    if (dto.inspectedAt) {
      const t = new Date(dto.inspectedAt);
      if (t.getTime() > Date.now() + 5 * 60_000) throw new BadRequestException('inspectedAt cannot be in the future');
      if (t.getTime() < Date.now() - 30 * 86_400_000) throw new BadRequestException('inspectedAt is too old');
      inspectedAt = t;
    }
    const issues = items.filter((i) => !answers.get(i.id)!.ok).length;
    const inspection = await this.prisma.healthInspection.create({
      data: {
        universityId, dormitoryId: dorm.id, inspectorId: actor.id, inspectedAt, note: dto.note, issueCount: issues,
        results: {
          create: items.map((i, idx) => {
            const a = answers.get(i.id)!;
            return {
              universityId, dormitoryId: dorm.id, position: idx + 1, itemTitle: i.title, ok: a.ok,
              description: a.description?.trim() || null, followStatus: a.ok ? null : HealthFollowStatus.OPEN,
            };
          }),
        },
      },
      include: { results: { orderBy: { position: 'asc' } } },
    });
    await this.audit.log({ actor, action: 'health.inspect', entity: 'HealthInspection', entityId: inspection.id, universityId, meta: { dormitoryId: dorm.id, issues } });
    return inspection;
  }

  async listInspections(actor: AuthUser, q: ListInspectionsDto) {
    const filters: Prisma.HealthInspectionWhereInput[] = [this.scope(actor)];
    if (q.universityId && actor.role === Role.SUPER_ADMIN) filters.push({ universityId: q.universityId });
    if (q.dormitoryId) filters.push({ dormitoryId: q.dormitoryId });
    if (q.from || q.to) filters.push({ inspectedAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lt: new Date(q.to) } : {}) } });
    if (q.onlyIssues) filters.push({ issueCount: { gt: 0 } });
    const where: Prisma.HealthInspectionWhereInput = { AND: filters };
    const [rows, total] = await Promise.all([
      this.prisma.healthInspection.findMany({
        where, orderBy: { inspectedAt: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit,
        include: { inspector: { select: { firstName: true, lastName: true } }, results: { orderBy: { position: 'asc' } } },
      }),
      this.prisma.healthInspection.count({ where }),
    ]);
    const names = await this.dormNames(rows.map((r) => r.dormitoryId));
    return { items: rows.map((r) => ({ ...r, dormitoryName: names.get(r.dormitoryId) ?? null })), total, page: q.page, limit: q.limit };
  }

  // ---------------- alerts + supervisor follow-up ----------------

  /** Problem items still waiting for a fix (the supervisor's alarm list). */
  async alerts(actor: AuthUser, q: ListAlertsDto) {
    const where: Prisma.HealthResultWhereInput = {
      AND: [this.scope(actor), { ok: false }, { followStatus: q.status ? q.status : { in: OPEN } }, ...(q.dormitoryId ? [{ dormitoryId: q.dormitoryId }] : [])],
    };
    const rows = await this.prisma.healthResult.findMany({
      where, orderBy: [{ followStatus: 'asc' }, { createdAt: 'desc' }], take: 200,
      include: { inspection: { select: { inspectedAt: true, note: true, inspector: { select: { firstName: true, lastName: true } } } } },
    });
    const names = await this.dormNames(rows.map((r) => r.dormitoryId));
    return rows.map((r) => ({ ...r, dormitoryName: names.get(r.dormitoryId) ?? null }));
  }

  /** The supervisor states what he did to fix the problem and what is blocking him. */
  async followUp(actor: AuthUser, resultId: string, dto: FollowUpDto) {
    const r = await this.prisma.healthResult.findFirst({ where: { id: resultId, dormitoryId: requireDormitory(actor), ok: false } });
    if (!r) throw new NotFoundException('Item not found');
    const next = dto.resolved ? HealthFollowStatus.RESOLVED : HealthFollowStatus.IN_PROGRESS;
    const updated = await this.prisma.healthResult.update({
      where: { id: resultId },
      data: { actionTaken: dto.actionTaken.trim(), obstacles: dto.obstacles?.trim() || null, followStatus: next, followUpById: actor.id, followUpAt: new Date() },
    });
    await this.audit.log({
      actor, action: 'health.follow_up', entity: 'HealthResult', entityId: resultId, universityId: r.universityId,
      meta: { from: r.followStatus, to: next, hasObstacles: !!dto.obstacles },
    });
    return updated;
  }
}
