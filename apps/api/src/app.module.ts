import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as entities from './entities';
import { AppDataSource } from './database/data-source';
import { ScheduleGateway } from './gateway/schedule.gateway';
import { ScheduleModule } from './modules/schedule/schedule.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { DependenciesModule } from './modules/dependencies/dependencies.module';
import { ResourcesModule } from './modules/resources/resources.module';
import { CalendarsModule } from './modules/calendars/calendars.module';
import { UsageModule } from './modules/usage/usage.module';
import { LevelingModule } from './modules/leveling/leveling.module';
import { BaselinesModule } from './modules/baselines/baselines.module';
import { ProgressModule } from './modules/progress/progress.module';
import { IoModule } from './modules/io/io.module';
import { AiModule } from './modules/ai/ai.module';
import { MsProjectModule } from './modules/msproject/msproject.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        ...AppDataSource.options,
        autoLoadEntities: true,
      }),
    }),
    ScheduleModule,
    ProjectsModule,
    TasksModule,
    DependenciesModule,
    ResourcesModule,
    CalendarsModule,
    UsageModule,
    LevelingModule,
    BaselinesModule,
    ProgressModule,
    IoModule,
    AiModule,
    MsProjectModule,
  ],
  controllers: [HealthController],
  providers: [ScheduleGateway],
  exports: [ScheduleGateway],
})
export class AppModule {
  constructor() {
    void entities;
  }
}
