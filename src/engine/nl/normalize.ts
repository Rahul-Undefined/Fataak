import { own } from '../types';
/**
 * Multilingual normalisation: rewrites English / Hinglish phrasing into a small
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
  ['percentage', '%'], ['percent', '%'], ['per cent', '%'], ['pratishat', '%'], ['pratisat', '%'], ['pratishat', '%'], ['protishot', '%'], ['pc', '%'], ['pct', '%'], ['prtishat', '%'], ['shotangsho', '%'], ['shatangsh', '%'],
  // --- what / question words (dropped or → what) ---
  ['kya hoga', 'what'], ['kya hogi', 'what'], ['kya hai', 'what'], ['kya hain', 'what'], ['kitna hoga', 'what'], ['kitna hogi', 'what'], ['kitni hogi', 'what'], ['kitna hai', 'what'],
  ['kitne hain', 'what'], ['how much', 'what'], ['how many', 'what'],
  ['what is', 'what'], ['what will be', 'what'], ['what would be', 'what'], ["what's", 'what'], ['whats', 'what'], ['kitna', 'what'], ['kitni', 'what'], ['kitne', 'what'], ['kya', 'what'],
  ['ktna', 'what'], ['kitta', 'what'], ['kis', 'what'], ['kaunsa', 'what'], ['konsa', 'what'], ['kaunse', 'what'], ['kon', 'what'], ['which', 'what'],
  ['barhne', 'increase'], ['badhne', 'increase'], ['ghatne', 'decrease'], ['tha', 'before'], ['thi', 'before'],
  // --- increase ---
  ['badha do', 'increase'], ['bada do', 'increase'], ['barha do', 'increase'], ['badhaa do', 'increase'], ['up by', 'increase'], ['bump up', 'increase'], ['upar karo', 'increase'], ['barhaye', 'increase'],
  ['badhao', 'increase'], ['badhado', 'increase'], ['badha', 'increase'], ['badhaye', 'increase'], ['badhana', 'increase'], ['badhane', 'increase'], ['badhakar', 'increase'], ['badhne', 'increase'], ['badhaao', 'increase'],
  ['barhao', 'increase'], ['barhado', 'increase'], ['barha', 'increase'], ['barhane', 'increase'], ['barhakar', 'increase'], ['badhega', 'increase'], ['badhegi', 'increase'], ['badhai', 'increase'], ['badhaya', 'increase'],
  ['barhiye', 'increase'],
  ['badhi', 'increase'], ['badha hai', 'increase'], ['barhi', 'increase'], ['ghati', 'decrease'], ['ghat gaya', 'decrease'], ['aakhri', 'last'], ['akhri', 'last'], ['antim', 'last'], ['pehla', 'first'], ['increased', 'increase'], ['increases', 'increase'], ['increment', 'increase'], ['incremented', 'increase'], ['hike', 'increase'], ['hiked', 'increase'], ['raise', 'increase'], ['raised', 'increase'],
  ['boost', 'increase'], ['growth', 'increase'], ['appreciate', 'increase'], ['appreciation', 'increase'], ['more', 'increase'], ['zyada', 'increase'], ['jyada', 'increase'],
  ['vriddhi', 'increase'], // --- decrease ---
  ['kam karo', 'decrease'], ['kam kar do', 'decrease'], ['kam kardo', 'decrease'], ['kam kro', 'decrease'], ['kam kar', 'decrease'], ['ghata do', 'decrease'], ['ghatado', 'decrease'], ['down by', 'decrease'], ['less by', 'decrease'],
  ['ghatao', 'decrease'], ['ghata', 'decrease'], ['ghataye', 'decrease'], ['ghatane', 'decrease'], ['ghatakar', 'decrease'], ['ghatega', 'decrease'], ['ghategi', 'decrease'], ['ghatale', 'decrease'],
  ['kam', 'decrease'],
  ['decreased', 'decrease'], ['decreases', 'decrease'], ['reduce', 'decrease'], ['reduced', 'decrease'], ['reduction', 'decrease'], ['cut', 'decrease'], ['lower', 'decrease'], ['drop', 'decrease'], ['drops', 'decrease'],
  ['deduct', 'decrease'], ['deducted', 'decrease'], ['deduction', 'decrease'], ['depreciate', 'decrease'], ['depreciation', 'decrease'], ['less', 'decrease'], ['ghatai', 'decrease'],
  // --- add / remove / inclusive ---
  ['add karo', 'add'], ['add kar do', 'add'], ['add kardo', 'add'], ['add kro', 'add'], ['jod do', 'add'], ['jor do', 'add'],
  ['laga do', 'add'], ['lagado', 'add'], ['plus karo', 'add'], ['mila ke', 'add'], ['mila kar', 'add'],
  ['jodo', 'add'], ['lagao', 'add'], ['lagaao', 'add'], ['lagake', 'add'], ['lagakar', 'add'], ['milake', 'add'], ['milakar', 'add'], ['milao', 'add'],
  // reliability upgrade: English maths verbs, units, balance/invoice/investment vocabulary
  ['raised to the power of', '^'], ['raised to the power', '^'], ['to the power of', '^'], ['to the power', '^'], ['ki power', '^'], ['ka power', '^'],
  ['multiplied by', 'times'], ['multiply by', 'times'], ['divided by', 'divide'], ['divide by', 'divide'],
  ['least common multiple', 'lcm'], ['lowest common multiple', 'lcm'], ['lcm', 'lcm'], ['greatest common divisor', 'gcd'], ['greatest common factor', 'gcd'], ['highest common factor', 'gcd'], ['hcf', 'gcd'], ['gcf', 'gcd'], ['gcd', 'gcd'],
  ['degrees fahrenheit', 'fahrenheit'], ['degree fahrenheit', 'fahrenheit'], ['degrees celsius', 'celsius'], ['degree celsius', 'celsius'], ['degrees centigrade', 'celsius'], ['centigrade', 'celsius'], ['deg f', 'fahrenheit'], ['deg c', 'celsius'],
  ['kilometres per hour', 'km/h'], ['kilometers per hour', 'km/h'], ['km per hour', 'km/h'], ['miles per hour', 'mph'], ['metres per second', 'm/s'], ['meters per second', 'm/s'],
  ['owes', 'owes'], ['owe', 'owes'], ['outstanding', 'owes'], ['udhaar', 'owes'], ['udhar', 'owes'], ['baki hai', 'owes'], ['dena hai', 'owes'],
  ['pays', 'pays'], ['paid', 'pays'], ['pay', 'pays'], ['payment of', 'pays'], ['payment', 'pays'], ['bhugtan', 'pays'], ['de diya', 'pays'], ['chuka diya', 'pays'], ['chukaya', 'pays'],
  ['cost of goods sold', 'cogs'], ['cost of goods', 'cogs'], ['cost of sales', 'cogs'], ['cogs', 'cogs'],
  ['got back', 'sell'], ['now worth', 'sell'], ['worth now', 'sell'], ['matured to', 'sell'], ['maturity value', 'sell'], ['current value', 'sell'],
  ['invested', 'cost'], ['investment of', 'cost'], ['investment', 'cost'], ['invest', 'cost'], ['nivesh', 'cost'], ['return on investment', 'return'], ['roi', 'return'], ['returns', 'return'], ['return', 'return'],
  ['received', 'received'], ['receive', 'received'], ['got', 'received'], ['earned', 'received'], ['credited', 'received'], ['mila', 'received'], ['mile the', 'received'], ['mile hain', 'received'], ['rupaye mile', 'received'], ['mil gaya', 'received'], ['mil gaye', 'received'], ['aaya', 'received'], ['aaye', 'received'], ['kamaya', 'received'], ['kamaye', 'received'],
  ['had', 'had'], ['have', 'had'], ['paas', 'had'], ['pass', 'had'], ['started with', 'had'], ['starting balance', 'had'], ['opening balance', 'had'],
  ['drained', 'remove'], ['drain', 'remove'], ['removed', 'remove'], ['withdrawn', 'remove'], ['withdraw', 'remove'], ['used up', 'remove'], ['nikal liye', 'remove'], ['nikal liya', 'remove'],
  ['remain', 'remaining'], ['remains', 'remaining'], ['left over', 'remaining'], ['is left', 'remaining'], ['left', 'remaining'], ['bache', 'remaining'], ['bacha', 'remaining'], ['bachega', 'remaining'], ['bachenge', 'remaining'],
  ['the next day', ''], ['next day', ''], ['departs at', 'from'], ['departs', 'from'], ['departure', 'from'], ['leaves at', 'from'], ['arrives at', 'to'], ['arrives', 'to'], ['arrival', 'to'], ['reaches', 'to'],
  ['average speed', 'speed'], ['time to travel', 'time'], ['time to cover', 'time'], ['time to drive', 'time'], ['time to reach', 'time'], ['to travel', ''], ['to cover', ''], ['to drive', ''], ['to reach', ''],
  ['fuel needed for', ''], ['petrol needed for', ''], ['diesel needed for', ''], ['fuel for', ''], ['petrol for', ''], ['diesel for', ''], ['fuel required for', ''], ['peeche', 'behind'], ['piche', 'behind'], ['pichhe', 'behind'], ['time gap', 'difference'], ['time difference', 'difference'], ['how long will it take', 'what time'], ['how long does it take', 'what time'], ['how long', 'what time'], ['kitna time lagega', 'what time'], ['kitna samay lagega', 'what time'], ['kitna time', 'what time'], ['half a', '0.5'], ['half an', '0.5'], ['quarter of a', '0.25'], ['find the number', 'what'], ['find the value', 'what'], ['find the amount', 'what'], ['find x', 'what'], ['find it', 'what'], ['old salary', 'what'], ['old price', 'what'], ['old value', 'what'], ['old amount', 'what'],
  ['previous salary', 'what'], ['purani salary', 'what'], ['purana price', 'what'], ['purani price', 'what'], ['maturity', 'total'], ['kaunsi', 'what'], ['konsi', 'what'], ['kitne bajenge', 'time'], ['bajenge', 'time'],
  ['midnight', '12:00 am'], ['noon', '12:00 pm'], ['midday', '12:00 pm'], ['sabse pehle', ''], ['tds', 'decrease'], ['income tax', 'decrease'], ['tax deducted', 'decrease'], ['tax deduction', 'decrease'],
  ['katke', 'decrease'], ['kaatke', 'decrease'], ['kat ke', 'decrease'], ['kaat ke', 'decrease'], ['kaat lo', 'decrease'], ['kaat do', 'decrease'], ['kaato', 'decrease'], ['katao', 'decrease'], ['kaat kar', 'decrease'], ['katne ke baad', 'decrease'],
  ['into', 'in'], ['off on', 'off'], ['out of', 'of'], ['service charge', ''], ['service tax', 'gst'], ['gst amount', 'gst what'], ['tax amount', 'gst what'],
  ['in a day', 'in 1 day'], ['in an hour', 'in 1 hour'], ['in a minute', 'in 1 minute'], ['in a week', 'in 1 week'], ['in a month', 'in 1 month'], ['in a year', 'in 1 year'], ['per day', 'daily'],
  ['pehli tarikh', 'first day'], ['1 tarikh', 'first day'], ['first date', 'first day'], ['last date', 'last day'], ['aakhri tarikh', 'last day'], ['tarikh', 'date'],
  ['added', 'add'], ['adding', 'add'], ['plus', 'add'], ['jor', 'add'],
  ['nikal do', 'remove'], ['nikaal do', 'remove'], ['hata do', 'remove'], ['hatado', 'remove'], ['bad do', 'remove'], ['baad do', 'remove'], ['bad karo', 'remove'], ['baad karo', 'remove'], ['minus karo', 'remove'], ['minus kar', 'remove'], ['nikalo', 'remove'], ['nikaalo', 'remove'], ['nikal', 'remove'], ['nikaal', 'remove'], ['hatao', 'remove'], ['hataao', 'remove'], ['hatake', 'remove'], ['hatakar', 'remove'], ['hata', 'remove'], ['remove', 'remove'],
  ['removed', 'remove'], ['removing', 'remove'], ['exclude', 'remove'], ['excluding', 'remove'], ['excl', 'remove'], ['back out', 'remove'], ['backout', 'remove'], ['inclusive', 'inclusive'], ['incl', 'inclusive'], ['including', 'inclusive'], ['included', 'inclusive'], ['includes', 'inclusive'], ['samet', 'inclusive'], ['sameth', 'inclusive'], ['sahit', 'inclusive'],
  ['sah', 'inclusive'], ['sahith', 'inclusive'], ['ke sath', 'with'], ['ke saath', 'with'], ['ke sath me', 'with'], ['saath', 'with'], ['sath', 'with'],
  ['ke bina', 'without'], ['bina', 'without'], // --- GST / discount ---
  ['g.s.t', 'gst'], ['g.s.t.', 'gst'], ['vat', 'gst'], ['tax', 'gst'], ['taxes', 'gst'], ['cess', 'gst'],
  ['discounted', 'discount'], ['disc', 'discount'], ['chhoot', 'discount'], ['chhut', 'discount'], ['choot', 'discount'], ['chut', 'discount'], ['rebate', 'discount'],
  ['concession', 'discount'], ['sasta', 'discount'], ['saste', 'discount'],
  // --- profit / loss / cost / sell ---
  ['munafa', 'profit'], ['munaafa', 'profit'], ['labh', 'profit'], ['laabh', 'profit'], ['faida', 'profit'], ['fayda', 'profit'], ['faayda', 'profit'], ['gain', 'profit'], ['profits', 'profit'], ['profit', 'profit'], ['earned', 'profit'], ['kamaya', 'profit'], ['kamai', 'profit'],
  ['nuksan', 'loss'], ['nuksaan', 'loss'], ['ghaata', 'loss'], ['lost', 'loss'], ['losses', 'loss'], ['loss', 'loss'],
  ['cost price', 'cost'], ['cp', 'cost'], ['c.p.', 'cost'], ['kharida', 'cost'], ['kharidi', 'cost'], ['kharide', 'cost'], ['kharid', 'cost'], ['kharidne', 'cost'], ['khareeda', 'cost'], ['kharidke', 'cost'],
  ['khareed', 'cost'], ['kharidkar', 'cost'], ['bought', 'cost'], ['buy', 'cost'], ['buying', 'cost'], ['purchased', 'cost'], ['purchase', 'cost'], ['lagat', 'cost'], ['laagat', 'cost'], ['costs', 'cost'], ['cost', 'cost'], ['costing', 'cost'],
  ['selling price', 'sell'], ['sale price', 'sell'], ['sp', 'sell'], ['s.p.', 'sell'], ['becha', 'sell'], ['bechi', 'sell'], ['beche', 'sell'], ['bech', 'sell'], ['bechke', 'sell'], ['bechne', 'sell'], ['bikri', 'sell'], ['bikra', 'sell'], ['bechkar', 'sell'], ['becho', 'sell'], ['sold', 'sell'], ['selling', 'sell'], ['sale', 'sell'], ['sells', 'sell'], ['sell', 'sell'],
  ['mark up', 'markup'], ['marked up', 'markup'], ['markup', 'markup'], ['marjin', 'margin'], ['margin', 'margin'], ['margins', 'margin'],
  // --- EMI / loan / interest ---
  ['e.m.i', 'emi'], ['e.m.i.', 'emi'], ['kist', 'emi'], ['kisht', 'emi'], ['qist', 'emi'], ['installment', 'emi'], ['instalment', 'emi'], ['installments', 'emi'], ['instalments', 'emi'],
  ['monthly payment', 'emi'], ['monthly instalment', 'emi'], ['monthly installment', 'emi'],
  ['karz', 'loan'], ['karza', 'loan'], ['karja', 'loan'], ['qarz', 'loan'], ['udhar', 'loan'], ['dhar', 'loan'], ['borrow', 'loan'], ['borrowed', 'loan'], ['loan', 'loan'],
  ['byaj', 'interest'], ['byaaj', 'interest'], ['byaz', 'interest'], ['vyaj', 'interest'], ['vyaaj', 'interest'], ['sood', 'interest'], ['interest', 'interest'],
  ['simple interest', 'simple interest'], ['sadharan', 'simple'], ['saral', 'simple'], ['compound interest', 'compound interest'], ['compounded', 'compound'], ['compounding', 'compound'], ['chakravriddhi', 'compound'], ['chakravridhi', 'compound'],
  ['cumulative', 'compound'],
  ['per annum', 'yearly'], ['p.a.', 'yearly'], ['p.a', 'yearly'], ['per year', 'yearly'], ['annually', 'yearly'], ['annual', 'yearly'], ['salana', 'yearly'], ['saalana', 'yearly'], ['har saal', 'yearly'], ['har mahine', 'monthly'], ['per month', 'monthly'], ['mahine ke hisab', 'monthly'], ['prati maas', 'monthly'], ['monthly', 'monthly'],
  ['half yearly', 'half-yearly'], ['half-yearly', 'half-yearly'], ['semi annually', 'half-yearly'], ['semi-annually', 'half-yearly'], ['semiannually', 'half-yearly'], ['chhamahi', 'half-yearly'],
  ['quarterly', 'quarterly'], ['timahi', 'quarterly'], ['daily', 'daily'], ['roz', 'daily'], ['rozana', 'daily'], // --- time units ---
  ['saal', 'years'], ['sal', 'years'], ['saalo', 'years'], ['saalon', 'years'], ['salo', 'years'], ['varsh', 'years'], ['varsho', 'years'], ['year', 'years'], ['years', 'years'], ['yr', 'years'], ['yrs', 'years'],
  ['mahina', 'months'], ['mahine', 'months'], ['mahino', 'months'], ['maheena', 'months'], ['maheene', 'months'], ['mahiney', 'months'], ['maah', 'months'], ['maas', 'months'],
  ['month', 'months'], ['months', 'months'], ['mos', 'months'],
  ['din', 'days'], ['dino', 'days'], ['dinon', 'days'], ['day', 'days'], ['days', 'days'],
  ['hafta', 'weeks'], ['hafte', 'weeks'], ['hapta', 'weeks'], ['hapte', 'weeks'], ['saptah', 'weeks'], ['week', 'weeks'], ['weeks', 'weeks'], ['wk', 'weeks'], ['wks', 'weeks'],
  ['ghanta', 'hours'], ['ghante', 'hours'], ['ghanto', 'hours'], ['hour', 'hours'], ['hours', 'hours'], ['hr', 'hours'], ['hrs', 'hours'],
  ['minit', 'minutes'], ['minute', 'minutes'], ['minutes', 'minutes'], ['mins', 'minutes'],
  // --- dates ---
  ['aaj se', 'today from'], ['aj se', 'today from'], ['aaj ke', 'today'], ['aaj', 'today'], ['aj', 'today'], ['kaal', 'tomorrow'], ['kal', 'tomorrow'], ['parso', 'tomorrow + 1 days'], ['beete kal', 'yesterday'],
  ['aane wala', 'next'], ['aane wale', 'next'], ['aane wali', 'next'], ['agla', 'next'], ['agle', 'next'], ['agli', 'next'], ['pichla', 'last'], ['pichle', 'last'], ['pichli', 'last'], ['pichhle', 'last'], ['previous', 'last'],
  ['ke baad', 'after'], ['ke bad', 'after'], ['baad', 'after'], ['later', 'after'], ['afterwards', 'after'],
  ['se pehle', 'before'], ['se pahle', 'before'], ['pehle', 'before'], ['pahle', 'before'], ['pahele', 'before'], ['aage', 'before'], ['earlier', 'before'], ['ago', 'before'],
  ['me se', 'from'], ['mein se', 'from'], ['se', 'from'], ['since', 'from'],
  ['tak', 'to'], ['takk', 'to'], ['till', 'to'], ['until', 'to'], ['upto', 'to'], ['up to', 'to'], ['between', 'between'], ['beech', 'between'], ['ke beech', 'between'], ['kitne baje', 'time'], ['kitna baje', 'time'], ['samay', 'time'], ["o'clock", 'time'], ['oclock', 'time'],
  ['abhi', 'now'], ['right now', 'now'], ['currently', 'now'], ['current', 'now'],
  // --- convert ---
  ['convert karo', 'convert'], ['convert kar do', 'convert'], ['badlo', 'convert'], ['badal do', 'convert'], ['converted', 'convert'], ['converting', 'convert'], ['conversion', 'convert'], ['convert', 'convert'], ['banao', 'convert'], ['bana do', 'convert'], ['banado', 'convert'],
  ['change', 'change'], ['changed', 'change'], ['badlav', 'change'], ['badlaav', 'change'], ['parivartan', 'change'],
  // --- connectors ---
  ['ke upar', 'on'], ['upar', 'on'], ['pe', 'on'], ['par', 'on'], ['pr', 'on'], ['upon', 'on'], ['over', 'on'],
  ['mein', 'in'], ['me', 'in'], ['mai', 'in'], ['main', 'in'], ['ka', 'of'], ['ki', 'of'], ['ke', 'of'], ['kaa', 'of'], ['ke liye', 'for'], ['liye', 'for'], ['ki dar se', 'at'], ['dar se', 'at'], ['ke rate se', 'at'], ['rate se', 'at'], ['rate', 'at'], ['dar', 'at'], ['har', 'at'], ['@', 'at'],
  ['aur', 'and'], ['ar', 'and'], ['evam', 'and'], ['&', 'and'],
  // --- fractions in words (whole numbers are composed by composeNumberWords) ---
  ['derh', '1.5'], ['dedh', '1.5'], ['der', '1.5'], ['dhai', '2.5'], ['dhaai', '2.5'], ['arai', '2.5'], ['aarai', '2.5'], ['adha', 'half'], ['aadha', 'half'], ['aadhi', 'half'], ['adhi', 'half'], ['sawa', '1.25'],
  // --- revenue / expenses (business profit) ---
  ['revenue', 'revenue'], ['revenues', 'revenue'], ['sales', 'revenue'], ['turnover', 'revenue'], ['income', 'revenue'], ['aay', 'revenue'], ['aamdani', 'revenue'], ['amdani', 'revenue'], ['kamai', 'revenue'], ['expenses', 'expenses'], ['expense', 'expenses'], ['expenditure', 'expenses'], ['spending', 'expenses'], ['spent', 'expenses'], ['kharcha', 'expenses'], ['kharch', 'expenses'], ['kharche', 'expenses'], // --- references to a running / previous value ---
  ['previous result', 'prev'], ['last result', 'prev'], ['the result', 'prev'], ['previous answer', 'prev'], ['last answer', 'prev'], ['previous value', 'prev'], ['last value', 'prev'], ['pichla result', 'prev'], ['pichla answer', 'prev'],
  ['pichle wala', 'prev'], ['upar wala', 'prev'], ['result above', 'prev'], ['the above', 'prev'], ['above', 'prev'],
  ['new amount', 'that'], ['previous amount', 'that'], ['naya amount', 'that'], ['usmein', 'that'], ['usme', 'that'], ['us me', 'that'], ['us mein', 'that'], ['isme', 'that'], ['ismein', 'that'], ['is me', 'that'],
  ['usko', 'that'], ['isko', 'that'], ['usse', 'that'], ['isse', 'that'], ['uske', 'that'], ['iske', 'that'], ['uska', 'that'], ['iska', 'that'], ['uski', 'that'], ['iski', 'that'],
  ['that', 'that'], ['it', 'that'],
  ['bikri', 'revenue'], // --- sequencing ---
  ['phir', 'then'], ['fir', 'then'], ['uske baad', 'then'], ['iske baad', 'then'], ['after that', 'then'], ['afterwards', 'then'], ['next', 'next'],
  ['followed by', 'then'], ['and then', 'then'], ['phir se', 'then'], // --- division among people / parts ---
  ['divided equally', 'divide'], ['divide equally', 'divide'], ['split equally', 'divide'], ['share equally', 'divide'], ['equally divide', 'divide'], ['split', 'divide'], ['share', 'divide'], ['shared', 'divide'],
  ['bant', 'divide'], ['baant', 'divide'], ['baanto', 'divide'], ['banto', 'divide'], ['bant do', 'divide'], ['baat do', 'divide'], ['bhag karo', 'divide'], ['vaag', 'divide'], ['bhaga', 'divide'], ['bhag', 'divide'], ['bhaag', 'divide'],
  ['equal parts', 'parts'], ['parts', 'parts'], ['part', 'parts'], ['hisse', 'parts'], ['hissa', 'parts'], ['hisson', 'parts'], ['hisso', 'parts'], ['tukde', 'parts'], ['equally', 'equally'], ['equal', 'equally'], ['barabar', 'equally'], ['samaan', 'equally'], ['among', 'between'], ['amongst', 'between'],
  ['people', 'people'], ['persons', 'people'], ['person', 'people'], ['logon', 'people'], ['logo', 'people'], ['lok', 'people'], ['bande', 'people'], ['bando', 'people'], ['members', 'people'], ['friends', 'people'], ['ways', 'people'],
  ['per person', 'each'], ['per head', 'each'], ['har ek', 'each'], ['har ek ko', 'each'], ['each', 'each'], ['apiece', 'each'],
  ['per item', 'each'], ['per piece', 'each'], ['per unit', 'each'], ['per pc', 'each'], ['per nos', 'each'], ['ek ka', 'each'], ['prati', 'each'], ['items', 'items'], ['item', 'items'], ['pieces', 'items'], ['piece', 'items'], ['pcs', 'items'], ['nos', 'items'], ['units', 'items'], ['quantity', 'items'], ['qty', 'items'], ['tukda', 'items'], ['tukde', 'items'], // --- "with that" chaining (Hindi) ---
  ['uske saath', 'that with'], ['usme', 'that'], ['isme', 'that'],
  // --- interest: interest earned vs amount received ---
  ['final amount', 'total'], ['maturity amount', 'total'], ['maturity value', 'total'], ['total amount', 'total'], ['amount after', 'total'], ['amount at the end', 'total'], ['milega', 'total'], ['milenge', 'total'], ['milegi', 'total'],
  ['ho jayega', 'total'], ['ho jayenge', 'total'], ['ban jayega', 'total'], ['end me', 'total'], ['interest earned', 'interest'],
  // --- math words ---
  ['square root of', 'sqrt'], ['square root', 'sqrt'], ['sqrt of', 'sqrt'], ['vargmool', 'sqrt'], ['vargmul', 'sqrt'], ['cube root of', 'cbrt'], ['cube root', 'cbrt'], ['squared', '^ 2'], ['cubed', '^ 3'],
  ['to the power of', '^'], ['to the power', '^'], ['raised to', '^'], ['ki power', '^'], ['ka square', '^ 2'], ['ka cube', '^ 3'], ['ka varg', '^ 2'], // --- audit additions: accounting lines, interest shorthands, loan types, growth, reverse, points ---
  ['cost of goods sold', 'expenses'], ['cost of goods', 'expenses'], ['opex', 'expenses'], ['operating expenses', 'expenses'], ['operating expense', 'expenses'], ['overheads', 'expenses'], ['overhead', 'expenses'],
  ['operating cost', 'expenses'], ['operating costs', 'expenses'], ['cgst', 'gst'], ['sgst', 'gst'], ['igst', 'gst'], ['utgst', 'gst'], ['discounts', 'discount'], ['successive', 'then'], ['consecutive', 'then'],
  ['simple interest', 'simple interest'], ['si', 'simple interest'], ['ci', 'compound interest'], ['flat rate', 'flat'], ['flat interest', 'flat'], ['flat', 'flat'], ['reducing balance', 'emi'], ['diminishing', 'emi'],
  ['grows', 'compound total'], ['grow', 'compound total'], ['growing', 'compound total'], ['appreciates', 'compound total'], ['compounded annually', 'compound yearly'], ['per annum compounded', 'compound yearly'],
  ['reverse', 'reverse'], ['reversed', 'reverse'], ['undo', 'reverse'], ['percentage points', 'points'], ['percent points', 'points'], ['pp', 'points'], ['tip', 'add'], ['tips', 'add'], ['service charge', 'add'],
  ['badhotri', 'increase'], ['badhottari', 'increase'], ['izafa', 'increase'], ['baddhi', 'increase'],
  // --- weekday names (Hindi) and date questions ---
  ['somvar', 'monday'], ['somwar', 'monday'], ['mangalvar', 'tuesday'], ['mangalwar', 'tuesday'], ['budhvar', 'wednesday'], ['budhwar', 'wednesday'], ['guruvar', 'thursday'], ['guruwar', 'thursday'], ['brihaspativar', 'thursday'], ['shukravar', 'friday'], ['shukrawar', 'friday'], ['shanivar', 'saturday'], ['shaniwar', 'saturday'],
  ['ravivar', 'sunday'], ['raviwar', 'sunday'], ['itvar', 'sunday'], ['what day', 'weekday'], ['which day', 'weekday'], ['kaunsa din', 'weekday'], ['konsa din', 'weekday'], ['kya din', 'weekday'], ['din kya hai', 'weekday'], ['ka din kya', 'weekday'], ['ki bar', 'weekday'], ['kon bar', 'weekday'], ['ki baar', 'weekday'], ['kon baar', 'weekday'],
  ['leap year', 'leap'], ['leap', 'leap'], ['how old', 'age'], ['age', 'age'], ['umar', 'age'], ['umr', 'age'], ['born on', 'born'], ['born', 'born'], ['janma', 'born'], ['paida hua', 'born'], ['paida', 'born'],
  ['morning', 'am'], ['subah', 'am'], ['savere', 'am'], ['afternoon', 'pm'], ['dopahar', 'pm'], ['evening', 'pm'], ['sham', 'pm'], ['shaam', 'pm'], ['night', 'pm'], ['raat', 'pm'], ['ratio', 'ratio'], ['anupat', 'ratio'], ['average', 'average'], ['avg', 'average'], ['mean', 'average'], ['ausat', 'average'], ['median', 'median'], ['maximum', 'max'], ['highest', 'max'], ['largest', 'max'], ['minimum', 'min'], ['lowest', 'min'], ['smallest', 'min'],
  // --- allocation / weekdays / outcomes ---
  ['allocate', 'divide'], ['allocated', 'divide'], ['allocation', 'divide'], ['distribute', 'divide'], ['distributed', 'divide'], ['break up', 'divide'], ['breakup', 'divide'], ['split into', 'divide in'], ['split up', 'divide'],
  ['remaining', 'remaining'], ['remainder', 'remaining'], ['rest', 'remaining'], ['balance', 'remaining'], ['baki', 'remaining'], ['baaki', 'remaining'], ['bacha', 'remaining'], ['bacha hua', 'remaining'], ['bache', 'remaining'], ['leftover', 'remaining'],
  ['weekdays', 'weekdays'], ['working days', 'weekdays'], ['business days', 'weekdays'], ['work days', 'weekdays'], ['kaam ke din', 'weekdays'], ['weekends', 'weekends'], ['weekend', 'weekends'], ['weekend days', 'weekends'],
  ['through', 'to'], ['thru', 'to'], ['up to and including', 'to inclusive'], ['including both', 'inclusive'], ['dono din milake', 'inclusive'],
  ['becomes', 'after'], ['become', 'after'], ['became', 'after'], ['ban jata hai', 'after'], ['ban jata', 'after'], ['ho jata hai', 'after'], ['ho jata', 'after'], ['results in', 'after'], ['gives', 'after'], ['yields', 'after'], ['ends up at', 'after'],
  // --- reverse percentage ("840 is 12% less than what") ---
  ['more than', 'increase than'], ['greater than', 'increase than'], ['higher than', 'increase than'], ['less than', 'decrease than'], ['lower than', 'decrease than'], ['smaller than', 'decrease than'],
  ['se zyada', 'increase than'], ['se jyada', 'increase than'], ['se kam', 'decrease than'], ['original amount', 'what'], ['original number', 'what'], ['original value', 'what'], ['original', 'what'],
  // --- "work out" verbs (no operation of their own) ---
  ['nikal ke', 'compute'],
  // --- context reset ---
  ['clear context', 'reset'], ['reset context', 'reset'], ['clear memory', 'reset'], ['clear all', 'reset'], ['clear everything', 'reset'], ['forget everything', 'reset'], ['forget previous', 'reset'], ['forget that', 'reset'], ['forget it', 'reset'],
  ['start over', 'reset'], ['start fresh', 'reset'], ['start afresh', 'reset'], ['context clear karo', 'reset'], ['context reset karo', 'reset'], ['sab bhool jao', 'reset'], ['sab bhul jao', 'reset'],
  ['bhool jao', 'reset'], ['bhul jao', 'reset'], ['naya shuru', 'reset'], ['reset', 'reset'],
  ['another', 'another'], ['aur ek', 'another'], ['ek aur', 'another'], ['further', 'another'], ['additional', 'another'],
  ['starting at', 'start'], ['starting from', 'start'], ['starting with', 'start'], ['start with', 'start'], ['start at', 'start'], ['start from', 'start'], ['initial amount', 'start'], ['initially', 'start'], ['initial', 'start'],
  ['shuruat', 'start'], ['shuru', 'start'], ['shuru me', 'start'], ['double', 'double'], ['dugna', 'double'], ['dugna karo', 'double'], ['twice', 'double'], ['triple', 'triple'], ['tigna', 'triple'], ['guna', 'times'], ['multiply', 'times'], ['multiplied', 'times'], ['bhag', 'divide'], ['bhaag', 'divide'], ['divided', 'divide'], ['subtract', 'minus'], ['ghata ke', 'minus'], ['kam karke', 'minus'],
  // --- currency words with Hindi suffixes ---
  ['rupayer', 'rupaye'], 
];

/** words that carry no meaning for calculation and are dropped */
const FILLERS = new Set([
  'mera', 'meri', 'mere', 'mujhe', 'mujhko', 'hamara', 'hamari', 'humara', 'humari', 'hamare', 'apna', 'apni', 'apne', 'tumhara', 'tumhari',
  'the', 'a', 'an', 'please', 'plz', 'pls', 'zara', 'jara', 'thoda', 'thora', 'toh', 'tho', 'hi', 'bhi', 'ye', 'yeh', 'yah', 'wo', 'woh', 'ko', 'take', 'taken', 'dono', 'donon', 'both', 'together', 'sab', 'overall', 'offline', 'online', 'kindly', 'tell', 'me', 'apply', 'applied', 'applying', 'final', 'finally', 'effective', 'net', 'payable', 'calculate', 'compute', 'using', 'use', 'historical', 'historic', 'exchange', 'dated', 'wala', 'wali', 'wale',
  'hai', 'hain', 'hoga', 'hogi', 'honge', 'ho', 'hoon', 'batao', 'bata', 'bataiye', 'batana', 'bolo', 'bol', 'boliye', 'dekha', 'dikhao', 'calculate', 'compute', 'find', 'tell', 'show', 'give', 'get', 'do', 'kar', 'karo', 'karna', 'kara', 'karke',
  'karne', 'karein', 'kijiye', 'dijiye', 'dedo', 'liya', 'li', 'lo', 'le', 'leke', 'hisab', 'hisaab', 'calc', 'me', 'us', 'i', 'we', 'you', 'are', 'be', 'will', 'would', 'should', 'can', 'could',
  'if', 'agar', 'so', 'ok', 'just', 'par', 'lagega', 'lagegi', 'dena', 'dene', 'hoga',
  'has', 'kiye', 'kiya', 'kiyi', 'kia', 'set', 'let', 'define', 'assume', 'given', 'suppose', 'holds', 'hold', 'contains', 'contain', 'earns', 'earn',
  'approximately', 'approx', 'decimal', 'equivalent', 'respectively', 'simplify', 'simplified', 'simplest', 'there', 'are', 'was', 'were', 'date', 'journey', 'needed', 'required', 'mileage', 'download', 'downloading', 'downloaded', 'upload', 'uploading', 'transfer', 'transferring', 'file', 'files', 'internet', 'connection', 'network', 'wifi', 'data', 'movie', 'video', 'song', 'backup', 'weight', 'height', 'vajan', 'wazan', 'lambai', 'temperature', 'length', 'about', 'roughly', 'around', 'speed', 'distance', 'marks', 'score', 'scored',
  'amount', 'value', 'result', 'answer', 'figure', 'number', 'price', 'rakam', 'daam', 'dam', 'paisa', 'paise', 'rupay', 'wala', 'wali', 'wale', ]);

