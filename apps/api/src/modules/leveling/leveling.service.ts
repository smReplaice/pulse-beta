import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { previewLeveling } from '@pulse/engine';
import { TaskEntity } from '../../entities';
import { ScheduleService } from '../schedule/schedule.service';

export class LevelingOptionsDto {
  levelOnlyWithinSlack?: boolean;
  stepMinutes?: number;
}

@Injectable()
export class LevelingService {
  constructor(
    @InjectRepository(TaskEntity) private readonly tasks: Repository<TaskEntity>,
    private readonly scheduleService: ScheduleService,
  ) {}

  /** POST /api/projects/:id/leveling/preview — preview resource leveling */
  async preview(projectId: string, dto: LevelingOptionsDto) {
    const input = await this.scheduleService.loadEngineInput(projectId);
    return previewLeveling(input, {
      levelOnlyWithinSlack: dto.levelOnlyWithinSlack,
      stepMinutes: dto.stepMinutes,
    });
  }

  /** POST /api/projects/:id/leveling/apply — apply the proposed delays */
  async apply(projectId: string, dto: LevelingOptionsDto & { delays?: { taskId: string; delayMinutes: number }[] }) {
    const input = await this.scheduleService.loadEngineInput(projectId);
    let delays: { taskId: string; delayMinutes: number }[];
    if (dto.delays && dto.delays.length > 0) {
      delays = dto.delays;
    } else {
      const preview = previewLeveling(input, {
        levelOnlyWithinSlack: dto.levelOnlyWithinSlack,
        stepMinutes: dto.stepMinutes,
      });
      delays = preview.delays;
    }
    for (const d of delays) {
      await this.tasks.update({ id: d.taskId }, { levelingDelayMinutes: d.delayMinutes });
    }
    const recalc = await this.scheduleService.recalculate(projectId, 'leveling');
    return {
      appliedDelays: delays,
      changedTasks: recalc.changedTasks,
      projectFinish: recalc.result.projectFinish,
      scheduleVersion: recalc.scheduleVersion,
    };
  }

  /** POST /api/projects/:id/leveling/clear — revert leveling */
  async clear(projectId: string) {
    await this.scheduleService.getProject(projectId);
    await this.tasks.update({ projectId }, { levelingDelayMinutes: 0 });
    const recalc = await this.scheduleService.recalculate(projectId, 'leveling_clear');
    return {
      ok: true,
      changedTasks: recalc.changedTasks,
      scheduleVersion: recalc.scheduleVersion,
    };
  }
}
