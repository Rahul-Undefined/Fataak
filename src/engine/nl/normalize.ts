/**
 * Multilingual normalisation: rewrites English / Hinglish / Bengalish phrasing into a small
 * canonical English vocabulary that the intent matcher understands. Purely lexical.
 */

export type Canon =
  | 'increase' | 'decrease' | 'add' | 'remove' | 'inclusive' | 'gst' | 'discount' | 'profit' | 'loss' | 'cost' | 'sell'
  | 'margin' | 'markup' | 'emi' | 'loan' | 'interest' | 'simple' | 'compound' | 'convert' | 'change'
  | 'of' | 'on' | 'in' | 'to' | 'from' | 'for' | 'at' | 'what' | 'after' | 'before' | 'between' | 'and' | 'with' | 'without'
  | 'years' | 'months' | 'weeks' | 'days' | 'hours' | 'minutes'
  | 'monthly' | 'quarterly' | 'half-yearly' | 'yearly' | 'daily'
  | 'today' | 'tomorrow' | 'yesterday' | 'next' | 'last' | 'this'
  | 'time' | 'now' | '%';

/** multi-word phrases first (longest match wins), then single words */
const PHRASES: [string, string][] = [
  // --- percent ---
  ['percent', '%'], ['per cent', '%'], ['pratishat', '%'], ['protishot', '%'], ['pc', '%'], ['pct', '%'], ['prtishat', '%'], ['shotangsho', '%'], ['shatangsh', '%'],
  // --- what / question words (dropped or → what) ---
  ['kya hoga', 'what'], ['kya hogi', 'what'], ['kya hai', 'what'], ['kya hain', 'what'], ['kitna hoga', 'what'], ['kitna hogi', 'what'], ['kitni hogi', 'what'], ['kitna hai', 'what'],
  ['kitne hain', 'what'], ['koto hobe', 'what'], ['kato hobe', 'what'], ['koto hbe', 'what'], ['ki hobe', 'what'], ['koto ache', 'what'], ['kotota', 'what'], ['how much', 'what'], ['how many', 'what'],
  ['what is', 'what'], ['what will be', 'what'], ['what would be', 'what'], ["what's", 'what'], ['whats', 'what'], ['kitna', 'what'], ['kitni', 'what'], ['kitne', 'what'], ['kya', 'what'],
  ['koto', 'what'], ['kato', 'what'], ['kot', 'what'], ['kto', 'what'], ['ktna', 'what'], ['kitta', 'what'],
  // --- increase ---
  ['badha do', 'increase'], ['bada do', 'increase'], ['barha do', 'increase'], ['badhaa do', 'increase'], ['up by', 'increase'], ['bump up', 'increase'], ['upar karo', 'increase'], ['barhaye', 'increase'],
  ['badhao', 'increase'], ['badhado', 'increase'], ['badha', 'increase'], ['badhaye', 'increase'], ['badhana', 'increase'], ['badhane', 'increase'], ['badhakar', 'increase'], ['badhne', 'increase'], ['badhaao', 'increase'],
  ['barhao', 'increase'], ['barhado', 'increase'], ['barha', 'increase'], ['barhane', 'increase'], ['barhakar', 'increase'], ['badhega', 'increase'], ['badhegi', 'increase'], ['badhai', 'increase'], ['badhaya', 'increase'],
  ['barao', 'increase'], ['barale', 'increase'], ['baralam', 'increase'], ['barabe', 'increase'], ['barabo', 'increase'], ['baraben', 'increase'], ['barate', 'increase'], ['bariye', 'increase'], ['barie', 'increase'],
  ['barano', 'increase'], ['barlo', 'increase'], ['barle', 'increase'], ['barben', 'increase'], ['bere', 'increase'], ['barbe', 'increase'], ['barale', 'increase'], ['baralo', 'increase'], ['barhiye', 'increase'],
  ['increased', 'increase'], ['increases', 'increase'], ['increment', 'increase'], ['incremented', 'increase'], ['hike', 'increase'], ['hiked', 'increase'], ['raise', 'increase'], ['raised', 'increase'],
  ['boost', 'increase'], ['grow', 'increase'], ['grows', 'increase'], ['growth', 'increase'], ['appreciate', 'increase'], ['appreciation', 'increase'], ['more', 'increase'], ['zyada', 'increase'], ['jyada', 'increase'],
  ['beshi', 'increase'], ['bodhi', 'increase'], ['briddhi', 'increase'], ['vriddhi', 'increase'], ['brhiddhi', 'increase'],
  // --- decrease ---
  ['kam karo', 'decrease'], ['kam kar do', 'decrease'], ['kam kardo', 'decrease'], ['kam kro', 'decrease'], ['kam kar', 'decrease'], ['ghata do', 'decrease'], ['ghatado', 'decrease'], ['down by', 'decrease'], ['less by', 'decrease'],
  ['ghatao', 'decrease'], ['ghata', 'decrease'], ['ghataye', 'decrease'], ['ghatane', 'decrease'], ['ghatakar', 'decrease'], ['ghatega', 'decrease'], ['ghategi', 'decrease'], ['ghatale', 'decrease'],
  ['komao', 'decrease'], ['komale', 'decrease'], ['komabe', 'decrease'], ['komiye', 'decrease'], ['komate', 'decrease'], ['komabo', 'decrease'], ['komalam', 'decrease'], ['komlo', 'decrease'], ['komano', 'decrease'],
  ['komben', 'decrease'], ['kombe', 'decrease'], ['komle', 'decrease'], ['kom', 'decrease'], ['kam', 'decrease'],
  ['decreased', 'decrease'], ['decreases', 'decrease'], ['reduce', 'decrease'], ['reduced', 'decrease'], ['reduction', 'decrease'], ['cut', 'decrease'], ['lower', 'decrease'], ['drop', 'decrease'], ['drops', 'decrease'],
  ['deduct', 'decrease'], ['deducted', 'decrease'], ['deduction', 'decrease'], ['depreciate', 'decrease'], ['depreciation', 'decrease'], ['less', 'decrease'], ['ghatai', 'decrease'],
  // --- add / remove / inclusive ---
  ['add karo', 'add'], ['add kar do', 'add'], ['add kardo', 'add'], ['add kro', 'add'], ['add koro', 'add'], ['add kore', 'add'], ['add korle', 'add'], ['add korun', 'add'], ['add kor', 'add'], ['jod do', 'add'], ['jor do', 'add'],
  ['jog koro', 'add'], ['jog kore', 'add'], ['jog korle', 'add'], ['laga do', 'add'], ['lagado', 'add'], ['plus karo', 'add'], ['plus koro', 'add'], ['mila ke', 'add'], ['mila kar', 'add'],
  ['jodo', 'add'], ['joro', 'add'], ['jog', 'add'], ['lagao', 'add'], ['lagaao', 'add'], ['lagake', 'add'], ['lagakar', 'add'], ['lagiye', 'add'], ['milake', 'add'], ['milakar', 'add'], ['milao', 'add'],
  ['added', 'add'], ['adding', 'add'], ['plus', 'add'], ['jure', 'add'], ['jor', 'add'],
  ['nikal do', 'remove'], ['nikaal do', 'remove'], ['hata do', 'remove'], ['hatado', 'remove'], ['bad do', 'remove'], ['baad do', 'remove'], ['bad karo', 'remove'], ['baad karo', 'remove'], ['bad diye', 'remove'],
  ['bad dao', 'remove'], ['bad dile', 'remove'], ['bad diyе', 'remove'], ['minus karo', 'remove'], ['minus koro', 'remove'], ['minus kar', 'remove'], ['ghatiye', 'remove'], ['chara', 'without'], ['chhara', 'without'],
  ['nikalo', 'remove'], ['nikaalo', 'remove'], ['nikal', 'remove'], ['nikaal', 'remove'], ['hatao', 'remove'], ['hataao', 'remove'], ['hatake', 'remove'], ['hatakar', 'remove'], ['hata', 'remove'], ['remove', 'remove'],
  ['removed', 'remove'], ['removing', 'remove'], ['exclude', 'remove'], ['excluding', 'remove'], ['excl', 'remove'], ['reverse', 'remove'], ['reversed', 'remove'], ['back out', 'remove'], ['backout', 'remove'], ['alada koro', 'remove'],
  ['inclusive', 'inclusive'], ['incl', 'inclusive'], ['including', 'inclusive'], ['included', 'inclusive'], ['includes', 'inclusive'], ['samet', 'inclusive'], ['sameth', 'inclusive'], ['sahit', 'inclusive'],
  ['soho', 'inclusive'], ['shoho', 'inclusive'], ['sah', 'inclusive'], ['sahith', 'inclusive'], ['dhore', 'inclusive'],
  ['ke sath', 'with'], ['ke saath', 'with'], ['ke sath me', 'with'], ['er sathe', 'with'], ['er shathe', 'with'], ['sathe', 'with'], ['shathe', 'with'], ['saath', 'with'], ['sath', 'with'],
  ['ke bina', 'without'], ['bina', 'without'], ['chhada', 'without'], ['bade', 'without'],
  // --- GST / discount ---
  ['g.s.t', 'gst'], ['g.s.t.', 'gst'], ['vat', 'gst'], ['tax', 'gst'], ['taxes', 'gst'], ['kar', 'gst'], ['cess', 'gst'],
  ['discounted', 'discount'], ['disc', 'discount'], ['chhoot', 'discount'], ['chhut', 'discount'], ['choot', 'discount'], ['chut', 'discount'], ['chhar', 'discount'], ['chhad', 'discount'], ['rebate', 'discount'],
  ['concession', 'discount'], ['sasta', 'discount'], ['saste', 'discount'],
  // --- profit / loss / cost / sell ---
  ['munafa', 'profit'], ['munaafa', 'profit'], ['labh', 'profit'], ['laabh', 'profit'], ['faida', 'profit'], ['fayda', 'profit'], ['faayda', 'profit'], ['gain', 'profit'], ['laav', 'profit'], ['lav', 'profit'],
  ['profits', 'profit'], ['profit', 'profit'], ['earned', 'profit'], ['kamaya', 'profit'], ['kamai', 'profit'],
  ['nuksan', 'loss'], ['nuksaan', 'loss'], ['ghaata', 'loss'], ['khoti', 'loss'], ['kshati', 'loss'], ['lokshan', 'loss'], ['loksan', 'loss'], ['lost', 'loss'], ['losses', 'loss'], ['loss', 'loss'],
  ['cost price', 'cost'], ['cp', 'cost'], ['c.p.', 'cost'], ['kharida', 'cost'], ['kharidi', 'cost'], ['kharide', 'cost'], ['kharid', 'cost'], ['kharidne', 'cost'], ['khareeda', 'cost'], ['kharidke', 'cost'],
  ['khareed', 'cost'], ['kharidkar', 'cost'], ['kena', 'cost'], ['kene', 'cost'], ['kine', 'cost'], ['kinlam', 'cost'], ['kinechi', 'cost'], ['kinechilam', 'cost'], ['kini', 'cost'], ['kinle', 'cost'], ['kinbo', 'cost'],
  ['bought', 'cost'], ['buy', 'cost'], ['buying', 'cost'], ['purchased', 'cost'], ['purchase', 'cost'], ['lagat', 'cost'], ['laagat', 'cost'], ['costs', 'cost'], ['cost', 'cost'], ['costing', 'cost'],
  ['selling price', 'sell'], ['sale price', 'sell'], ['sp', 'sell'], ['s.p.', 'sell'], ['becha', 'sell'], ['bechi', 'sell'], ['beche', 'sell'], ['bech', 'sell'], ['bechke', 'sell'], ['bechne', 'sell'], ['bechlam', 'sell'],
  ['bechechi', 'sell'], ['bechle', 'sell'], ['bechbo', 'sell'], ['bikri', 'sell'], ['bikra', 'sell'], ['bechkar', 'sell'], ['becho', 'sell'], ['sold', 'sell'], ['selling', 'sell'], ['sale', 'sell'], ['sells', 'sell'], ['sell', 'sell'],
  ['mark up', 'markup'], ['marked up', 'markup'], ['markup', 'markup'], ['marjin', 'margin'], ['margin', 'margin'], ['margins', 'margin'],
  // --- EMI / loan / interest ---
  ['e.m.i', 'emi'], ['e.m.i.', 'emi'], ['kist', 'emi'], ['kisht', 'emi'], ['kisti', 'emi'], ['qist', 'emi'], ['installment', 'emi'], ['instalment', 'emi'], ['installments', 'emi'], ['instalments', 'emi'],
  ['monthly payment', 'emi'], ['monthly instalment', 'emi'], ['monthly installment', 'emi'],
  ['karz', 'loan'], ['karza', 'loan'], ['karja', 'loan'], ['qarz', 'loan'], ['rin', 'loan'], ['reen', 'loan'], ['udhar', 'loan'], ['dhar', 'loan'], ['borrow', 'loan'], ['borrowed', 'loan'], ['loan', 'loan'],
  ['byaj', 'interest'], ['byaaj', 'interest'], ['byaz', 'interest'], ['vyaj', 'interest'], ['vyaaj', 'interest'], ['sood', 'interest'], ['sud', 'interest'], ['sudh', 'interest'], ['shud', 'interest'], ['interest', 'interest'],
  ['simple interest', 'simple interest'], ['sadharan', 'simple'], ['sadharon', 'simple'], ['saral', 'simple'], ['sorol', 'simple'],
  ['compound interest', 'compound interest'], ['compounded', 'compound'], ['compounding', 'compound'], ['chakravriddhi', 'compound'], ['chakrabriddhi', 'compound'], ['chakrabridhi', 'compound'], ['chakravridhi', 'compound'],
  ['chakrobriddhi', 'compound'], ['cumulative', 'compound'],
  ['per annum', 'yearly'], ['p.a.', 'yearly'], ['p.a', 'yearly'], ['per year', 'yearly'], ['annually', 'yearly'], ['annual', 'yearly'], ['salana', 'yearly'], ['saalana', 'yearly'], ['har saal', 'yearly'], ['bochore', 'yearly'],
  ['prati bochor', 'yearly'], ['har mahine', 'monthly'], ['per month', 'monthly'], ['mahine ke hisab', 'monthly'], ['mashik', 'monthly'], ['prati mash', 'monthly'], ['prati maas', 'monthly'], ['monthly', 'monthly'],
  ['half yearly', 'half-yearly'], ['half-yearly', 'half-yearly'], ['semi annually', 'half-yearly'], ['semi-annually', 'half-yearly'], ['semiannually', 'half-yearly'], ['chhamahi', 'half-yearly'],
  ['quarterly', 'quarterly'], ['timahi', 'quarterly'], ['daily', 'daily'], ['roz', 'daily'], ['rozana', 'daily'], ['protidin', 'daily'],
  // --- time units ---
  ['saal', 'years'], ['sal', 'years'], ['saalo', 'years'], ['saalon', 'years'], ['salo', 'years'], ['varsh', 'years'], ['varsho', 'years'], ['bochor', 'years'], ['bochhor', 'years'], ['bachar', 'years'], ['bochorer', 'years'],
  ['bachhar', 'years'], ['year', 'years'], ['years', 'years'], ['yr', 'years'], ['yrs', 'years'],
  ['mahina', 'months'], ['mahine', 'months'], ['mahino', 'months'], ['maheena', 'months'], ['maheene', 'months'], ['mahiney', 'months'], ['maah', 'months'], ['mash', 'months'], ['mashe', 'months'], ['maas', 'months'],
  ['masher', 'months'], ['month', 'months'], ['months', 'months'], ['mos', 'months'],
  ['din', 'days'], ['dino', 'days'], ['dine', 'days'], ['diner', 'days'], ['dinon', 'days'], ['day', 'days'], ['days', 'days'],
  ['hafta', 'weeks'], ['hafte', 'weeks'], ['hapta', 'weeks'], ['hapte', 'weeks'], ['saptah', 'weeks'], ['soptaho', 'weeks'], ['soptah', 'weeks'], ['shoptaho', 'weeks'], ['week', 'weeks'], ['weeks', 'weeks'], ['wk', 'weeks'], ['wks', 'weeks'],
  ['ghanta', 'hours'], ['ghante', 'hours'], ['ghonta', 'hours'], ['ghanto', 'hours'], ['hour', 'hours'], ['hours', 'hours'], ['hr', 'hours'], ['hrs', 'hours'],
  ['minit', 'minutes'], ['minute', 'minutes'], ['minutes', 'minutes'], ['mins', 'minutes'],
  // --- dates ---
  ['aaj se', 'today from'], ['aj se', 'today from'], ['ajke theke', 'today from'], ['aajke theke', 'today from'], ['aj theke', 'today from'], ['aaj theke', 'today from'], ['aj thke', 'today from'],
  ['aaj ke', 'today'], ['aaj', 'today'], ['aj', 'today'], ['ajke', 'today'], ['aajke', 'today'], ['ajker', 'today'], ['aajker', 'today'],
  ['agami kal', 'tomorrow'], ['agamikal', 'tomorrow'], ['kalke', 'tomorrow'], ['kaal', 'tomorrow'], ['kal', 'tomorrow'], ['parso', 'tomorrow + 1 days'], ['porshu', 'tomorrow + 1 days'],
  ['gotokal', 'yesterday'], ['gotkal', 'yesterday'], ['gatokal', 'yesterday'], ['beete kal', 'yesterday'],
  ['aane wala', 'next'], ['aane wale', 'next'], ['aane wali', 'next'], ['agla', 'next'], ['agle', 'next'], ['agli', 'next'], ['porer', 'next'], ['agami', 'next'], ['ashche', 'next'], ['asche', 'next'], ['ashe', 'next'],
  ['pichla', 'last'], ['pichle', 'last'], ['pichli', 'last'], ['pichhle', 'last'], ['gelo', 'last'], ['gato', 'last'], ['goto', 'last'], ['ager', 'last'], ['previous', 'last'],
  ['ke baad', 'after'], ['ke bad', 'after'], ['er pore', 'after'], ['er por', 'after'], ['baad', 'after'], ['pore', 'after'], ['por', 'after'], ['pare', 'after'], ['later', 'after'], ['afterwards', 'after'],
  ['se pehle', 'before'], ['se pahle', 'before'], ['er age', 'before'], ['er aage', 'before'], ['pehle', 'before'], ['pahle', 'before'], ['pahele', 'before'], ['aage', 'before'], ['agey', 'before'], ['earlier', 'before'], ['ago', 'before'],
  ['me se', 'from'], ['mein se', 'from'], ['theke', 'from'], ['thake', 'from'], ['thike', 'from'], ['thekey', 'from'], ['since', 'from'],
  ['tak', 'to'], ['takk', 'to'], ['porjonto', 'to'], ['porjonta', 'to'], ['till', 'to'], ['until', 'to'], ['upto', 'to'], ['up to', 'to'], ['tok', 'to'],
  ['between', 'between'], ['beech', 'between'], ['ke beech', 'between'], ['majhe', 'between'], ['moddhe', 'between'],
  ['kitne baje', 'time'], ['kitna baje', 'time'], ['kota baje', 'time'], ['koto baje', 'time'], ['kotota baje', 'time'], ['baje', 'time'], ['samay', 'time'], ['somoy', 'time'], ["o'clock", 'time'], ['oclock', 'time'],
  ['ekhon', 'now'], ['abhi', 'now'], ['right now', 'now'], ['currently', 'now'], ['current', 'now'],
  // --- convert ---
  ['convert karo', 'convert'], ['convert kar do', 'convert'], ['convert koro', 'convert'], ['convert kore', 'convert'], ['badlo', 'convert'], ['badal do', 'convert'], ['bodlao', 'convert'], ['bodle', 'convert'],
  ['converted', 'convert'], ['converting', 'convert'], ['conversion', 'convert'], ['convert', 'convert'], ['banao', 'convert'], ['bana do', 'convert'], ['banado', 'convert'],
  ['change', 'change'], ['changed', 'change'], ['badlav', 'change'], ['badlaav', 'change'], ['poriborton', 'change'], ['parivartan', 'change'],
  // --- connectors ---
  ['er upor', 'on'], ['er upore', 'on'], ['ke upar', 'on'], ['ke upor', 'on'], ['ke uper', 'on'], ['upor', 'on'], ['upar', 'on'], ['uper', 'on'], ['pe', 'on'], ['par', 'on'], ['pr', 'on'], ['upon', 'on'], ['over', 'on'],
  ['mein', 'in'], ['me', 'in'], ['mai', 'in'], ['main', 'in'], ['te', 'in'], ['e', 'in'], ['ete', 'in'], ['moddhe', 'in'],
  ['ka', 'of'], ['ki', 'of'], ['ke', 'of'], ['kaa', 'of'], ['er', 'of'], ['r', 'of'],
  ['ke liye', 'for'], ['liye', 'for'], ['jonno', 'for'], ['jonne', 'for'], ['jonnyo', 'for'],
  ['ki dar se', 'at'], ['dar se', 'at'], ['ke rate se', 'at'], ['rate se', 'at'], ['rate', 'at'], ['dar', 'at'], ['dor', 'at'], ['har', 'at'], ['hare', 'at'], ['@', 'at'],
  ['aur', 'and'], ['ar', 'and'], ['ebong', 'and'], ['evam', 'and'], ['o', 'and'], ['&', 'and'],
  // --- numbers in words ---
  ['ek', '1'], ['dui', '2'], ['teen', '3'], ['tin', '3'], ['paanch', '5'], ['panch', '5'], ['pach', '5'], ['chhe', '6'], ['che', '6'], ['chhoy', '6'], ['choy', '6'], ['saat', '7'], ['sat', '7'], ['aath', '8'], ['aat', '8'],
  ['nau', '9'], ['noy', '9'], ['das', '10'], ['dosh', '10'], ['derh', '1.5'], ['dedh', '1.5'], ['der', '1.5'], ['dhai', '2.5'], ['dhaai', '2.5'], ['arai', '2.5'], ['aarai', '2.5'], ['adha', '0.5'], ['aadha', '0.5'], ['ardhek', '0.5'],
  ['one', '1'], ['two', '2'], ['three', '3'], ['four', '4'], ['five', '5'], ['six', '6'], ['seven', '7'], ['eight', '8'], ['nine', '9'], ['ten', '10'], ['eleven', '11'], ['twelve', '12'], ['twenty', '20'], ['fifty', '50'],
];

