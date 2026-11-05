import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('project_baselines')
@Index(['projectId'])
export class ProjectBaselineEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'is_current', type: 'boolean', default: false })
  isCurrent: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

/** Immutable snapshot of each task at baseline save time. */
@Entity('baseline_tasks')
@Index(['baselineId'])
export class BaselineTaskEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'baseline_id', type: 'uuid' })
  baselineId: string;

  @Column({ name: 'task_id', type: 'uuid' })
  taskId: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'timestamp' })
  start: Date;

  @Column({ type: 'timestamp' })
  finish: Date;

  @Column({ name: 'duration_minutes', type: 'int' })
  durationMinutes: number;

  @Column({ name: 'work_minutes', type: 'float' })
  workMinutes: number;

  @Column({ type: 'float' })
  cost: number;

  @Column({ name: 'percent_complete', type: 'float', default: 0 })
  percentComplete: number;
}

@Entity('progress_updates')
@Index(['projectId'])
@Index(['taskId'])
export class ProgressUpdateEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @Column({ name: 'task_id', type: 'uuid' })
  taskId: string;

  @Column({ name: 'as_of', type: 'timestamp' })
  asOf: Date;

  @Column({ name: 'percent_complete', type: 'float', nullable: true })
  percentComplete: number | null;

  @Column({ name: 'actual_start', type: 'timestamp', nullable: true })
  actualStart: Date | null;

  @Column({ name: 'actual_finish', type: 'timestamp', nullable: true })
  actualFinish: Date | null;

  @Column({ name: 'actual_work_minutes', type: 'float', nullable: true })
  actualWorkMinutes: number | null;

  @Column({ name: 'remaining_duration_minutes', type: 'int', nullable: true })
  remainingDurationMinutes: number | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'created_by', type: 'text', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('cost_entries')
@Index(['projectId'])
export class CostEntryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @Column({ name: 'task_id', type: 'uuid', nullable: true })
  taskId: string | null;

  @Column({ name: 'resource_id', type: 'uuid', nullable: true })
  resourceId: string | null;

  @Column({ type: 'timestamp' })
  date: Date;

  /** labour | equipment | material | subcontract | fixed | other */
  @Column({ type: 'text', default: 'other' })
  kind: string;

  @Column({ type: 'float' })
  amount: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;
}

@Entity('project_budgets')
@Index(['projectId'])
export class ProjectBudgetEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ name: 'total_amount', type: 'float' })
  totalAmount: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('schedule_versions')
@Index(['projectId'])
export class ScheduleVersionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @Column({ type: 'int' })
  version: number;

  /** task_update | dependency_change | assignment_change | recalculate | ai | import | leveling | baseline_restore */
  @Column({ type: 'text' })
  trigger: string;

  @Column({ type: 'simple-json', nullable: true })
  summary: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('schedule_calculation_runs')
@Index(['projectId'])
export class ScheduleCalculationRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @Column({ name: 'version_id', type: 'uuid' })
  versionId: string;

  @Column({ name: 'started_at', type: 'timestamp' })
  startedAt: Date;

  @Column({ name: 'finished_at', type: 'timestamp', nullable: true })
  finishedAt: Date | null;

  @Column({ name: 'task_count', type: 'int', default: 0 })
  taskCount: number;

  @Column({ name: 'changed_count', type: 'int', default: 0 })
  changedCount: number;

  @Column({ name: 'warning_count', type: 'int', default: 0 })
  warningCount: number;

  @Column({ type: 'simple-json', nullable: true })
  warnings: unknown[] | null;

  @Column({ name: 'duration_ms', type: 'int', default: 0 })
  durationMs: number;
}

@Entity('schedule_audit')
@Index(['projectId'])
export class ScheduleAuditEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @Column({ type: 'text' })
  entity: string;

  @Column({ name: 'entity_id', type: 'uuid', nullable: true })
  entityId: string | null;

  /** create | update | delete */
  @Column({ type: 'text' })
  action: string;

  @Column({ type: 'simple-json', nullable: true })
  before: Record<string, unknown> | null;

  @Column({ type: 'simple-json', nullable: true })
  after: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  actor: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('project_risks')
@Index(['projectId'])
export class ProjectRiskEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @Column({ type: 'text' })
  name: string;

  /** low | medium | high */
  @Column({ type: 'text', default: 'medium' })
  impact: string;

  /** low | medium | high */
  @Column({ type: 'text', default: 'medium' })
  probability: string;

  @Column({ type: 'text', nullable: true })
  mitigation: string | null;

  @Column({ name: 'related_task_id', type: 'uuid', nullable: true })
  relatedTaskId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('ai_action_logs')
@Index(['projectId'])
export class AiActionLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @Column({ name: 'user_prompt', type: 'text' })
  userPrompt: string;

  /** programme_creation | schedule_editor | scheduling_analyst | resource_planner | progress_analyst | construction_advisor */
  @Column({ type: 'text', nullable: true })
  agent: string | null;

  /** Proposed operation tree, executed through the normal APIs */
  @Column({ type: 'simple-json', nullable: true })
  action: Record<string, unknown> | null;

  @Column({ type: 'simple-json', nullable: true })
  before: Record<string, unknown> | null;

  @Column({ type: 'simple-json', nullable: true })
  after: Record<string, unknown> | null;

  @Column({ type: 'boolean', default: false })
  applied: boolean;

  @Column({ type: 'boolean', default: false })
  undone: boolean;

  @Column({ name: 'undo_token', type: 'text', nullable: true })
  undoToken: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
