import { Type } from 'class-transformer';
import { ChecklistReportStatus, MissionStatus } from '@prisma/client';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested,
} from 'class-validator';
import { DATE_RE } from '../../common/dates';
import { PaginationDto } from '../../common/pagination.dto';

export class ChecklistItemDto {
  @IsString() @IsNotEmpty() @MaxLength(200) title: string;
}

export class CreateTemplateDto {
  @IsString() @IsNotEmpty() @MaxLength(100) name: string;
  /** Omit to apply the checklist to every dormitory of the university. */
  @IsOptional() @IsUUID() dormitoryId?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ChecklistItemDto)
  items: ChecklistItemDto[];
}

export class SetTemplateActiveDto {
  @IsBoolean() isActive: boolean;
}

export class ChecklistResultDto {
  @IsUUID() itemId: string;
  @IsBoolean() done: boolean;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class SubmitChecklistDto {
  @IsUUID() templateId: string;
  @IsOptional() @Matches(DATE_RE) date?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ChecklistResultDto)
  results: ChecklistResultDto[];
}

export class ListChecklistReportsDto extends PaginationDto {
  @IsOptional() @Matches(DATE_RE) date?: string;
  @IsOptional() @IsEnum(ChecklistReportStatus) status?: ChecklistReportStatus;
  @IsOptional() @IsUUID() dormitoryId?: string;
}

export class CreateMissionDto {
  @IsUUID() assigneeId: string;
  @IsString() @IsNotEmpty() @MaxLength(200) title: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsDateString() dueAt?: string;
}

export class CompleteMissionDto {
  @IsOptional() @IsString() @MaxLength(2000) resultNote?: string;
}

export class ListMissionsDto extends PaginationDto {
  @IsOptional() @IsEnum(MissionStatus) status?: MissionStatus;
}
