import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  ResourceAssignmentEntity,
  ResourceEntity,
  ScheduleAuditEntity,
  TaskDependencyEntity,
  TaskEntity,
} from '../../entities';
import { ScheduleService } from '../schedule/schedule.service';

export class CreateTaskDto {
  name!: string;
  durationMinutes?: number;
  durationMode?: 'working' | 'elapsed';
  outlineLevel?: number;
  afterTaskId?: string | null;
  beforeTaskId?: string | null;
  milestone?: boolean;
  mode?: 'auto' | 'manual';
  manualStart?: string | null;
  manualFinish?: string | null;
  taskType?: 'fixed_units' | 'fixed_duration' | 'fixed_work';
  effortDriven?: boolean;
  constraintType?: string | null;
  constraintDate?: string | null;
  priority?: number;
  notes?: string | null;
  stage?: string | null;
  trade?: string | null;
  location?: string | null;
  autolink?: boolean;
}

export class UpdateTaskDto {
  name?: string;
  durationMinutes?: number;
  durationMode?: 'working' | 'elapsed';
  outlineLevel?: number;
  mode?: 'auto' | 'manual';
  manualStart?: string | null;
  manualFinish?: string | null;
  taskType?: 'fixed_units' | 'fixed_duration' | 'fixed_work';
  effortDriven?: boolean;
  percentComplete?: number;
  constraintType?: string | null;
  constraintDate?: string | null;
  deadline?: string | null;
  calendarId?: string | null;
  priority?: number;
  notes?: string | null;
  active?: boolean;
  fixedCost?: number;
  fixedCostAccrual?: 'start' | 'prorated' | 'end';
  actualStart?: string | null;
  actualFinish?: string | null;
  actualWorkMinutes?: number;
  actualCost?: number | null;
  stage?: string | null;
  trade?: string | null;
  location?: string | null;
  packageId?: string | null;
  externalReferenceId?: string | null;
  requiredOnSite?: string | null;
  delayReason?: string | null;
  extensionOfTime?: boolean;
  isProcurement?: boolean;
  isApproval?: boolean;
  isInspection?: boolean;
  expectedScheduleVersion?: number;
}

