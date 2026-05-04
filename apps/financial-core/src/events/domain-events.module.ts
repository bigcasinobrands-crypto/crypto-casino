import { Module } from '@nestjs/common';
import { DomainEventsService } from './domain-events.service';

@Module({
  providers: [DomainEventsService],
  exports: [DomainEventsService],
})
export class DomainEventsModule {}
