import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MaintenanceStatus as S, Prisma, RequestKind, RequestScope, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { FeedbackDto, MergeDto, StudentRequestDto } from './dto/portal.dto';

const REP_WAIT_DAYS = 3;
const MAX_REQUESTS_PER_DAY = 10;
const day = 86_400_000;

/** What the student sees of the (internal) request status. Costs and staff details are never shown. */
function stageOf(r: { status: S; assignedToId: string | null; mergedIntoId?: string | null }) {
  if (r.status === S.REJECTED && r.mergedIntoId) return { step: 0, label: 'با یک درخواست مشابه ادغام شد' };
  switch (r.status) {
    case S.PENDING_REP: return { step: 1, label: 'در انتظار بررسی نماینده‌ی شورای صنفی' };
    case S.PENDING_SUPERVISOR: return { step: 2, label: 'در انتظار تأیید سرپرست خوابگاه' };
    case S.SUBMITTED: return { step: 3, label: 'تأیید سرپرست؛ در حال بررسی و برآورد' };
    case S.APPROVED: return { step: 4, label: r.assignedToId ? 'تأیید و ارجاع شد؛ در انتظار شروع کار' : 'تأیید شد؛ در انتظار ارجاع' };
    case S.IN_PROGRESS: return { step: 5, label: 'در حال اجرا' };
    case S.FIXED: return { step: 6, label: 'انجام شد؛ در انتظار تأیید نهایی سرپرست' };
    case S.CLOSED: return { step: 7, label: 'پایان یافت' };
    default: return { step: 0, label: 'رد شد' };
  }
}

