import { DateTime } from 'luxon';
import { Decimal, CalcError, own, lastValidResult, type EvalContext, type Quantity } from './types';
import type { Node, ConvTarget } from './parser';
import { convertUnit, unitById } from './units';
import { formatNumber, formatQuantity } from './format';
import { zoneAbbrev } from './timezone';

const CALENDAR_UNITS: Record<string, 'days' | 'weeks' | 'months' | 'years' | 'hours' | 'minutes' | 'seconds' | 'milliseconds'> = {
  day: 'days', week: 'weeks', month: 'months', year: 'years', h: 'hours', min: 'minutes', s: 'seconds', ms: 'milliseconds',
};

export function num(v: Decimal | number | string): Quantity {
  return { kind: 'number', value: new Decimal(v) };
}
export function money(v: Decimal | number | string, code: string): Quantity {
  return { kind: 'money', value: new Decimal(v), currency: code };
}
export function percent(v: Decimal | number | string): Quantity {
  return { kind: 'percent', value: new Decimal(v) };
}
export function unitQ(v: Decimal | number | string, unit: string): Quantity {
  return { kind: 'unit', value: new Decimal(v), unit };
}

function withNote(q: Quantity, note?: string): Quantity {
  if (!note) return q;
  return { ...q, note: q.note ? `${q.note} · ${note}` : note };
}

function fmtRateTime(ts: string): string {
  const d = DateTime.fromISO(ts, { zone: 'utc' });
  if (!d.isValid) return ts;
  return d.toFormat('d LLL HH:mm') + ' UTC';
}

/** Convert money to another currency using the context's rate provider. */
export function convertMoney(q: Quantity, to: string, ctx: EvalContext, date?: string): Quantity {
  if (q.kind !== 'money') throw new CalcError('not money');
  const from = q.currency!;
  // a date of today or later means the live rate
  const today = ctx.now().toISODate();
  const histDate = date && today && date < today ? date : undefined;
  if (from === to && !histDate) return q;
  if (from === to) return { ...q, note: `same currency · ${histDate}` };
  const quote = ctx.rates.get(from, to, histDate, { cachedOnly: !!ctx.cachedOnly });
  if (!quote) {
    if (ctx.cachedOnly) throw new CalcError(`rate unavailable offline`, `no cached ${from}→${to} rate`, 'data');
    ctx.rates.request?.(from, to, histDate);
    if (histDate) throw new CalcError(`no ${from}→${to} rate for ${histDate}`, 'fetching… (ECB history, needs internet)', 'data');
    throw new CalcError(`no rate for ${from}→${to}`, 'fetching… (needs internet)', 'data');
  }
  const rate = new Decimal(quote.rate);
  const rateText = `1 ${from} = ${formatNumber(rate, { maxDecimals: rate.lt(0.01) ? 6 : 4 })} ${to}`;
  let note: string;
  if (histDate) {
    // the provider may answer with the previous business day (weekends, holidays): disclose it
    const actual = DateTime.fromISO(quote.timestamp);
    const requested = DateTime.fromISO(histDate);
    const dateText = actual.toISODate() === histDate ? `on ${actual.toFormat('d LLL yyyy')}` : `on ${actual.toFormat('d LLL yyyy')} (no rate on ${requested.toFormat('d LLL yyyy')}; previous business day)`;
    note = `${rateText} · ${dateText} · ${quote.source}`;
  } else if (quote.cached || quote.offline || ctx.cachedOnly) {
    note = `Cached rate · ${rateText} · updated ${fmtRateTime(quote.timestamp)}${quote.offline ? ' · offline' : ''}`;
  } else {
    note = `${rateText} · ${fmtRateTime(quote.timestamp)}${quote.stale ? ' · cached' : ''}`;
  }
  return withNote({ kind: 'money', value: q.value.mul(rate), currency: to }, note);
}

function sameKindCheck(a: Quantity, b: Quantity, op: string): void {
  void a;
  void b;
  void op;
}

function toUnitOf(b: Quantity, a: Quantity): Quantity {
  // convert b into a's unit
  const ua = unitById(a.unit!)!;
  const ub = unitById(b.unit!)!;
  if (ua.dim !== ub.dim) throw new CalcError(`can't combine ${ua.symbol} and ${ub.symbol}`);
  return { kind: 'unit', value: convertUnit(b.value, ub, ua), unit: ua.id };
}

