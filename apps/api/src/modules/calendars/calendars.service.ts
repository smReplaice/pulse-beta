import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CalendarEntity,
  CalendarExceptionEntity,
  CalendarWorkingDayEntity,
} from '../../entities';
import { ScheduleService } from '../schedule/schedule.service';

export class CreateCalendarDto {
  name!: string;
  baseCalendarId?: string | null;
  /** { 1: [{start,end}], … } day-of-week → periods */
  week?: Record<string, { start: string; end: string }[]>;
  makeDefault?: boolean;
}

export class UpdateCalendarDto extends CreateCalendarDto {}

export class UpsertExceptionDto {
  date!: string; // YYYY-MM-DD
  periods!: { start: string; end: string }[]; // [] = holiday
  label?: string | null;
}

@Injectable()
export class CalendarsService {
  constructor(
    @InjectRepository(CalendarEntity) private readonly calendars: Repository<CalendarEntity>,
    @InjectRepository(CalendarWorkingDayEntity) private readonly days: Repository<CalendarWorkingDayEntity>,
    @InjectRepository(CalendarExceptionEntity) private readonly exceptions: Repository<CalendarExceptionEntity>,
    private readonly scheduleService: ScheduleService,
  ) {}

  async list(projectId: string) {
    await this.scheduleService.getProject(projectId);
    const cals = await this.calendars.find({ where: { projectId } });
    const [days, exceptions] = await Promise.all([
      this.days.find(),
      this.exceptions.find(),
    ]);
    return cals.map((c) => ({
      ...c,
      workingDays: days.filter((d) => d.calendarId === c.id),
      exceptions: exceptions.filter((e) => e.calendarId === c.id),
    }));
  }

  async create(projectId: string, dto: CreateCalendarDto): Promise<CalendarEntity> {
    const project = await this.scheduleService.getProject(projectId);
    const cal = await this.calendars.save(
      this.calendars.create({
        organizationId: project.organizationId,
        projectId,
        name: dto.name,
        baseCalendarId: dto.baseCalendarId ?? null,
        isDefault: dto.makeDefault ?? false,
      }),
    );
    if (dto.week) {
      await this.applyWeek(cal.id, dto.week);
    } else if (dto.baseCalendarId) {
      const baseDays = await this.days.find({ where: { calendarId: dto.baseCalendarId } });
      await this.days.insert(
        baseDays.map((d) =>
          this.days.create({ calendarId: cal.id, dayOfWeek: d.dayOfWeek, periods: d.periods }),
        ),
      );
    }
    if (dto.makeDefault) {
      await this.calendars.update({ projectId }, { isDefault: false });
      await this.calendars.update({ id: cal.id }, { isDefault: true });
      await this.scheduleService.getSettings(projectId).then((s) =>
        this.updateDefaultInSettings(projectId, s.defaultCalendarId, cal.id),
      );
    }
    return cal;
  }

  private async updateDefaultInSettings(projectId: string, _old: string | null, newId: string) {
    void _old;
    const settings = await this.scheduleService.getSettings(projectId);
    settings.defaultCalendarId = newId;
    await this.calendars.manager.getRepository(
      (await import('../../entities')).ProjectSettingsEntity,
    ).save(settings);
  }

  private async applyWeek(calendarId: string, week: Record<string, { start: string; end: string }[]>) {
    await this.days.delete({ calendarId });
    const rows = Object.entries(week).map(([dow, periods]) =>
      this.days.create({ calendarId, dayOfWeek: Number(dow), periods }),
    );
    if (rows.length > 0) await this.days.insert(rows);
  }

  async update(calendarId: string, dto: UpdateCalendarDto): Promise<CalendarEntity> {
    const cal = await this.calendars.findOne({ where: { id: calendarId } });
    if (!cal) throw new NotFoundException(`Calendar ${calendarId} not found`);
    if (dto.name) cal.name = dto.name;
    if (dto.baseCalendarId !== undefined) cal.baseCalendarId = dto.baseCalendarId;
    await this.calendars.save(cal);
    if (dto.week) await this.applyWeek(calendarId, dto.week);
    if (cal.projectId) await this.scheduleService.recalculate(cal.projectId, 'calendar_change');
    return cal;
  }

  async upsertException(calendarId: string, dto: UpsertExceptionDto) {
    const cal = await this.calendars.findOne({ where: { id: calendarId } });
    if (!cal) throw new NotFoundException(`Calendar ${calendarId} not found`);
    const existing = await this.exceptions.findOne({
      where: { calendarId, date: dto.date },
    });
    if (existing) {
      existing.periods = dto.periods;
      existing.label = dto.label ?? null;
      await this.exceptions.save(existing);
    } else {
      await this.exceptions.insert(
        this.exceptions.create({
          calendarId,
          date: dto.date,
          periods: dto.periods,
          label: dto.label ?? null,
        }),
      );
    }
    if (cal.projectId) {
      const recalc = await this.scheduleService.recalculate(cal.projectId, 'calendar_change');
      return { ok: true, changedTasks: recalc.changedTasks, scheduleVersion: recalc.scheduleVersion };
    }
    return { ok: true };
  }

  async deleteException(exceptionId: string) {
    const ex = await this.exceptions.findOne({ where: { id: exceptionId } });
    if (!ex) throw new NotFoundException(`Exception ${exceptionId} not found`);
    await this.exceptions.remove(ex);
    const cal = await this.calendars.findOne({ where: { id: ex.calendarId } });
    if (cal?.projectId) {
      const recalc = await this.scheduleService.recalculate(cal.projectId, 'calendar_change');
      return { ok: true, scheduleVersion: recalc.scheduleVersion };
    }
    return { ok: true };
  }
}
