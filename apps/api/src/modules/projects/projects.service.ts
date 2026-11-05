import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CalendarEntity,
  CalendarExceptionEntity,
  CalendarWorkingDayEntity,
  OrganizationEntity,
  PortfolioEntity,
  ProjectEntity,
  ProjectSettingsEntity,
} from '../../entities';
import { ScheduleService } from '../schedule/schedule.service';

const STANDARD_DAY = [
  { start: '08:00', end: '12:00' },
  { start: '13:00', end: '17:00' },
];

export class CreateProjectDto {
  name!: string;
  code?: string;
  description?: string;
  portfolioId?: string | null;
  projectStart?: string;
  projectDeadline?: string | null;
  currency?: string;
  minutesPerDay?: number;
  minutesPerWeek?: number;
  daysPerMonth?: number;
  newTaskType?: string;
  newTasksEffortDriven?: boolean;
  createSampleTasks?: boolean;
}

export class UpdateProjectDto {
  name?: string;
  code?: string | null;
  description?: string | null;
  status?: string;
  projectStart?: string | null;
  projectDeadline?: string | null;
  statusDate?: string | null;
  currency?: string;
  minutesPerDay?: number;
  minutesPerWeek?: number;
  daysPerMonth?: number;
}

export class UpdateSettingsDto {
  schedulingFrom?: string;
  newTaskType?: string;
  newTasksEffortDriven?: boolean;
  splitInProgress?: boolean;
  autolinkInsertedTasks?: boolean;
  criticalSlackThresholdMinutes?: number;
  multipleCriticalPaths?: boolean;
  showEstimatedDurations?: boolean;
  defaultCalendarId?: string | null;
}

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(OrganizationEntity) private readonly orgs: Repository<OrganizationEntity>,
    @InjectRepository(PortfolioEntity) private readonly portfolios: Repository<PortfolioEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(ProjectSettingsEntity) private readonly settings: Repository<ProjectSettingsEntity>,
    @InjectRepository(CalendarEntity) private readonly calendars: Repository<CalendarEntity>,
    @InjectRepository(CalendarWorkingDayEntity) private readonly calDays: Repository<CalendarWorkingDayEntity>,
    @InjectRepository(CalendarExceptionEntity) private readonly calExceptions: Repository<CalendarExceptionEntity>,
    private readonly scheduleService: ScheduleService,
  ) {}

  async ensureDefaultOrg(): Promise<OrganizationEntity> {
    let org = await this.orgs.findOne({ where: { slug: 'biltoflow' } });
    if (!org) {
      org = this.orgs.create({ slug: 'biltoflow', name: 'BiltFlow' });
      org = await this.orgs.save(org);
      await this.portfolios.save(
        this.portfolios.create({
          organizationId: org.id,
          name: 'Main Portfolio',
          description: 'Default portfolio',
        }),
      );
    }
    return org;
  }

  async createProject(dto: CreateProjectDto): Promise<ProjectEntity> {
    const org = await this.ensureDefaultOrg();
    const portfolioId =
      dto.portfolioId ??
      (await this.portfolios.findOne({ where: { organizationId: org.id } }))?.id ??
      null;

    const project = this.projects.create({
      organizationId: org.id,
      portfolioId,
      code: dto.code ?? null,
      name: dto.name,
      description: dto.description ?? null,
      projectStart: dto.projectStart ? new Date(dto.projectStart) : new Date(),
      projectDeadline: dto.projectDeadline ? new Date(dto.projectDeadline) : null,
      currency: dto.currency ?? 'USD',
      minutesPerDay: dto.minutesPerDay ?? 480,
      minutesPerWeek: dto.minutesPerWeek ?? 2400,
      daysPerMonth: dto.daysPerMonth ?? 20,
    });
    const saved = await this.projects.save(project);

    // Default "Standard" calendar (Mon–Fri, 8h)
    const calendar = this.calendars.create({
      organizationId: org.id,
      projectId: saved.id,
      name: 'Standard',
      isDefault: true,
    });
    const savedCal = await this.calendars.save(calendar);
    await this.calDays.insert(
      [1, 2, 3, 4, 5].map((dow) =>
        this.calDays.create({ calendarId: savedCal.id, dayOfWeek: dow, periods: STANDARD_DAY }),
      ),
    );

    await this.settings.insert(
      this.settings.create({
        projectId: saved.id,
        newTaskType: dto.newTaskType ?? 'fixed_units',
        newTasksEffortDriven: dto.newTasksEffortDriven ?? true,
        defaultCalendarId: savedCal.id,
      }),
    );

    return saved;
  }

  async listProjects(query: {
    search?: string;
    status?: string;
    sort?: string;
    order?: 'asc' | 'desc';
  }): Promise<ProjectEntity[]> {
    const qb = this.projects
      .createQueryBuilder('p')
      .leftJoinAndMapOne('p.portfolio', PortfolioEntity, 'pf', 'pf.id = p.portfolio_id');

    if (query.search) {
      qb.andWhere('(LOWER(p.name) LIKE :s OR LOWER(p.code) LIKE :s)', {
        s: `%${query.search.toLowerCase()}%`,
      });
    }
    if (query.status) {
      qb.andWhere('p.status = :status', { status: query.status });
    }
    const sortMap: Record<string, string> = {
      name: 'p.name',
      start: 'p.project_start',
      finish: 'p.computed_finish',
      progress: 'p.computed_progress',
      created: 'p.created_at',
    };
    qb.orderBy(sortMap[query.sort ?? 'created'] ?? 'p.created_at', query.order === 'desc' ? 'DESC' : 'ASC');

    return qb.getMany();
  }

  async getProject(id: string): Promise<ProjectEntity> {
    const project = await this.projects.findOne({ where: { id } });
    if (!project) throw new NotFoundException(`Project ${id} not found`);
    return project;
  }

  async updateProject(id: string, dto: UpdateProjectDto): Promise<ProjectEntity> {
    const project = await this.getProject(id);
    Object.assign(project, {
      ...dto,
      projectStart: dto.projectStart !== undefined ? (dto.projectStart ? new Date(dto.projectStart) : null) : project.projectStart,
      projectDeadline: dto.projectDeadline !== undefined ? (dto.projectDeadline ? new Date(dto.projectDeadline) : null) : project.projectDeadline,
      statusDate: dto.statusDate !== undefined ? (dto.statusDate ? new Date(dto.statusDate) : null) : project.statusDate,
      updatedAt: new Date(),
    });
    const saved = await this.projects.save(project);
    if (
      dto.projectStart !== undefined ||
      dto.projectDeadline !== undefined ||
      dto.statusDate !== undefined ||
      dto.minutesPerDay !== undefined ||
      dto.minutesPerWeek !== undefined ||
      dto.daysPerMonth !== undefined
    ) {
      await this.scheduleService.recalculate(id, 'project_update');
      return (await this.projects.findOne({ where: { id } })) ?? saved;
    }
    return saved;
  }

  async updateSettings(projectId: string, dto: UpdateSettingsDto): Promise<ProjectSettingsEntity> {
    await this.getProject(projectId);
    const settings = await this.scheduleService.getSettings(projectId);
    Object.assign(settings, dto);
    const saved = await this.settings.save(settings);
    await this.scheduleService.recalculate(projectId, 'settings_update');
    return saved;
  }

  async listPortfolios(): Promise<PortfolioEntity[]> {
    const org = await this.ensureDefaultOrg();
    return this.portfolios.find({ where: { organizationId: org.id } });
  }

  async createPortfolio(name: string, description?: string): Promise<PortfolioEntity> {
    const org = await this.ensureDefaultOrg();
    return this.portfolios.save(
      this.portfolios.create({ organizationId: org.id, name, description: description ?? null }),
    );
  }

  async deleteProject(id: string): Promise<void> {
    const project = await this.getProject(id);
    await this.projects.remove(project);
  }
}
