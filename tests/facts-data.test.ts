/** Reference facts, data sizes and bandwidth. Expected values are the published figures / hand arithmetic. */
import { describe, it, expect } from 'vitest';
import { last, lastNote, run } from './helpers';

describe('reference facts', () => {
  it.each([
    ['distance from earth to moon', '384,400 km'],
    ['distance between the moon and the earth', '384,400 km'],
    ['how far is the moon from earth', '384,400 km'],
    ['earth se chand kitna door hai', '384,400 km'],
    ['chand ki doori', '384,400 km'],
    ['distance of sun from earth', '149,597,870.7 km'],
    ['sun se earth ki doori', '149,597,870.7 km'],
    ['distance from sun to moon', '149,600,000 km'],
    ['how far is mars from the sun', '227,956,000 km'],
    ['distance between earth and mars', '225,000,000 km'],
    ['jupiter to sun distance', '778,479,000 km'],
    ['size of pacific ocean', '165,250,000 km²'],
    ['pacific ocean area', '165,250,000 km²'],
    ['pacific ocean kitna bada hai', '165,250,000 km²'],
    ['how deep is the pacific ocean', '10,935 m'],
    ['depth of mariana trench', '10,935 m'],
    ['area of indian ocean', '70,560,000 km²'],
    ['height of mount everest', '8,848.86 m'],
    ['everest ki height', '8,848.86 m'],
    ['everest kitna uncha hai', '8,848.86 m'],
    ['mount everest', '8,848.86 m'],
    ['how tall is burj khalifa', '828 m'],
    ['length of the nile', '6,650 km'],
    ['ganga ki lambai', '2,525 km'],
    ['how long is the great wall of china', '21,196 km'],
    ['area of india', '3,287,263 km²'],
    ['india ka area', '3,287,263 km²'],
    ['area of sahara desert', '9,200,000 km²'],
    ['speed of light', '299,792,458 m/s'],
    ['light ki speed', '299,792,458 m/s'],
    ['speed of sound', '343 m/s'],
    ['mass of earth', '5.972e+24 kg'],
    ['earth ka vajan', '5.972e+24 kg'],
    ['diameter of the sun', '1,391,400 km'],
    ['earth radius', '6,371 km'],
    ['circumference of earth', '40,075 km'],
    ['moon ka diameter', '3,474.8 km'],
    ['boiling point of water', '100°C'],
    ['absolute zero', '-273.15°C'],
    ['escape velocity', '11.19 km/s'],
    ['avogadro number', '6.022141e+23'],
    ['one light year', 'ERR'],
  ])('%s → %s', (input, expected) => {
    const r = run(input)[0];
    expect(r.ok ? r.display : 'ERR').toBe(expected);
  });
  it('city distances are great-circle and say so', () => {
    expect(last('distance between delhi and mumbai')).toBe('1,148.1 km');
    expect(last('delhi to mumbai distance')).toBe('1,148.1 km');
    expect(last('mumbai se bangalore kitna door hai')).toBe('845.3 km');
    expect(last('distance from london to new york')).toBe('5,570.2 km');
    expect(lastNote('delhi to mumbai distance')).toContain('straight-line');
  });
  it('facts carry their source and convert', () => {
    expect(lastNote('distance to moon')).toContain('NASA');
    expect(last('distance to moon in miles')).toBe('238,855.09 mi');
    expect(last('height of everest in feet')).toBe('29,031.69 ft');
  });
  it('facts work inside expressions', () => {
    expect(last('distance to moon / speed of light')).toBe('1.28 s');
    expect(last('2 * earth radius in miles')).toBe('7,917.51 mi');
    expect(last('distance from earth to sun / speed of light in minutes')).toBe('8.32 min');
    expect(last('speed of light * 1 second in km')).toBe('299,792.46 km');
  });
  it('numbers in the sentence mean a calculation, not a lookup', () => {
    expect(last('distance 120 km in 2 hours')).toBe('60 km/h');
    expect(run('moon 5')[0].ok).toBe(true);
  });
});

describe('data sizes and bandwidth', () => {
  it.each([
    ['1 tb in gb', '1,000 GB'],
    ['1 pb in tb', '1,000 TB'],
    ['2.5 pb in gb', '2,500,000 GB'],
    ['1 eb in pb', '1,000 PB'],
    ['1 gib in mb', '1,073.74 MB'],
    ['8 gbit in gb', '1 GB'],
    ['1 gb in megabits', '8,000 Mbit'],
    ['100 mbps in mb/s', '12.5 MB/s'],
    ['1 gbps in mbps', '1,000 Mbps'],
    ['500 gb + 1.5 tb', '2,000 GB'],
    ['4 tb - 750 gb in tb', '3.25 TB'],
    ['2 gb at 50 mbps', '5 min 20 s'],
    ['how long to download 2 gb at 50 mbps', '5 min 20 s'],
    ['how long will it take to download 1.5 gb on 100 mbps', '2 min'],
    ['700 mb file at 10 mbps', '9 min 20 s'],
    ['4 gb at 5 mb/s', '13 min 20 s'],
    ['50 mbps pe 2 gb download kitna time lagega', '5 min 20 s'],
    ['10 gb at 1 gbps', '1 min 20 s'],
    ['2 gb in 10 seconds', '200 MB/s'],
    ['speed if 700 mb downloaded in 5 minutes', '2.33 MB/s'],
    ['10 mbps for 1 hour', '4.5 GB'],
    ['data used in 1 hour at 10 mbps', '4.5 GB'],
    ['1 gbps * 1 minute', '7.5 GB'],
    ['100 gb / 10 mbps', '22 h 13 min 20 s'],
    ['1 tb / 1 gbps in hours', '2.22 h'],
    ['2 gb at 50 kg', 'ERR'],
  ])('%s → %s', (input, expected) => {
    const r = run(input)[0];
    expect(r.ok ? r.display : 'ERR').toBe(expected);
  });
});
