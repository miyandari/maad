import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireFeature } from '../common/decorators/features.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { DecisionDto } from '../common/decision.dto';
import { ChecklistsService } from './checklists.service';
import {
  CompleteMissionDto, CreateMissionDto, CreateTemplateDto, ListChecklistReportsDto, ListMissionsDto, SetTemplateActiveDto, SubmitChecklistDto,
} from './dto/checklist.dto';

const uuid = new ParseUUIDPipe();

@Controller()
@RequireFeature('checklists')
export class ChecklistsController {
  constructor(private svc: ChecklistsService) {}

  // ---- templates ----
  @Post('checklists/templates') @Roles(Role.SYSTEM_MANAGER)
  createTemplate(@CurrentUser() u: AuthUser, @Body() dto: CreateTemplateDto) { return this.svc.createTemplate(u, dto); }

  @Get('checklists/templates') @Roles(Role.SYSTEM_MANAGER, Role.SENIOR_ADMIN, Role.DORM_SUPERVISOR, Role.SERVICE_STAFF)
  listTemplates(@CurrentUser() u: AuthUser) { return this.svc.listTemplates(u); }

  @Patch('checklists/templates/:id/active') @Roles(Role.SYSTEM_MANAGER)
  setActive(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: SetTemplateActiveDto) { return this.svc.setTemplateActive(u, id, dto.isActive); }

  // ---- daily reports ----
  @Post('checklists/reports') @Roles(Role.SERVICE_STAFF)
  submit(@CurrentUser() u: AuthUser, @Body() dto: SubmitChecklistDto) { return this.svc.submit(u, dto); }

  @Get('checklists/reports') @Roles(Role.SERVICE_STAFF, Role.DORM_SUPERVISOR, Role.SYSTEM_MANAGER, Role.SENIOR_ADMIN)
  listReports(@CurrentUser() u: AuthUser, @Query() q: ListChecklistReportsDto) { return this.svc.listReports(u, q); }

  @Post('checklists/reports/:id/decision') @HttpCode(200) @Roles(Role.DORM_SUPERVISOR)
  decide(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: DecisionDto) { return this.svc.decide(u, id, dto.approve, dto.note); }

  // ---- missions ----
  @Post('missions') @Roles(Role.SYSTEM_MANAGER)
  createMission(@CurrentUser() u: AuthUser, @Body() dto: CreateMissionDto) { return this.svc.createMission(u, dto); }

  @Get('missions') @Roles(Role.SERVICE_STAFF, Role.DORM_SUPERVISOR, Role.SYSTEM_MANAGER, Role.SENIOR_ADMIN)
  listMissions(@CurrentUser() u: AuthUser, @Query() q: ListMissionsDto) { return this.svc.listMissions(u, q); }

  @Post('missions/:id/complete') @HttpCode(200) @Roles(Role.SERVICE_STAFF)
  completeMission(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: CompleteMissionDto) { return this.svc.completeMission(u, id, dto.resultNote); }
}
