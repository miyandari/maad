import { PartialType } from '@nestjs/mapped-types';
import { DormitoryType, Gender, RoomType } from '@prisma/client';
import {
  IsBoolean, IsEnum, IsInt, IsLatitude, IsLongitude, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min,
} from 'class-validator';
import { PaginationDto } from '../../common/pagination.dto';

export class CreateDormitoryDto {
  @IsString() @IsNotEmpty() name: string;
  /** ملکی / استیجاری / خودگردان مشارکتی / خودگردان */
  @IsEnum(DormitoryType) ownershipType: DormitoryType;
  @IsEnum(Gender) gender: Gender;
  @IsInt() @Min(0) nominalCapacity: number;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsLatitude() latitude?: number;
  @IsOptional() @IsLongitude() longitude?: number;
  @IsOptional() @IsString() @MaxLength(20) landline?: string;
}

export class UpdateDormitoryDto extends PartialType(CreateDormitoryDto) {
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ListDormitoriesDto extends PaginationDto {
  @IsOptional() @IsString() universityId?: string; // honoured for SUPER_ADMIN only
}

export class CreateBuildingDto {
  @IsString() @IsNotEmpty() name: string;
}

export class CreateRoomDto {
  @IsString() @IsNotEmpty() @Matches(/^[\w-]{1,16}$/) number: string;
  @IsOptional() @IsInt() floor?: number;
  @IsOptional() @IsEnum(RoomType) type?: RoomType;
  /** Beds in the room. Only for RESIDENTIAL rooms. */
  @IsOptional() @IsInt() @Min(0) @Max(20) capacity?: number;
}

export class BulkRoomsDto {
  @IsOptional() @IsString() @Matches(/^[\w-]{0,8}$/) prefix?: string;
  @IsInt() @Min(0) from: number;
  @IsInt() @Min(0) to: number;
  @IsOptional() @IsInt() floor?: number;
  @IsInt() @Min(1) @Max(20) capacity: number;
}

export class UpdateRoomDto {
  @IsOptional() @IsInt() floor?: number;
  @IsOptional() @IsInt() @Min(0) @Max(20) capacity?: number;
}
