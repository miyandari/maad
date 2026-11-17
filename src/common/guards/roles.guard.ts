import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ALLOW_STUDENT } from '../decorators/allow-student.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';

/** Global guard: a route with @Roles(...) needs one of them. Student sessions only reach routes that name STUDENT (or @AllowStudent). */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    const user = ctx.switchToHttp().getRequest().user;
    if (user?.role === Role.STUDENT) {
      const open = roles?.includes(Role.STUDENT) || this.reflector.getAllAndOverride<boolean>(ALLOW_STUDENT, [ctx.getHandler(), ctx.getClass()]);
      if (!open) throw new ForbiddenException('Insufficient role');
      return true;
    }
    if (!roles || roles.length === 0) return true;
    if (!user || !roles.includes(user.role)) throw new ForbiddenException('Insufficient role');
    return true;
  }
}
