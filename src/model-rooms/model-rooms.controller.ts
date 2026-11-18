import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateCriterionDto, ListSelectionsDto, SaveScoresDto, SelectRoomDto, UpdateCriterionDto, YearQueryDto } from './dto/model-room.dto';
import { ModelRoomsService } from './model-rooms.service';

const uuid = new ParseUUIDPipe();

@Controller('model-rooms')
export class ModelRoomsController {
  constructor(private svc: ModelRoomsService) {}

  // ---- criteria (defined by the system manager, read by the supervisor) ----
  @Get('criteria') @Roles(Role.SYSTEM_MANAGER, Role.SENIOR_ADMIN, Role.DORM_SUPERVISOR)
  criteria(@CurrentUser() u: AuthUser) { return this.svc.listCriteria(u); }

  @Post('criteria') @Roles(Role.SYSTEM_MANAGER)
  createCriterion(@CurrentUser() u: AuthUser, @Body() dto: CreateCriterionDto) { return this.svc.createCriterion(u, dto); }

  @Patch('criteria/:id') @Roles(Role.SYSTEM_MANAGER)
  updateCriterion(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: UpdateCriterionDto) { return this.svc.updateCriterion(u, id, dto); }

  @Delete('criteria/:id') @Roles(Role.SYSTEM_MANAGER)
  deleteCriterion(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.svc.deleteCriterion(u, id); }

  // ---- the supervisor's yearly scoring and choice ----
  @Get('board') @Roles(Role.DORM_SUPERVISOR)
  board(@CurrentUser() u: AuthUser, @Query() q: YearQueryDto) { return this.svc.board(u, q.year); }

  @Put('scores') @Roles(Role.DORM_SUPERVISOR)
  saveScores(@CurrentUser() u: AuthUser, @Body() dto: SaveScoresDto) { return this.svc.saveScores(u, dto); }

  @Post('selection') @Roles(Role.DORM_SUPERVISOR)
  select(@CurrentUser() u: AuthUser, @Body() dto: SelectRoomDto) { return this.svc.select(u, dto); }

  // ---- announced model rooms ----
  @Get('selections') @Roles(Role.SUPER_ADMIN, Role.SENIOR_ADMIN, Role.SYSTEM_MANAGER, Role.DORM_SUPERVISOR)
  selections(@CurrentUser() u: AuthUser, @Query() q: ListSelectionsDto) { return this.svc.selections(u, q); }
}
