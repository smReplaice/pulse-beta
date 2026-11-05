import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('organizations')
export class OrganizationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', unique: true })
  slug: string;

  @Column({ type: 'text' })
  name: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('portfolios')
@Index(['organizationId'])
export class PortfolioEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('projects')
@Index(['organizationId'])
@Index(['portfolioId'])
export class ProjectEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'portfolio_id', type: 'uuid', nullable: true })
  portfolioId: string | null;

  @Column({ type: 'text', nullable: true })
  code: string | null;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** active | on_hold | completed | archived */
  @Column({ type: 'text', default: 'active' })
  status: string;

  @Column({ name: 'project_start', type: 'timestamp', nullable: true })
  projectStart: Date | null;

  @Column({ name: 'project_deadline', type: 'timestamp', nullable: true })
  projectDeadline: Date | null;

  @Column({ name: 'status_date', type: 'timestamp', nullable: true })
  statusDate: Date | null;

  @Column({ type: 'text', default: 'USD' })
  currency: string;

  @Column({ name: 'minutes_per_day', type: 'int', default: 480 })
  minutesPerDay: number;

  @Column({ name: 'minutes_per_week', type: 'int', default: 2400 })
  minutesPerWeek: number;

  @Column({ name: 'days_per_month', type: 'int', default: 20 })
  daysPerMonth: number;

  @Column({ name: 'current_schedule_version', type: 'int', default: 0 })
  currentScheduleVersion: number;

  /** Cached portfolio values, refreshed on recalculate */
  @Column({ name: 'computed_start', type: 'timestamp', nullable: true })
  computedStart: Date | null;

  @Column({ name: 'computed_finish', type: 'timestamp', nullable: true })
  computedFinish: Date | null;

  @Column({ name: 'computed_progress', type: 'float', nullable: true })
  computedProgress: number | null;

  @Column({ name: 'computed_critical_late', type: 'int', nullable: true })
  computedCriticalCount: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamp', nullable: true })
  updatedAt: Date | null;
}

@Entity('project_settings')
export class ProjectSettingsEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid', unique: true })
  projectId: string;

  /** start | finish */
  @Column({ name: 'scheduling_from', type: 'text', default: 'start' })
  schedulingFrom: string;

  @Column({ name: 'new_task_type', type: 'text', default: 'fixed_units' })
  newTaskType: string;

  @Column({ name: 'new_tasks_effort_driven', type: 'boolean', default: true })
  newTasksEffortDriven: boolean;

  @Column({ name: 'split_in_progress', type: 'boolean', default: true })
  splitInProgress: boolean;

  @Column({ name: 'autolink_inserted_tasks', type: 'boolean', default: true })
  autolinkInsertedTasks: boolean;

  @Column({ name: 'critical_slack_threshold_minutes', type: 'int', default: 0 })
  criticalSlackThresholdMinutes: number;

  @Column({ name: 'multiple_critical_paths', type: 'boolean', default: false })
  multipleCriticalPaths: boolean;

  @Column({ name: 'show_estimated_durations', type: 'boolean', default: false })
  showEstimatedDurations: boolean;

  @Column({ name: 'default_calendar_id', type: 'uuid', nullable: true })
  defaultCalendarId: string | null;
}
