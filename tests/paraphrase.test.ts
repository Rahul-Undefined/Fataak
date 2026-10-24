/** Paraphrase matrix: equivalent phrasings in English and Hinglish must give the same answer. */
import { describe, it, expect } from 'vitest';
import { last } from './helpers';

const matrix: Record<string, [string[], string]> = {
  'percent of': [['15% of 200', 'what is 15 percent of 200', '200 ka 15%', '200 ka 15 percent kitna', '200 ka 15 percent nikalo', 'fifteen percent of two hundred', '15 percent of 200 kya hoga'], '30'],
  'percent increase': [['increase 50 by 20%', '50 plus 20%', '50 + 20%', '50 badhao 20%', '50 ko 20% badha do', '50 me 20% badhao', '20% on 50', 'add 20% to 50', 'fifty increased by twenty percent'], '60'],
  'percent decrease': [['decrease 50 by 20%', '50 - 20%', '20% off 50', '50 pe 20% discount', '50 ghatao 20%', '50 me se 20% kam karo', 'reduce 50 by 20%', '50 ko 20% ghata do'], '40'],
  'reverse percent': [['80 is 20% less than what', 'what becomes 80 after a 20% decrease', '80 kis amount se 20% kam hai', '80 kis number se 20% kam hai'], '100'],
  'percent change': [['from 40 to 50 percent change', 'percentage increase from 40 to 50', '40 se 50 kitne percent badha', '50 is what % more than 40', '40 to 50 % change', '40 se 50 hua, kitna percent badha'], '25% increase'],
  'gst add': [['1000 + 18% gst', 'gst 18% on 1000', '1000 pe 18% gst lagao', '1000 me 18% gst jodo', 'add 18% gst to 1000', '1000 with 18% gst'], '1,180'],
  'gst reverse': [['1180 inclusive of 18% gst', 'reverse gst 1180 at 18%', '1180 me se 18% gst hatao', '1180 me 18% gst included hai, base kitna', '1180 including 18% gst'], '1,000'],
  'discount': [['20% discount on 1500', '1500 pe 20% discount', '1500 pe 20% chhoot', 'take 20 percent off 1500', '20% off 1500', '1500 ka 20% discount ke baad'], '1,200'],
  'profit': [['bought at 500 sold at 600', '500 me kharida 600 me becha', 'cost 500 sell 600 profit', 'cp 500 sp 600', '500 ka kharida 600 ka becha, profit kitna'], '100 profit'],
  'margin %': [['cost 400 sell 500 margin', 'margin if cost 400 and price 500', '400 me kharida 500 me becha margin kitna'], '20%'],
  'emi': [['emi 5 lakh at 9% for 5 years', '5 lakh ka loan 9% pe 5 saal emi', 'emi for 500000 at 9% over 60 months', 'reducing balance emi 5 lakh 9% 5 years', '5 lakh loan 9% 5 saal ki emi kitni'], '10,379.18/month'],
  'simple interest': [['simple interest on 10000 at 5% for 2 years', '10000 pe 5% byaj 2 saal', 'si 10000 5% 2 years', '10000 pe 5% sadharan byaj 2 saal ka'], '1,000'],
  'division': [['50000 divided equally among 3 people', '50000 ke 3 bhag karo', '50000 ko 3 logon mein baanto', 'split 50000 three ways', '3 logon me 50000 baraabar baanto'], '16,666.67 each'],
  'chain': [['5000 ka aadha aur usmein 250 jodo', 'half of 5000 and add 250 to that', 'half of 5000, then add 250', '5000 ka half karo phir 250 add karo'], '2,750'],
  'named total': [['Rahul ko 150, Rohit ko 250, total kitna', 'Rahul 150, Rohit 250, total', 'rahul 150 and rohit 250, sum', 'Rohit ke 250, Rahul ke 150, dono ka total kitna'], '400'],
  'currency': [['100 usd in inr', '100 dollars in rupees', '100 dollar kitne rupaye', '100 dollar ko rupee me', 'convert 100 usd to inr', '$100 in inr', '100 dollar rupaye me kitna'], '₹8,400'],
  'units': [['5 km in miles', '5 km ko miles me badlo', 'convert 5 km to miles', '5 kilometres in miles', '5 km kitne miles'], '3.11 mi'],
  'date after': [['today + 45 days', 'aaj se 45 din baad', '45 days from today', '45 days after today', 'aaj ke 45 din baad'], 'Mon, 7 Dec 2026'],
  'time zone': [['6pm IST to EST', '6pm IST ko EST me convert karo', '6 pm ist me kitne baje honge est me', '6pm IST se EST'], '7:30 AM EST'],
  'weekday': [['what day is 15 aug 2026', '15 aug 2026 ko kaunsa din hai', '15 aug 2026 ki bar', '15 aug 2026 kya din hai'], 'Saturday, 15 Aug 2026'],
  'time span': [['hours between 9am and 5pm', '9am to 5pm', '9 baje se 5 baje tak kitne ghante', 'subah 9 baje se sham 5 baje tak kitne ghante'], '8 h'],
};

describe('paraphrases agree across English and Hinglish', () => {
  for (const [name, [inputs, expected]] of Object.entries(matrix)) {
    describe(name, () => {
      it.each(inputs)('%s', (input) => {
        const out = last(input);
        if (name === 'date after') expect(out).toMatch(/7 Dec 2026/);
        else expect(out).toBe(expected);
      });
    });
  }
});
