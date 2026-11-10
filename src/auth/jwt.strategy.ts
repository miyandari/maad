import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthUser } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService, private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /** Role/scope are re-read on every request so deactivation or reassignment takes effect immediately. */
  async validate(payload: { sub: string }): Promise<AuthUser> {
    const u = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { university: { select: { isActive: true } } },
    });
    if (!u || !u.isActive || (u.university && !u.university.isActive)) throw new UnauthorizedException();
    return {
      id: u.id, role: u.role, universityId: u.universityId, dormitoryId: u.dormitoryId,
      mustChangePassword: u.mustChangePassword, permissions: u.permissions,
    };
  }
}
