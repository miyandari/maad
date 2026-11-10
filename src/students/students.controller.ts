import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CheckoutDto, CreateStudentDto, ListStudentsDto, LookupStudentDto, PlaceDto, StudentLeaveDto, UpdateStudentDto } from './dto/student.dto';
import { StudentsService } from './students.service';

const uuid = new ParseUUIDPipe();
const WRITERS = [Role.SYSTEM_MANAGER, Role.DORM_SUPERVISOR];
const READERS = [Role.SENIOR_ADMIN, Role.SYSTEM_MANAGER, Role.DORM_SUPERVISOR, Role.ATTENDANT];

@Controller()
export class StudentsController {
  constructor(private svc: StudentsService) {}

  @Post('students') @Roles(...WRITERS)
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateStudentDto) { return this.svc.create(u, dto); }

  @Get('students/lookup') @Roles(...WRITERS)
  lookup(@CurrentUser() u: AuthUser, @Query() q: LookupStudentDto) { return this.svc.lookup(u, q.nationalId); }

  @Get('students') @Roles(...READERS)
  list(@CurrentUser() u: AuthUser, @Query() q: ListStudentsDto) { return this.svc.list(u, q); }

  @Get('students/:id') @Roles(...READERS)
  get(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.svc.get(u, id); }

  @Patch('students/:id') @Roles(...WRITERS)
  update(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: UpdateStudentDto) { return this.svc.update(u, id, dto); }

  @Post('students/:id/assign') @Roles(...WRITERS)
  assign(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: PlaceDto) { return this.svc.assign(u, id, dto); }

  @Post('students/:id/move') @Roles(...WRITERS)
  move(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: PlaceDto) { return this.svc.move(u, id, dto); }

  @Post('students/:id/checkout') @Roles(...WRITERS)
  checkout(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: CheckoutDto) { return this.svc.checkout(u, id, dto.note); }

  @Post('students/:id/leave') @Roles(...WRITERS)
  startLeave(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: StudentLeaveDto) { return this.svc.startLeave(u, id, dto); }

  @Post('students/:id/return') @Roles(...WRITERS)
  endLeave(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.svc.endLeave(u, id); }

  @Get('rooms/:id/residents') @Roles(...READERS)
  residents(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.svc.roomResidents(u, id); }
}
