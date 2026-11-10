import { EmploymentType, Role, StudentWorkPost } from '@prisma/client';
import {
  IsArray, IsBoolean, IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateIf,
} from 'class-validator';
import { IsNationalId } from '../../common/national-id';
import { PaginationDto } from '../../common/pagination.dto';

/** Permissions that can be granted per user (checked in code). */
export const PERMISSIONS = ['sms.send'] as const;

export class CreateUserDto {
  /** The user's national ID (کد ملی) is the username. */
  @IsNationalId()
  username: string;

  @IsString() @MinLength(6) @MaxLength(72) password: string;
  @IsString() @IsNotEmpty() firstName: string;
  @IsString() @IsNotEmpty() lastName: string;

  @IsOptional() @Matches(/^(\+98|0)?9\d{9}$/, { message: 'phone must be an Iranian mobile number' })
  phone?: string;

  @IsOptional() @IsString() jobTitle?: string;
  /** رسمی / قراردادی / قراردادی تبصره ۴ / شرکتی / ساعتی / طرحی (required for supervisors, service staff and non-student-worker attendants) */
  @IsOptional() @IsEnum(EmploymentType) employmentType?: EmploymentType;

  @IsEnum(Role) role: Role;

  /** Student-work contract (ATTENDANT only) and the post it covers. */
  @IsOptional() @IsBoolean() isStudentWorker?: boolean;
  @IsOptional() @IsEnum(StudentWorkPost) workerPost?: StudentWorkPost;

  /** Only used when the caller is SUPER_ADMIN (creating a SENIOR_ADMIN). Others are forced to their own university. */
  @IsOptional() @IsUUID() universityId?: string;

  /** For DORM_SUPERVISOR / ATTENDANT / SERVICE_STAFF. A DORM_SUPERVISOR caller is forced to their own dormitory. */
  @IsOptional() @IsUUID() dormitoryId?: string;
}

export class ListUsersDto extends PaginationDto {
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @IsUUID() dormitoryId?: string;
  @IsOptional() @IsUUID() universityId?: string; // honoured for SUPER_ADMIN only
}

export class SetDormitoryDto {
  @ValidateIf((o) => o.dormitoryId !== null)
  @IsUUID()
  dormitoryId: string | null;
}

export class SetActiveDto {
  @IsBoolean() isActive: boolean;
}

export class SetPermissionsDto {
  @IsArray() @IsIn(PERMISSIONS as unknown as string[], { each: true }) permissions: string[];
}

export class UpdateUserDto {
  @IsOptional() @IsNationalId() username?: string;
  @IsOptional() @IsString() @IsNotEmpty() firstName?: string;
  @IsOptional() @IsString() @IsNotEmpty() lastName?: string;
  @IsOptional() @Matches(/^(\+98|0)?9\d{9}$/, { message: 'phone must be an Iranian mobile number' }) phone?: string;
  @IsOptional() @IsString() jobTitle?: string;
  @IsOptional() @IsEnum(EmploymentType) employmentType?: EmploymentType;
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @IsBoolean() isStudentWorker?: boolean;
  @IsOptional() @IsEnum(StudentWorkPost) workerPost?: StudentWorkPost;
}

export class ResetPasswordDto {
  @IsString() @MinLength(6) @MaxLength(72) newPassword: string;
}
