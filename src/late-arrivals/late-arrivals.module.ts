import { Module } from '@nestjs/common';
import { LateArrivalsController } from './late-arrivals.controller';
import { LateArrivalsService } from './late-arrivals.service';

@Module({ controllers: [LateArrivalsController], providers: [LateArrivalsService] })
export class LateArrivalsModule {}
