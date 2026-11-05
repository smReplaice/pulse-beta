import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BaselineTaskEntity, ProjectBaselineEntity, TaskEntity } from '../../entities';
import { ScheduleService } from '../schedule/schedule.service';

export class SaveBaselineDto {
  name?: string;
  notes?: string;
  setCurrent?: boolean;
}

@Injectable()
export class BaselinesService {
  constructor(
    @InjectRepository(ProjectBaselineEntity) private readonly baselines: Repository<ProjectBaselineEntity>,
    @InjectRepository(BaselineTaskEntity) private readonly baselineTasks: Repository<BaselineTaskEntity>,
    @InjectRepository(TaskEntity) private readonly tasks: Repository<TaskEntity>,
    private readonly scheduleService: ScheduleService,
  ) {}

  list(projectId: string): Promise<ProjectBaselineEntity[]> {
    return this.baselines.find({ where: { projectId }, order: { createdAt: 'DESC' } });
  }

  /** POST /api/projects/:id/baselines — snapshot task dates, work and costs */
  async save(projectId: string, dto: SaveBaselineDto): Promise<ProjectBaselineEntity> {
    await this.scheduleService.getProject(projectId);
    const count = await this.baselines.count({ where: { projectId } });
    const baseline = await this.baselines.save(
      this.baselines.create({
        projectId,
        name: dto.name ?? `Baseline ${count + 1}`,
        notes: dto.notes ?? null,
        isCurrent: dto.setCurrent ?? true,
      }),
    );
    if (dto.setCurrent ?? true) {
      await this.baselines.update({ projectId }, { isCurrent: false });
      await this.baselines.update({ id: baseline.id }, { isCurrent: true });
    }
    const tasks = await this.tasks.find({ where: { projectId }, order: { rowOrder: 'ASC' } });
    if (tasks.length > 0) {
      await this.baselineTasks.insert(
        tasks.map((t) =>
          this.baselineTasks.create({
            baselineId: baseline.id,
            taskId: t.id,
            name: t.name,
            start: t.computedStart ?? t.manualStart ?? new Date(),
            finish: t.computedFinish ?? t.manualFinish ?? new Date(),
            durationMinutes: t.computedDuration ?? t.durationMinutes,
            workMinutes: t.computedWork ?? 0,
            cost: t.computedPlannedCost ?? 0,
            percentComplete: t.computedPercentComplete ?? t.percentComplete,
          }),
        ),
      );
    }
    return baseline;
  }

  async getSnapshot(baselineId: string): Promise<BaselineTaskEntity[]> {
    return this.baselineTasks.find({ where: { baselineId } });
  }

  /** GET compare — current schedule vs baseline with variances */
  async compare(baselineId: string) {
    const baseline = await this.baselines.findOne({ where: { id: baselineId } });
    if (!baseline) throw new NotFoundException(`Baseline ${baselineId} not found`);
    const snapshots = await this.baselineTasks.find({ where: { baselineId } });
    const tasks = await this.tasks.find({ where: { projectId: baseline.projectId } });
    const byTask = new Map(tasks.map((t) => [t.id, t]));
    return {
      baseline,
      rows: snapshots.map((s) => {
        const t = byTask.get(s.taskId);
        return {
          taskId: s.taskId,
          name: s.name,
          baselineStart: s.start,
          baselineFinish: s.finish,
          baselineDuration: s.durationMinutes,
          baselineCost: s.cost,
          currentStart: t?.computedStart ?? null,
          currentFinish: t?.computedFinish ?? null,
          currentDuration: t?.computedDuration ?? null,
          currentCost: t?.computedPlannedCost ?? null,
          startVarianceMinutes: t?.computedStart
            ? Math.round((t.computedStart.getTime() - s.start.getTime()) / 60000)
            : null,
          finishVarianceMinutes: t?.computedFinish
            ? Math.round((t.computedFinish.getTime() - s.finish.getTime()) / 60000)
            : null,
          durationVarianceMinutes: t?.computedDuration != null ? t.computedDuration - s.durationMinutes : null,
          costVariance: t?.computedPlannedCost != null ? t.computedPlannedCost - s.cost : null,
        };
      }),
    };
  }

  /** POST restore — move the live schedule back onto baseline dates (as constraints) */
  async restore(baselineId: string): Promise<Record<string, unknown>> {
    const baseline = await this.baselines.findOne({ where: { id: baselineId } });
    if (!baseline) throw new NotFoundException(`Baseline ${baselineId} not found`);
    const snapshots = await this.baselineTasks.find({ where: { baselineId } });
    for (const s of snapshots) {
      await this.tasks.update(
        { id: s.taskId },
        {
          constraintType: 'MSO',
          constraintDate: s.start,
          levelingDelayMinutes: 0,
        },
      );
    }
    const recalc = await this.scheduleService.recalculate(baseline.projectId, 'baseline_restore');
    return {
      ok: true,
      restoredTasks: snapshots.length,
      changedTasks: recalc.changedTasks,
      scheduleVersion: recalc.scheduleVersion,
    };
  }

  async delete(baselineId: string): Promise<void> {
    const baseline = await this.baselines.findOne({ where: { id: baselineId } });
    if (!baseline) throw new NotFoundException(`Baseline ${baselineId} not found`);
    await this.baselineTasks.delete({ baselineId });
    await this.baselines.remove(baseline);
  }
}
