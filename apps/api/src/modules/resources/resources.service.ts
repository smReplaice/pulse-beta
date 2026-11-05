import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import {
  CalendarEntity,
  CalendarExceptionEntity,
  CalendarWorkingDayEntity,
  ProjectBaselineEntity,
  ResourceAssignmentEntity,
  ResourceEntity,
  TaskEntity,
} from '../../entities';
import { ScheduleService } from '../schedule/schedule.service';

export class CreateResourceDto {
  name!: string;
  kind?: 'work' | 'material' | 'cost';
  initials?: string | null;
  group?: string | null;
  code?: string | null;
  maxUnits?: number;
  standardRate?: number;
  overtimeRate?: number;
  costPerUse?: number;
  calendarId?: string | null;
  isGeneric?: boolean;
  notes?: string | null;
}

export class UpdateResourceDto extends CreateResourceDto {}

export class CreateAssignmentDto {
  resourceId!: string;
  units?: number;
  workMinutes?: number | null;
  cost?: number | null;
  expectedScheduleVersion?: number;
}

export class UpdateAssignmentDto {
  units?: number;
  workMinutes?: number | null;
  cost?: number | null;
  expectedScheduleVersion?: number;
}

@Injectable()
export class ResourcesService {
  constructor(
    @InjectRepository(ResourceEntity) private readonly resources: Repository<ResourceEntity>,
    @InjectRepository(ResourceAssignmentEntity) private readonly assignments: Repository<ResourceAssignmentEntity>,
    @InjectRepository(TaskEntity) private readonly tasks: Repository<TaskEntity>,
    @InjectRepository(CalendarEntity) private readonly calendars: Repository<CalendarEntity>,
    @InjectRepository(CalendarWorkingDayEntity) private readonly calDays: Repository<CalendarWorkingDayEntity>,
    @InjectRepository(CalendarExceptionEntity) private readonly calExceptions: Repository<CalendarExceptionEntity>,
    @InjectRepository(ProjectBaselineEntity) private readonly baselines: Repository<ProjectBaselineEntity>,
    private readonly scheduleService: ScheduleService,
  ) {}

  // ------------------------------------------------------------------ resources

  async listResources(projectId: string): Promise<ResourceEntity[]> {
    const project = await this.scheduleService.getProject(projectId);
    return this.resources.find({
      where: [
        { projectId },
        { projectId: IsNull() as unknown as string, organizationId: project.organizationId },
      ],
      order: { name: 'ASC' },
    });
  }

  async createResource(projectId: string, dto: CreateResourceDto): Promise<ResourceEntity> {
    const project = await this.scheduleService.getProject(projectId);
    return this.resources.save(
      this.resources.create({
        organizationId: project.organizationId,
        projectId,
        kind: dto.kind ?? 'work',
        name: dto.name,
        initials: dto.initials ?? null,
        group: dto.group ?? null,
        code: dto.code ?? null,
        maxUnits: dto.maxUnits ?? 1,
        standardRate: dto.standardRate ?? 0,
        overtimeRate: dto.overtimeRate ?? 0,
        costPerUse: dto.costPerUse ?? 0,
        calendarId: dto.calendarId ?? null,
        isGeneric: dto.isGeneric ?? false,
        notes: dto.notes ?? null,
      }),
    );
  }

  async updateResource(resourceId: string, dto: UpdateResourceDto): Promise<ResourceEntity> {
    const resource = await this.resources.findOne({ where: { id: resourceId } });
    if (!resource) throw new NotFoundException(`Resource ${resourceId} not found`);
    Object.assign(resource, dto);
    const saved = await this.resources.save(resource);
    if (resource.projectId) {
      await this.scheduleService.recalculate(resource.projectId, 'resource_update');
    }
    return saved;
  }

  async deleteResource(resourceId: string): Promise<void> {
    const resource = await this.resources.findOne({ where: { id: resourceId } });
    if (!resource) throw new NotFoundException(`Resource ${resourceId} not found`);
    await this.assignments.delete({ resourceId });
    await this.resources.remove(resource);
  }

  // ------------------------------------------------------------------ assignments

  async listAssignments(projectId: string): Promise<ResourceAssignmentEntity[]> {
    return this.assignments.find({ where: { projectId } });
  }

