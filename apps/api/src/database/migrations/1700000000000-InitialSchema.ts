import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial BiltFlow Pulse schema.
 * Hand-written DDL matching src/entities — version controlled, applied via
 * `npm run db:migrate` (typeorm migration:run).
 */
export class InitialSchema1700000000000 implements MigrationInterface {
  name = 'InitialSchema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS organizations (
      id varchar(36) PRIMARY KEY,
      slug text NOT NULL UNIQUE,
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS portfolios (
      id varchar(36) PRIMARY KEY,
      organization_id varchar(36) NOT NULL,
      name text NOT NULL,
      description text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_portfolios_org ON portfolios (organization_id)`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS projects (
      id varchar(36) PRIMARY KEY,
      organization_id varchar(36) NOT NULL,
      portfolio_id varchar(36),
      code text,
      name text NOT NULL,
      description text,
      status text NOT NULL DEFAULT 'active',
      project_start timestamptz,
      project_deadline timestamptz,
      status_date timestamptz,
      currency text NOT NULL DEFAULT 'USD',
      minutes_per_day integer NOT NULL DEFAULT 480,
      minutes_per_week integer NOT NULL DEFAULT 2400,
      days_per_month integer NOT NULL DEFAULT 20,
      current_schedule_version integer NOT NULL DEFAULT 0,
      computed_start timestamptz,
      computed_finish timestamptz,
      computed_progress double precision,
      computed_critical_late integer,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_projects_org ON projects (organization_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_projects_portfolio ON projects (portfolio_id)`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS project_settings (
      id varchar(36) PRIMARY KEY,
      project_id varchar(36) NOT NULL UNIQUE,
      scheduling_from text NOT NULL DEFAULT 'start',
      new_task_type text NOT NULL DEFAULT 'fixed_units',
      new_tasks_effort_driven boolean NOT NULL DEFAULT true,
      split_in_progress boolean NOT NULL DEFAULT true,
      autolink_inserted_tasks boolean NOT NULL DEFAULT true,
      critical_slack_threshold_minutes integer NOT NULL DEFAULT 0,
      multiple_critical_paths boolean NOT NULL DEFAULT false,
      show_estimated_durations boolean NOT NULL DEFAULT false,
      default_calendar_id varchar(36)
    )`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS calendars (
      id varchar(36) PRIMARY KEY,
      organization_id varchar(36) NOT NULL,
      project_id varchar(36),
      name text NOT NULL,
      base_calendar_id varchar(36),
      is_default boolean NOT NULL DEFAULT false
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_calendars_project ON calendars (project_id)`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS calendar_working_days (
      id varchar(36) PRIMARY KEY,
      calendar_id varchar(36) NOT NULL,
      day_of_week integer NOT NULL,
      periods text NOT NULL
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_cal_working_cal ON calendar_working_days (calendar_id)`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS calendar_exceptions (
      id varchar(36) PRIMARY KEY,
      calendar_id varchar(36) NOT NULL,
      date text NOT NULL,
      periods text NOT NULL,
      label text
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_cal_exc_cal ON calendar_exceptions (calendar_id)`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS tasks (
      id varchar(36) PRIMARY KEY,
      project_id varchar(36) NOT NULL,
      row_order double precision NOT NULL,
      outline_level integer NOT NULL DEFAULT 0,
      name text NOT NULL,
      duration_minutes integer NOT NULL DEFAULT 480,
      duration_mode text NOT NULL DEFAULT 'working',
      mode text NOT NULL DEFAULT 'auto',
      task_type text NOT NULL DEFAULT 'fixed_units',
      effort_driven boolean NOT NULL DEFAULT false,
      percent_complete double precision NOT NULL DEFAULT 0,
      constraint_type text DEFAULT 'ASAP',
      constraint_date timestamptz,
      deadline timestamptz,
      calendar_id varchar(36),
      priority integer NOT NULL DEFAULT 500,
      leveling_delay_minutes integer NOT NULL DEFAULT 0,
      notes text,
      active boolean NOT NULL DEFAULT true,
      manual_start timestamptz,
      manual_finish timestamptz,
      fixed_cost double precision NOT NULL DEFAULT 0,
      fixed_cost_accrual text NOT NULL DEFAULT 'prorated',
      actual_start timestamptz,
      actual_finish timestamptz,
      actual_work_minutes integer NOT NULL DEFAULT 0,
      actual_cost double precision,
      stage text,
      trade text,
      location text,
      package_id varchar(36),
      external_reference_id text,
      required_on_site timestamptz,
      delay_reason text,
      extension_of_time boolean NOT NULL DEFAULT false,
      is_procurement boolean NOT NULL DEFAULT false,
      is_approval boolean NOT NULL DEFAULT false,
      is_inspection boolean NOT NULL DEFAULT false,
      computed_start timestamptz,
      computed_finish timestamptz,
      computed_early_start timestamptz,
      computed_early_finish timestamptz,
      computed_late_start timestamptz,
      computed_late_finish timestamptz,
      computed_total_float integer,
      computed_free_float integer,
      computed_is_critical boolean NOT NULL DEFAULT false,
      computed_is_summary boolean NOT NULL DEFAULT false,
      computed_is_milestone boolean NOT NULL DEFAULT false,
      computed_duration integer,
      computed_work double precision,
      computed_percent_complete double precision,
      computed_planned_cost double precision,
      computed_actual_cost double precision,
      wbs text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks (project_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_tasks_project_order ON tasks (project_id, row_order)`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS task_dependencies (
      id varchar(36) PRIMARY KEY,
      project_id varchar(36) NOT NULL,
      predecessor_id varchar(36) NOT NULL,
      successor_id varchar(36) NOT NULL,
      type text NOT NULL DEFAULT 'FS',
      lag_minutes integer NOT NULL DEFAULT 0
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_deps_project ON task_dependencies (project_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_deps_pred ON task_dependencies (predecessor_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_deps_succ ON task_dependencies (successor_id)`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_deps_pair ON task_dependencies (predecessor_id, successor_id)`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS task_splits (
      id varchar(36) PRIMARY KEY,
      task_id varchar(36) NOT NULL,
      start timestamptz NOT NULL,
      finish timestamptz NOT NULL
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_splits_task ON task_splits (task_id)`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS task_recurring_rules (
      id varchar(36) PRIMARY KEY,
      task_id varchar(36) NOT NULL,
      rule text NOT NULL
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_recurring_task ON task_recurring_rules (task_id)`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS resources (
      id varchar(36) PRIMARY KEY,
      organization_id varchar(36) NOT NULL,
      project_id varchar(36),
      kind text NOT NULL DEFAULT 'work',
      name text NOT NULL,
      initials text,
      "group" text,
      code text,
      max_units double precision NOT NULL DEFAULT 1,
      standard_rate double precision NOT NULL DEFAULT 0,
      overtime_rate double precision NOT NULL DEFAULT 0,
      cost_per_use double precision NOT NULL DEFAULT 0,
      calendar_id varchar(36),
      is_generic boolean NOT NULL DEFAULT false,
      notes text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_resources_org ON resources (organization_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_resources_project ON resources (project_id)`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS resource_rates (
      id varchar(36) PRIMARY KEY,
      resource_id varchar(36) NOT NULL,
      effective_from timestamptz NOT NULL,
      standard_rate double precision NOT NULL,
      overtime_rate double precision NOT NULL DEFAULT 0,
      cost_per_use double precision NOT NULL DEFAULT 0
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_rates_resource ON resource_rates (resource_id)`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS resource_availability (
      id varchar(36) PRIMARY KEY,
      resource_id varchar(36) NOT NULL,
      from_date text NOT NULL,
      thru_date text NOT NULL,
      units double precision NOT NULL
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_avail_resource ON resource_availability (resource_id)`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS resource_assignments (
      id varchar(36) PRIMARY KEY,
      project_id varchar(36) NOT NULL,
      task_id varchar(36) NOT NULL,
      resource_id varchar(36) NOT NULL,
      units double precision NOT NULL DEFAULT 1,
      work_minutes double precision,
      cost double precision
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_assign_project ON resource_assignments (project_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_assign_task ON resource_assignments (task_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_assign_resource ON resource_assignments (resource_id)`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS resource_timephased_work (
      id varchar(36) PRIMARY KEY,
      project_id varchar(36) NOT NULL,
      assignment_id varchar(36) NOT NULL,
      task_id varchar(36) NOT NULL,
      resource_id varchar(36) NOT NULL,
      date_key text NOT NULL,
      planned_minutes double precision NOT NULL DEFAULT 0,
      actual_minutes double precision NOT NULL DEFAULT 0,
      planned_cost double precision NOT NULL DEFAULT 0,
      actual_cost double precision NOT NULL DEFAULT 0
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_tp_assignment ON resource_timephased_work (assignment_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_tp_project ON resource_timephased_work (project_id)`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS project_baselines (
      id varchar(36) PRIMARY KEY,
      project_id varchar(36) NOT NULL,
      name text NOT NULL,
      notes text,
      is_current boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_baselines_project ON project_baselines (project_id)`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS baseline_tasks (
      id varchar(36) PRIMARY KEY,
      baseline_id varchar(36) NOT NULL,
      task_id varchar(36) NOT NULL,
      name text NOT NULL,
      start timestamptz NOT NULL,
      finish timestamptz NOT NULL,
      duration_minutes integer NOT NULL,
      work_minutes double precision NOT NULL,
      cost double precision NOT NULL,
      percent_complete double precision NOT NULL DEFAULT 0
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_baseline_tasks ON baseline_tasks (baseline_id)`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS progress_updates (
      id varchar(36) PRIMARY KEY,
      project_id varchar(36) NOT NULL,
      task_id varchar(36) NOT NULL,
      as_of timestamptz NOT NULL,
      percent_complete double precision,
      actual_start timestamptz,
      actual_finish timestamptz,
      actual_work_minutes double precision,
      remaining_duration_minutes integer,
      notes text,
      created_by text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_progress_project ON progress_updates (project_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_progress_task ON progress_updates (task_id)`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS cost_entries (
      id varchar(36) PRIMARY KEY,
      project_id varchar(36) NOT NULL,
      task_id varchar(36),
      resource_id varchar(36),
      date timestamptz NOT NULL,
      kind text NOT NULL DEFAULT 'other',
      amount double precision NOT NULL,
      notes text
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_costs_project ON cost_entries (project_id)`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS project_budgets (
      id varchar(36) PRIMARY KEY,
      project_id varchar(36) NOT NULL,
      name text NOT NULL,
      total_amount double precision NOT NULL,
      notes text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_budgets_project ON project_budgets (project_id)`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS schedule_versions (
      id varchar(36) PRIMARY KEY,
      project_id varchar(36) NOT NULL,
      version integer NOT NULL,
      trigger text NOT NULL,
      summary text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_versions_project ON schedule_versions (project_id)`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS schedule_calculation_runs (
      id varchar(36) PRIMARY KEY,
      project_id varchar(36) NOT NULL,
      version_id varchar(36) NOT NULL,
      started_at timestamptz NOT NULL,
      finished_at timestamptz,
      task_count integer NOT NULL DEFAULT 0,
      changed_count integer NOT NULL DEFAULT 0,
      warning_count integer NOT NULL DEFAULT 0,
      warnings text,
      duration_ms integer NOT NULL DEFAULT 0
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_runs_project ON schedule_calculation_runs (project_id)`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS schedule_audit (
      id varchar(36) PRIMARY KEY,
      project_id varchar(36) NOT NULL,
      entity text NOT NULL,
      entity_id varchar(36),
      action text NOT NULL,
      before text,
      after text,
      actor text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_audit_project ON schedule_audit (project_id)`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS project_risks (
      id varchar(36) PRIMARY KEY,
      project_id varchar(36) NOT NULL,
      name text NOT NULL,
      impact text NOT NULL DEFAULT 'medium',
      probability text NOT NULL DEFAULT 'medium',
      mitigation text,
      related_task_id varchar(36),
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_risks_project ON project_risks (project_id)`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS ai_action_logs (
      id varchar(36) PRIMARY KEY,
      project_id varchar(36) NOT NULL,
      user_prompt text NOT NULL,
      agent text,
      action text,
      before text,
      after text,
      applied boolean NOT NULL DEFAULT false,
      undone boolean NOT NULL DEFAULT false,
      undo_token text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_ai_logs_project ON ai_action_logs (project_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tables = [
      'ai_action_logs', 'project_risks', 'schedule_audit', 'schedule_calculation_runs',
      'schedule_versions', 'project_budgets', 'cost_entries', 'progress_updates',
      'baseline_tasks', 'project_baselines', 'resource_timephased_work',
      'resource_assignments', 'resource_availability', 'resource_rates', 'resources',
      'task_recurring_rules', 'task_splits', 'task_dependencies', 'tasks',
      'calendar_exceptions', 'calendar_working_days', 'calendars',
      'project_settings', 'projects', 'portfolios', 'organizations',
    ];
    for (const t of tables) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
    }
  }
}
