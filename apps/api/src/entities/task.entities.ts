import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Tasks are the programme's core records. The `id` is a stable UUID — display
 * order is `rowOrder` (a double so rows can be inserted between others without
 * renumbering), and hierarchy is `outlineLevel`.
 *
 * Computed scheduling results are cached in `computed_*` columns by the
 * scheduling engine after each recalculation; the engine output is always
 * authoritative and these columns are never edited directly.
 */
@Entity('tasks')
@Index(['projectId'])
@Index(['projectId', 'rowOrder'])
export class TaskEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @Column({ name: 'row_order', type: 'float' })
  rowOrder: number;

  @Column({ name: 'outline_level', type: 'int', default: 0 })
  outlineLevel: number;

  @Column({ type: 'text' })
  name: string;

  @Column({ name: 'duration_minutes', type: 'int', default: 480 })
  durationMinutes: number;

  /** working | elapsed */
  @Column({ name: 'duration_mode', type: 'text', default: 'working' })
  durationMode: string;

  /** auto | manual */
  @Column({ type: 'text', default: 'auto' })
  mode: string;

  /** fixed_units | fixed_duration | fixed_work */
  @Column({ name: 'task_type', type: 'text', default: 'fixed_units' })
  taskType: string;

  @Column({ name: 'effort_driven', type: 'boolean', default: false })
  effortDriven: boolean;

  @Column({ name: 'percent_complete', type: 'float', default: 0 })
  percentComplete: number;

  /** ASAP | ALAP | SNET | SNLT | FNET | FNLT | MSO | MFO */
  @Column({ name: 'constraint_type', type: 'text', default: 'ASAP', nullable: true })
  constraintType: string | null;

  @Column({ name: 'constraint_date', type: 'timestamp', nullable: true })
  constraintDate: Date | null;

  @Column({ name: 'deadline', type: 'timestamp', nullable: true })
  deadline: Date | null;

  @Column({ name: 'calendar_id', type: 'uuid', nullable: true })
  calendarId: string | null;

  @Column({ type: 'int', default: 500 })
  priority: number;

  @Column({ name: 'leveling_delay_minutes', type: 'int', default: 0 })
  levelingDelayMinutes: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ name: 'manual_start', type: 'timestamp', nullable: true })
  manualStart: Date | null;

  @Column({ name: 'manual_finish', type: 'timestamp', nullable: true })
  manualFinish: Date | null;

  @Column({ name: 'fixed_cost', type: 'float', default: 0 })
  fixedCost: number;

  /** start | prorated | end */
  @Column({ name: 'fixed_cost_accrual', type: 'text', default: 'prorated' })
  fixedCostAccrual: string;

  // ---- actuals ----
  @Column({ name: 'actual_start', type: 'timestamp', nullable: true })
  actualStart: Date | null;

  @Column({ name: 'actual_finish', type: 'timestamp', nullable: true })
  actualFinish: Date | null;

  @Column({ name: 'actual_work_minutes', type: 'int', default: 0 })
  actualWorkMinutes: number;

  @Column({ name: 'actual_cost', type: 'float', nullable: true })
  actualCost: number | null;

  // ---- construction extensions ----
  @Column({ type: 'text', nullable: true })
  stage: string | null;

  @Column({ type: 'text', nullable: true })
  trade: string | null;

  @Column({ type: 'text', nullable: true })
  location: string | null;

  @Column({ name: 'package_id', type: 'uuid', nullable: true })
  packageId: string | null;

  @Column({ name: 'external_reference_id', type: 'text', nullable: true })
  externalReferenceId: string | null;

  @Column({ name: 'required_on_site', type: 'timestamp', nullable: true })
  requiredOnSite: Date | null;

  @Column({ name: 'delay_reason', type: 'text', nullable: true })
  delayReason: string | null;

  @Column({ name: 'extension_of_time', type: 'boolean', default: false })
  extensionOfTime: boolean;

  @Column({ name: 'is_procurement', type: 'boolean', default: false })
  isProcurement: boolean;

  @Column({ name: 'is_approval', type: 'boolean', default: false })
  isApproval: boolean;

  @Column({ name: 'is_inspection', type: 'boolean', default: false })
  isInspection: boolean;

  // ---- cached engine output (never edited directly) ----
  @Column({ name: 'computed_start', type: 'timestamp', nullable: true })
  computedStart: Date | null;

  @Column({ name: 'computed_finish', type: 'timestamp', nullable: true })
  computedFinish: Date | null;

  @Column({ name: 'computed_early_start', type: 'timestamp', nullable: true })
  computedEarlyStart: Date | null;

  @Column({ name: 'computed_early_finish', type: 'timestamp', nullable: true })
  computedEarlyFinish: Date | null;

  @Column({ name: 'computed_late_start', type: 'timestamp', nullable: true })
  computedLateStart: Date | null;

  @Column({ name: 'computed_late_finish', type: 'timestamp', nullable: true })
  computedLateFinish: Date | null;

  @Column({ name: 'computed_total_float', type: 'int', nullable: true })
  computedTotalFloat: number | null;

  @Column({ name: 'computed_free_float', type: 'int', nullable: true })
  computedFreeFloat: number | null;

  @Column({ name: 'computed_is_critical', type: 'boolean', default: false })
  computedIsCritical: boolean;

  @Column({ name: 'computed_is_summary', type: 'boolean', default: false })
  computedIsSummary: boolean;

  @Column({ name: 'computed_is_milestone', type: 'boolean', default: false })
  computedIsMilestone: boolean;

  @Column({ name: 'computed_duration', type: 'int', nullable: true })
  computedDuration: number | null;

  @Column({ name: 'computed_work', type: 'float', nullable: true })
  computedWork: number | null;

  @Column({ name: 'computed_percent_complete', type: 'float', nullable: true })
  computedPercentComplete: number | null;

  @Column({ name: 'computed_planned_cost', type: 'float', nullable: true })
  computedPlannedCost: number | null;

  @Column({ name: 'computed_actual_cost', type: 'float', nullable: true })
  computedActualCost: number | null;

  @Column({ type: 'text', nullable: true })
  wbs: string | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

@Entity('task_dependencies')
@Index(['projectId'])
@Index(['predecessorId'])
@Index(['successorId'])
export class TaskDependencyEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @Column({ name: 'predecessor_id', type: 'uuid' })
  predecessorId: string;

  @Column({ name: 'successor_id', type: 'uuid' })
  successorId: string;

  /** FS | SS | FF | SF */
  @Column({ type: 'text', default: 'FS' })
  type: string;

  @Column({ name: 'lag_minutes', type: 'int', default: 0 })
  lagMinutes: number;
}

@Entity('task_splits')
@Index(['taskId'])
export class TaskSplitEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'task_id', type: 'uuid' })
  taskId: string;

  @Column({ type: 'timestamp' })
  start: Date;

  @Column({ type: 'timestamp' })
  finish: Date;
}

@Entity('task_recurring_rules')
@Index(['taskId'])
export class TaskRecurringRuleEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'task_id', type: 'uuid' })
  taskId: string;

  @Column({ type: 'simple-json' })
  rule: Record<string, unknown>;
}
