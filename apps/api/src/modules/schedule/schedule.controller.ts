import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ScheduleService } from './schedule.service';

export class RecalculateDto {
  trigger?: string;
}

/**
 * The authoritative programme: everything the frontend renders comes from here.
 */
@Controller()
export class ScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  /** GET /api/projects/:id/schedule — full calculated programme */
  @Get('projects/:id/schedule')
  async getSchedule(@Param('id') id: string) {
    return this.scheduleService.getSchedulePayload(id);
  }

  /** POST /api/projects/:id/recalculate */
  @Post('projects/:id/recalculate')
  async recalculate(@Param('id') id: string, @Body() dto: RecalculateDto) {
    const recalc = await this.scheduleService.recalculate(id, dto.trigger ?? 'recalculate');
    return {
      scheduleVersion: recalc.scheduleVersion,
      projectStart: recalc.result.projectStart,
      projectFinish: recalc.result.projectFinish,
      changedTasks: recalc.changedTasks,
      warnings: recalc.warnings,
      stats: recalc.result.stats,
    };
  }

  /** GET /api/projects/:id/critical-path — critical tasks and float */
  @Get('projects/:id/critical-path')
  async criticalPath(@Param('id') id: string) {
    const input = await this.scheduleService.loadEngineInput(id);
    const result = await this.scheduleService.recalculate(id, 'critical_path_view');
    const tasks = Object.values(result.result.tasks);
    const nameOf = (tid: string) => input.tasks.find((t) => t.id === tid)?.name ?? tid;
    return {
      scheduleVersion: result.scheduleVersion,
      criticalPathIds: result.result.criticalPathIds,
      criticalPaths: result.result.criticalPaths,
      criticalTasks: tasks
        .filter((t) => t.isCritical)
        .map((t) => ({
          id: t.id,
          name: nameOf(t.id),
          wbs: t.wbs,
          start: t.start,
          finish: t.finish,
          totalFloatMinutes: t.totalFloatMinutes,
          isSummary: t.isSummary,
          isMilestone: t.isMilestone,
        })),
      nearCriticalTasks: tasks
        .filter((t) => !t.isCritical && t.totalFloatMinutes !== null && t.totalFloatMinutes <= 5 * 480)
        .map((t) => ({
          id: t.id,
          name: nameOf(t.id),
          wbs: t.wbs,
          totalFloatMinutes: t.totalFloatMinutes,
        })),
    };
  }
}
