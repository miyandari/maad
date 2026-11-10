import { Controller, Get, Param, ParseEnumPipe, ParseUUIDPipe, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AttachmentEntity, Role } from '@prisma/client';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AttachmentsService, MAX_FILE_BYTES } from './attachments.service';

const uuid = new ParseUUIDPipe();
const ROLES = [Role.DORM_SUPERVISOR, Role.ATTENDANT, Role.SYSTEM_MANAGER, Role.SENIOR_ADMIN];

@Controller('attachments')
@Roles(...ROLES)
export class AttachmentsController {
  constructor(private svc: AttachmentsService) {}

  /** POST /attachments?entity=MAINTENANCE&entityId=<uuid>   (multipart, field "file", PDF/PNG/JPEG, max 10 MB) */
  @Post()
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 1 } }))
  upload(
    @CurrentUser() u: AuthUser,
    @Query('entity', new ParseEnumPipe(AttachmentEntity)) entity: AttachmentEntity,
    @Query('entityId', uuid) entityId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.svc.upload(u, entity, entityId, file);
  }

  @Get()
  list(
    @CurrentUser() u: AuthUser,
    @Query('entity', new ParseEnumPipe(AttachmentEntity)) entity: AttachmentEntity,
    @Query('entityId', uuid) entityId: string,
  ) {
    return this.svc.list(u, entity, entityId);
  }

  @Get(':id/download')
  async download(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Res({ passthrough: true }) res: Response) {
    const { att, stream } = await this.svc.download(u, id);
    res.set({
      'Content-Type': att.mimeType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(stream);
  }
}
