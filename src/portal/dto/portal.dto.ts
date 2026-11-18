import { FeedbackKind, RepairCategory, RequestKind, RequestScope } from '@prisma/client';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';
import { DATE_RE } from '../../common/dates';
import { IsNationalId } from '../../common/national-id';
import { PaginationDto } from '../../common/pagination.dto';

export class RequestCodeDto {
  @IsNationalId() nationalId: string;
  /** Only needed if the same national ID is registered in more than one university. */
  @IsOptional() @IsString() @MaxLength(32) universityCode?: string;
}

export class VerifyCodeDto extends RequestCodeDto {
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' }) code: string;
}

export class StudentRequestDto {
  @IsEnum(RequestKind) kind: RequestKind;
  @IsOptional() @IsEnum(RepairCategory) category?: RepairCategory;
  @IsString() @IsNotEmpty() @MaxLength(200) title: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsInt() @Min(1) quantity?: number;
  /** ROOM = my own room (goes straight to the supervisor); DORMITORY = common areas / a collective need (goes to the council representative first). */
  @IsEnum(RequestScope) scope: RequestScope;
  /** Hazard (electricity, gas, water ...): always goes straight to the supervisor. */
  @IsOptional() @IsBoolean() urgent?: boolean;
}

export class ForwardDto {
  @IsOptional() @IsString() @MaxLength(1000) summary?: string;
}

export class MergeDto {
  /** درخواست‌های تکراری که در درخواست اصلی ادغام می‌شوند (همه در انتظار نماینده و هم‌نوع) */
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @IsUUID('all', { each: true }) duplicateIds: string[];
  @IsOptional() @IsString() @MaxLength(1000) summary?: string;
}

export class ReturnDto {
  @IsString() @IsNotEmpty() @MaxLength(500) note: string;
}

export class FeedbackDto {
  @IsUUID() targetUserId: string;
  @IsEnum(FeedbackKind) kind: FeedbackKind;
  @IsString() @IsNotEmpty() @MaxLength(1000) text: string;
}

export class AppointRepDto {
  @IsUUID() dormitoryId: string;
  @IsUUID() studentId: string;
  /** Default: one year from today. */
  @IsOptional() @Matches(DATE_RE) endsAt?: string;
}

export class ListFeedbackDto extends PaginationDto {
  @IsOptional() @IsUUID() dormitoryId?: string;
  @IsOptional() @IsUUID() targetUserId?: string;
  @IsOptional() @IsEnum(FeedbackKind) kind?: FeedbackKind;
}
