import type { Token } from './types';
import { CURRENCY_SYMBOLS } from './currency';

const OPS = ['**', '+', '-', '−', '*', '×', '/', '÷', '^', '=', ':', ',', '@', '!'];

/**
 * Splits a single line into tokens with positions. Words are kept whole;
 * the parser and the natural-language layer decide what they mean.
 */
export function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    const ch = line[i];
    // whitespace
    if (/\s/.test(ch)) {
      let j = i;
      while (j < n && /\s/.test(line[j])) j++;
      tokens.push({ type: 'space', text: line.slice(i, j), start: i, end: j, value: ' ' });
      i = j;
      continue;
    }
    // currency symbols (greedy, longest first)
    let matchedSym = false;
    for (const sym of CURRENCY_SYMBOLS) {
      if (line.startsWith(sym, i)) {
        // 'Rs' must not swallow words like 'rsvp'
        if (/^[A-Za-z]/.test(sym) && /[A-Za-z]/.test(line[i + sym.length] ?? '')) continue;
        tokens.push({ type: 'currency', text: sym, start: i, end: i + sym.length, value: sym });
        i += sym.length;
        matchedSym = true;
        break;
      }
    }
    if (matchedSym) continue;
    // numbers: 1,00,000.50  12.5  .5  1e3
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(line[i + 1] ?? ''))) {
      let j = i;
      while (j < n && /[0-9]/.test(line[j])) j++;
      // grouping commas: only when followed by digits
      while (j < n && line[j] === ',' && /[0-9]/.test(line[j + 1] ?? '')) {
        j++;
        while (j < n && /[0-9]/.test(line[j])) j++;
      }
      if (line[j] === '.' && /[0-9]/.test(line[j + 1] ?? '')) {
        j++;
        while (j < n && /[0-9]/.test(line[j])) j++;
      }
      if ((line[j] === 'e' || line[j] === 'E') && /[0-9+-]/.test(line[j + 1] ?? '')) {
        let k = j + 1;
        if (line[k] === '+' || line[k] === '-') k++;
        if (/[0-9]/.test(line[k] ?? '')) {
          while (k < n && /[0-9]/.test(line[k])) k++;
          j = k;
        }
      }
      tokens.push({ type: 'number', text: line.slice(i, j), start: i, end: j, value: line.slice(i, j).replace(/,/g, '') });
      i = j;
      continue;
    }
    if (ch === '%') {
      tokens.push({ type: 'percent', text: '%', start: i, end: i + 1, value: '%' });
      i++;
      continue;
    }
    if (ch === '(' || ch === ')') {
      tokens.push({ type: 'paren', text: ch, start: i, end: i + 1, value: ch });
      i++;
      continue;
    }
    let matchedOp = false;
    for (const op of OPS) {
      if (line.startsWith(op, i)) {
        const norm = op === '−' ? '-' : op === '×' ? '*' : op === '÷' ? '/' : op === '**' ? '^' : op;
        tokens.push({ type: 'op', text: op, start: i, end: i + op.length, value: norm });
        i += op.length;
        matchedOp = true;
        break;
      }
    }
    if (matchedOp) continue;
    // words: letters (incl. unicode), digits inside words, apostrophes, dots in abbreviations, ° and ² symbols
    if (/[\p{L}_°²]/u.test(ch)) {
      let j = i;
      while (j < n && /[\p{L}\p{N}_'’°²\/-]/u.test(line[j])) {
        // a hyphen or slash is only part of a word when followed by a letter (km/h, e-mail)
        if ((line[j] === '-' || line[j] === '/') && !/[\p{L}]/u.test(line[j + 1] ?? '')) break;
        j++;
      }
      const text = line.slice(i, j);
      tokens.push({ type: 'word', text, start: i, end: j, value: text.toLowerCase() });
      i = j;
      continue;
    }
    tokens.push({ type: 'unknown', text: ch, start: i, end: i + 1, value: ch });
    i++;
  }
  return tokens;
}

export function significant(tokens: Token[]): Token[] {
  return tokens.filter((t) => t.type !== 'space');
}