function dateShift(d: Quantity, dur: Quantity, sign: 1 | -1): Quantity {
  const u = unitById(dur.unit!)!;
  if (u.dim !== 'time') throw new CalcError(`can't add ${u.symbol} to a date`);
  const cal = own(CALENDAR_UNITS, u.id) ? CALENDAR_UNITS[u.id] : undefined;
  const amount = dur.value.mul(sign);
  let dt: DateTime;
  if (cal) {
    if (['days', 'weeks', 'months', 'years'].includes(cal) && !amount.isInteger()) {
      dt = d.date!.plus({ seconds: amount.mul(u.factor).toNumber() });
    } else dt = d.date!.plus({ [cal]: amount.toNumber() });
  } else {
    dt = d.date!.plus({ seconds: amount.mul(u.factor).toNumber() });
  }
  if (d.kind === 'date' && (u.id === 'h' || u.id === 'min' || u.id === 's' || u.id === 'ms')) {
    return { ...d, kind: 'time', date: dt, value: new Decimal(dt.toMillis()) };
  }
  return { ...d, date: dt, value: new Decimal(dt.toMillis()) };
}

export function add(a: Quantity, b: Quantity, ctx: EvalContext, sign: 1 | -1 = 1): Quantity {
  sameKindCheck(a, b, '+');
  // percentages
  if (b.kind === 'percent' && a.kind !== 'percent') {
    const factor = new Decimal(1).plus(b.value.mul(sign).div(100));
    if (a.kind === 'date' || a.kind === 'time') throw new CalcError("can't apply % to a date");
    return { ...a, value: a.value.mul(factor), note: undefined, display: undefined };
  }
  if (a.kind === 'percent' && b.kind === 'percent') return percent(a.value.plus(b.value.mul(sign)));
  if (a.kind === 'percent') {
    // 10% + 5 → treat percent as number of percentage points? Keep it simple: number result
    return { ...b, value: a.value.plus(b.value.mul(sign)) };
  }
  // dates
  if (a.kind === 'date' || a.kind === 'time') {
    if (b.kind === 'unit') return dateShift(a, b, sign);
    if (b.kind === 'number') return dateShift(a, unitQ(b.value, 'day'), sign);
    if ((b.kind === 'date' || b.kind === 'time') && sign === -1) {
      const diffMs = a.date!.diff(b.date!).as('milliseconds');
      if (a.kind === 'date' && b.kind === 'date') return unitQ(new Decimal(diffMs).div(86400000), 'day');
      const hours = new Decimal(diffMs).div(3600000);
      if (hours.abs().lt(1)) return unitQ(hours.mul(60), 'min');
      return unitQ(hours, 'h');
    }
    throw new CalcError("can't add two dates");
  }
  if (b.kind === 'date' || b.kind === 'time') {
    if (a.kind === 'unit' || a.kind === 'number') return add(b, a, ctx, sign);
    throw new CalcError("can't combine a date and a value");
  }
  // money
  if (a.kind === 'money' || b.kind === 'money') {
    if (a.kind === 'money' && b.kind === 'money') {
      if (a.currency !== b.currency) {
        // never mix currencies silently: the line must say which currency the answer is in ("… in USD")
        if (!ctx.allowMixedCurrency) throw new CalcError(`mixed currencies ${a.currency}/${b.currency}`, `add "in ${a.currency}" to convert`, 'data');
        const conv = convertMoney(b, a.currency!, ctx);
        return withNote(money(a.value.plus(conv.value.mul(sign)), a.currency!), conv.note);
      }
      return money(a.value.plus(b.value.mul(sign)), a.currency!);
    }
    if (a.kind === 'money' && b.kind === 'number') return money(a.value.plus(b.value.mul(sign)), a.currency!);
    if (a.kind === 'number' && b.kind === 'money') return money(a.value.plus(b.value.mul(sign)), b.currency!);
    throw new CalcError("can't add money and units");
  }
  // units
  if (a.kind === 'unit' || b.kind === 'unit') {
    if (a.kind === 'unit' && b.kind === 'unit') {
      const bb = toUnitOf(b, a);
      return unitQ(a.value.plus(bb.value.mul(sign)), a.unit!);
    }
    if (a.kind === 'unit') return unitQ(a.value.plus(b.value.mul(sign)), a.unit!);
    return unitQ(a.value.plus(b.value.mul(sign)), b.unit!);
  }
  return num(a.value.plus(b.value.mul(sign)));
}

