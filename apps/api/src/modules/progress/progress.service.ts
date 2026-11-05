import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { calculateSchedule, computeEarnedValue } from '@pulse/engine';
import {
  BaselineTaskEntity,
  ProgressUpdateEntity,
  ProjectBaselineEntity,
  TaskEntity,
} from '../../entities';
import { ScheduleService } from '../schedule/schedule.service';

export class RecordProgressDto {
  percentComplete?: number;
  actualStart?: string | null;
  actualFinish?: string | null;
  actualWorkMinutes?: number;
  remainingDurationMinutes?: number;
  asOf?: string;
  notes?: string | null;
  expectedScheduleVersion?: number;
}

@Injectable()
export class ProgressService {
  constructor(
    @InjectRepository(ProgressUpdateEntity) private readonly updates: Repository<ProgressUpdateEntity>,
    @InjectRepository(TaskEntity) private readonly tasks: Repository<TaskEntity>,
    @InjectRepository(ProjectBaselineEntity) private readonly baselines: Repository<ProjectBaselineEntity>,
    @InjectRepository(BaselineTaskEntity) private readonly baselineTasks: Repository<BaselineTaskEntity>,
    private readonly scheduleService: ScheduleService,
  ) {}

  /** POST /api/tasks/:id/progress — record actual progress */
  async record(taskId: string, dto: RecordProgressDto): Promise<Record<string, unknown>> {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException(`Task ${taskId} not found`);
    await this.scheduleService.assertVersion(task.projectId, dto.expectedScheduleVersion);

    const asOf = dto.asOf ? new Date(dto.asOf) : new Date();

    if (dto.percentComplete !== undefined) {
      task.percentComplete = Math.min(100, Math.max(0, dto.percentComplete));
      if (task.percentComplete >= 100 && !task.actualFinish) {
        task.actualFinish = asOf;
      }
      if (task.percentComplete > 0 && !task.actualStart) {
        task.actualStart = asOf;
      }
    }
    if (dto.actualStart !== undefined) task.actualStart = dto.actualStart ? new Date(dto.actualStart) : null;
    if (dto.actualFinish !== undefined) task.actualFinish = dto.actualFinish ? new Date(dto.actualFinish) : null;
    if (dto.actualWorkMinutes !== undefined) task.actualWorkMinutes = Math.round(dto.actualWorkMinutes);
    await this.tasks.save(task);

    await this.updates.insert(
      this.updates.create({
        projectId: task.projectId,
        taskId,
        asOf,
        percentComplete: dto.percentComplete ?? null,
        actualStart: dto.actualStart ? new Date(dto.actualStart) : null,
        actualFinish: dto.actualFinish ? new Date(dto.actualFinish) : null,
        actualWorkMinutes: dto.actualWorkMinutes ?? null,
        remainingDurationMinutes: dto.remainingDurationMinutes ?? null,
        notes: dto.notes ?? null,
        createdBy: 'api',
      }),
    );

    const recalc = await this.scheduleService.recalculate(task.projectId, 'progress_update');
    return {
      task,
      calculated: recalc.result.tasks[taskId] ?? null,
      changedTasks: recalc.changedTasks,
      warnings: recalc.warnings,
      scheduleVersion: recalc.scheduleVersion,
    };
  }

  /** GET /api/projects/:id/progress — tracking data for all tasks */
  async tracking(projectId: string) {
    const project = await this.scheduleService.getProject(projectId);
    const [tasks, currentBaseline] = await Promise.all([
      this.tasks.find({ where: { projectId }, order: { rowOrder: 'ASC' } }),
      this.baselines.findOne({ where: { projectId, isCurrent: true } }),
    ]);
    return { statusDate: project.statusDate, baseline: currentBaseline, tasks };
  }

  /** GET /api/projects/:id/earned-value — BCWS/BCWP/ACWP & derived indicators */
  async earnedValue(projectId: string) {
    const project = await this.scheduleService.getProject(projectId);
    const input = await this.scheduleService.loadEngineInput(projectId);
    const result = calculateSchedule(input);
    const currentBaseline = await this.baselines.findOne({
      where: { projectId, isCurrent: true },
    });
    if (!currentBaseline) {
      return { available: false, message: 'Save a baseline to compute earned value' };
    }
    const snapshots = await this.baselineTasks.find({ where: { baselineId: currentBaseline.id } });
    const ev = computeEarnedValue(
      snapshots.map((s) => ({
        taskId: s.taskId,
        name: s.name,
        start: s.start.toISOString(),
        finish: s.finish.toISOString(),
        durationMinutes: s.durationMinutes,
        workMinutes: s.workMinutes,
        cost: s.cost,
        percentComplete: s.percentComplete,
      })),
      result,
      project.statusDate?.toISOString() ?? null,
      input.calendars.find((c) => c.id === input.defaultCalendarId) ?? input.calendars[0],
    );
    return { available: true, baseline: currentBaseline, earnedValue: ev };
  }

  async updatesFor(projectId: string): Promise<ProgressUpdateEntity[]> {
    await this.scheduleService.getProject(projectId);
    return this.updates.find({ where: { projectId }, order: { asOf: 'DESC' } });
  }
}
