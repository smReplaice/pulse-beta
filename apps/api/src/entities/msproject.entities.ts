import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Traceability record for every Microsoft Project import. */
@Entity('msproject_import_jobs')
@Index(['organizationId'])
@Index(['projectId'])
export class MsProjectImportJobEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @Column({ type: 'text' })
  filename: string;

  /** xml | mpp */
  @Column({ type: 'text' })
  format: string;

  @Column({ name: 'size_bytes', type: 'int' })
  sizeBytes: number;

  @Column({ type: 'text' })
  sha256: string;

  /** analyzed | imported | failed */
  @Column({ type: 'text', default: 'analyzed' })
  status: string;

  @Column({ type: 'simple-json', nullable: true })
  options: Record<string, unknown> | null;

  @Column({ name: 'task_count', type: 'int', default: 0 })
  taskCount: number;

  @Column({ name: 'dependency_count', type: 'int', default: 0 })
  dependencyCount: number;

  @Column({ name: 'resource_count', type: 'int', default: 0 })
  resourceCount: number;

  @Column({ name: 'assignment_count', type: 'int', default: 0 })
  assignmentCount: number;

  @Column({ type: 'simple-json', nullable: true })
  warnings: string[] | null;

  @Column({ name: 'created_by', type: 'text', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
