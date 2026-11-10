import { BadRequestException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { AttachmentEntity, ReportStatus, Role } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth-user';
import { inScope } from '../common/scope';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from './storage.service';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_PER_ENTITY = 10;

/** Only these types are accepted and the real content must match (the client-sent MIME type is not trusted). */
function sniff(buf: Buffer): string | null {
  if (buf.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
}

@Injectable()
export class AttachmentsService {
  constructor(private prisma: PrismaService, private storage: StorageService, private audit: AuditService) {}

  /** Resolves who owns the entity and whether the caller may view / add to it. */
  private async access(actor: AuthUser, entity: AttachmentEntity, entityId: string) {
    if (entity === AttachmentEntity.MAINTENANCE) {
      const r = await this.prisma.maintenanceRequest.findUnique({ where: { id: entityId } });
      const ok = r && inScope(actor, { universityId: r.universityId, dormitoryId: r.dormitoryId }) &&
        ([Role.SYSTEM_MANAGER, Role.SENIOR_ADMIN, Role.DORM_SUPERVISOR] as Role[]).includes(actor.role);
      if (!r || !ok) throw new NotFoundException('Not found');
      return { universityId: r.universityId, dormitoryId: r.dormitoryId, canWrite: actor.role === Role.SYSTEM_MANAGER || actor.role === Role.DORM_SUPERVISOR };
    }
    const r = await this.prisma.dormReport.findUnique({ where: { id: entityId } });
    const isManager = actor.role === Role.SYSTEM_MANAGER || actor.role === Role.SENIOR_ADMIN;
    const ok = r && (
      r.authorId === actor.id ||
      (actor.role === Role.DORM_SUPERVISOR && inScope(actor, { universityId: r.universityId, dormitoryId: r.dormitoryId })) ||
      (isManager && r.status === ReportStatus.ESCALATED && inScope(actor, { universityId: r.universityId }))
    );
    if (!r || !ok) throw new NotFoundException('Not found');
    return { universityId: r.universityId, dormitoryId: r.dormitoryId, canWrite: r.authorId === actor.id || actor.role === Role.DORM_SUPERVISOR };
  }

  async upload(actor: AuthUser, entity: AttachmentEntity, entityId: string, file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Send the file in the "file" field (multipart/form-data)');
    if (file.size > MAX_FILE_BYTES) throw new PayloadTooLargeException('Maximum file size is 10 MB');
    const a = await this.access(actor, entity, entityId);
    if (!a.canWrite) throw new NotFoundException('Not found');
    const mime = sniff(file.buffer);
    if (!mime) throw new BadRequestException('Only PDF, PNG and JPEG files are accepted');
    const count = await this.prisma.attachment.count({ where: { entity, entityId } });
    if (count >= MAX_PER_ENTITY) throw new BadRequestException(`At most ${MAX_PER_ENTITY} attachments per item`);

    const storageKey = randomUUID(); // never derived from the user's file name
    await this.storage.save(storageKey, file.buffer);
    const att = await this.prisma.attachment.create({
      data: {
        universityId: a.universityId, dormitoryId: a.dormitoryId, entity, entityId,
        filename: file.originalname.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120) || 'file',
        mimeType: mime, size: file.size, storageKey, uploadedById: actor.id,
      },
      select: { id: true, filename: true, mimeType: true, size: true, createdAt: true },
    });
    await this.audit.log({ actor, action: 'attachment.upload', entity: 'Attachment', entityId: att.id, universityId: a.universityId, meta: { entity, entityId } });
    return att;
  }

  async list(actor: AuthUser, entity: AttachmentEntity, entityId: string) {
    await this.access(actor, entity, entityId);
    return this.prisma.attachment.findMany({
      where: { entity, entityId }, orderBy: { createdAt: 'asc' },
      select: { id: true, filename: true, mimeType: true, size: true, createdAt: true },
    });
  }

  async download(actor: AuthUser, id: string) {
    const att = await this.prisma.attachment.findUnique({ where: { id } });
    if (!att) throw new NotFoundException('Attachment not found');
    await this.access(actor, att.entity, att.entityId);
    return { att, stream: this.storage.stream(att.storageKey) };
  }
}
