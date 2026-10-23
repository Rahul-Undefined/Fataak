import { DateTime } from 'luxon';
import { Decimal, type Quantity } from './types';

export interface ZoneRef {
  zone: string;
  /** short note when an abbreviation is ambiguous */
  note?: string;
  label: string;
}

/** Abbreviations → IANA. Ambiguous ones carry a note stating the assumption. */
export const ZONE_ABBR: Record<string, { zone: string; note?: string }> = {
  ist: { zone: 'Asia/Kolkata', note: 'IST = India' },
  'india time': { zone: 'Asia/Kolkata' },
  'indian time': { zone: 'Asia/Kolkata' },
  'india standard time': { zone: 'Asia/Kolkata' },
  'irish time': { zone: 'Europe/Dublin' },
  'israel time': { zone: 'Asia/Jerusalem' },
  utc: { zone: 'UTC' },
  gmt: { zone: 'UTC', note: 'GMT = UTC+0 (not UK summer time)' },
  z: { zone: 'UTC' },
  bst: { zone: 'Europe/London', note: 'BST = British Summer Time' },
  'uk time': { zone: 'Europe/London' },
  'london time': { zone: 'Europe/London' },
  est: { zone: 'America/New_York', note: 'EST = US Eastern' },
  edt: { zone: 'America/New_York' },
  et: { zone: 'America/New_York', note: 'ET = US Eastern' },
  'eastern time': { zone: 'America/New_York' },
  'eastern': { zone: 'America/New_York' },
  cst: { zone: 'America/Chicago', note: 'CST = US Central (not China)' },
  cdt: { zone: 'America/Chicago' },
  ct: { zone: 'America/Chicago', note: 'CT = US Central' },
  'central time': { zone: 'America/Chicago' },
  mst: { zone: 'America/Denver', note: 'MST = US Mountain' },
  mdt: { zone: 'America/Denver' },
  mt: { zone: 'America/Denver', note: 'MT = US Mountain' },
  'mountain time': { zone: 'America/Denver' },
  pst: { zone: 'America/Los_Angeles', note: 'PST = US Pacific' },
  pdt: { zone: 'America/Los_Angeles' },
  pt: { zone: 'America/Los_Angeles', note: 'PT = US Pacific' },
  'pacific time': { zone: 'America/Los_Angeles' },
  akst: { zone: 'America/Anchorage' },
  akdt: { zone: 'America/Anchorage' },
  hst: { zone: 'Pacific/Honolulu' },
  ast: { zone: 'Asia/Riyadh', note: 'AST = Arabia Standard Time' },
  cet: { zone: 'Europe/Berlin' },
  cest: { zone: 'Europe/Berlin' },
  eet: { zone: 'Europe/Athens' },
  eest: { zone: 'Europe/Athens' },
  wet: { zone: 'Europe/Lisbon' },
  msk: { zone: 'Europe/Moscow' },
  jst: { zone: 'Asia/Tokyo' },
  kst: { zone: 'Asia/Seoul' },
  hkt: { zone: 'Asia/Hong_Kong' },
  sgt: { zone: 'Asia/Singapore' },
  myt: { zone: 'Asia/Kuala_Lumpur' },
  ict: { zone: 'Asia/Bangkok' },
  wib: { zone: 'Asia/Jakarta' },
  pht: { zone: 'Asia/Manila' },
  gst: { zone: 'Asia/Dubai', note: 'GST = Gulf Standard Time' },
  'gulf time': { zone: 'Asia/Dubai' },
  'dubai time': { zone: 'Asia/Dubai' },
  pkt: { zone: 'Asia/Karachi' },
  npt: { zone: 'Asia/Kathmandu' },
  bdt: { zone: 'Asia/Dhaka', note: 'BDT = Bangladesh time' },
  'bangladesh time': { zone: 'Asia/Dhaka' },
  'dhaka time': { zone: 'Asia/Dhaka' },
  'kolkata time': { zone: 'Asia/Kolkata' },
  'delhi time': { zone: 'Asia/Kolkata' },
  'mumbai time': { zone: 'Asia/Kolkata' },
  aest: { zone: 'Australia/Sydney' },
  aedt: { zone: 'Australia/Sydney' },
  acst: { zone: 'Australia/Adelaide' },
  awst: { zone: 'Australia/Perth' },
  nzst: { zone: 'Pacific/Auckland' },
  nzdt: { zone: 'Pacific/Auckland' },
  sast: { zone: 'Africa/Johannesburg' },
  wat: { zone: 'Africa/Lagos' },
  eat: { zone: 'Africa/Nairobi' },
  cat: { zone: 'Africa/Maputo' },
  'china time': { zone: 'Asia/Shanghai' },
  'beijing time': { zone: 'Asia/Shanghai' },
};

