import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FEATURE_KEY } from '../decorators/features.decorator';

const cache = new Map<string, { disabled: string[]; at: number }>();

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(private reflector: Reflector, private prisma: PrismaService) {}

  static invalidate(universityId: string) {
    cache.delete(universityId);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<string | undefined>(FEATURE_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!feature) return true;
    const user = ctx.switchToHttp().getRequest().user;
    if (!user || user.role === Role.SUPER_ADMIN || !user.universityId) return true;
    let entry = cache.get(user.universityId);
    if (!entry || Date.now() - entry.at > 30_000) {
      const uni = await this.prisma.university.findUnique({ where: { id: user.universityId }, select: { disabledFeatures: true } });
      entry = { disabled: uni?.disabledFeatures ?? [], at: Date.now() };
      cache.set(user.universityId, entry);
    }
    if (entry.disabled.includes(feature)) throw new ForbiddenException(`The "${feature}" module is disabled for your university`);
    return true;
  }
}