/** words that carry no meaning for calculation and are dropped */
const FILLERS = new Set([
  'mera', 'meri', 'mere', 'mujhe', 'mujhko', 'hamara', 'hamari', 'humara', 'humari', 'hamare', 'amar', 'amader', 'tomar', 'apnar', 'apna', 'apni', 'apne', 'tumhara', 'tumhari',
  'the', 'a', 'an', 'please', 'plz', 'pls', 'zara', 'jara', 'ektu', 'thoda', 'thora', 'toh', 'tho', 'hi', 'bhi', 'o', 'ye', 'yeh', 'yah', 'wo', 'woh', 'ei', 'oi', 'eta', 'ota', 'sei', 'ta', 'ti', 'ko', 'kore', 'korle',
  'hai', 'hain', 'hoga', 'hogi', 'honge', 'ho', 'hoon', 'hobe', 'hoy', 'hoye', 'hoilo', 'holo', 'hole', 'ache', 'achhe', 'thakbe', 'hoyeche', 'hoye', 'hocche', 'hochche',
  'batao', 'bata', 'bataiye', 'batana', 'bolo', 'bol', 'bolun', 'boliye', 'dekhao', 'dekha', 'dikhao', 'calculate', 'compute', 'find', 'tell', 'show', 'give', 'get', 'do', 'kar', 'karo', 'koro', 'karna', 'kori', 'kara', 'karke',
  'karne', 'karein', 'kijiye', 'korun', 'korbo', 'korben', 'korte', 'dile', 'dila', 'dilam', 'diye', 'dao', 'dau', 'deoa', 'dewa', 'dijiye', 'dedo', 'liya', 'li', 'lo', 'le', 'leke', 'niye', 'nilam', 'hisab', 'hisaab', 'hishab', 'hishaab', 'calc', 'me', 'us', 'i', 'we', 'you', 'is', 'are', 'be', 'will', 'would', 'should', 'can', 'could', 'it', 'that',
  'if', 'agar', 'jodi', 'then', 'so', 'ok', 'just', 'then', 'par', 'lagbe', 'lagega', 'lagegi', 'dena', 'dene', 'dite', 'dibe', 'debe', 'hoga',
  'amount', 'value', 'result', 'answer', 'figure', 'number', 'price', 'rakam', 'daam', 'dam', 'rakom', 'paisa', 'paise', 'poysa', 'poisa', 'rupay', 'wala', 'wali', 'wale', 'bala',
]);

