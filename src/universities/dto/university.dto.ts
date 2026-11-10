import { PartialType } from '@nestjs/mapped-types';
import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { FEATURES } from '../../common/decorators/features.decorator';

export class CreateUniversityDto {
  @IsString() @IsNotEmpty() name: string;
  @IsString() @Matches(/^[a-z0-9-]{2,32}$/, { message: 'code: lowercase letters, digits, dash' }) code: string;
}

export class UpdateUniversityDto extends PartialType(CreateUniversityDto) {
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateFeaturesDto {
  /** Modules to switch OFF for this university. */
  @IsArray() @IsIn(FEATURES as unknown as string[], { each: true }) disabledFeatures: string[];
}
