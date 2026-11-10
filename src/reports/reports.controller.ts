import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';
import { AbsentQueryDto, MaintenanceSummaryQueryDto, StaffMonthlyQueryDto } from './dto/reports.dto';
import { ReportsService } from './reports.service';

const MGMT = [Role.SENIOR_ADMIN, Role.SYSTEM_MANAGER];
const MGMT_AND_SUPERVISOR = [...MGMT, Role.DORM_SUPERVISOR];

@Controller()
export class ReportsController {
  constructor(private reports: ReportsService, private dash: DashboardService) {}

  @Get('dashboard')
  dashboard(@CurrentUser() u: AuthUser) { return this.dash.dashboard(u); }

  @Get('reports/occupancy/:dormitoryId') @Roles(...MGMT_AND_SUPERVISOR)
  occupancy(@CurrentUser() u: AuthUser, @Param('dormitoryId', new ParseUUIDPipe()) id: string) { return this.reports.occupancy(u, id); }

  @Get('reports/vacancy') @Roles(...MGMT)
  vacancy(@CurrentUser() u: AuthUser) { return this.reports.vacancy(u); }

  @Get('reports/absent-students') @Roles(...MGMT_AND_SUPERVISOR)
  absent(@CurrentUser() u: AuthUser, @Query() q: AbsentQueryDto) { return this.reports.absentStudents(u, q); }

  @Get('reports/staff-monthly') @Roles(...MGMT_AND_SUPERVISOR)
  staffMonthly(@CurrentUser() u: AuthUser, @Query() q: StaffMonthlyQueryDto) { return this.reports.staffMonthly(u, q); }

  @Get('reports/maintenance-summary') @Roles(...MGMT)
  maintenance(@CurrentUser() u: AuthUser, @Query() q: MaintenanceSummaryQueryDto) { return this.reports.maintenanceSummary(u, q); }
}
