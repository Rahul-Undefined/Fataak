import { Decimal, type Quantity } from './types';
import { currencyByCode } from './currency';
import { unitById } from './units';

/** group integer digits: Indian (12,34,567) or Western (1,234,567) */
export function groupDigits(intPart: string, indian: boolean): string {
  if (intPart.length <= 3) return intPart;
  if (!indian) return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const last3 = intPart.slice(-3);
  let rest = intPart.slice(0, -3);
  rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

export interface NumberFormatOptions {
  maxDecimals?: number;
  minDecimals?: number;
  indian?: boolean;
}

export function formatNumber(value: Decimal, opts: NumberFormatOptions = {}): string {
  const max = opts.maxDecimals ?? 4;
  const min = opts.minDecimals ?? 0;
  if (!value.isFinite()) return value.isNaN() ? 'NaN' : value.isNegative() ? '-∞' : '∞';
  let d = value;
  // avoid -0
  if (d.isZero()) d = new Decimal(0);
  let s: string;
  const abs = d.abs();
  if (!abs.isZero() && (abs.gte('1e21') || abs.lt('1e-9'))) {
    s = d.toExponential(6).replace(/\.?0+e/, 'e');
    return s;
  }
  s = d.toFixed(max);
  if (s.includes('.')) {
    let [int, frac] = s.split('.');
    frac = frac.replace(/0+$/, '');
    while (frac.length < min) frac += '0';
    const neg = int.startsWith('-');
    if (neg) int = int.slice(1);
    const grouped = groupDigits(int, !!opts.indian);
    s = (neg ? '-' : '') + grouped + (frac.length ? '.' + frac : '');
  } else {
    const neg = s.startsWith('-');
    const int = neg ? s.slice(1) : s;
    s = (neg ? '-' : '') + groupDigits(int, !!opts.indian);
  }
  if (s === '-0') s = '0';
  return s;
}

export function formatMoney(value: Decimal, code: string): string {
  const def = currencyByCode(code);
  const num = formatNumber(value, { maxDecimals: code === 'BTC' ? 8 : 2, indian: !!def?.indianGrouping });
  if (def?.symbol && def.prefix) {
    if (num.startsWith('-')) return `-${def.symbol}${num.slice(1)}`;
    return `${def.symbol}${num}`;
  }
  return `${num} ${code}`;
}

export function formatDate(q: Quantity): string {
  const d = q.date!;
  return d.toFormat('d LLL yyyy');
}

export function formatTime(q: Quantity): string {
  const d = q.date!;
  const t = d.minute === 0 && d.second === 0 ? d.toFormat('h a') : d.second === 0 ? d.toFormat('h:mm a') : d.toFormat('h:mm:ss a');
  if (q.showZone) return `${t} ${d.toFormat('ZZZZ')}`;
  return t;
}

export function formatQuantity(q: Quantity): string {
  if (q.display) return q.display;
  switch (q.kind) {
    case 'number':
      return formatNumber(q.value);
    case 'percent':
      return `${formatNumber(q.value)}%`;
    case 'money':
      return formatMoney(q.value, q.currency!);
    case 'unit': {
      const u = unitById(q.unit!);
      const sym = u?.symbol ?? q.unit;
      const n = formatNumber(q.value, { maxDecimals: 2 });
      if (u?.dim === 'time' && ['day', 'week', 'month', 'year'].includes(u.id)) {
        const singular = u.id;
        const plural = u.symbol;
        return `${n} ${q.value.abs().eq(1) ? singular : plural}`;
      }
      if (u?.dim === 'temperature') return u.id === 'k' ? `${n} K` : `${n}${sym}`;
      return `${n} ${sym}`;
    }
    case 'date':
      return formatDate(q);
    case 'time':
      return formatTime(q);
  }
}
