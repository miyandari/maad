import { Module } from '@nestjs/common';
import { StudentsModule } from '../students/students.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

@Module({ imports: [StudentsModule], controllers: [AttendanceController], providers: [AttendanceService] })
export class AttendanceModule {}
