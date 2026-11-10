import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BatchStatus, Prisma, SmsStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ISmsProvider, SMS_PROVIDER } from './sms/sms-provider';

const TICK_MS = 5_000;
const MAX_ATTEMPTS = 3;
const CONCURRENCY = 10;

/**
 * Database-backed queue (no Redis needed). Every tick: promote scheduled batches, release stale locks,
 * send due messages, refresh delivery status, close finished batches. Claiming uses FOR UPDATE SKIP LOCKED,
 * so several application instances can run the worker safely.
 */
@Injectable()
export class SmsWorker implements OnModuleInit, OnModuleDestroy {
  private logger = new Logger('SmsWorker');
  private timer?: NodeJS.Timeout;
  private busy = false;
  lastTickAt: Date | null = null;

  constructor(private prisma: PrismaService, private config: ConfigService, @Inject(SMS_PROVIDER) private provider: ISmsProvider) {}

  onModuleInit() {
    if (this.config.get('SMS_WORKER') === 'off') return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.promoteScheduled();
      await this.releaseStale();
      await this.sendDue();
      await this.refreshStatuses();
      await this.completeBatches();
      this.lastTickAt = new Date();
    } catch (e) {
      this.logger.error(`tick failed: ${(e as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  private promoteScheduled() {
    return this.prisma.messageBatch.updateMany({
      where: { status: BatchStatus.SCHEDULED, scheduledAt: { lte: new Date() } },
      data: { status: BatchStatus.QUEUED },
    });
  }

  private releaseStale() {
    return this.prisma.messageRecipient.updateMany({
      where: { smsStatus: SmsStatus.SENDING, lockedAt: { lt: new Date(Date.now() - 5 * 60_000) } },
      data: { smsStatus: SmsStatus.PENDING, lockedAt: null },
    });
  }

  private async sendDue() {
    const claimed = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      UPDATE "MessageRecipient"
         SET "smsStatus" = 'SENDING', "lockedAt" = now(), "attempts" = "attempts" + 1
       WHERE "id" IN (
         SELECT r."id" FROM "MessageRecipient" r
           JOIN "MessageBatch" b ON b."id" = r."batchId"
          WHERE r."smsStatus" = 'PENDING' AND r."nextAttemptAt" <= now() AND b."status" = 'QUEUED'
          ORDER BY r."nextAttemptAt"
          LIMIT 50
            FOR UPDATE OF r SKIP LOCKED)
      RETURNING "id"`);
    if (!claimed.length) return;
    const rows = await this.prisma.messageRecipient.findMany({ where: { id: { in: claimed.map((c) => c.id) } } });
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      await Promise.all(rows.slice(i, i + CONCURRENCY).map((r) => this.sendOne(r)));
    }
  }

  private async sendOne(r: { id: string; phone: string | null; renderedBody: string; attempts: number }) {
    try {
      if (!r.phone) throw new Error('NO_VALID_PHONE');
      const { messageId } = await this.provider.send(r.phone, r.renderedBody);
      await this.prisma.messageRecipient.update({
        where: { id: r.id },
        data: { smsStatus: SmsStatus.SENT, providerMessageId: messageId, sentAt: new Date(), lockedAt: null, error: null },
      });
    } catch (e) {
      const giveUp = r.attempts >= MAX_ATTEMPTS;
      await this.prisma.messageRecipient.update({
        where: { id: r.id },
        data: {
          smsStatus: giveUp ? SmsStatus.FAILED : SmsStatus.PENDING,
          error: String((e as Error).message).slice(0, 200),
          lockedAt: null,
          nextAttemptAt: new Date(Date.now() + 30_000 * 2 ** r.attempts), // 1 min, 2 min, ...
        },
      });
    }
  }

  /** Delivery reports by polling (a webhook can be added when the provider is chosen). */
  private async refreshStatuses() {
    const rows = await this.prisma.messageRecipient.findMany({
      where: {
        smsStatus: SmsStatus.SENT, providerMessageId: { not: null }, statusChecks: { lt: 20 },
        sentAt: { lte: new Date(Date.now() - 20_000) },
        OR: [{ statusCheckedAt: null }, { statusCheckedAt: { lte: new Date(Date.now() - 60_000) } }],
      },
      take: 100, select: { id: true, providerMessageId: true },
    });
    if (!rows.length) return;
    let states: Record<string, string>;
    try {
      states = await this.provider.getStatus(rows.map((r) => r.providerMessageId!));
    } catch (e) {
      this.logger.warn(`status refresh failed: ${(e as Error).message}`);
      return;
    }
    await Promise.all(
      rows.map((r) => {
        const s = states[r.providerMessageId!];
        return this.prisma.messageRecipient.update({
          where: { id: r.id },
          data: {
            statusCheckedAt: new Date(), statusChecks: { increment: 1 },
            ...(s === 'DELIVERED' ? { smsStatus: SmsStatus.DELIVERED } : s === 'FAILED' ? { smsStatus: SmsStatus.FAILED, error: 'UNDELIVERED' } : {}),
          },
        });
      }),
    );
  }

  private async completeBatches() {
    const done = await this.prisma.messageBatch.findMany({
      where: { status: BatchStatus.QUEUED, recipients: { none: { smsStatus: { in: [SmsStatus.PENDING, SmsStatus.SENDING] } } } },
      select: { id: true }, take: 100,
    });
    if (done.length) {
      await this.prisma.messageBatch.updateMany({ where: { id: { in: done.map((d) => d.id) }, status: BatchStatus.QUEUED }, data: { status: BatchStatus.COMPLETED } });
    }
  }

  async stats() {
    const [pending, failed24h, sent24h] = await Promise.all([
      this.prisma.messageRecipient.count({ where: { smsStatus: { in: [SmsStatus.PENDING, SmsStatus.SENDING] } } }),
      this.prisma.messageRecipient.count({ where: { smsStatus: SmsStatus.FAILED, createdAt: { gte: new Date(Date.now() - 86_400_000) } } }),
      this.prisma.messageRecipient.count({ where: { smsStatus: { in: [SmsStatus.SENT, SmsStatus.DELIVERED] }, sentAt: { gte: new Date(Date.now() - 86_400_000) } } }),
    ]);
    return { provider: this.provider.name, pending, failedLast24h: failed24h, sentLast24h: sent24h, workerLastTickAt: this.lastTickAt };
  }
}
