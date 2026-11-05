import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('resources')
@Index(['organizationId'])
@Index(['projectId'])
export class ResourceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  /** null => organization-wide resource pool */
  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  projectId: string | null;

  /** work | material | cost */
  @Column({ type: 'text', default: 'work' })
  kind: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', nullable: true })
  initials: string | null;

  @Column({ name: 'group', type: 'text', nullable: true })
  group: string | null;

  @Column({ type: 'text', nullable: true })
  code: string | null;

  /** 1.0 = 100 % */
  @Column({ name: 'max_units', type: 'float', default: 1 })
  maxUnits: number;

  @Column({ name: 'standard_rate', type: 'float', default: 0 })
  standardRate: number;

  @Column({ name: 'overtime_rate', type: 'float', default: 0 })
  overtimeRate: number;

  @Column({ name: 'cost_per_use', type: 'float', default: 0 })
  costPerUse: number;

  @Column({ name: 'calendar_id', type: 'uuid', nullable: true })
  calendarId: string | null;

  /** Source-system identifier (e.g. msp:resource-uid:7) for traceability. */
  @Column({ name: 'external_reference_id', type: 'text', nullable: true })
  externalReferenceId: string | null;

  @Column({ name: 'is_generic', type: 'boolean', default: false })
  isGeneric: boolean;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('resource_rates')
@Index(['resourceId'])
export class ResourceRateEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'resource_id', type: 'uuid' })
  resourceId: string;

  @Column({ name: 'effective_from', type: 'timestamp' })
  effectiveFrom: Date;

  @Column({ name: 'standard_rate', type: 'float' })
  standardRate: number;

  @Column({ name: 'overtime_rate', type: 'float', default: 0 })
  overtimeRate: number;

  @Column({ name: 'cost_per_use', type: 'float', default: 0 })
  costPerUse: number;
}

@Entity('resource_availability')
@Index(['resourceId'])
export class ResourceAvailabilityEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'resource_id', type: 'uuid' })
  resourceId: string;

  /** YYYY-MM-DD */
  @Column({ type: 'text' })
  fromDate: string;

  @Column({ type: 'text' })
  thruDate: string;

  @Column({ type: 'float' })
  units: number;
}

@Entity('resource_assignments')
@Index(['projectId'])
@Index(['taskId'])
@Index(['resourceId'])
export class ResourceAssignmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @Column({ name: 'task_id', type: 'uuid' })
  taskId: string;

  @Column({ name: 'resource_id', type: 'uuid' })
  resourceId: string;

  @Column({ type: 'float', default: 1 })
  units: number;

  /** work minutes for work resources; quantity for material; null => derive */
  @Column({ name: 'work_minutes', type: 'float', nullable: true })
  workMinutes: number | null;

  /** lump sum for cost resources */
  @Column({ type: 'float', nullable: true })
  cost: number | null;
}

@Entity('resource_timephased_work')
@Index(['assignmentId'])
@Index(['projectId'])
export class ResourceTimephasedWorkEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @Column({ name: 'assignment_id', type: 'uuid' })
  assignmentId: string;

  @Column({ name: 'task_id', type: 'uuid' })
  taskId: string;

  @Column({ name: 'resource_id', type: 'uuid' })
  resourceId: string;

  /** YYYY-MM-DD */
  @Column({ name: 'date_key', type: 'text' })
  dateKey: string;

  @Column({ name: 'planned_minutes', type: 'float', default: 0 })
  plannedMinutes: number;

  @Column({ name: 'actual_minutes', type: 'float', default: 0 })
  actualMinutes: number;

  @Column({ name: 'planned_cost', type: 'float', default: 0 })
  plannedCost: number;

  @Column({ name: 'actual_cost', type: 'float', default: 0 })
  actualCost: number;
}
