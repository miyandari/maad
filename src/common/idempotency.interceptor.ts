import { BadRequestException, CallHandler, ConflictException, ExecutionContext, Injectable, NestInterceptor, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Observable, from, of } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { PrismaService } from '../prisma/prisma.service';

const METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Makes retries safe. The offline queue sends the same Idempotency-Key every time it retries a change,
 * so a request that already succeeded is answered from the stored response instead of running twice.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor, OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.prisma.idempotencyKey.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 14 * 86_400_000) } } }).catch(() => undefined);
    }, 3_600_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || !req.user || !METHODS.includes(req.method)) return next.handle();
    if (key.length < 8 || key.length > 100) throw new BadRequestException('Idempotency-Key must be 8-100 characters');
    const where = { userId_key: { userId: req.user.id as string, key } };

    return from(this.begin(req.user.id, key, req.method, req.originalUrl)).pipe(
      mergeMap((previous) => {
        if (previous) return of(previous.response);
        return next.handle().pipe(
          mergeMap(async (body) => {
            await this.prisma.idempotencyKey.update({ where, data: { completedAt: new Date(), response: (body ?? Prisma.JsonNull) as Prisma.InputJsonValue } });
            return body;
          }),
          catchError(async (err) => {
            await this.prisma.idempotencyKey.delete({ where }).catch(() => undefined); // a failed attempt may be retried
            throw err;
          }),
        );
      }),
    );
  }

  private async begin(userId: string, key: string, method: string, path: string): Promise<{ response: unknown } | null> {
    try {
      await this.prisma.idempotencyKey.create({ data: { userId, key, method, path } });
      return null;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      const existing = await this.prisma.idempotencyKey.findUnique({ where: { userId_key: { userId, key } } });
      if (!existing?.completedAt) throw new ConflictException('A request with this Idempotency-Key is still being processed');
      return { response: existing.response === null ? undefined : existing.response };
    }
  }
}
