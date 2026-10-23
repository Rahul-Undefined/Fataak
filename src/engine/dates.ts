import { DateTime } from 'luxon';
import { Decimal, type Quantity, type Token } from './types';

export const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

export const WEEKDAYS: Record<string, number> = {
  mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6, sun: 7, sunday: 7,
};

export const DATE_KEYWORDS = new Set(['today', 'now', 'tomorrow', 'yesterday', 'next', 'last', 'this', ...Object.keys(WEEKDAYS), ...Object.keys(MONTHS)]);

export function dateQuantity(d: DateTime): Quantity {
  return { kind: 'date', value: new Decimal(d.toMillis()), date: d.startOf('day') };
}
export function timeQuantity(d: DateTime, zone?: string, showZone = false): Quantity {
  return { kind: 'time', value: new Decimal(d.toMillis()), date: d, zone: zone ?? d.zoneName ?? undefined, showZone };
}

export interface DateParse {
  q: Quantity;
  consumed: number;
}

function isWord(t: Token | undefined, v?: string): boolean {
  return !!t && t.type === 'word' && (v === undefined || t.value === v);
}
function isNum(t: Token | undefined): boolean {
  return !!t && t.type === 'number';
}
function isOp(t: Token | undefined, v: string): boolean {
  return !!t && t.type === 'op' && t.value === v;
}

function nextWeekday(from: DateTime, weekday: number, strictlyAfter: boolean): DateTime {
  let d = from.startOf('day');
  if (strictlyAfter) d = d.plus({ days: 1 });
  while (d.weekday !== weekday) d = d.plus({ days: 1 });
  return d;
}
function prevWeekday(from: DateTime, weekday: number): DateTime {
  let d = from.startOf('day').minus({ days: 1 });
  while (d.weekday !== weekday) d = d.minus({ days: 1 });
  return d;
}

/**
 * Try to read a date or time literal starting at tokens[i] (significant tokens only).
 * Returns null when nothing date-like starts there.
 */
