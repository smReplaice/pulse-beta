import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException, GoneException, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createHash, randomUUID } from 'crypto';
import { buildHierarchy, topoSortLeaves } from '@pulse/engine';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  BaselineTaskEntity,
  CalendarEntity,
  CalendarExceptionEntity,
  CalendarWorkingDayEntity,
  MsProjectImportJobEntity,
  ProjectBaselineEntity,
  ProjectEntity,
  ProjectSettingsEntity,
  ResourceAssignmentEntity,
  ResourceEntity,
  TaskDependencyEntity,
  TaskEntity,
} from '../../entities';
import { MsProjectModel, parseMspdi } from './msdi-parser';
import { ValidationError, mapModel, summarise, wbsPreview } from './mapper';
import { converterClient } from './converter.client';

export interface AnalyzeResult {
  token: string;
  filename: string;
  format: 'xml' | 'mpp';
  sizeBytes: number;
  sha256: string;
  expiresAt: string;
  project: { name: string; start: string | null; hoursPerDay: number };
  counts: ReturnType<typeof summarise>;
  wbsPreview: string[];
  errors: ValidationError[];
  warnings: string[];
  options: { preserveDates: boolean };
}

interface StagedImport {
  result: AnalyzeResult;
  model: MsProjectModel;
  planned: ReturnType<typeof mapModel>['planned'];
  createdAt: number;
  consumed: boolean;
}

const STAGE_TTL_MS = 30 * 60 * 1000; // preview expiry: 30 minutes
const MAX_UPLOAD_BYTES = Number(process.env.MSPROJECT_MAX_UPLOAD_BYTES ?? 26 * 1024 * 1024);

