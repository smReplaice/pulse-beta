import { Controller, Get, Param } from '@nestjs/common';
import { ScheduleService } from '../schedule/schedule.service';
import { calculateSchedule } from '@pulse/engine';

/** GET /api/projects/:id/resource-usage — utilisation and capacity */
@Controller()
export class UsageController {
  constructor(private readonly scheduleService: ScheduleService) {}

  @Get('projects/:id/resource-usage')
  async usage(@Param('id') id: string) {
    const input = await this.scheduleService.loadEngineInput(id);
    const result = calculateSchedule(input);
    const resourceById = new Map(input.resources.map((r) => [r.id, r]));
    return {
      scheduleVersion: (await this.scheduleService.getProject(id)).currentScheduleVersion,
      resources: result.resourceUsage.map((ru) => ({
        resourceId: ru.resourceId,
        name: resourceById.get(ru.resourceId)?.name ?? ru.resourceId,
        kind: resourceById.get(ru.resourceId)?.kind,
        maxUnits: resourceById.get(ru.resourceId)?.maxUnits ?? 1,
        peakUnits: ru.peakUnits,
        overallocatedDays: ru.overallocatedDays,
        totalWorkMinutes: ru.totalWorkMinutes,
        byDay: ru.byDay,
      })),
      assignments: result.assignments,
    };
  }
}