export function tryParseDate(tokens: Token[], i: number, now: DateTime, zone: string): DateParse | null {
  const t0 = tokens[i];
  if (!t0) return null;
  const today = now.setZone(zone).startOf('day');

  // time literal: 6pm, 6 pm, 6:30pm, 18:30, 6:30:15 pm
  if (isNum(t0)) {
    const r = tryParseTime(tokens, i, now, zone);
    if (r) return r;
  }

  if (isWord(t0)) {
    const w = t0.value;
    if (w === 'today') return { q: dateQuantity(today), consumed: 1 };
    if (w === 'now') return { q: timeQuantity(now.setZone(zone), zone), consumed: 1 };
    if (w === 'tomorrow') return { q: dateQuantity(today.plus({ days: 1 })), consumed: 1 };
    if (w === 'yesterday') return { q: dateQuantity(today.minus({ days: 1 })), consumed: 1 };
    if (w === 'next' || w === 'last' || w === 'this') {
      const t1 = tokens[i + 1];
      if (isWord(t1)) {
        const v = t1.value;
        if (v in WEEKDAYS) {
          const wd = WEEKDAYS[v];
          const d = w === 'last' ? prevWeekday(today, wd) : w === 'this' ? nextWeekday(today, wd, false) : nextWeekday(today, wd, true);
          return { q: dateQuantity(d), consumed: 2 };
        }
        const units: Record<string, 'weeks' | 'months' | 'years' | 'days'> = { week: 'weeks', month: 'months', year: 'years', day: 'days' };
        if (v in units) {
          const n = w === 'last' ? -1 : w === 'this' ? 0 : 1;
          let d = today.plus({ [units[v]]: n });
          if (v === 'week') d = d.startOf('week');
          else if (v === 'month') d = d.startOf('month');
          else if (v === 'year') d = d.startOf('year');
          return { q: dateQuantity(d), consumed: 2 };
        }
      }
      return null;
    }
    if (w in WEEKDAYS) {
      return { q: dateQuantity(nextWeekday(today, WEEKDAYS[w], false)), consumed: 1 };
    }
    // "aug 14 2026" / "aug 14, 2026" / "august 2026"? (month + year not supported)
    if (w in MONTHS && isNum(tokens[i + 1])) {
      const day = parseInt(tokens[i + 1].value, 10);
      let j = i + 2;
      if (isOp(tokens[j], ',')) j++;
      let year = today.year;
      if (isNum(tokens[j]) && tokens[j].value.length === 4) {
        year = parseInt(tokens[j].value, 10);
        j++;
      }
      const d = DateTime.fromObject({ year, month: MONTHS[w], day }, { zone });
      if (d.isValid && day >= 1 && day <= 31) return { q: dateQuantity(d), consumed: j - i };
      return null;
    }
    return null;
  }

  if (isNum(t0)) {
    const t1 = tokens[i + 1];
    // "10 days ago" / "2 weeks ago" / "3 months ago"
    if (isWord(t1) && isWord(tokens[i + 2], 'ago')) {
      const units: Record<string, 'days' | 'weeks' | 'months' | 'years'> = {
        day: 'days', days: 'days', week: 'weeks', weeks: 'weeks', month: 'months', months: 'months', year: 'years', years: 'years',
      };
      const u = units[t1.value];
      if (u) return { q: dateQuantity(today.minus({ [u]: parseFloat(t0.value) })), consumed: 3 };
    }
    // 14 aug 2026 / 14 aug
    if (isWord(t1) && t1.value in MONTHS && t0.value.length <= 2) {
      const day = parseInt(t0.value, 10);
      let j = i + 2;
      let year = today.year;
      if (isNum(tokens[j]) && tokens[j].value.length === 4) {
        year = parseInt(tokens[j].value, 10);
        j++;
      }
      const d = DateTime.fromObject({ year, month: MONTHS[t1.value], day }, { zone });
      if (d.isValid) return { q: dateQuantity(d), consumed: j - i };
      return null;
    }
    // 2026-08-14 / 2026/08/14
    if (t0.value.length === 4 && (isOp(t1, '-') || isOp(t1, '/')) && isNum(tokens[i + 2]) && isOp(tokens[i + 3], t1.value) && isNum(tokens[i + 4])) {
      const d = DateTime.fromObject(
        { year: parseInt(t0.value, 10), month: parseInt(tokens[i + 2].value, 10), day: parseInt(tokens[i + 4].value, 10) },
        { zone },
      );
      if (d.isValid) return { q: dateQuantity(d), consumed: 5 };
      return null;
    }
    // 14/08/2026, 14-08-2026, 14/8/26 (day first)
    if (t0.value.length <= 2 && (isOp(t1, '/') || isOp(t1, '-')) && isNum(tokens[i + 2]) && tokens[i + 2].value.length <= 2 && isOp(tokens[i + 3], t1.value) && isNum(tokens[i + 4])) {
      let year = parseInt(tokens[i + 4].value, 10);
      if (tokens[i + 4].value.length === 2) year += 2000;
      const d = DateTime.fromObject({ year, month: parseInt(tokens[i + 2].value, 10), day: parseInt(t0.value, 10) }, { zone });
      if (d.isValid) return { q: dateQuantity(d), consumed: 5 };
      return null;
    }
  }
  return null;
}

export function tryParseTime(tokens: Token[], i: number, now: DateTime, zone: string): DateParse | null {
  const t0 = tokens[i];
  if (!isNum(t0) || t0.value.includes('.') || t0.value.length > 2) return null;
  let hour = parseInt(t0.value, 10);
  let minute = 0;
  let second = 0;
  let j = i + 1;
  let hasColon = false;
  if (isOp(tokens[j], ':') && isNum(tokens[j + 1]) && tokens[j + 1].value.length === 2) {
    minute = parseInt(tokens[j + 1].value, 10);
    j += 2;
    hasColon = true;
    if (isOp(tokens[j], ':') && isNum(tokens[j + 1]) && tokens[j + 1].value.length === 2) {
      second = parseInt(tokens[j + 1].value, 10);
      j += 2;
    }
  }
  let meridiem: 'am' | 'pm' | null = null;
  const tw = tokens[j];
  if (isWord(tw) && ['am', 'pm', 'a.m.', 'p.m.'].includes(tw.value)) {
    meridiem = tw.value.startsWith('a') ? 'am' : 'pm';
    j++;
  } else if (isWord(tw) && (tw.value === 'hrs' || tw.value === 'hours') && hasColon) {
    j++;
  }
  if (!hasColon && !meridiem) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (meridiem) {
    if (hour > 12) return null;
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
  }
  const d = now.setZone(zone).startOf('day').set({ hour, minute, second });
  return { q: timeQuantity(d, zone), consumed: j - i };
}
