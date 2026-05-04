import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { LedgerModule } from './ledger/ledger.module';
import { DomainEventsModule } from './events/domain-events.module';
import { BullQueuesModule } from './queue/bull-queues.module';
import { HealthController } from './health.controller';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { LedgerVerificationModule } from './ledger-verification/ledger-verification.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env'],
    }),
    PrismaModule,
    LedgerModule,
    LedgerVerificationModule,
    IdempotencyModule,
    DomainEventsModule,
    BullQueuesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
