import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CalendarEntity,
  CalendarExceptionEntity,
  CalendarWorkingDayEntity,
} from '../../entities';
import { CalendarsController } from './calendars.controller';
import { CalendarsService } from './calendars.service';
import { ScheduleModule } from '../schedule/schedule.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CalendarEntity, CalendarWorkingDayEntity, CalendarExceptionEntity]),
    ScheduleModule,
  ],
  controllers: [CalendarsController],
  providers: [CalendarsService],
})
export class CalendarsModule {}
