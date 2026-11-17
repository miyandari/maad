import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireFeature } from '../common/decorators/features.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  ApproveMaintenanceDto, AssignMaintenanceDto, CreateMaintenanceDto, FixMaintenanceDto, ListMaintenanceDto, MaintenanceNoteDto,
} from './dto/maintenance.dto';
import { MaintenanceService } from './maintenance.service';

const uuid = new ParseUUIDPipe();

@Controller('maintenance')
@RequireFeature('maintenance')
export class MaintenanceController {
  constructor(private svc: MaintenanceService) {}

  @Post() @Roles(Role.DORM_SUPERVISOR)
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateMaintenanceDto) { return this.svc.create(u, dto); }

  @Get() @Roles(Role.DORM_SUPERVISOR, Role.SYSTEM_MANAGER, Role.SENIOR_ADMIN, Role.FACILITIES, Role.GENERAL_AFFAIRS)
  list(@CurrentUser() u: AuthUser, @Query() q: ListMaintenanceDto) { return this.svc.list(u, q); }

  @Get(':id') @Roles(Role.DORM_SUPERVISOR, Role.SYSTEM_MANAGER, Role.SENIOR_ADMIN, Role.FACILITIES, Role.GENERAL_AFFAIRS)
  get(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.svc.get(u, id); }

  @Post(':id/approve') @HttpCode(200) @Roles(Role.SYSTEM_MANAGER)
  approve(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: ApproveMaintenanceDto) { return this.svc.approve(u, id, dto); }

  @Post(':id/reject') @HttpCode(200) @Roles(Role.SYSTEM_MANAGER)
  reject(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: MaintenanceNoteDto) { return this.svc.reject(u, id, dto.note); }

  @Post(':id/supervisor-approve') @HttpCode(200) @Roles(Role.DORM_SUPERVISOR)
  supervisorApprove(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: MaintenanceNoteDto) { return this.svc.supervisorApprove(u, id, dto.note); }

  @Post(':id/supervisor-reject') @HttpCode(200) @Roles(Role.DORM_SUPERVISOR)
  supervisorReject(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: MaintenanceNoteDto) { return this.svc.supervisorReject(u, id, dto.note); }

  @Post(':id/assign') @HttpCode(200) @Roles(Role.SYSTEM_MANAGER)
  assign(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: AssignMaintenanceDto) { return this.svc.assign(u, id, dto); }

  @Post(':id/note') @HttpCode(200) @Roles(Role.SYSTEM_MANAGER, Role.FACILITIES, Role.GENERAL_AFFAIRS)
  note(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: MaintenanceNoteDto) { return this.svc.addNote(u, id, dto.note ?? ''); }

  @Post(':id/start') @HttpCode(200) @Roles(Role.SYSTEM_MANAGER, Role.FACILITIES, Role.GENERAL_AFFAIRS)
  start(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: MaintenanceNoteDto) { return this.svc.start(u, id, dto.note); }

  @Post(':id/fix') @HttpCode(200) @Roles(Role.SYSTEM_MANAGER, Role.FACILITIES, Role.GENERAL_AFFAIRS)
  fix(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: FixMaintenanceDto) { return this.svc.fix(u, id, dto); }

  @Post(':id/confirm') @HttpCode(200) @Roles(Role.DORM_SUPERVISOR)
  confirm(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: MaintenanceNoteDto) { return this.svc.confirm(u, id, dto.note); }

  @Post(':id/reopen') @HttpCode(200) @Roles(Role.DORM_SUPERVISOR)
  reopen(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: MaintenanceNoteDto) { return this.svc.reopen(u, id, dto.note); }
}
