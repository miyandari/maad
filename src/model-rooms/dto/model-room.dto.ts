import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

export class CreateCriterionDto {
  @IsString() @IsNotEmpty() @MaxLength(200) title: string;
  /** اهمیت معیار (۱ تا ۵)؛ پیش‌فرض ۱ */
  @IsOptional() @IsInt() @Min(1) @Max(5) weight?: number;
}

export class UpdateCriterionDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) title?: string;
  @IsOptional() @IsInt() @Min(1) @Max(5) weight?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(10000) order?: number;
}

export class YearQueryDto {
  /** سال شمسی (پیش‌فرض: سال جاری) */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1300) @Max(1700) year?: number;
}

export class ScoreEntryDto {
  @IsUUID() criterionId: string;
  @IsInt() @Min(1) @Max(5) score: number;
}

export class SaveScoresDto {
  @IsUUID() roomId: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ScoreEntryDto) scores: ScoreEntryDto[];
}

export class SelectRoomDto {
  @IsUUID() roomId: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class ListSelectionsDto extends YearQueryDto {
  @IsOptional() @IsUUID() dormitoryId?: string;
  @IsOptional() @IsUUID() universityId?: string; // super admin only
}
