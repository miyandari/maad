import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireFeature } from '../common/decorators/features.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { DecisionDto } from '../common/decision.dto';
import { CounselingService } from './counseling.service';
import {
  CloseReferralDto, CreatePsychScheduleDto, CreateReferralDto, ListPsychSchedulesDto, ListReferralsDto, ScheduleReferralDto,
} from './dto/counseling.dto';

const uuid = new ParseUUIDPipe();
const REFERRAL_ROLES = [Role.ATTENDANT, Role.DORM_SUPERVISOR, Role.COUNSELING];

@Controller()
@RequireFeature('counseling')
export class CounselingController {
  constructor(private svc: CounselingService) {}

  // ---- referrals (ارجاع به مشاوره) ----
  @Post('referrals') @Roles(Role.ATTENDANT, Role.DORM_SUPERVISOR)
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateReferralDto) { return this.svc.create(u, dto); }

  @Get('referrals') @Roles(...REFERRAL_ROLES)
  list(@CurrentUser() u: AuthUser, @Query() q: ListReferralsDto) { return this.svc.list(u, q); }

  @Get('referrals/:id') @Roles(...REFERRAL_ROLES)
  get(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.svc.get(u, id); }

  @Post('referrals/:id/decision') @HttpCode(200) @Roles(Role.DORM_SUPERVISOR)
  decide(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: DecisionDto) { return this.svc.decide(u, id, dto.approve, dto.note); }

  @Post('referrals/:id/receive') @HttpCode(200) @Roles(Role.COUNSELING)
  receive(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.svc.receive(u, id); }

  @Post('referrals/:id/schedule') @HttpCode(200) @Roles(Role.COUNSELING)
  schedule(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: ScheduleReferralDto) { return this.svc.schedule(u, id, dto); }

  @Post('referrals/:id/close') @HttpCode(200) @Roles(Role.COUNSELING)
  close(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: CloseReferralDto) { return this.svc.close(u, id, dto.note); }

  // ---- psychologist presence schedule (برنامه حضور روانشناسان) ----
  @Post('counseling/schedules') @Roles(Role.COUNSELING)
  createSchedule(@CurrentUser() u: AuthUser, @Body() dto: CreatePsychScheduleDto) { return this.svc.createSchedule(u, dto); }

  @Get('counseling/schedules') @Roles(Role.COUNSELING, Role.SENIOR_ADMIN, Role.SYSTEM_MANAGER, Role.DORM_SUPERVISOR, Role.ATTENDANT, Role.SERVICE_STAFF)
  listSchedules(@CurrentUser() u: AuthUser, @Query() q: ListPsychSchedulesDto) { return this.svc.listSchedules(u, q); }

  @Delete('counseling/schedules/:id') @Roles(Role.COUNSELING)
  deleteSchedule(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.svc.deleteSchedule(u, id); }
}
