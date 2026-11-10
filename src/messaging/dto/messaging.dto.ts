import { Type } from 'class-transformer';
import { BatchStatus, ResidencyStatus, Role, StudentWorkPost } from '@prisma/client';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, ValidateNested,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationDto } from '../../common/pagination.dto';

export class AudienceDto {
  /** STAFF = employees (system manager / supervisor), RESIDENTS = students (supervisor only). */
  @IsIn(['STAFF', 'RESIDENTS']) type: 'STAFF' | 'RESIDENTS';
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) dormitoryIds?: string[];
  @IsOptional() @IsArray() @IsEnum(Role, { each: true }) roles?: Role[];
  /** Student-work posts (applies to attendants with a student-work contract). */
  @IsOptional() @IsArray() @IsEnum(StudentWorkPost, { each: true }) workerPosts?: StudentWorkPost[];
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) buildingIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true }) roomIds?: string[];
  @IsOptional() @IsArray() @IsEnum(ResidencyStatus, { each: true }) residencyStatuses?: ResidencyStatus[];
}

export class SendMessageDto {
  @IsBoolean() inApp: boolean;
  @IsBoolean() sms: boolean;
  /** Supports {{firstName}} {{lastName}} {{fullName}} {{dormitoryName}} {{date}}. */
  @IsOptional() @IsString() @MaxLength(1000) body?: string;
  @IsOptional() @IsUUID() templateId?: string;
  @ValidateNested() @Type(() => AudienceDto) audience: AudienceDto;
  /** Future time = scheduled send. */
  @IsOptional() @IsDateString() scheduledAt?: string;
  /** Send even if the SMS credit looks too low. */
  @IsOptional() @IsBoolean() force?: boolean;
}

export class CreateMessageTemplateDto {
  @IsString() @IsNotEmpty() @MaxLength(100) name: string;
  @IsString() @IsNotEmpty() @MaxLength(1000) body: string;
}

export class ListBatchesDto extends PaginationDto {
  @IsOptional() @IsEnum(BatchStatus) status?: BatchStatus;
}

export class ListInboxDto extends PaginationDto {
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() unreadOnly?: boolean;
}

export class BoardQueryDto {
  @IsUUID() dormitoryId: string;
}
