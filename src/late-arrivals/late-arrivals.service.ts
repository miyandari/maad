import { ConflictException, ForbiddenException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BatchStatus, LateKind, Prisma, RecipientType, Role, SmsStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth-user';
import { addDays, dateOnly, dateStr, todayTehran } from '../common/dates';
import { normalizeMobile } from '../common/phone';
import { inScope, requireDormitory, requireUniversity } from '../common/scope';
import { render, smsParts } from '../messaging/text';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLateArrivalDto, ListLateArrivalsDto } from './dto/late-arrival.dto';

/** Text of the SMS to the guardian ({{studentName}}, {{dormitoryName}}, {{count}}). */
const GUARDIAN_SMS = 'اولیای محترم {{studentName}}، دانشجوی شما تاکنون {{count}} بار بدون عذر موجه با تأخیر وارد خوابگاه {{dormitoryName}} شده است. لطفاً در این‌باره با ایشان گفتگو فرمایید. مدیریت خوابگاه';

type GuardianSms = 'NOT_NEEDED' | 'NOT_YET' | 'SENT' | 'NO_GUARDIAN_PHONE' | 'ALREADY_SENT';

/**
 * Late arrival at the dormitory, recorded by the attendant as excused (موجه) or unexcused (غیرموجه).
 * Every `LATE_SMS_THRESHOLD` (default 3) unexcused ones since the last SMS queue ONE SMS to the guardian.
 */
@Injectable()
export class LateArrivalsService {
  private threshold: number;

  constructor(private prisma: PrismaService, private audit: AuditService, config: ConfigService) {
    this.threshold = Math.max(1, Number(config.get('LATE_SMS_THRESHOLD') ?? 3) || 3);
  }

