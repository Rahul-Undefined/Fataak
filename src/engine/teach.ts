/**
 * "Teach FATAAK" and "did you mean": the two offline answers to a question FATAAK did not understand.
 *
 * A teach rule maps the user's own phrasing to a form FATAAK already knows. Numbers in the phrasing become
 * slots, so one rule covers every amount: teaching "mera tax 15 lakh pe" → "income tax on 15 lakh salary"
 * also answers "mera tax 9 lakh pe". Rules are applied before normalisation, longest phrase first.
 *
 * The suggester scores a catalogue of known question shapes against the words typed (with tolerance for
 * typos) and rewrites the best matches with the user's own numbers. Everything here is deterministic.
 */

export interface TeachRule {
  /** what the user types, lower-cased; numbers may appear and become slots */
  from: string;
  /** what FATAAK understands; the same numbers in the same order */
  to: string;
  createdAt: number;
}

const NUM_IN_TEXT = /\d[\d,]*(?:\.\d+)?%?/g;

export function sanitizeRules(raw: unknown): TeachRule[] {
  if (!Array.isArray(raw)) return [];
  const out: TeachRule[] = [];
  const seen = new Set<string>();
  for (const r of raw.slice(0, 500)) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.from !== 'string' || typeof o.to !== 'string') continue;
    const from = cleanPhrase(o.from);
    const to = cleanPhrase(o.to);
    if (!from || !to || from.length > 200 || to.length > 200 || seen.has(from)) continue;
    seen.add(from);
    out.push({ from, to, createdAt: Number.isFinite(o.createdAt) ? Number(o.createdAt) : Date.now() });
  }
  return out;
}

export function cleanPhrase(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** why a rule cannot be saved, or null when it is fine */
export function ruleProblem(fromRaw: string, toRaw: string): string | null {
  const from = cleanPhrase(fromRaw);
  const to = cleanPhrase(toRaw);
  if (!from) return 'type the way you ask the question';
  if (!to) return 'type the form FATAAK understands';
  if (from === to) return 'both sides are the same';
  if (!/[\p{L}]/u.test(from)) return 'your phrasing needs words, not only numbers';
  const nf: string[] = from.match(NUM_IN_TEXT) ?? [];
  const nt: string[] = to.match(NUM_IN_TEXT) ?? [];
  if (nt.length > nf.length) return 'the FATAAK form has numbers that your phrasing does not';
  if (nt.some((n) => !nf.includes(n))) return 'use the same numbers on both sides, in the same meaning';
  return null;
}

interface Compiled {
  re: RegExp;
  /** the `to` text with $1, $2… for the slots, in the order the numbers appear in `from` */
  replacement: string;
  rule: TeachRule;
}

let compiled: Compiled[] = [];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compile(rule: TeachRule): Compiled | null {
  const nums: string[] = rule.from.match(NUM_IN_TEXT) ?? [];
  // the phrase, with each number turned into a capture group
  let pattern = '';
  let last = 0;
  const re = new RegExp(NUM_IN_TEXT.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(rule.from))) {
    pattern += escapeRe(rule.from.slice(last, m.index)).replace(/ /g, '\\s+') + '(\\d[\\d,]*(?:\\.\\d+)?%?)';
    last = m.index + m[0].length;
  }
  pattern += escapeRe(rule.from.slice(last)).replace(/ /g, '\\s+');
  // numbers in `to` refer back to the slot that held the same literal in `from`
  let replacement = rule.to.replace(NUM_IN_TEXT, (n) => {
    const k = nums.indexOf(n);
    return k >= 0 ? `$${k + 1}` : n;
  });
  replacement = replacement.replace(/\$(?!\d)/g, '$$$$');
  try {
    return { re: new RegExp(`(?<![\\p{L}\\d])${pattern}(?![\\p{L}\\d])`, 'giu'), replacement, rule };
  } catch {
    return null;
  }
}

/** install the user's rules (the renderer calls this when they change; tests pass them through evaluateDocument) */
export function setTeachRules(rules: TeachRule[]): void {
  compiled = sanitizeRules(rules)
    .sort((a, b) => b.from.length - a.from.length)
    .map(compile)
    .filter((c): c is Compiled => !!c);
}