@Injectable()
export class MsProjectImporterService {
  private readonly logger = new Logger('MsProjectImporter');
  private readonly staged = new Map<string, StagedImport>();

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(MsProjectImportJobEntity) private readonly importJobs: Repository<MsProjectImportJobEntity>,
  ) {}

  // --------------------------------------------------------------- analyze

  async analyze(file: { originalname: string; buffer: Buffer; size: number }): Promise<AnalyzeResult> {
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(`File exceeds the ${Math.round(MAX_UPLOAD_BYTES / 1048576)} MB import limit.`);
    }
    const isMpp = /\.mpp$/i.test(file.originalname);
    const isXml = /\.xml$/i.test(file.originalname);

    let xml: string;
    let format: 'xml' | 'mpp';
    if (isMpp) {
      // signature check: classic MPP is an OLE2 compound document
      const { isCompoundFile } = await import('./msdi-parser');
      if (!isCompoundFile(file.buffer)) {
        throw new BadRequestException('This .mpp file does not have the expected Microsoft Project binary signature — it may be corrupted, encrypted or not an MPP file.');
      }
      const converted = await converterClient.convert(file.buffer, file.originalname);
      xml = converted.xml;
      format = 'mpp';
    } else if (isXml || true) {
      const { looksLikeXml } = await import('./msdi-parser');
      if (!looksLikeXml(file.buffer)) {
        if (file.buffer.length > 8 && file.buffer[0] === 0xd0 && file.buffer[1] === 0xcf) {
          throw new BadRequestException('This looks like a binary Microsoft Project (.mpp) file — please import it with the .mpp option.');
        }
        throw new BadRequestException('Unsupported file: expected a Microsoft Project XML (.xml) or binary (.mpp) file.');
      }
      xml = file.buffer.toString('utf8');
      format = 'xml';
    } else {
      throw new BadRequestException('Unsupported file extension. Use .xml (MS Project XML) or .mpp.');
    }

    const warnings: string[] = [];
    const model = parseMspdi(xml, warnings);
    if (model.tasks.length === 0) {
      throw new BadRequestException('The file contains no tasks — nothing to import.');
    }

    const preserveDates = true;
    const { planned, errors, warnings: mapWarnings } = mapModel(model, { preserveDates });
    warnings.push(...mapWarnings);

    // dependency cycle validation through the same engine used everywhere
    try {
      const graph = buildHierarchy(
        planned.tasks.map((t) => ({
          id: t.localId,
          name: t.name,
          rowOrder: t.rowOrder,
          outlineLevel: t.outlineLevel,
          durationMinutes: t.durationMinutes,
          durationMode: 'working' as const,
          mode: 'auto' as const,
          taskType: 'fixed_units' as const,
          effortDriven: false,
          percentComplete: 0,
          constraint: null,
          calendarId: null,
          priority: 500,
          levelingDelayMinutes: 0,
          active: true,
          manualStart: null,
          manualFinish: null,
          fixedCost: 0,
          fixedCostAccrual: 'prorated' as const,
          actualStart: null,
          actualFinish: null,
          actualWorkMinutes: 0,
          actualCost: null,
          deadline: null,
        })),
      );
      topoSortLeaves(
        graph,
        planned.dependencies.map((d) => ({
          id: d.localId,
          predecessorId: d.predecessorLocalId,
          successorId: d.successorLocalId,
          type: 'FS' as const,
          lagMinutes: 0,
        })),
      );
    } catch (e) {
      errors.push({ code: 'CIRCULAR_DEPENDENCY', message: e instanceof Error ? e.message : String(e) });
    }

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const token = randomUUID();
    const counts = summarise(planned);
    const result: AnalyzeResult = {
      token,
      filename: file.originalname,
      format,
      sizeBytes: file.size,
      sha256,
      expiresAt: new Date(Date.now() + STAGE_TTL_MS).toISOString(),
      project: {
        name: model.name ?? planned.project.name,
        start: planned.project.projectStart,
        hoursPerDay: model.hoursPerDay,
      },
      counts: {
        ...counts,
        hierarchyPreview: counts.hierarchyPreview,
      },
      wbsPreview: wbsPreview(planned).slice(0, 25),
      errors,
      warnings,
      options: { preserveDates },
    };

    this.staged.set(token, { result, model, planned, createdAt: Date.now(), consumed: false });
    this.cleanupExpired();
    return result;
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [token, s] of this.staged) {
      if (now - s.createdAt > STAGE_TTL_MS) this.staged.delete(token);
    }
  }

  // --------------------------------------------------------------- commit

  async commit(principal: { organizationId: string }, token: string, opts: { preserveDates?: boolean }): Promise<{ projectId: string; name: string }> {
    const staged = this.staged.get(token);
    if (!staged || Date.now() - staged.createdAt > STAGE_TTL_MS) {
      throw new GoneException('This import preview has expired or is unknown. Please analyze the file again.');
    }
    if (staged.consumed) {
      throw new ConflictException('This import has already been confirmed. Re-analyze the file to import it again.');
    }
    if (staged.result.errors.length > 0) {
      throw new BadRequestException('The file failed validation; fix the reported errors and re-analyze.');
    }
    // the confirmation must match the analyzed options — no silent re-mapping
    if ((opts.preserveDates ?? staged.result.options.preserveDates) !== staged.result.options.preserveDates) {
      throw new BadRequestException('The selected options differ from the analyzed preview. Re-analyze with the new options.');
    }

    const { planned } = staged;
    const org = principal.organizationId;

    const run = await this.dataSource.transaction(async (em) => {
      const project = em.create(ProjectEntity, {
        organizationId: org,
        portfolioId: null,
        code: null,
        name: planned.project.name,
        description: `Imported from Microsoft Project (${staged.result.format.toUpperCase()}): ${staged.result.filename}`,
        projectStart: new Date(planned.project.projectStart),
        currency: planned.project.currency,
        minutesPerDay: planned.project.minutesPerDay,
        minutesPerWeek: planned.project.minutesPerWeek,
        daysPerMonth: planned.project.daysPerMonth,
      });
      await em.insert(ProjectEntity, project);

      // calendars
      const calIdByLocal = new Map<string, string>();
      for (const c of planned.calendars) {
        const cal = em.create(CalendarEntity, {
          organizationId: org,
          projectId: project.id,
          name: c.name,
          isDefault: c.isDefault,
        });
        await em.insert(CalendarEntity, cal);
        calIdByLocal.set(c.localId, cal.id);
        for (const [dow, periods] of Object.entries(c.week)) {
          await em.insert(
            CalendarWorkingDayEntity,
            em.create(CalendarWorkingDayEntity, { calendarId: cal.id, dayOfWeek: Number(dow), periods }),
          );
        }
        for (const ex of c.exceptions) {
          await em.insert(
            CalendarExceptionEntity,
            em.create(CalendarExceptionEntity, { calendarId: cal.id, date: ex.date, periods: ex.periods, label: ex.label }),
          );
        }
      }
      const defaultCalId =
        (planned.calendars.find((c) => c.isDefault) && calIdByLocal.get(planned.calendars.find((c) => c.isDefault)!.localId)) ??
        [...calIdByLocal.values()][0] ??
        null;

      await em.insert(
        ProjectSettingsEntity,
        em.create(ProjectSettingsEntity, { projectId: project.id, defaultCalendarId: defaultCalId }),
      );

      // tasks
      const taskIdByLocal = new Map<string, string>();
      for (const t of planned.tasks) {
        const entity = em.create(TaskEntity, {
          projectId: project.id,
          rowOrder: t.rowOrder,
          outlineLevel: t.outlineLevel,
          name: t.name,
          durationMinutes: t.durationMinutes,
          mode: t.mode,
          manualStart: t.manualStart ? new Date(t.manualStart) : null,
          manualFinish: t.manualFinish ? new Date(t.manualFinish) : null,
          constraintType: t.constraintType,
          constraintDate: t.constraintDate ? new Date(t.constraintDate) : null,
          deadline: t.deadline ? new Date(t.deadline) : null,
          taskType: t.taskType,
          effortDriven: t.effortDriven,
          percentComplete: t.percentComplete,
          actualStart: t.actualStart ? new Date(t.actualStart) : null,
          actualFinish: t.actualFinish ? new Date(t.actualFinish) : null,
          actualWorkMinutes: t.actualWorkMinutes,
          fixedCost: t.fixedCost,
          priority: t.priority,
          notes: t.notes,
          calendarId: t.calendarLocalId ? calIdByLocal.get(t.calendarLocalId) ?? null : null,
          externalReferenceId: `msp:task-uid:${t.sourceUid}`,
          wbs: null,
        });
        await em.insert(TaskEntity, entity);
        taskIdByLocal.set(t.localId, entity.id);
      }

      // dependencies (already UID-resolved + cycle-validated in analyze)
      for (const d of planned.dependencies) {
        await em.insert(
          TaskDependencyEntity,
          em.create(TaskDependencyEntity, {
            projectId: project.id,
            predecessorId: taskIdByLocal.get(d.predecessorLocalId)!,
            successorId: taskIdByLocal.get(d.successorLocalId)!,
            type: d.type,
            lagMinutes: d.lagMinutes,
          }),
        );
      }

      // resources + assignments
      const resIdByLocal = new Map<string, string>();
      for (const r of planned.resources) {
        const entity = em.create(ResourceEntity, {
          organizationId: org,
          projectId: project.id,
          kind: r.kind,
          name: r.name,
          maxUnits: r.maxUnits,
          standardRate: r.standardRate,
          costPerUse: r.costPerUse,
          notes: r.notes,
          calendarId: r.calendarLocalId ? calIdByLocal.get(r.calendarLocalId) ?? null : null,
          externalReferenceId: `msp:resource-uid:${r.sourceUid}`,
        });
        await em.insert(ResourceEntity, entity);
        resIdByLocal.set(r.localId, entity.id);
      }
      for (const a of planned.assignments) {
        await em.insert(
          ResourceAssignmentEntity,
          em.create(ResourceAssignmentEntity, {
            projectId: project.id,
            taskId: taskIdByLocal.get(a.taskLocalId)!,
            resourceId: resIdByLocal.get(a.resourceLocalId)!,
            units: a.units,
            workMinutes: a.workMinutes,
            cost: a.cost,
          }),
        );
      }

      // baselines
      for (const b of planned.baselines) {
        const baseline = em.create(ProjectBaselineEntity, {
          projectId: project.id,
          name: b.name,
          isCurrent: b.name === 'Imported Baseline',
        });
        await em.insert(ProjectBaselineEntity, baseline);
        for (const row of b.tasks) {
          await em.insert(
            BaselineTaskEntity,
            em.create(BaselineTaskEntity, {
              baselineId: baseline.id,
              taskId: taskIdByLocal.get(row.taskLocalId)!,
              name: row.taskName,
              start: new Date(row.start),
              finish: new Date(row.finish),
              durationMinutes: row.durationMinutes,
              workMinutes: row.workMinutes,
              cost: row.cost,
              percentComplete: row.percentComplete,
            }),
          );
        }
      }

      // import job record — source UIDs, hashes and metadata for traceability
      await em.insert(
        MsProjectImportJobEntity,
        em.create(MsProjectImportJobEntity, {
          projectId: project.id,
          organizationId: org,
          filename: staged.result.filename,
          format: staged.result.format,
          sizeBytes: staged.result.sizeBytes,
          sha256: staged.result.sha256,
          status: 'imported',
          options: staged.result.options,
          taskCount: planned.tasks.length,
          dependencyCount: planned.dependencies.length,
          resourceCount: planned.resources.length,
          assignmentCount: planned.assignments.length,
          warnings: staged.result.warnings,
          createdBy: 'api',
        }) as never,
      );

      return { projectId: project.id, name: project.name };
    });

    staged.consumed = true;
    this.logger.log(`Imported "${staged.result.filename}" as project ${run.projectId}`);
    return run;
  }

  async listJobs(principal: { organizationId: string }): Promise<MsProjectImportJobEntity[]> {
    return this.importJobs.find({ where: { organizationId: principal.organizationId }, order: { createdAt: 'DESC' }, take: 50 });
  }

  async recomputeFirstSchedule(projectId: string, recalc: (id: string) => Promise<unknown>): Promise<void> {
    // Engine rollups (summary dates, WBS) — an explicit operation, documented.
    await recalc(projectId);
  }
}

export { ServiceUnavailableException };