  /**
   * Assign a resource to a task honouring MS Project task-type rules:
   *  - fixed_units + effort driven: conserve WORK — duration shrinks/stretches
   *  - fixed_work: the task's total work is kept; new assignment takes a share
   *  - fixed_duration: duration kept; work = units × duration
   */
  async assign(taskId: string, dto: CreateAssignmentDto): Promise<Record<string, unknown>> {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException(`Task ${taskId} not found`);
    await this.scheduleService.assertVersion(task.projectId, dto.expectedScheduleVersion);
    const resource = await this.resources.findOne({ where: { id: dto.resourceId } });
    if (!resource) throw new NotFoundException(`Resource ${dto.resourceId} not found`);

    const existing = await this.assignments.find({ where: { taskId } });
    const dup = existing.find((a) => a.resourceId === dto.resourceId);
    if (dup) throw new BadRequestException('Resource already assigned to this task');

    const units = dto.units ?? 1;
    const existingUnits = existing.reduce((s, a) => s + a.units, 0);

    // Current total work on the task (before this assignment)
    const currentWork =
      task.taskType === 'fixed_work' || (task.taskType === 'fixed_units' && task.effortDriven)
        ? existing.reduce((s, a) => s + (a.workMinutes ?? 0), 0) ||
          task.durationMinutes * existingUnits
        : 0;

    const assignment = this.assignments.create({
      projectId: task.projectId,
      taskId,
      resourceId: dto.resourceId,
      units,
      workMinutes: dto.workMinutes ?? null,
      cost: dto.cost ?? null,
    });

    if (resource.kind === 'work') {
      if (task.taskType === 'fixed_work') {
        // Keep total task work; the new resource shares it → duration re-derives
        const totalWork = currentWork > 0 ? currentWork : task.durationMinutes;
        const newTotalUnits = existingUnits + units;
        assignment.workMinutes = Math.round((totalWork * units) / newTotalUnits);
        for (const a of existing) {
          a.workMinutes = Math.round((totalWork * a.units) / newTotalUnits);
        }
        await this.assignments.save(existing);
      } else if (task.taskType === 'fixed_units' && task.effortDriven) {
        // Conserve work across the pool
        const totalWork =
          currentWork > 0 ? currentWork : task.durationMinutes * Math.max(1, existingUnits);
        const newTotalUnits = existingUnits + units;
        assignment.workMinutes = Math.round((totalWork * units) / newTotalUnits);
        for (const a of existing) {
          a.workMinutes = Math.round((totalWork * a.units) / newTotalUnits);
        }
        await this.assignments.save(existing);
      } else {
        // fixed_duration or non-effort-driven: work follows units × duration
        assignment.workMinutes = units * task.durationMinutes;
      }
    }

    const saved = await this.assignments.save(assignment);
    const recalc = await this.scheduleService.recalculate(task.projectId, 'assignment_change');
    return {
      assignment: saved,
      calculated: recalc.result.tasks[taskId] ?? null,
      changedTasks: recalc.changedTasks.filter((c) => c.taskId !== taskId),
      warnings: recalc.warnings,
      scheduleVersion: recalc.scheduleVersion,
    };
  }

  async updateAssignment(assignmentId: string, dto: UpdateAssignmentDto): Promise<Record<string, unknown>> {
    const assignment = await this.assignments.findOne({ where: { id: assignmentId } });
    if (!assignment) throw new NotFoundException(`Assignment ${assignmentId} not found`);
    const task = await this.tasks.findOne({ where: { id: assignment.taskId } });
    if (!task) throw new NotFoundException('Task for assignment not found');
    await this.scheduleService.assertVersion(task.projectId, dto.expectedScheduleVersion);

    if (dto.units !== undefined) assignment.units = dto.units;
    if (dto.workMinutes !== undefined) assignment.workMinutes = dto.workMinutes;
    if (dto.cost !== undefined) assignment.cost = dto.cost;
    if (dto.units !== undefined && dto.workMinutes === undefined) {
      // fixed_work: keep the assignment's work share proportional to units
      const existing = await this.assignments.find({ where: { taskId: task.id } });
      const totalWork = existing.reduce((s, a) => s + (a.workMinutes ?? a.units * task.durationMinutes), 0);
      const newUnits = existing.reduce((s, a) => s + (a.id === assignmentId ? dto.units! : a.units), 0);
      for (const a of existing) {
        const u = a.id === assignmentId ? dto.units! : a.units;
        a.workMinutes = Math.round((totalWork * u) / Math.max(newUnits, 1e-9));
      }
      await this.assignments.save(existing);
    }
    const saved = await this.assignments.save(assignment);
    const recalc = await this.scheduleService.recalculate(task.projectId, 'assignment_change');
    return {
      assignment: saved,
      calculated: recalc.result.tasks[task.id] ?? null,
      warnings: recalc.warnings,
      scheduleVersion: recalc.scheduleVersion,
    };
  }

  async removeAssignment(assignmentId: string): Promise<Record<string, unknown>> {
    const assignment = await this.assignments.findOne({ where: { id: assignmentId } });
    if (!assignment) throw new NotFoundException(`Assignment ${assignmentId} not found`);
    const task = await this.tasks.findOne({ where: { id: assignment.taskId } });
    await this.assignments.remove(assignment);
    if (task) {
      const recalc = await this.scheduleService.recalculate(task.projectId, 'assignment_change');
      return { ok: true, scheduleVersion: recalc.scheduleVersion, warnings: recalc.warnings };
    }
    return { ok: true };
  }

  // ------------------------------------------------------------------ calendars + baselines helpers

  async listCalendars(projectId: string): Promise<unknown> {
    const [cals, days, exceptions] = await Promise.all([
      this.calendars.find({ where: { projectId } }),
      this.calDays.find(),
      this.calExceptions.find(),
    ]);
    return cals.map((c) => ({
      ...c,
      workingDays: days.filter((d) => d.calendarId === c.id),
      exceptions: exceptions.filter((e) => e.calendarId === c.id),
    }));
  }

  getBaselines(projectId: string): Promise<ProjectBaselineEntity[]> {
    return this.baselines.find({ where: { projectId }, order: { createdAt: 'DESC' } });
  }
}
