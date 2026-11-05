import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BaselineTaskEntity, ProjectBaselineEntity, TaskEntity } from '../../entities';
import { BaselinesController } from './baselines.controller';
import { BaselinesService } from './baselines.service';
import { ScheduleModule } from '../schedule/schedule.module';

@Module({
  imports: [TypeOrmModule.forFeature([ProjectBaselineEntity, BaselineTaskEntity, TaskEntity]), ScheduleModule],
  controllers: [BaselinesController],
  providers: [BaselinesService],
  exports: [BaselinesService],
})
export class BaselinesModule {}
