import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReportCategory, ReportStatus, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth-user';
import { requireDormitory, requireUniversity } from '../common/scope';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDormReportDto, ListDormReportsDto } from './dto/dorm-report.dto';

@Injectable()
export class DormReportsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /**
   * attendants see their own reports, the supervisor sees the whole dormitory,
   * managers only see what a supervisor escalated to them ("important reports").
   */
  scope(actor: AuthUser): Prisma.DormReportWhereInput {
    if (actor.role === Role.ATTENDANT) return { authorId: actor.id };
    if (actor.role === Role.DORM_SUPERVISOR) return { dormitoryId: requireDormitory(actor) };
    return { universityId: requireUniversity(actor), status: ReportStatus.ESCALATED };
  }

  async create(actor: AuthUser, dto: CreateDormReportDto) {
    const universityId = requireUniversity(actor);
    const dormitoryId = requireDormitory(actor);
    const food = dto.category === ReportCategory.FOOD_RECEIPT || dto.category === ReportCategory.FOOD_DELIVERY;
    if (food && (!dto.mealType || dto.quantity === undefined)) throw new BadRequestException('mealType and quantity are required for food reports');
    if (dto.category === ReportCategory.OFFICIAL_VISIT && !dto.visitorName) throw new BadRequestException('visitorName is required');
    if (dto.category === ReportCategory.UNEXPECTED_BEHAVIOR && !dto.description) throw new BadRequestException('description is required');
    if (dto.studentId) {
      const resident = await this.prisma.assignment.findFirst({ where: { studentId: dto.studentId, dormitoryId, endedAt: null } });
      if (!resident) throw new BadRequestException('The student is not a resident of your dormitory');
    }
    const r = await this.prisma.dormReport.create({
      data: {
        ...dto, occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
        universityId, dormitoryId, authorId: actor.id,
      },
    });
    await this.audit.log({ actor, action: 'report.create', entity: 'DormReport', entityId: r.id, universityId, meta: { category: r.category } });
    return r;
  }

  async list(actor: AuthUser, q: ListDormReportsDto) {
    const filters: Prisma.DormReportWhereInput[] = [this.scope(actor)];
    if (q.category) filters.push({ category: q.category });
    if (q.status && actor.role !== Role.SENIOR_ADMIN && actor.role !== Role.SYSTEM_MANAGER) filters.push({ status: q.status });
    if (q.dormitoryId) filters.push({ dormitoryId: q.dormitoryId });
    if (q.from || q.to) filters.push({ occurredAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } });
    const where: Prisma.DormReportWhereInput = { AND: filters };
    const [items, total] = await Promise.all([
      this.prisma.dormReport.findMany({
        where, orderBy: { occurredAt: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit,
        include: { author: { select: { id: true, firstName: true, lastName: true } } },
      }),
      this.prisma.dormReport.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  async get(actor: AuthUser, id: string) {
    const r = await this.prisma.dormReport.findFirst({
      where: { AND: [{ id }, this.scope(actor)] },
      include: { author: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (!r) throw new NotFoundException('Report not found');
    return r;
  }

  async review(actor: AuthUser, id: string, note?: string) {
    return this.move(actor, id, [ReportStatus.SUBMITTED], ReportStatus.REVIEWED, { reviewNote: note }, 'report.review');
  }

  async escalate(actor: AuthUser, id: string, note?: string) {
    return this.move(actor, id, [ReportStatus.SUBMITTED, ReportStatus.REVIEWED], ReportStatus.ESCALATED, { reviewNote: note, escalatedAt: new Date() }, 'report.escalate');
  }

  private async move(actor: AuthUser, id: string, from: ReportStatus[], to: ReportStatus, data: Prisma.DormReportUpdateManyMutationInput, action: string) {
    const r = await this.prisma.dormReport.findFirst({ where: { id, dormitoryId: requireDormitory(actor) } });
    if (!r) throw new NotFoundException('Report not found');
    if (!from.includes(r.status)) throw new ConflictException(`Report is already ${r.status}`);
    const res = await this.prisma.dormReport.updateMany({
      where: { id, status: r.status },
      data: { ...data, status: to, reviewedById: actor.id, reviewedAt: new Date() },
    });
    if (res.count === 0) throw new ConflictException('Report changed; reload it');
    await this.audit.log({ actor, action, entity: 'DormReport', entityId: id, universityId: r.universityId });
    return this.prisma.dormReport.findUnique({ where: { id } });
  }
}