export function mul(a: Quantity, b: Quantity): Quantity {
  if (a.kind === 'percent' && b.kind !== 'percent') return mul(b, a);
  if (b.kind === 'percent') {
    if (a.kind === 'percent') return percent(a.value.mul(b.value).div(100));
    return { ...a, value: a.value.mul(b.value).div(100), note: undefined, display: undefined };
  }
  if (a.kind === 'date' || a.kind === 'time' || b.kind === 'date' || b.kind === 'time') throw new CalcError("can't multiply dates");
  if (a.kind === 'number' && b.kind === 'number') return num(a.value.mul(b.value));
  if (a.kind === 'number') return { ...b, value: a.value.mul(b.value), note: undefined, display: undefined };
  if (b.kind === 'number') return { ...a, value: a.value.mul(b.value), note: undefined, display: undefined };
  if (a.kind === 'unit' && b.kind === 'unit') {
    const ua = unitById(a.unit!)!;
    const ub = unitById(b.unit!)!;
    if (ua.dim === 'length' && ub.dim === 'length') {
      const sqm = convertUnit(a.value, ua, unitById('m')!).mul(convertUnit(b.value, ub, unitById('m')!));
      if (ua.id === 'ft' || ua.id === 'inch') return unitQ(convertUnit(sqm, unitById('sqm')!, unitById('sqft')!), 'sqft');
      if (ua.id === 'km') return unitQ(convertUnit(sqm, unitById('sqm')!, unitById('sqkm')!), 'sqkm');
      return unitQ(sqm, 'sqm');
    }
    // "2 m * 3 m * 4 m": area × length = volume (m³, or ft³ for feet)
    if (ua.dim === 'area' && ub.dim === 'length') {
      const m3 = a.value.mul(ua.factor).mul(convertUnit(b.value, ub, unitById('m')!));
      if (ua.id === 'sqft' || ub.id === 'ft' || ub.id === 'inch') return unitQ(convertUnit(m3, unitById('m3')!, unitById('ft3')!), 'ft3');
      return unitQ(m3, 'm3');
    }
    if (ua.dim === 'length' && ub.dim === 'area') return mul(b, a);
    if (ua.dim === 'speed' && ub.dim === 'time') {
      const metres = a.value.mul(ua.factor).mul(b.value.mul(ub.factor));
      return unitQ(ua.id === 'mph' ? convertUnit(metres, unitById('m')!, unitById('mile')!) : convertUnit(metres, unitById('m')!, unitById('km')!), ua.id === 'mph' ? 'mile' : 'km');
    }
    if (ua.dim === 'time' && ub.dim === 'speed') return mul(b, a);
    // "15 km/l * 40 l": fuel economy × fuel = distance
    if (ua.dim === 'fuel' && ub.dim === 'volume') return unitQ(a.value.mul(ua.factor).mul(b.value.mul(ub.factor)).div(1000), 'km');
    if (ua.dim === 'volume' && ub.dim === 'fuel') return mul(b, a);
    // "15 km/l * 40 l": fuel economy × fuel = distance
    if (ua.dim === 'fuel' && ub.dim === 'volume') return unitQ(a.value.mul(ua.factor).mul(b.value.mul(ub.factor)).div(1000), 'km');
    if (ua.dim === 'volume' && ub.dim === 'fuel') return mul(b, a);
    // "10 mbps * 1 hour": bandwidth × time = data
    if (ua.dim === 'bandwidth' && ub.dim === 'time') return dataQ(a.value.mul(ua.factor).mul(b.value.mul(ub.factor)));
    if (ua.dim === 'time' && ub.dim === 'bandwidth') return mul(b, a);
    throw new CalcError(`can't multiply ${ua.symbol} by ${ub.symbol}`);
  }
  throw new CalcError("can't multiply these");
}

/** bytes → the largest data unit that keeps the number readable */
function dataQ(bytes: Decimal): Quantity {
  const [id, f] = bytes.gte(1e12) ? ['TB', 1e12] : bytes.gte(1e9) ? ['GB', 1e9] : bytes.gte(1e6) ? ['MB', 1e6] : bytes.gte(1e3) ? ['KB', 1e3] : ['B', 1];
  return unitQ(bytes.div(f), id);
}

