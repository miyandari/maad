import { BadRequestException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, ResidencyStatus, Role } from '@prisma/client';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { toLatin } from '../common/national-id';
import { normalizeMobile } from '../common/phone';
import { ISmsProvider, SMS_PROVIDER } from '../messaging/sms/sms-provider';
import { PrismaService } from '../prisma/prisma.service';

const CODE_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const GENERIC = { ok: true, message: 'اگر شماره‌ی موبایل شما در سامانه ثبت باشد، کد ورود پیامک می‌شود.' };

/** Student sign-in with a one-time code sent to the mobile number registered on the student record. */
@Injectable()
export class StudentAuthService {
  private logger = new Logger('StudentOtp');

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private audit: AuditService,
    @Inject(SMS_PROVIDER) private sms: ISmsProvider,
  ) {}

  private hash(studentId: string, code: string) {
    return createHmac('sha256', this.config.getOrThrow<string>('JWT_SECRET')).update(`${studentId}:${code}`).digest('hex');
  }

  /** Only students who currently live in a dormitory can sign in. */
  private async findStudent(nationalId: string, universityCode?: string) {
    const candidates = await this.prisma.student.findMany({
      where: {
        nationalId: toLatin(nationalId), status: { in: [ResidencyStatus.RESIDENT, ResidencyStatus.ON_LEAVE] },
        ...(universityCode ? { university: { code: universityCode } } : {}),
      },
      include: { university: { select: { isActive: true, name: true } } },
    });
    if (candidates.length > 1) throw new BadRequestException({ code: 'UNIVERSITY_REQUIRED', message: 'کد دانشگاه را هم وارد کنید.' });
    const st = candidates[0];
    return st && st.university.isActive ? st : null;
  }

  /** Always answers the same way, so nobody can find out which national IDs exist. */
  async requestCode(nationalId: string, universityCode?: string) {
    const st = await this.findStudent(nationalId, universityCode);
    const phone = st ? normalizeMobile(st.phone) : null;
    if (!st || !phone) return GENERIC;

    const recent = await this.prisma.studentOtp.findMany({ where: { studentId: st.id, createdAt: { gte: new Date(Date.now() - 3_600_000) } }, orderBy: { createdAt: 'desc' } });
    if ((recent[0] && Date.now() - recent[0].createdAt.getTime() < 60_000) || recent.length >= 5) return GENERIC; // cooldown / hourly limit, silently

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.studentOtp.create({ data: { studentId: st.id, codeHash: this.hash(st.id, code), expiresAt: new Date(Date.now() + CODE_TTL_MS) } });
    try {
      await this.sms.send(phone, `کد ورود به سامانه ماد: ${code}\nاین کد را به کسی ندهید.`);
    } catch (e) {
      this.logger.error(`SMS failed: ${(e as Error).message}`);
      throw new BadRequestException('ارسال پیامک ممکن نشد؛ کمی بعد دوباره تلاش کنید.');
    }
    // TEST MODE (SMS_PROVIDER=log): no real SMS is sent, so the code is printed in the server log
    if (this.sms.name === 'log') this.logger.warn(`[TEST MODE] login code for national ID ${toLatin(nationalId)}: ${code}`);
    return GENERIC;
  }

  async verify(nationalId: string, code: string, universityCode?: string) {
    const fail = () => new UnauthorizedException('کد نادرست است یا منقضی شده.');
    const st = await this.findStudent(nationalId, universityCode);
    if (!st) throw fail();
    const otp = await this.prisma.studentOtp.findFirst({
      where: { studentId: st.id, consumedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' },
    });
    if (!otp || otp.attempts >= MAX_ATTEMPTS) throw fail();
    const given = Buffer.from(this.hash(st.id, code), 'hex');
    const stored = Buffer.from(otp.codeHash, 'hex');
    if (given.length !== stored.length || !timingSafeEqual(given, stored)) {
      await this.prisma.studentOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw fail();
    }
    await this.prisma.studentOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
    await this.audit.log({ actor: { id: st.id, role: Role.STUDENT, universityId: st.universityId, dormitoryId: null }, action: 'student.login', entity: 'Student', entityId: st.id, universityId: st.universityId });
    const accessToken = await this.jwt.signAsync({ sub: st.id, typ: 'student' }, { expiresIn: '12h' as any });
    return { accessToken };
  }
}