@Injectable()
export class PortalService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private dorm(actor: AuthUser) {
    if (!actor.dormitoryId) throw new ForbiddenException('شما در حال حاضر در خوابگاهی ساکن نیستید');
    return actor.dormitoryId;
  }

  async assertRep(actor: AuthUser) {
    const rep = await this.prisma.councilRep.findFirst({ where: { studentId: actor.id, dormitoryId: this.dorm(actor), endedAt: null, endsAt: { gte: new Date() } } });
    if (!rep) throw new ForbiddenException('فقط نماینده‌ی شورای صنفی می‌تواند این کار را انجام دهد');
    return rep;
  }

  // ---------------- requests ----------------

  async createRequest(actor: AuthUser, dto: StudentRequestDto) {
    const dormitoryId = this.dorm(actor);
    if (dto.kind === RequestKind.REPAIR && !dto.category) throw new BadRequestException('نوع تعمیرات را انتخاب کنید');
    if (dto.kind === RequestKind.EQUIPMENT && dto.category) throw new BadRequestException('نوع تعمیرات فقط برای درخواست تعمیر است');
    if (dto.scope === RequestScope.ROOM && !actor.roomId) throw new BadRequestException('اتاقی برای شما ثبت نشده است');
    const today = await this.prisma.maintenanceRequest.count({ where: { requestedByStudentId: actor.id, createdAt: { gte: new Date(Date.now() - day) } } });
    if (today >= MAX_REQUESTS_PER_DAY) throw new ConflictException('تعداد درخواست‌های امروز شما به سقف رسیده است');

    // own room / hazard -> supervisor; collective need -> council representative first (if the dormitory has one)
    let status: S = S.PENDING_SUPERVISOR;
    if (dto.scope === RequestScope.DORMITORY && !dto.urgent) {
      const rep = await this.prisma.councilRep.findFirst({ where: { dormitoryId, endedAt: null, endsAt: { gte: new Date() } } });
      if (rep) status = S.PENDING_REP;
    }
    const r = await this.prisma.maintenanceRequest.create({
      data: {
        universityId: actor.universityId!, dormitoryId, requestedByStudentId: actor.id, roomId: dto.scope === RequestScope.ROOM ? actor.roomId : null,
        scope: dto.scope, urgent: !!dto.urgent, kind: dto.kind, category: dto.category, title: dto.title.trim(), description: dto.description?.trim(), quantity: dto.quantity,
        status, events: { create: { actorId: actor.id, toStatus: status, note: 'ثبت توسط دانشجو' } },
      },
    });
    await this.audit.log({ actor, action: 'student.request_create', entity: 'MaintenanceRequest', entityId: r.id, universityId: actor.universityId, meta: { scope: dto.scope, urgent: !!dto.urgent } });
    return { id: r.id, status: r.status, ...stageOf(r) };
  }

  async myRequests(actor: AuthUser) {
    const rows = await this.prisma.maintenanceRequest.findMany({
      where: { requestedByStudentId: actor.id }, orderBy: { createdAt: 'desc' }, take: 100,
      include: { events: { orderBy: { createdAt: 'desc' }, take: 5, select: { toStatus: true, note: true, createdAt: true } } },
    });
    return rows.map((r) => {
      const rejected = r.status === S.REJECTED ? r.events.find((e) => e.toStatus === S.REJECTED) : undefined;
      const waitedLongEnough = r.status === S.PENDING_REP && Date.now() - r.createdAt.getTime() >= REP_WAIT_DAYS * day;
      return {
        id: r.id, title: r.title, description: r.description, kind: r.kind, category: r.category, quantity: r.quantity, scope: r.scope, urgent: r.urgent,
        status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt, supporters: r.supporters, ...stageOf(r),
        rejectedReason: rejected?.note ?? null, rejectedByRep: r.rejectedByRep, merged: !!r.mergedIntoId,
        canEscalate: waitedLongEnough || (r.status === S.REJECTED && r.rejectedByRep),
      };
    });
  }

  /** The student may skip the representative after waiting 3 days, or after the representative returned the request. */
  async escalate(actor: AuthUser, id: string) {
    const r = await this.prisma.maintenanceRequest.findFirst({ where: { id, requestedByStudentId: actor.id } });
    if (!r) throw new NotFoundException('درخواست پیدا نشد');
    const waited = r.status === S.PENDING_REP && Date.now() - r.createdAt.getTime() >= REP_WAIT_DAYS * day;
    if (!waited && !(r.status === S.REJECTED && r.rejectedByRep)) throw new ConflictException(`ارسال مستقیم به سرپرست پس از ${REP_WAIT_DAYS} روز انتظار یا پس از بازگرداندن نماینده ممکن است`);
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.maintenanceRequest.updateMany({ where: { id, status: r.status }, data: { status: S.PENDING_SUPERVISOR, rejectedByRep: false } });
      if (res.count === 0) throw new ConflictException('وضعیت درخواست تغییر کرد؛ دوباره باز کنید');
      await tx.maintenanceEvent.create({ data: { requestId: id, actorId: actor.id, fromStatus: r.status, toStatus: S.PENDING_SUPERVISOR, note: 'ارسال مستقیم توسط دانشجو به سرپرست' } });
    });
    return { ok: true };
  }

  // ---------------- collective proposals + representative ----------------

  /** Open collective requests of my dormitory (author names are never shown). */
  async proposals(actor: AuthUser) {
    const rows = await this.prisma.maintenanceRequest.findMany({
      where: { dormitoryId: this.dorm(actor), status: S.PENDING_REP }, orderBy: { createdAt: 'asc' }, take: 100,
      include: { supports: { where: { studentId: actor.id }, select: { id: true } } },
    });
    return rows.map((r) => ({
      id: r.id, title: r.title, description: r.description, kind: r.kind, category: r.category, quantity: r.quantity, createdAt: r.createdAt,
      supporters: r.supporters, supportedByMe: r.supports.length > 0, isMine: r.requestedByStudentId === actor.id,
    }));
  }

  async toggleSupport(actor: AuthUser, id: string) {
    const r = await this.prisma.maintenanceRequest.findFirst({ where: { id, dormitoryId: this.dorm(actor), status: S.PENDING_REP } });
    if (!r) throw new NotFoundException('درخواست پیدا نشد');
    if (r.requestedByStudentId === actor.id) throw new ConflictException('درخواست خودتان را نمی‌توانید حمایت کنید');
    const existing = await this.prisma.requestSupport.findUnique({ where: { requestId_studentId: { requestId: id, studentId: actor.id } } });
    if (existing) {
      await this.prisma.$transaction([this.prisma.requestSupport.delete({ where: { id: existing.id } }), this.prisma.maintenanceRequest.update({ where: { id }, data: { supporters: { decrement: 1 } } })]);
      return { supported: false };
    }
    await this.prisma.$transaction([this.prisma.requestSupport.create({ data: { requestId: id, studentId: actor.id } }), this.prisma.maintenanceRequest.update({ where: { id }, data: { supporters: { increment: 1 } } })]);
    return { supported: true };
  }

  /** Representative: consolidates and sends a collective request to the supervisor. */
  async forward(actor: AuthUser, id: string, summary?: string) {
    await this.assertRep(actor);
    return this.repMove(actor, id, S.PENDING_SUPERVISOR, (n) => `جمع‌بندی نماینده‌ی شورای صنفی (${n} حامی)${summary?.trim() ? ': ' + summary.trim() : ''}`, false);
  }

  async returnRequest(actor: AuthUser, id: string, note: string) {
    await this.assertRep(actor);
    return this.repMove(actor, id, S.REJECTED, () => `بازگردانده‌شده توسط نماینده: ${note.trim()}`, true);
  }

  /**
   * Representative: merges duplicate collective requests into one main request. The duplicates are closed
   * (shown to their authors as "merged"), and their authors and supporters become supporters of the main request.
   */
  async merge(actor: AuthUser, id: string, dto: MergeDto) {
    await this.assertRep(actor);
    const dormitoryId = this.dorm(actor);
    const dupIds = [...new Set(dto.duplicateIds)];
    if (dupIds.includes(id)) throw new BadRequestException('درخواست اصلی را نمی‌توان در خودش ادغام کرد');

    const main = await this.prisma.maintenanceRequest.findFirst({ where: { id, dormitoryId, status: S.PENDING_REP } });
    if (!main) throw new NotFoundException('درخواست اصلی پیدا نشد');
    const dups = await this.prisma.maintenanceRequest.findMany({ where: { id: { in: dupIds }, dormitoryId, status: S.PENDING_REP, kind: main.kind } });
    if (dups.length !== dupIds.length) throw new ConflictException('همه‌ی درخواست‌های انتخاب‌شده باید همین‌جا در انتظار نماینده و هم‌نوع درخواست اصلی باشند');

    const supporters = await this.prisma.$transaction(async (tx) => {
      const res = await tx.maintenanceRequest.updateMany({ where: { id: { in: dupIds }, status: S.PENDING_REP }, data: { status: S.REJECTED, rejectedByRep: false, mergedIntoId: id } });
      if (res.count !== dupIds.length) throw new ConflictException('یکی از درخواست‌ها قبلاً رسیدگی شده است؛ دوباره باز کنید');

      // authors and supporters of the duplicates now support the main request (never its own author)
      const old = await tx.requestSupport.findMany({ where: { requestId: { in: dupIds } }, select: { studentId: true } });
      const students = new Set<string>([...old.map((x) => x.studentId), ...dups.map((d) => d.requestedByStudentId).filter((x): x is string => !!x)]);
      if (main.requestedByStudentId) students.delete(main.requestedByStudentId);
      await tx.requestSupport.createMany({ data: [...students].map((studentId) => ({ requestId: id, studentId })), skipDuplicates: true });
      const total = await tx.requestSupport.count({ where: { requestId: id } });
      const upd = await tx.maintenanceRequest.updateMany({ where: { id, status: S.PENDING_REP }, data: { supporters: total } });
      if (upd.count === 0) throw new ConflictException('درخواست اصلی قبلاً رسیدگی شده است');

      await tx.maintenanceEvent.createMany({
        data: [
          ...dups.map((d) => ({ requestId: d.id, actorId: actor.id, fromStatus: S.PENDING_REP, toStatus: S.REJECTED, note: `ادغام شد در درخواست مشابه «${main.title}»` })),
          { requestId: id, actorId: actor.id, fromStatus: S.PENDING_REP, toStatus: S.PENDING_REP, note: `ادغام ${dups.length} درخواست مشابه (${total} حامی)${dto.summary?.trim() ? ': ' + dto.summary.trim() : ''}` },
        ],
      });
      return total;
    });
    await this.audit.log({ actor, action: 'council.merge', entity: 'MaintenanceRequest', entityId: id, universityId: main.universityId, meta: { merged: dupIds, supporters } });
    return { ok: true, merged: dups.length, supporters };
  }

  private async repMove(actor: AuthUser, id: string, to: S, note: (supporters: number) => string, byRep: boolean) {
    const r = await this.prisma.maintenanceRequest.findFirst({ where: { id, dormitoryId: this.dorm(actor), status: S.PENDING_REP } });
    if (!r) throw new NotFoundException('درخواست پیدا نشد');
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.maintenanceRequest.updateMany({ where: { id, status: S.PENDING_REP }, data: { status: to, rejectedByRep: byRep } });
      if (res.count === 0) throw new ConflictException('درخواست قبلاً رسیدگی شده است');
      await tx.maintenanceEvent.create({ data: { requestId: id, actorId: actor.id, fromStatus: S.PENDING_REP, toStatus: to, note: note(r.supporters) } });
    });
    await this.audit.log({ actor, action: byRep ? 'council.return' : 'council.forward', entity: 'MaintenanceRequest', entityId: id, universityId: r.universityId });
    return { ok: true };
  }

  // ---------------- opinions about staff of my dormitory ----------------

  async staff(actor: AuthUser) {
    return this.prisma.user.findMany({
      where: { dormitoryId: this.dorm(actor), isActive: true, role: { in: [Role.DORM_SUPERVISOR, Role.ATTENDANT, Role.SERVICE_STAFF] } },
      select: { id: true, firstName: true, lastName: true, role: true }, orderBy: [{ role: 'asc' }, { lastName: 'asc' }],
    });
  }

  async sendFeedback(actor: AuthUser, dto: FeedbackDto) {
    const dormitoryId = this.dorm(actor);
    const target = await this.prisma.user.findFirst({ where: { id: dto.targetUserId, dormitoryId, isActive: true, role: { in: [Role.DORM_SUPERVISOR, Role.ATTENDANT, Role.SERVICE_STAFF] } } });
    if (!target) throw new NotFoundException('این فرد در خوابگاه شما پیدا نشد');
    const recent = await this.prisma.staffFeedback.count({ where: { studentId: actor.id, targetUserId: target.id, createdAt: { gte: new Date(Date.now() - 7 * day) } } });
    if (recent >= 2) throw new ConflictException('برای این فرد در هفته‌ی گذشته دو نظر ثبت کرده‌اید؛ چند روز بعد دوباره تلاش کنید');
    const f = await this.prisma.staffFeedback.create({ data: { universityId: actor.universityId!, dormitoryId, studentId: actor.id, targetUserId: target.id, kind: dto.kind, text: dto.text.trim() } });
    await this.audit.log({ actor, action: 'student.feedback', entity: 'StaffFeedback', entityId: f.id, universityId: actor.universityId, meta: { kind: f.kind } });
    return { ok: true };
  }

  async myFeedback(actor: AuthUser) {
    const rows = await this.prisma.staffFeedback.findMany({ where: { studentId: actor.id }, orderBy: { createdAt: 'desc' }, take: 50 });
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.targetUserId))] } }, select: { id: true, firstName: true, lastName: true, role: true } });
    const map = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({ id: r.id, kind: r.kind, text: r.text, createdAt: r.createdAt, target: map.get(r.targetUserId) ?? null }));
  }
}
