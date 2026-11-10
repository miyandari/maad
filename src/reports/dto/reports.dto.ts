import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class AbsentQueryDto {
  /** Students absent for MORE than this many days (default 14 = two weeks). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) days: number = 14;
  @IsOptional() @IsUUID() dormitoryId?: string;
}

export class StaffMonthlyQueryDto {
  /** Range start (inclusive) and end (exclusive), ISO dates/times. The client converts the Jalali month to these. */
  @IsDateString() from: string;
  @IsDateString() to: string;
  @IsOptional() @IsUUID() dormitoryId?: string;
}

export class MaintenanceSummaryQueryDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsUUID() dormitoryId?: string;
}
