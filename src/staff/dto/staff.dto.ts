import { Transform, Type } from 'class-transformer';
import { LeaveKind, LeaveStatus, ShiftType } from '@prisma/client';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { DATE_RE } from '../../common/dates';
import { PaginationDto } from '../../common/pagination.dto';

const toBool = ({ value }: { value: unknown }) => value === true || value === 'true';

export class CreateShiftDto {
  @IsUUID() dormitoryId: string;
  @IsUUID() userId: string;
  /** Standard shift: only the start date. Times and overtime follow the university's shift rules. */
  @IsOptional() @Matches(DATE_RE) date?: string;
  /** Custom shift: both times (no automatic overtime). */
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() endsAt?: string;
  @IsOptional() @IsEnum(ShiftType) type?: ShiftType;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class ListShiftsDto extends PaginationDto {
  @IsOptional() @IsUUID() dormitoryId?: string;
  @IsOptional() @IsUUID() userId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class CheckInDto {
  /** Time the action really happened (set by the offline queue). Accepted up to 7 days back. */
  @IsOptional() @IsDateString() clientTime?: string;
  @IsOptional() @IsUUID() dormitoryId?: string;
  /** The attendant whose shift is being taken over (تحویل شیفت). */
  @IsOptional() @IsUUID() handoverFromUserId?: string;
  @IsOptional() @IsString() @MaxLength(1000) handoverNote?: string;
}

export class ListPresenceDto extends PaginationDto {
  @IsOptional() @IsUUID() dormitoryId?: string;
  @IsOptional() @IsUUID() userId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @Transform(toBool) @IsBoolean() openOnly?: boolean;
}

export class CreateLeaveDto {
  @IsEnum(LeaveKind) kind: LeaveKind;
  @IsDateString() startsAt: string;
  @IsDateString() endsAt: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class ListLeavesDto extends PaginationDto {
  @IsOptional() @IsEnum(LeaveStatus) status?: LeaveStatus;
  @IsOptional() @IsUUID() dormitoryId?: string;
  @IsOptional() @Transform(toBool) @IsBoolean() mine?: boolean;
}

export class CheckOutDto {
  @IsOptional() @IsString() @MaxLength(1000) handoverNote?: string;
  @IsOptional() @IsDateString() clientTime?: string;
}

export class ShiftSettingsDto {
  @IsInt() @Min(0) @Max(23) startHour: number;
  @IsInt() @Min(0) @Max(23) workdayEndHour: number;
  @IsInt() @Min(0) @Max(23) holidayEndHour: number;
  /** 0 = Sunday ... 5 = Friday ... 6 = Saturday */
  @IsArray() @ArrayMaxSize(7) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) weeklyOffDays: number[];
}

export class HolidayItemDto {
  @Matches(DATE_RE) date: string;
  @IsString() @IsNotEmpty() @MaxLength(100) title: string;
}

export class CreateHolidaysDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(400) @ValidateNested({ each: true }) @Type(() => HolidayItemDto) items: HolidayItemDto[];
}

export class ListHolidaysDto {
  @IsOptional() @Matches(DATE_RE) from?: string;
  @IsOptional() @Matches(DATE_RE) to?: string;
}

/** Rotation: one attendant per day, in the given order. With 3 attendants each one works every third day. */
export class GenerateShiftsDto {
  @IsUUID() dormitoryId: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID('all', { each: true }) attendantIds: string[];
  /** First and last START date (inclusive), YYYY-MM-DD. */
  @Matches(DATE_RE) from: string;
  @Matches(DATE_RE) to: string;
  /** Which attendant of the list works on `from` (0 = the first one). */
  @IsOptional() @IsInt() @Min(0) firstIndex?: number;
  /** true = only compute and return the plan. */
  @IsOptional() @IsBoolean() dryRun?: boolean;
}
