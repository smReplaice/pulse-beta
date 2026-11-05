import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  buildHierarchy,
  isSummaryToChildLink,
  topoSortLeaves,
} from '@pulse/engine';
import { ScheduleAuditEntity, TaskDependencyEntity, TaskEntity } from '../../entities';
import { ScheduleService } from '../schedule/schedule.service';

export class CreateDependencyDto {
  predecessorId!: string;
  type?: 'FS' | 'SS' | 'FF' | 'SF';
  lagMinutes?: number;
  expectedScheduleVersion?: number;
}

export class UpdateDependencyDto {
  type?: 'FS' | 'SS' | 'FF' | 'SF';
  lagMinutes?: number;
  expectedScheduleVersion?: number;
}

@Injectable()
export class DependenciesService {
  constructor(
    @InjectRepository(TaskDependencyEntity) private readonly deps: Repository<TaskDependencyEntity>,
    @InjectRepository(TaskEntity) private readonly tasks: Repository<TaskEntity>,
    @InjectRepository(ScheduleAuditEntity) private readonly audit: Repository<ScheduleAuditEntity>,
    private readonly scheduleService: ScheduleService,
  ) {}

  list(projectId: string): Promise<TaskDependencyEntity[]> {
    return this.deps.find({ where: { projectId } });
  }

  /**
   * Validate a candidate dependency against the CURRENT graph (cycles, self-links,
   * summary-to-child links) BEFORE inserting, using the pure engine utilities.
   * Throws CircularDependencyError / InvalidDependencyError on bad graphs.
   */
  private async validateCandidate(
    projectId: string,
    predecessorId: string,
    successorId: string,
  ): Promise<void> {
    if (predecessorId === successorId) {
      throw new BadRequestException('A task cannot depend on itself');
    }
    const input = await this.scheduleService.loadEngineInput(projectId);
    const graph = buildHierarchy(input.tasks);
    if (isSummaryToChildLink(graph, predecessorId, successorId)) {
      throw new BadRequestException('Cannot link a summary task to one of its own children');
    }
    const deps = [...input.dependencies];
    deps.push({
      id: 'candidate',
      predecessorId,
      successorId,
      type: 'FS',
      lagMinutes: 0,
    });
    topoSortLeaves(graph, deps);
  }

  async create(taskId: string, dto: CreateDependencyDto): Promise<Record<string, unknown>> {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException(`Task ${taskId} not found`);
    await this.scheduleService.assertVersion(task.projectId, dto.expectedScheduleVersion);

    if (!['FS', 'SS', 'FF', 'SF'].includes(dto.type ?? 'FS')) {
      throw new BadRequestException('Invalid dependency type');
    }
    const pred = await this.tasks.findOne({ where: { id: dto.predecessorId, projectId: task.projectId } });
    if (!pred) throw new NotFoundException('Predecessor not found in this project');
    await this.validateCandidate(task.projectId, dto.predecessorId, taskId);

    const dup = await this.deps.findOne({
      where: { predecessorId: dto.predecessorId, successorId: taskId },
    });
    if (dup) throw new BadRequestException('This dependency already exists');

    const saved = await this.deps.save(
      this.deps.create({
        projectId: task.projectId,
        predecessorId: dto.predecessorId,
        successorId: taskId,
        type: dto.type ?? 'FS',
        lagMinutes: dto.lagMinutes ?? 0,
      }),
    );
    const recalc = await this.scheduleService.recalculate(task.projectId, 'dependency_change');
    return {
      dependency: saved,
      changedTasks: recalc.changedTasks,
      warnings: recalc.warnings,
      scheduleVersion: recalc.scheduleVersion,
    };
  }

  async update(depId: string, dto: UpdateDependencyDto): Promise<Record<string, unknown>> {
    const dep = await this.deps.findOne({ where: { id: depId } });
    if (!dep) throw new NotFoundException(`Dependency ${depId} not found`);
    await this.scheduleService.assertVersion(dep.projectId, dto.expectedScheduleVersion);
    if (dto.type) dep.type = dto.type;
    if (dto.lagMinutes !== undefined) dep.lagMinutes = dto.lagMinutes;
    await this.deps.save(dep);
    const recalc = await this.scheduleService.recalculate(dep.projectId, 'dependency_change');
    return {
      dependency: dep,
      changedTasks: recalc.changedTasks,
      warnings: recalc.warnings,
      scheduleVersion: recalc.scheduleVersion,
    };
  }

  async delete(depId: string): Promise<Record<string, unknown>> {
    const dep = await this.deps.findOne({ where: { id: depId } });
    if (!dep) throw new NotFoundException(`Dependency ${depId} not found`);
    await this.deps.remove(dep);
    const recalc = await this.scheduleService.recalculate(dep.projectId, 'dependency_change');
    return { ok: true, changedTasks: recalc.changedTasks, scheduleVersion: recalc.scheduleVersion };
  }
}
