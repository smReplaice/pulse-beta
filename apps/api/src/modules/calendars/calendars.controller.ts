import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import {
  CalendarsService,
  CreateCalendarDto,
  UpdateCalendarDto,
  UpsertExceptionDto,
} from './calendars.service';

@Controller()
export class CalendarsController {
  constructor(private readonly calendarsService: CalendarsService) {}

  @Get('projects/:id/calendars')
  async list(@Param('id') id: string) {
    return this.calendarsService.list(id);
  }

  @Post('projects/:id/calendars')
  async create(@Param('id') id: string, @Body() dto: CreateCalendarDto) {
    return this.calendarsService.create(id, dto);
  }

  @Patch('calendars/:id')
  async update(@Param('id') id: string, @Body() dto: UpdateCalendarDto) {
    return this.calendarsService.update(id, dto);
  }

  @Post('calendars/:id/exceptions')
  async upsertException(@Param('id') id: string, @Body() dto: UpsertExceptionDto) {
    return this.calendarsService.upsertException(id, dto);
  }

  @Delete('calendar-exceptions/:id')
  async deleteException(@Param('id') id: string) {
    return this.calendarsService.deleteException(id);
  }
}