export const CITY_ZONES: Record<string, string> = {
  kolkata: 'Asia/Kolkata', calcutta: 'Asia/Kolkata', delhi: 'Asia/Kolkata', 'new delhi': 'Asia/Kolkata', mumbai: 'Asia/Kolkata', bombay: 'Asia/Kolkata',
  bangalore: 'Asia/Kolkata', bengaluru: 'Asia/Kolkata', chennai: 'Asia/Kolkata', hyderabad: 'Asia/Kolkata', pune: 'Asia/Kolkata', ahmedabad: 'Asia/Kolkata',
  india: 'Asia/Kolkata', bharat: 'Asia/Kolkata', kochi: 'Asia/Kolkata', jaipur: 'Asia/Kolkata', lucknow: 'Asia/Kolkata', goa: 'Asia/Kolkata',
  dhaka: 'Asia/Dhaka', bangladesh: 'Asia/Dhaka', chittagong: 'Asia/Dhaka', sylhet: 'Asia/Dhaka',
  karachi: 'Asia/Karachi', lahore: 'Asia/Karachi', islamabad: 'Asia/Karachi', pakistan: 'Asia/Karachi',
  kathmandu: 'Asia/Kathmandu', nepal: 'Asia/Kathmandu', colombo: 'Asia/Colombo', 'sri lanka': 'Asia/Colombo',
  london: 'Europe/London', uk: 'Europe/London', england: 'Europe/London', manchester: 'Europe/London', edinburgh: 'Europe/London', dublin: 'Europe/Dublin', ireland: 'Europe/Dublin',
  'new york': 'America/New_York', nyc: 'America/New_York', 'new york city': 'America/New_York', boston: 'America/New_York', miami: 'America/New_York', atlanta: 'America/New_York',
  washington: 'America/New_York', 'washington dc': 'America/New_York', toronto: 'America/Toronto', montreal: 'America/Toronto', philadelphia: 'America/New_York',
  chicago: 'America/Chicago', dallas: 'America/Chicago', houston: 'America/Chicago', austin: 'America/Chicago', 'mexico city': 'America/Mexico_City', mexico: 'America/Mexico_City',
  denver: 'America/Denver', phoenix: 'America/Phoenix', 'salt lake city': 'America/Denver',
  'los angeles': 'America/Los_Angeles', la: 'America/Los_Angeles', 'san francisco': 'America/Los_Angeles', sf: 'America/Los_Angeles', seattle: 'America/Los_Angeles',
  'san jose': 'America/Los_Angeles', 'san diego': 'America/Los_Angeles', vancouver: 'America/Vancouver', 'las vegas': 'America/Los_Angeles', california: 'America/Los_Angeles',
  anchorage: 'America/Anchorage', honolulu: 'Pacific/Honolulu', hawaii: 'Pacific/Honolulu',
  'sao paulo': 'America/Sao_Paulo', 'são paulo': 'America/Sao_Paulo', brazil: 'America/Sao_Paulo', 'buenos aires': 'America/Argentina/Buenos_Aires', argentina: 'America/Argentina/Buenos_Aires',
  paris: 'Europe/Paris', france: 'Europe/Paris', berlin: 'Europe/Berlin', germany: 'Europe/Berlin', frankfurt: 'Europe/Berlin', munich: 'Europe/Berlin',
  amsterdam: 'Europe/Amsterdam', netherlands: 'Europe/Amsterdam', brussels: 'Europe/Brussels', madrid: 'Europe/Madrid', spain: 'Europe/Madrid', barcelona: 'Europe/Madrid',
  rome: 'Europe/Rome', italy: 'Europe/Rome', milan: 'Europe/Rome', zurich: 'Europe/Zurich', geneva: 'Europe/Zurich', switzerland: 'Europe/Zurich', vienna: 'Europe/Vienna',
  stockholm: 'Europe/Stockholm', sweden: 'Europe/Stockholm', oslo: 'Europe/Oslo', norway: 'Europe/Oslo', copenhagen: 'Europe/Copenhagen', denmark: 'Europe/Copenhagen',
  helsinki: 'Europe/Helsinki', finland: 'Europe/Helsinki', warsaw: 'Europe/Warsaw', poland: 'Europe/Warsaw', prague: 'Europe/Prague', lisbon: 'Europe/Lisbon', portugal: 'Europe/Lisbon',
  athens: 'Europe/Athens', greece: 'Europe/Athens', istanbul: 'Europe/Istanbul', turkey: 'Europe/Istanbul', moscow: 'Europe/Moscow', russia: 'Europe/Moscow', kyiv: 'Europe/Kyiv', kiev: 'Europe/Kyiv',
  dubai: 'Asia/Dubai', uae: 'Asia/Dubai', 'abu dhabi': 'Asia/Dubai', sharjah: 'Asia/Dubai', doha: 'Asia/Qatar', qatar: 'Asia/Qatar', riyadh: 'Asia/Riyadh', 'saudi arabia': 'Asia/Riyadh', saudi: 'Asia/Riyadh',
  jeddah: 'Asia/Riyadh', kuwait: 'Asia/Kuwait', muscat: 'Asia/Muscat', oman: 'Asia/Muscat', bahrain: 'Asia/Bahrain', tehran: 'Asia/Tehran', iran: 'Asia/Tehran',
  'tel aviv': 'Asia/Jerusalem', jerusalem: 'Asia/Jerusalem', israel: 'Asia/Jerusalem', cairo: 'Africa/Cairo', egypt: 'Africa/Cairo',
  nairobi: 'Africa/Nairobi', kenya: 'Africa/Nairobi', lagos: 'Africa/Lagos', nigeria: 'Africa/Lagos', johannesburg: 'Africa/Johannesburg', 'south africa': 'Africa/Johannesburg', 'cape town': 'Africa/Johannesburg',
  singapore: 'Asia/Singapore', 'kuala lumpur': 'Asia/Kuala_Lumpur', malaysia: 'Asia/Kuala_Lumpur', bangkok: 'Asia/Bangkok', thailand: 'Asia/Bangkok', jakarta: 'Asia/Jakarta', indonesia: 'Asia/Jakarta',
  bali: 'Asia/Makassar', manila: 'Asia/Manila', philippines: 'Asia/Manila', 'ho chi minh': 'Asia/Ho_Chi_Minh', hanoi: 'Asia/Ho_Chi_Minh', vietnam: 'Asia/Ho_Chi_Minh',
  'hong kong': 'Asia/Hong_Kong', hongkong: 'Asia/Hong_Kong', shanghai: 'Asia/Shanghai', beijing: 'Asia/Shanghai', china: 'Asia/Shanghai', shenzhen: 'Asia/Shanghai', taipei: 'Asia/Taipei', taiwan: 'Asia/Taipei',
  tokyo: 'Asia/Tokyo', japan: 'Asia/Tokyo', osaka: 'Asia/Tokyo', seoul: 'Asia/Seoul', korea: 'Asia/Seoul', 'south korea': 'Asia/Seoul',
  sydney: 'Australia/Sydney', melbourne: 'Australia/Melbourne', canberra: 'Australia/Sydney', brisbane: 'Australia/Brisbane', perth: 'Australia/Perth', adelaide: 'Australia/Adelaide', australia: 'Australia/Sydney',
  auckland: 'Pacific/Auckland', wellington: 'Pacific/Auckland', 'new zealand': 'Pacific/Auckland', nz: 'Pacific/Auckland',
};