export function getTeachRules(): TeachRule[] {
  return compiled.map((c) => c.rule);
}

/** rewrite a line with the installed rules; returns the text and which rules fired */
export function applyTeachRules(text: string): { text: string; applied: TeachRule[] } {
  if (!compiled.length) return { text, applied: [] };
  let s = text;
  const applied: TeachRule[] = [];
  for (const c of compiled) {
    c.re.lastIndex = 0;
    if (!c.re.test(s)) continue;
    c.re.lastIndex = 0;
    s = s.replace(c.re, c.replacement);
    applied.push(c.rule);
  }
  return { text: s, applied };
}

/** apply one rule only (for the live preview while teaching) */
export function previewRule(fromRaw: string, toRaw: string, sample: string): string | null {
  const rule: TeachRule = { from: cleanPhrase(fromRaw), to: cleanPhrase(toRaw), createdAt: 0 };
  const c = compile(rule);
  if (!c) return null;
  c.re.lastIndex = 0;
  if (!c.re.test(sample)) return null;
  c.re.lastIndex = 0;
  return sample.replace(c.re, c.replacement);
}

// ---------------------------------------------------------------- did you mean

interface Shape {
  /** the example FATAAK understands; its numbers are replaced by the user's numbers in order */
  example: string;
  /** words that identify the shape (lower-case); synonyms separated by | inside one slot */
  keys: string[];
  /** how many numbers the shape takes */
  numbers: number;
}

