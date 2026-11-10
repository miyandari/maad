import { Module } from '@nestjs/common';
import { DormReportsController } from './dorm-reports.controller';
import { DormReportsService } from './dorm-reports.service';

@Module({ controllers: [DormReportsController], providers: [DormReportsService], exports: [DormReportsService] })
export class DormReportsModule {}