/** Friendly abbreviations for zones where ICU only gives "GMT+5:30" */
const ZONE_LABELS: Record<string, string> = {
  'Asia/Kolkata': 'IST', 'Asia/Dhaka': 'BDT', 'Asia/Dubai': 'GST', 'Asia/Qatar': 'AST', 'Asia/Riyadh': 'AST', 'Asia/Kuwait': 'AST', 'Asia/Bahrain': 'AST', 'Asia/Muscat': 'GST',
  'Asia/Singapore': 'SGT', 'Asia/Kathmandu': 'NPT', 'Asia/Karachi': 'PKT', 'Asia/Colombo': 'IST', 'Asia/Tokyo': 'JST', 'Asia/Seoul': 'KST', 'Asia/Hong_Kong': 'HKT',
  'Asia/Shanghai': 'CST', 'Asia/Taipei': 'CST', 'Europe/Moscow': 'MSK', 'Asia/Bangkok': 'ICT', 'Asia/Ho_Chi_Minh': 'ICT', 'Asia/Jakarta': 'WIB', 'Asia/Makassar': 'WITA',
  'Asia/Kuala_Lumpur': 'MYT', 'Asia/Manila': 'PHT', 'Africa/Johannesburg': 'SAST', 'Africa/Nairobi': 'EAT', 'Africa/Lagos': 'WAT', 'Africa/Cairo': 'EET',
  'Asia/Tehran': 'IRST', 'Asia/Jerusalem': 'IST', 'Europe/Istanbul': 'TRT', 'America/Sao_Paulo': 'BRT', 'America/Argentina/Buenos_Aires': 'ART', 'America/Mexico_City': 'CST',
  'Australia/Perth': 'AWST', 'Australia/Brisbane': 'AEST', 'Asia/Kabul': 'AFT', 'UTC': 'UTC',
};

