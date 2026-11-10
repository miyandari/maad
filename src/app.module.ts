import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AttachmentsModule } from './attachments/attachments.module';
import { AttendanceModule } from './attendance/attendance.module';
import { AuditController } from './audit/audit.controller';
import { AuditModule } from './audit/audit.service';
import { AuthModule } from './auth/auth.module';
import { ChecklistsModule } from './checklists/checklists.module';
import { IdempotencyInterceptor } from './common/idempotency.interceptor';
import { FeatureGuard } from './common/guards/feature.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PasswordChangeGuard } from './common/guards/password-change.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { CounselingModule } from './counseling/counseling.module';
import { DormReportsModule } from './dorm-reports/dorm-reports.module';
import { DormitoriesModule } from './dormitories/dormitories.module';
import { HealthModule } from './health/health.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { MessagingModule } from './messaging/messaging.module';
import { PrismaModule } from './prisma/prisma.service';
import { ReportsModule } from './reports/reports.module';
import { StaffModule } from './staff/staff.module';
import { StudentsModule } from './students/students.module';
import { SystemModule } from './system/system.module';
import { UniversitiesModule } from './universities/universities.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (env: Record<string, unknown>) => {
        if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
        if (typeof env.JWT_SECRET !== 'string' || env.JWT_SECRET.length < 32) {
          throw new Error('JWT_SECRET is required and must be at least 32 characters');
        }
        if (env.SMS_PROVIDER === 'kavenegar' && !env.KAVENEGAR_API_KEY) {
          throw new Error('KAVENEGAR_API_KEY is required when SMS_PROVIDER=kavenegar');
        }
        return env;
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    AuditModule,
    AuthModule,
    UniversitiesModule,
    UsersModule,
    DormitoriesModule,
    StudentsModule,
    AttendanceModule,
    StaffModule,
    DormReportsModule,
    CounselingModule,
    MaintenanceModule,
    HealthModule,
    AttachmentsModule,
    ChecklistsModule,
    MessagingModule,
    ReportsModule,
    SystemModule,
  ],
  controllers: [AuditController],
  providers: [
    // order matters: rate-limit -> authenticate -> force password change -> role -> university feature flag
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PasswordChangeGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: FeatureGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule {}
