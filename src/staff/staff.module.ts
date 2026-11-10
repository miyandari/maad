import { Module } from '@nestjs/common';
import { LeavesService } from './leaves.service';
import { PresenceService } from './presence.service';
import { ShiftsService } from './shifts.service';
import { StaffController } from './staff.controller';

@Module({ controllers: [StaffController], providers: [ShiftsService, PresenceService, LeavesService] })
export class StaffModule {}
