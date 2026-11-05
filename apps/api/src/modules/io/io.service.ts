import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CalendarEntity,
  CalendarExceptionEntity,
  CalendarWorkingDayEntity,
  ResourceAssignmentEntity,
  ResourceEntity,
  TaskDependencyEntity,
  TaskEntity,
} from '../../entities';
import { ScheduleService } from '../schedule/schedule.service';
import { ProjectsService } from '../projects/projects.service';

interface ImportedTask {
  name: string;
  durationDays?: number;
  durationMinutes?: number;
  outlineLevel?: number;
  milestone?: boolean;
  predecessors?: string; // "3FS+2, 5SS" like MS Project
  resources?: string;
  percentComplete?: number;
}

interface ImportPayload {
  name?: string;
  projectStart?: string;
  tasks: ImportedTask[];
}

@Injectable()
export class IoService {
  constructor(
    @InjectRepository(TaskEntity) private readonly tasks: Repository<TaskEntity>,
    @InjectRepository(TaskDependencyEntity) private readonly deps: Repository<TaskDependencyEntity>,
    @InjectRepository(ResourceEntity) private readonly resources: Repository<ResourceEntity>,
    @InjectRepository(ResourceAssignmentEntity) private readonly assignments: Repository<ResourceAssignmentEntity>,
    @InjectRepository(CalendarEntity) private readonly calendars: Repository<CalendarEntity>,
    @InjectRepository(CalendarWorkingDayEntity) private readonly calDays: Repository<CalendarWorkingDayEntity>,
    @InjectRepository(CalendarExceptionEntity) private readonly calExceptions: Repository<CalendarExceptionEntity>,
    private readonly scheduleService: ScheduleService,
    private readonly projectsService: ProjectsService,
  ) {}

  /** POST /api/projects/import — import an existing programme (JSON or CSV payload) */
  async import(dto: { format?: 'json' | 'csv'; csv?: string; payload?: ImportPayload; portfolioId?: string | null }) {
    let payload: ImportPayload;
    if (dto.format === 'csv' || dto.csv) {
      payload = { tasks: this.parseCsv(dto.csv ?? '') };
    } else if (dto.payload) {
      payload = dto.payload;
    } else {
      throw new BadRequestException('Provide csv text or a json payload');
    }
    if (!payload.tasks || payload.tasks.length === 0) {
      throw new BadRequestException('No tasks to import');
    }

    const project = await this.projectsService.createProject({
      name: payload.name ?? `Imported programme ${new Date().toISOString().slice(0, 10)}`,
      projectStart: payload.projectStart,
      portfolioId: dto.portfolioId ?? null,
    });

    // Create tasks in order, tracking display index for predecessor references
    const idByIndex: string[] = [];
    let order = 1000;
    let prevAtLevel = new Map<number, string>();
    for (const t of payload.tasks) {
      const level = t.outlineLevel ?? 0;
      const task = await this.tasks.save(
        this.tasks.create({
          projectId: project.id,
          rowOrder: order,
          outlineLevel: level,
          name: t.name,
          durationMinutes: t.milestone ? 0 : (t.durationMinutes ?? (t.durationDays ?? 1) * 480),
          percentComplete: t.percentComplete ?? 0,
        }),
      );
      idByIndex.push(task.id);
      prevAtLevel.set(level, task.id);
      order += 1000;
    }

    // Dependencies reference rows by 1-based display index
    for (let i = 0; i < payload.tasks.length; i++) {
      const predSpec = payload.tasks[i].predecessors?.trim();
      if (!predSpec) continue;
      for (const part of predSpec.split(/[;,]/)) {
        const m = /^(\d+)(FS|SS|FF|SF)?([+-]\d+(?:\.\d+)?)?d?$/i.exec(part.trim());
        if (!m) continue;
        const idx = Number(m[1]);
        if (idx < 1 || idx > idByIndex.length || idx === i + 1) continue;
        const type = (m[2] ?? 'FS').toUpperCase() as 'FS' | 'SS' | 'FF' | 'SF';
        const lagDays = m[3] ? Math.round(parseFloat(m[3]) * 480) : 0;
        await this.deps.save(
          this.deps.create({
            projectId: project.id,
            predecessorId: idByIndex[idx - 1],
            successorId: idByIndex[i],
            type,
            lagMinutes: lagDays,
          }),
        );
      }
    }

    const recalc = await this.scheduleService.recalculate(project.id, 'import');
    return {
      project,
      importedTasks: payload.tasks.length,
      scheduleVersion: recalc.scheduleVersion,
      warnings: recalc.warnings,
    };
  }

