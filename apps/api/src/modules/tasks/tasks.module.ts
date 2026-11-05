import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  ResourceAssignmentEntity,
  ResourceEntity,
  ScheduleAuditEntity,
  TaskDependencyEntity,
  TaskEntity,
} from '../../entities';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { ScheduleModule } from '../schedule/schedule.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TaskEntity,
      TaskDependencyEntity,
      ResourceAssignmentEntity,
      ResourceEntity,
      ScheduleAuditEntity,
    ]),
    ScheduleModule,
  ],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
