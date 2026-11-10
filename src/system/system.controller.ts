import { Controller, Get } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { SmsWorker } from '../messaging/sms-worker.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller()
export class SystemController {
  constructor(private prisma: PrismaService, private worker: SmsWorker) {}

  /** Liveness/readiness probe for the load balancer. No data is exposed. */
  @Public()
  @Get('health')
  async health() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch {
      return { status: 'degraded' };
    }
  }

  /** مشاهده وضعیت سرویس‌ها (super admin). */
  @Get('system/status') @Roles(Role.SUPER_ADMIN)
  async status() {
    const t0 = Date.now();
    let db = { ok: true, latencyMs: 0 };
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db.latencyMs = Date.now() - t0;
    } catch {
      db = { ok: false, latencyMs: -1 };
    }
    const mem = process.memoryUsage();
    return {
      db, uptimeSeconds: Math.round(process.uptime()), node: process.version,
      memoryMb: { rss: Math.round(mem.rss / 1048576), heapUsed: Math.round(mem.heapUsed / 1048576) },
      sms: await this.worker.stats(),
    };
  }
}
