import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('calendars')
@Index(['projectId'])
export class CalendarEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  /** null => organization-level template */
  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  projectId: string | null;

  @Column({ type: 'text' })
  name: string;

  @Column({ name: 'base_calendar_id', type: 'uuid', nullable: true })
  baseCalendarId: string | null;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean;
}

@Entity('calendar_working_days')
@Index(['calendarId'])
export class CalendarWorkingDayEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'calendar_id', type: 'uuid' })
  calendarId: string;

  /** 0 = Sunday … 6 = Saturday */
  @Column({ name: 'day_of_week', type: 'int' })
  dayOfWeek: number;

  /** [{start:'08:00', end:'12:00'}, …] */
  @Column({ type: 'simple-json' })
  periods: { start: string; end: string }[];
}

@Entity('calendar_exceptions')
@Index(['calendarId'])
export class CalendarExceptionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'calendar_id', type: 'uuid' })
  calendarId: string;

  /** YYYY-MM-DD */
  @Column({ type: 'text' })
  date: string;

  /** [] => non-working holiday */
  @Column({ type: 'simple-json' })
  periods: { start: string; end: string }[];

  @Column({ type: 'text', nullable: true })
  label: string | null;
}