/** 320 s → "5 min 20 s", 3600 → "1 h", 90000 → "1 day 1 h" */
export function durationDisplay(seconds: Decimal): string {
  let s = Math.round(seconds.toNumber());
  if (s < 60) return `${seconds.toDecimalPlaces(2).toString()} s`;
  const parts: string[] = [];
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  if (d) parts.push(`${d} ${d === 1 ? 'day' : 'days'}`);
  if (h) parts.push(`${h} h`);
  if (m) parts.push(`${m} min`);
  if (s) parts.push(`${s} s`);
  return parts.join(' ');
}

export function div(a: Quantity, b: Quantity): Quantity {
  if (b.kind === 'number' || b.kind === 'percent') {
    const divisor = b.kind === 'percent' ? b.value.div(100) : b.value;
    if (divisor.isZero()) throw new CalcError('division by zero');
    if (a.kind === 'date' || a.kind === 'time') throw new CalcError("can't divide a date");
    return { ...a, value: a.value.div(divisor), note: undefined, display: undefined };
  }
  if (b.value.isZero()) throw new CalcError('division by zero');
  if (a.kind === 'money' && b.kind === 'money') {
    if (a.currency !== b.currency) throw new CalcError('convert to the same currency first');
    return num(a.value.div(b.value));
  }
  if (a.kind === 'unit' && b.kind === 'unit') {
    const ua = unitById(a.unit!)!;
    const ub = unitById(b.unit!)!;
    if (ua.dim === ub.dim) return num(a.value.div(convertUnit(b.value, ub, ua)));
    if (ua.dim === 'length' && ub.dim === 'time') {
      const mps = a.value.mul(ua.factor).div(b.value.mul(ub.factor));
      // the speed unit follows the inputs: m/s for metres per second, km/h for km per hour, mph for miles
      if (ua.id === 'mile') return unitQ(convertUnit(mps, unitById('mps')!, unitById('mph')!), 'mph');
      if (ub.id === 's' || ua.id === 'm' || ua.id === 'cm' || ua.id === 'mm') return unitQ(mps, 'mps');
      return unitQ(convertUnit(mps, unitById('mps')!, unitById('kmh')!), 'kmh');
    }
    if (ua.dim === 'length' && ub.dim === 'speed') {
      // 90 km at 90 km/h is exactly one hour: round away the 1/3.6 representation error before choosing the unit
      const secs = a.value.mul(ua.factor).div(b.value.mul(ub.factor)).toDecimalPlaces(6);
      if (secs.lt(60)) return unitQ(secs, 's');
      if (secs.lt(3600)) return unitQ(secs.div(60), 'min');
      if (secs.gte(86400)) return { ...unitQ(secs.div(3600), 'h'), display: durationDisplay(secs) };
      return unitQ(secs.div(3600), 'h');
    }
    // "600 km in 40 litres": distance ÷ fuel = km/l; "600 km at 15 km/l": distance ÷ economy = litres
    if (ua.dim === 'length' && ub.dim === 'volume') return unitQ(a.value.mul(ua.factor).div(b.value.mul(ub.factor)).div(1000), 'kmpl');
    if (ua.dim === 'length' && ub.dim === 'fuel') return unitQ(a.value.mul(ua.factor).div(b.value.mul(ub.factor)), 'l');
    // "600 km in 40 litres": distance ÷ fuel = km/l; "600 km at 15 km/l": distance ÷ economy = litres
    if (ua.dim === 'length' && ub.dim === 'volume') return unitQ(a.value.mul(ua.factor).div(b.value.mul(ub.factor)).div(1000), 'kmpl');
    if (ua.dim === 'length' && ub.dim === 'fuel') return unitQ(a.value.mul(ua.factor).div(b.value.mul(ub.factor)).div(1000), 'l');
    // "2 GB at 50 Mbps": data ÷ bandwidth = time; "2 GB in 10 s": data ÷ time = bandwidth
    if (ua.dim === 'data' && ub.dim === 'bandwidth') {
      const secs = a.value.mul(ua.factor).div(b.value.mul(ub.factor));
      return { ...unitQ(secs, 's'), display: durationDisplay(secs) };
    }
    if (ua.dim === 'data' && ub.dim === 'time') {
      const bytesPerSec = a.value.mul(ua.factor).div(b.value.mul(ub.factor));
      const bits = /bit/.test(ua.id);
      const [id, f] = bits ? (bytesPerSec.gte(125000000) ? ['gbps', 125000000] : ['mbps', 125000]) : bytesPerSec.gte(1e9) ? ['GBps', 1e9] : bytesPerSec.gte(1e6) ? ['MBps', 1e6] : ['kBps', 1e3];
      return unitQ(bytesPerSec.div(f), id);
    }
    throw new CalcError(`can't divide ${ua.symbol} by ${ub.symbol}`);
  }
  if (a.kind === 'number' && b.kind === 'unit') throw new CalcError("can't divide a number by a unit");
  if (a.kind === 'number' && b.kind === 'money') throw new CalcError("can't divide a number by money");
  throw new CalcError("can't divide these");
}

