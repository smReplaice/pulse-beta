import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IoService } from './io.service';

@Controller()
export class IoController {
  constructor(private readonly ioService: IoService) {}

  @Post('projects/import')
  async import(@Body() dto: Record<string, unknown>) {
    return this.ioService.import(dto as never);
  }

  @Get('projects/:id/export')
  async export(@Param('id') id: string, @Query('format') format?: 'json' | 'csv') {
    return this.ioService.export(id, format ?? 'json');
  }

  @Get('templates')
  async templates() {
    return this.ioService.templates();
  }

  @Post('projects/:id/templates/:key/instantiate')
  async instantiate(@Param('id') id: string, @Param('key') key: string) {
    return this.ioService.instantiateTemplate(id, key);
  }
}
