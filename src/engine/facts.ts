/**
 * Reference facts answered offline and deterministically: astronomy, geography, landmarks and physical
 * constants, plus straight-line distances between known cities (great-circle, WGS84 mean radius).
 * Every value carries its source and is a well-known mean; nothing here is estimated at run time.
 */
import { Decimal, type Quantity, own } from './types';

export type Prop = 'distance' | 'area' | 'height' | 'depth' | 'length' | 'speed' | 'mass' | 'diameter' | 'radius' | 'circumference' | 'temperature' | 'period' | 'value' | 'gravity';

export interface Fact {
  /** canonical entity ids, sorted */
  subjects: string[];
  prop: Prop;
  value: string;
  /** unit id from units.ts; omitted for plain numbers */
  unit?: string;
  note: string;
}

const NASA = 'NASA planetary fact sheet';
const NOAA = 'NOAA';

/** entity aliases (English and Hinglish) → canonical id */
const ENTITY_ALIASES: Record<string, string[]> = {
  moon: ['moon', 'chand', 'chanda', 'chandrama', 'chandra', 'the moon'],
  sun: ['sun', 'suraj', 'surya', 'sooraj', 'the sun'],
  earth: ['earth', 'prithvi', 'dharti', 'the earth', 'our planet'],
  mercury: ['mercury', 'budh'],
  venus: ['venus', 'shukra'],
  mars: ['mars', 'mangal'],
  jupiter: ['jupiter', 'brihaspati', 'guru grah'],
  saturn: ['saturn', 'shani'],
  uranus: ['uranus', 'arun'],
  neptune: ['neptune', 'varun'],
  pluto: ['pluto'],
  pacific: ['pacific', 'pacific ocean', 'prashant mahasagar', 'prashant'],
  atlantic: ['atlantic', 'atlantic ocean'],
  'indian ocean': ['indian ocean', 'hind mahasagar'],
  'arctic ocean': ['arctic', 'arctic ocean'],
  'southern ocean': ['southern ocean', 'antarctic ocean'],
  'mariana trench': ['mariana trench', 'marianas trench', 'challenger deep'],
  everest: ['everest', 'mount everest', 'mt everest', 'mt. everest', 'sagarmatha'],
  k2: ['k2', 'mount k2'],
  kanchenjunga: ['kanchenjunga', 'kangchenjunga'],
  kilimanjaro: ['kilimanjaro', 'mount kilimanjaro'],
  'mont blanc': ['mont blanc'],
  fuji: ['fuji', 'mount fuji', 'mt fuji'],
  'nanda devi': ['nanda devi'],
  nile: ['nile', 'nile river', 'river nile'],
  amazon: ['amazon', 'amazon river'],
  yangtze: ['yangtze', 'yangtze river'],
  mississippi: ['mississippi', 'mississippi river'],
  ganga: ['ganga', 'ganges', 'ganga river', 'river ganga', 'ganga nadi'],
  yamuna: ['yamuna', 'yamuna river', 'yamuna nadi'],
  brahmaputra: ['brahmaputra', 'brahmaputra river'],
  godavari: ['godavari', 'godavari river'],
  narmada: ['narmada', 'narmada river'],
  krishna: ['krishna river', 'krishna nadi'],
  indus: ['indus', 'indus river', 'sindhu', 'sindhu river'],
  thames: ['thames', 'river thames'],
  sahara: ['sahara', 'sahara desert'],
  thar: ['thar', 'thar desert'],
  gobi: ['gobi', 'gobi desert'],
  antarctica: ['antarctica'],
  india: ['india', 'bharat', 'hindustan'],
  russia: ['russia'],
  china: ['china'],
  usa: ['usa', 'united states', 'america', 'us'],
  australia: ['australia'],
  brazil: ['brazil'],
  canada: ['canada'],
  pakistan: ['pakistan'],
  bangladesh: ['bangladesh'],
  'sri lanka': ['sri lanka'],
  nepal: ['nepal'],
  uk: ['uk', 'united kingdom', 'britain', 'great britain'],
  japan: ['japan'],
  germany: ['germany'],
  france: ['france'],
  rajasthan: ['rajasthan'],
  maharashtra: ['maharashtra'],
  'uttar pradesh': ['uttar pradesh', 'up state'],
  'madhya pradesh': ['madhya pradesh'],
  'burj khalifa': ['burj khalifa', 'burj'],
  'eiffel tower': ['eiffel tower', 'eiffel'],
  'statue of unity': ['statue of unity'],
  'qutub minar': ['qutub minar', 'qutab minar', 'kutub minar'],
  'taj mahal': ['taj mahal', 'taj'],
  'statue of liberty': ['statue of liberty'],
  'great wall': ['great wall', 'great wall of china'],
  'golden gate': ['golden gate', 'golden gate bridge'],
  'empire state': ['empire state', 'empire state building'],
  'big ben': ['big ben'],
  'howrah bridge': ['howrah bridge'],
  light: ['light', 'roshni', 'prakash'],
  sound: ['sound', 'awaaz', 'awaz', 'dhwani'],
  gravity: ['gravity', 'gurutvakarshan', 'g'],
  water: ['water', 'paani', 'pani'],
  'human body': ['human body', 'body', 'sharir'],
  'light year': ['light year', 'lightyear'],
  'astronomical unit': ['astronomical unit', 'au'],
  parsec: ['parsec'],
  avogadro: ['avogadro', 'avogadro number', "avogadro's number", 'avogadro constant'],
  pi: ['pi'],
  'golden ratio': ['golden ratio', 'phi'],
  'absolute zero': ['absolute zero'],
  'escape velocity': ['escape velocity'],
  year: ['year', 'saal'],
  'lunar month': ['lunar month'],
};