export function convert(q: Quantity, target: ConvTarget, ctx: EvalContext): Quantity {
  if (target.scale) {
    if (q.kind !== 'number' && q.kind !== 'money') throw new CalcError(`only a number converts to ${target.scale.word}`);
    const shown = q.value.div(target.scale.mult);
    const text = `${formatNumber(shown)} ${target.scale.word}`;
    return { ...q, display: q.kind === 'money' ? `${text} ${q.currency}` : text, note: undefined };
  }
  if (target.zone) {
    if (q.kind !== 'time') throw new CalcError(`only a time converts to ${target.zone.label}`, 'e.g. now + 2 hours in EST');
    const d = q.date!.setZone(target.zone.zone);
    const t = d.minute === 0 && d.second === 0 ? d.toFormat('h a') : d.toFormat('h:mm a');
    const notes: string[] = [];
    const dayDiff = d.ordinal + d.year * 1000 - (q.date!.ordinal + q.date!.year * 1000);
    if (dayDiff > 0) notes.push(`next day · ${d.toFormat('ccc d LLL')}`);
    else if (dayDiff < 0) notes.push(`previous day · ${d.toFormat('ccc d LLL')}`);
    if (target.zone.note) notes.push(target.zone.note);
    return { kind: 'time', value: q.value, date: d, zone: target.zone.zone, showZone: true, display: `${t} ${zoneAbbrev(d, target.zone)}`, note: notes.length ? notes.join(' · ') : undefined };
  }
  if (target.percent) {
    if (q.kind === 'number') return percent(q.value.mul(100));
    if (q.kind === 'percent') return q;
    throw new CalcError("only plain numbers convert to %");
  }
  if (target.currency) {
    if (q.kind === 'money') return convertMoney(q, target.currency, ctx, target.date);
    if (q.kind === 'number') return money(q.value, target.currency);
    throw new CalcError(`can't convert ${q.kind} to ${target.currency}`);
  }
  if (target.compound) {
    // "2.75 hours in hours and minutes" → 2 hours 45 minutes; "70 inches in feet and inches" → 5 ft 10 in
    const [bigId, smallId] = target.compound;
    const big = unitById(bigId)!;
    const small = unitById(smallId)!;
    if (q.kind !== 'unit' && q.kind !== 'number') throw new CalcError(`can't convert ${q.kind} to ${big.symbol} and ${small.symbol}`);
    const from = q.kind === 'unit' ? unitById(q.unit!)! : big;
    if (from.dim !== big.dim) throw new CalcError(`can't convert ${from.symbol} to ${big.symbol}`);
    const inBig = convertUnit(q.value, from, big);
    const whole = inBig.isNegative() ? inBig.ceil() : inBig.floor();
    const rest = convertUnit(inBig.minus(whole), big, small).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const LONG: Record<string, [string, string]> = { h: ['hour', 'hours'], min: ['minute', 'minutes'], s: ['second', 'seconds'], day: ['day', 'days'], week: ['week', 'weeks'], month: ['month', 'months'], year: ['year', 'years'] };
    const name = (u: typeof big, n: Decimal) => (own(LONG, u.id) ? LONG[u.id][n.abs().eq(1) ? 0 : 1] : u.symbol);
    const display = `${formatNumber(whole)} ${name(big, whole)} ${formatNumber(rest)} ${name(small, rest)}`;
    return { kind: 'unit', value: inBig, unit: big.id, display };
  }
  if (target.unit) {
    const to = unitById(target.unit)!;
    if (q.kind === 'unit') {
      const from = unitById(q.unit!)!;
      if (from.dim !== to.dim) throw new CalcError(`can't convert ${from.symbol} to ${to.symbol}`);
      return { ...unitQ(convertUnit(q.value, from, to), to.id), exactUnit: true };
    }
    if (q.kind === 'number') return { ...unitQ(q.value, to.id), exactUnit: true };
    throw new CalcError(`can't convert ${q.kind} to ${to.symbol}`);
  }
  throw new CalcError('convert to what?');
}

