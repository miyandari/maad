import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ChecklistReportStatus, MissionStatus, Prisma, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth-user';
import { dateOnly, todayTehran } from '../common/dates';
import { requireDormitory, requireUniversity } from '../common/scope';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateMissionDto, CreateTemplateDto, ListChecklistReportsDto, ListMissionsDto, SubmitChecklistDto,
} from './dto/checklist.dto';

@Injectable()
export class ChecklistsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  // ---------------- templates (system manager) ----------------

  async createTemplate(actor: AuthUser, dto: CreateTemplateDto) {
    const universityId = requireUniversity(actor);
    if (dto.dormitoryId) {
      const d = await this.prisma.dormitory.findFirst({ where: { id: dto.dormitoryId, universityId } });
      if (!d) throw new NotFoundException('Dormitory not found');
    }
    const t = await this.prisma.checklistTemplate.create({
      data: {
        universityId, dormitoryId: dto.dormitoryId, name: dto.name, createdById: actor.id,
        items: { create: dto.items.map((i, idx) => ({ title: i.title, order: idx + 1 })) },
      },
      include: { items: { orderBy: { order: 'asc' } } },
    });
    await this.audit.log({ actor, action: 'checklist.template_create', entity: 'ChecklistTemplate', entityId: t.id, universityId });
    return t;
  }

  /** Service staff and supervisors see the templates that apply to their dormitory. */
  listTemplates(actor: AuthUser) {
    const universityId = requireUniversity(actor);
    const dormBound = actor.role === Role.SERVICE_STAFF || actor.role === Role.DORM_SUPERVISOR;
    return this.prisma.checklistTemplate.findMany({
      where: {
        universityId,
        ...(dormBound ? { isActive: true, OR: [{ dormitoryId: null }, { dormitoryId: requireDormitory(actor) }] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { items: { orderBy: { order: 'asc' } } },
    });
  }

  async setTemplateActive(actor: AuthUser, id: string, isActive: boolean) {
    const res = await this.prisma.checklistTemplate.updateMany({ where: { id, universityId: requireUniversity(actor) }, data: { isActive } });
    if (res.count === 0) throw new NotFoundException('Template not found');
    await this.audit.log({ actor, action: 'checklist.template_active', entity: 'ChecklistTemplate', entityId: id, meta: { isActive } });
    return { ok: true };
  }

  // ---------------- daily reports (service staff) -> supervisor approval ----------------

  async submit(actor: AuthUser, dto: SubmitChecklistDto) {
    const universityId = requireUniversity(actor);
    const dormitoryId = requireDormitory(actor);
    const date = dto.date ?? todayTehran();
    if (date > todayTehran()) throw new BadRequestException('Cannot report for a future date');
    const tpl = await this.prisma.checklistTemplate.findFirst({
      where: { id: dto.templateId, universityId, isActive: true, OR: [{ dormitoryId: null }, { dormitoryId }] },
      include: { items: true },
    });
    if (!tpl) throw new NotFoundException('Checklist template not found');
    const ids = dto.results.map((r) => r.itemId);
    if (new Set(ids).size !== ids.length || ids.length !== tpl.items.length || !tpl.items.every((i) => ids.includes(i.id))) {
      throw new BadRequestException('Provide exactly one result for every item of the checklist');
    }
    try {
      const r = await this.prisma.checklistReport.create({
        data: {
          universityId, dormitoryId, templateId: tpl.id, reporterId: actor.id, date: dateOnly(date),
          results: { create: dto.results.map((x) => ({ itemId: x.itemId, done: x.done, note: x.note })) },
        },
        include: { results: true },
      });
      await this.audit.log({ actor, action: 'checklist.submit', entity: 'ChecklistReport', entityId: r.id, universityId, meta: { date } });
      return r;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('You already submitted this checklist for that date');
      throw e;
    }
  }

  private reportScope(actor: AuthUser): Prisma.ChecklistReportWhereInput {
    if (actor.role === Role.SERVICE_STAFF) return { reporterId: actor.id };
    if (actor.role === Role.DORM_SUPERVISOR) return { dormitoryId: requireDormitory(actor) };
    return { universityId: requireUniversity(actor) };
  }

  async listReports(actor: AuthUser, q: ListChecklistReportsDto) {
    const where: Prisma.ChecklistReportWhereInput = {
      AND: [
        this.reportScope(actor),
        ...(q.date ? [{ date: dateOnly(q.date) }] : []),
        ...(q.status ? [{ status: q.status }] : []),
        ...(q.dormitoryId ? [{ dormitoryId: q.dormitoryId }] : []),
      ],
    };
    const [items, total] = await Promise.all([
      this.prisma.checklistReport.findMany({
        where, orderBy: { date: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit,
        include: {
          reporter: { select: { firstName: true, lastName: true } },
          template: { select: { name: true } },
          results: { include: { item: { select: { title: true, order: true } } } },
        },
      }),
      this.prisma.checklistReport.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  /** تأیید چک‌لیست هنگام تحویل کار */
  async decide(actor: AuthUser, id: string, approve: boolean, note?: string) {
    const r = await this.prisma.checklistReport.findFirst({ where: { id, dormitoryId: requireDormitory(actor) } });
    if (!r) throw new NotFoundException('Report not found');
    if (r.status !== ChecklistReportStatus.SUBMITTED) throw new ConflictException('Report was already decided');
    const res = await this.prisma.checklistReport.updateMany({
      where: { id, status: ChecklistReportStatus.SUBMITTED },
      data: { status: approve ? ChecklistReportStatus.APPROVED : ChecklistReportStatus.REJECTED, decidedById: actor.id, decidedAt: new Date(), decisionNote: note },
    });
    if (res.count === 0) throw new ConflictException('Report changed; reload it');
    await this.audit.log({ actor, action: 'checklist.decide', entity: 'ChecklistReport', entityId: id, universityId: r.universityId, meta: { approve } });
    return this.prisma.checklistReport.findUnique({ where: { id } });
  }

  // ---------------- missions (ماموریت) ----------------

  async createMission(actor: AuthUser, dto: CreateMissionDto) {
    const universityId = requireUniversity(actor);
    const assignee = await this.prisma.user.findFirst({ where: { id: dto.assigneeId, universityId, role: Role.SERVICE_STAFF, isActive: true } });
    if (!assignee) throw new NotFoundException('Service staff member not found');
    const m = await this.prisma.mission.create({
      data: {
        universityId, dormitoryId: assignee.dormitoryId, assigneeId: assignee.id, assignedById: actor.id,
        title: dto.title, description: dto.description, dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
      },
    });
    await this.audit.log({ actor, action: 'mission.create', entity: 'Mission', entityId: m.id, universityId, meta: { assigneeId: assignee.id } });
    return m;
  }

  async listMissions(actor: AuthUser, q: ListMissionsDto) {
    const where: Prisma.MissionWhereInput = { ...(q.status ? { status: q.status } : {}) };
    if (actor.role === Role.SERVICE_STAFF) where.assigneeId = actor.id;
    else if (actor.role === Role.DORM_SUPERVISOR) where.dormitoryId = requireDormitory(actor);
    else where.universityId = requireUniversity(actor);
    const [items, total] = await Promise.all([
      this.prisma.mission.findMany({
        where, orderBy: [{ status: 'asc' }, { dueAt: 'asc' }], skip: (q.page - 1) * q.limit, take: q.limit,
        include: { assignee: { select: { firstName: true, lastName: true } } },
      }),
      this.prisma.mission.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  async completeMission(actor: AuthUser, id: string, resultNote?: string) {
    const res = await this.prisma.mission.updateMany({
      where: { id, assigneeId: actor.id, status: MissionStatus.ASSIGNED },
      data: { status: MissionStatus.DONE, doneAt: new Date(), resultNote },
    });
    if (res.count === 0) throw new NotFoundException('Open mission not found');
    await this.audit.log({ actor, action: 'mission.complete', entity: 'Mission', entityId: id });
    return this.prisma.mission.findUnique({ where: { id } });
  }
}