export class BulkUpdateDto {
  updates!: { taskId: string; changes: UpdateTaskDto }[];
  expectedScheduleVersion?: number;
}

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(TaskEntity) private readonly tasks: Repository<TaskEntity>,
    @InjectRepository(TaskDependencyEntity) private readonly deps: Repository<TaskDependencyEntity>,
    @InjectRepository(ResourceAssignmentEntity) private readonly assignments: Repository<ResourceAssignmentEntity>,
    @InjectRepository(ResourceEntity) private readonly resources: Repository<ResourceEntity>,
    @InjectRepository(ScheduleAuditEntity) private readonly audit: Repository<ScheduleAuditEntity>,
    private readonly scheduleService: ScheduleService,
  ) {}

  listTasks(projectId: string): Promise<TaskEntity[]> {
    return this.tasks.find({ where: { projectId }, order: { rowOrder: 'ASC' } });
  }

  private async nextRowOrder(projectId: string, afterTaskId?: string | null, beforeTaskId?: string | null): Promise<number> {
    const all = await this.tasks.find({ where: { projectId }, order: { rowOrder: 'ASC' } });
    if (all.length === 0) return 1000;
    if (afterTaskId) {
      const idx = all.findIndex((t) => t.id === afterTaskId);
      if (idx >= 0) {
        const next = all[idx + 1];
        return next ? (all[idx].rowOrder + next.rowOrder) / 2 : all[idx].rowOrder + 1000;
      }
    }
    if (beforeTaskId) {
      const idx = all.findIndex((t) => t.id === beforeTaskId);
      if (idx > 0) return (all[idx - 1].rowOrder + all[idx].rowOrder) / 2;
      if (idx === 0) return all[0].rowOrder - 1000;
    }
    return all[all.length - 1].rowOrder + 1000;
  }

  async createTask(projectId: string, dto: CreateTaskDto): Promise<Record<string, unknown>> {
    await this.scheduleService.getProject(projectId);
    const settings = await this.scheduleService.getSettings(projectId);
    const rowOrder = await this.nextRowOrder(projectId, dto.afterTaskId, dto.beforeTaskId);

    // Outline level: inherit from the task above when inserting mid-list
    let outlineLevel = dto.outlineLevel ?? 0;
    if (dto.outlineLevel === undefined && dto.afterTaskId) {
      const above = await this.tasks.findOne({ where: { id: dto.afterTaskId } });
      outlineLevel = above?.outlineLevel ?? 0;
    }

    const task = this.tasks.create({
      projectId,
      rowOrder,
      outlineLevel,
      name: dto.name,
      durationMinutes: dto.milestone ? 0 : (dto.durationMinutes ?? 480),
      durationMode: dto.durationMode ?? 'working',
      mode: dto.mode ?? 'auto',
      manualStart: dto.manualStart ? new Date(dto.manualStart) : null,
      manualFinish: dto.manualFinish ? new Date(dto.manualFinish) : null,
      taskType: dto.taskType ?? settings.newTaskType,
      effortDriven: dto.effortDriven ?? settings.newTasksEffortDriven,
      constraintType: dto.constraintType ?? 'ASAP',
      constraintDate: dto.constraintDate ? new Date(dto.constraintDate) : null,
      priority: dto.priority ?? 500,
      notes: dto.notes ?? null,
      stage: dto.stage ?? null,
      trade: dto.trade ?? null,
      location: dto.location ?? null,
    });
    const saved = await this.tasks.save(task);

    // Autolink: FS-link to the nearest preceding task at the same or lower level
    if (dto.autolink ?? true) {
      const all = await this.tasks.find({ where: { projectId }, order: { rowOrder: 'ASC' } });
      const idx = all.findIndex((t) => t.id === saved.id);
      for (let i = idx - 1; i >= 0; i--) {
        if (all[i].outlineLevel <= outlineLevel) {
          const exists = await this.deps.findOne({
            where: { predecessorId: all[i].id, successorId: saved.id },
          });
          if (!exists) {
            await this.deps.save(
              this.deps.create({
                projectId,
                predecessorId: all[i].id,
                successorId: saved.id,
                type: 'FS',
                lagMinutes: 0,
              }),
            );
          }
          break;
        }
      }
    }

    const recalc = await this.scheduleService.recalculate(projectId, 'task_create');
    return this.taskResponse(saved.id, recalc);
  }

  async updateTask(taskId: string, dto: UpdateTaskDto): Promise<Record<string, unknown>> {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException(`Task ${taskId} not found`);
    await this.scheduleService.assertVersion(task.projectId, dto.expectedScheduleVersion);

    const before = { ...task };
    const dateFields = new Set<keyof UpdateTaskDto>([
      'constraintDate',
      'deadline',
      'manualStart',
      'manualFinish',
      'actualStart',
      'actualFinish',
      'requiredOnSite',
    ]);
    const taskRecord = task as unknown as Record<string, unknown>;
    const dtoRecord = dto as unknown as Record<string, unknown>;
    for (const f of Object.keys(dto)) {
      if (f === 'expectedScheduleVersion') continue;
      taskRecord[f] = dateFields.has(f as keyof UpdateTaskDto)
        ? dtoRecord[f]
          ? new Date(dtoRecord[f] as string)
          : null
        : dtoRecord[f];
    }

    // Milestone toggling via duration
    if (dto.durationMinutes !== undefined && dto.durationMinutes === 0) {
      task.durationMinutes = 0;
    }

    await this.tasks.save(task);

    // Effort-driven / task-type work redistribution on duration edits
    if (dto.durationMinutes !== undefined) {
      await this.redistributeWorkForDuration(task);
    }

    const recalc = await this.scheduleService.recalculate(task.projectId, 'task_update');
    await this.audit.save(
      this.audit.create({
        projectId: task.projectId,
        entity: 'task',
        entityId: task.id,
        action: 'update',
        before: before as unknown as Record<string, unknown>,
        after: task as unknown as Record<string, unknown>,
        actor: 'api',
      }),
    );
    return this.taskResponse(task.id, recalc);
  }

  async bulkUpdate(projectId: string, dto: BulkUpdateDto): Promise<Record<string, unknown>> {
    await this.scheduleService.getProject(projectId);
    await this.scheduleService.assertVersion(projectId, dto.expectedScheduleVersion);
    for (const u of dto.updates) {
      await this.updateTask(u.taskId, { ...u.changes, expectedScheduleVersion: undefined });
    }
    const recalc = await this.scheduleService.recalculate(projectId, 'bulk_update');
    return {
      scheduleVersion: recalc.scheduleVersion,
      changedTasks: recalc.changedTasks,
      warnings: recalc.warnings,
    };
  }

  async deleteTask(taskId: string, deleteSubtree = true): Promise<Record<string, unknown>> {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException(`Task ${taskId} not found`);
    const projectId = task.projectId;

    const toDelete = new Set<string>([taskId]);
    if (deleteSubtree) {
      const all = await this.tasks.find({ where: { projectId }, order: { rowOrder: 'ASC' } });
      let deleting = false;
      let level = 0;
      for (const t of all) {
        if (t.id === taskId) {
          deleting = true;
          level = t.outlineLevel;
          continue;
        }
        if (deleting) {
          if (t.outlineLevel > level) {
            toDelete.add(t.id);
          } else {
            break;
          }
        }
      }
    }

    const ids = [...toDelete];
    await this.deps
      .createQueryBuilder()
      .delete()
      .where('predecessor_id IN (:...ids)', { ids })
      .orWhere('successor_id IN (:...ids)', { ids })
      .execute();
    await this.assignments.createQueryBuilder().delete().where('task_id IN (:...ids)', { ids }).execute();
    await this.tasks.delete(ids);

    const recalc = await this.scheduleService.recalculate(projectId, 'task_delete');
    return {
      deletedTaskIds: ids,
      scheduleVersion: recalc.scheduleVersion,
      changedTasks: recalc.changedTasks,
      warnings: recalc.warnings,
    };
  }

  async moveTask(taskId: string, beforeTaskId: string | null): Promise<Record<string, unknown>> {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException(`Task ${taskId} not found`);
    const projectId = task.projectId;
    const rowOrder = await this.nextRowOrder(projectId, null, beforeTaskId);
    task.rowOrder = rowOrder;
    await this.tasks.save(task);
    const recalc = await this.scheduleService.recalculate(projectId, 'task_move');
    return { taskId, rowOrder, scheduleVersion: recalc.scheduleVersion, warnings: recalc.warnings };
  }

  async indent(taskId: string): Promise<Record<string, unknown>> {
    const found = await this.tasks.findOne({ where: { id: taskId } });
    if (!found) throw new NotFoundException(`Task ${taskId} not found`);
    const all = await this.tasks.find({
      where: { projectId: found.projectId },
      order: { rowOrder: 'ASC' },
    });
    const idx = all.findIndex((t) => t.id === taskId);
    if (idx <= 0) throw new BadRequestException('Cannot indent the first row');
    const task = all[idx]; // operate on the instance we save
    const above = all[idx - 1];
    const newLevel = above.outlineLevel + 1;
    if (newLevel > 10) throw new BadRequestException('Outline level too deep');

    const subtree = this.subtreeOf(all, idx);
    for (const t of subtree) {
      t.outlineLevel += 1;
    }
    task.outlineLevel = newLevel;
    await this.tasks.save([task, ...subtree]);
    const recalc = await this.scheduleService.recalculate(found.projectId, 'outline_change');
    return { taskId, outlineLevel: newLevel, scheduleVersion: recalc.scheduleVersion };
  }

  async outdent(taskId: string): Promise<Record<string, unknown>> {
    const found = await this.tasks.findOne({ where: { id: taskId } });
    if (!found) throw new NotFoundException(`Task ${taskId} not found`);
    const all = await this.tasks.find({
      where: { projectId: found.projectId },
      order: { rowOrder: 'ASC' },
    });
    const idx = all.findIndex((t) => t.id === taskId);
    const task = all[idx];
    if (task.outlineLevel === 0) throw new BadRequestException('Cannot outdent a top-level task');
    const newLevel = task.outlineLevel - 1;

    const subtree = this.subtreeOf(all, idx);
    for (const t of subtree) t.outlineLevel = Math.max(0, t.outlineLevel - 1);
    task.outlineLevel = newLevel;
    await this.tasks.save([task, ...subtree]);
    const recalc = await this.scheduleService.recalculate(found.projectId, 'outline_change');
    return { taskId, outlineLevel: newLevel, scheduleVersion: recalc.scheduleVersion };
  }

  // ------------------------------------------------------------------ helpers

  private subtreeOf(all: TaskEntity[], idx: number): TaskEntity[] {
    const level = all[idx].outlineLevel;
    const out: TaskEntity[] = [];
    for (let i = idx + 1; i < all.length; i++) {
      if (all[i].outlineLevel > level) out.push(all[i]);
      else break;
    }
    return out;
  }

  /**
   * MS Project task-type rules when the DURATION is edited:
   *  - fixed_units (± effort driven): work follows the new duration
   *  - fixed_duration: work follows the new duration
   *  - fixed_work: editing duration re-defines the work (duration × units)
   */
  private async redistributeWorkForDuration(task: TaskEntity): Promise<void> {
    const taskAssignments = await this.assignments.find({ where: { taskId: task.id } });
    if (taskAssignments.length === 0) return;
    for (const a of taskAssignments) {
      const resource = await this.resources.findOne({ where: { id: a.resourceId } });
      if (!resource || resource.kind !== 'work') continue;
      a.workMinutes = a.units * task.durationMinutes;
      await this.assignments.save(a);
    }
  }

  private async taskResponse(
    taskId: string,
    recalc: Awaited<ReturnType<ScheduleService['recalculate']>>,
  ): Promise<Record<string, unknown>> {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    return {
      task,
      calculated: recalc.result.tasks[taskId] ?? null,
      changedTasks: recalc.changedTasks.filter((c) => c.taskId !== taskId),
      warnings: recalc.warnings,
      scheduleVersion: recalc.scheduleVersion,
    };
  }
}
