import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AuditService, ListAuditDto } from './audit.service';

@Controller('audit-logs')
@Roles(Role.SUPER_ADMIN, Role.SENIOR_ADMIN, Role.SYSTEM_MANAGER)
export class AuditController {
  constructor(private audit: AuditService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ListAuditDto) {
    return this.audit.list(user, q);
  }
}
