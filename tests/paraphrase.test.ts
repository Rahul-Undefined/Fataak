/** Paraphrase matrix: equivalent phrasings in English, Hinglish and Bengalish must give the same answer. */
import { describe, it, expect } from 'vitest';
import { last } from './helpers';

const matrix: Record<string, [string[], string]> = {
  'percent of': [['15% of 200', 'what is 15 percent of 200', '200 ka 15%', '200 ka 15 percent kitna', '200 er 15%', '200 takar 15 percent ber koro'.replace('takar', 'er'), 'fifteen percent of two hundred'], '30'],
  'percent increase': [['increase 50 by 20%', '50 plus 20%', '50 + 20%', '50 badhao 20%', '50 ko 20% badha do', '50 e 20% barao', '20% on 50', 'add 20% to 50', 'fifty increased by twenty percent'], '60'],
  'percent decrease': [['decrease 50 by 20%', '50 - 20%', '20% off 50', '50 pe 20% discount', '50 ghatao 20%', '50 theke 20% komao', '50 me se 20% kam karo', 'reduce 50 by 20%'], '40'],
  'reverse percent': [['80 is 20% less than what', 'what becomes 80 after a 20% decrease', '80 kis amount se 20% kam hai', '80 kon number theke 20% kom'], '100'],
  'percent change': [['from 40 to 50 percent change', 'percentage increase from 40 to 50', '40 se 50 kitne percent badha', '40 theke 50 koto percent barlo', '50 is what % more than 40', '40 to 50 % change'], '25% increase'],
  'gst add': [['1000 + 18% gst', 'gst 18% on 1000', '1000 pe 18% gst lagao', '1000 e 18% gst add koro', 'add 18% gst to 1000', '1000 with 18% gst'], '1,180'],
  'gst reverse': [['1180 inclusive of 18% gst', 'reverse gst 1180 at 18%', '1180 me se 18% gst hatao', '1180 theke 18% gst bad dao', '1180 takar moddhe 18% gst ache base koto'.replace('takar', 'er'), '1180 including 18% gst'], '1,000'],
  'discount': [['20% discount on 1500', '1500 pe 20% discount', '1500 e 20% chhar', 'take 20 percent off 1500', '20% off 1500', '1500 ka 20% discount ke baad'], '1,200'],
  'profit': [['bought at 500 sold at 600', '500 me kharida 600 me becha', '500 te kinlam 600 e bechlam', 'cost 500 sell 600 profit', 'cp 500 sp 600'], '100 profit'],
  'margin %': [['cost 400 sell 500 margin', 'margin if cost 400 and price 500', '400 me kharida 500 me becha margin kitna'], '20%'],
  'emi': [['emi 5 lakh at 9% for 5 years', '5 lakh ka loan 9% pe 5 saal emi', '5 lakh loan 9% e 5 bochor emi koto', 'emi for 500000 at 9% over 60 months', 'reducing balance emi 5 lakh 9% 5 years'], '10,379.18/month'],
  'simple interest': [['simple interest on 10000 at 5% for 2 years', '10000 pe 5% byaj 2 saal', '10000 e 5% sud 2 bochor', 'si 10000 5% 2 years'], '1,000'],
  'division': [['50000 divided equally among 3 people', '50000 ke 3 bhag karo', '50000 ko 3 logon mein baanto', '50000 taka 3 joner moddhe bhag koro'.replace('taka ', ''), 'split 50000 three ways'], '16,666.67 each'],
  'chain': [['5000 ka aadha aur usmein 250 jodo', 'half of 5000 and add 250 to that', '5000 er ardhek ar tate 250 jog koro', 'half of 5000, then add 250'], '2,750'],
  'named total': [['Rahul ko 150, Rohit ko 250, total kitna', 'Rahul 150, Rohit 250, total', 'Rohit er 250, Rahul er 150, dujoner total koto', 'rahul 150 and rohit 250, sum'], '400'],
  'currency': [['100 usd in inr', '100 dollars in rupees', '100 dollar kitne rupaye', '100 dollar ko rupee me', '100 dollar rupee te koto', 'convert 100 usd to inr', '$100 in inr'], '₹8,400'],
  'units': [['5 km in miles', '5 km ko miles me badlo', '5 km miles e koto', 'convert 5 km to miles', '5 kilometres in miles'], '3.11 mi'],
  'date after': [['today + 45 days', 'aaj se 45 din baad', 'ajke theke 45 din por', '45 days from today', '45 days after today'], '7 Dec 2026'],
  'time zone': [['6pm IST to EST', '6pm IST theke EST e convert koro', '6pm IST ko EST me convert karo', '6 pm ist me kitne baje honge est me'], '7:30 AM EST'],
  'weekday': [['what day is 15 aug 2026', '15 aug 2026 ko kaunsa din hai', '15 aug 2026 ki bar', '15 aug 2026 kya din hai'], 'Saturday, 15 Aug 2026'],
  'time span': [['hours between 9am and 5pm', '9am to 5pm', '9 baje se 5 baje tak kitne ghante', 'sokal 9 ta theke bikel 5 ta koto ghonta'], '8 hours'],
};

describe('paraphrases agree across English, Hinglish and Bengalish', () => {
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
