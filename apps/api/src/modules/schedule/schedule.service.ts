import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import {
  AssignmentInput,
  CalendarSpec,
  ConstraintType,
  DependencyInput,
  EngineProjectInput,
  ResourceInput,
  ScheduleResult,
  ScheduleWarning,
  TaskInput,
  calculateSchedule,
} from '@pulse/engine';
import {
  CalendarEntity,
  CalendarExceptionEntity,
  CalendarWorkingDayEntity,
  ProjectBaselineEntity,
  ProjectEntity,
  ProjectSettingsEntity,
  ResourceAssignmentEntity,
  ResourceEntity,
  ResourceTimephasedWorkEntity,
  ScheduleAuditEntity,
  ScheduleCalculationRunEntity,
  ScheduleVersionEntity,
  TaskDependencyEntity,
  TaskEntity,
} from '../../entities';
import { ScheduleGateway } from '../../gateway/schedule.gateway';
import { ScheduleVersionConflictException } from '../../common/errors';

export interface ChangedTask {
  taskId: string;
  before: { start: string | null; finish: string | null; totalFloatMinutes: number | null; isCritical: boolean };
  after: { start: string | null; finish: string | null; totalFloatMinutes: number | null; isCritical: boolean };
}

export interface RecalcResult {
  scheduleVersion: number;
  result: ScheduleResult;
  changedTasks: ChangedTask[];
  warnings: ScheduleWarning[];
}

