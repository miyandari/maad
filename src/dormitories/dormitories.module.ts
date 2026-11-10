import { Module } from '@nestjs/common';
import { DormitoriesController } from './dormitories.controller';
import { DormitoriesService } from './dormitories.service';

@Module({ controllers: [DormitoriesController], providers: [DormitoriesService] })
export class DormitoriesModule {}