const PHRASE_LIST = PHRASES.slice().sort((a, b) => b[0].split(' ').length - a[0].split(' ').length || b[0].length - a[0].length);

/** canonical verbs / nouns (used by highlighting too) */
export const CANON_KEYWORDS = new Set<string>([
  'increase', 'decrease', 'add', 'remove', 'inclusive', 'gst', 'discount', 'profit', 'loss', 'cost', 'sell', 'margin', 'markup', 'emi', 'loan', 'interest', 'simple', 'compound',
  'convert', 'change', 'what', 'after', 'before', 'between', 'with', 'without', 'yearly', 'monthly', 'quarterly', 'half-yearly', 'daily', 'time', 'now', 'today', 'tomorrow', 'yesterday', 'next', 'last', 'from', 'to', 'in', 'of', 'on', 'at', 'for',
  'revenue', 'expenses', 'prev', 'that', 'then', 'another', 'start', 'double', 'triple', 'times', 'divide', 'minus', 'plus', 'total', 'sum', 'parts', 'equally', 'people', 'each', 'reset', 'items', 'than', 'sqrt', 'cbrt',
  'remaining', 'weekdays', 'weekends', 'weekday', 'leap', 'age', 'born', 'ratio', 'average', 'median', 'max', 'min', 'flat', 'reverse', 'points',
]);

