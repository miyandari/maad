import { MaintenanceStatus, RepairCategory, RequestKind } from '@prisma/client';
import { IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { PaginationDto } from '../../common/pagination.dto';

export class CreateMaintenanceDto {
  @IsEnum(RequestKind) kind: RequestKind;
  /** Required for REPAIR: ساختمانی / تأسیسات مکانیکی / برقی / سرمایش و گرمایش */
  @IsOptional() @IsEnum(RepairCategory) category?: RepairCategory;
  @IsString() @IsNotEmpty() @MaxLength(200) title: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsInt() @Min(1) quantity?: number;
}

export class ListMaintenanceDto extends PaginationDto {
  @IsOptional() @IsEnum(MaintenanceStatus) status?: MaintenanceStatus;
  @IsOptional() @IsEnum(RequestKind) kind?: RequestKind;
  @IsOptional() @IsEnum(RepairCategory) category?: RepairCategory;
  @IsOptional() @IsUUID() dormitoryId?: string;
}

export class ApproveMaintenanceDto {
  /** برآورد هزینه (ریال) */
  @IsNumber() @Min(0) estimatedCost: number;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class FixMaintenanceDto {
  @IsOptional() @IsNumber() @Min(0) actualCost?: number;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class MaintenanceNoteDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
