import { formatDuration, formatUnits } from '@pulse/engine';

export const fmtDur = (minutes: number | null | undefined, ctx?: { minutesPerDay: number; minutesPerWeek: number; daysPerMonth: number }, estimated = false): string => {
  if (minutes == null) return '';
  return formatDuration(
    minutes,
    ctx ?? { minutesPerDay: 480, minutesPerWeek: 2400, daysPerMonth: 20 },
    estimated,
  );
};

export const fmtUnits = formatUnits;

export const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`;
};

export const fmtDateLong = (iso: string | null | undefined): string => {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};

export const fmtMoney = (v: number | null | undefined, currency = 'USD'): string => {
  if (v == null) return '';
  const symbol = currency === 'USD' ? '$' : currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : `${currency} `;
  return `${symbol}${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};

export const fmtFloat = (minutes: number | null | undefined, mpd = 480): string => {
  if (minutes == null) return '';
  const days = minutes / mpd;
  return `${days % 1 === 0 ? days : days.toFixed(1)} d`;
};

export const dateKey = (d: Date): string => d.toISOString().slice(0, 10);

export const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * 86400000);

export const parseDateInput = (s: string): Date | null => {
  const t = s.trim();
  if (!t) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(t);
  if (m) {
    const yr = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return new Date(Date.UTC(yr, Number(m[1]) - 1, Number(m[2]), 8, 0, 0));
  }
  const iso = new Date(t);
  return Number.isNaN(iso.getTime()) ? null : new Date(Date.UTC(iso.getUTCFullYear(), iso.getUTCMonth(), iso.getUTCDate(), 8, 0, 0));
};

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DOW_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