/** every source word/phrase the normaliser knows (for syntax highlighting of Hinglish verbs) */
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

// ---------------------------------------------------------------- number words

/** strong number words: always numeric */
const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  ek: 1, teen: 3, paanch: 5, panch: 5, pach: 5, chhe: 6, saat: 7, aath: 8, nau: 9, das: 10, dus: 10, dass: 10, gyarah: 11, barah: 12,
  pandrah: 15, bees: 20, tees: 30, chalis: 40, pachas: 50, saath: 60, sattar: 70, assi: 80, nabbe: 90,
};
/** weak number words: only numeric next to another number/scale word, a currency, a unit or a percent (they collide with other words: do = "do", char = "four", sat = Saturday) */
const WEAK_NUMBER_WORDS: Record<string, number> = { do: 2, char: 4, chaar: 4, sat: 7, sawa: 1.25, sava: 1.25, dedh: 1.5, derh: 1.5, dhai: 2.5, dhaai: 2.5 };
const SCALE_NUMBERS: Record<string, number> = {
  hundred: 100, hundreds: 100, sau: 100, so: 100, thousand: 1000, thousands: 1000, hazaar: 1000, hazar: 1000, hajar: 1000, lakh: 100000, lakhs: 100000, lac: 100000, lacs: 100000,
  million: 1000000, millions: 1000000, crore: 10000000, crores: 10000000, billion: 1000000000, billions: 1000000000,
};
const NUMERAL_RE = /^\d[\d,]*(?:\.\d+)?$/;
const AFTER_WEAK = /^(%|percent|rupaye|rupee|rupees|rupaya|rupiya|dollar|dollars|usd|inr|euro|lakh|hazaar|hazar|hajar|sau|crore|din|saal|sal|mahine|mahina|ghante|ghanta|hafte|baje|guna|bar|baar|log|kg|km|litre|liter)$/;

