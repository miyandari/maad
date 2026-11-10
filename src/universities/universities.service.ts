import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth-user';
import { FeatureGuard } from '../common/guards/feature.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUniversityDto, UpdateUniversityDto } from './dto/university.dto';

@Injectable()
export class UniversitiesService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async create(actor: AuthUser, dto: CreateUniversityDto) {
    try {
      const uni = await this.prisma.university.create({ data: dto });
      await this.audit.log({ actor, action: 'university.create', entity: 'University', entityId: uni.id, universityId: uni.id, meta: { ...dto } });
      return uni;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('University name or code already exists');
      }
      throw e;
    }
  }

  list() {
    return this.prisma.university.findMany({ orderBy: { name: 'asc' } });
  }

  async setFeatures(actor: AuthUser, id: string, disabledFeatures: string[]) {
    const existing = await this.prisma.university.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('University not found');
    const uni = await this.prisma.university.update({ where: { id }, data: { disabledFeatures: [...new Set(disabledFeatures)] } });
    FeatureGuard.invalidate(id);
    await this.audit.log({
      actor, action: 'university.set_features', entity: 'University', entityId: id, universityId: id,
      meta: { from: existing.disabledFeatures, to: uni.disabledFeatures },
    });
    return uni;
  }

  async update(actor: AuthUser, id: string, dto: UpdateUniversityDto) {
    const existing = await this.prisma.university.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('University not found');
    try {
      const uni = await this.prisma.university.update({ where: { id }, data: dto });
      await this.audit.log({ actor, action: 'university.update', entity: 'University', entityId: id, universityId: id, meta: { ...dto } });
      return uni;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('University name or code already exists');
      }
      throw e;
    }
  }
}