const PROP_ALIASES: Record<string, Prop> = {
  distance: 'distance', far: 'distance', door: 'distance', dur: 'distance', doori: 'distance', duri: 'distance', dooree: 'distance', dori: 'distance', faasla: 'distance', fasla: 'distance', away: 'distance',
  area: 'area', size: 'area', big: 'area', bada: 'area', badi: 'area', kshetrafal: 'area', extent: 'area', large: 'area',
  height: 'height', tall: 'height', high: 'height', unchai: 'height', oonchai: 'height', uncha: 'height', ooncha: 'height', unchi: 'height', elevation: 'height', altitude: 'height',
  depth: 'depth', deep: 'depth', gehrai: 'depth', gahrai: 'depth', gehra: 'depth',
  length: 'length', long: 'length', lambai: 'length', lamba: 'length', lambi: 'length',
  speed: 'speed', fast: 'speed', raftar: 'speed', gati: 'speed', velocity: 'speed',
  mass: 'mass', weight: 'mass', vajan: 'mass', wazan: 'mass', heavy: 'mass', weigh: 'mass', weighs: 'mass',
  diameter: 'diameter', vyas: 'diameter', wide: 'diameter', width: 'diameter',
  radius: 'radius', trijya: 'radius',
  circumference: 'circumference', paridhi: 'circumference', around: 'circumference',
  temperature: 'temperature', hot: 'temperature', taapman: 'temperature', tapman: 'temperature', 'boiling point': 'temperature', 'freezing point': 'temperature', boil: 'temperature', boils: 'temperature', freeze: 'temperature', freezes: 'temperature',
  period: 'period', orbit: 'period', rotation: 'period', days: 'period',
  value: 'value', number: 'value', constant: 'value',
};

const M = (n: number) => String(n * 1_000_000);

