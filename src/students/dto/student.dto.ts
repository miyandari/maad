import { OmitType, PartialType } from '@nestjs/mapped-types';
import {
  AssignmentKind, DegreeLevel, EmergencyRelation, Gender, GuardianRelation, ResidencyStatus,
} from '@prisma/client';
import { IsBoolean, IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { MOBILE_RE } from '../../common/phone';
import { IsNationalId } from '../../common/national-id';
import { PaginationDto } from '../../common/pagination.dto';

export class CreateStudentDto {
  @IsNationalId() nationalId: string;
  @IsString() @IsNotEmpty() firstName: string;
  @IsString() @IsNotEmpty() lastName: string;
  /** Ignored for supervisors: the gender always follows the dormitory type. Required when a system manager registers a student. */
  @IsOptional() @IsEnum(Gender) gender?: Gender;
  @IsOptional() @IsString() fatherName?: string;
  @IsOptional() @IsString() @MaxLength(32) studentNumber?: string;
  /** کارشناسی / ارشد / دکترای عمومی / PhD */
  @IsOptional() @IsEnum(DegreeLevel) degree?: DegreeLevel;
  @IsOptional() @IsString() major?: string;
  /** Student's own mobile — required. */
  @Matches(MOBILE_RE, { message: 'phone must be an Iranian mobile number' }) phone: string;
  @IsOptional() @IsString() @MaxLength(20) landline?: string;
  /** Guardian mobile and who it belongs to (father / mother). */
  @IsOptional() @Matches(MOBILE_RE, { message: 'guardianPhone must be an Iranian mobile number' }) guardianPhone?: string;
  @IsOptional() @IsEnum(GuardianRelation) guardianRelation?: GuardianRelation;
  /** Emergency contact: friend / brother / sister / relative. */
  @IsOptional() @IsString() @MaxLength(20) emergencyContactPhone?: string;
  @IsOptional() @IsEnum(EmergencyRelation) emergencyContactRelation?: EmergencyRelation;
  @IsOptional() @IsString() emergencyContactName?: string;
}

export class UpdateStudentDto extends PartialType(OmitType(CreateStudentDto, ['nationalId', 'gender'] as const)) {
  @IsOptional() @IsBoolean() smsOptOut?: boolean;
}

export class LookupStudentDto {
  @IsNationalId() nationalId: string;
}

export class ListStudentsDto extends PaginationDto {
  @IsOptional() @IsUUID() dormitoryId?: string;
  @IsOptional() @IsUUID() buildingId?: string;
  @IsOptional() @IsUUID() roomId?: string;
  @IsOptional() @IsEnum(ResidencyStatus) status?: ResidencyStatus;
  @IsOptional() @IsString() @MaxLength(50) q?: string;
}

export class PlaceDto {
  @IsUUID() roomId: string;
  /** Required for kind=BED; must be omitted for FLOOR / EXTRA. */
  @IsOptional() @IsUUID() bedId?: string;
  @IsEnum(AssignmentKind) kind: AssignmentKind;
  @IsOptional() @IsString() note?: string;
}

export class CheckoutDto {
  @IsOptional() @IsString() note?: string;
}

export class StudentLeaveDto {
  @IsOptional() @IsDateString() expectedReturnAt?: string;
  @IsOptional() @IsString() reason?: string;
}
