import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateLateArrivalDto, ListLateArrivalsDto } from './dto/late-arrival.dto';
import { LateArrivalsService } from './late-arrivals.service';

const uuid = new ParseUUIDPipe();

@Controller('late-arrivals')
export class LateArrivalsController {
  constructor(private svc: LateArrivalsService) {}

  @Post() @Roles(Role.ATTENDANT, Role.DORM_SUPERVISOR, Role.SYSTEM_MANAGER)
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateLateArrivalDto) { return this.svc.create(u, dto); }

  @Get() @Roles(Role.SENIOR_ADMIN, Role.SYSTEM_MANAGER, Role.DORM_SUPERVISOR, Role.ATTENDANT)
  list(@CurrentUser() u: AuthUser, @Query() q: ListLateArrivalsDto) { return this.svc.list(u, q); }

  @Delete(':id') @Roles(Role.ATTENDANT, Role.DORM_SUPERVISOR, Role.SYSTEM_MANAGER)
  remove(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.svc.remove(u, id); }
}
