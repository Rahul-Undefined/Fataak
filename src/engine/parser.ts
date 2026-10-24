import { DateTime } from 'luxon';
import { Decimal, CalcError, type Quantity, type Token, own } from './types';
import { tokenize, significant } from './tokenizer';
import { findUnit, unitById, MAX_UNIT_WORDS } from './units';
import { currencyBySymbol, findCurrency } from './currency';
import { tryParseDate, DATE_KEYWORDS } from './dates';
import { resolveZone, MAX_ZONE_WORDS, type ZoneRef } from './timezone';

export type Node =
  | { t: 'num'; v: Decimal }
  | { t: 'money'; e: Node; code: string }
  | { t: 'percent'; e: Node }
  | { t: 'unit'; e: Node; unit: string }
  | { t: 'scale'; e: Node; mult: Decimal }
  | { t: 'var'; name: string }
  | { t: 'bin'; op: BinOp; l: Node; r: Node }
  | { t: 'neg'; e: Node }
  | { t: 'conv'; e: Node; target: ConvTarget }
  | { t: 'call'; fn: string; args: Node[] }
  | { t: 'lit'; q: Quantity }
  | { t: 'agg'; name: 'sum' | 'avg' | 'prev' | 'count' }
  | { t: 'line'; n: number };

export type BinOp = '+' | '-' | '*' | '/' | '^' | 'mod' | 'of' | 'off' | 'on';
export interface ConvTarget {
  /** "in millions", "in lakhs": display scale */
  scale?: { word: string; mult: Decimal };
  unit?: string;
  currency?: string;
  percent?: boolean;
  /** YYYY-MM-DD for a historical currency rate ("1 usd in inr 10 days ago", "… on 1 jan 2026") */
  date?: string;
  /** time-zone target for a time value ("now + 2 hours in EST", "6pm in Tokyo") */
  zone?: ZoneRef;
  /** two units of one dimension, big then small ("hours and minutes", "feet and inches") */
  compound?: [string, string];
}

export const SCALES: Record<string, string> = {
  hundred: '100',
  k: '1000',
  thousand: '1000',
  thousands: '1000',
  hazaar: '1000',
  hazar: '1000',
  hajar: '1000',
  lakh: '100000',
  lakhs: '100000',
  lac: '100000',
  lacs: '100000',
  lakh_: '100000',
  lokkho: '100000',
  crore: '10000000',
  crores: '10000000',
  cr: '10000000',
  koti: '10000000',
  million: '1000000',
  millions: '1000000',
  mn: '1000000',
  billion: '1000000000',
  billions: '1000000000',
  bn: '1000000000',
  trillion: '1000000000000',
  tn: '1000000000000',
};

export const FUNCTIONS = new Set([
  'sqrt', 'cbrt', 'abs', 'round', 'floor', 'ceil', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'ln', 'log', 'log2', 'log10', 'exp', 'min', 'max', 'fact', 'factorial', 'root',
]);

export const CONV_WORDS = new Set(['in', 'to', 'as', 'into']);
export const AGG_WORDS: Record<string, 'sum' | 'avg' | 'prev' | 'count'> = {
  sum: 'sum', total: 'sum', avg: 'avg', average: 'avg', mean: 'avg', prev: 'prev', ans: 'prev', previous: 'prev', count: 'count',
};
/** functions that take an explicit list: median(3, 9, 4), lcm(84, 126), gcd(12, 18), mode(1, 2, 2) */
export const LIST_CALL_FNS = new Set(['median', 'lcm', 'gcd', 'mode']);
export const KEYWORDS = new Set([...LIST_CALL_FNS, ...CONV_WORDS, 'of', 'off', 'on', 'mod', 'x', 'what', 'is', 'and', 'per', 'at', 'by', 'from', ...Object.keys(AGG_WORDS), ...DATE_KEYWORDS, ...FUNCTIONS, 'pi']);

export interface ParseOptions {
  variables: Set<string>;
  now: DateTime;
  zone: string;
}

class Parser {
  private i = 0;
  constructor(
    private toks: Token[],
    private opts: ParseOptions,
  ) {}

