import { Decimal } from './types';

export type Dimension = 'length' | 'mass' | 'volume' | 'temperature' | 'time' | 'data' | 'area' | 'speed' | 'angle' | 'bandwidth' | 'fuel';

export interface UnitDef {
  id: string;
  dim: Dimension;
  /** multiplier to the base unit of the dimension */
  factor: Decimal;
  /** display symbol */
  symbol: string;
  aliases: string[];
}

function u(id: string, dim: Dimension, factor: string | number, symbol: string, aliases: string[]): UnitDef {
  return { id, dim, factor: new Decimal(factor), symbol, aliases };
}

export const UNITS: UnitDef[] = [
  // length (base: metre)
  u('mm', 'length', '0.001', 'mm', ['mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres']),
  u('cm', 'length', '0.01', 'cm', ['cm', 'centimeter', 'centimeters', 'centimetre', 'centimetres', 'cms']),
  u('m', 'length', 1, 'm', ['m', 'meter', 'meters', 'metre', 'metres']),
  u('km', 'length', 1000, 'km', ['km', 'kilometer', 'kilometers', 'kilometre', 'kilometres', 'kms']),
  u('inch', 'length', '0.0254', 'in', ['inch', 'inches']),
  u('ft', 'length', '0.3048', 'ft', ['ft', 'foot', 'feet']),
  u('yd', 'length', '0.9144', 'yd', ['yd', 'yard', 'yards']),
  u('mile', 'length', '1609.344', 'mi', ['mi', 'mile', 'miles']),
  u('nmi', 'length', 1852, 'nmi', ['nmi', 'nautical mile', 'nautical miles']),
  u('ly', 'length', '9460730472580800', 'ly', ['ly', 'light year', 'light years', 'lightyear', 'lightyears']),
  u('au', 'length', '149597870700', 'AU', ['astronomical unit', 'astronomical units']),
  // mass (base: kilogram)
  u('mg', 'mass', '0.000001', 'mg', ['mg', 'milligram', 'milligrams']),
  u('g', 'mass', '0.001', 'g', ['g', 'gram', 'grams', 'gm', 'gms']),
  u('kg', 'mass', 1, 'kg', ['kg', 'kilogram', 'kilograms', 'kilo', 'kilos', 'kgs']),
  u('tonne', 'mass', 1000, 't', ['tonne', 'tonnes', 'ton', 'tons', 'metric ton']),
  u('lb', 'mass', '0.45359237', 'lb', ['lb', 'lbs', 'pound', 'pounds']),
  u('tola', 'mass', '0.011664', 'tola', ['tola', 'tolas', 'tole']),
  u('quintal', 'mass', 100, 'quintal', ['quintal', 'quintals', 'qtl']),
  u('ratti', 'mass', '0.0001215', 'ratti', ['ratti', 'rattis']),
  u('oz', 'mass', '0.028349523125', 'oz', ['oz', 'ounce', 'ounces']),
  // volume (base: litre)
  u('ml', 'volume', '0.001', 'ml', ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres']),
  u('l', 'volume', 1, 'l', ['l', 'liter', 'liters', 'litre', 'litres', 'ltr', 'ltrs']),
  u('tsp', 'volume', '0.00492892159375', 'tsp', ['tsp', 'teaspoon', 'teaspoons', 'tea spoon', 'tea spoons']),
  u('tbsp', 'volume', '0.01478676478125', 'tbsp', ['tbsp', 'tablespoon', 'tablespoons', 'table spoon', 'table spoons']),
  u('cup', 'volume', '0.2365882365', 'cup', ['cup', 'cups']),
  u('floz', 'volume', '0.0295735295625', 'fl oz', ['floz', 'fl oz', 'fluid ounce', 'fluid ounces']),
  u('pint', 'volume', '0.473176473', 'pt', ['pint', 'pints']),
  u('gal', 'volume', '3.785411784', 'gal', ['gal', 'gallon', 'gallons']),
  u('m3', 'volume', 1000, 'm³', ['m3', 'm³', 'cbm', 'cu m', 'cubic meter', 'cubic meters', 'cubic metre', 'cubic metres', 'cubic m']),
  u('cm3', 'volume', '0.001', 'cm³', ['cm3', 'cm³', 'cc', 'cu cm', 'cubic cm', 'cubic centimeter', 'cubic centimeters', 'cubic centimetre', 'cubic centimetres']),
  u('ft3', 'volume', '28.316846592', 'ft³', ['ft3', 'cu ft', 'cubic feet', 'cubic foot', 'cft']),
  u('in3', 'volume', '0.016387064', 'in³', ['in3', 'cu in', 'cubic inch', 'cubic inches']),
  // temperature (special handling)
  u('c', 'temperature', 1, '°C', ['c', '°c', 'celsius', 'centigrade', 'degc', 'deg c']),
  u('f', 'temperature', 1, '°F', ['f', '°f', 'fahrenheit', 'degf', 'deg f']),
  u('k', 'temperature', 1, 'K', ['kelvin', 'k']),
  // time (base: second)
  u('ms', 'time', '0.001', 'ms', ['ms', 'millisecond', 'milliseconds']),
  u('s', 'time', 1, 's', ['s', 'sec', 'secs', 'second', 'seconds']),
  u('min', 'time', 60, 'min', ['min', 'mins', 'minute', 'minutes']),
  u('h', 'time', 3600, 'h', ['h', 'hr', 'hrs', 'hour', 'hours']),
  u('day', 'time', 86400, 'days', ['day', 'days']),
  u('week', 'time', 604800, 'weeks', ['week', 'weeks', 'wk', 'wks']),
  u('month', 'time', '2628000', 'months', ['month', 'months', 'mo', 'mos']),
  u('year', 'time', '31536000', 'years', ['year', 'years', 'yr', 'yrs']),
  // data (base: byte)
  u('bit', 'data', '0.125', 'bit', ['bit', 'bits']),
  u('B', 'data', 1, 'B', ['byte', 'bytes']),
  u('KB', 'data', 1000, 'KB', ['kb', 'kilobyte', 'kilobytes']),
  u('MB', 'data', 1000000, 'MB', ['mb', 'megabyte', 'megabytes']),
  u('GB', 'data', 1000000000, 'GB', ['gb', 'gigabyte', 'gigabytes']),
  u('TB', 'data', 1000000000000, 'TB', ['tb', 'terabyte', 'terabytes']),
  u('KiB', 'data', 1024, 'KiB', ['kib', 'kibibyte', 'kibibytes']),
  u('MiB', 'data', 1048576, 'MiB', ['mib', 'mebibyte', 'mebibytes']),
  u('GiB', 'data', 1073741824, 'GiB', ['gib', 'gibibyte', 'gibibytes']),
  u('TiB', 'data', 1099511627776, 'TiB', ['tib', 'tebibyte', 'tebibytes']),
  u('PB', 'data', 1e15, 'PB', ['pb', 'petabyte', 'petabytes']),
  u('EB', 'data', 1e18, 'EB', ['eb', 'exabyte', 'exabytes']),
  u('ZB', 'data', 1e21, 'ZB', ['zb', 'zettabyte', 'zettabytes']),
  u('PiB', 'data', '1125899906842624', 'PiB', ['pib', 'pebibyte', 'pebibytes']),
  u('kbit', 'data', 125, 'kbit', ['kbit', 'kilobit', 'kilobits']),
  u('Mbit', 'data', 125000, 'Mbit', ['mbit', 'megabit', 'megabits']),
  u('Gbit', 'data', 125000000, 'Gbit', ['gbit', 'gigabit', 'gigabits']),
  u('Tbit', 'data', 125000000000, 'Tbit', ['tbit', 'terabit', 'terabits']),
  // bandwidth (base: bytes per second); bps/kbps/mbps/gbps are bits, kB/s … are bytes
  u('bps', 'bandwidth', '0.125', 'bit/s', ['bps', 'bit/s', 'bits per second']),
  u('kbps', 'bandwidth', 125, 'kbps', ['kbps', 'kbit/s', 'kilobits per second']),
  u('mbps', 'bandwidth', 125000, 'Mbps', ['mbps', 'mbit/s', 'megabits per second', 'mb per second', 'megabit per second']),
  u('gbps', 'bandwidth', 125000000, 'Gbps', ['gbps', 'gbit/s', 'gigabits per second', 'gigabit per second']),
  u('tbps', 'bandwidth', 125000000000, 'Tbps', ['tbps', 'terabits per second']),
  u('Bps', 'bandwidth', 1, 'B/s', ['b/s', 'bytes per second']),
  u('kBps', 'bandwidth', 1000, 'kB/s', ['kb/s', 'kbyte/s', 'kilobytes per second']),
  u('MBps', 'bandwidth', 1000000, 'MB/s', ['mb/s', 'mbyte/s', 'megabytes per second', 'megabyte per second']),
  u('GBps', 'bandwidth', 1000000000, 'GB/s', ['gb/s', 'gbyte/s', 'gigabytes per second']),
  // angle (base: radian)
  u('rad', 'angle', 1, 'rad', ['rad', 'rads', 'radian', 'radians']),
  u('deg', 'angle', '0.017453292519943295769', '°', ['°', 'deg', 'degs', 'degree', 'degrees']),
  // area (base: square metre)
  u('sqm', 'area', 1, 'm²', ['sqm', 'sq m', 'square meter', 'square meters', 'square metre', 'square metres', 'm2', 'm²']),
  u('sqft', 'area', '0.09290304', 'sq ft', ['sqft', 'sq ft', 'square foot', 'square feet', 'ft2']),
  u('sqyd', 'area', '0.83612736', 'sq yd', ['sqyd', 'sq yd', 'square yard', 'square yards', 'gaj']),
  u('acre', 'area', '4046.8564224', 'acre', ['acre', 'acres']),
  u('hectare', 'area', 10000, 'ha', ['ha', 'hectare', 'hectares']),
  u('sqkm', 'area', 1000000, 'km²', ['sqkm', 'sq km', 'square kilometer', 'square kilometers', 'km2', 'km²']),
  // speed (base: m/s)
  u('mps', 'speed', 1, 'm/s', ['m/s', 'mps', 'meters per second']),
  u('kmh', 'speed', '0.277777777777777778', 'km/h', ['km/h', 'kmh', 'kph', 'kmph', 'kilometers per hour']),
  u('mph', 'speed', '0.44704', 'mph', ['mph', 'miles per hour']),
  u('knot', 'speed', '0.514444444444444444', 'kn', ['knot', 'knots', 'kn']),
  u('kms', 'speed', 1000, 'km/s', ['km/s', 'kms', 'kilometres per second', 'kilometers per second']),
  // fuel economy (base: metres per litre)
  u('kmpl', 'fuel', 1000, 'km/l', ['km/l', 'kmpl', 'km per litre', 'km per liter', 'kilometres per litre', 'kilometers per liter', 'kmpl']),
  u('mpg', 'fuel', '425.143707', 'mpg', ['mpg', 'miles per gallon']),
  // fuel economy (base: metres per litre)
  u('kmpl', 'fuel', 1000, 'km/l', ['km/l', 'kmpl', 'km per litre', 'km per liter', 'kilometres per litre', 'kilometers per liter', 'kmpl']),
  u('mpg', 'fuel', '425.143707', 'mpg', ['mpg', 'miles per gallon']),
];

const byId = new Map<string, UnitDef>();
const byAlias = new Map<string, UnitDef>();
for (const d of UNITS) {
  byId.set(d.id, d);
  for (const a of d.aliases) byAlias.set(a.toLowerCase(), d);
}

/** longest alias length in words, for multi-word matching */
export const MAX_UNIT_WORDS = 3;

export function unitById(id: string): UnitDef | undefined {
  return byId.get(id);
}

export function findUnit(text: string): UnitDef | undefined {
  return byAlias.get(text.toLowerCase());
}

export function isUnitWord(text: string): boolean {
  return byAlias.has(text.toLowerCase());
}

/** Convert a value from one unit to another in the same dimension. */
export function convertUnit(value: Decimal, from: UnitDef, to: UnitDef): Decimal {
  if (from.dim !== to.dim) throw new Error(`cannot convert ${from.symbol} to ${to.symbol}`);
  if (from.id === to.id) return value;
  if (from.dim === 'temperature') {
    let c: Decimal;
    if (from.id === 'c') c = value;
    else if (from.id === 'f') c = value.minus(32).mul(5).div(9);
    else c = value.minus('273.15');
    if (to.id === 'c') return c;
    if (to.id === 'f') return c.mul(9).div(5).plus(32);
    return c.plus('273.15');
  }
  return value.mul(from.factor).div(to.factor);
}
