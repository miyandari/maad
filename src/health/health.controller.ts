import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireFeature } from '../common/decorators/features.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateHealthItemDto, CreateInspectionDto, FollowUpDto, ListAlertsDto, ListInspectionsDto, UpdateHealthItemDto } from './dto/health.dto';
import { HealthService } from './health.service';

const uuid = new ParseUUIDPipe();
const VIEWERS = [Role.SUPER_ADMIN, Role.SENIOR_ADMIN, Role.SYSTEM_MANAGER, Role.DORM_SUPERVISOR, Role.HEALTH_LIAISON];

@Controller('health-checks')
@RequireFeature('health')
export class HealthController {
  constructor(private svc: HealthService) {}

  // ---- the liaison's checklist titles ----
  @Get('items') @Roles(Role.HEALTH_LIAISON)
  items(@CurrentUser() u: AuthUser) { return this.svc.listItems(u); }

  @Post('items') @Roles(Role.HEALTH_LIAISON)
  createItem(@CurrentUser() u: AuthUser, @Body() dto: CreateHealthItemDto) { return this.svc.createItem(u, dto); }

  @Patch('items/:id') @Roles(Role.HEALTH_LIAISON)
  updateItem(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: UpdateHealthItemDto) { return this.svc.updateItem(u, id, dto); }

  @Delete('items/:id') @Roles(Role.HEALTH_LIAISON)
  deleteItem(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.svc.deleteItem(u, id); }

  // ---- inspections ----
  @Post('inspections') @Roles(Role.HEALTH_LIAISON)
  inspect(@CurrentUser() u: AuthUser, @Body() dto: CreateInspectionDto) { return this.svc.inspect(u, dto); }

  @Get('inspections') @Roles(...VIEWERS)
  inspections(@CurrentUser() u: AuthUser, @Query() q: ListInspectionsDto) { return this.svc.listInspections(u, q); }

  // ---- alarms and the supervisor's response ----
  @Get('alerts') @Roles(...VIEWERS)
  alerts(@CurrentUser() u: AuthUser, @Query() q: ListAlertsDto) { return this.svc.alerts(u, q); }

  @Patch('results/:id/follow-up') @HttpCode(200) @Roles(Role.DORM_SUPERVISOR)
  followUp(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: FollowUpDto) { return this.svc.followUp(u, id, dto); }
}