function isNumberWord(w: string, next: string | undefined, prev: string | undefined): boolean {
  if (own(NUMBER_WORDS, w) || own(SCALE_NUMBERS, w) || NUMERAL_RE.test(w)) return true;
  if (own(WEAK_NUMBER_WORDS, w)) {
    const nearNumber = (x: string | undefined) => !!x && (own(NUMBER_WORDS, x) || own(SCALE_NUMBERS, x) || own(WEAK_NUMBER_WORDS, x));
    return nearNumber(next) || (!!next && AFTER_WEAK.test(next)) || nearNumber(prev);
  }
  return false;
}

/** "two thousand five hundred" → "2500", "paanch sau" → "500", "twenty five" → "25", "1 lakh 20 hazaar" → "120000" */
export function composeNumberWords(words: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < words.length) {
    if (!isNumberWord(words[i], words[i + 1], words[i - 1])) {
      out.push(words[i]);
      i++;
      continue;
    }
    // collect a run of number words; numerals may only start a run (so "5 lakh" composes but "10 20" stays apart)
    let j = i;
    let hasWord = false;
    const run: string[] = [];
    while (j < words.length && (isNumberWord(words[j], words[j + 1], words[j - 1]) || (words[j] === 'and' && run.length > 0 && own(SCALE_NUMBERS, words[j - 1]) && j + 1 < words.length && own(NUMBER_WORDS, words[j + 1])))) {
      if (words[j] === 'and') {
        // "one hundred and fifty"
        j++;
        continue;
      }
      const numeral = NUMERAL_RE.test(words[j]);
      const prevIsScale = run.length > 0 && own(SCALE_NUMBERS, words[j - 1]);
      const prevIsNumeral = run.length > 0 && NUMERAL_RE.test(words[j - 1]);
      // "50000 three ways": a numeral and a spelled number only join through a scale word ("1 lakh 20 hazaar")
      if (numeral && run.length > 0 && !prevIsScale) break;
      if (!numeral && !own(SCALE_NUMBERS, words[j]) && prevIsNumeral) break;
      if (!numeral) hasWord = true;
      run.push(words[j]);
      j++;
    }
    // numerals with a single scale ("5 lakh", "₹2 crore") are left to the parser; compose only when a
    // number is spelled out ("five hundred") or several numeral+scale pairs chain ("1 lakh 20 hazaar")
    const spelled = run.some((w) => own(NUMBER_WORDS, w) || own(WEAK_NUMBER_WORDS, w));
    const numerals = run.filter((w) => NUMERAL_RE.test(w)).length;
    // a scale word on its own ("sau", "hazaar ka aadha") is one of it
    const bareScale = numerals === 0 && !spelled && run.every((w) => own(SCALE_NUMBERS, w)) && !/\d/.test(words[i - 1] ?? '');
    if (!bareScale && (!hasWord || (!spelled && numerals < 2))) {
      out.push(...run);
      i = j;
      continue;
    }
    let total = 0;
    let current = 0;
    let valid = true;
    for (const w of run) {
      if (NUMERAL_RE.test(w)) current += parseFloat(w.replace(/,/g, ''));
      else if (own(NUMBER_WORDS, w)) current += NUMBER_WORDS[w];
      else if (own(WEAK_NUMBER_WORDS, w)) current += WEAK_NUMBER_WORDS[w];
      else if (own(SCALE_NUMBERS, w)) {
        const s = SCALE_NUMBERS[w];
        if (s === 100) current = (current || 1) * 100;
        else {
          total += (current || 1) * s;
          current = 0;
        }
      } else valid = false;
    }
    if (!valid) {
      out.push(...run);
    } else {
      const v = total + current;
      out.push(Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));
    }
    i = j;
  }
  return out;
}

