import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { BaselinesService, SaveBaselineDto } from './baselines.service';

@Controller()
export class BaselinesController {
  constructor(private readonly baselinesService: BaselinesService) {}

  @Post('projects/:id/baselines')
  async save(@Param('id') id: string, @Body() dto: SaveBaselineDto) {
    return this.baselinesService.save(id, dto);
  }

  @Get('projects/:id/baselines')
  async list(@Param('id') id: string) {
    return this.baselinesService.list(id);
  }

  @Get('baselines/:id')
  async snapshot(@Param('id') id: string) {
    return this.baselinesService.getSnapshot(id);
  }

  @Get('baselines/:id/compare')
  async compare(@Param('id') id: string) {
    return this.baselinesService.compare(id);
  }

  @Post('baselines/:id/restore')
  async restore(@Param('id') id: string) {
    return this.baselinesService.restore(id);
  }

  @Delete('baselines/:id')
  async remove(@Param('id') id: string) {
    await this.baselinesService.delete(id);
    return { ok: true };
  }
}
