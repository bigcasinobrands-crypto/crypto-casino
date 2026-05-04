import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Provider callback deduplication. **First** write wins; replays return stored response.
 * Financial truth still comes from **ledger** — this only prevents double-processing.
 */
@Injectable()
export class IdempotencyService {
  private readonly log = new Logger(IdempotencyService.name);

  constructor(private readonly prisma: PrismaService) {}

  private compositeKey(provider: string, idempotencyKey: string) {
    return `${provider.trim().toLowerCase()}:${idempotencyKey}`;
  }

  async get(
    provider: string,
    idempotencyKey: string,
  ): Promise<{
    responseBody: Prisma.JsonValue | null;
    httpStatus: number | null;
  } | null> {
    const row = await this.prisma.processedCallback.findUnique({
      where: {
        idempotencyKey: this.compositeKey(provider, idempotencyKey),
      },
    });
    if (!row) return null;
    return { responseBody: row.responseBody, httpStatus: row.httpStatus };
  }

  /**
   * Persist successful processing. Response optional (e.g. async accept).
   */
  async record(
    provider: string,
    idempotencyKey: string,
    data: {
      requestHash?: string;
      responseBody?: Prisma.InputJsonValue;
      httpStatus?: number;
      expiresAt?: Date;
    },
  ): Promise<void> {
    const key = this.compositeKey(provider, idempotencyKey);
    await this.prisma.processedCallback.upsert({
      where: { idempotencyKey: key },
      create: {
        provider,
        idempotencyKey: key,
        requestHash: data.requestHash,
        responseBody: data.responseBody,
        httpStatus: data.httpStatus,
        expiresAt: data.expiresAt,
      },
      update: {
        requestHash: data.requestHash,
        responseBody: data.responseBody ?? undefined,
        httpStatus: data.httpStatus ?? undefined,
        expiresAt: data.expiresAt,
      },
    });
  }
}