  private parseCsv(csv: string): ImportedTask[] {
    const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return [];
    const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const idx = (name: string) => header.findIndex((h) => h === name);
    const iName = idx('name') >= 0 ? idx('name') : idx('task') >= 0 ? idx('task') : 0;
    const iDur = idx('duration');
    const iOutline = idx('outline level') >= 0 ? idx('outline level') : idx('level');
    const iPred = idx('predecessors') >= 0 ? idx('predecessors') : idx('predecessor');
    const iRes = idx('resources') >= 0 ? idx('resources') : idx('resource names');
    const iPct = idx('percent complete') >= 0 ? idx('percent complete') : idx('% complete');
    const out: ImportedTask[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(',').map((c) => c.trim());
      const name = cells[iName];
      if (!name) continue;
      out.push({
        name,
        durationDays: iDur >= 0 ? Number(cells[iDur]) || 1 : 1,
        outlineLevel: iOutline >= 0 ? Number(cells[iOutline]) || 0 : 0,
        predecessors: iPred >= 0 ? cells[iPred] : undefined,
        resources: iRes >= 0 ? cells[iRes] : undefined,
        percentComplete: iPct >= 0 ? Number(cells[iPct]) || 0 : 0,
      });
    }
    return out;
  }

  /** GET /api/projects/:id/export — JSON programme export */
  async export(projectId: string, format: 'json' | 'csv' = 'json') {
    const [project, settings, tasks, deps, resources, assignments] = await Promise.all([
      this.scheduleService.getProject(projectId),
      this.scheduleService.getSettings(projectId),
      this.tasks.find({ where: { projectId }, order: { rowOrder: 'ASC' } }),
      this.deps.find({ where: { projectId } }),
      this.resources.find({ where: { projectId } }),
      this.assignments.find({ where: { projectId } }),
    ]);
    if (format === 'csv') {
      const header = 'ID,Outline Level,Name,Duration,Start,Finish,Predecessors,Resources,Percent Complete,Total Float,Critical';
      const dur = (m: number | null) => (m == null ? '' : `${Math.round((m / 480) * 10) / 10} d`);
      const rows = tasks.map((t, i) => {
        const preds = deps
          .filter((d) => d.successorId === t.id)
          .map((d) => {
            const pIdx = tasks.findIndex((x) => x.id === d.predecessorId) + 1;
            return `${pIdx}${d.type}${d.lagMinutes ? `${d.lagMinutes > 0 ? '+' : ''}${Math.round((d.lagMinutes / 480) * 10) / 10}d` : ''}`;
          })
          .join(';');
        const res = resources
          .filter((r) => assignments.some((a) => a.taskId === t.id && a.resourceId === r.id))
          .map((r) => r.name)
          .join(', ');
        return [
          i + 1,
          t.outlineLevel,
          `"${t.name.replace(/"/g, '""')}"`,
          dur(t.computedDuration ?? t.durationMinutes),
          t.computedStart?.toISOString().slice(0, 10) ?? '',
          t.computedFinish?.toISOString().slice(0, 10) ?? '',
          preds,
          `"${res}"`,
          t.computedPercentComplete ?? t.percentComplete,
          t.computedTotalFloat != null ? Math.round(t.computedTotalFloat / 480) : '',
          t.computedIsCritical ? 'Yes' : 'No',
        ].join(',');
      });
      return { format: 'csv', body: [header, ...rows].join('\n') };
    }
    return {
      format: 'biltoflow-pulse',
      version: 1,
      project,
      settings,
      tasks,
      dependencies: deps,
      resources,
      assignments,
    };
  }

  /** GET /api/templates — construction programme templates */
  templates() {
    return [
      {
        key: 'residential-20',
        name: 'Residential apartment building (20 storeys)',
        description: 'Excavation, foundations, structure, façade, MEP, fit-out, inspections, handover',
        weeks: 96,
        generator: 'residential',
      },
      {
        key: 'commercial-fitout',
        name: 'Commercial fit-out',
        description: 'Mobilisation, strip-out, M&E, partitions, finishes, furniture, handover',
        weeks: 20,
        generator: 'fitout',
      },
      {
        key: 'infrastructure-road',
        name: 'Infrastructure — road corridor',
        description: 'Surveys, earthworks, drainage, subbase, surfacing, line marking, handover',
        weeks: 52,
        generator: 'road',
      },
    ];
  }

  async instantiateTemplate(projectId: string, key: string) {
    const built = this.buildTemplate(key);
    const created: string[] = [];
    let order = 1000;
    for (const t of built.tasks) {
      const saved = await this.tasks.save(
        this.tasks.create({
          projectId,
          rowOrder: order,
          outlineLevel: t.outlineLevel,
          name: t.name,
          durationMinutes: t.durationMinutes,
          stage: t.stage ?? null,
          trade: t.trade ?? null,
          isProcurement: t.isProcurement ?? false,
          isApproval: t.isApproval ?? false,
          isInspection: t.isInspection ?? false,
        }),
      );
      created.push(saved.id);
      order += 1000;
    }
    for (const [succIdx, predIdx, type, lag] of built.links) {
      await this.deps.save(
        this.deps.create({
          projectId,
          predecessorId: created[predIdx],
          successorId: created[succIdx],
          type: type ?? 'FS',
          lagMinutes: lag ?? 0,
        }),
      );
    }
    const recalc = await this.scheduleService.recalculate(projectId, 'template');
    return {
      projectId,
      tasksCreated: created.length,
      scheduleVersion: recalc.scheduleVersion,
      warnings: recalc.warnings,
    };
  }

