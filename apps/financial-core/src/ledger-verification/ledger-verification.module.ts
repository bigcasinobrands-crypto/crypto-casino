import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { LedgerVerificationService } from './ledger-verification.service';

@Module({
  imports: [LedgerModule],
  providers: [LedgerVerificationService],
  exports: [LedgerVerificationService],
})
export class LedgerVerificationModule {}
