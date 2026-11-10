import { Global, Injectable, Module } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { IsOptional, IsString } from 'class-validator';
import { AuthUser } from '../common/auth-user';
import { PaginationDto } from '../common/pagination.dto';
import { requireUniversity } from '../common/scope';
import { PrismaService } from '../prisma/prisma.service';

export class ListAuditDto extends PaginationDto {
  @IsOptional() @IsString() entity?: string;
  @IsOptional() @IsString() actorId?: string;
}

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  log(entry: {
    actor: AuthUser | null;
    action: string;
    entity: string;
    entityId?: string;
    universityId?: string | null;
    meta?: Prisma.InputJsonValue;
  }) {
    return this.prisma.auditLog.create({
      data: {
        actorId: entry.actor?.id,
        actorRole: entry.actor?.role,
        universityId: entry.universityId ?? entry.actor?.universityId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        meta: entry.meta,
      },
    });
  }

  async list(actor: AuthUser, q: ListAuditDto) {
    const where: Prisma.AuditLogWhereInput = {
      ...(actor.role === Role.SUPER_ADMIN ? {} : { universityId: requireUniversity(actor) }),
      ...(q.entity ? { entity: q.entity } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