export const FACTS: Fact[] = [
  // --- distances (mean) ---
  { subjects: ['earth', 'moon'], prop: 'distance', value: '384400', unit: 'km', note: `mean distance · ${NASA}` },
  { subjects: ['earth', 'sun'], prop: 'distance', value: '149597870.7', unit: 'km', note: `mean distance, 1 AU · ${NASA}` },
  { subjects: ['moon', 'sun'], prop: 'distance', value: '149600000', unit: 'km', note: 'mean; the Moon orbits Earth, so it varies by ±384,400 km · NASA' },
  { subjects: ['earth', 'mars'], prop: 'distance', value: '225000000', unit: 'km', note: 'average; 54.6 million km at closest, 401 million km at farthest · NASA' },
  { subjects: ['mercury', 'sun'], prop: 'distance', value: M(57.909), unit: 'km', note: `mean orbital distance · ${NASA}` },
  { subjects: ['sun', 'venus'], prop: 'distance', value: M(108.21), unit: 'km', note: `mean orbital distance · ${NASA}` },
  { subjects: ['mars', 'sun'], prop: 'distance', value: M(227.956), unit: 'km', note: `mean orbital distance · ${NASA}` },
  { subjects: ['jupiter', 'sun'], prop: 'distance', value: M(778.479), unit: 'km', note: `mean orbital distance · ${NASA}` },
  { subjects: ['saturn', 'sun'], prop: 'distance', value: M(1432.041), unit: 'km', note: `mean orbital distance · ${NASA}` },
  { subjects: ['sun', 'uranus'], prop: 'distance', value: M(2867.043), unit: 'km', note: `mean orbital distance · ${NASA}` },
  { subjects: ['neptune', 'sun'], prop: 'distance', value: M(4514.953), unit: 'km', note: `mean orbital distance · ${NASA}` },
  { subjects: ['pluto', 'sun'], prop: 'distance', value: M(5869.656), unit: 'km', note: `mean orbital distance · ${NASA}` },
  // --- sizes ---
  { subjects: ['sun'], prop: 'diameter', value: '1391400', unit: 'km', note: NASA },
  { subjects: ['sun'], prop: 'radius', value: '695700', unit: 'km', note: NASA },
  { subjects: ['sun'], prop: 'mass', value: '1.989e30', unit: 'kg', note: NASA },
  { subjects: ['sun'], prop: 'temperature', value: '5500', unit: 'c', note: 'surface (photosphere) · NASA' },
  { subjects: ['earth'], prop: 'diameter', value: '12742', unit: 'km', note: `mean · ${NASA}` },
  { subjects: ['earth'], prop: 'radius', value: '6371', unit: 'km', note: `mean · ${NASA}` },
  { subjects: ['earth'], prop: 'circumference', value: '40075', unit: 'km', note: `equatorial · ${NASA}` },
  { subjects: ['earth'], prop: 'mass', value: '5.972e24', unit: 'kg', note: NASA },
  { subjects: ['earth'], prop: 'area', value: '510072000', unit: 'sqkm', note: 'total surface; land 148,940,000 km², water 361,132,000 km²' },
  { subjects: ['earth'], prop: 'speed', value: '29.78', unit: 'kms', note: 'mean orbital speed around the Sun · NASA' },
  { subjects: ['earth'], prop: 'period', value: '365.2422', unit: 'day', note: 'tropical year; one rotation takes 23 h 56 min 4 s' },
  { subjects: ['earth'], prop: 'gravity', value: '9.80665', note: 'm/s², standard gravity' },
  { subjects: ['moon'], prop: 'diameter', value: '3474.8', unit: 'km', note: NASA },
  { subjects: ['moon'], prop: 'radius', value: '1737.4', unit: 'km', note: NASA },
  { subjects: ['moon'], prop: 'mass', value: '7.342e22', unit: 'kg', note: NASA },
  { subjects: ['moon'], prop: 'period', value: '27.32', unit: 'day', note: 'sidereal orbit; a lunar month (new moon to new moon) is 29.53 days' },
  { subjects: ['moon'], prop: 'gravity', value: '1.62', note: 'm/s², about 1/6 of Earth' },
  { subjects: ['mercury'], prop: 'diameter', value: '4879', unit: 'km', note: NASA },
  { subjects: ['venus'], prop: 'diameter', value: '12104', unit: 'km', note: NASA },
  { subjects: ['mars'], prop: 'diameter', value: '6779', unit: 'km', note: NASA },
  { subjects: ['mars'], prop: 'mass', value: '6.39e23', unit: 'kg', note: NASA },
  { subjects: ['jupiter'], prop: 'diameter', value: '139820', unit: 'km', note: NASA },
  { subjects: ['jupiter'], prop: 'mass', value: '1.898e27', unit: 'kg', note: NASA },
  { subjects: ['saturn'], prop: 'diameter', value: '116460', unit: 'km', note: NASA },
  { subjects: ['uranus'], prop: 'diameter', value: '50724', unit: 'km', note: NASA },
  { subjects: ['neptune'], prop: 'diameter', value: '49244', unit: 'km', note: NASA },
  { subjects: ['pluto'], prop: 'diameter', value: '2376', unit: 'km', note: NASA },
  // --- oceans, trenches ---
  { subjects: ['pacific'], prop: 'area', value: '165250000', unit: 'sqkm', note: `largest ocean, about 46% of the water surface · ${NOAA}` },
  { subjects: ['pacific'], prop: 'depth', value: '10935', unit: 'm', note: `deepest point, Challenger Deep; average depth about 4,280 m · ${NOAA}` },
  { subjects: ['atlantic'], prop: 'area', value: '106460000', unit: 'sqkm', note: NOAA },
  { subjects: ['atlantic'], prop: 'depth', value: '8486', unit: 'm', note: `deepest point, Puerto Rico Trench · ${NOAA}` },
  { subjects: ['indian ocean'], prop: 'area', value: '70560000', unit: 'sqkm', note: NOAA },
  { subjects: ['indian ocean'], prop: 'depth', value: '7258', unit: 'm', note: `deepest point, Java Trench · ${NOAA}` },
  { subjects: ['southern ocean'], prop: 'area', value: '21960000', unit: 'sqkm', note: NOAA },
  { subjects: ['arctic ocean'], prop: 'area', value: '15558000', unit: 'sqkm', note: NOAA },
  { subjects: ['mariana trench'], prop: 'depth', value: '10935', unit: 'm', note: `Challenger Deep, deepest point of the oceans · ${NOAA}` },
  // --- mountains (height above sea level) ---
  { subjects: ['everest'], prop: 'height', value: '8848.86', unit: 'm', note: '2020 China–Nepal survey' },
  { subjects: ['k2'], prop: 'height', value: '8611', unit: 'm', note: 'second-highest mountain' },
  { subjects: ['kanchenjunga'], prop: 'height', value: '8586', unit: 'm', note: 'highest peak in India' },
  { subjects: ['nanda devi'], prop: 'height', value: '7816', unit: 'm', note: 'highest peak entirely within India' },
  { subjects: ['kilimanjaro'], prop: 'height', value: '5895', unit: 'm', note: 'highest mountain in Africa' },
  { subjects: ['mont blanc'], prop: 'height', value: '4808', unit: 'm', note: 'highest in the Alps' },
  { subjects: ['fuji'], prop: 'height', value: '3776', unit: 'm', note: 'highest mountain in Japan' },
  // --- rivers ---
  { subjects: ['nile'], prop: 'length', value: '6650', unit: 'km', note: 'longest river by most measures' },
  { subjects: ['amazon'], prop: 'length', value: '6400', unit: 'km', note: 'largest river by discharge' },
  { subjects: ['yangtze'], prop: 'length', value: '6300', unit: 'km', note: 'longest river in Asia' },
  { subjects: ['mississippi'], prop: 'length', value: '3730', unit: 'km', note: 'Mississippi alone; 6,275 km with the Missouri' },
  { subjects: ['ganga'], prop: 'length', value: '2525', unit: 'km', note: 'Gangotri to the Bay of Bengal' },
  { subjects: ['yamuna'], prop: 'length', value: '1376', unit: 'km', note: 'longest tributary of the Ganga' },
  { subjects: ['brahmaputra'], prop: 'length', value: '2900', unit: 'km', note: 'about 916 km in India' },
  { subjects: ['godavari'], prop: 'length', value: '1465', unit: 'km', note: 'longest river in peninsular India' },
  { subjects: ['narmada'], prop: 'length', value: '1312', unit: 'km', note: 'flows west into the Arabian Sea' },
  { subjects: ['krishna'], prop: 'length', value: '1400', unit: 'km', note: 'Mahabaleshwar to the Bay of Bengal' },
  { subjects: ['indus'], prop: 'length', value: '3180', unit: 'km', note: 'Tibet to the Arabian Sea' },
  { subjects: ['thames'], prop: 'length', value: '346', unit: 'km', note: 'longest river entirely in England' },
  // --- deserts, continents, countries, states (area) ---
  { subjects: ['sahara'], prop: 'area', value: '9200000', unit: 'sqkm', note: 'largest hot desert' },
  { subjects: ['thar'], prop: 'area', value: '200000', unit: 'sqkm', note: 'Great Indian Desert' },
  { subjects: ['gobi'], prop: 'area', value: '1295000', unit: 'sqkm', note: 'Mongolia and China' },
  { subjects: ['antarctica'], prop: 'area', value: '14200000', unit: 'sqkm', note: 'continent, including ice shelves' },
  { subjects: ['india'], prop: 'area', value: '3287263', unit: 'sqkm', note: 'Survey of India; coastline 7,516.6 km' },
  { subjects: ['russia'], prop: 'area', value: '17098246', unit: 'sqkm', note: 'largest country' },
  { subjects: ['china'], prop: 'area', value: '9596961', unit: 'sqkm', note: 'UN figure' },
  { subjects: ['usa'], prop: 'area', value: '9833520', unit: 'sqkm', note: 'including water' },
  { subjects: ['australia'], prop: 'area', value: '7692024', unit: 'sqkm', note: 'mainland and Tasmania' },
  { subjects: ['brazil'], prop: 'area', value: '8515767', unit: 'sqkm', note: 'largest in South America' },
  { subjects: ['canada'], prop: 'area', value: '9984670', unit: 'sqkm', note: 'second-largest country' },
  { subjects: ['pakistan'], prop: 'area', value: '881913', unit: 'sqkm', note: 'excluding disputed areas' },
  { subjects: ['bangladesh'], prop: 'area', value: '148460', unit: 'sqkm', note: 'BBS' },
  { subjects: ['sri lanka'], prop: 'area', value: '65610', unit: 'sqkm', note: 'island nation' },
  { subjects: ['nepal'], prop: 'area', value: '147516', unit: 'sqkm', note: 'Survey Department of Nepal' },
  { subjects: ['uk'], prop: 'area', value: '243610', unit: 'sqkm', note: 'ONS' },
  { subjects: ['japan'], prop: 'area', value: '377975', unit: 'sqkm', note: 'GSI' },
  { subjects: ['germany'], prop: 'area', value: '357022', unit: 'sqkm', note: 'Destatis' },
  { subjects: ['france'], prop: 'area', value: '551695', unit: 'sqkm', note: 'metropolitan France' },
  { subjects: ['rajasthan'], prop: 'area', value: '342239', unit: 'sqkm', note: 'largest Indian state' },
  { subjects: ['maharashtra'], prop: 'area', value: '307713', unit: 'sqkm', note: 'third-largest Indian state' },
  { subjects: ['uttar pradesh'], prop: 'area', value: '240928', unit: 'sqkm', note: 'fourth-largest Indian state' },
  { subjects: ['madhya pradesh'], prop: 'area', value: '308252', unit: 'sqkm', note: 'second-largest Indian state' },
  // --- structures ---
  { subjects: ['burj khalifa'], prop: 'height', value: '828', unit: 'm', note: 'tallest building, Dubai' },
  { subjects: ['eiffel tower'], prop: 'height', value: '330', unit: 'm', note: 'including antennas, Paris' },
  { subjects: ['statue of unity'], prop: 'height', value: '182', unit: 'm', note: 'statue alone; 240 m with its base, Gujarat' },
  { subjects: ['qutub minar'], prop: 'height', value: '72.5', unit: 'm', note: 'Delhi' },
  { subjects: ['taj mahal'], prop: 'height', value: '73', unit: 'm', note: 'main dome, Agra' },
  { subjects: ['statue of liberty'], prop: 'height', value: '93', unit: 'm', note: 'ground to torch, New York' },
  { subjects: ['great wall'], prop: 'length', value: '21196', unit: 'km', note: 'all sections, 2012 survey' },
  { subjects: ['golden gate'], prop: 'length', value: '2737', unit: 'm', note: 'total bridge length, San Francisco' },
  { subjects: ['empire state'], prop: 'height', value: '443', unit: 'm', note: 'to the tip, New York' },
  { subjects: ['big ben'], prop: 'height', value: '96', unit: 'm', note: 'Elizabeth Tower, London' },
  { subjects: ['howrah bridge'], prop: 'length', value: '705', unit: 'm', note: 'Kolkata' },
  // --- physics ---
  { subjects: ['light'], prop: 'speed', value: '299792458', unit: 'mps', note: 'exact, in vacuum' },
  { subjects: ['sound'], prop: 'speed', value: '343', unit: 'mps', note: 'dry air at 20°C; about 1,235 km/h' },
  { subjects: ['gravity'], prop: 'value', value: '9.80665', note: 'm/s², standard gravity on Earth' },
  { subjects: ['escape velocity'], prop: 'value', value: '11.186', unit: 'kms', note: 'from Earth\'s surface' },
  { subjects: ['water'], prop: 'temperature', value: '100', unit: 'c', note: 'boils at 100°C and freezes at 0°C at sea level' },
  { subjects: ['human body'], prop: 'temperature', value: '37', unit: 'c', note: 'normal body temperature, 98.6°F' },
  { subjects: ['absolute zero'], prop: 'value', value: '-273.15', unit: 'c', note: '0 K' },
  { subjects: ['light year'], prop: 'value', value: '9460730472580.8', unit: 'km', note: 'distance light travels in one Julian year' },
  { subjects: ['astronomical unit'], prop: 'value', value: '149597870.7', unit: 'km', note: 'mean Earth–Sun distance' },
  { subjects: ['parsec'], prop: 'value', value: '30856775814913.7', unit: 'km', note: '3.26 light years' },
  { subjects: ['avogadro'], prop: 'value', value: '6.02214076e23', note: 'per mole, exact' },
  { subjects: ['pi'], prop: 'value', value: '3.14159265358979', note: 'ratio of circumference to diameter' },
  { subjects: ['golden ratio'], prop: 'value', value: '1.61803398874989', note: '(1 + √5) / 2' },
  { subjects: ['year'], prop: 'period', value: '365.2422', unit: 'day', note: 'tropical year' },
  { subjects: ['lunar month'], prop: 'period', value: '29.53', unit: 'day', note: 'new moon to new moon' },
];