const WEEK_WORDS = /^(mon|tue|wed|thu|fri|sat|sun)\w*$|^(week|month|year|day|time)s?$/;

export function normalize(text: string): Normalized {
  const notes: string[] = [];
  let s = text.toLowerCase();
  // a question mark is punctuation; so is "!" unless it follows a digit (5! is a factorial)
  s = s.replace(/[?¿]|(?<!\d)!/g, ' ');
  // sentence-ending periods are not part of a word ("1.8 lakh.", "10%.", "litres."); decimal points stay.
  // A period inside the text ends a clause; the final one is simply dropped.
  s = s.replace(/(?<!\d)[.?!]+\s*$|[.?]+\s*$/, '').replace(/\.(?=\s)/g, ' , ');
  // commas and semicolons separate clauses ("rahul 150, rohit 250, total") but commas stay inside numbers (1,00,000)
  s = s.replace(/,(?=\s|$)/g, ' , ').replace(/;/g, ' , ');
  s = s.replace(/(\d)\s*%/g, '$1%');
  s = s.replace(/\s+/g, ' ').trim();
  if (/\bkal\b/.test(s)) notes.push('kal = tomorrow');
  // whole numbers written in words (before phrase mapping, so "five hundred" and "paanch sau" become 500)
  s = composeNumberWords(s.split(' ')).join(' ');
  // Hindi "450 mile" (received) in a money sentence; "5 mile" elsewhere stays miles
  if (/\b(?:paas|kharch|kharcha|bach[ae]|bacha|mila|baki|baaki)\b/.test(s)) s = s.replace(/(\d[\d.,]*)\s+mile\b/g, '$1 received');
  // "2 successive discounts of 10% on 500": one rate applied N times
  s = s.replace(/\b(\d+)\s+(?:successive|consecutive)\s+discounts?\s+of\s+(\d+(?:\.\d+)?%)(?!\s*(?:,|and|then))/g, (_m, n: string, pct: string) => `${Array.from({ length: Math.min(parseInt(n, 10), 10) }, () => pct).join(' then ')} discount`);
  // "3 successive discounts of 10% and 20%": the count of operations is not an amount
  s = s.replace(/\b\d+\s+(?=(?:successive|consecutive)\b)/g, '');
  // "80 ko 2 se guna karo" / "150 ko 3 se bhag do" → 80 * 2 / 150 / 3
  s = s.replace(/(\d[\d.,]*)\s+ko\s+(\d[\d.,]*)\s+se\s+(?:guna|gunaa|multiply)\b/g, '$1 * $2').replace(/(\d[\d.,]*)\s+ko\s+(\d[\d.,]*)\s+se\s+(?:bhag|bhaag|divide)\b/g, '$1 / $2');
  // "45 min before 10am" / "2 hours after 9:30 pm" → clock arithmetic
  s = s.replace(/\b(\d+(?:\.\d+)?\s*(?:min|mins|minutes?|hours?|hrs?|h))\s+(before|after)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/g, (_m, off: string, dir: string, t: string) => `${t} ${dir === 'before' ? '-' : '+'} ${off}`);
  // Hindi "X ke baad Y" means X first, then Y: before tax/discount/percent words it is a sequence
  s = s.replace(/\bke baad\s+(?=(?:gst|tax|discount|chhoot|chhut|phir|\d+(?:\.\d+)?\s*(?:%|percent|pratishat)))/g, 'then ');
  // "divide 100 by 8", "multiply 12 by 12", "subtract 15 from 100" → plain arithmetic
  s = s.replace(/\bdivide\s+(\d[\d.,]*)\s+by\s+(\d[\d.,]*)/g, '$1 / $2').replace(/\bmultiply\s+(\d[\d.,]*)\s+by\s+(\d[\d.,]*)/g, '$1 * $2').replace(/\bsubtract\s+(\d[\d.,]*)\s+from\s+(\d[\d.,]*)/g, '$2 - $1');
  // "3 dozen" → 36, "half a dozen" → 6
  s = s.replace(/\b(\d+(?:\.\d+)?)\s+dozen\b/g, (_m, n: string) => String(parseFloat(n) * 12)).replace(/\b(?:a |one )?dozen\b/g, '12').replace(/\bhalf (?:a )?12\b/g, '6');
  // "cgpa 8.2 to percentage" → 77.9% (CBSE: CGPA × 9.5)
  s = s.replace(/\bcgpa\s+(\d+(?:\.\d+)?)\s+(?:to|in|me|mein)\s+(?:percentage|percent|%)/g, (_m, x: string) => `${Math.round(parseFloat(x) * 95) / 10}%`).replace(/\b(\d+(?:\.\d+)?)\s+cgpa\s+(?:to|in|me|mein)\s+(?:percentage|percent|%)/g, (_m, x: string) => `${Math.round(parseFloat(x) * 95) / 10}%`);
  if (/\bcgpa\b/.test(text.toLowerCase())) notes.push('CGPA × 9.5 (CBSE)');
  // "450 km at 60 km/h" → time; "600 km at 15 km/l" → litres; "2.5 hours at 80 km/h" → distance
  s = s.replace(/(\d[\d.,]*\s*(?:km|kilometres|kilometers|kilometre|kilometer|miles|mile|mi|m|metres|meters))\s+at\s+(\d[\d.,]*\s*(?:km\/h|kmph|kph|kmh|mph|m\/s|km\/l|kmpl|mpg|km per hour|km per litre))\b/g, '$1 / $2');
  s = s.replace(/(\d[\d.,]*\s*(?:hours|hour|hrs|hr|h|minutes|minute|mins|min))\s+at\s+(\d[\d.,]*\s*(?:km\/h|kmph|kph|kmh|mph|m\/s))\b/g, '$2 * $1');
  // "600 km in 40 litres" / "40 litres me 600 km" → km per litre
  s = s.replace(/(\d[\d.,]*\s*(?:km|kilometres|kilometers|miles))\s+(?:in|me|mein|per)\s+(\d[\d.,]*\s*(?:litres|liters|litre|liter|l|gallons|gallon))\b/g, '$1 / $2');
  s = s.replace(/(\d[\d.,]*\s*(?:litres|liters|litre|liter|l))\s+(?:in|me|mein|se)\s+(\d[\d.,]*\s*(?:km|kilometres|kilometers|miles))\b/g, '$2 / $1');
  // "120 km in 1.5 hours" is distance over time, not a conversion
  s = s.replace(/(\d[\d.,]*\s*(?:km|kilometres|kilometers|kilometre|kilometer|miles|mile|mi|metres|meters|metre|meter|m|ft|feet))\s+in\s+(\d[\d.,]*\s*(?:hours|hour|hrs|hr|h|minutes|minute|mins|min|seconds|second|sec|s))\b/g, '$1 / $2');
  // "… 500 percentage" at the end asks for a percentage; "500 percent" is a value
  s = s.replace(/(\d)\s+percentage\s*$/, '$1 what %');
  // "5 points" next to a percentage means percentage points
  if (s.includes('%')) s = s.replace(/\b(\d+(?:\.\d+)?)\s+points\b/g, '$1% points');
  // "2 power 15" / "2 raised to 15" → 2 ^ 15; "4th root of 81" → root(81, 4); √144 / ∛27
  s = s.replace(/(\d+(?:\.\d+)?|\))\s+(?:power|raised to)\s+(?=\d|\()/g, '$1 ^ ');
  s = s.replace(/\b(\d+)\s*(?:st|nd|rd|th)\s+root\s+(?:of\s+)?(\d+(?:\.\d+)?)/g, 'root ( $2 , $1 )');
  s = s.replace(/√\s*/g, 'sqrt ').replace(/∛\s*/g, 'cbrt ');
  // Hindi order for roots: "50 ka vargmool" → sqrt 50, "27 ka ghanmool" → cbrt 27
  s = s.replace(/(\d+(?:\.\d+)?)\s+(?:ka|ki|ke)\s+(?:vargmool|vargmul|square root|sqrt)\b/g, 'sqrt $1');
  s = s.replace(/(\d+(?:\.\d+)?)\s+(?:ka|ki|ke)\s+(?:ghanmool|ghanmul|cube root|cbrt)\b/g, 'cbrt $1');
  // "subah 10 baje" → 10 am, "raat 9 baje" → 9 pm (the period word moves after the hour)
  s = s.replace(/\b(morning|subah|savere)\s+(\d{1,2})(?::(\d{2}))?\s*(baje)?\b/g, (_m, _p, h: string, mm: string | undefined) => `${h}${mm ? ':' + mm : ''}am`);
  s = s.replace(/\b(afternoon|dopahar|evening|sham|shaam|night|raat)\s+(\d{1,2})(?::(\d{2}))?\s*(baje)?\b/g, (_m, _p, h: string, mm: string | undefined) => `${h}${mm ? ':' + mm : ''}pm`);
  // Hindi multiplication order: "12 ka 3 guna" → 12 * 3
  // (a scale word may follow either number: "3 lakh ka 2 guna" → 3 lakh * 2)
  const SCALED = String.raw`(\d+(?:\.\d+)?(?:\s+(?:thousand|hazaar|hazar|hajar|lakh|lakhs|lac|lacs|lokkho|crore|crores|cr|koti|million|millions|billion|billions|k|m|bn))?)`;
  s = s.replace(new RegExp(SCALED + String.raw`\s+(?:ka|ki|ke)\s+` + SCALED + String.raw`\s+(?:guna|times)\b`, 'g'), '$1 * $2');
  // "5 percentage points" → a percent value flagged as points
  s = s.replace(/\b(\d+(?:\.\d+)?)\s*(percentage points|percent points|pp)\b/g, '$1% points');
  // "5% nikalo" / "5 percent ber koro" after a percentage means "work it out", not "remove it"
  s = s.replace(/(\d+(?:\.\d+)?)\s*(%|percent|pratishat)\s+(nikalo|nikaalo|nikal do|nikal|nikaal)\b/g, '$1% compute');
  for (const [from, to] of PHRASE_LIST) {
    const re = new RegExp(`(^|[^\\p{L}\\d])${escapeRe(from)}(?=$|[^\\p{L}\\d])`, 'gu');
    s = s.replace(re, (_m, pre: string) => `${pre}${to}`);
  }
  s = s.replace(/(\d)\s*%/g, '$1%');
  // "1500 pe 20% off" → 20% off 1500
  s = s.replace(/(\d[\d.,]*)\s+on\s+(\d+(?:\.\d+)?%)\s+off\b/g, '$2 off $1');
  // Hindi order for factors: "1000 ka double" → double 1000, "saat sau ka aadha" → half 700
  s = s.replace(/(\d[\d.,]*(?:\s+(?:lakh|lakhs|crore|crores|hazaar|hazar|thousand|million|k))?)\s+of\s+(double|triple|half|quarter)\b/g, '$2 $1');
  // "45 min" is minutes (not the min() function)
  s = s.replace(/(\d)\s*min\b/g, '$1 minutes');
  // "this" refers to the running value unless it starts a date phrase ("this friday", "this month")
  const raw = s.split(' ');
  const mapped = raw.map((w, i) => (w === 'this' && !(raw[i + 1] && WEEK_WORDS.test(raw[i + 1])) ? 'that' : w));
  const words = mapped.filter((w) => w && !FILLERS.has(w));
  return { words, notes };
}
