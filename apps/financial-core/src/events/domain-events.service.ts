import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Read-side projections subscribe to fc_domain_events; writers append inside ledger TX when money moves. */
@Injectable()
export class DomainEventsService {
  constructor(private readonly prisma: PrismaService) {}

  async listByAggregate(aggregateType: string, aggregateId: string) {
    return this.prisma.domainEvent.findMany({
      where: { aggregateType, aggregateId },
      orderBy: { occurredAt: 'asc' },
    });
  }

  appendTx(
    tx: Prisma.TransactionClient,
    row: {
      eventType: string;
      aggregateType: string;
      aggregateId: string;
      payload: Prisma.InputJsonValue;
      idempotencyKey?: string | null;
      schemaVersion?: number;
      correlationId?: string | null;
      causationId?: string | null;
    },
  ) {
    return tx.domainEvent.create({ data: row });
  }
}
