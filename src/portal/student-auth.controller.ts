import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { RequestCodeDto, VerifyCodeDto } from './dto/portal.dto';
import { StudentAuthService } from './student-auth.service';

@Controller('student-auth')
export class StudentAuthController {
  constructor(private svc: StudentAuthService) {}

  @Public() @Throttle({ default: { limit: 8, ttl: 60_000 } }) @HttpCode(200)
  @Post('request-code')
  request(@Body() dto: RequestCodeDto) { return this.svc.requestCode(dto.nationalId, dto.universityCode); }

  @Public() @Throttle({ default: { limit: 10, ttl: 60_000 } }) @HttpCode(200)
  @Post('verify')
  verify(@Body() dto: VerifyCodeDto) { return this.svc.verify(dto.nationalId, dto.code, dto.universityCode); }
}
