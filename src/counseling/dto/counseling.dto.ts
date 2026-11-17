import { Type } from 'class-transformer';
import { ConcernType, ReferralStatus, Urgency } from '@prisma/client';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min,
} from 'class-validator';
import { DATE_RE } from '../../common/dates';
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

export class AssignReferralDto {
  @IsUUID() psychologistId: string;
}

export class SessionDto {
  /** When the session took place (default: now). */
  @IsOptional() @IsDateString() heldAt?: string;
  /** Confidential summary — only the counseling office and psychologists can read it. */
  @IsString() @IsNotEmpty() @MaxLength(4000) summary: string;
  @IsOptional() @IsString() @MaxLength(2000) recommendation?: string;
  /** Plain-language advice shown to the supervisor / reporting attendant (no clinical detail). */
  @IsOptional() @IsString() @MaxLength(1000) supervisorFeedback?: string;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Weekly visit plan: the days of the week and the hours the psychologist is present in a dormitory. */
export class CreatePsychScheduleDto {
  @IsUUID() psychologistId: string;
  @IsUUID() dormitoryId: string;
  /** 0 = Sunday ... 6 = Saturday */
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(7) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) weekdays: number[];
  @Matches(HHMM, { message: 'startTime must be HH:mm' }) startTime: string;
  @Matches(HHMM, { message: 'endTime must be HH:mm' }) endTime: string;
  @IsOptional() @Matches(DATE_RE) validFrom?: string;
  @IsOptional() @Matches(DATE_RE) validTo?: string;
  @IsOptional() @IsString() @MaxLength(200) location?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class UpdatePsychScheduleDto {
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(7) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) weekdays?: number[];
  @IsOptional() @Matches(HHMM) startTime?: string;
  @IsOptional() @Matches(HHMM) endTime?: string;
  @IsOptional() @Matches(DATE_RE) validFrom?: string;
  @IsOptional() @Matches(DATE_RE) validTo?: string;
  @IsOptional() @IsString() @MaxLength(200) location?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ListPsychSchedulesDto {
  @IsOptional() @IsUUID() dormitoryId?: string;
  @IsOptional() @IsUUID() psychologistId?: string;
}

export class VisitsQueryDto {
  @Matches(DATE_RE) from: string;
  @Matches(DATE_RE) to: string;
  @IsOptional() @IsUUID() dormitoryId?: string;
  @IsOptional() @IsUUID() psychologistId?: string;
}
