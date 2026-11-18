import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role, RoomType } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth-user';
import { jalaliYear } from '../common/dates';
import { requireDormitory, requireUniversity } from '../common/scope';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCriterionDto, ListSelectionsDto, SaveScoresDto, SelectRoomDto, UpdateCriterionDto } from './dto/model-room.dto';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Weighted mean (1..5) of scores; null when a criterion has no score yet. */
function weighted(criteria: { id: string; weight: number }[], scores: Map<string, number>): number | null {
  let sum = 0, w = 0;
  for (const c of criteria) {
    const s = scores.get(c.id);
    if (s === undefined) return null;
    sum += s * c.weight;
    w += c.weight;
  }
  return w ? round2(sum / w) : null;
}

/**
 * Model room (اتاق نمونه): the system manager defines the criteria; once a year the dormitory supervisor
 * scores rooms 1..5 on every criterion and announces ONE room. The system manager sees the announcement.
 * The result is a human decision: the list is only sorted by score, the supervisor may pick any fully scored room.
 */
@Injectable()
export class ModelRoomsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  // ---------------- criteria ----------------

  listCriteria(actor: AuthUser) {
    return this.prisma.modelRoomCriterion.findMany({ where: { universityId: requireUniversity(actor) }, orderBy: { order: 'asc' } });
  }

  async createCriterion(actor: AuthUser, dto: CreateCriterionDto) {
    const universityId = requireUniversity(actor);
    const max = await this.prisma.modelRoomCriterion.aggregate({ _max: { order: true }, where: { universityId } });
    const item = await this.prisma.modelRoomCriterion.create({
      data: { universityId, title: dto.title.trim(), weight: dto.weight ?? 1, order: (max._max.order ?? 0) + 1 },
    });
    await this.audit.log({ actor, action: 'model_room.criterion_create', entity: 'ModelRoomCriterion', entityId: item.id, universityId });
    return item;
  }

  async updateCriterion(actor: AuthUser, id: string, dto: UpdateCriterionDto) {
    const res = await this.prisma.modelRoomCriterion.updateMany({
      where: { id, universityId: requireUniversity(actor) },
      data: {
        ...(dto.title ? { title: dto.title.trim() } : {}),
        ...(dto.weight ? { weight: dto.weight } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.order ? { order: dto.order } : {}),
      },
    });
    if (res.count === 0) throw new NotFoundException('Criterion not found');
    return this.prisma.modelRoomCriterion.findUnique({ where: { id } });
  }

  async deleteCriterion(actor: AuthUser, id: string) {
    const universityId = requireUniversity(actor);
    // scores of the running year would silently lose a column; announced rooms keep their own snapshot
    const res = await this.prisma.modelRoomCriterion.deleteMany({ where: { id, universityId } });
    if (res.count === 0) throw new NotFoundException('Criterion not found');
    await this.prisma.roomScore.deleteMany({ where: { criterionId: id, universityId } });
    return { ok: true };
  }

  // ---------------- supervisor: board ----------------

  private async roomsOf(dormitoryId: string) {
    const rooms = await this.prisma.room.findMany({
      where: { type: RoomType.RESIDENTIAL, building: { dormitoryId } },
      select: { id: true, number: true, floor: true, capacity: true, building: { select: { name: true } } },
    });
    return rooms.sort((a, b) => a.building.name.localeCompare(b.building.name, 'fa') || a.number.localeCompare(b.number, undefined, { numeric: true }));
  }

  async board(actor: AuthUser, yearIn?: number) {
    const universityId = requireUniversity(actor);
    const dormitoryId = requireDormitory(actor);
    const year = yearIn ?? jalaliYear();
    const [criteria, rooms, rows, selection] = await Promise.all([
      this.prisma.modelRoomCriterion.findMany({ where: { universityId, isActive: true }, orderBy: { order: 'asc' } }),
      this.roomsOf(dormitoryId),
      this.prisma.roomScore.findMany({ where: { dormitoryId, year } }),
      this.prisma.modelRoomSelection.findUnique({ where: { dormitoryId_year: { dormitoryId, year } } }),
    ]);
    const byRoom = new Map<string, Map<string, number>>();
    for (const r of rows) {
      if (!byRoom.has(r.roomId)) byRoom.set(r.roomId, new Map());
      byRoom.get(r.roomId)!.set(r.criterionId, r.score);
    }
    const items = rooms.map((r) => {
      const m = byRoom.get(r.id) ?? new Map<string, number>();
      const scoredCount = criteria.filter((c) => m.has(c.id)).length;
      return {
        roomId: r.id,
        building: r.building.name,
        number: r.number,
        floor: r.floor,
        scores: Object.fromEntries([...m]),
        scoredCount,
        complete: criteria.length > 0 && scoredCount === criteria.length,
        total: weighted(criteria, m),
      };
    });
    // rank only fully scored rooms (1 = highest); ties share the rank
    const ranked = items.filter((i) => i.total !== null).sort((a, b) => b.total! - a.total!);
    const rankOf = new Map<string, number>();
    ranked.forEach((i, idx) => rankOf.set(i.roomId, idx > 0 && ranked[idx - 1].total === i.total ? rankOf.get(ranked[idx - 1].roomId)! : idx + 1));
    return {
      year,
      criteria: criteria.map((c) => ({ id: c.id, title: c.title, weight: c.weight })),
      rooms: items.map((i) => ({ ...i, rank: rankOf.get(i.roomId) ?? null })),
      selection,
    };
  }

  // ---------------- supervisor: scoring ----------------

  async saveScores(actor: AuthUser, dto: SaveScoresDto) {
    const universityId = requireUniversity(actor);
    const dormitoryId = requireDormitory(actor);
    const year = jalaliYear();

    if (await this.prisma.modelRoomSelection.findUnique({ where: { dormitoryId_year: { dormitoryId, year } } })) {
      throw new ConflictException('The model room of this year is already announced; scores are locked');
    }
    const room = await this.prisma.room.findFirst({ where: { id: dto.roomId, type: RoomType.RESIDENTIAL, building: { dormitoryId } }, select: { id: true } });
    if (!room) throw new NotFoundException('Room not found');

    const ids = dto.scores.map((s) => s.criterionId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('A criterion is scored more than once');
    const valid = await this.prisma.modelRoomCriterion.findMany({ where: { id: { in: ids }, universityId, isActive: true }, select: { id: true } });
    if (valid.length !== ids.length) throw new BadRequestException('Unknown or inactive criterion');

    await this.prisma.$transaction(
      dto.scores.map((s) =>
        this.prisma.roomScore.upsert({
          where: { roomId_year_criterionId: { roomId: dto.roomId, year, criterionId: s.criterionId } },
          create: { universityId, dormitoryId, roomId: dto.roomId, year, criterionId: s.criterionId, score: s.score, scoredById: actor.id },
          update: { score: s.score, scoredById: actor.id },
        }),
      ),
    );
    return { ok: true, year };
  }

  // ---------------- supervisor: announce the model room ----------------

  async select(actor: AuthUser, dto: SelectRoomDto) {
    const universityId = requireUniversity(actor);
    const dormitoryId = requireDormitory(actor);
    const year = jalaliYear();

    const room = await this.prisma.room.findFirst({
      where: { id: dto.roomId, type: RoomType.RESIDENTIAL, building: { dormitoryId } },
      select: { id: true, number: true, building: { select: { name: true } } },
    });
    if (!room) throw new NotFoundException('Room not found');

    const criteria = await this.prisma.modelRoomCriterion.findMany({ where: { universityId, isActive: true }, orderBy: { order: 'asc' } });
    if (!criteria.length) throw new BadRequestException('The system manager has not defined any criteria yet');
    const rows = await this.prisma.roomScore.findMany({ where: { roomId: dto.roomId, year } });
    const scores = new Map(rows.map((r) => [r.criterionId, r.score]));
    const total = weighted(criteria, scores);
    if (total === null) throw new BadRequestException('Score this room on every criterion first');

    try {
      const sel = await this.prisma.modelRoomSelection.create({
        data: {
          universityId, dormitoryId, roomId: dto.roomId, year, totalScore: total,
          breakdown: criteria.map((c) => ({ title: c.title, weight: c.weight, score: scores.get(c.id)! })) as Prisma.InputJsonValue,
          note: dto.note?.trim() || null,
          selectedById: actor.id,
        },
      });
      await this.audit.log({
        actor, action: 'model_room.select', entity: 'ModelRoomSelection', entityId: sel.id, universityId,
        meta: { year, dormitoryId, roomId: dto.roomId, total },
      });
      return sel;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('The model room of this year is already announced');
      }
      throw e;
    }
  }

  // ---------------- managers: announced rooms ----------------

  async selections(actor: AuthUser, q: ListSelectionsDto) {
    const year = q.year ?? jalaliYear();
    const where: Prisma.ModelRoomSelectionWhereInput = { year };
    const dormWhere: Prisma.DormitoryWhereInput = { isActive: true };
    switch (actor.role) {
      case Role.SUPER_ADMIN:
        if (q.universityId) { where.universityId = q.universityId; dormWhere.universityId = q.universityId; }
        break;
      case Role.SENIOR_ADMIN:
      case Role.SYSTEM_MANAGER:
        where.universityId = requireUniversity(actor); dormWhere.universityId = requireUniversity(actor);
        break;
      case Role.DORM_SUPERVISOR:
        where.dormitoryId = requireDormitory(actor); dormWhere.id = requireDormitory(actor);
        break;
      default: throw new ForbiddenException();
    }
    if (q.dormitoryId && actor.role !== Role.DORM_SUPERVISOR) { where.dormitoryId = q.dormitoryId; dormWhere.id = q.dormitoryId; }

    const [sels, dorms] = await Promise.all([
      this.prisma.modelRoomSelection.findMany({ where, orderBy: [{ totalScore: 'desc' }, { createdAt: 'asc' }] }),
      this.prisma.dormitory.findMany({ where: dormWhere, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    const roomIds = sels.map((s) => s.roomId);
    const [rooms, users] = await Promise.all([
      this.prisma.room.findMany({ where: { id: { in: roomIds } }, select: { id: true, number: true, building: { select: { name: true } } } }),
      this.prisma.user.findMany({ where: { id: { in: sels.map((s) => s.selectedById) } }, select: { id: true, firstName: true, lastName: true } }),
    ]);
    const roomMap = new Map(rooms.map((r) => [r.id, r]));
    const userMap = new Map(users.map((u) => [u.id, u]));
    const dormMap = new Map(dorms.map((d) => [d.id, d.name]));
    const announced = new Set(sels.map((s) => s.dormitoryId));
    return {
      year,
      items: sels.map((s) => ({
        id: s.id,
        dormitoryId: s.dormitoryId,
        dormitoryName: dormMap.get(s.dormitoryId) ?? null,
        building: roomMap.get(s.roomId)?.building.name ?? null,
        roomNumber: roomMap.get(s.roomId)?.number ?? null,
        totalScore: s.totalScore,
        breakdown: s.breakdown,
        note: s.note,
        selectedBy: userMap.get(s.selectedById) ?? null,
        createdAt: s.createdAt,
      })),
      pendingDormitories: dorms.filter((d) => !announced.has(d.id)),
    };
  }
}
