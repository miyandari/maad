import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireFeature } from '../common/decorators/features.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Matches } from 'class-validator';
import { DATE_RE } from '../common/dates';
import { CounselingService } from './counseling.service';
import {
  AssignReferralDto, CloseReferralDto, CreatePsychScheduleDto, CreateReferralDto, ListPsychSchedulesDto, ListReferralsDto, ScheduleReferralDto,
  SessionDto, UpdatePsychScheduleDto, VisitsQueryDto,
} from './dto/counseling.dto';

class PerformanceQueryDto {
  @Matches(DATE_RE) from: string;
  @Matches(DATE_RE) to: string;
}

const uuid = new ParseUUIDPipe();
const REFERRAL_ROLES = [Role.ATTENDANT, Role.DORM_SUPERVISOR, Role.COUNSELING, Role.PSYCHOLOGIST];
const SCHEDULE_VIEWERS = [Role.COUNSELING, Role.PSYCHOLOGIST, Role.SENIOR_ADMIN, Role.SYSTEM_MANAGER, Role.DORM_SUPERVISOR, Role.ATTENDANT, Role.SERVICE_STAFF];

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

  @Post('referrals/:id/receive') @HttpCode(200) @Roles(Role.COUNSELING)
  receive(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.svc.receive(u, id); }

  @Post('referrals/:id/assign') @HttpCode(200) @Roles(Role.COUNSELING)
  assign(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: AssignReferralDto) { return this.svc.assign(u, id, dto.psychologistId); }

  @Post('referrals/:id/schedule') @HttpCode(200) @Roles(Role.COUNSELING, Role.PSYCHOLOGIST)
  schedule(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: ScheduleReferralDto) { return this.svc.schedule(u, id, dto); }

  @Post('referrals/:id/sessions') @HttpCode(200) @Roles(Role.COUNSELING, Role.PSYCHOLOGIST)
  session(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: SessionDto) { return this.svc.addSession(u, id, dto); }

  @Post('referrals/:id/close') @HttpCode(200) @Roles(Role.COUNSELING, Role.PSYCHOLOGIST)
  close(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: CloseReferralDto) { return this.svc.close(u, id, dto.note); }

  // ---- psychologist weekly plans (برنامه حضور روانشناسان) ----
  @Post('counseling/schedules') @Roles(Role.COUNSELING)
  createSchedule(@CurrentUser() u: AuthUser, @Body() dto: CreatePsychScheduleDto) { return this.svc.createSchedule(u, dto); }

  @Get('counseling/schedules') @Roles(...SCHEDULE_VIEWERS)
  listSchedules(@CurrentUser() u: AuthUser, @Query() q: ListPsychSchedulesDto) { return this.svc.listSchedules(u, q); }

  @Patch('counseling/schedules/:id') @Roles(Role.COUNSELING)
  updateSchedule(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: UpdatePsychScheduleDto) { return this.svc.updateSchedule(u, id, dto); }

  @Delete('counseling/schedules/:id') @Roles(Role.COUNSELING)
  deleteSchedule(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.svc.deleteSchedule(u, id); }

  @Get('counseling/visits') @Roles(...SCHEDULE_VIEWERS)
  visits(@CurrentUser() u: AuthUser, @Query() q: VisitsQueryDto) { return this.svc.visits(u, q); }

  @Get('counseling/performance') @Roles(Role.COUNSELING)
  performance(@CurrentUser() u: AuthUser, @Query() q: PerformanceQueryDto) { return this.svc.performance(u, q); }
}
