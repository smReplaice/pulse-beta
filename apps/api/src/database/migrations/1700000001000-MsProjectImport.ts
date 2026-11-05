import { MigrationInterface, QueryRunner } from 'typeorm';

/** MS Project import: traceability table + resource source-UID column + indexes. */
export class MsProjectImport1700000001000 implements MigrationInterface {
  name = 'MsProjectImport1700000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS msproject_import_jobs (
      id varchar(36) PRIMARY KEY,
      organization_id varchar(36) NOT NULL,
      project_id varchar(36) NOT NULL,
      filename text NOT NULL,
      format text NOT NULL,
      size_bytes integer NOT NULL DEFAULT 0,
      sha256 text NOT NULL,
      status text NOT NULL DEFAULT 'analyzed',
      options text,
      task_count integer NOT NULL DEFAULT 0,
      dependency_count integer NOT NULL DEFAULT 0,
      resource_count integer NOT NULL DEFAULT 0,
      assignment_count integer NOT NULL DEFAULT 0,
      warnings text,
      created_by text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_msp_jobs_org ON msproject_import_jobs (organization_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_msp_jobs_project ON msproject_import_jobs (project_id)`);

    // source UID traceability on resources (tasks already have external_reference_id)
    await queryRunner.query(`ALTER TABLE resources ADD COLUMN IF NOT EXISTS external_reference_id text`);
    // fast UID lookups per project (duplicate-import detection and re-import mapping)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_tasks_project_extref ON tasks (project_id, external_reference_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_resources_project_extref ON resources (project_id, external_reference_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS msproject_import_jobs CASCADE`);
    await queryRunner.query(`ALTER TABLE resources DROP COLUMN IF EXISTS external_reference_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_tasks_project_extref`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_resources_project_extref`);
  }
}
