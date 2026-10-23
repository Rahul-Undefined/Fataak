export interface CurrencyDef {
  code: string;
  symbol?: string;
  /** symbol is shown as a prefix in results (otherwise the ISO code is a suffix) */
  prefix?: boolean;
  names: string[];
  /** use Indian lakh/crore digit grouping */
  indianGrouping?: boolean;
}

export const CURRENCIES: CurrencyDef[] = [
  { code: 'USD', symbol: '$', prefix: true, names: ['usd', 'dollar', 'dollars', 'us dollar', 'us dollars', 'bucks', 'dolar', 'dollor', 'dolars'] },
  {
    code: 'INR',
    symbol: '₹',
    prefix: true,
    indianGrouping: true,
    names: ['inr', 'rs', 'rs.', 'rupee', 'rupees', 'rupaye', 'rupaya', 'rupiya', 'rupaiya', 'rupya', 'rupai', 'rupee', 'indian rupee', 'indian rupees'],
  },
  { code: 'EUR', symbol: '€', prefix: true, names: ['eur', 'euro', 'euros'] },
  { code: 'GBP', symbol: '£', prefix: true, names: ['gbp', 'pound', 'pounds', 'sterling', 'pound sterling', 'quid', 'british pound', 'british pounds'] },
  { code: 'JPY', symbol: '¥', prefix: true, names: ['jpy', 'yen', 'japanese yen'] },
  { code: 'CNY', names: ['cny', 'rmb', 'yuan', 'renminbi', 'chinese yuan'] },
  { code: 'BDT', symbol: '৳', names: ['bdt', 'taka', 'takas', 'tk', 'bangladeshi taka'] },
  { code: 'AED', names: ['aed', 'dirham', 'dirhams', 'uae dirham'] },
  { code: 'SAR', names: ['sar', 'riyal', 'riyals', 'saudi riyal'] },
  { code: 'QAR', names: ['qar', 'qatari riyal'] },
  { code: 'KWD', names: ['kwd', 'kuwaiti dinar'] },
  { code: 'SGD', symbol: 'S$', names: ['sgd', 'singapore dollar', 'singapore dollars'] },
  { code: 'AUD', symbol: 'A$', names: ['aud', 'australian dollar', 'australian dollars'] },
  { code: 'CAD', symbol: 'C$', names: ['cad', 'canadian dollar', 'canadian dollars'] },
  { code: 'NZD', symbol: 'NZ$', names: ['nzd', 'new zealand dollar'] },
  { code: 'HKD', symbol: 'HK$', names: ['hkd', 'hong kong dollar'] },
  { code: 'CHF', names: ['chf', 'franc', 'francs', 'swiss franc'] },
  { code: 'SEK', names: ['sek', 'krona', 'kronor', 'swedish krona'] },
  { code: 'NOK', names: ['nok', 'norwegian krone'] },
  { code: 'DKK', names: ['dkk', 'danish krone'] },
  { code: 'PLN', names: ['pln', 'zloty'] },
  { code: 'CZK', names: ['czk', 'koruna'] },
  { code: 'TRY', names: ['try', 'lira', 'turkish lira'] },
  { code: 'RUB', symbol: '₽', names: ['rub', 'ruble', 'rubles', 'rouble', 'roubles'] },
  { code: 'ZAR', names: ['zar', 'rand'] },
  { code: 'BRL', symbol: 'R$', names: ['brl', 'real', 'reais', 'brazilian real'] },
  { code: 'MXN', names: ['mxn', 'peso', 'pesos', 'mexican peso'] },
  { code: 'KRW', symbol: '₩', names: ['krw', 'won', 'korean won'] },
  { code: 'THB', symbol: '฿', names: ['thb', 'baht'] },
  { code: 'MYR', names: ['myr', 'ringgit'] },
  { code: 'IDR', names: ['idr', 'rupiah'] },
  { code: 'PHP', symbol: '₱', names: ['php', 'philippine peso'] },
  { code: 'VND', symbol: '₫', names: ['vnd', 'dong'] },
  { code: 'PKR', names: ['pkr', 'pakistani rupee'] },
  { code: 'LKR', names: ['lkr', 'sri lankan rupee'] },
  { code: 'NPR', names: ['npr', 'nepali rupee', 'nepalese rupee'] },
  { code: 'EGP', names: ['egp', 'egyptian pound'] },
  { code: 'NGN', symbol: '₦', names: ['ngn', 'naira'] },
  { code: 'KES', names: ['kes', 'kenyan shilling'] },
  { code: 'ILS', symbol: '₪', names: ['ils', 'shekel', 'shekels'] },
  { code: 'HUF', names: ['huf', 'forint'] },
  { code: 'RON', names: ['ron', 'leu'] },
  { code: 'BTC', symbol: '₿', names: ['btc', 'bitcoin', 'bitcoins'] },
];

const byCode = new Map<string, CurrencyDef>();
const byName = new Map<string, CurrencyDef>();
const bySymbol = new Map<string, CurrencyDef>();
for (const c of CURRENCIES) {
  byCode.set(c.code, c);
  for (const n of c.names) byName.set(n, c);
  if (c.symbol) bySymbol.set(c.symbol, c);
}
// ambiguous symbol defaults
bySymbol.set('$', byCode.get('USD')!);
bySymbol.set('¥', byCode.get('JPY')!);
bySymbol.set('₹', byCode.get('INR')!);
bySymbol.set('€', byCode.get('EUR')!);
bySymbol.set('£', byCode.get('GBP')!);
bySymbol.set('Rs', byCode.get('INR')!);
bySymbol.set('Rs.', byCode.get('INR')!);

/** longest symbols first so the tokenizer matches greedily */
export const CURRENCY_SYMBOLS = ['NZ$', 'HK$', 'Rs.', 'R$', 'S$', 'A$', 'C$', 'Rs', '$', '₹', '€', '£', '¥', '৳', '₩', '₽', '฿', '₱', '₫', '₦', '₪', '₿'];

export function currencyByCode(code: string): CurrencyDef | undefined {
  return byCode.get(code.toUpperCase());
}
export function currencyBySymbol(sym: string): CurrencyDef | undefined {
  return bySymbol.get(sym);
}
/** resolve a currency from a word (name or ISO code) */
export function findCurrency(word: string): CurrencyDef | undefined {
  const w = word.toLowerCase();
  return byName.get(w) ?? (w.length === 3 ? byCode.get(w.toUpperCase()) : undefined);
}
export function isCurrencyWord(word: string): boolean {
  return findCurrency(word) !== undefined;
}
