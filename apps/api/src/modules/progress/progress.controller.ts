import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ProgressService, RecordProgressDto } from './progress.service';

@Controller()
export class ProgressController {
  constructor(private readonly progressService: ProgressService) {}

  /** POST /api/tasks/:id/progress — record actual progress */
  @Post('tasks/:id/progress')
  async record(@Param('id') id: string, @Body() dto: RecordProgressDto) {
    return this.progressService.record(id, dto);
  }

  @Get('projects/:id/progress')
  async tracking(@Param('id') id: string) {
    return this.progressService.tracking(id);
  }

  @Get('projects/:id/earned-value')
  async earnedValue(@Param('id') id: string) {
    return this.progressService.earnedValue(id);
  }

  @Get('projects/:id/progress-updates')
  async updates(@Param('id') id: string) {
    return this.progressService.updatesFor(id);
  }
}