/** city centres for straight-line distances (degrees) */
export const CITIES: Record<string, [number, number]> = {
  delhi: [28.6139, 77.209], 'new delhi': [28.6139, 77.209], mumbai: [19.076, 72.8777], bombay: [19.076, 72.8777], bangalore: [12.9716, 77.5946], bengaluru: [12.9716, 77.5946], chennai: [13.0827, 80.2707],
  madras: [13.0827, 80.2707], kolkata: [22.5726, 88.3639], calcutta: [22.5726, 88.3639], hyderabad: [17.385, 78.4867], pune: [18.5204, 73.8567], ahmedabad: [23.0225, 72.5714], jaipur: [26.9124, 75.7873],
  lucknow: [26.8467, 80.9462], chandigarh: [30.7333, 76.7794], kochi: [9.9312, 76.2673], goa: [15.4909, 73.8278], panaji: [15.4909, 73.8278], surat: [21.1702, 72.8311], indore: [22.7196, 75.8577],
  bhopal: [23.2599, 77.4126], patna: [25.5941, 85.1376], guwahati: [26.1445, 91.7362], varanasi: [25.3176, 82.9739], agra: [27.1767, 78.0081], amritsar: [31.634, 74.8723], srinagar: [34.0837, 74.7973],
  nagpur: [21.1458, 79.0882], coimbatore: [11.0168, 76.9558], visakhapatnam: [17.6868, 83.2185], vizag: [17.6868, 83.2185], bhubaneswar: [20.2961, 85.8245], dehradun: [30.3165, 78.0322], shimla: [31.1048, 77.1734],
  thiruvananthapuram: [8.5241, 76.9366], trivandrum: [8.5241, 76.9366], ranchi: [23.3441, 85.3096], raipur: [21.2514, 81.6296], kanpur: [26.4499, 80.3319], noida: [28.5355, 77.391], gurgaon: [28.4595, 77.0266], gurugram: [28.4595, 77.0266],
  london: [51.5074, -0.1278], 'new york': [40.7128, -74.006], paris: [48.8566, 2.3522], tokyo: [35.6762, 139.6503], dubai: [25.2048, 55.2708], singapore: [1.3521, 103.8198], sydney: [-33.8688, 151.2093],
  'san francisco': [37.7749, -122.4194], 'los angeles': [34.0522, -118.2437], chicago: [41.8781, -87.6298], toronto: [43.6532, -79.3832], berlin: [52.52, 13.405], moscow: [55.7558, 37.6173], beijing: [39.9042, 116.4074],
  shanghai: [31.2304, 121.4737], 'hong kong': [22.3193, 114.1694], bangkok: [13.7563, 100.5018], kathmandu: [27.7172, 85.324], dhaka: [23.8103, 90.4125], colombo: [6.9271, 79.8612], karachi: [24.8607, 67.0011],
  lahore: [31.5204, 74.3587], islamabad: [33.6844, 73.0479], 'kuala lumpur': [3.139, 101.6869], doha: [25.2854, 51.531], 'abu dhabi': [24.4539, 54.3773], riyadh: [24.7136, 46.6753], cairo: [30.0444, 31.2357],
  johannesburg: [-26.2041, 28.0473], nairobi: [-1.2921, 36.8219], istanbul: [41.0082, 28.9784], rome: [41.9028, 12.4964], madrid: [40.4168, -3.7038], amsterdam: [52.3676, 4.9041], zurich: [47.3769, 8.5417],
  frankfurt: [50.1109, 8.6821], washington: [38.9072, -77.0369], seattle: [47.6062, -122.3321], boston: [42.3601, -71.0589], melbourne: [-37.8136, 144.9631], auckland: [-36.8485, 174.7633], mecca: [21.3891, 39.8579],
  muscat: [23.588, 58.3829], 'kuwait city': [29.3759, 47.9774], manila: [14.5995, 120.9842], jakarta: [-6.2088, 106.8456], seoul: [37.5665, 126.978], taipei: [25.033, 121.5654], vancouver: [49.2827, -123.1207],
  'mexico city': [19.4326, -99.1332], 'sao paulo': [-23.5505, -46.6333], 'buenos aires': [-34.6037, -58.3816], lisbon: [38.7223, -9.1393], dublin: [53.3498, -6.2603], stockholm: [59.3293, 18.0686], oslo: [59.9139, 10.7522],
  copenhagen: [55.6761, 12.5683], vienna: [48.2082, 16.3738], prague: [50.0755, 14.4378], athens: [37.9838, 23.7275], tehran: [35.6892, 51.389],
};

