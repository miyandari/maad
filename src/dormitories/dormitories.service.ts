import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { Dormitory, Prisma, Role, RoomType } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth-user';
import { DORMITORY_BOUND, requireDormitory, requireUniversity } from '../common/scope';
import { PrismaService } from '../prisma/prisma.service';
import {
  BulkRoomsDto, CreateBuildingDto, CreateDormitoryDto, CreateRoomDto, ListDormitoriesDto,
  UpdateDormitoryDto, UpdateRoomDto,
} from './dto/dormitory.dto';

const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
const bedLabels = (from: number, to: number) =>
  Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => ({ label: String(from + i) }));

@Injectable()
export class DormitoriesService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  // ================= dormitories =================

  async create(actor: AuthUser, dto: CreateDormitoryDto) {
    const universityId = requireUniversity(actor);
    try {
      const d = await this.prisma.dormitory.create({ data: { ...dto, universityId } });
      await this.audit.log({ actor, action: 'dormitory.create', entity: 'Dormitory', entityId: d.id, universityId, meta: { name: d.name } });
      return d;
    } catch (e) {
      if (isUnique(e)) throw new ConflictException('A dormitory with this name already exists in your university');
      throw e;
    }
  }

  async list(actor: AuthUser, q: ListDormitoriesDto) {
    const where: Prisma.DormitoryWhereInput =
      actor.role === Role.SUPER_ADMIN
        ? (q.universityId ? { universityId: q.universityId } : {})
        : { universityId: requireUniversity(actor) };
    if (DORMITORY_BOUND.includes(actor.role)) where.id = requireDormitory(actor);

    const [items, total] = await Promise.all([
      this.prisma.dormitory.findMany({
        where, orderBy: { name: 'asc' }, skip: (q.page - 1) * q.limit, take: q.limit,
        include: { _count: { select: { buildings: true } } },
      }),
      this.prisma.dormitory.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  get(actor: AuthUser, id: string) {
    return this.dormitoryScoped(actor, id);
  }

  async update(actor: AuthUser, id: string, dto: UpdateDormitoryDto) {
    const existing = await this.dormitoryScoped(actor, id);
    try {
      const d = await this.prisma.dormitory.update({ where: { id }, data: dto });
      await this.audit.log({ actor, action: 'dormitory.update', entity: 'Dormitory', entityId: id, universityId: existing.universityId, meta: { ...dto } });
      return d;
    } catch (e) {
      if (isUnique(e)) throw new ConflictException('A dormitory with this name already exists in your university');
      throw e;
    }
  }

  /** Nominal capacity vs. the bed capacity actually defined in buildings/rooms. */
  async summary(actor: AuthUser, id: string) {
    const d = await this.dormitoryScoped(actor, id);
    const [buildings, rooms, beds] = await Promise.all([
      this.prisma.building.count({ where: { dormitoryId: id } }),
      this.prisma.room.count({ where: { building: { dormitoryId: id } } }),
      this.prisma.room.aggregate({
        _sum: { capacity: true },
        where: { type: RoomType.RESIDENTIAL, building: { dormitoryId: id } },
      }),
    ]);
    const defined = beds._sum.capacity ?? 0;
    return {
      dormitoryId: id, name: d.name, nominalCapacity: d.nominalCapacity,
      buildings, rooms, definedBedCapacity: defined, difference: d.nominalCapacity - defined,
    };
  }

  // ================= buildings =================

  async createBuilding(actor: AuthUser, dormitoryId: string, dto: CreateBuildingDto) {
    const d = await this.dormitoryScoped(actor, dormitoryId);
    try {
      const b = await this.prisma.building.create({ data: { dormitoryId, name: dto.name } });
      await this.audit.log({ actor, action: 'building.create', entity: 'Building', entityId: b.id, universityId: d.universityId, meta: { dormitoryId, name: b.name } });
      return b;
    } catch (e) {
      if (isUnique(e)) throw new ConflictException('A building with this name already exists in this dormitory');
      throw e;
    }
  }

  async listBuildings(actor: AuthUser, dormitoryId: string) {
    await this.dormitoryScoped(actor, dormitoryId);
    return this.prisma.building.findMany({
      where: { dormitoryId }, orderBy: { name: 'asc' }, include: { _count: { select: { rooms: true } } },
    });
  }

  // ================= rooms & beds =================

  async createRoom(actor: AuthUser, buildingId: string, dto: CreateRoomDto) {
    const { dormitory } = await this.buildingScoped(actor, buildingId);
    const type = dto.type ?? RoomType.RESIDENTIAL;
    if (type !== RoomType.RESIDENTIAL && dto.capacity) {
      throw new BadRequestException('Only RESIDENTIAL rooms have beds/capacity');
    }
    const capacity = type === RoomType.RESIDENTIAL ? dto.capacity ?? 0 : 0;
    try {
      const room = await this.prisma.room.create({
        data: { buildingId, number: dto.number, floor: dto.floor, type, capacity, beds: { create: bedLabels(1, capacity) } },
        include: { beds: true },
      });
      await this.audit.log({ actor, action: 'room.create', entity: 'Room', entityId: room.id, universityId: dormitory.universityId, meta: { buildingId, number: room.number, type, capacity } });
      return room;
    } catch (e) {
      if (isUnique(e)) throw new ConflictException('Room number already exists in this building');
      throw e;
    }
  }

  /** Creates rooms from..to (inclusive), each RESIDENTIAL with `capacity` beds. */
  async createRoomsBulk(actor: AuthUser, buildingId: string, dto: BulkRoomsDto) {
    const { dormitory } = await this.buildingScoped(actor, buildingId);
    if (dto.to < dto.from) throw new BadRequestException('"to" must be >= "from"');
    if (dto.to - dto.from + 1 > 500) throw new BadRequestException('At most 500 rooms per request');

    const numbers = Array.from({ length: dto.to - dto.from + 1 }, (_, i) => `${dto.prefix ?? ''}${dto.from + i}`);
    const clash = await this.prisma.room.findMany({
      where: { buildingId, number: { in: numbers } }, select: { number: true },
    });
    if (clash.length) {
      throw new ConflictException(`Room numbers already exist: ${clash.map((r) => r.number).join(', ')}`);
    }

    const rooms = await this.prisma.$transaction(
      numbers.map((number) =>
        this.prisma.room.create({
          data: {
            buildingId, number, floor: dto.floor, type: RoomType.RESIDENTIAL,
            capacity: dto.capacity, beds: { create: bedLabels(1, dto.capacity) },
          },
        }),
      ),
    );
    await this.audit.log({
      actor, action: 'room.bulk_create', entity: 'Building', entityId: buildingId, universityId: dormitory.universityId,
      meta: { count: rooms.length, from: numbers[0], to: numbers[numbers.length - 1], capacity: dto.capacity },
    });
    return { created: rooms.length };
  }

  async listRooms(actor: AuthUser, buildingId: string) {
    await this.buildingScoped(actor, buildingId);
    return this.prisma.room.findMany({
      where: { buildingId }, orderBy: [{ floor: 'asc' }, { number: 'asc' }],
      include: { beds: { orderBy: { label: 'asc' } } },
    });
  }

  async updateRoom(actor: AuthUser, roomId: string, dto: UpdateRoomDto) {
    const { room, dormitory } = await this.roomScoped(actor, roomId);
    if (dto.capacity !== undefined && room.type !== RoomType.RESIDENTIAL) {
      throw new BadRequestException('Only RESIDENTIAL rooms have beds/capacity');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.capacity !== undefined) {
        const current = await tx.bed.count({ where: { roomId } });
        if (dto.capacity > current) {
          await tx.bed.createMany({ data: bedLabels(current + 1, dto.capacity).map((b) => ({ ...b, roomId })) });
        } else if (dto.capacity < current) {
          const remove = bedLabels(dto.capacity + 1, current).map((b) => b.label);
          const busy = await tx.assignment.count({ where: { endedAt: null, bed: { roomId, label: { in: remove } } } });
          if (busy) throw new ConflictException('Cannot remove beds that are currently occupied; move the students first');
          await tx.bed.deleteMany({ where: { roomId, label: { in: remove } } });
        }
      }
      return tx.room.update({
        where: { id: roomId }, data: { floor: dto.floor, capacity: dto.capacity }, include: { beds: { orderBy: { label: 'asc' } } },
      });
    });
    await this.audit.log({ actor, action: 'room.update', entity: 'Room', entityId: roomId, universityId: dormitory.universityId, meta: { ...dto } });
    return updated;
  }

  // ================= scoped lookups (tenant isolation) =================
  // Anything outside the caller's scope is reported as "not found" so ids of other tenants are never revealed.

  private async dormitoryScoped(actor: AuthUser, id: string): Promise<Dormitory> {
    const where: Prisma.DormitoryWhereInput = { id };
    if (actor.role !== Role.SUPER_ADMIN) where.universityId = requireUniversity(actor);
    if (DORMITORY_BOUND.includes(actor.role) && requireDormitory(actor) !== id) {
      throw new NotFoundException('Dormitory not found');
    }
    const d = await this.prisma.dormitory.findFirst({ where });
    if (!d) throw new NotFoundException('Dormitory not found');
    return d;
  }

  private async buildingScoped(actor: AuthUser, id: string) {
    const building = await this.prisma.building.findUnique({ where: { id } });
    if (!building) throw new NotFoundException('Building not found');
    const dormitory = await this.dormitoryScoped(actor, building.dormitoryId).catch(() => {
      throw new NotFoundException('Building not found');
    });
    return { building, dormitory };
  }

  private async roomScoped(actor: AuthUser, id: string) {
    const room = await this.prisma.room.findUnique({ where: { id } });
    if (!room) throw new NotFoundException('Room not found');
    const { dormitory } = await this.buildingScoped(actor, room.buildingId).catch(() => {
      throw new NotFoundException('Room not found');
    });
    return { room, dormitory };
  }
}