@Injectable()
export class ScheduleService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly gateway: ScheduleGateway,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(ProjectSettingsEntity) private readonly settingsRepo: Repository<ProjectSettingsEntity>,
    @InjectRepository(TaskEntity) private readonly tasksRepo: Repository<TaskEntity>,
    @InjectRepository(TaskDependencyEntity) private readonly depsRepo: Repository<TaskDependencyEntity>,
    @InjectRepository(CalendarEntity) private readonly calendarsRepo: Repository<CalendarEntity>,
    @InjectRepository(CalendarWorkingDayEntity) private readonly calDaysRepo: Repository<CalendarWorkingDayEntity>,
    @InjectRepository(CalendarExceptionEntity) private readonly calExcRepo: Repository<CalendarExceptionEntity>,
    @InjectRepository(ResourceEntity) private readonly resourcesRepo: Repository<ResourceEntity>,
    @InjectRepository(ResourceAssignmentEntity) private readonly assignmentsRepo: Repository<ResourceAssignmentEntity>,
    @InjectRepository(ResourceTimephasedWorkEntity) private readonly timephasedRepo: Repository<ResourceTimephasedWorkEntity>,
  ) {}

  // ------------------------------------------------------------------ loading

  async getProject(projectId: string): Promise<ProjectEntity> {
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);
    return project;
  }

  async getSettings(projectId: string): Promise<ProjectSettingsEntity> {
    let settings = await this.settingsRepo.findOne({ where: { projectId } });
    if (!settings) {
      settings = this.settingsRepo.create({ projectId });
      settings = await this.settingsRepo.save(settings);
    }
    return settings;
  }

  async loadEngineInput(projectId: string): Promise<EngineProjectInput> {
    const project = await this.getProject(projectId);
    const settings = await this.getSettings(projectId);

    const [calendars, tasks, deps, resources, assignments] = await Promise.all([
      this.calendarsRepo.find({ where: { projectId } }),
      this.tasksRepo.find({ where: { projectId }, order: { rowOrder: 'ASC' } }),
      this.depsRepo.find({ where: { projectId } }),
      this.resourcesRepo.find({
        where: [
          { projectId },
          { projectId: IsNull(), organizationId: project.organizationId },
        ],
      }),
      this.assignmentsRepo.find({ where: { projectId } }),
    ]);
    if (calendars.length === 0) {
      throw new NotFoundException(`Project ${projectId} has no calendars`);
    }
    const [calDays, calExceptions] = await Promise.all([
      this.calDaysRepo.find({
        where: calendars.map((c) => ({ calendarId: c.id })),
      }),
      this.calExcRepo.find({ where: calendars.map((c) => ({ calendarId: c.id })) }),
    ]);

    const calendarSpecs: CalendarSpec[] = calendars.map((c) => ({
      id: c.id,
      name: c.name,
      week: Object.fromEntries(
        calDays
          .filter((d) => d.calendarId === c.id)
          .map((d) => [d.dayOfWeek, d.periods]),
      ),
      exceptions: Object.fromEntries(
        calExceptions
          .filter((e) => e.calendarId === c.id)
          .map((e) => [e.date, { periods: e.periods, label: e.label ?? undefined }]),
      ),
    }));

    const defaultCalendar =
      calendarSpecs.find((c) => c.id === settings.defaultCalendarId) ??
      calendarSpecs.find((c) => c.id === calendars.find((x) => x.isDefault)?.id) ??
      calendarSpecs[0];

    const taskInputs: TaskInput[] = tasks.map((t) => ({
      id: t.id,
      name: t.name,
      rowOrder: t.rowOrder,
      outlineLevel: t.outlineLevel,
      durationMinutes: t.durationMinutes,
      durationMode: t.durationMode === 'elapsed' ? 'elapsed' : 'working',
      mode: t.mode === 'manual' ? 'manual' : 'auto',
      taskType: (['fixed_units', 'fixed_duration', 'fixed_work'].includes(t.taskType)
        ? t.taskType
        : 'fixed_units') as TaskInput['taskType'],
      effortDriven: t.effortDriven,
      percentComplete: t.percentComplete,
      constraint: t.constraintType
        ? {
            type: t.constraintType as ConstraintType,
            date: t.constraintDate?.toISOString() ?? null,
          }
        : null,
      calendarId: t.calendarId,
      priority: t.priority,
      levelingDelayMinutes: t.levelingDelayMinutes,
      notes: t.notes ?? undefined,
      active: t.active,
      manualStart: t.manualStart?.toISOString() ?? null,
      manualFinish: t.manualFinish?.toISOString() ?? null,
      fixedCost: t.fixedCost,
      fixedCostAccrual: t.fixedCostAccrual as TaskInput['fixedCostAccrual'],
      actualStart: t.actualStart?.toISOString() ?? null,
      actualFinish: t.actualFinish?.toISOString() ?? null,
      actualWorkMinutes: t.actualWorkMinutes,
      actualCost: t.actualCost,
      deadline: t.deadline?.toISOString() ?? null,
      stage: t.stage ?? null,
      trade: t.trade ?? null,
      location: t.location ?? null,
      packageId: t.packageId ?? null,
      externalReferenceId: t.externalReferenceId ?? null,
      requiredOnSite: t.requiredOnSite?.toISOString() ?? null,
      delayReason: t.delayReason ?? null,
      extensionOfTime: t.extensionOfTime,
      isProcurement: t.isProcurement,
      isApproval: t.isApproval,
      isInspection: t.isInspection,
    }));

    const depInputs: DependencyInput[] = deps.map((d) => ({
      id: d.id,
      predecessorId: d.predecessorId,
      successorId: d.successorId,
      type: d.type as DependencyInput['type'],
      lagMinutes: d.lagMinutes,
    }));

    const resourceInputs: ResourceInput[] = resources.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind as ResourceInput['kind'],
      maxUnits: r.maxUnits,
      standardRate: r.standardRate,
      overtimeRate: r.overtimeRate,
      costPerUse: r.costPerUse,
      calendarId: r.calendarId,
      group: r.group ?? null,
      code: r.code ?? null,
      initials: r.initials ?? null,
    }));

    const assignmentInputs: AssignmentInput[] = assignments.map((a) => ({
      id: a.id,
      taskId: a.taskId,
      resourceId: a.resourceId,
      units: a.units,
      workMinutes: a.workMinutes,
      cost: a.cost,
    }));

    return {
      projectId,
      start: (project.projectStart ?? new Date()).toISOString(),
      deadline: project.projectDeadline?.toISOString() ?? null,
      statusDate: project.statusDate?.toISOString() ?? null,
      minutesPerDay: project.minutesPerDay,
      minutesPerWeek: project.minutesPerWeek,
      daysPerMonth: project.daysPerMonth,
      defaultCalendarId: defaultCalendar.id,
      calendars: calendarSpecs,
      tasks: taskInputs,
      dependencies: depInputs,
      resources: resourceInputs,
      assignments: assignmentInputs,
      criticalSlackThresholdMinutes: settings.criticalSlackThresholdMinutes,
      multipleCriticalPaths: settings.multipleCriticalPaths,
    };
  }

  // ------------------------------------------------------------------ recalc

  async recalculate(projectId: string, trigger: string, actor?: string): Promise<RecalcResult> {
    const startedAt = new Date();
    const input = await this.loadEngineInput(projectId);

    const before = new Map(
      (await this.tasksRepo.find({ where: { projectId } })).map((t) => [
        t.id,
        {
          start: t.computedStart?.toISOString() ?? null,
          finish: t.computedFinish?.toISOString() ?? null,
          totalFloatMinutes: t.computedTotalFloat ?? null,
          isCritical: t.computedIsCritical,
        },
      ]),
    );

    const result = calculateSchedule(input);

    await this.dataSource.transaction(async (em) => {
      // 1. persist computed task fields
      for (const [id, tr] of Object.entries(result.tasks)) {
        await em.update(
          TaskEntity,
          { id },
          {
            computedStart: new Date(tr.start),
            computedFinish: new Date(tr.finish),
            computedEarlyStart: new Date(tr.earlyStart),
            computedEarlyFinish: new Date(tr.earlyFinish),
            computedLateStart: new Date(tr.lateStart),
            computedLateFinish: new Date(tr.lateFinish),
            computedTotalFloat: tr.totalFloatMinutes,
            computedFreeFloat: tr.freeFloatMinutes,
            computedIsCritical: tr.isCritical,
            computedIsSummary: tr.isSummary,
            computedIsMilestone: tr.isMilestone,
            computedDuration: tr.durationMinutes,
            computedWork: tr.workMinutes,
            computedPercentComplete: tr.percentComplete,
            computedPlannedCost: tr.plannedCost,
            computedActualCost: tr.actualCost,
            wbs: tr.wbs,
          },
        );
      }

      // 2. timephased work rows
      await em.delete(ResourceTimephasedWorkEntity, { projectId });
      const tpRows: ResourceTimephasedWorkEntity[] = [];
      for (const ar of result.assignments) {
        for (const p of ar.byDay) {
          tpRows.push(
            em.create(ResourceTimephasedWorkEntity, {
              projectId,
              assignmentId: ar.assignmentId,
              taskId: ar.taskId,
              resourceId: ar.resourceId,
              dateKey: p.dateKey,
              plannedMinutes: p.plannedMinutes,
              actualMinutes: p.actualMinutes,
              plannedCost: p.plannedCost,
              actualCost: p.actualCost,
            }),
          );
        }
      }
      for (let i = 0; i < tpRows.length; i += 500) {
        await em.insert(ResourceTimephasedWorkEntity, tpRows.slice(i, i + 500));
      }

      // 3. version + run
      const project = await em.findOneByOrFail(ProjectEntity, { id: projectId });
      const nextVersion = project.currentScheduleVersion + 1;
      project.currentScheduleVersion = nextVersion;
      project.computedStart = new Date(result.projectStart);
      project.computedFinish = new Date(result.projectFinish);
      project.computedProgress =
        Object.values(result.tasks).length > 0
          ? Object.values(result.tasks)
              .filter((t) => !t.isSummary)
              .reduce((s, t) => s + t.durationMinutes * t.percentComplete, 0) /
            Math.max(
              1,
              Object.values(result.tasks)
                .filter((t) => !t.isSummary)
                .reduce((s, t) => s + t.durationMinutes, 0),
            )
          : 0;
      project.computedCriticalCount = result.stats.criticalCount;
      project.updatedAt = new Date();
      await em.save(project);

      const version = em.create(ScheduleVersionEntity, {
        projectId,
        version: nextVersion,
        trigger,
        summary: {
          projectFinish: result.projectFinish,
          criticalCount: result.stats.criticalCount,
          warningCount: result.warnings.length,
        },
      });
      await em.insert(ScheduleVersionEntity, version as never);

      const finishedAt = new Date();
      const changedIds = Object.entries(result.tasks)
        .filter(([id, tr]) => {
          const b = before.get(id);
          return (
            !b ||
            b.start !== tr.start ||
            b.finish !== tr.finish ||
            b.totalFloatMinutes !== tr.totalFloatMinutes ||
            b.isCritical !== tr.isCritical
          );
        })
        .map(([id]) => id);

      await em.insert(
        ScheduleCalculationRunEntity,
        em.create(ScheduleCalculationRunEntity, {
          projectId,
          versionId: version.id,
          startedAt,
          finishedAt,
          taskCount: result.stats.taskCount,
          changedCount: changedIds.length,
          warningCount: result.warnings.length,
          warnings: result.warnings as unknown[],
          durationMs: finishedAt.getTime() - startedAt.getTime(),
        }) as never,
      );

      if (actor) {
        await em.insert(
          ScheduleAuditEntity,
          {
            projectId,
            entity: 'schedule',
            entityId: null,
            action: 'update',
            before: null,
            after: { trigger, version: nextVersion },
            actor,
          } as never,
        );
      }
    });

    const changedTasks: ChangedTask[] = [];
    for (const [id, tr] of Object.entries(result.tasks)) {
      const b = before.get(id);
      if (
        b &&
        (b.start !== tr.start || b.finish !== tr.finish || b.totalFloatMinutes !== tr.totalFloatMinutes || b.isCritical !== tr.isCritical)
      ) {
        changedTasks.push({
          taskId: id,
          before: b,
          after: {
            start: tr.start,
            finish: tr.finish,
            totalFloatMinutes: tr.totalFloatMinutes,
            isCritical: tr.isCritical,
          },
        });
      }
    }

    const projectAfter = await this.getProject(projectId);
    this.gateway.emitScheduleChanged(projectId, {
      projectId,
      scheduleVersion: projectAfter.currentScheduleVersion,
      trigger,
      changedTasks: changedTasks.map((c) => c.taskId),
    });

    return {
      scheduleVersion: projectAfter.currentScheduleVersion,
      result,
      changedTasks,
      warnings: result.warnings,
    };
  }

  /** Full programme payload for GET /api/projects/:id/schedule. */
  async getSchedulePayload(projectId: string): Promise<Record<string, unknown>> {
    const project = await this.getProject(projectId);
    const settings = await this.getSettings(projectId);
    let [tasks, deps, calendars, calDays, calExceptions, resources, assignments, baselines] =
      await Promise.all([
        this.tasksRepo.find({ where: { projectId }, order: { rowOrder: 'ASC' } }),
        this.depsRepo.find({ where: { projectId } }),
        this.calendarsRepo.find({ where: { projectId } }),
        this.calDaysRepo.find(),
        this.calExcRepo.find(),
        this.resourcesRepo.find({
          where: [{ projectId }, { projectId: IsNull(), organizationId: project.organizationId }],
        }),
        this.assignmentsRepo.find({ where: { projectId } }),
        this.dataSource.getRepository(ProjectBaselineEntity).find({
          where: { projectId },
          order: { createdAt: 'DESC' },
        }),
      ]);

    // Programmes inserted without a calculation (seed, import, external write)
    // get their initial authoritative schedule computed on first read.
    if (tasks.length > 0 && tasks.every((t) => !t.computedStart)) {
      await this.recalculate(projectId, 'initial_calculation');
      const refreshed = await this.getSchedulePayload(projectId);
      return refreshed;
    }

    return {
      project: (await this.projects.findOne({ where: { id: projectId } })) ?? project,
      settings,
      tasks,
      dependencies: deps,
      calendars: calendars.map((c) => ({
        ...c,
        workingDays: calDays.filter((d) => d.calendarId === c.id),
        exceptions: calExceptions.filter((e) => e.calendarId === c.id),
      })),
      resources,
      assignments,
      baselines,
      scheduleVersion: (await this.projects.findOne({ where: { id: projectId } }))?.currentScheduleVersion ?? 0,
    };
  }

  async assertVersion(projectId: string, expected: number | undefined): Promise<ProjectEntity> {
    const project = await this.getProject(projectId);
    if (expected !== undefined && expected !== project.currentScheduleVersion) {
      throw new ScheduleVersionConflictException(project.currentScheduleVersion);
    }
    return project;
  }
}