const entityByAlias = new Map<string, string>();
for (const [id, aliases] of Object.entries(ENTITY_ALIASES)) for (const a of aliases) entityByAlias.set(a, id);
export const ENTITY_WORDS = new Set<string>([...entityByAlias.keys(), ...Object.keys(CITIES)]);

/** question fillers that carry no meaning for a fact lookup */
const FILLERS = new Set(['what', 'is', 'the', 'a', 'an', 'how', 'much', 'many', 'does', 'do', 'did', 'it', 'its', 'of', 'from', 'to', 'between', 'and', 'in', 'on', 'at', 'by', 'tell', 'me', 'please', 'approximately', 'approx', 'about', 'exact', 'exactly',
  'kitna', 'kitni', 'kitne', 'kya', 'hai', 'hain', 'h', 'ka', 'ki', 'ke', 'se', 'tak', 'batao', 'bata', 'bataiye', 'mujhe', 'mera', 'meri', 'ko', 'par', 'pe', 'kis', 'kaun', 'kaunsa', 'kaunsi', 'there', 'are', 'was', 'were', 'planet', 'river', 'ocean', 'mountain', 'mount', 'mt', 'city', 'desert', 'country', 'state', 'building', 'tower', 'trench', 'average', 'mean']);

export interface FactAnswer {
  q: Quantity;
  label: string;
}

