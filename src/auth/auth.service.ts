import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth-user';
import { USER_SELECT } from '../common/scope';
import { PrismaService } from '../prisma/prisma.service';

// compared against when the username is unknown, so response time doesn't reveal valid usernames
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService, private audit: AuditService) {}

  async login(username: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      include: { university: { select: { isActive: true, name: true } } },
    });
    const locked = !!user?.lockedUntil && user.lockedUntil > new Date();
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (user && !ok && !locked) {
      const failed = user.failedLogins + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: failed >= MAX_FAILED ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } : { failedLogins: failed },
      });
    }
    if (!user || !ok || locked || !user.isActive || (user.university && !user.university.isActive)) {
      throw new UnauthorizedException('Invalid credentials, or the account is temporarily locked');
    }
    if (user.failedLogins > 0 || user.lockedUntil) {
      await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    }
    await this.audit.log({
      actor: { id: user.id, role: user.role, universityId: user.universityId, dormitoryId: user.dormitoryId },
      action: 'auth.login',
      entity: 'User',
      entityId: user.id,
    });
    const { passwordHash, university, failedLogins, lockedUntil, ...safe } = user;
    return { accessToken: await this.jwt.signAsync({ sub: user.id }), user: { ...safe, universityName: university?.name ?? null } };
  }

  async me(actor: AuthUser) {
    if (actor.role === Role.STUDENT) {
      const st = await this.prisma.student.findUniqueOrThrow({
        where: { id: actor.id },
        include: {
          university: { select: { name: true } },
          assignments: { where: { endedAt: null }, take: 1, select: { dormitoryId: true, room: { select: { id: true, number: true, building: { select: { name: true } } } } } },
        },
      });
      const rep = await this.prisma.councilRep.findFirst({ where: { studentId: st.id, endedAt: null, endsAt: { gte: new Date() } } });
      return {
        id: st.id, role: Role.STUDENT, firstName: st.firstName, lastName: st.lastName, universityId: st.universityId, universityName: st.university.name,
        dormitoryId: st.assignments[0]?.dormitoryId ?? null, room: st.assignments[0]?.room ?? null, isCouncilRep: !!rep, mustChangePassword: false, permissions: [] as string[],
      };
    }
    const { university, ...u } = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: { ...USER_SELECT, university: { select: { name: true } } } });
    return { ...u, universityName: university?.name ?? null };
  }

  async changePassword(actor: AuthUser, oldPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (!(await bcrypt.compare(oldPassword, user.passwordHash))) {
      throw new BadRequestException('Old password is incorrect');
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 12), mustChangePassword: false },
    });
    await this.audit.log({ actor, action: 'auth.change_password', entity: 'User', entityId: user.id });
    return { ok: true };
  }
}
