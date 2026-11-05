import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AiService } from './ai.service';

@Controller()
export class AiController {
  constructor(private readonly aiService: AiService) {}

  /** POST /api/projects/:id/ai/chat — natural-language AI operations */
  @Post('projects/:id/ai/chat')
  async chat(@Param('id') id: string, @Body() dto: { message: string; applyActionId?: string }) {
    return this.aiService.chat(id, dto);
  }

  @Post('projects/:id/ai/undo')
  async undo(@Param('id') id: string, @Body() dto: { actionId: string }) {
    return this.aiService.undo(id, dto.actionId);
  }

  @Get('projects/:id/ai/logs')
  async logs(@Param('id') id: string) {
    void this.aiService;
    return { note: 'AI action log listing arrives with the copilot UI milestone' };
  }
}
