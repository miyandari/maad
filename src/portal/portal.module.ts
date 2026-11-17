import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CouncilController } from './council.controller';
import { CouncilService } from './council.service';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';
import { StudentAuthController } from './student-auth.controller';
import { StudentAuthService } from './student-auth.service';

@Module({
  imports: [AuthModule],
  controllers: [StudentAuthController, PortalController, CouncilController],
  providers: [StudentAuthService, PortalService, CouncilService],
})
export class PortalModule {}