const PHRASE_LIST = PHRASES.slice().sort((a, b) => b[0].split(' ').length - a[0].split(' ').length || b[0].length - a[0].length);

/** canonical verbs / nouns (used by highlighting too) */
export const CANON_KEYWORDS = new Set<string>([
  'increase', 'decrease', 'add', 'remove', 'inclusive', 'gst', 'discount', 'profit', 'loss', 'cost', 'sell', 'margin', 'markup', 'emi', 'loan', 'interest', 'simple', 'compound',
  'convert', 'change', 'what', 'after', 'before', 'between', 'with', 'without', 'yearly', 'monthly', 'quarterly', 'half-yearly', 'daily', 'time', 'now', 'today', 'tomorrow', 'yesterday', 'next', 'last', 'from', 'to', 'in', 'of', 'on', 'at', 'for',
]);

/** every source word/phrase the normaliser knows (for syntax highlighting of Hinglish/Bengalish verbs) */
export const SOURCE_WORDS = new Set<string>(PHRASES.map(([k]) => k));

export interface Normalized {
  /** canonical words */
  words: string[];
  /** notes about assumptions made while normalising (e.g. 'kal' read as tomorrow) */
  notes: string[];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalize(text: string): Normalized {
  const notes: string[] = [];
  let s = text.toLowerCase();
  s = s.replace(/[?!¿]/g, ' ');
  s = s.replace(/,\s/g, ' ');
  s = s.replace(/(\d)\s*%/g, '$1%');
  s = s.replace(/\s+/g, ' ').trim();
  if (/\bkal\b/.test(s)) notes.push('kal = tomorrow');
  for (const [from, to] of PHRASE_LIST) {
    const re = new RegExp(`(^|[^\\p{L}\\d])${escapeRe(from)}(?=$|[^\\p{L}\\d])`, 'gu');
    s = s.replace(re, (_m, pre: string) => `${pre}${to}`);
  }
  s = s.replace(/(\d)\s*%/g, '$1%');
  // "percent"/"%" immediately after a number already glued; a standalone "%" stays as a word
  const words = s.split(' ').filter((w) => w && !FILLERS.has(w));
  return { words, notes };
}