function toNumber(q: Quantity, what: string): number {
  if (q.kind === 'date' || q.kind === 'time') throw new CalcError(`${what} needs a number`);
  return q.value.toNumber();
}
/** trig input: a plain number is degrees (sin(30) = 0.5, as on a calculator); "0.5 rad" is radians */
function toRadians(q: Quantity): number {
  if (q.kind === 'unit') {
    const u = unitById(q.unit!)!;
    if (u.dim === 'angle') return convertUnit(q.value, u, unitById('rad')!).toNumber();
  }
  return (toNumber(q, 'trig') * Math.PI) / 180;
}
const DEG = 180 / Math.PI;

/** list functions add same-currency/unit values only; mixing is refused as in a normal sum */
const ctxForList: EvalContext = { variables: new Map(), previous: [], block: [], rates: { get: () => null }, now: () => DateTime.now(), zone: 'UTC' };

function callFn(fn: string, args: Quantity[]): Quantity {
  const a = args[0];
  const keep = (v: Decimal | number): Quantity => ({ ...a, value: new Decimal(v), note: undefined, display: undefined });
  switch (fn) {
    case 'sqrt':
      return keep(a.value.sqrt());
    case 'cbrt':
      return keep(a.value.cbrt());
    case 'abs':
      return keep(a.value.abs());
    case 'round': {
      const places = args[1] ? args[1].value.toNumber() : 0;
      return keep(a.value.toDecimalPlaces(places, Decimal.ROUND_HALF_UP));
    }
    case 'floor':
      return keep(a.value.floor());
    case 'ceil':
      return keep(a.value.ceil());
    case 'sin':
      return num(new Decimal(Math.sin(toRadians(a))).toDecimalPlaces(12));
    case 'cos':
      return num(new Decimal(Math.cos(toRadians(a))).toDecimalPlaces(12));
    case 'tan':
      return num(new Decimal(Math.tan(toRadians(a))).toDecimalPlaces(12));
    case 'asin':
    case 'arcsin':
      return num(Math.asin(toNumber(a, fn)) * DEG);
    case 'acos':
    case 'arccos':
      return num(Math.acos(toNumber(a, fn)) * DEG);
    case 'atan':
    case 'arctan':
      return num(Math.atan(toNumber(a, fn)) * DEG);
    case 'sinh':
      return num(Math.sinh(toNumber(a, fn)));
    case 'cosh':
      return num(Math.cosh(toNumber(a, fn)));
    case 'tanh':
      return num(Math.tanh(toNumber(a, fn)));
    case 'ln':
      return num(a.value.ln());
    case 'log':
    case 'log10':
      return num(args[1] ? a.value.log(args[1].value) : a.value.log(10));
    case 'root':
      return keep(args[1] ? a.value.pow(new Decimal(1).div(args[1].value)) : a.value.sqrt());
    case 'log2':
      return num(a.value.log(2));
    case 'exp':
      return num(a.value.exp());
    case 'fact':
    case 'factorial': {
      const n = a.value.toNumber();
      if (!Number.isInteger(n) || n < 0 || n > 170) throw new CalcError('factorial needs an integer 0–170');
      let r = new Decimal(1);
      for (let i = 2; i <= n; i++) r = r.mul(i);
      return num(r);
    }
    case 'sumlist': {
      let acc: Quantity = { ...args[0], note: undefined, display: undefined };
      for (const x of args.slice(1)) acc = add(acc, x, ctxForList, 1);
      return acc;
    }
    case 'avglist': {
      let acc: Quantity = { ...args[0], note: undefined, display: undefined };
      for (const x of args.slice(1)) acc = add(acc, x, ctxForList, 1);
      return { ...acc, value: acc.value.div(args.length) };
    }
    case 'lcm':
    case 'gcd': {
      if (args.some((q) => !q.value.isInteger())) throw new CalcError(`${fn} needs whole numbers`);
      const gcd2 = (x: Decimal, y: Decimal): Decimal => (y.isZero() ? x.abs() : gcd2(y, x.mod(y)));
      let acc = args[0].value.abs();
      for (const q of args.slice(1)) {
        const g = gcd2(acc, q.value);
        acc = fn === 'gcd' ? g : g.isZero() ? new Decimal(0) : acc.mul(q.value).abs().div(g);
      }
      return num(acc);
    }
    case 'mode': {
      const counts = new Map<string, number>();
      for (const q of args) counts.set(q.value.toString(), (counts.get(q.value.toString()) ?? 0) + 1);
      const max = Math.max(...counts.values());
      if (max === 1) throw new CalcError('no mode', 'every value appears once');
      const modes = [...counts.entries()].filter(([, n]) => n === max).map(([v]) => new Decimal(v)).sort((x, y) => x.cmp(y));
      return modes.length > 1 ? { ...num(modes[0]), display: modes.map((m) => m.toString()).join(', ') } : num(modes[0]);
    }
    case 'median': {
      const sorted = args.slice().sort((x, y) => x.value.cmp(y.value));
      const mid = Math.floor(sorted.length / 2);
      const m = sorted.length % 2 ? sorted[mid].value : sorted[mid - 1].value.plus(sorted[mid].value).div(2);
      return { ...sorted[0], value: m, note: undefined, display: undefined };
    }
    case 'min':
    case 'max': {
      let best = args[0];
      for (const x of args.slice(1)) {
        const cmp = x.value.cmp(best.value);
        if ((fn === 'min' && cmp < 0) || (fn === 'max' && cmp > 0)) best = x;
      }
      return best;
    }
  }
  throw new CalcError(`unknown function ${fn}`);
}

