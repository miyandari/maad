import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { DecisionDto } from '../common/decision.dto';
import { CheckInDto, CheckOutDto, CreateHolidaysDto, CreateLeaveDto, CreateShiftDto, GenerateShiftsDto, ListHolidaysDto, ListLeavesDto, ListPresenceDto, ListShiftsDto, ShiftSettingsDto } from './dto/staff.dto';
import { LeavesService } from './leaves.service';
import { PresenceService } from './presence.service';
import { ShiftsService } from './shifts.service';

const uuid = new ParseUUIDPipe();
const FLOOR_STAFF = [Role.ATTENDANT, Role.SERVICE_STAFF, Role.DORM_SUPERVISOR];

@Controller()
export class StaffController {
  constructor(private shifts: ShiftsService, private presence: PresenceService, private leaves: LeavesService) {}

  // ---- shifts ----
  @Post('shifts') @Roles(Role.SYSTEM_MANAGER, Role.DORM_SUPERVISOR)
  createShift(@CurrentUser() u: AuthUser, @Body() dto: CreateShiftDto) { return this.shifts.create(u, dto); }

  @Get('shifts') @Roles(Role.SENIOR_ADMIN, Role.SYSTEM_MANAGER, Role.DORM_SUPERVISOR, Role.ATTENDANT)
  listShifts(@CurrentUser() u: AuthUser, @Query() q: ListShiftsDto) { return this.shifts.list(u, q); }

  @Post('shifts/generate') @HttpCode(200) @Roles(Role.SYSTEM_MANAGER, Role.DORM_SUPERVISOR)
  generateShifts(@CurrentUser() u: AuthUser, @Body() dto: GenerateShiftsDto) { return this.shifts.generate(u, dto); }

  @Get('shifts/settings') @Roles(Role.SYSTEM_MANAGER, Role.SENIOR_ADMIN, Role.DORM_SUPERVISOR, Role.ATTENDANT)
  shiftSettings(@CurrentUser() u: AuthUser) { return this.shifts.getSettings(u); }

  @Put('shifts/settings') @Roles(Role.SYSTEM_MANAGER)
  saveShiftSettings(@CurrentUser() u: AuthUser, @Body() dto: ShiftSettingsDto) { return this.shifts.saveSettings(u, dto); }

  @Get('shifts/holidays') @Roles(Role.SYSTEM_MANAGER, Role.SENIOR_ADMIN, Role.DORM_SUPERVISOR, Role.ATTENDANT)
  holidays(@CurrentUser() u: AuthUser, @Query() q: ListHolidaysDto) { return this.shifts.listHolidays(u, q); }

  @Post('shifts/holidays') @Roles(Role.SYSTEM_MANAGER)
  addHolidays(@CurrentUser() u: AuthUser, @Body() dto: CreateHolidaysDto) { return this.shifts.addHolidays(u, dto); }

  @Delete('shifts/holidays/:id') @Roles(Role.SYSTEM_MANAGER)
  deleteHoliday(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.shifts.deleteHoliday(u, id); }

  @Post('shifts/:id/cancel') @HttpCode(200) @Roles(Role.SYSTEM_MANAGER, Role.DORM_SUPERVISOR)
  cancelShift(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.shifts.cancel(u, id); }

  // ---- presence ----
  @Post('presence/check-in') @Roles(...FLOOR_STAFF)
  checkIn(@CurrentUser() u: AuthUser, @Body() dto: CheckInDto) { return this.presence.checkIn(u, dto); }

  @Post('presence/check-out') @HttpCode(200) @Roles(...FLOOR_STAFF)
  checkOut(@CurrentUser() u: AuthUser, @Body() dto: CheckOutDto) { return this.presence.checkOut(u, dto.clientTime, dto.handoverNote); }

  @Get('presence/me') @Roles(...FLOOR_STAFF)
  myPresence(@CurrentUser() u: AuthUser) { return this.presence.current(u); }

  @Get('presence') @Roles(Role.SENIOR_ADMIN, Role.SYSTEM_MANAGER, Role.DORM_SUPERVISOR)
  listPresence(@CurrentUser() u: AuthUser, @Query() q: ListPresenceDto) { return this.presence.list(u, q); }

  // ---- leave ----
  @Post('leaves') @Roles(...FLOOR_STAFF)
  createLeave(@CurrentUser() u: AuthUser, @Body() dto: CreateLeaveDto) { return this.leaves.create(u, dto); }

  @Get('leaves') @Roles(Role.SENIOR_ADMIN, Role.SYSTEM_MANAGER, ...FLOOR_STAFF)
  listLeaves(@CurrentUser() u: AuthUser, @Query() q: ListLeavesDto) { return this.leaves.list(u, q); }

  @Post('leaves/:id/decision') @HttpCode(200) @Roles(Role.SYSTEM_MANAGER, Role.DORM_SUPERVISOR)
  decide(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: DecisionDto) {
    return this.leaves.decide(u, id, dto.approve, dto.note);
  }

  @Post('leaves/:id/cancel') @HttpCode(200) @Roles(...FLOOR_STAFF)
  cancelLeave(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.leaves.cancel(u, id); }
}