  private peek(o = 0): Token | undefined {
    return this.toks[this.i + o];
  }
  private next(): Token {
    return this.toks[this.i++];
  }
  private atEnd(): boolean {
    return this.i >= this.toks.length;
  }
  private isWord(v?: string, o = 0): boolean {
    const t = this.peek(o);
    return !!t && t.type === 'word' && (v === undefined || t.value === v);
  }
  private isOp(v: string, o = 0): boolean {
    const t = this.peek(o);
    return !!t && t.type === 'op' && t.value === v;
  }
  private fail(msg: string, hint?: string): never {
    throw new CalcError(msg, hint);
  }

  parseAll(): Node {
    if (this.atEnd()) this.fail('empty');
    const n = this.expr(0);
    if (!this.atEnd()) {
      const t = this.peek()!;
      this.fail(`unexpected "${t.text}"`);
    }
    return n;
  }

  private binPrec(): { op: BinOp; prec: number; rightAssoc?: boolean; width: number } | null {
    const t = this.peek();
    if (!t) return null;
    if (t.type === 'op') {
      switch (t.value) {
        case '+':
          return { op: '+', prec: 1, width: 1 };
        case '-':
          return { op: '-', prec: 1, width: 1 };
        case '*':
          return { op: '*', prec: 2, width: 1 };
        case '/':
          return { op: '/', prec: 2, width: 1 };
        case '^':
          return { op: '^', prec: 3, rightAssoc: true, width: 1 };
      }
      return null;
    }
    if (t.type === 'word') {
      switch (t.value) {
        case 'plus':
          return { op: '+', prec: 1, width: 1 };
        case 'minus':
          return { op: '-', prec: 1, width: 1 };
        case 'times':
          return { op: '*', prec: 2, width: 1 };
        case 'x':
          return this.opts.variables.has('x') ? null : { op: '*', prec: 2, width: 1 };
        case 'and':
        case 'with':
          return { op: '+', prec: 1, width: 1 };
        case 'without':
        case 'subtract':
          return { op: '-', prec: 1, width: 1 };
        case 'mul':
          return { op: '*', prec: 2, width: 1 };
        // spelled out, "10 + 5 divided by 5" means the whole sum divided: these bind looser than + and -
        case 'divide':
          return this.isWord('by', 1) ? { op: '/', prec: 0.5, width: 2 } : { op: '/', prec: 2, width: 1 };
        case 'mod':
          return { op: 'mod', prec: 2, width: 1 };
        case 'of':
          return { op: 'of', prec: 2, width: 1 };
        case 'off':
          return { op: 'off', prec: 2, width: 1 };
        case 'on':
          return { op: 'on', prec: 2, width: 1 };
        case 'divided':
          return this.isWord('by', 1) ? { op: '/', prec: 0.5, width: 2 } : null;
        case 'multiplied':
          return this.isWord('by', 1) || this.isWord('with', 1) ? { op: '*', prec: 0.5, width: 2 } : null;
        // the canonical words the language layer produces for "multiplied by" / "divided by"
        case 'multipliedby':
          return { op: '*', prec: 0.5, width: 1 };
        case 'dividedby':
          return { op: '/', prec: 0.5, width: 1 };
      }
    }
    if (t.type === 'paren' && t.value === '(') return { op: '*', prec: 2, width: 0 };
    return null;
  }

