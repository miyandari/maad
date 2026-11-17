import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CouncilService } from './council.service';
import { AppointRepDto, ListFeedbackDto } from './dto/portal.dto';

const uuid = new ParseUUIDPipe();

@Controller()
export class CouncilController {
  constructor(private svc: CouncilService) {}

  // ---- نماینده شورای صنفی ----
  @Put('council/reps') @Roles(Role.SENIOR_ADMIN)
  appoint(@CurrentUser() u: AuthUser, @Body() dto: AppointRepDto) { return this.svc.appoint(u, dto); }

  @Get('council/reps') @Roles(Role.SENIOR_ADMIN, Role.SYSTEM_MANAGER, Role.DORM_SUPERVISOR)
  reps(@CurrentUser() u: AuthUser) { return this.svc.list(u); }

  @Delete('council/reps/:id') @Roles(Role.SENIOR_ADMIN)
  end(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.svc.end(u, id); }

  // ---- students' opinions about staff ----
  @Get('feedback') @Roles(Role.SYSTEM_MANAGER, Role.SENIOR_ADMIN)
  feedback(@CurrentUser() u: AuthUser, @Query() q: ListFeedbackDto) { return this.svc.feedback(u, q); }

  @Get('feedback/summary') @Roles(Role.SYSTEM_MANAGER, Role.SENIOR_ADMIN)
  summary(@CurrentUser() u: AuthUser) { return this.svc.feedbackSummary(u); }
}
