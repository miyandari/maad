import { Module } from '@nestjs/common';
import { ModelRoomsController } from './model-rooms.controller';
import { ModelRoomsService } from './model-rooms.service';

@Module({ controllers: [ModelRoomsController], providers: [ModelRoomsService] })
export class ModelRoomsModule {}