  private buildTemplate(key: string): {
    tasks: {
      name: string;
      outlineLevel: number;
      durationMinutes: number;
      stage?: string;
      trade?: string;
      isProcurement?: boolean;
      isApproval?: boolean;
      isInspection?: boolean;
    }[];
    links: [number, number, string?, number?][];
  } {
    const d = (days: number) => days * 480;
    if (key === 'commercial-fitout') {
      return {
        tasks: [
          { name: 'Fit-out programme', outlineLevel: 0, durationMinutes: d(0), stage: 'Summary' },
          { name: 'Mobilisation', outlineLevel: 1, durationMinutes: d(5), stage: 'Pre-construction' },
          { name: 'Strip-out & demolition', outlineLevel: 1, durationMinutes: d(10), stage: 'Strip-out' },
          { name: 'M&E first fix', outlineLevel: 1, durationMinutes: d(20), trade: 'MEP' },
          { name: 'Partitions & ceilings', outlineLevel: 1, durationMinutes: d(25), trade: 'Drywall' },
          { name: 'M&E second fix', outlineLevel: 1, durationMinutes: d(20), trade: 'MEP' },
          { name: 'Flooring & finishes', outlineLevel: 1, durationMinutes: d(15), trade: 'Finishes' },
          { name: 'Furniture & equipment', outlineLevel: 1, durationMinutes: d(10), isProcurement: true },
          { name: 'Testing & commissioning', outlineLevel: 1, durationMinutes: d(8), isInspection: true },
          { name: 'Snagging & handover', outlineLevel: 1, durationMinutes: 0 },
        ],
        links: [
          [1, 0], [2, 1], [3, 2], [4, 3], [5, 4], [6, 5], [7, 6], [8, 7], [9, 8],
        ],
      };
    }
    if (key === 'infrastructure-road') {
      return {
        tasks: [
          { name: 'Road corridor works', outlineLevel: 0, durationMinutes: d(0) },
          { name: 'Surveys & approvals', outlineLevel: 1, durationMinutes: d(15), isApproval: true },
          { name: 'Earthworks', outlineLevel: 1, durationMinutes: d(40), trade: 'Civils' },
          { name: 'Drainage & utilities', outlineLevel: 1, durationMinutes: d(35), trade: 'Civils' },
          { name: 'Subbase construction', outlineLevel: 1, durationMinutes: d(25), trade: 'Paving' },
          { name: 'Surfacing', outlineLevel: 1, durationMinutes: d(15), trade: 'Paving' },
          { name: 'Line marking & signage', outlineLevel: 1, durationMinutes: d(8) },
          { name: 'Final inspection & handover', outlineLevel: 1, durationMinutes: 0, isInspection: true },
        ],
        links: [[1, 0], [2, 1], [3, 2], [4, 3], [5, 4], [6, 5], [7, 6]],
      };
    }
    // Default: residential 20 storeys
    return {
      tasks: [
        { name: 'Residential tower — 20 storeys', outlineLevel: 0, durationMinutes: d(0) },
        { name: 'Design & approvals', outlineLevel: 1, durationMinutes: d(60), stage: 'Pre-construction', isApproval: true },
        { name: 'Procure long-lead items', outlineLevel: 1, durationMinutes: d(40), isProcurement: true },
        { name: 'Excavation', outlineLevel: 1, durationMinutes: d(25), stage: 'Substructure', trade: 'Earthworks' },
        { name: 'Foundations & raft', outlineLevel: 1, durationMinutes: d(40), stage: 'Substructure', trade: 'Concrete' },
        { name: 'Structural frame', outlineLevel: 1, durationMinutes: d(120), stage: 'Superstructure', trade: 'Concrete' },
        { name: 'Façade', outlineLevel: 1, durationMinutes: d(90), stage: 'Envelope', trade: 'Façade' },
        { name: 'MEP works', outlineLevel: 1, durationMinutes: d(110), stage: 'MEP', trade: 'MEP' },
        { name: 'Fit-out', outlineLevel: 1, durationMinutes: d(80), stage: 'Fit-out', trade: 'Finishes' },
        { name: 'Inspections & commissioning', outlineLevel: 1, durationMinutes: d(20), isInspection: true },
        { name: 'Handover', outlineLevel: 1, durationMinutes: 0 },
      ],
      links: [
        [1, 0], [2, 1], [3, 1], [4, 3], [5, 4], [6, 5, 'FS', 20 * 480], [7, 5, 'FS', 40 * 480],
        [8, 6], [8, 7], [9, 8], [10, 9],
      ],
    };
  }
}
