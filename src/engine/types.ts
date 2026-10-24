import Decimal from 'decimal.js';
import type { DateTime } from 'luxon';

Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

export type Kind = 'number' | 'percent' | 'money' | 'unit' | 'date' | 'time';

export interface Quantity {
  kind: Kind;
  /** numeric value; for percent, the percentage number (18 for 18%) */
  value: Decimal;
  /** ISO 4217 code when kind === 'money' */
  currency?: string;
  /** canonical unit id when kind === 'unit' */
  unit?: string;
  /** luxon DateTime when kind === 'date' | 'time' */
  date?: DateTime;
  /** IANA zone the time was expressed in */
  zone?: string;
  /** show the zone abbreviation after the time (tz conversions) */
  showZone?: boolean;
  /** small muted annotation shown after the result */
  note?: string;
  /** pre-formatted display override (finance breakdowns) */
  display?: string;
  /** the unit was asked for explicitly ("in mb"): never re-scaled for display */
  exactUnit?: boolean;
  /** the working, one calculation per line ("10 + 5 = 15") */
  steps?: string[];
}

export interface RateQuote {
  rate: number;
  /** ISO timestamp of when the rate was published */
  timestamp: string;
  source: string;
  /** older than a day */
  stale?: boolean;
  /** served from the on-disk cache because the network fetch failed */
  offline?: boolean;
  /** served from the cache because the user asked for an offline/cached calculation */
  cached?: boolean;
}

export interface RateLookupOptions {
  /** never fetch: answer from the cache or return null */
  cachedOnly?: boolean;
}

export interface RateProvider {
  /** returns null when the pair is not available (offline / unknown); `date` (YYYY-MM-DD) asks for a historical rate */
  get(from: string, to: string, date?: string, opts?: RateLookupOptions): RateQuote | null;
  /** called when a pair was requested but unavailable, so the host can fetch */
  request?(from: string, to: string, date?: string): void;
}

export interface EvalContext {
  variables: Map<string, Quantity>;
  /** results of previous non-empty lines, in order */
  previous: (Quantity | null)[];
  /** results of the current contiguous block (since last blank line) */
  block: Quantity[];
  rates: RateProvider;
  now: () => DateTime;
  /** default IANA zone for naked times */
  zone: string;
  /** index into `previous` before which results are no longer referenced ("clear context") */
  contextStart?: number;
  /** the line asked for an offline/cached calculation: never present a rate as live */
  cachedOnly?: boolean;
  /** the line names a target currency ("… in USD"), so adding different currencies may convert */
  allowMixedCurrency?: boolean;
}

/**
 * Previous-result policy: "that", "previous result", `prev` refer to the nearest line above that
 * produced a value. Blank lines, plain text and failed lines are skipped (a failed line never
 * replaces the last valid result); an explicit "clear context" line is a hard stop.
 */
export function lastValidResult(ctx: EvalContext): Quantity | null {
  const start = ctx.contextStart ?? 0;
  for (let i = ctx.previous.length - 1; i >= start; i--) {
    const p = ctx.previous[i];
    if (p) return p;
  }
  return null;
}

export type TokenType = 'number' | 'currency' | 'word' | 'op' | 'percent' | 'paren' | 'space' | 'unknown';

export interface Token {
  type: TokenType;
  text: string;
  start: number;
  end: number;
  /** lower-cased text for words */
  value: string;
}

export type HighlightClass = 'label' | 'number' | 'keyword' | 'unit' | 'op' | 'comment' | 'text' | 'variable';

export interface HighlightSpan {
  start: number;
  end: number;
  cls: HighlightClass;
}

export interface LineResult {
  ok: boolean;
  value?: Quantity;
  /** text shown in the result column (a hint when !ok, empty for text lines) */
  display: string;
  /** muted annotation (rate timestamp, zone, breakdown) */
  note?: string;
  /** step-by-step working when the engine can give one */
  steps?: string[];
  /** true if the line was treated as plain text / comment */
  isText: boolean;
  label?: string;
  /** extra names this line defines ("Rahul ko 150, Rohit ko 250") */
  defines?: Record<string, Quantity>;
  /** the line is an explicit "clear context" request */
  resetsContext?: boolean;
  spans: HighlightSpan[];
}

export class CalcError extends Error {
  constructor(
    message: string,
    public hint?: string,
    /** 'data': the expression parsed fine but needed data (a rate, a conversion target) — never retry it as prose */
    public kind: 'parse' | 'data' = 'parse',
  ) {
    super(message);
  }
}

/** own-property lookup for word dictionaries: `'constructor' in {}` is true, `own({}, 'constructor')` is not */
export function own(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}
