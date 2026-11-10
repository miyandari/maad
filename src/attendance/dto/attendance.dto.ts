import { Type } from 'class-transformer';
import { AttendanceStatus } from '@prisma/client';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsOptional, IsString, IsUUID, Matches, ValidateNested } from 'class-validator';
import { DATE_RE } from '../../common/dates';

export class AttendanceItemDto {
  @IsUUID() studentId: string;
  @IsEnum(AttendanceStatus) status: AttendanceStatus;
  @IsOptional() @IsString() note?: string;
}

export class RecordAttendanceDto {
  /** YYYY-MM-DD (Gregorian). Defaults to today in Tehran. */
  @IsOptional() @Matches(DATE_RE) date?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => AttendanceItemDto)
  records: AttendanceItemDto[];
}

export class RosterQueryDto {
  @IsOptional() @Matches(DATE_RE) date?: string;
}

export class HistoryQueryDto {
  @Matches(DATE_RE) from: string;
  @Matches(DATE_RE) to: string;
}