const SHAPES: Shape[] = [
  { example: '25% of 480', keys: ['percent|%|percentage|pratishat', 'of|ka|ki|ke'], numbers: 2 },
  { example: '480 + 25%', keys: ['add|plus|increase|badhao|jyada|zyada', 'percent|%'], numbers: 2 },
  { example: '480 - 25%', keys: ['minus|less|decrease|kam|ghatao|off|discount|chhoot', 'percent|%'], numbers: 2 },
  { example: '120 is what % of 480', keys: ['what|kitna|kitne', 'percent|%|percentage', 'of|ka'], numbers: 2 },
  { example: '% change from 400 to 480', keys: ['change|badlav|growth|increase|decrease', 'percent|%|percentage', 'from|se', 'to|tak'], numbers: 2 },
  { example: '25000 + 18% gst', keys: ['gst'], numbers: 2 },
  { example: '1180 inclusive of 18% gst', keys: ['gst', 'inclusive|including|included|remove|without|base|sahit'], numbers: 2 },
  { example: '1500 - 20% discount + 18% gst', keys: ['discount|off|chhoot', 'gst'], numbers: 3 },
  { example: 'emi 5 lakh at 9% for 5 years', keys: ['emi|loan|instalment|installment|kist|karz|home loan|car loan', 'years|saal|months|mahine'], numbers: 3 },
  { example: 'emi 30 lakh 8.5% 20 years, prepay 2 lakh after 2 years', keys: ['prepay|prepayment|part payment|partpayment|foreclose', 'emi|loan'], numbers: 5 },
  { example: 'simple interest on 10000 at 5% for 2 years', keys: ['interest|byaj|byaaj|sood', 'simple|sadharan'], numbers: 3 },
  { example: 'compound interest on 10000 at 5% for 2 years', keys: ['interest|byaj|byaaj|sood', 'compound|chakravriddhi'], numbers: 3 },
  { example: 'sip 5000 at 12% for 10 years', keys: ['sip|mutual fund|monthly investment'], numbers: 3 },
  { example: 'how much monthly sip for 50 lakh in 10 years at 12%', keys: ['sip', 'target|goal|chahiye|reach|for'], numbers: 3 },
  { example: 'lumpsum 1 lakh at 10% for 15 years', keys: ['lumpsum|lump sum|one time|onetime|ek baar'], numbers: 3 },
  { example: 'fd 2 lakh at 7.1% for 3 years', keys: ['fd|fixed deposit|deposit'], numbers: 3 },
  { example: 'rd 5000 for 2 years at 6.5%', keys: ['rd|recurring'], numbers: 3 },
  { example: 'income tax on 15 lakh salary', keys: ['income tax|tax|itax|tds', 'salary|income|ctc|package|kamai'], numbers: 1 },
  { example: 'income tax on 15 lakh salary old regime', keys: ['tax', 'old|purana', 'regime'], numbers: 1 },
  { example: 'ctc 12 lakh in hand', keys: ['ctc|in hand|inhand|take home|takehome|net salary|haath me|hath me'], numbers: 1 },
  { example: 'paisa double at 9%', keys: ['double|dugna|doubling|72'], numbers: 1 },
  { example: '10 lakh today in 10 years at 6% inflation', keys: ['inflation|mehngai|mehangai|purchasing power|value of money'], numbers: 3 },
  { example: 'rent 25000 with 10 months deposit', keys: ['rent|kiraya', 'deposit|advance|security'], numbers: 2 },
  { example: 'bill 4800, rahul 2 items, priya 1 item', keys: ['bill', 'items|share|hissa'], numbers: 3 },
  { example: 'split 4800 between 4 people', keys: ['split|divide|share|baanto|bant|batna|equally|barabar', 'people|log|logo|friends|dost|ways'], numbers: 2 },
  { example: '1200 + 15% tip split 4 ways', keys: ['tip', 'split|divide|people|ways'], numbers: 3 },
  { example: '5 kg at 450 vs 2 kg at 190, which is cheaper', keys: ['cheaper|sasta|sastaa|better deal|vs|versus|compare'], numbers: 4 },
  { example: 'bought at 500 sold at 650 profit %', keys: ['profit|loss|munafa|nuksan|ghata|fayda', 'sold|sell|bought|cost|kharida|becha'], numbers: 2 },
  { example: '500 with 20% margin', keys: ['margin'], numbers: 2 },
  { example: '500 with 20% markup', keys: ['markup'], numbers: 2 },
  { example: '100 usd in inr', keys: ['usd|dollar|dollars|\\$|euro|eur|gbp|pound|aed|dirham|inr|rupee|rupees|rupaye', 'in|to|me|mein|ka|ke'], numbers: 1 },
  { example: '5 km in miles', keys: ['km|kilometre|kilometer|miles|mile|metre|meter|feet|ft|inch|cm|mm', 'in|to|me|mein|convert|kitne'], numbers: 1 },
  { example: '5 kg in lbs', keys: ['kg|kilo|gram|g|lbs|pound|pounds|ounce|oz', 'in|to|me|mein|convert|kitne'], numbers: 1 },
  { example: '5 ft 10 in in cm', keys: ['ft|feet|foot', 'inch|inches|in', 'cm|centimetre|metre|m'], numbers: 2 },
  { example: '36.6 c in f', keys: ['celsius|c|fahrenheit|f|kelvin|temperature|degree|degrees'], numbers: 1 },
  { example: '2 gb at 50 mbps', keys: ['gb|mb|tb|gigabyte|megabyte', 'mbps|kbps|gbps|speed|download|upload'], numbers: 2 },
  { example: '1 gb in mb', keys: ['gb|mb|tb|kb|gib|mib|gigabyte|megabyte|kilobyte', 'in|to|me|kitne'], numbers: 1 },
  { example: '450 km at 60 km/h', keys: ['km', 'km/h|kmph|kmh|kph|speed|raftar|time|kitna time'], numbers: 2 },
  { example: '60 km/h for 2.5 hours', keys: ['km/h|kmph|speed', 'hours|hour|ghante|minutes'], numbers: 2 },
  { example: 'delhi to jaipur at 15 km/l petrol 105', keys: ['petrol|diesel|fuel|mileage|km/l|kmpl|average'], numbers: 2 },
  { example: '1.5 ton ac 8 hours a day for 30 days at 8 per unit', keys: ['ac|watt|kw|heater|geyser|fridge|electricity|bijli|unit|units|bill'], numbers: 4 },
  { example: 'today + 45 days', keys: ['today|aaj', 'days|din|weeks|hafte|months|mahine|baad|after|later'], numbers: 1 },
  { example: '15 aug 2026 + 1 month', keys: ['jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec', 'add|plus|after|baad|month|months|days|weeks'], numbers: 2 },
  { example: 'days between 1 jan 2026 and 31 dec 2026', keys: ['days|din|kitne din', 'between|and|se|tak|from|to'], numbers: 4 },
  { example: 'days until 1 jan 2027', keys: ['days|din', 'until|till|to|tak|left|bache|baaki|remaining'], numbers: 2 },
  { example: 'what day is 15 aug 2026', keys: ['day|din|weekday|kaunsa din|konsa din|which day'], numbers: 2 },
  { example: 'age if born 15 aug 1990', keys: ['age|umar|umra|born|janam|birthday|dob'], numbers: 2 },
  { example: 'next birthday if born 15 aug 1990', keys: ['birthday|janamdin', 'next|agla|aane wala'], numbers: 2 },
  { example: 'days to diwali 2026', keys: ['diwali|holi|dussehra|eid|christmas|rakhi|raksha bandhan|navratri|ganesh|pongal|onam|baisakhi|republic|independence|festival|tyohar'], numbers: 1 },
  { example: 'week number of 15 nov 2026', keys: ['week number|week no|week|hafta', 'number|no|kaunsa|konsa'], numbers: 2 },
  { example: 'is 2028 a leap year', keys: ['leap'], numbers: 1 },
  { example: '9:30 to 18:45 minus 45 min', keys: ['to|se|tak|between|from', 'minutes|min|break|lunch|hours|ghante|shift|duty'], numbers: 3 },
  { example: '9am to 5pm', keys: ['am|pm|baje', 'to|se|tak'], numbers: 2 },
  { example: 'time left until 5pm', keys: ['left|bacha|baaki|remaining|until|till|tak'], numbers: 1 },
  { example: '6pm ist to est', keys: ['ist|est|pst|cet|gmt|utc|bst|jst|aest|london|new york|dubai|tokyo|sydney|singapore|berlin|paris|toronto|time zone|timezone|time in'], numbers: 1 },
  { example: '3pm + 90 minutes', keys: ['am|pm|baje', 'plus|add|after|baad|minutes|min|hours|ghante'], numbers: 2 },
  { example: 'average of 78, 82, 91', keys: ['average|avg|mean|ausat'], numbers: 2 },
  { example: 'median of 3, 9, 4', keys: ['median'], numbers: 2 },
  { example: 'std of 4, 8, 15, 16', keys: ['std|standard deviation|deviation|sd'], numbers: 2 },
  { example: 'variance of 4, 8, 15, 16', keys: ['variance'], numbers: 2 },
  { example: '90th percentile of 10, 20, 30, 40, 50', keys: ['percentile'], numbers: 2 },
  { example: 'sum of 10, 20, 30', keys: ['sum|total|jod|add all|sab jod'], numbers: 2 },
  { example: 'lcm of 84 and 126', keys: ['lcm|hcf|gcd|lasa|masa|least common|greatest common'], numbers: 2 },
  { example: '2x + 5 = 17', keys: ['x', 'solve|=|equation|value of x|x kya'], numbers: 2 },
  { example: '12 workers 8 days, 16 workers how many days', keys: ['workers|men|people|machines|pipes|mazdoor|aadmi|log', 'days|din|hours'], numbers: 3 },
  { example: '5 pens cost 60, 8 pens?', keys: ['cost|price|daam|keemat|kimat', 'then|to|phir|how much|kitna'], numbers: 3 },
  { example: 'train 300 m at 72 km/h crosses platform 200 m', keys: ['train|platform|bridge|pole'], numbers: 3 },
  { example: 'bmi 70 kg 175 cm', keys: ['bmi|body mass'], numbers: 2 },
  { example: 'bmr 70 kg 175 cm 30 male', keys: ['bmr|basal|metabolic'], numbers: 3 },
  { example: 'tdee 70 kg 175 cm 30 male moderate', keys: ['tdee|calories|calorie|maintenance|daily calories|kitni calories'], numbers: 3 },
  { example: 'calories to lose 0.5 kg a week', keys: ['calories|calorie|deficit', 'lose|weight loss|ghatana|kam karna|ghatao'], numbers: 1 },
  { example: 'water intake 70 kg', keys: ['water|paani|pani|hydration|litre'], numbers: 1 },
  { example: '10000 steps in km', keys: ['steps|kadam|walk|walking'], numbers: 1 },
  { example: '5 km in 28 minutes pace', keys: ['pace|run|running|jog|jogging|speed'], numbers: 2 },
  { example: 'ideal weight for 175 cm', keys: ['ideal|sahi|perfect|healthy', 'weight|wajan|vajan'], numbers: 1 },
  { example: 'grade for 86%', keys: ['grade|cbse|marks', 'percent|%|percentage'], numbers: 1 },
  { example: 'marks needed for 85 average with 78, 82, 91', keys: ['marks|score|number|need|needed|chahiye|required', 'average|avg|target'], numbers: 2 },
  { example: 'cgpa 8.5 in percentage', keys: ['cgpa|gpa|sgpa'], numbers: 1 },
  { example: '250 g flour in cups', keys: ['cup|cups|flour|sugar|butter|rice|atta|maida|chini|tbsp|tsp|tablespoon|teaspoon|katori'], numbers: 1 },
  { example: '350 f in c for oven', keys: ['oven|bake|baking|preheat'], numbers: 1 },
  { example: 'uk 9 shoe in us', keys: ['shoe|shoes|jute|joota|size', 'uk|us|eu|euro'], numbers: 1 },
  { example: 'shirt size for 40 inch chest', keys: ['shirt|tshirt|t-shirt|chest|kurta|size'], numbers: 1 },
  { example: '12,34,567 in words', keys: ['words|word|shabdo|spelling|spell|in english'], numbers: 1 },
  { example: '2026 in roman', keys: ['roman'], numbers: 1 },
  { example: '255 in hex', keys: ['hex|hexadecimal|binary|octal|base'], numbers: 1 },
  { example: 'sqrt(144)', keys: ['sqrt|square root|root|vargmool|underoot'], numbers: 1 },
  { example: '2 ^ 10', keys: ['power|raised|squared|cube|cubed|ki ghat|ka power'], numbers: 2 },
  { example: 'divide 700 in the ratio 3:4', keys: ['ratio|anupat|:'], numbers: 3 },
  { example: '1 million in lakhs', keys: ['million|billion', 'in|to|me|mein|kitne', 'lakh|lakhs|crore|crores'], numbers: 1 },
  { example: '1 crore in lakhs', keys: ['crore|crores', 'in|to|me|mein|kitne', 'lakh|lakhs|million'], numbers: 1 },
  { example: 'distance from earth to moon', keys: ['distance|doori|duri|far|kitna door', 'moon|sun|mars|earth|jupiter|delhi|mumbai|bangalore|chennai|kolkata|london|new york|dubai|everest|ganga'], numbers: 0 },
  { example: 'x = 1 to 12', keys: ['to|tak|range|list', 'from|se'], numbers: 2 },
  { example: 'mere paas 5000 the, 1275 kharch kiye, kitna bacha', keys: ['paas|had|spent|kharch|bacha|left|remaining|received|mile|aaye'], numbers: 2 },
];

