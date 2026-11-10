import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsString() @IsNotEmpty() username: string;
  @IsString() @IsNotEmpty() password: string;
}

export class ChangePasswordDto {
  @IsString() @IsNotEmpty() oldPassword: string;
  // bcrypt only uses the first 72 bytes
  @IsString() @MinLength(6) @MaxLength(72) newPassword: string;
}
