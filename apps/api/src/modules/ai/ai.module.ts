import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiActionLogEntity, TaskDependencyEntity, TaskEntity } from '../../entities';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { ScheduleModule } from '../schedule/schedule.module';
import { TasksModule } from '../tasks/tasks.module';
import { DependenciesModule } from '../dependencies/dependencies.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AiActionLogEntity, TaskEntity, TaskDependencyEntity]),
    ScheduleModule,
    TasksModule,
    DependenciesModule,
  ],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