const SHAPE_WORDS = SHAPES.map((s) => ({ s, slots: s.keys.map((k) => k.split('|')) }));

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let left = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = Math.min(prev[j] + 1, left + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev[j - 1] = left;
      left = cur;
    }
    prev[b.length] = left;
  }
  return prev[b.length];
}

/** 1 when the typed text contains this keyword, 0.7 when it is a typo away (longer words only), 0 otherwise */
function hasKey(text: string, words: string[], key: string): number {
  if (key.includes(' ')) return text.includes(key) ? 1 : 0;
  if (key.length <= 2) return words.includes(key) || (key === '%' && text.includes('%')) || (key === '$' && text.includes('$')) || (key === ':' && /\d:\d/.test(text)) || (key === '=' && text.includes('=')) ? 1 : 0;
  if (words.includes(key)) return 1;
  if (key.length < 5) return 0;
  const tol = key.length >= 8 ? 2 : 1;
  return words.some((w) => w.length >= 4 && Math.abs(w.length - key.length) <= tol && levenshtein(w, key) <= tol) ? 0.85 : 0;
}

/** topic words that name one calculator outright; a line that says "sip" or "emi" means that, whatever else it says */
const NAMED = new Set(['emi', 'prepay', 'simple', 'compound', 'sip', 'lumpsum', 'fd', 'rd', 'income tax', 'ctc', 'double', 'inflation', 'rent', 'bill', 'split', 'tip', 'cheaper', 'profit', 'margin', 'markup', 'diwali', 'week number', 'leap', 'birthday', 'age', 'average', 'median', 'std', 'variance', 'percentile', 'sum', 'lcm', 'x', 'workers', 'train', 'bmi', 'bmr', 'tdee', 'calories', 'water', 'steps', 'pace', 'ideal', 'grade', 'marks', 'cgpa', 'cup', 'oven', 'shoe', 'shirt', 'words', 'roman', 'hex', 'sqrt', 'power', 'ratio', 'distance', 'paas', 'gst', 'left']);

