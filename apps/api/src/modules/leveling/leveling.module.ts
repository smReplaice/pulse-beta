import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskEntity } from '../../entities';
import { LevelingController } from './leveling.controller';
import { LevelingService } from './leveling.service';
import { ScheduleModule } from '../schedule/schedule.module';

@Module({
  imports: [TypeOrmModule.forFeature([TaskEntity]), ScheduleModule],
  controllers: [LevelingController],
  providers: [LevelingService],
})
export class LevelingModule {}