  expr(minPrec: number): Node {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (!t) break;
      // conversion: lowest precedence, postfix-like; keeps looping so "- 4%" after it applies to the result
      if (t.type === 'word' && CONV_WORDS.has(t.value) && minPrec <= 0) {
        const target = this.tryConvTarget(1);
        if (!target) {
          const w = this.peek(1);
          if (!w) this.fail(`${t.value} what?`, 'e.g. in USD, in km');
          this.fail(`unknown unit "${w.text}"`);
        }
        this.i += 1 + target.width;
        if (target.target.currency) {
          const d = this.tryRateDate();
          if (d) {
            target.target.date = d.date;
            this.i += d.width;
          }
        }
        left = { t: 'conv', e: left, target: target.target };
        continue;
      }
      const b = this.binPrec();
      if (!b || b.prec < minPrec) break;
      this.i += b.width;
      const right = this.expr(b.rightAssoc ? b.prec : b.prec + 1);
      left = { t: 'bin', op: b.op, l: left, r: right };
    }
    return left;
  }

  /** optional date after a currency target: "10 days ago", "on 1 jan 2026", "as of yesterday", "last friday" */
  private tryRateDate(): { date: string; width: number } | null {
    // "using the historical rate for 1 January 2025", "as of yesterday", "on 1 jan 2026", "dated …"
    const skip = new Set(['on', 'at', 'as', 'of', 'using', 'use', 'the', 'historical', 'historic', 'rate', 'rates', 'exchange', 'for', 'from', 'dated', 'date', 'with', 'per']);
    let off = 0;
    while (off < 8 && this.peek(off)?.type === 'word' && skip.has(this.peek(off)!.value)) off++;
    const d = tryParseDate(this.toks, this.i + off, this.opts.now, this.opts.zone);
    if (!d || d.q.kind !== 'date') return null;
    const iso = d.q.date!.toISODate();
    if (!iso) return null;
    return { date: iso, width: off + d.consumed };
  }

  private tryConvTarget(offset: number): { target: ConvTarget; width: number } | null {
    // "5 lakh in millions", "2.5 crore in lakhs": a scale word as the target
    const sw = this.peek(offset);
    if (sw && sw.type === 'word') {
      const key = sw.value.replace(/s$/, '');
      const plural: Record<string, string> = { million: 'million', lakh: 'lakh', crore: 'crore', thousand: 'thousand', billion: 'billion', hazaar: 'hazaar', hazar: 'hazar' };
      if (own(plural, key) && own(SCALES, key) && (this.peek(offset + 1) === undefined || this.peek(offset + 1)!.type === 'op' || this.peek(offset + 1)!.type === 'paren')) {
        return { target: { scale: { word: key, mult: new Decimal(SCALES[key]) } }, width: 1 };
      }
    }
    const t = this.peek(offset);
    if (!t) return null;
    if (t.type === 'percent') return { target: { percent: true }, width: 1 };
    if (t.type === 'currency') {
      const c = currencyBySymbol(t.text);
      if (c) return { target: { currency: c.code }, width: 1 };
    }
    if (t.type === 'word') {
      const u = this.matchUnit(offset);
      if (u) {
        // "hours and minutes", "feet and inches", "hours minutes": a compound target of the same dimension
        let off2 = offset + u.width;
        if (this.peek(off2)?.value === 'and' || this.peek(off2)?.value === '&') off2++;
        if (this.peek(off2)?.type === 'word') {
          const u2 = this.matchUnit(off2);
          if (u2 && u2.unit !== u.unit && unitById(u2.unit)!.dim === unitById(u.unit)!.dim && unitById(u.unit)!.factor.gt(unitById(u2.unit)!.factor)) {
            return { target: { compound: [u.unit, u2.unit] }, width: off2 - offset + u2.width };
          }
        }
        return { target: { unit: u.unit }, width: u.width };
      }
      const c = this.matchCurrency(offset);
      if (c) return { target: { currency: c.code }, width: c.width };
      // time zone: "in EST", "in new york", "in kolkata time"
      for (let w = MAX_ZONE_WORDS; w >= 1; w--) {
        const parts: string[] = [];
        for (let k = 0; k < w; k++) {
          const tk = this.peek(offset + k);
          if (!tk || tk.type !== 'word') break;
          parts.push(tk.value);
        }
        if (parts.length !== w) continue;
        const z = resolveZone(parts.join(' '));
        if (z) {
          const extra = this.peek(offset + w)?.value === 'time' ? 1 : 0;
          return { target: { zone: z }, width: w + extra };
        }
      }
    }
    return null;
  }

  /** multi-word unit match at offset (longest first) */
  private matchUnit(offset: number): { unit: string; width: number } | null {
    for (let w = MAX_UNIT_WORDS; w >= 1; w--) {
      const parts: string[] = [];
      let ok = true;
      for (let k = 0; k < w; k++) {
        const t = this.peek(offset + k);
        if (!t || t.type !== 'word') {
          ok = false;
          break;
        }
        parts.push(t.value);
      }
      if (!ok) continue;
      const text = parts.join(' ');
      if (this.opts.variables.has(text)) return null;
      const u = findUnit(text);
      if (u) return { unit: u.id, width: w };
    }
    return null;
  }

  private matchCurrency(offset: number): { code: string; width: number } | null {
    for (let w = 3; w >= 1; w--) {
      const parts: string[] = [];
      let ok = true;
      for (let k = 0; k < w; k++) {
        const t = this.peek(offset + k);
        if (!t || t.type !== 'word') {
          ok = false;
          break;
        }
        parts.push(t.value);
      }
      if (!ok) continue;
      const text = parts.join(' ');
      if (this.opts.variables.has(text)) return null;
      const c = findCurrency(text);
      if (c) return { code: c.code, width: w };
    }
    return null;
  }

  private unary(): Node {
    if (this.isOp('-')) {
      this.next();
      // unary minus binds looser than ^ : -2 ^ 2 = -(2 ^ 2) = -4
      return { t: 'neg', e: this.power() };
    }
    if (this.isOp('+')) {
      this.next();
      if (this.isOp('+') || this.isOp('-')) this.fail('unexpected "+"');
      return this.unary();
    }
    return this.postfix(this.primary());
  }

  /** a postfix operand followed by an optional right-associative exponent chain */
  private power(): Node {
    let base = this.postfix(this.primary());
    if (this.isOp('^')) {
      this.next();
      const exp = this.unary();
      base = { t: 'bin', op: '^', l: base, r: exp };
    }
    return base;
  }

  private postfix(node: Node): Node {
    for (;;) {
      const t = this.peek();
      if (!t) break;
      if (t.type === 'percent') {
        if (node.t === 'percent') this.fail('double %');
        this.next();
        node = { t: 'percent', e: node };
        // Numi: "prev - 5% discount" — only a trailing 'discount' is decoration
        if (this.isWord('discount') && (this.peek(1) === undefined || this.peek(1)!.value === ')')) this.next();
        continue;
      }
      if (t.type === 'op' && t.value === '!') {
        this.next();
        node = { t: 'call', fn: 'fact', args: [node] };
        continue;
      }
      if (t.type === 'word') {
        if (this.opts.variables.has(t.value)) break;
        // "3 ft + 6 in": a final bare "in" after a number is inches
        if (t.value === 'in' && node.t === 'num' && this.peek(1) === undefined) {
          this.next();
          node = { t: 'unit', e: node, unit: 'inch' };
          continue;
        }
        const scaleKey = t.text === 'M' ? 'million' : t.text === 'm' ? '' : t.text === 'K' ? 'k' : t.value;
        // "0 k in c": kelvin, not thousands, when a temperature conversion follows
        const nx = this.peek(1);
        const nx2 = this.peek(2);
        const kelvin = scaleKey === 'k' && nx?.type === 'word' && CONV_WORDS.has(nx.value) && nx2?.type === 'word' && ['c', 'f', 'k', 'celsius', 'fahrenheit', 'kelvin'].includes(nx2.value);
        if (scaleKey && own(SCALES, scaleKey) && !kelvin) {
          this.next();
          node = { t: 'scale', e: node, mult: new Decimal(SCALES[scaleKey]) };
          continue;
        }
        // function names like min/max are not units when followed by '('
        // "50 pounds in rupees": pounds are money when a currency conversion follows
        if ((t.value === 'pound' || t.value === 'pounds') && this.peek(1)?.type === 'word' && CONV_WORDS.has(this.peek(1)!.value) && this.matchCurrency(2)) {
          this.next();
          node = { t: 'money', e: node, code: 'GBP' };
          continue;
        }
        const u = this.matchUnit(0);
        if (u && !(FUNCTIONS.has(t.value) && this.peek(1)?.value === '(')) {
          this.i += u.width;
          node = { t: 'unit', e: node, unit: u.unit };
          // "1 meter 20 cm" / "2 hours 30 minutes": a number + compatible unit directly after → add
          const nt = this.peek();
          if (nt && nt.type === 'number') {
            // "5 ft 10 in in cm": a bare "in" after a length means inches when another "in"/"to" or the end follows
            let u2 = this.matchUnit(1);
            if (!u2 && unitById(u.unit)!.dim === 'length' && this.peek(1)?.value === 'in') {
              const after = this.peek(2);
              if (!after || (after.type === 'word' && CONV_WORDS.has(after.value)) || after.type === 'op' || after.type === 'paren') u2 = { unit: 'inch', width: 1 };
            }
            if (u2 && unitById(u2.unit)!.dim === unitById(u.unit)!.dim) {
              this.next();
              this.i += u2.width;
              // result in the last-mentioned (smaller) unit, as Numi does: 1 meter 20 cm = 120 cm
              node = { t: 'bin', op: '+', l: { t: 'unit', e: { t: 'num', v: new Decimal(nt.value) }, unit: u2.unit }, r: node };
            }
          }
          continue;
        }
        const c = this.matchCurrency(0);
        if (c) {
          if (node.t === 'money') this.fail(`unexpected "${t.text}"`, 'one currency per amount; use "in" to convert');
          this.i += c.width;
          node = { t: 'money', e: node, code: c.code };
          continue;
        }
      }
      // a currency symbol after a value ("rahul Rs in USD"): tags/converts it
      if (t.type === 'currency' && this.peek(1)?.type !== 'number') {
        const c = currencyBySymbol(t.text);
        if (c && node.t === 'money') this.fail(`unexpected "${t.text}"`, 'one currency per amount; use "in" to convert');
        if (c) {
          this.next();
          node = { t: 'money', e: node, code: c.code };
          continue;
        }
      }
      break;
    }
    return node;
  }

  private primary(): Node {
    const t = this.peek();
    if (!t) this.fail('incomplete expression');
    if (t.type === 'number') {
      const d = tryParseDate(this.toks, this.i, this.opts.now, this.opts.zone);
      if (d) {
        this.i += d.consumed;
        return { t: 'lit', q: d.q };
      }
      this.next();
      return { t: 'num', v: new Decimal(t.value) };
    }
    if (t.type === 'currency') {
      this.next();
      const c = currencyBySymbol(t.text);
      if (!c) this.fail(`unknown currency ${t.text}`);
      const e = this.unaryNoCurrency();
      return { t: 'money', e, code: c.code };
    }
    if (t.type === 'paren' && t.value === '(') {
      this.next();
      const e = this.expr(0);
      if (!(this.peek()?.type === 'paren' && this.peek()!.value === ')')) this.fail('missing )');
      this.next();
      return e;
    }
    if (t.type === 'word') {
      const w = t.value;
      {
        // variable names, multi-word ones first ("office rent"), so a partial first word does not shadow them
        for (let n = 4; n >= 1; n--) {
          const parts: string[] = [];
          for (let k = 0; k < n; k++) {
            const tk = this.peek(k);
            if (!tk || tk.type !== 'word') break;
            parts.push(tk.value);
          }
          if (parts.length === n && this.opts.variables.has(parts.join(' '))) {
            this.i += n;
            return { t: 'var', name: parts.join(' ') };
          }
        }
      }
      if (FUNCTIONS.has(w)) {
        this.next();
        const args: Node[] = [];
        if (this.peek()?.type === 'paren' && this.peek()!.value === '(') {
          this.next();
          if (!(this.peek()?.type === 'paren' && this.peek()!.value === ')')) {
            args.push(this.expr(0));
            while (this.isOp(',')) {
              this.next();
              args.push(this.expr(0));
            }
          }
          if (!(this.peek()?.type === 'paren' && this.peek()!.value === ')')) this.fail('missing )');
          this.next();
        } else if ((w === 'root' || w === 'log') && this.peek()?.type === 'number' && this.peek(1)?.type === 'paren') {
          const base = this.next();
          args.push(this.primary());
          args.push({ t: 'num', v: new Decimal(base.value) });
        } else {
          args.push(this.unary());
        }
        return { t: 'call', fn: w, args };
      }
      const d = tryParseDate(this.toks, this.i, this.opts.now, this.opts.zone);
      if (d) {
        this.i += d.consumed;
        return { t: 'lit', q: d.q };
      }
      // "avg(10, 20, 30)", "sum(1, 2, 3)", "median(3, 9, 4)": an explicit list is a function call, not the block aggregate
      if ((own(AGG_WORDS, w) || LIST_CALL_FNS.has(w)) && this.peek(1)?.type === 'paren' && this.peek(1)!.value === '(') {
        this.next();
        this.next();
        const args: Node[] = [this.expr(0)];
        while (this.isOp(',')) {
          this.next();
          args.push(this.expr(0));
        }
        if (!(this.peek()?.type === 'paren' && this.peek()!.value === ')')) this.fail('missing )');
        this.next();
        const fn = LIST_CALL_FNS.has(w) ? w : AGG_WORDS[w] === 'sum' ? 'sumlist' : AGG_WORDS[w] === 'avg' ? 'avglist' : w;
        return { t: 'call', fn, args };
      }
      if (own(AGG_WORDS, w)) {
        this.next();
        return { t: 'agg', name: AGG_WORDS[w] };
      }
      if (w === 'line' && this.peek(1)?.type === 'number') {
        this.next();
        const n = parseInt(this.next().value, 10);
        return { t: 'line', n };
      }
      if (/^line\d+$/.test(w)) {
        this.next();
        return { t: 'line', n: parseInt(w.slice(4), 10) };
      }
      if (w === 'pi' || w === 'π') {
        this.next();
        return { t: 'num', v: Decimal.acos(-1) };
      }
      if (w === 'e' && !(this.peek(1)?.type === 'number')) {
        this.next();
        return { t: 'num', v: Decimal.exp(1) };
      }
      // currency word before a number: "INR 500", "USD 20"
      const c = this.matchCurrency(0);
      if (c && this.peek(c.width)?.type === 'number') {
        this.i += c.width;
        const e = this.unaryNoCurrency();
        return { t: 'money', e, code: c.code };
      }
      // "half 90", "double 45", "triple x": a factor applied to the operand that follows; alone, the plain number
      const factors: Record<string, string> = { half: '0.5', quarter: '0.25', double: '2', twice: '2', triple: '3', thrice: '3' };
      if (own(factors, w)) {
        this.next();
        // "half of 5000": the "of" is optional
        if (this.isWord('of') && this.peek(1) && this.peek(1)!.type !== 'percent') this.next();
        const nx = this.peek();
        const operandFollows = !!nx && (nx.type === 'number' || nx.type === 'currency' || (nx.type === 'paren' && nx.value === '(') || (nx.type === 'word' && (this.opts.variables.has(nx.value) || nx.value === 'prev' || nx.value === 'that')));
        if (operandFollows) return { t: 'bin', op: '*', l: { t: 'num', v: new Decimal(factors[w]) }, r: this.unary() };
        return { t: 'num', v: new Decimal(factors[w]) };
      }
      if (w === 'what') this.fail('what?', 'try: 20% of what is 30');
      if (KEYWORDS.has(w)) this.fail(`unexpected "${t.text}"`);
      this.next();
      return { t: 'var', name: w };
    }
    this.fail(`unexpected "${t.text}"`);
  }

  private unaryNoCurrency(): Node {
    if (this.isOp('-')) {
      this.next();
      return { t: 'neg', e: this.unaryNoCurrency() };
    }
    const t = this.peek();
    if (!t) this.fail('incomplete expression');
    let node: Node;
    if (t.type === 'number') {
      this.next();
      node = { t: 'num', v: new Decimal(t.value) };
    } else if (t.type === 'paren' && t.value === '(') {
      node = this.primary();
    } else if (t.type === 'word') {
      node = this.primary();
    } else this.fail(`unexpected "${t.text}"`);
    // scale suffix only ($5k, ₹5 lakh); do not re-apply currency words
    for (;;) {
      const p = this.peek();
      const pk = p && p.type === 'word' ? (p.text === 'M' ? 'million' : p.text === 'm' ? '' : p.value) : '';
      if (p && pk && own(SCALES, pk)) {
        this.next();
        node = { t: 'scale', e: node, mult: new Decimal(SCALES[pk]) };
        continue;
      }
      if (p && p.type === 'percent') {
        this.next();
        node = { t: 'percent', e: node };
        continue;
      }
      break;
    }
    return node;
  }
}

export function parseTokens(tokens: Token[], opts: ParseOptions): Node {
  return new Parser(significant(tokens), opts).parseAll();
}

export function parse(text: string, opts: ParseOptions): Node {
  return parseTokens(tokenize(text), opts);
}
