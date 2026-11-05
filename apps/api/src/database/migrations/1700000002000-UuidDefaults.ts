import { MigrationInterface, QueryRunner } from 'typeorm';

/** Postgres needs an id default for TypeORM's uuid PK inserts
 *  (gen_random_uuid() is built in from PostgreSQL 13; no extension needed). */
export class UuidDefaults1700000002000 implements MigrationInterface {
  name = 'UuidDefaults1700000002000';

  private static readonly TABLES = [
    'organizations', 'portfolios', 'projects', 'project_settings', 'calendars',
    'calendar_working_days', 'calendar_exceptions', 'tasks', 'task_dependencies',
    'task_splits', 'task_recurring_rules', 'resources', 'resource_rates',
    'resource_availability', 'resource_assignments', 'resource_timephased_work',
    'project_baselines', 'baseline_tasks', 'progress_updates', 'cost_entries',
    'project_budgets', 'schedule_versions', 'schedule_calculation_runs',
    'schedule_audit', 'project_risks', 'ai_action_logs', 'msproject_import_jobs',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const t of UuidDefaults1700000002000.TABLES) {
      await queryRunner.query(
        `ALTER TABLE ${t} ALTER COLUMN id SET DEFAULT gen_random_uuid()::text`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const t of UuidDefaults1700000002000.TABLES) {
      await queryRunner.query(`ALTER TABLE ${t} ALTER COLUMN id DROP DEFAULT`);
    }
  }
}
