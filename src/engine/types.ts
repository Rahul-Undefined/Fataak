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
}

export interface RateProvider {
  /** returns null when the pair is not available (offline / unknown); `date` (YYYY-MM-DD) asks for a historical rate */
  get(from: string, to: string, date?: string): RateQuote | null;
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
  /** true if the line was treated as plain text / comment */
  isText: boolean;
  label?: string;
  /** extra names this line defines ("Rahul ko 150, Rohit ko 250") */
  defines?: Record<string, Quantity>;
  spans: HighlightSpan[];
}

export class CalcError extends Error {
  constructor(
    message: string,
    public hint?: string,
  ) {
    super(message);
  }
}

/** own-property lookup for word dictionaries: `'constructor' in {}` is true, `own({}, 'constructor')` is not */
export function own(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}
