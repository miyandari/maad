import { LateKind } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { PaginationDto } from '../../common/pagination.dto';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateLateArrivalDto {
  @IsUUID() studentId: string;
  @IsEnum(LateKind) kind: LateKind;
  /** The day he was late for (default: today). */
  @IsOptional() @Matches(DATE_RE) date?: string;
  /** When he actually arrived. */
  @IsOptional() @IsDateString() arrivedAt?: string;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

export class ListLateArrivalsDto extends PaginationDto {
  @IsOptional() @IsUUID() dormitoryId?: string;
  @IsOptional() @IsUUID() studentId?: string;
  @IsOptional() @IsEnum(LateKind) kind?: LateKind;
  @IsOptional() @Matches(DATE_RE) from?: string;
  @IsOptional() @Matches(DATE_RE) to?: string;
}
