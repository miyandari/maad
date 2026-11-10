import {
  BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BatchStatus, Prisma, RecipientType, ResidencyStatus, Role, SmsStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth-user';
import { startOfTehranDay } from '../common/dates';
import { normalizeMobile } from '../common/phone';
import { inScope, requireDormitory, requireUniversity } from '../common/scope';
import { PrismaService } from '../prisma/prisma.service';
import {
  AudienceDto, BoardQueryDto, CreateMessageTemplateDto, ListBatchesDto, ListInboxDto, SendMessageDto,
} from './dto/messaging.dto';
import { ISmsProvider, SMS_PROVIDER } from './sms/sms-provider';
import { persianDate, render, smsParts } from './text';

interface Rcpt {
  type: RecipientType;
  userId?: string;
  studentId?: string;
  dormitoryId: string;
  dormitoryName: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  optOut: boolean;
}

const MAX_RECIPIENTS = 5000;
const VISIBLE_BATCH: BatchStatus[] = [BatchStatus.QUEUED, BatchStatus.COMPLETED];

@Injectable()
export class MessagingService {
  private costPerPart: number;
  private dailyLimits: Partial<Record<Role, number>>;

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    config: ConfigService,
    @Inject(SMS_PROVIDER) private provider: ISmsProvider,
  ) {
    this.costPerPart = Number(config.get('SMS_COST_PER_PART') ?? 0);
    try {
      this.dailyLimits = JSON.parse(config.get<string>('SMS_DAILY_LIMITS') ?? '{}');
    } catch {
      this.dailyLimits = {};
    }
  }

  // ======================= audience =======================

  /** System manager -> staff of any dormitories/roles/posts. Supervisor -> own residents (filters) or own attendants/service staff. */
  private async resolve(actor: AuthUser, a: AudienceDto): Promise<Rcpt[]> {
    const universityId = requireUniversity(actor);
    const isManager = actor.role === Role.SYSTEM_MANAGER;
    const isSupervisor = actor.role === Role.DORM_SUPERVISOR;
    if (!isManager && !isSupervisor) throw new ForbiddenException();

    let dormWhere: Prisma.DormitoryWhereInput = { universityId };
    if (isSupervisor) {
      const own = requireDormitory(actor);
      if (a.dormitoryIds?.some((d) => d !== own)) throw new ForbiddenException('You can only message your own dormitory');
      dormWhere = { id: own, universityId };
    } else if (a.dormitoryIds?.length) {
      dormWhere = { universityId, id: { in: a.dormitoryIds } };
    }
    const dorms = await this.prisma.dormitory.findMany({ where: dormWhere, select: { id: true, name: true } });
    if (a.dormitoryIds?.length && dorms.length !== new Set(a.dormitoryIds).size) throw new NotFoundException('Some dormitories were not found');
    const names = new Map(dorms.map((d) => [d.id, d.name]));
    const dormIds = dorms.map((d) => d.id);

    let out: Rcpt[];
    if (a.type === 'STAFF') {
      const allowed: Role[] = isManager ? [Role.DORM_SUPERVISOR, Role.ATTENDANT, Role.SERVICE_STAFF] : [Role.ATTENDANT, Role.SERVICE_STAFF];
      const roles = a.roles?.length ? a.roles : allowed;
      if (roles.some((r) => !allowed.includes(r))) throw new ForbiddenException('You cannot message one of the selected roles');
      const or: Prisma.UserWhereInput[] = roles.map((r) =>
        r === Role.ATTENDANT && a.workerPosts?.length ? { role: r, isStudentWorker: true, workerPost: { in: a.workerPosts } } : { role: r },
      );
      const users = await this.prisma.user.findMany({
        where: { universityId, isActive: true, dormitoryId: { in: dormIds }, OR: or },
        select: { id: true, firstName: true, lastName: true, phone: true, smsOptOut: true, dormitoryId: true },
      });
      out = users.map((u) => ({
        type: RecipientType.USER, userId: u.id, dormitoryId: u.dormitoryId!, dormitoryName: names.get(u.dormitoryId!) ?? '',
        firstName: u.firstName, lastName: u.lastName, phone: u.phone, optOut: u.smsOptOut,
      }));
    } else {
      if (!isSupervisor) throw new ForbiddenException('Only a dormitory supervisor can message residents');
      const statuses = a.residencyStatuses?.length ? a.residencyStatuses : [ResidencyStatus.RESIDENT, ResidencyStatus.ON_LEAVE];
      const rows = await this.prisma.assignment.findMany({
        where: {
          dormitoryId: { in: dormIds }, endedAt: null,
          ...(a.roomIds?.length ? { roomId: { in: a.roomIds } } : {}),
          ...(a.buildingIds?.length ? { room: { buildingId: { in: a.buildingIds } } } : {}),
          student: { status: { in: statuses } },
        },
        select: { dormitoryId: true, student: { select: { id: true, firstName: true, lastName: true, phone: true, smsOptOut: true } } },
      });
      out = rows.map((r) => ({
        type: RecipientType.STUDENT, studentId: r.student.id, dormitoryId: r.dormitoryId, dormitoryName: names.get(r.dormitoryId) ?? '',
        firstName: r.student.firstName, lastName: r.student.lastName, phone: r.student.phone, optOut: r.student.smsOptOut,
      }));
    }
    if (out.length > MAX_RECIPIENTS) throw new BadRequestException(`Too many recipients (${out.length}); the limit is ${MAX_RECIPIENTS} per message`);
    return out;
  }

  /** Shared by preview and send: resolves recipients, renders every message, counts SMS parts and cost. */
  private async prepare(actor: AuthUser, dto: SendMessageDto) {
    if (!dto.inApp && !dto.sms) throw new BadRequestException('Choose at least one channel (inApp / sms)');
    if (dto.sms && !actor.permissions?.includes('sms.send')) throw new ForbiddenException('You need the sms.send permission to send SMS');
    let body = dto.body;
    if (dto.templateId) {
      const t = await this.prisma.messageTemplate.findFirst({ where: { id: dto.templateId, universityId: requireUniversity(actor) } });
      if (!t) throw new NotFoundException('Template not found');
      body = t.body;
    }
    if (!body?.trim()) throw new BadRequestException('Provide body or templateId');

    const recipients = await this.resolve(actor, dto.audience);
    if (!recipients.length) throw new BadRequestException('No recipients match this selection');
    const date = persianDate();
    const rows = recipients.map((r) => {
      const name = `${r.firstName} ${r.lastName}`.trim();
      const text = render(body!, { firstName: r.firstName, lastName: r.lastName, fullName: name, dormitoryName: r.dormitoryName, date });
      return { r, name, text, phone: normalizeMobile(r.phone) };
    });
    const deliverable = rows.filter((x) => x.phone && !x.r.optOut);
    const parts = dto.sms ? deliverable.reduce((sum, x) => sum + smsParts(x.text), 0) : 0;
    const cost = dto.sms && this.costPerPart > 0 ? parts * this.costPerPart : null;
    return {
      body: body!, rows, parts, cost,
      smsRecipients: dto.sms ? deliverable.length : 0,
      noPhone: dto.sms ? rows.filter((x) => !x.phone).length : 0,
      optedOut: dto.sms ? rows.filter((x) => x.phone && x.r.optOut).length : 0,
    };
  }

  private async dailyUsage(actor: AuthUser) {
    const limit = this.dailyLimits[actor.role] ?? null;
    const agg = await this.prisma.messageBatch.aggregate({
      _sum: { smsRecipients: true },
      where: { senderId: actor.id, createdAt: { gte: startOfTehranDay() }, status: { not: BatchStatus.CANCELLED } },
    });
    return { limit, used: agg._sum.smsRecipients ?? 0 };
  }

  // ======================= preview / send =======================

  async preview(actor: AuthUser, dto: SendMessageDto) {
    const p = await this.prepare(actor, dto);
    const balance = dto.sms ? await this.provider.getBalance().catch(() => null) : null;
    const usage = dto.sms ? await this.dailyUsage(actor) : null;
    return {
      totalRecipients: p.rows.length,
      smsRecipients: p.smsRecipients,
      withoutValidPhone: p.noPhone,
      optedOut: p.optedOut,
      smsParts: p.parts,
      estimatedCost: p.cost, // Rials; null when SMS_COST_PER_PART is not configured
      balance,
      creditSufficient: p.cost !== null && balance !== null ? balance >= p.cost : null,
      dailyLimit: usage?.limit ?? null,
      dailyUsed: usage?.used ?? null,
      sample: p.rows[0].text,
    };
  }

  async send(actor: AuthUser, dto: SendMessageDto) {
    const p = await this.prepare(actor, dto);
    const universityId = requireUniversity(actor);

    let scheduledAt: Date | null = null;
    if (dto.scheduledAt) {
      const when = new Date(dto.scheduledAt);
      if (when.getTime() - Date.now() > 90 * 86_400_000) throw new BadRequestException('scheduledAt is more than 90 days ahead');
      if (when.getTime() > Date.now() + 30_000) scheduledAt = when;
    }

    if (dto.sms) {
      const { limit, used } = await this.dailyUsage(actor);
      if (limit !== null && used + p.smsRecipients > limit) {
        throw new HttpException(`Daily SMS limit reached (${used}/${limit} used, this message needs ${p.smsRecipients})`, 429);
      }
      if (!dto.force && p.cost !== null) {
        const balance = await this.provider.getBalance().catch(() => null);
        if (balance !== null && balance < p.cost) {
          throw new ConflictException({ code: 'INSUFFICIENT_SMS_CREDIT', message: 'SMS credit is lower than the estimated cost', balance, estimatedCost: p.cost });
        }
      }
    }

    const sender = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: { firstName: true, lastName: true } });
    const status = scheduledAt ? BatchStatus.SCHEDULED : dto.sms ? BatchStatus.QUEUED : BatchStatus.COMPLETED;

    const batch = await this.prisma.$transaction(async (tx) => {
      const b = await tx.messageBatch.create({
        data: {
          universityId, senderId: actor.id, senderName: `${sender.firstName} ${sender.lastName}`, senderRole: actor.role,
          body: p.body, inApp: dto.inApp, sms: dto.sms, audience: dto.audience as unknown as Prisma.InputJsonValue,
          scheduledAt, status, totalRecipients: p.rows.length, smsRecipients: p.smsRecipients, smsParts: p.parts, estimatedCost: p.cost,
        },
      });
      for (let i = 0; i < p.rows.length; i += 1000) {
        await tx.messageRecipient.createMany({
          data: p.rows.slice(i, i + 1000).map((x) => ({
            batchId: b.id, recipientType: x.r.type, userId: x.r.userId, studentId: x.r.studentId, dormitoryId: x.r.dormitoryId,
            name: x.name, phone: x.phone ?? x.r.phone, renderedBody: x.text,
            smsStatus: !dto.sms ? SmsStatus.NONE : x.phone && !x.r.optOut ? SmsStatus.PENDING : SmsStatus.FAILED,
            error: !dto.sms ? null : !x.phone ? 'NO_VALID_PHONE' : x.r.optOut ? 'OPTED_OUT' : null,
          })),
        });
      }
      return b;
    });
    await this.audit.log({
      actor, action: 'message.send', entity: 'MessageBatch', entityId: batch.id, universityId,
      meta: { channels: { inApp: dto.inApp, sms: dto.sms }, recipients: p.rows.length, smsRecipients: p.smsRecipients, scheduledAt: scheduledAt?.toISOString() ?? null },
    });
    return {
      id: batch.id, status: batch.status, totalRecipients: p.rows.length, smsRecipients: p.smsRecipients,
      withoutValidPhone: p.noPhone, optedOut: p.optedOut, smsParts: p.parts, estimatedCost: p.cost,
    };
  }

  // ======================= history / delivery report =======================

  private batchScope(actor: AuthUser): Prisma.MessageBatchWhereInput {
    return actor.role === Role.SYSTEM_MANAGER
      ? { universityId: requireUniversity(actor) }
      : { universityId: requireUniversity(actor), senderId: actor.id };
  }

  async listBatches(actor: AuthUser, q: ListBatchesDto) {
    const where: Prisma.MessageBatchWhereInput = { AND: [this.batchScope(actor), ...(q.status ? [{ status: q.status }] : [])] };
    const [items, total] = await Promise.all([
      this.prisma.messageBatch.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit,
        select: {
          id: true, senderName: true, senderRole: true, body: true, inApp: true, sms: true, audience: true, scheduledAt: true,
          status: true, totalRecipients: true, smsRecipients: true, smsParts: true, estimatedCost: true, createdAt: true,
        },
      }),
      this.prisma.messageBatch.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  async batchDetail(actor: AuthUser, id: string) {
    const b = await this.prisma.messageBatch.findFirst({ where: { AND: [{ id }, this.batchScope(actor)] } });
    if (!b) throw new NotFoundException('Message not found');
    const [counts, failures] = await Promise.all([
      this.prisma.messageRecipient.groupBy({ by: ['smsStatus'], where: { batchId: id }, _count: { _all: true } }),
      this.prisma.messageRecipient.findMany({
        where: { batchId: id, smsStatus: SmsStatus.FAILED }, take: 100,
        select: { name: true, phone: true, error: true, recipientType: true },
      }),
    ]);
    return {
      batch: b,
      sms: Object.fromEntries(counts.map((c) => [c.smsStatus, c._count._all])),
      failures,
    };
  }

  async cancel(actor: AuthUser, id: string) {
    const b = await this.prisma.messageBatch.findFirst({ where: { AND: [{ id }, this.batchScope(actor)] } });
    if (!b) throw new NotFoundException('Message not found');
    if (b.status !== BatchStatus.SCHEDULED && b.status !== BatchStatus.QUEUED) throw new ConflictException('Only scheduled or queued messages can be cancelled');
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.messageBatch.updateMany({ where: { id, status: b.status }, data: { status: BatchStatus.CANCELLED } });
      if (res.count === 0) throw new ConflictException('The message changed; reload it');
      await tx.messageRecipient.updateMany({ where: { batchId: id, smsStatus: SmsStatus.PENDING }, data: { smsStatus: SmsStatus.FAILED, error: 'CANCELLED' } });
    });
    await this.audit.log({ actor, action: 'message.cancel', entity: 'MessageBatch', entityId: id, universityId: b.universityId });
    return { ok: true };
  }

  async balance() {
    return { provider: this.provider.name, balance: await this.provider.getBalance() };
  }

  // ======================= templates =======================

  async createTemplate(actor: AuthUser, dto: CreateMessageTemplateDto) {
    try {
      return await this.prisma.messageTemplate.create({ data: { ...dto, universityId: requireUniversity(actor), createdById: actor.id } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('A template with this name already exists');
      throw e;
    }
  }

  listTemplates(actor: AuthUser) {
    return this.prisma.messageTemplate.findMany({ where: { universityId: requireUniversity(actor) }, orderBy: { name: 'asc' } });
  }

  async deleteTemplate(actor: AuthUser, id: string) {
    const res = await this.prisma.messageTemplate.deleteMany({ where: { id, universityId: requireUniversity(actor) } });
    if (res.count === 0) throw new NotFoundException('Template not found');
    return { ok: true };
  }

  // ======================= in-app: staff inbox + tablet board =======================

  async inbox(actor: AuthUser, q: ListInboxDto) {
    const where: Prisma.MessageRecipientWhereInput = {
      userId: actor.id, batch: { inApp: true, status: { in: VISIBLE_BATCH } }, ...(q.unreadOnly ? { readAt: null } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.messageRecipient.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit,
        select: { id: true, renderedBody: true, readAt: true, createdAt: true, batch: { select: { senderName: true } } },
      }),
      this.prisma.messageRecipient.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  async markRead(actor: AuthUser, id: string) {
    const res = await this.prisma.messageRecipient.updateMany({ where: { id, userId: actor.id, readAt: null }, data: { readAt: new Date() } });
    return { updated: res.count };
  }

  /** Announcements for residents, shown on the dormitory tablet. Personal variables are neutralised. */
  async board(actor: AuthUser, q: BoardQueryDto) {
    const dorm = await this.prisma.dormitory.findUnique({ where: { id: q.dormitoryId } });
    if (!dorm || !inScope(actor, { universityId: dorm.universityId, dormitoryId: dorm.id })) throw new NotFoundException('Dormitory not found');
    const batches = await this.prisma.messageBatch.findMany({
      where: {
        inApp: true, status: { in: VISIBLE_BATCH },
        recipients: { some: { dormitoryId: dorm.id, recipientType: RecipientType.STUDENT } },
      },
      orderBy: { createdAt: 'desc' }, take: 50,
      select: { id: true, body: true, senderName: true, createdAt: true },
    });
    const date = persianDate();
    return batches.map((b) => ({
      id: b.id, senderName: b.senderName, createdAt: b.createdAt,
      body: render(b.body, { firstName: 'دانشجوی گرامی', lastName: '', fullName: 'دانشجوی گرامی', dormitoryName: dorm.name, date }),
    }));
  }
}
