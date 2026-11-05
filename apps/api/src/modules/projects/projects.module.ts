import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CalendarEntity,
  CalendarExceptionEntity,
  CalendarWorkingDayEntity,
  OrganizationEntity,
  PortfolioEntity,
  ProjectEntity,
  ProjectSettingsEntity,
} from '../../entities';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ScheduleModule } from '../schedule/schedule.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrganizationEntity,
      PortfolioEntity,
      ProjectEntity,
      ProjectSettingsEntity,
      CalendarEntity,
      CalendarWorkingDayEntity,
      CalendarExceptionEntity,
    ]),
    ScheduleModule,
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
