import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { last, lastNote, run } from './helpers';

const summer = DateTime.fromISO('2026-07-15T10:00:00', { zone: 'Asia/Kolkata' }); // US on EDT, UK on BST
const winter = DateTime.fromISO('2026-12-15T10:00:00', { zone: 'Asia/Kolkata' }); // US on EST, UK on GMT

describe('time zone conversion', () => {
  it('English, Hinglish and Bengalish phrasings agree', () => {
    expect(last('6pm IST to EST', { now: winter })).toBe('7:30 AM EST');
    expect(last('6pm IST theke EST e convert koro', { now: winter })).toBe('7:30 AM EST');
    expect(last('6pm IST ko EST me convert karo', { now: winter })).toBe('7:30 AM EST');
    expect(last('6 pm ist me kitne baje honge est me', { now: winter })).toBe('7:30 AM EST');
  });

  it('handles daylight saving time via IANA zones', () => {
    expect(last('6pm IST to EST', { now: summer })).toBe('8:30 AM EDT');
    expect(last('London 10am to Kolkata time', { now: summer })).toBe('2:30 PM IST');
    expect(last('London 10am to Kolkata time', { now: winter })).toBe('3:30 PM IST');
    expect(last('2:30 pm HKT in Berlin', { now: summer })).toBe('8:30 AM CEST');
    expect(last('2:30 pm HKT in Berlin', { now: winter })).toBe('7:30 AM CET');
  });

  it('notes date changes', () => {
    expect(last('11pm IST to PST', { now: winter })).toBe('9:30 AM PST');
    expect(lastNote('11pm IST to PST', { now: winter })).not.toContain('day');
    expect(last('3am IST to PST', { now: winter })).toBe('1:30 PM PST');
    expect(lastNote('3am IST to PST', { now: winter })).toContain('previous day');
    expect(last('9pm PST to IST', { now: winter })).toBe('10:30 AM IST');
    expect(lastNote('9pm PST to IST', { now: winter })).toContain('next day');
  });

  it('explicit dates respect that day’s DST rules', () => {
    // 2 Nov 2026 is after US DST ends (1 Nov 2026) but UK/India unaffected
    expect(last('10am EST on 2 nov 2026 to IST', { now: summer })).toBe('8:30 PM IST');
    expect(last('10am ET to IST on 25 oct 2026', { now: winter })).toBe('7:30 PM IST');
  });

  it('flags ambiguous abbreviations and resolves them deterministically', () => {
    expect(lastNote('6pm IST to EST', { now: winter })).toContain('IST = India');
    expect(last('9am CST to IST', { now: winter })).toBe('8:30 PM IST');
    expect(lastNote('9am CST to IST', { now: winter })).toContain('US Central');
    expect(last('9am GST to IST', { now: winter })).toBe('10:30 AM IST');
    expect(last('9am BDT to IST', { now: winter })).toBe('8:30 AM IST');
  });

  it('current time in a city', () => {
    expect(last('time in tokyo')).toBe('1:30 PM JST');
    expect(last('New York time')).toBe('12:30 AM EDT');
    expect(last('tokyo te ekhon koto baje')).toBe('1:30 PM JST');
    expect(last('dubai me abhi kitne baje hain')).toBe('8:30 AM GST');
  });

  it('relative times: "2 hrs from now in est" is now + 2 h, converted', () => {
    // NOW is 10:00 IST = 04:30 UTC = 00:30 EDT
    expect(last('2 hrs from now in est')).toBe('2:30 AM EDT');
    expect(lastNote('2 hrs from now in est')).toContain('now + 2 h');
    expect(last('in 3 hours est time')).toBe('3:30 AM EDT');
    expect(last('30 min ago in tokyo')).toBe('1:00 PM JST');
    expect(last('2 ghante baad est me kitne baje')).toBe('2:30 AM EDT');
    expect(last('ekhon theke 2 ghonta por tokyo te koto baje')).toBe('3:30 PM JST');
    expect(last('now + 2 hours in est')).toBe('2:30 AM EDT');
    expect(last('6pm + 1 hour in est')).toBe('9:30 AM EDT');
    expect(last('now in est')).toBe('12:30 AM EDT');
  });

  it('single zone converts from the local zone', () => {
    expect(last('6pm to EST', { now: winter })).toBe('7:30 AM EST');
    expect(last('6pm PST', { now: winter })).toBe('7:30 AM IST');
  });

  it('does not treat GST tax or BDT money as time zones', () => {
    expect(last('25000 + 18% gst')).toBe('29,500');
    expect(last('100 BDT in INR')).toBe('₹70');
    expect(run('100 bdt')[0].display).toBe('100 BDT');
  });
});