/** great-circle distance between two cities in km (WGS84 mean radius) */
export function cityDistanceKm(a: string, b: string): Decimal | null {
  const pa = own(CITIES, a) ? CITIES[a] : null;
  const pb = own(CITIES, b) ? CITIES[b] : null;
  if (!pa || !pb) return null;
  const rad = (d: number) => (d * Math.PI) / 180;
  const [lat1, lon1] = [rad(pa[0]), rad(pa[1])];
  const [lat2, lon2] = [rad(pb[0]), rad(pb[1])];
  const h = Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2;
  return new Decimal(2 * 6371.0088 * Math.asin(Math.sqrt(h))).toDecimalPlaces(1);
}

/** multi-word aliases and cities matched longest-first; returns canonical ids in order of appearance */
function findEntities(text: string): { ids: string[]; rest: string } {
  const ids: string[] = [];
  let rest = ` ${text} `;
  const names = [...entityByAlias.keys(), ...Object.keys(CITIES)].sort((x, y) => y.length - x.length);
  for (const name of names) {
    const re = new RegExp(`(?<=\\s)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s)`);
    if (re.test(rest)) {
      ids.push(entityByAlias.get(name) ?? name);
      rest = rest.replace(re, ' ');
    }
  }
  return { ids, rest: rest.replace(/\s+/g, ' ').trim() };
}

