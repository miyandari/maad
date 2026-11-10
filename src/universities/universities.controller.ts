import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateUniversityDto, UpdateFeaturesDto, UpdateUniversityDto } from './dto/university.dto';
import { UniversitiesService } from './universities.service';

@Controller('universities')
@Roles(Role.SUPER_ADMIN)
export class UniversitiesController {
  constructor(private svc: UniversitiesService) {}

  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: CreateUniversityDto) { return this.svc.create(u, dto); }
  @Get() list() { return this.svc.list(); }
  @Patch(':id/features') setFeatures(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFeaturesDto) {
    return this.svc.setFeatures(u, id, dto.disabledFeatures);
  }
  @Patch(':id') update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUniversityDto) {
    return this.svc.update(u, id, dto);
  }
}
