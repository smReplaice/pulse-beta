import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CalendarEntity,
  CalendarExceptionEntity,
  CalendarWorkingDayEntity,
  ResourceAssignmentEntity,
  ResourceEntity,
  TaskDependencyEntity,
  TaskEntity,
} from '../../entities';
import { IoController } from './io.controller';
import { IoService } from './io.service';
import { ScheduleModule } from '../schedule/schedule.module';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TaskEntity,
      TaskDependencyEntity,
      ResourceEntity,
      ResourceAssignmentEntity,
      CalendarEntity,
      CalendarWorkingDayEntity,
      CalendarExceptionEntity,
    ]),
    ScheduleModule,
    ProjectsModule,
  ],
  controllers: [IoController],
  providers: [IoService],
})
export class IoModule {}
