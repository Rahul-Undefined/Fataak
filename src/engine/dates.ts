import { DateTime } from 'luxon';
import { CalcError, Decimal, type Quantity, type Token, own } from './types';

export const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

export const WEEKDAYS: Record<string, number> = {
  mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6, sun: 7, sunday: 7,
};

export const DATE_KEYWORDS = new Set(['today', 'now', 'tomorrow', 'yesterday', 'next', 'last', 'this', 'first', 'end', 'beginning', ...Object.keys(WEEKDAYS), ...Object.keys(MONTHS)]);

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
  for (let n = 0; n < 7 && d.weekday !== weekday; n++) d = d.plus({ days: 1 });
  return d;
}
function prevWeekday(from: DateTime, weekday: number): DateTime {
  let d = from.startOf('day').minus({ days: 1 });
  for (let n = 0; n < 7 && d.weekday !== weekday; n++) d = d.minus({ days: 1 });
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
    // "last day of february 2028", "first day of next month", "end of march", "beginning of 2027"
    const edge = w === 'last' || w === 'end' ? 'end' : w === 'first' || w === 'start' || w === 'beginning' ? 'start' : null;
    if (edge) {
      let j = i + 1;
      if (isWord(tokens[j], 'day') || isWord(tokens[j], 'days')) j++;
      if (isWord(tokens[j], 'of')) j++;
      if (j > i + 1) {
        const t = tokens[j];
        let base: DateTime | null = null;
        let consumed = 0;
        if (isWord(t) && own(MONTHS, t.value)) {
          let year = today.year;
          consumed = 1;
          if (isNum(tokens[j + 1]) && tokens[j + 1].value.length === 4) {
            year = parseInt(tokens[j + 1].value, 10);
            consumed = 2;
          }
          base = DateTime.fromObject({ year, month: MONTHS[t.value], day: 1 }, { zone });
          if (base < today.startOf('month') && consumed === 1) base = base.plus({ years: 1 });
        } else if (isNum(t) && t.value.length === 4) {
          base = DateTime.fromObject({ year: parseInt(t.value, 10), month: 1, day: 1 }, { zone });
          const res = edge === 'end' ? base.endOf('year').startOf('day') : base;
          return { q: { ...dateQuantity(res), display: res.toFormat('ccc, d LLL yyyy') }, consumed: j - i + 1 };
        } else if (isWord(t, 'this') || isWord(t, 'next') || isWord(t, 'last')) {
          const unit = tokens[j + 1]?.value;
          const n = t.value === 'next' ? 1 : t.value === 'last' ? -1 : 0;
          if (unit === 'month' || unit === 'months') base = today.plus({ months: n }).startOf('month');
          else if (unit === 'year' || unit === 'years') {
            base = today.plus({ years: n }).startOf('year');
            const res = edge === 'end' ? base.endOf('year').startOf('day') : base;
            return { q: { ...dateQuantity(res), display: res.toFormat('ccc, d LLL yyyy') }, consumed: j - i + 2 };
          }
          consumed = 2;
        } else if (isWord(t, 'month') || isWord(t, 'months')) {
          base = today.startOf('month');
          consumed = 1;
        } else if (isWord(t, 'year') || isWord(t, 'years')) {
          base = today.startOf('year');
          const res = edge === 'end' ? base.endOf('year').startOf('day') : base;
          return { q: { ...dateQuantity(res), display: res.toFormat('ccc, d LLL yyyy') }, consumed: j - i + 1 };
        }
        if (base && base.isValid) {
          const res = edge === 'end' ? base.endOf('month').startOf('day') : base;
          return { q: { ...dateQuantity(res), display: res.toFormat('ccc, d LLL yyyy') }, consumed: j - i + consumed };
        }
        // "last day" / "first day" with nothing it belongs to ("february 2028 ka last day") is not a date on its own
        if (isWord(tokens[i + 1], 'day') || isWord(tokens[i + 1], 'days')) return null;
      }
    }
    if (w === 'next' || w === 'last' || w === 'this') {
      const t1 = tokens[i + 1];
      if (isWord(t1)) {
        const v = t1.value;
        if (own(WEEKDAYS, v)) {
          const wd = WEEKDAYS[v];
          const d = w === 'last' ? prevWeekday(today, wd) : w === 'this' ? nextWeekday(today, wd, false) : nextWeekday(today, wd, true);
          return { q: dateQuantity(d), consumed: 2 };
        }
        const units: Record<string, 'weeks' | 'months' | 'years' | 'days'> = { week: 'weeks', weeks: 'weeks', month: 'months', months: 'months', year: 'years', years: 'years', day: 'days', days: 'days' };
        if (own(units, v)) {
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
    if (own(WEEKDAYS, w)) {
      return { q: dateQuantity(nextWeekday(today, WEEKDAYS[w], false)), consumed: 1 };
    }
    // "february 2028" → the first of that month (for "february 2028 ka last day", "end of march 2027")
    if (own(MONTHS, w) && isNum(tokens[i + 1]) && tokens[i + 1].value.length === 4) {
      const d = DateTime.fromObject({ year: parseInt(tokens[i + 1].value, 10), month: MONTHS[w], day: 1 }, { zone });
      if (d.isValid) return { q: dateQuantity(d), consumed: 2 };
      return null;
    }
    // "aug 14 2026" / "aug 14, 2026"
    if (own(MONTHS, w) && isNum(tokens[i + 1])) {
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
    // "10 days ago" / "2 weeks before" (Hindi "2 din pehle") / "3 months later" ("3 mahine baad")
    const t2 = tokens[i + 2];
    if (isWord(t1) && isWord(t2) && ['ago', 'before', 'after', 'later', 'from'].includes(t2.value)) {
      const units: Record<string, 'days' | 'weeks' | 'months' | 'years'> = {
        day: 'days', days: 'days', week: 'weeks', weeks: 'weeks', month: 'months', months: 'months', year: 'years', years: 'years',
      };
      const u = own(units, t1.value) ? units[t1.value] : undefined;
      // "3 days from now" / "3 days from today" (the "today"/"now" word is consumed too)
      const fromNow = t2.value === 'from' && (isWord(tokens[i + 3], 'now') || isWord(tokens[i + 3], 'today'));
      // "today from 45 days after" (aaj se 45 din baad) and "45 days after today" anchor on a date: leave that to the date intent
      const t3 = tokens[i + 3];
      // "90 days before 1 jan 2027" / "2 weeks after 15 nov 2026": a date literal after the offset anchors it
      const t4 = tokens[i + 4];
      const anchorAfter = (isWord(t3) && (['today', 'tomorrow', 'yesterday', 'now', 'next', 'last', 'this'].includes(t3.value) || own(WEEKDAYS, t3.value) || own(MONTHS, t3.value))) || (isNum(t3) && isWord(t4) && own(MONTHS, t4.value));
      // "today 45 days after" (aaj ke 45 din baad): the offset shifts the date before it rather than forming a second date
      const DAY_WORDS = ['today', 'tomorrow', 'yesterday', 'now'];
      const anchorBefore = (isWord(tokens[i - 1]) && DAY_WORDS.includes(tokens[i - 1].value)) || (isWord(tokens[i - 1], 'of') && isWord(tokens[i - 2]) && DAY_WORDS.includes(tokens[i - 2].value));
      const anchored = isWord(tokens[i - 1], 'from') || isWord(tokens[i - 1], 'to') || isOp(tokens[i - 1], '+') || isOp(tokens[i - 1], '-') || anchorBefore || (anchorAfter && t2.value !== 'from');
      if (u && !anchored && (t2.value !== 'from' || fromNow)) {
        const back = t2.value === 'ago' || t2.value === 'before';
        const d = back ? today.minus({ [u]: parseFloat(t0.value) }) : today.plus({ [u]: parseFloat(t0.value) });
        return { q: dateQuantity(d), consumed: fromNow ? 4 : 3 };
      }
    }
    // 14 aug 2026 / 14 aug
    if (isWord(t1) && own(MONTHS, t1.value) && t0.value.length <= 2) {
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
    // 2026-08-14 / 2026/08/14 — written without spaces ("10 - 2 - 3" is arithmetic)
    const tight = (n: number) => tokens.slice(i, i + n).every((t, k) => k === 0 || tokens[i + k - 1].end === t.start);
    if (t0.value.length === 4 && (isOp(t1, '-') || isOp(t1, '/')) && isNum(tokens[i + 2]) && isOp(tokens[i + 3], t1.value) && isNum(tokens[i + 4]) && tight(5)) {
      const d = DateTime.fromObject(
        { year: parseInt(t0.value, 10), month: parseInt(tokens[i + 2].value, 10), day: parseInt(tokens[i + 4].value, 10) },
        { zone },
      );
      if (d.isValid) return { q: dateQuantity(d), consumed: 5 };
      return null;
    }
    // 14/08/2026, 14-08-2026, 14/8/26 (day first)
    if (t0.value.length <= 2 && (isOp(t1, '/') || isOp(t1, '-')) && isNum(tokens[i + 2]) && tokens[i + 2].value.length <= 2 && isOp(tokens[i + 3], t1.value) && isNum(tokens[i + 4]) && (tokens[i + 4].value.length === 4 || tokens[i + 4].value.length === 2) && tight(5)) {
      let year = parseInt(tokens[i + 4].value, 10);
      if (tokens[i + 4].value.length === 2) year += 2000;
      const d = DateTime.fromObject({ year, month: parseInt(tokens[i + 2].value, 10), day: parseInt(t0.value, 10) }, { zone });
      if (d.isValid) return { q: dateQuantity(d), consumed: 5 };
      // 12/13/2026: not a day-first date and nobody divides by a year — say so instead of computing 12 ÷ 13 ÷ 2026
      if (tokens[i + 4].value.length === 4) throw new CalcError(`invalid date ${t0.value}${t1.value}${tokens[i + 2].value}${t1.value}${tokens[i + 4].value}`, 'dates are day/month/year, e.g. 13/12/2026');
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
  let oclock = false;
  const tw = tokens[j];
  if (isWord(tw) && ['am', 'pm', 'a.m.', 'p.m.'].includes(tw.value)) {
    meridiem = tw.value.startsWith('a') ? 'am' : 'pm';
    j++;
  } else if (isWord(tw) && (tw.value === 'hrs' || tw.value === 'hours') && hasColon) {
    j++;
  } else if (isWord(tw) && ["o'clock", 'oclock', 'baje'].includes(tw.value)) {
    // "10 o'clock" / "10 baje": hour as given (24-hour if ≥ 13); a span intent may lift the end past noon
    oclock = true;
    j++;
  }
  if (!hasColon && !meridiem && !oclock) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (meridiem) {
    if (hour > 12) return null;
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
  }
  const d = now.setZone(zone).startOf('day').set({ hour, minute, second });
  return { q: timeQuantity(d, zone), consumed: j - i };
}
