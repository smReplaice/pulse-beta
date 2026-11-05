import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CalendarEntity,
  CalendarExceptionEntity,
  CalendarWorkingDayEntity,
  ProjectBaselineEntity,
  ResourceAssignmentEntity,
  ResourceEntity,
  TaskEntity,
} from '../../entities';
import { ResourcesController } from './resources.controller';
import { ResourcesService } from './resources.service';
import { ScheduleModule } from '../schedule/schedule.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ResourceEntity,
      ResourceAssignmentEntity,
      TaskEntity,
      CalendarEntity,
      CalendarWorkingDayEntity,
      CalendarExceptionEntity,
      ProjectBaselineEntity,
    ]),
    ScheduleModule,
  ],
  controllers: [ResourcesController],
  providers: [ResourcesService],
  exports: [ResourcesService],
})
export class ResourcesModule {}