function aggregate(name: 'sum' | 'avg' | 'prev' | 'count', ctx: EvalContext): Quantity {
  if (name === 'prev') {
    const p = lastValidResult(ctx);
    if (p) return { ...p, note: undefined, display: undefined };
    const cleared = (ctx.contextStart ?? 0) > 0 && ctx.previous.length >= (ctx.contextStart ?? 0);
    throw new CalcError('previous result?', cleared ? 'context was cleared; no result since then' : 'no result above this line');
  }
  // a percentage line ("tax: 18%") is a rate, not an amount: it never takes part in the block sum
  const items = ctx.block.filter((q) => q.kind !== 'date' && q.kind !== 'time' && q.kind !== 'percent');
  if (name === 'count') return num(items.length);
  if (items.length === 0) throw new CalcError('nothing to sum', 'lines above this one are summed');
  let acc: Quantity = { ...items[0], note: undefined, display: undefined };
  for (const q of items.slice(1)) acc = add(acc, q, ctx);
  if (name === 'avg') return { ...acc, value: acc.value.div(items.length) };
  return acc;
}

/** while set, every operation evaluated appends one line of working here */
let TRACE: string[] | null = null;
const show = (q: Quantity): string => formatQuantity({ ...q, display: q.kind === 'unit' || q.kind === 'date' || q.kind === 'time' ? q.display : undefined });
const SYM: Record<string, string> = { '+': '+', '-': '−', '*': '×', '/': '÷', '^': '^', mod: 'mod', of: 'of', off: 'off', on: 'on' };

/** evaluate with the working collected: one line per operation, in the order they happen */
export function traced<T>(fn: () => T): { value: T; steps: string[] } {
  const outer = TRACE;
  const steps: string[] = [];
  TRACE = steps;
  LAST = new WeakMap<Node, Quantity>();
  try {
    const value = fn();
    return { value, steps };
  } finally {
    TRACE = outer;
  }
}

export function evaluate(node: Node, ctx: EvalContext): Quantity {
  const q = evaluateNode(node, ctx);
  if (TRACE) {
    if (node.t === 'bin') {
      const l = (node as { l: Node }).l;
      const r = (node as { r: Node }).r;
      const lv = LAST.get(l);
      const rv = LAST.get(r);
      if (lv && rv) TRACE.push(`${show(lv)} ${SYM[node.op] ?? node.op} ${show(rv)} = ${show(q)}`);
    } else if (node.t === 'conv') {
      const inner = LAST.get((node as { e: Node }).e);
      if (inner && show(inner) !== show(q)) TRACE.push(`${show(inner)} → ${show(q)}`);
    } else if (node.t === 'call') {
      const args = (node as { args: Node[] }).args.map((a) => LAST.get(a)).filter((x): x is Quantity => !!x);
      TRACE.push(`${(node as { fn: string }).fn}(${args.map(show).join(', ')}) = ${show(q)}`);
    } else if (node.t === 'scale') {
      const inner = LAST.get((node as { e: Node }).e);
      if (inner) TRACE.push(`${show(inner)} × ${(node as { mult: Decimal }).mult.toString()} = ${show(q)}`);
    }
    LAST.set(node, q);
  }
  return q;
}
/** values of already-evaluated nodes, for the trace (the map is replaced on every traced run) */
let LAST = new WeakMap<Node, Quantity>();

