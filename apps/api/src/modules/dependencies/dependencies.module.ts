import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleAuditEntity, TaskDependencyEntity, TaskEntity } from '../../entities';
import { DependenciesController } from './dependencies.controller';
import { DependenciesService } from './dependencies.service';
import { ScheduleModule } from '../schedule/schedule.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TaskDependencyEntity, TaskEntity, ScheduleAuditEntity]),
    ScheduleModule,
  ],
  controllers: [DependenciesController],
  providers: [DependenciesService],
  exports: [DependenciesService],
})
export class DependenciesModule {}
