import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  BulkRoomsDto, CreateBuildingDto, CreateDormitoryDto, CreateRoomDto, ListDormitoriesDto,
  UpdateDormitoryDto, UpdateRoomDto,
} from './dto/dormitory.dto';
import { DormitoriesService } from './dormitories.service';

const uuid = new ParseUUIDPipe();

// Reads are open to every authenticated role (scope is enforced in the service);
// writes are restricted with @Roles.
@Controller()
export class DormitoriesController {
  constructor(private svc: DormitoriesService) {}

  // ---- dormitories (defined by SYSTEM_MANAGER) ----
  @Post('dormitories') @Roles(Role.SYSTEM_MANAGER)
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateDormitoryDto) { return this.svc.create(u, dto); }

  @Get('dormitories')
  list(@CurrentUser() u: AuthUser, @Query() q: ListDormitoriesDto) { return this.svc.list(u, q); }

  @Get('dormitories/:id')
  get(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.svc.get(u, id); }

  @Patch('dormitories/:id') @Roles(Role.SYSTEM_MANAGER)
  update(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: UpdateDormitoryDto) {
    return this.svc.update(u, id, dto);
  }

  @Get('dormitories/:id/summary')
  summary(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.svc.summary(u, id); }

  // ---- buildings (defined by DORM_SUPERVISOR; SYSTEM_MANAGER may also do it) ----
  @Post('dormitories/:id/buildings') @Roles(Role.SYSTEM_MANAGER, Role.DORM_SUPERVISOR)
  createBuilding(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: CreateBuildingDto) {
    return this.svc.createBuilding(u, id, dto);
  }

  @Get('dormitories/:id/buildings')
  listBuildings(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.svc.listBuildings(u, id); }

  // ---- rooms & beds ----
  @Post('buildings/:id/rooms') @Roles(Role.SYSTEM_MANAGER, Role.DORM_SUPERVISOR)
  createRoom(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: CreateRoomDto) {
    return this.svc.createRoom(u, id, dto);
  }

  @Post('buildings/:id/rooms/bulk') @Roles(Role.SYSTEM_MANAGER, Role.DORM_SUPERVISOR)
  createRoomsBulk(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: BulkRoomsDto) {
    return this.svc.createRoomsBulk(u, id, dto);
  }

  @Get('buildings/:id/rooms')
  listRooms(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.svc.listRooms(u, id); }

  @Patch('rooms/:id') @Roles(Role.SYSTEM_MANAGER, Role.DORM_SUPERVISOR)
  updateRoom(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: UpdateRoomDto) {
    return this.svc.updateRoom(u, id, dto);
  }
}
