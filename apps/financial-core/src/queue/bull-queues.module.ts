import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ALL_QUEUES } from './queue.constants';

/**
 * Registers Redis connection + named queues.
 * Requires FINANCIAL_CORE_REDIS_URL or REDIS_URL; if absent, module still loads but workers must not start.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        const url =
          cfg.get<string>('FINANCIAL_CORE_REDIS_URL') ??
          cfg.get<string>('REDIS_URL') ??
          '';
        if (!url) {
          return { connection: { host: '127.0.0.1', port: 6379, lazyConnect: true, maxRetriesPerRequest: null } };
        }
        try {
          const u = new URL(url);
          const dbPath = u.pathname?.replace('/', '') ?? '';
          return {
            connection: {
              host: u.hostname,
              port: Number(u.port || 6379),
              password: u.password || undefined,
              username: u.username || undefined,
              db: dbPath ? Number(dbPath) : undefined,
              tls: u.protocol === 'rediss:' ? {} : undefined,
              maxRetriesPerRequest: null,
            },
          };
        } catch {
          return { connection: { host: '127.0.0.1', port: 6379, maxRetriesPerRequest: null } };
        }
      },
    }),
    ...ALL_QUEUES.map((name) =>
      BullModule.registerQueue({
        name,
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      }),
    ),
  ],
  exports: [BullModule],
})
export class BullQueuesModule {}