/** [standard, daylight] labels for zones where ICU (en-US) only gives GMT offsets */
const DST_LABELS: Record<string, [string, string]> = {
  'Europe/London': ['GMT', 'BST'], 'Europe/Dublin': ['GMT', 'IST'], 'Europe/Lisbon': ['WET', 'WEST'],
  'Europe/Berlin': ['CET', 'CEST'], 'Europe/Paris': ['CET', 'CEST'], 'Europe/Amsterdam': ['CET', 'CEST'], 'Europe/Brussels': ['CET', 'CEST'], 'Europe/Madrid': ['CET', 'CEST'],
  'Europe/Rome': ['CET', 'CEST'], 'Europe/Zurich': ['CET', 'CEST'], 'Europe/Vienna': ['CET', 'CEST'], 'Europe/Stockholm': ['CET', 'CEST'], 'Europe/Oslo': ['CET', 'CEST'],
  'Europe/Copenhagen': ['CET', 'CEST'], 'Europe/Warsaw': ['CET', 'CEST'], 'Europe/Prague': ['CET', 'CEST'], 'Europe/Athens': ['EET', 'EEST'], 'Europe/Helsinki': ['EET', 'EEST'], 'Europe/Kyiv': ['EET', 'EEST'],
  'Australia/Sydney': ['AEST', 'AEDT'], 'Australia/Melbourne': ['AEST', 'AEDT'], 'Australia/Adelaide': ['ACST', 'ACDT'], 'Pacific/Auckland': ['NZST', 'NZDT'],
  'America/Sao_Paulo': ['BRT', 'BRST'], 'Asia/Tehran': ['IRST', 'IRDT'], 'Asia/Jerusalem': ['IST', 'IDT'], 'America/Mexico_City': ['CST', 'CDT'],
};

export function zoneAbbrev(d: DateTime): string {
  const z = d.zoneName ?? '';
  if (DST_LABELS[z]) return DST_LABELS[z][d.isInDST ? 1 : 0];
  const icu = d.toFormat('ZZZZ');
  if (/^GMT[+-]/.test(icu) || /^UTC[+-]/.test(icu)) {
    if (ZONE_LABELS[z]) return ZONE_LABELS[z];
    return icu;
  }
  return icu;
}

