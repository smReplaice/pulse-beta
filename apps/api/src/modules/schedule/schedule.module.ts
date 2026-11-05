import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CalendarEntity,
  CalendarExceptionEntity,
  CalendarWorkingDayEntity,
  ProjectEntity,
  ProjectSettingsEntity,
  ResourceAssignmentEntity,
  ResourceEntity,
  ResourceTimephasedWorkEntity,
  ScheduleAuditEntity,
  ScheduleCalculationRunEntity,
  ScheduleVersionEntity,
  TaskDependencyEntity,
  TaskEntity,
} from '../../entities';
import { ScheduleGateway } from '../../gateway/schedule.gateway';
import { ScheduleService } from './schedule.service';
import { ScheduleController } from './schedule.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProjectEntity,
      ProjectSettingsEntity,
      TaskEntity,
      TaskDependencyEntity,
      CalendarEntity,
      CalendarWorkingDayEntity,
      CalendarExceptionEntity,
      ResourceEntity,
      ResourceAssignmentEntity,
      ResourceTimephasedWorkEntity,
      ScheduleVersionEntity,
      ScheduleCalculationRunEntity,
      ScheduleAuditEntity,
    ]),
  ],
  controllers: [ScheduleController],
  providers: [ScheduleService, ScheduleGateway],
  exports: [ScheduleService],
})
export class ScheduleModule {}
