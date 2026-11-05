import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  BaselineTaskEntity,
  CalendarEntity,
  CalendarExceptionEntity,
  CalendarWorkingDayEntity,
  MsProjectImportJobEntity,
  ProjectBaselineEntity,
  ProjectEntity,
  ProjectSettingsEntity,
  ResourceAssignmentEntity,
  ResourceEntity,
  TaskDependencyEntity,
  TaskEntity,
} from '../../entities';
import { MsProjectController } from './msproject.controller';
import { MsProjectImporterService } from './importer.service';
import { ProjectsModule } from '../projects/projects.module';

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
      ProjectBaselineEntity,
      BaselineTaskEntity,
      MsProjectImportJobEntity,
    ]),
    ProjectsModule,
  ],
  controllers: [MsProjectController],
  providers: [MsProjectImporterService],
})
export class MsProjectModule {}
