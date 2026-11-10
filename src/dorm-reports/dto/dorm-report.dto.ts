import { MealType, ReportCategory, ReportStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { PaginationDto } from '../../common/pagination.dto';

export class CreateDormReportDto {
  @IsEnum(ReportCategory) category: ReportCategory;
  @IsOptional() @IsDateString() occurredAt?: string;
  @IsString() @IsNotEmpty() @MaxLength(200) title: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  /** FOOD_RECEIPT / FOOD_DELIVERY: meal and number of portions/items. */
  @IsOptional() @IsEnum(MealType) mealType?: MealType;
  @IsOptional() @IsInt() @Min(0) quantity?: number;
  /** OFFICIAL_VISIT: who visited. */
  @IsOptional() @IsString() @MaxLength(200) visitorName?: string;
  /** UNEXPECTED_BEHAVIOR: optional link to a resident. */
  @IsOptional() @IsUUID() studentId?: string;
}

export class ListDormReportsDto extends PaginationDto {
  @IsOptional() @IsEnum(ReportCategory) category?: ReportCategory;
  @IsOptional() @IsEnum(ReportStatus) status?: ReportStatus;
  @IsOptional() @IsUUID() dormitoryId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class ReviewReportDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