  async create(actor: AuthUser, dto: CreateLateArrivalDto) {
    const a = await this.prisma.assignment.findFirst({ where: { studentId: dto.studentId, endedAt: null }, include: { student: true } });
    if (!a || !inScope(actor, { universityId: a.student.universityId, dormitoryId: a.dormitoryId })) throw new NotFoundException('این دانشجو ساکن خوابگاه شما نیست');

    const today = todayTehran();
    const date = dto.date ?? today;
    if (date > today) throw new BadRequestException('تاریخ تأخیر نمی‌تواند در آینده باشد');
    if (date < addDays(today, actor.role === Role.ATTENDANT ? -3 : -30)) throw new ForbiddenException('ثبت تأخیر برای این تاریخ برای نقش شما مجاز نیست');
    const arrivedAt = dto.arrivedAt ? new Date(dto.arrivedAt) : null;
    if (arrivedAt && arrivedAt.getTime() > Date.now() + 5 * 60_000) throw new BadRequestException('ساعت ورود نمی‌تواند در آینده باشد');

    let rec;
    try {
      rec = await this.prisma.lateArrival.create({
        data: {
          universityId: a.student.universityId, dormitoryId: a.dormitoryId, studentId: a.studentId, date: dateOnly(date), arrivedAt,
          kind: dto.kind, reason: dto.reason?.trim() || null, recordedById: actor.id,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('تأخیر این دانشجو برای این روز قبلاً ثبت شده است');
      throw e;
    }
    await this.audit.log({
      actor, action: 'late.create', entity: 'LateArrival', entityId: rec.id, universityId: rec.universityId,
      meta: { studentId: rec.studentId, dormitoryId: rec.dormitoryId, kind: rec.kind, date },
    });

    let guardianSms: GuardianSms = 'NOT_NEEDED';
    let pending = 0;
    if (dto.kind === LateKind.UNEXCUSED) ({ status: guardianSms, pending } = await this.maybeNotify(actor, a.student, a.dormitoryId));
    return { id: rec.id, kind: rec.kind, date, guardianSms, unexcusedSinceLastSms: guardianSms === 'SENT' ? 0 : pending, threshold: this.threshold };
  }

  /** When enough unexcused records are waiting, queues one guardian SMS and marks them as counted. */
  private async maybeNotify(actor: AuthUser, student: { id: string; universityId: string; firstName: string; lastName: string; guardianPhone: string | null }, dormitoryId: string) {
    const waiting = await this.prisma.lateArrival.findMany({ where: { studentId: student.id, kind: LateKind.UNEXCUSED, guardianNotifiedAt: null }, select: { id: true } });
    const pending = waiting.length;
    if (pending < this.threshold) return { status: 'NOT_YET' as GuardianSms, pending };
    const phone = normalizeMobile(student.guardianPhone);
    if (!phone) return { status: 'NO_GUARDIAN_PHONE' as GuardianSms, pending }; // stays pending: the next unexcused one tries again

    const [dorm, sender] = await Promise.all([
      this.prisma.dormitory.findUnique({ where: { id: dormitoryId }, select: { name: true } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: { firstName: true, lastName: true } }),
    ]);
    const name = `${student.firstName} ${student.lastName}`.trim();
    const body = render(GUARDIAN_SMS, { studentName: name, dormitoryName: dorm?.name ?? '', count: String(pending) });

    const sent = await this.prisma.$transaction(async (tx) => {
      // claim the records first: two simultaneous saves must not send twice
      const claimed = await tx.lateArrival.updateMany({ where: { id: { in: waiting.map((w) => w.id) }, guardianNotifiedAt: null }, data: { guardianNotifiedAt: new Date() } });
      if (claimed.count !== pending) throw new ConflictException('ALREADY_SENT');
      const b = await tx.messageBatch.create({
        data: {
          universityId: student.universityId, senderId: actor.id, senderName: `${sender.firstName} ${sender.lastName}`.trim(), senderRole: actor.role,
          body, inApp: false, sms: true, audience: { type: 'LATE_GUARDIAN', studentId: student.id } as Prisma.InputJsonValue,
          status: BatchStatus.QUEUED, totalRecipients: 1, smsRecipients: 1, smsParts: smsParts(body),
        },
      });
      await tx.messageRecipient.create({
        data: { batchId: b.id, recipientType: RecipientType.STUDENT, studentId: student.id, dormitoryId, name: `اولیای ${name}`, phone, renderedBody: body, smsStatus: SmsStatus.PENDING },
      });
      return true;
    }).catch((e) => { if (e instanceof ConflictException) return false; throw e; });
    if (!sent) return { status: 'ALREADY_SENT' as GuardianSms, pending };
    await this.audit.log({ actor, action: 'late.guardian_sms', entity: 'Student', entityId: student.id, universityId: student.universityId, meta: { count: pending, dormitoryId } });
    return { status: 'SENT' as GuardianSms, pending };
  }

  async list(actor: AuthUser, q: ListLateArrivalsDto) {
    const where: Prisma.LateArrivalWhereInput = {
      ...(q.studentId ? { studentId: q.studentId } : {}), ...(q.kind ? { kind: q.kind } : {}),
      ...(q.from || q.to ? { date: { ...(q.from ? { gte: dateOnly(q.from) } : {}), ...(q.to ? { lte: dateOnly(q.to) } : {}) } } : {}),
    };
    if (actor.role === Role.DORM_SUPERVISOR || actor.role === Role.ATTENDANT) where.dormitoryId = requireDormitory(actor);
    else { where.universityId = requireUniversity(actor); if (q.dormitoryId) where.dormitoryId = q.dormitoryId; }

    const [rows, total] = await Promise.all([
      this.prisma.lateArrival.findMany({
        where, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], skip: (q.page - 1) * q.limit, take: q.limit,
        include: { student: { select: { firstName: true, lastName: true, studentNumber: true } } },
      }),
      this.prisma.lateArrival.count({ where }),
    ]);
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.recordedById))] } }, select: { id: true, firstName: true, lastName: true } });
    const byId = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
    const dorms = await this.prisma.dormitory.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.dormitoryId))] } }, select: { id: true, name: true } });
    const dormName = new Map(dorms.map((d) => [d.id, d.name]));
    return {
      total, page: q.page, limit: q.limit, threshold: this.threshold,
      items: rows.map((r) => ({
        id: r.id, studentId: r.studentId, studentName: `${r.student.firstName} ${r.student.lastName}`.trim(), studentNumber: r.student.studentNumber,
        dormitoryId: r.dormitoryId, dormitoryName: dormName.get(r.dormitoryId) ?? null,
        date: dateStr(r.date), arrivedAt: r.arrivedAt, kind: r.kind, reason: r.reason, recordedBy: byId.get(r.recordedById) ?? null,
        guardianNotified: !!r.guardianNotifiedAt, createdAt: r.createdAt,
      })),
    };
  }

  /** A mistaken record may be deleted until the guardian SMS has counted it; an attendant only his own, within 12 hours. */
  async remove(actor: AuthUser, id: string) {
    const rec = await this.prisma.lateArrival.findUnique({ where: { id } });
    if (!rec || !inScope(actor, { universityId: rec.universityId, dormitoryId: rec.dormitoryId })) throw new NotFoundException('Record not found');
    if (rec.guardianNotifiedAt) throw new ConflictException('پیامک اولیا برای این مورد ارسال شده و قابل حذف نیست');
    if (actor.role === Role.ATTENDANT && (rec.recordedById !== actor.id || Date.now() - rec.createdAt.getTime() > 12 * 3_600_000)) {
      throw new ForbiddenException('متصدی فقط موارد ثبت‌شده‌ی خودش را تا ۱۲ ساعت بعد می‌تواند حذف کند');
    }
    await this.prisma.lateArrival.delete({ where: { id } });
    await this.audit.log({ actor, action: 'late.delete', entity: 'LateArrival', entityId: id, universityId: rec.universityId, meta: { studentId: rec.studentId, kind: rec.kind } });
    return { ok: true };
  }
}
