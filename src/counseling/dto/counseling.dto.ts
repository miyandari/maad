import { ConcernType, ReferralStatus, Urgency } from '@prisma/client';
import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationDto } from '../../common/pagination.dto';

export class CreateReferralDto {
  @IsUUID() studentId: string;
  @IsEnum(ConcernType) concernType: ConcernType;
  @IsOptional() @IsEnum(Urgency) urgency?: Urgency;
  /** شرح ماوقع */
  @IsString() @IsNotEmpty() @MaxLength(5000) narrative: string;
}

export class ListReferralsDto extends PaginationDto {
  @IsOptional() @IsEnum(ReferralStatus) status?: ReferralStatus;
  @IsOptional() @IsEnum(Urgency) urgency?: Urgency;
}

export class ScheduleReferralDto {
  @IsDateString() scheduledAt: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

export class CloseReferralDto {
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

export class CreatePsychScheduleDto {
  @IsUUID() dormitoryId: string;
  @IsString() @IsNotEmpty() @MaxLength(200) psychologistName: string;
  @IsDateString() startsAt: string;
  @IsDateString() endsAt: string;
  @IsOptional() @IsString() @MaxLength(200) location?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class ListPsychSchedulesDto {
  @IsOptional() @IsUUID() dormitoryId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}
