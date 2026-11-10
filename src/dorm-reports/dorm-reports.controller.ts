import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { DormReportsService } from './dorm-reports.service';
import { CreateDormReportDto, ListDormReportsDto, ReviewReportDto } from './dto/dorm-report.dto';

const uuid = new ParseUUIDPipe();
const READERS = [Role.ATTENDANT, Role.DORM_SUPERVISOR, Role.SENIOR_ADMIN, Role.SYSTEM_MANAGER];

@Controller('reports/dormitory')
export class DormReportsController {
  constructor(private svc: DormReportsService) {}

  @Post() @Roles(Role.ATTENDANT, Role.DORM_SUPERVISOR)
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateDormReportDto) { return this.svc.create(u, dto); }

  @Get() @Roles(...READERS)
  list(@CurrentUser() u: AuthUser, @Query() q: ListDormReportsDto) { return this.svc.list(u, q); }

  @Get(':id') @Roles(...READERS)
  get(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.svc.get(u, id); }

  @Post(':id/review') @HttpCode(200) @Roles(Role.DORM_SUPERVISOR)
  review(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: ReviewReportDto) { return this.svc.review(u, id, dto.note); }

  @Post(':id/escalate') @HttpCode(200) @Roles(Role.DORM_SUPERVISOR)
  escalate(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: ReviewReportDto) { return this.svc.escalate(u, id, dto.note); }
}
