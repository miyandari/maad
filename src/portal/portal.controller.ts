import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { FeedbackDto, ForwardDto, ReturnDto, StudentRequestDto } from './dto/portal.dto';
import { PortalService } from './portal.service';

const uuid = new ParseUUIDPipe();

/** Everything a signed-in student can do. */
@Controller('student')
@Roles(Role.STUDENT)
export class PortalController {
  constructor(private svc: PortalService) {}

  @Post('requests') create(@CurrentUser() u: AuthUser, @Body() dto: StudentRequestDto) { return this.svc.createRequest(u, dto); }
  @Get('requests') mine(@CurrentUser() u: AuthUser) { return this.svc.myRequests(u); }
  @Post('requests/:id/escalate') @HttpCode(200) escalate(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.svc.escalate(u, id); }

  @Get('proposals') proposals(@CurrentUser() u: AuthUser) { return this.svc.proposals(u); }
  @Post('proposals/:id/support') @HttpCode(200) support(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.svc.toggleSupport(u, id); }
  @Post('proposals/:id/forward') @HttpCode(200) forward(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: ForwardDto) { return this.svc.forward(u, id, dto.summary); }
  @Post('proposals/:id/return') @HttpCode(200) back(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: ReturnDto) { return this.svc.returnRequest(u, id, dto.note); }

  @Get('staff') staff(@CurrentUser() u: AuthUser) { return this.svc.staff(u); }
  @Post('feedback') feedback(@CurrentUser() u: AuthUser, @Body() dto: FeedbackDto) { return this.svc.sendFeedback(u, dto); }
  @Get('feedback') myFeedback(@CurrentUser() u: AuthUser) { return this.svc.myFeedback(u); }
}
