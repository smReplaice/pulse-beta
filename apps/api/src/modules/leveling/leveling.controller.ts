import { Body, Controller, Post, Param } from '@nestjs/common';
import { LevelingOptionsDto, LevelingService } from './leveling.service';

@Controller('projects/:id/leveling')
export class LevelingController {
  constructor(private readonly levelingService: LevelingService) {}

  @Post('preview')
  async preview(@Param('id') id: string, @Body() dto: LevelingOptionsDto) {
    return this.levelingService.preview(id, dto);
  }

  @Post('apply')
  async apply(@Param('id') id: string, @Body() dto: LevelingOptionsDto & { delays?: { taskId: string; delayMinutes: number }[] }) {
    return this.levelingService.apply(id, dto);
  }

  @Post('clear')
  async clear(@Param('id') id: string) {
    return this.levelingService.clear(id);
  }
}
