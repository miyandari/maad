import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateUserDto, ListUsersDto, ResetPasswordDto, SetActiveDto, SetDormitoryDto, SetPermissionsDto, UpdateUserDto } from './dto/user.dto';
import { UsersService } from './users.service';

@Controller('users')
@Roles(Role.SUPER_ADMIN, Role.SENIOR_ADMIN, Role.SYSTEM_MANAGER, Role.DORM_SUPERVISOR)
export class UsersController {
  constructor(private svc: UsersService) {}

  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: CreateUserDto) { return this.svc.create(u, dto); }

  @Get() list(@CurrentUser() u: AuthUser, @Query() q: ListUsersDto) { return this.svc.list(u, q); }

  @Patch(':id')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.svc.update(u, id, dto);
  }

  @Post(':id/reset-password') @HttpCode(200)
  resetPassword(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResetPasswordDto) {
    return this.svc.resetPassword(u, id, dto.newPassword);
  }

  @Patch(':id/dormitory')
  @Roles(Role.SYSTEM_MANAGER, Role.DORM_SUPERVISOR)
  setDormitory(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetDormitoryDto) {
    return this.svc.setDormitory(u, id, dto.dormitoryId);
  }

  @Patch(':id/permissions')
  @Roles(Role.SUPER_ADMIN, Role.SENIOR_ADMIN, Role.SYSTEM_MANAGER)
  setPermissions(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetPermissionsDto) {
    return this.svc.setPermissions(u, id, dto.permissions);
  }

  @Patch(':id/active')
  setActive(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetActiveDto) {
    return this.svc.setActive(u, id, dto.isActive);
  }
}
