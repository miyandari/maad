import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireFeature } from '../common/decorators/features.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ForbiddenException } from '@nestjs/common';
import { BoardQueryDto, CreateMessageTemplateDto, ListBatchesDto, ListInboxDto, SendMessageDto } from './dto/messaging.dto';
import { MessagingService } from './messaging.service';

const uuid = new ParseUUIDPipe();
const SENDERS = [Role.SYSTEM_MANAGER, Role.DORM_SUPERVISOR];

@Controller('messages')
@RequireFeature('messaging')
export class MessagingController {
  constructor(private svc: MessagingService) {}

  @Post('preview') @HttpCode(200) @Roles(...SENDERS)
  preview(@CurrentUser() u: AuthUser, @Body() dto: SendMessageDto) { return this.svc.preview(u, dto); }

  @Post() @Roles(...SENDERS)
  send(@CurrentUser() u: AuthUser, @Body() dto: SendMessageDto) { return this.svc.send(u, dto); }

  @Get('batches') @Roles(...SENDERS)
  batches(@CurrentUser() u: AuthUser, @Query() q: ListBatchesDto) { return this.svc.listBatches(u, q); }

  @Get('batches/:id') @Roles(...SENDERS)
  batch(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.svc.batchDetail(u, id); }

  @Post('batches/:id/cancel') @HttpCode(200) @Roles(...SENDERS)
  cancel(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.svc.cancel(u, id); }

  @Get('sms-balance') @Roles(...SENDERS)
  balance(@CurrentUser() u: AuthUser) {
    if (!u.permissions?.includes('sms.send')) throw new ForbiddenException('You need the sms.send permission');
    return this.svc.balance();
  }

  // ---- templates ----
  @Post('templates') @Roles(...SENDERS)
  createTemplate(@CurrentUser() u: AuthUser, @Body() dto: CreateMessageTemplateDto) { return this.svc.createTemplate(u, dto); }

  @Get('templates') @Roles(...SENDERS)
  templates(@CurrentUser() u: AuthUser) { return this.svc.listTemplates(u); }

  @Delete('templates/:id') @Roles(...SENDERS)
  deleteTemplate(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.svc.deleteTemplate(u, id); }

  // ---- in-app ----
  @Get('inbox') @Roles(Role.DORM_SUPERVISOR, Role.ATTENDANT, Role.SERVICE_STAFF)
  inbox(@CurrentUser() u: AuthUser, @Query() q: ListInboxDto) { return this.svc.inbox(u, q); }

  @Post('inbox/:id/read') @HttpCode(200) @Roles(Role.DORM_SUPERVISOR, Role.ATTENDANT, Role.SERVICE_STAFF)
  markRead(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.svc.markRead(u, id); }

  @Get('board') @Roles(Role.DORM_SUPERVISOR, Role.ATTENDANT, Role.SERVICE_STAFF, Role.SYSTEM_MANAGER)
  board(@CurrentUser() u: AuthUser, @Query() q: BoardQueryDto) { return this.svc.board(u, q); }
}
