import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ALLOW_PW_CHANGE } from '../decorators/allow-password-change.decorator';

/** Forces a password change on first login. OFF by default; enable with FORCE_PASSWORD_CHANGE=on in .env. */
@Injectable()
export class PasswordChangeGuard implements CanActivate {
  constructor(private reflector: Reflector, private config: ConfigService) {}
  canActivate(ctx: ExecutionContext): boolean {
    if (this.config.get('FORCE_PASSWORD_CHANGE') !== 'on') return true;
    const user = ctx.switchToHttp().getRequest().user;
    if (!user?.mustChangePassword) return true;
    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_PW_CHANGE, [ctx.getHandler(), ctx.getClass()]);
    if (allowed) return true;
    throw new ForbiddenException({ code: 'PASSWORD_CHANGE_REQUIRED', message: 'You must change your password first' });
  }
}
