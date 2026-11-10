import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** Approve / reject step used by leave, checklist and referral workflows. */
export class DecisionDto {
  @IsBoolean() approve: boolean;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