const ZONE_WORDS = Object.keys(ZONE_ABBR).concat(Object.keys(CITY_ZONES));
export const MAX_ZONE_WORDS = 3;

/** Resolve a phrase (lowercased) to a zone. */
export function resolveZone(phrase: string): ZoneRef | null {
  const p = phrase.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!p) return null;
  if (ZONE_ABBR[p]) return { zone: ZONE_ABBR[p].zone, note: ZONE_ABBR[p].note, label: p.toUpperCase() };
  if (CITY_ZONES[p]) return { zone: CITY_ZONES[p], label: p };
  // IANA id typed directly (Asia/Kolkata)
  if (/^[a-z_]+\/[a-z_]+(\/[a-z_]+)?$/i.test(phrase)) {
    const cand = phrase
      .split('/')
      .map((s) => s.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('_'))
      .join('/');
    const test = DateTime.now().setZone(cand);
    if (test.isValid) return { zone: cand, label: cand };
  }
  return null;
}

export function isZoneWord(word: string): boolean {
  return ZONE_WORDS.includes(word.toLowerCase());
}

/** Find zones mentioned in a word list; returns matches with their word index ranges. */
export function findZones(words: string[]): { ref: ZoneRef; start: number; end: number }[] {
  const out: { ref: ZoneRef; start: number; end: number }[] = [];
  let i = 0;
  while (i < words.length) {
    let matched = false;
    for (let w = MAX_ZONE_WORDS; w >= 1; w--) {
      if (i + w > words.length) continue;
      const phrase = words.slice(i, i + w).join(' ');
      const ref = resolveZone(phrase);
      if (ref) {
        out.push({ ref, start: i, end: i + w });
        i += w;
        matched = true;
        break;
      }
    }
    if (!matched) i++;
  }
  return out;
}

export interface TzConversion {
  /** time in the source zone */
  from: DateTime;
  /** same instant in the target zone */
  to: DateTime;
  fromRef: ZoneRef;
  toRef: ZoneRef;
}

/**
 * Build a DateTime for the given wall-clock time in the source zone and convert it.
 * Ambiguous/invalid wall times during DST transitions resolve the way luxon does (forward shift).
 */
export function convertTime(opts: { hour: number; minute: number; date?: DateTime; fromRef: ZoneRef; toRef: ZoneRef; now: DateTime }): TzConversion {
  const base = (opts.date ?? opts.now).setZone(opts.fromRef.zone, { keepLocalTime: !!opts.date });
  const from = base.startOf('day').set({ hour: opts.hour, minute: opts.minute, second: 0, millisecond: 0 });
  const to = from.setZone(opts.toRef.zone);
  return { from, to, fromRef: opts.fromRef, toRef: opts.toRef };
}

export function tzResultQuantity(c: TzConversion): Quantity {
  const notes: string[] = [];
  const dayDiff = c.to.ordinal + c.to.year * 1000 - (c.from.ordinal + c.from.year * 1000);
  if (dayDiff > 0) notes.push(`next day · ${c.to.toFormat('ccc d LLL')}`);
  else if (dayDiff < 0) notes.push(`previous day · ${c.to.toFormat('ccc d LLL')}`);
  if (c.fromRef.note) notes.push(c.fromRef.note);
  if (c.toRef.note) notes.push(c.toRef.note);
  const t = c.to.minute === 0 ? c.to.toFormat('h a') : c.to.toFormat('h:mm a');
  return {
    kind: 'time',
    value: new Decimal(c.to.toMillis()),
    date: c.to,
    zone: c.toRef.zone,
    showZone: true,
    display: `${t} ${zoneAbbrev(c.to)}`,
    note: notes.length ? notes.join(' · ') : undefined,
  };
}

export function nowInZone(ref: ZoneRef, now: DateTime): Quantity {
  const d = now.setZone(ref.zone);
  return {
    kind: 'time',
    value: new Decimal(d.toMillis()),
    date: d,
    zone: ref.zone,
    showZone: true,
    display: `${d.toFormat('h:mm a')} ${zoneAbbrev(d)}`,
    note: [d.toFormat('ccc d LLL'), ref.note].filter(Boolean).join(' · '),
  };
}
