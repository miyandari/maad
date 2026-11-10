import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AttendanceService } from './attendance.service';
import { HistoryQueryDto, RecordAttendanceDto, RosterQueryDto } from './dto/attendance.dto';

const uuid = new ParseUUIDPipe();

@Controller()
export class AttendanceController {
  constructor(private svc: AttendanceService) {}

  @Get('dormitories/:id/attendance')
  @Roles(Role.SYSTEM_MANAGER, Role.SENIOR_ADMIN, Role.DORM_SUPERVISOR, Role.ATTENDANT)
  roster(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Query() q: RosterQueryDto) {
    return this.svc.roster(u, id, q.date);
  }

  @Put('dormitories/:id/attendance')
  @Roles(Role.SYSTEM_MANAGER, Role.DORM_SUPERVISOR, Role.ATTENDANT)
  record(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: RecordAttendanceDto) {
    return this.svc.record(u, id, dto);
  }

  @Get('students/:id/attendance')
  @Roles(Role.SYSTEM_MANAGER, Role.SENIOR_ADMIN, Role.DORM_SUPERVISOR, Role.ATTENDANT)
  history(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Query() q: HistoryQueryDto) {
    return this.svc.studentHistory(u, id, q);
  }
}