const CONNECTORS = new Set(['in', 'to', 'me', 'mein', 'ka', 'ki', 'ke', 'of', 'se', 'tak', 'from', 'and', 'for', 'at', 'kitne', 'kitna', 'convert', 'then', 'phir', 'on', 'with', 'what', 'how much']);

export interface Suggestion {
  text: string;
  score: number;
}

/** up to three known forms close to what was typed, with the typed numbers carried over */
export function suggest(line: string, max = 3): Suggestion[] {
  const text = line.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!text || text.length > 300) return [];
  const words = text.replace(/[,?!.]/g, ' ').split(' ').filter(Boolean);
  // the typed numbers, each flagged as a percentage when written as 9%, "9 percent" or "9 pratishat"
  const typed: { n: string; pct: boolean }[] = [];
  const numRe = new RegExp(NUM_IN_TEXT.source, 'g');
  let mm: RegExpExecArray | null;
  while ((mm = numRe.exec(text))) typed.push({ n: mm[0], pct: mm[0].endsWith('%') || /^\s*(?:percent|pratishat|pc)\b/.test(text.slice(mm.index + mm[0].length)) });
  const nums = typed.map((x) => x.n);
  const scored: Suggestion[] = [];
  for (const { s, slots } of SHAPE_WORDS) {
    // the first slot names the topic (weight 1); other slots add 0.5, connector-only slots 0.2; a typo hit counts 0.85
    let score = 0;
    let hits = 0;
    slots.forEach((slot, j) => {
      const w = j === 0 ? (NAMED.has(slot[0]) ? 1.6 : 1) : slot.every((k) => CONNECTORS.has(k)) ? 0.2 : 0.5;
      const best = Math.max(0, ...slot.map((k) => hasKey(text, words, k)));
      if (best) hits++;
      score += w * best;
    });
    if (!hits) continue;
    if (!slots[0].some((k) => hasKey(text, words, k))) score *= 0.5;
    if (s.numbers && nums.length === s.numbers) score += 0.15;
    else if (s.numbers && nums.length === 0) score -= 0.2;
    if (score < 0.45) continue;
    // percentage slots take the typed percentages, plain slots the plain numbers, each in the order typed
    const used = new Set<number>();
    const take = (pct: boolean): string | null => {
      let idx = typed.findIndex((x, j) => !used.has(j) && x.pct === pct);
      if (idx < 0) idx = typed.findIndex((_x, j) => !used.has(j));
      if (idx < 0) return null;
      used.add(idx);
      return typed[idx].n;
    };
    const filled = s.example.replace(NUM_IN_TEXT, (n) => {
      const mine = take(n.endsWith('%'));
      if (mine === null) return n;
      return n.endsWith('%') && !mine.endsWith('%') ? `${mine}%` : mine;
    });
    if (filled.toLowerCase() === text) continue;
    scored.push({ text: filled, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const out: Suggestion[] = [];
  for (const s of scored) {
    if (out.some((o) => o.text === s.text)) continue;
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}
