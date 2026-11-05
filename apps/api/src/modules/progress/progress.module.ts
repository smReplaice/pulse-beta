import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  BaselineTaskEntity,
  ProgressUpdateEntity,
  ProjectBaselineEntity,
  TaskEntity,
} from '../../entities';
import { ProgressController } from './progress.controller';
import { ProgressService } from './progress.service';
import { ScheduleModule } from '../schedule/schedule.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProgressUpdateEntity, TaskEntity, ProjectBaselineEntity, BaselineTaskEntity]),
    ScheduleModule,
  ],
  controllers: [ProgressController],
  providers: [ProgressService],
})
export class ProgressModule {}