function evaluateNode(node: Node, ctx: EvalContext): Quantity {
  switch (node.t) {
    case 'num':
      return num(node.v);
    case 'lit':
      return node.q;
    case 'money': {
      const inner = evaluate(node.e, ctx);
      if (inner.kind === 'number') return money(inner.value, node.code);
      if (inner.kind === 'money') return convertMoney(inner, node.code, ctx);
      throw new CalcError(`can't make ${inner.kind} into money`);
    }
    case 'percent': {
      const inner = evaluate(node.e, ctx);
      if (inner.kind !== 'number' && inner.kind !== 'percent') throw new CalcError('% needs a plain number');
      return percent(inner.value);
    }
    case 'unit': {
      const inner = evaluate(node.e, ctx);
      if (inner.kind === 'number') return unitQ(inner.value, node.unit);
      if (inner.kind === 'unit') return convert(inner, { unit: node.unit }, ctx);
      if (inner.kind === 'date' || inner.kind === 'time') throw new CalcError(`can't apply ${node.unit} to a date`);
      throw new CalcError(`can't apply ${node.unit} to ${inner.kind}`);
    }
    case 'scale': {
      const inner = evaluate(node.e, ctx);
      if (inner.kind === 'date' || inner.kind === 'time') throw new CalcError("can't scale a date");
      return { ...inner, value: inner.value.mul(node.mult) };
    }
    case 'var': {
      const v = ctx.variables.get(node.name);
      if (!v) throw new CalcError(`${node.name} = ?`, `define it above: ${node.name}: 100`);
      return { ...v, note: undefined, display: undefined };
    }
    case 'neg': {
      const inner = evaluate(node.e, ctx);
      if (inner.kind === 'date' || inner.kind === 'time') throw new CalcError("can't negate a date");
      return { ...inner, value: inner.value.neg() };
    }
    case 'conv':
      return convert(evaluate(node.e, ctx), node.target, ctx);
    case 'call':
      return callFn(node.fn, node.args.map((a) => evaluate(a, ctx)));
    case 'agg':
      return aggregate(node.name, ctx);
    case 'line': {
      const q = ctx.previous[node.n - 1];
      if (!q) throw new CalcError(`line ${node.n} has no result`);
      return { ...q, note: undefined, display: undefined };
    }
    case 'bin': {
      const l = evaluate(node.l, ctx);
      const r = evaluate(node.r, ctx);
      switch (node.op) {
        case '+':
          return add(l, r, ctx, 1);
        case '-':
          return add(l, r, ctx, -1);
        case '*':
          return mul(l, r);
        case '/':
          return div(l, r);
        case 'mod': {
          if (r.value.isZero()) throw new CalcError('division by zero');
          return { ...l, value: l.value.mod(r.value), note: undefined, display: undefined };
        }
        case '^': {
          if (l.kind === 'date' || l.kind === 'time' || r.kind !== 'number') throw new CalcError('^ needs numbers');
          return { ...l, value: l.value.pow(r.value), note: undefined, display: undefined };
        }
        case 'of': {
          // "20% of X" or "X ka 20%" (either order), "half of X"
          if (l.kind === 'percent') return { ...r, value: r.value.mul(l.value).div(100), note: undefined, display: undefined };
          if (r.kind === 'percent') return { ...l, value: l.value.mul(r.value).div(100), note: undefined, display: undefined };
          if (l.kind === 'number') return { ...r, value: r.value.mul(l.value), note: undefined, display: undefined };
          throw new CalcError('"of" needs a percentage');
        }
        case 'off': {
          if (l.kind !== 'percent') throw new CalcError('"off" needs a percentage');
          return { ...r, value: r.value.mul(new Decimal(100).minus(l.value)).div(100), note: undefined, display: undefined };
        }
        case 'on': {
          if (l.kind === 'percent') return { ...r, value: r.value.mul(new Decimal(100).plus(l.value)).div(100), note: undefined, display: undefined };
          if (r.kind === 'percent') return { ...l, value: l.value.mul(new Decimal(100).plus(r.value)).div(100), note: undefined, display: undefined };
          throw new CalcError('"on" needs a percentage');
        }
      }
    }
  }
}
