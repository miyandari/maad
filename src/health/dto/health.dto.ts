import { Type } from 'class-transformer';
import { HealthFollowStatus } from '@prisma/client';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationDto } from '../../common/pagination.dto';

const toBool = ({ value }: { value: unknown }) => value === true || value === 'true';

export class CreateHealthItemDto {
  @IsString() @IsNotEmpty() @MaxLength(200) title: string;
}

export class UpdateHealthItemDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) title?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(10000) order?: number;
}

export class HealthResultDto {
  @IsUUID() itemId: string;
  /** true = سالم، false = مورد دارد (then a description is required). */
  @IsBoolean() ok: boolean;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
}

export class CreateInspectionDto {
  @IsUUID() dormitoryId: string;
  /** When the inspection really took place (set by the device, so offline entries keep their time). */
  @IsOptional() @IsDateString() inspectedAt?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => HealthResultDto) results: HealthResultDto[];
}

export class ListInspectionsDto extends PaginationDto {
  @IsOptional() @IsUUID() dormitoryId?: string;
  @IsOptional() @IsUUID() universityId?: string; // super admin only
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @Transform(toBool) @IsBoolean() onlyIssues?: boolean;
}

export class ListAlertsDto {
  @IsOptional() @IsEnum(HealthFollowStatus) status?: HealthFollowStatus;
  @IsOptional() @IsUUID() dormitoryId?: string;
}

export class FollowUpDto {
  /** اقدامات انجام‌شده برای رفع مورد */
  @IsString() @IsNotEmpty() @MaxLength(2000) actionTaken: string;
  /** موانع موجود */
  @IsOptional() @IsString() @MaxLength(2000) obstacles?: string;
  /** true = مورد رفع شد */
  @IsOptional() @IsBoolean() resolved?: boolean;
}