/**
 * "distance from earth to moon", "chand kitna door hai", "size of pacific ocean", "everest ki height",
 * "speed of light", "delhi to mumbai distance": returns the fact or null. Numbers in the text mean it is
 * a calculation, not a question.
 */
export function lookupFact(raw: string): FactAnswer | null {
  let text = raw.toLowerCase().replace(/[?!.,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/\d/.test(text)) return null;
  // two-word properties
  text = text.replace(/\b(boiling|freezing) point\b/g, 'temperature').replace(/\bsurface area\b/g, 'area').replace(/\bhow (far|big|tall|high|deep|long|heavy|fast|hot|wide)\b/g, (_m, w: string) => w);
  const { ids, rest } = findEntities(text);
  if (ids.length === 0 || ids.length > 2) return null;
  const leftover = rest.split(' ').filter((w) => w && !FILLERS.has(w));
  const props = leftover.filter((w) => own(PROP_ALIASES, w)).map((w) => PROP_ALIASES[w]);
  const unknown = leftover.filter((w) => !own(PROP_ALIASES, w));
  if (unknown.length) return null;
  const prop: Prop | undefined = props[0];
  const subjects = [...ids].sort();
  if (ids.length === 2) {
    if (prop && prop !== 'distance') return null;
    const km = cityDistanceKm(ids[0], ids[1]);
    if (km) return { q: { kind: 'unit', value: km, unit: 'km', note: 'straight-line (great-circle) distance; by road it is longer' }, label: `${ids[0]} → ${ids[1]}` };
    const f = FACTS.find((x) => x.prop === 'distance' && x.subjects.join('|') === subjects.join('|'));
    if (!f) return null;
    return { q: { kind: 'unit', value: new Decimal(f.value), unit: f.unit!, note: f.note }, label: `${f.subjects.join(' – ')} distance` };
  }
  // "chand ki doori", "how far is mars": a distance with one body is measured from Earth
  if (prop === 'distance' && ids[0] !== 'earth') {
    const pair = [ids[0], 'earth'].sort().join('|');
    const f = FACTS.find((x) => x.prop === 'distance' && x.subjects.join('|') === pair);
    if (f) return { q: { kind: 'unit', value: new Decimal(f.value), unit: f.unit!, note: `from Earth · ${f.note}` }, label: `earth – ${ids[0]} distance` };
  }
  const candidates = FACTS.filter((x) => x.subjects.length === 1 && x.subjects[0] === ids[0]);
  if (!candidates.length) return null;
  let f = prop ? candidates.find((x) => x.prop === prop) : undefined;
  if (!f && !prop) f = candidates.length === 1 ? candidates[0] : candidates.find((x) => x.prop === 'value') ?? candidates.find((x) => x.prop === 'height' || x.prop === 'area' || x.prop === 'length');
  if (!f) return null;
  const q: Quantity = f.unit ? { kind: 'unit', value: new Decimal(f.value), unit: f.unit, note: f.note } : { kind: 'number', value: new Decimal(f.value), note: f.note };
  return { q, label: `${f.subjects[0]} ${f.prop}` };
}

/** phrases that may stand in an expression ("distance to moon / speed of light"), longest first */
export function factPhrases(): { phrase: string; fact: Fact }[] {
  const out: { phrase: string; fact: Fact }[] = [];
  const names = (id: string) => (own(ENTITY_ALIASES, id) ? ENTITY_ALIASES[id] : [id]);
  for (const f of FACTS) {
    if (f.subjects.length === 2) {
      const [a, b] = f.subjects;
      for (const x of names(a)) for (const y of names(b)) {
        out.push({ phrase: `distance from ${x} to ${y}`, fact: f }, { phrase: `distance from ${y} to ${x}`, fact: f }, { phrase: `distance between ${x} and ${y}`, fact: f }, { phrase: `distance between ${y} and ${x}`, fact: f });
        out.push({ phrase: `${x} to ${y} distance`, fact: f }, { phrase: `${y} to ${x} distance`, fact: f }, { phrase: `${x} ${y} distance`, fact: f }, { phrase: `${y} ${x} distance`, fact: f });
        if (a === 'earth') out.push({ phrase: `distance to ${y}`, fact: f }, { phrase: `distance to the ${y}`, fact: f }, { phrase: `${y} distance`, fact: f }, { phrase: `${y} ki doori`, fact: f });
        if (b === 'earth') out.push({ phrase: `distance to ${x}`, fact: f }, { phrase: `distance to the ${x}`, fact: f }, { phrase: `${x} distance`, fact: f }, { phrase: `${x} ki doori`, fact: f });
      }
    } else {
      for (const x of names(f.subjects[0])) {
        if (f.prop === 'value') out.push({ phrase: x, fact: f });
        else out.push({ phrase: `${f.prop} of ${x}`, fact: f }, { phrase: `${f.prop} of the ${x}`, fact: f }, { phrase: `${x} ${f.prop}`, fact: f }, { phrase: `${x}'s ${f.prop}`, fact: f });
      }
    }
  }
  return out.sort((p, q) => q.phrase.length - p.phrase.length);
}
