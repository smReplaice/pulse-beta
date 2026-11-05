import { Module } from '@nestjs/common';
import { UsageController } from './usage.controller';
import { ScheduleModule } from '../schedule/schedule.module';

@Module({
  imports: [ScheduleModule],
  controllers: [UsageController],
})
export class UsageModule {}
