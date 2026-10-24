/**
 * Reliability benchmark: 974 cases with independently computed answers (hand-worked or Python decimal),
 * never taken from the engine. NOW = Fri 23 Oct 2026 10:00 IST; test rates USD base (INR 84, EUR 0.92,
 * GBP 0.78, JPY 150, AED 3.67, SGD 1.34; historical 13 Oct 2026 INR 80).
 *
 * Metric groups: core arithmetic (target ≥ 99.9%), structured intents (≥ 99%), natural-language
 * patterns (≥ 95%), and inputs that must fail clearly (0 wrong numbers). Every case is asserted
 * individually; the per-group table is printed for the report.
 */
import { describe, it, expect } from 'vitest';
import { run } from './helpers';

type Case = [string | string[], string | RegExp];
const GROUP: Record<string, 'core' | 'intent' | 'nl' | 'negative'> = {
  arithmetic: 'core', arithmetic2: 'core',
  percent: 'intent', percent2: 'intent', gst_tax: 'intent', gst2: 'intent', discount_profit: 'intent', profit2: 'intent', interest_emi: 'intent', interest2: 'intent',
  units: 'intent', units2: 'intent', dates: 'intent', dates2: 'intent', times: 'intent', times2: 'intent', currency: 'intent', currency2: 'intent', variables: 'intent', context2: 'intent',
  hinglish: 'nl', hinglish2: 'nl', nonsense: 'negative', data3: 'intent', facts3: 'intent', everyday3: 'nl', money4: 'intent', life4: 'nl', health4: 'intent', deeper4: 'core',
};
const M: Record<string, Case[]> = {
  arithmetic: [
    ['12 + 7 * 3', '33'], ['(12 + 7) * 3', '57'], ['100 / 8', '12.5'], ['2 ^ 10', '1,024'], ['-5 + 3', '-2'], ['7 - -2', '9'], ['3 * (4 + 5) ^ 2', '243'],
    ['10 / 3', '3.3333'], ['1/3 + 1/3 + 1/3', '1'], ['0.1 + 0.2', '0.3'], ['1e6 / 1e3', '1,000'], ['2 ^ 0.5 * 2 ^ 0.5', '2'], ['17 mod 5', '2'], ['7!', '5,040'],
    ['sqrt(2)', '1.4142'], ['cbrt(1000)', '10'], ['10 ^ -2', '0.01'], ['(2 + 3) * (4 - 1) / 5', '3'], ['what is 25 times 4 plus 10', '110'], ['twelve times twelve', '144'],
    ['2 raised to 8', '256'], ['3 squared plus 4 squared', '25'], ['square root of 169', '13'], ['half of 250', '125'], ['double 45', '90'], ['quarter of 100', '25'],
    ['average of 2, 4, 6, 8', '5'], ['sum of 1, 2, 3, 4, 5', '15'], ['max of 3, 9, 4', '9'], ['lcm of 6, 8 and 12', '24'], ['gcd(48, 180)', '12'], ['round(3.14159, 2)', '3.14'],
    ['1,234 + 1,000', '2,234'], ['1,00,000 + 1', '100,001'], ['5 x 5', '25'], ['10 − 4', '6'], ['6 × 7', '42'], ['9 ÷ 3', '3'], ['((((1))))', '1'],
    ['1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10', '55'], ['999999999 * 999999999', '999,999,998,000,000,001'], ['0.000001 * 0.000001', '1e-12'], ['2 ^ 3 ^ 2', '512'],
    ['Calculate 0.000000375 multiplied by 24000000', '9'], ['What is 35% of 840 plus 12% of 1250?', '444'], ['(245 - 87) * (144 / 12) + 325', '2,221'],
    ['15 divided by 4', '3.75'], ['divide 100 by 8', '12.5'], ['multiply 12 by 12', '144'], ['subtract 15 from 100', '85'], ['100 minus 15', '85'], ['add 15 to 100', '115'],
    ['2 to the power of 16', '65,536'], ['5 cubed', '125'], ['cube root of 729', '9'], ['log(1000)', '3'], ['ln(1)', '0'], ['abs(-7.5)', '7.5'], ['10% of 10% of 10000', '100'],
    ['1 lakh 20 hazaar + 5000', '125,000'], ['paanch sau + do sau', '700'], ['2.5 lakh * 2', '500,000'], ['1 crore / 4', '2,500,000'], ['three thousand five hundred - 500', '3,000'],
    ['10 / 0', 'ERR'], ['5 +', 'ERR'], ['* 5', 'ERR'], ['2 ^', 'ERR'], ['sqrt(-1)', 'ERR'], ['171!', 'ERR'], ['1e400', 'ERR'], ['12/13/2026', 'ERR'], ['(1 + 2', 'ERR'], ['1 + 2)', 'ERR'],
  ],
  percent: [
    ['20% of 450', '90'], ['450 ka 20%', '90'], ['what is 12.5% of 640', '80'], ['7.5% of 1200', '90'], ['30 is what percent of 120', '25%'], ['45 is what % of 60', '75%'],
    ['what percent of 80 is 20', '25%'], ['120 + 15%', '138'], ['120 - 15%', '102'], ['increase 240 by 25%', '300'], ['decrease 240 by 25%', '180'], ['240 ko 25% badhao', '300'],
    ['240 me 25% kam karo', '180'], ['from 80 to 100 percent change', '25% increase'], ['100 to 80 % change', '20% decrease'], ['percentage difference between 40 and 60', '40% difference'],
    ['what is 10% more than 500', '550'], ['what is 10% less than 500', '450'], ['600 is 20% more than what', '500'], ['400 is 20% less than what', '500'], ['5% of what is 25', '500'],
    ['25 is 5% of what', '500'], ['what original amount becomes 2300 after a 15% increase', '2,000'], ['20% of 50% of 1000', '100'], ['salary 50000, 10% hike', '55,000'],
    ['3 successive discounts of 10%, 20% and 25% on 1000', '540'], ['20% discount then 10% discount on 2000', '1,440'], ['1200 after 20% discount, original price?', '1,500'],
    ['15% of 800 then subtract 35% of 240', '36'], ['25% of 1200 plus 10% of 500', '350'], ['1000 + 10% + 10%', '1,210'], ['1000 - 10% - 10%', '810'], ['12% of 2460 kitna hoga', '295.2'],
    ['2460 ka 12 pratishat', '295.2'], ['5 percentage points more than 20%', '25%'], ['20% + 5 points', '25%'], ['0.375 as %', '37.5%'], ['3/8 as a percent', '37.5%'], ['48 as a % of 60', '80%'],
    ['75 out of 120 as a percentage', '62.5%'], ['2500 pe 5% kitna hoga', '125'], ['18.5% of 2460', '455.1'], ['Increase 5000 by 12%', '5,600'], ['What original amount becomes 57500 after a 15% increase?', '50,000'],
    ['what is 15% less than 575', '488.75'], ['what number is 750 20% more than?', '625'], ['840 is 12% less than what', '954.55'], ['reverse 15% of 575', '500'],
    ['a shirt costs 1200 after a 25% discount, what was the original price', '1,600'], ['population grew from 12000 to 13500, percent growth', '12.5% increase'],
    ['marks 432 out of 500 percentage', '86.4%'], ['score 86 out of 120 in percent', '71.67%'], ['80% of 80% of 500', '320'], ['what is 200% of 45', '90'], ['0.5% of 1000000', '5,000'],
    ['20% of', 'ERR'], ['of 20%', 'ERR'], ['10 % 5 %', 'ERR'], ['percent of 500', 'ERR'],
  ],
  gst_tax: [
    ['1000 + 18% gst', '1,180'], ['18% gst on 1000', '1,180'], ['gst on 1000 at 18%', '1,180'], ['1180 inclusive of 18% gst', '1,000'], ['1180 including gst 18%', '1,000'],
    ['remove 18% gst from 1180', '1,000'], ['5% gst + 2% cess on 2000', '2,140'], ['cgst 9% and sgst 9% on 5000', '5,900'], ['28% gst on 1 lakh', '128,000'],
    ['price 999 inclusive of 12% gst, base price', '891.96'], ['2 items at 450 each with 12% gst', '1,008'], ['3 pcs @ 120 + 18% gst', '424.8'], ['invoice 10000, 5% discount, 18% gst', '11,210'],
    ['10000 me 10% discount ke baad 18% gst', '10,620'], ['bill 2500 plus 5% service charge plus 18% gst', '3,097.5'], ['1000 pe 18% gst lagao', '1,180'], ['1000 me 18% gst jodo', '1,180'],
    ['1180 me se 18% gst hatao', '1,000'], ['1000 me 18% GST included hai, base kitna', '847.46'], ['A product costs 8500 before GST. Apply a 12% discount first and then add 18% GST.', '8,826.4'],
    ['A customer owes 25000 plus 18% GST after a 10% discount and pays 15000.', '11,550'], ['An invoice has 4 items at 1250 each, a 10% discount before GST, and 18% GST.', '5,310'],
    ['25000 + 18% gst, then 10% discount', '26,550'], ['1000 including 18% GST, then apply 10% discount', '900'], ['gst 12% on 2500 and 18% on 4000, total', '7,520'],
    ['how much gst in 2360 at 18%', '360'], ['gst amount on 5000 at 12%', '600'], ['gst on 1000', 'ERR'], ['18% gst', 'ERR'],
  ],
  discount_profit: [
    ['20% off on 1500', '1,200'], ['1500 pe 20% off', '1,200'], ['1500 ka 20% discount', '1,200'], ['discount 20% on 1500', '1,200'], ['1200 after 20% discount original price', '1,500'],
    ['bought at 450 sold at 540', '90 profit'], ['450 me kharida 540 me becha', '90 profit'], ['bought 540 sold 450', '90 loss'], ['cost 450 profit 20% selling price', '540'],
    ['sell at 20% profit on 450', '540'], ['450 pe 20% munafa', '540'], ['sold at 540 with 20% profit, cost price', '450'], ['sold 400 at 20% loss, cost', '500'],
    ['markup 25% on 400', '500'], ['margin 25% on 400', '533.33'], ['cost 400 sell 500 markup', '25%'], ['cost 400 sell 500 margin', '20%'],
    ['revenue 500000 expenses 350000 profit margin', '30%'], ['revenue 12 lakh net profit 1.8 lakh margin', '15%'], ['revenue 1000 cogs 600 gross margin', '40% gross margin'],
    ['A business earns revenue of 18 lakh and has net profit of 2.7 lakh. Calculate the net profit margin.', '15%'], ['A customer owes 87500 and pays 65% of the balance.', '30,625'],
    ['A company has revenue of 2500000, COGS of 1450000, payroll expenses of 425000 and other operating expenses of 275000.', '350,000 operating profit'],
    ['invested 5000 got back 6500 return %', '30% return'], ['roi 5000 to 6500', '30% return'], ['bought shares for 12000 sold for 10800, loss percent', '10%'],
    ['profit of 150 on cost 600, profit %', '25%'], ['sold for 720 at 20% profit, cost price?', '600'], ['cost 800, sold at 10% loss', '720'], ['10% loss on 800', '720'],
    ['discount of 150 on 1000 is what percent', '15%'], ['2 successive discounts of 20% and 20% on 1000', '640'], ['3 lakh ka 2 guna', '600,000'],
    ['bought at 500', '500'], ['sold at 600', 'ERR'], ['markup 25%', 'ERR'],
  ],
  interest_emi: [
    ['simple interest on 10000 at 5% for 2 years', '1,000'], ['10000 pe 5% byaj 2 saal', '1,000'], ['10000 pe 5% byaj 2 saal, kitna milega', '11,000'],
    ['compound interest on 10000 at 10% for 2 years', '2,100'], ['ci 10000 10% 2 years', '2,100'], ['amount after 2 years at 10% compound on 10000', '12,100'],
    ['compound interest 10000 at 8% for 3 years quarterly', '2,682.42'], ['compound interest on 50000 at 7% for 5 years', '20,127.59'], ['1 lakh at 6% compounded monthly for 10 years, interest', '81,939.67'],
    ['emi 10 lakh at 8.5% for 20 years', '8,678.23/month'], ['emi 5 lakh 9% 5 years', '10,379.18/month'], ['total interest on emi 5 lakh at 9% for 5 years', '122,750.8'],
    ['loan 200000 at 12% for 3 years emi', '6,642.86/month'], ['50000 ka loan 12% pe 2 saal, emi kitni', '2,353.67/month'], ['emi for 25 lakh at 7.2% for 15 years', '22,751.17/month'],
    ['car loan 3 lakh at 10.5% for 48 months', '7,681.01/month'], ['flat rate loan 100000 at 10% for 2 years', '5,000/month'], ['si 5000 at 4% for 18 months', '300'],
    ['simple interest 12000 at 7.5% for 3 years', '2,700'], ['interest on 50000 at 6% for 6 months', '1,500'], ['emi 5 lakh for 5 years', 'ERR'], ['interest on 10000 at 5%', 'ERR'],
    ['10000 at 5% for 2 years simple interest, total amount', '11,000'], ['what is the maturity amount of 20000 at 8% compound for 3 years', '25,194.24'],
    ['emi 5 lakh at 0% for 10 months', '50,000/month'], ['si on 1 lakh at 12% per annum for 6 months', '6,000'],
  ],
  units: [
    ['5 km in miles', '3.11 mi'], ['10 miles in km', '16.09 km'], ['100 m in ft', '328.08 ft'], ['6 ft in cm', '182.88 cm'], ['5 ft 10 in in cm', '177.8 cm'], ['70 kg in lbs', '154.32 lb'],
    ['150 lb in kg', '68.04 kg'], ['2 l in ml', '2,000 ml'], ['500 ml in l', '0.5 l'], ['1 gallon in litres', '3.79 l'], ['30 c in f', '86°F'], ['98.6 f in c', '37°C'], ['0 k in c', '-273.15°C'],
    ['1 acre in sq ft', '43,560 sq ft'], ['1 hectare in acres', '2.47 acre'], ['2.5 hours in minutes', '150 min'], ['90 minutes in hours', '1.5 h'], ['1 day in seconds', '86,400 s'],
    ['1 gb in mb', '1,000 MB'], ['1 gib in mib', '1,024 MiB'], ['100 km/h in m/s', '27.78 m/s'], ['60 mph in km/h', '96.56 km/h'], ['1 m3 in litres', '1,000 l'], ['5 kg + 500 g', '5.5 kg'],
    ['2 km + 300 m', '2.3 km'], ['1 hour + 30 minutes', '1.5 h'], ['3 ft + 6 in', '3.5 ft'], ['10 km / 2 hours', '5 km/h'], ['100 m / 10 s', '10 m/s'], ['5 km in cm', '500,000 cm'],
    ['1 mile in metres', '1,609.34 m'], ['72 inches in feet', '6 ft'], ['2.4 cubic metres to litres', '2,400 l'], ['5 kg in grams', '5,000 g'], ['45 degrees in radians', '0.79 rad'],
    ['Convert 7.85 kilometres to metres, miles and feet.', '7,850 m · 4.88 mi · 25,754.59 ft'], ['Convert 4.65 acres to square feet and square metres.', '202,554 sq ft · 18,817.88 m²'],
    ['Convert 3.75 cubic metres to litres and millilitres.', '3,750 l · 3,750,000 ml'], ['Convert 98.6 degrees Fahrenheit to Celsius.', '37°C'], ['Convert 5 hours 42 minutes into total minutes and decimal hours.', '342 min · 5.7 h'],
    ['A tank holds 2.75 cubic metres of water. If 18% is drained and then 125 litres are added, how many litres remain?', '2,380 l'], ['Convert 88 miles per hour to kilometres per hour.', '141.62 km/h'],
    ['2.75 hours in hours and minutes', '2 hours 45 minutes'], ['5 km ko miles me badlo', '3.11 mi'], ['100 metre kitne feet', '328.08 ft'], ['10 kg kitne pound', '22.05 lb'],
    ['how many cm in 2 metres', '200 cm'], ['how many minutes in 3.5 hours', '210 min'], ['how many seconds in a day', '86,400 s'], ['1.5 km + 800 m in m', '2,300 m'],
    ['speed 120 km in 1.5 hours', '80 km/h'], ['distance 60 km/h * 2.5 hours', '150 km'], ['5 kg to litres', 'ERR'], ['10 usd in kg', 'ERR'], ['5 km + 2 hours', 'ERR'], ['convert 5 kg', 'ERR'],
  ],
  dates: [
    ['today', '23 Oct 2026'], ['tomorrow', '24 Oct 2026'], ['yesterday', '22 Oct 2026'], ['today + 10 days', '2 Nov 2026'], ['today - 10 days', '13 Oct 2026'], ['10 days ago', '13 Oct 2026'],
    ['3 weeks from now', '13 Nov 2026'], ['next friday', '30 Oct 2026'], ['last monday', '19 Oct 2026'], ['this sunday', '25 Oct 2026'], ['days between 1 jan 2026 and 31 dec 2026', '364 days'],
    ['days until 1 jan 2027', '70 days'], ['days since 1 jan 2026', '295 days'], ['15 aug 2026 + 1 month', '15 Sep 2026'], ['31 jan 2026 + 1 month', '28 Feb 2026'], ['what day is 1 jan 2027', 'Friday, 1 Jan 2027'],
    ['15 aug 1947 kaunsa din tha', 'Friday, 15 Aug 1947'], ['is 2024 a leap year', '2024: leap year'], ['is 2100 a leap year', '2100: not a leap year'], ['last day of feb 2024', 'Thu, 29 Feb 2024'],
    ['weekdays between 1 oct 2026 and 31 oct 2026', '22 weekdays'], ['age if born 15 aug 1990', '36 years'], ['how old am i if born on 2 feb 2000', '26 years'], ['months between 1 jan 2026 and 1 jul 2026', '6 months'],
    ['14/08/2026 + 1 day', '15 Aug 2026'], ['how many days in feb 2028', '29 days'], ['1 jan 2027 + 100 days', '11 Apr 2027'], ['100 days from 1 jan 2027', 'Sun, 11 Apr 2027'],
    ['How many weekdays are there from 1 February 2027 through 28 February 2027, inclusive?', '20 weekdays'], ['What is the last day of February 2100?', 'Sun, 28 Feb 2100'],
    ['aaj se 45 din baad', 'Mon, 7 Dec 2026'], ['kal ke 10 din baad', 'Tue, 3 Nov 2026'], ['aaj kaunsa din hai', 'Friday, 23 Oct 2026'], ['15 aug 2026 ko kya din hai', 'Saturday, 15 Aug 2026'],
    ['1 jan 2027 se 31 jan 2027 tak kaam ke din kitne', '21 weekdays'], ['days from 23 oct 2026 to 25 dec 2026', '63 days'], ['2026-12-25 - today', '63 days'], ['25 dec 2026 - 23 oct 2026', '63 days'],
    ['weeks between 1 jan 2026 and 1 mar 2026', '8.43 weeks'], ['date 90 days before 1 jan 2027', 'Sat, 3 Oct 2026'], ['2 weeks after 15 nov 2026', 'Sun, 29 Nov 2026'], ['first day of next month', 'Sun, 1 Nov 2026'],
    ['end of this month', 'Sat, 31 Oct 2026'], ['how many days till christmas 2026', '63 days'], ['30 feb 2026', 'ERR'], ['days between 1 jan and', 'ERR'], ['1 jan 2026 + 5 kg', 'ERR'],
    ['which day was 26 jan 1950', 'Thursday, 26 Jan 1950'], ['number of days in 2024', '366 days'], ['today in 3 months', 'Sat, 23 Jan 2027'], ['6 months ago', '23 Apr 2026'],
  ],
  times: [
    ['9am to 5pm', '8 hours'], ['9:30 am to 6:15 pm', '8 hours 45 minutes'], ['10pm to 6am', '8 hours'], ['2:45 pm + 3 hours', '5:45 PM'], ['now + 2 hours', '12 PM'],
    ['6pm IST to EST', '7:30 AM EST'], ['9 am new york to london', '2 PM BST'], ['3pm london time in kolkata', '7:30 PM IST'], ['time in tokyo', '1:30 PM JST'], ['what time is it in new york', '12:30 AM EDT'],
    ['5pm sydney to ist', '11:30 AM IST'], ['Convert 8:45 PM Kolkata time to London time on 15 January 2027.', '3:15 PM GMT'], ['Convert 9:20 AM New York time to Kolkata time on 15 July 2027.', '6:50 PM IST'],
    ['convert 2pm dubai to singapore', '6 PM SGT'], ['12:00 utc in ist', '5:30 PM IST'], ['11:30 pm ist in pst', '10 AM PST'], ['meeting at 10am est, time in india', '8:30 PM IST'],
    ['8:00 - 17:30 minus 1 hour lunch', '8 hours 30 minutes'], ['A train departs at 21:48 and arrives at 06:17 the next day.', '8 hours 29 minutes'], ['2 ghante baad kitne baje honge', '12:00 PM IST'],
    ['abhi tokyo me kitne baje', '1:30 PM JST'], ['subah 10 baje se sham 5 baje tak kitne ghante', '7 hours'], ['2 hrs from now in est', '1:30 AM EST'], ['10:15 + 2:30', 'ERR'],
    ['5pm + 3 km', 'ERR'], ['time in atlantis', 'ERR'], ['6pm ist in', 'ERR'], ['45 minutes + 30 minutes', '75 min'], ['3 hours 20 minutes + 1 hour 50 minutes', '310 min'],
    ['9 to 5', 'ERR'], ['from 10:00 to 13:45', '3 hours 45 minutes'], ['shift 22:00 to 06:00', '8 hours'], ['1pm to 1pm', '24 hours'],
  ],
  currency: [
    ['100 usd in inr', '₹8,400'], ['$100 to inr', '₹8,400'], ['5000 inr in usd', '$59.52'], ['100 eur in gbp', '£84.78'], ['100 usd + 50 usd', '$150'], ['100 usd + 50 eur', 'ERR'],
    ['100 usd + 50 eur in inr', '₹12,965.22'], ['₹5000 - 10%', '₹4,500'], ['2 lakh rupees in dollars', '$2,380.95'], ['1 crore inr in usd', '$119,047.62'], ['100 dollars kitne rupaye', '₹8,400'],
    ['50 pounds in rupees', '₹5,384.62'], ['1000 yen in inr', '₹560'], ['100 aed in inr', '₹2,288.83'], ['1 usd in inr', '₹84'], ['100 usd in inr on 13 oct 2026', '₹8,000'], ['100 usd in inr 10 days ago', '₹8,000'],
    [['₹100', '₹200', 'sum'], '₹300'], [['$10', '€20', 'sum'], 'ERR'], [['$10', '€20', 'sum in usd'], '$31.74'], ['100 sgd in inr', '₹6,268.66'], ['1 gbp in usd', '$1.28'],
    ['$1,250.50 + $749.50', '$2,000'], ['₹1,00,000 * 1.5', '₹1,50,000'], ['€99.99 * 3', '€299.97'], ['100 usd in xyz', 'ERR'], ['1 btc in usd', 'ERR'], ['convert 100 usd to inr', '₹8,400'],
    ['$100 - 20% in inr', '₹6,720'], ['salary 85000 inr in usd per month', '$1,011.9'], ['100 dollar rupaye me kitna', '₹8,400'], ['25 usd * 4 in inr', '₹8,400'], ['usd 100 in inr', '₹8,400'],
  ],
  variables: [
    [['rent = 15000', 'food = 8000', 'rent + food'], '23,000'], [['salary: 50000', 'salary * 12'], '600,000'], [['price 240', 'price * 3'], '720'], [['a = 5', 'b = a * 2', 'a + b'], '15'],
    [['x = 10', 'x ^ 2'], '100'], [['total: 1000', 'total - 10%'], '900'], [['rahul 150', 'rohit 250', 'rahul + rohit'], '400'], [['1000', '10% of that'], '100'], [['1000', 'that + 500'], '1,500'],
    [['1000', '', 'that * 2'], '2,000'], [['1000', 'asdf', 'prev * 2'], '2,000'], [['1000', 'clear context', 'prev * 2'], 'ERR'], [['Meri salary 50000', 'salary 12% badhao'], '56,000'],
    ['If x = 375 and y = 28% of x, calculate x + y, x - y and x * y.', '480 · 270 · 39,375'], ['If Rahul = 2450, Priti = 1875 and Amit = 925, calculate Rahul + Priti * 2 - Amit.', '5,275'],
    ['Set rent = 18500, food = 9200 and travel = 3750. Calculate total expenses and remaining balance from salary of 78500.', '31,450 · 47,050'],
    [['rent: 15000', 'food: 8000', 'travel: 3000', 'sum'], '26,000'], [['rent: 15000', 'food: 8000', 'average'], '11,500'], [['10', '20', '30', 'total'], '60'], [['a: 2', 'b: 3', 'a ^ b'], '8'],
    [['budget: 50000', 'spent: 32000', 'budget - spent'], '18,000'], [['usd rate: 84', '100 * usd rate'], '8,400'], [['x = 5', 'y = x + 1', 'z = y * 2', 'x + y + z'], '23'],
    [['price: ₹500', 'qty: 3', 'price * qty'], '₹1,500'], [['price: ₹500', 'price * qty'], 'ERR'], [['a = 1', 'reset', 'a + 1'], 'ERR'], [['line1: 10', 'line1 + 5'], '15'],
  ],
  hinglish: [
    ['500 ka 18 percent nikal ke total mein add kar', '590'], ['mere paas 5000 the, 1275 kharch kiye, kitna bacha', '3,725'], ['mere paas 5000 the, 1275 kharch kiye, phir 450 mile. ab kitne bache?', '4,175'],
    ['12 ka 3 guna', '36'], ['144 ka vargmool', '12'], ['27 ka cube root', '3'], ['dedh lakh ka 10%', '15,000'], ['dhai hazaar ka 20%', '500'], ['10000 pe 8% byaj 3 saal', '2,400'],
    ['5 logon me 2000 baanto', '400 each'], ['rahul ko 300, priya ko 200, dono ka total', '500'], ['20 ka 25 percent kya hai', '5'], ['300 me se 20% hatao', '240'], ['300 me 20% jodo', '360'],
    ['salary 68000 ko 7% badhao, phir 10% ghatao', '65,484'], ['1500 pe 20% chhoot do', '1,200'], ['500 me kharida 400 me becha', '100 loss'], ['5 lakh ka loan 9% pe 5 saal, emi kitni', '10,379.18/month'],
    ['10000 pe 5% chakravriddhi byaj 2 saal', '1,025'], ['meri salary 12% badhao kitni hogi', 'ERR'], ['2 lakh ka 15% kitna', '30,000'], ['1 crore ka 2%', '200,000'],
    ['aaj se 2 hafte baad', 'Fri, 6 Nov 2026'], ['kal kaunsa din hai', 'Saturday, 24 Oct 2026'], ['agle mahine ki 1 tarikh', 'Sun, 1 Nov 2026'], ['3 din pehle', 'Tue, 20 Oct 2026'],
    ['do hazaar me se paanch sau ghatao', '1,500'], ['saat sau ka aadha', '350'], ['1000 ka dugna', '2,000'], ['100 ka tigna', '300'], ['ek lakh ka 12 percent', '12,000'],
    ['2500 rupaye ka 5 percent nikalo', '₹125'], ['50000 ko 3 hisson me baanto', '16,666.67 each'], ['1000 pe 20% chhoot, phir aur 10% chhoot', '720'], ['4500 pe 10% chhoot, phir 18% gst lagao', '4,779'],
    ['750 kis number se 20% zyada hai?', '625'], ['15% badhne ke baad 3910 ho jata hai, pehle kitna tha?', '3,400'], ['bikri 500000 aur kharcha 350000, profit margin kitna?', '30%'],
    ['salary 50000 se 57500 hui, kitne percent badhi?', '15% increase'], ['100 dollar kitne rupaye', '₹8,400'], ['6pm IST ko EST me convert karo', '7:30 AM EST'], ['abhi se 2 ghante baad tokyo me kitne baje', '3:30 PM JST'],
    ['mujhe 20% discount ke baad 800 dene pade, original price kya thi', '1,000'], ['kitna hoga', 'ERR'], ['badhao', 'ERR'], ['5000 ko', '5,000'],
  ],
  nonsense: [
    ['hello how are you', 'ERR'], ['what is the meaning of life', 'ERR'], ['5 apples + 3 oranges', 'ERR'], ['x + 1', 'ERR'], ['rahul * 2', 'ERR'], ['constructor', 'ERR'], ['__proto__ + 1', 'ERR'],
    ['toString', 'ERR'], ['asdf', 'ERR'], ['', 'ERR'], ['   ', 'ERR'], ['// comment', 'ERR'], ['# header', 'ERR'], ['=', 'ERR'], ['%', 'ERR'], ['in', 'ERR'], ['to', 'ERR'], ['then', 'ERR'],
    ['1 2 3', 'ERR'], ['5 5', 'ERR'], ['gst discount emi', 'ERR'], ['100 usd eur gbp', 'ERR'], ['today tomorrow', '1 day'], ['average', 'ERR'], ['sum of', 'ERR'], ['lcm of 4', 'ERR'],
    ['divide 100 in ratio', 'ERR'], ['split 1000', 'ERR'], ['emi', 'ERR'], ['percent', 'ERR'], ['1 +++ 2', 'ERR'], ['2 ** ** 2', 'ERR'], ['(((', 'ERR'], ['1e', 'ERR'],
    ['what is 5 + ?', 'ERR'], ['calculate', 'ERR'], ['how many', 'ERR'], ['kitne', 'ERR'], ['5 ka', 'ERR'], ['ka 5', 'ERR'], ['what original amount', 'ERR'],
  ],
  arithmetic2: [
    ['((2 + 3) * (7 - 4)) ^ 2 / 5', '45'], ['2 ^ 2 ^ 3', '256'], ['-3 ^ 2', '-9'], ['(-3) ^ 2', '9'], ['10 - 2 * 3 + 4 / 2', '6'], ['100 / 4 / 5', '5'], ['2 * 3 ^ 2 * 2', '36'],
    ['0.3 - 0.1', '0.2'], ['1/7', '0.1429'], ['22/7', '3.1429'], ['pi * 2', '6.2832'], ['e ^ 2', '7.3891'], ['sin(30)', '0.5'], ['cos(60)', '0.5'], ['tan(45)', '1'], ['15 mod 4 + 2', '5'],
    ['2 ^ 100', '1.267651e+30'], ['100000 * 100000', '10,000,000,000'], ['1e3 * 1e3', '1,000,000'], ['5 lakh * 20', '10,000,000'], ['2 crore + 50 lakh', '25,000,000'], ['1.5 lakh - 25000', '125,000'],
    ['twenty five percent of two hundred', '50'], ['one hundred and fifty plus thirty', '180'], ['12 ^ 2 - 11 ^ 2', '23'], ['sqrt(144) + cbrt(27)', '15'], ['abs(-5) * 3', '15'], ['round(2.5)', '3'],
    ['floor(7.9)', '7'], ['ceil(7.1)', '8'], ['10!', '3,628,800'], ['7 / 2 * 2', '7'], ['2 + 3 * 4 ^ 2 / 8', '8'], ['(1 + 2) ^ (2 + 1)', '27'], ['1000 / 3 rounded to 2 dp', '333.33'],
    ['99999999999999999999 + 1', '100,000,000,000,000,000,000'], ['1/3 * 3', '1'], ['0.1 + 0.7', '0.8'], ['5 + 5 please', '10'], ['5 + 5 = ?', '10'], ['5 + 5 =', '10'], ['2 + 2 = 5', 'ERR'],
    ['x = 5 = 6', 'ERR'], ['5 apples', 'ERR'], ['apples 5', '5'], ['0 ^ 0', '1'], ['0 ^ -1', 'ERR'], ['sqrt(-4)', 'ERR'], ['log(-1)', 'ERR'], ['10 ÷ 0', 'ERR'], ['5 mod 0', 'ERR'], ['hello 5 + 5', '10'],
    ['1 lakh crore', '1,000,000,000,000'], ['3 dozen', '36'], ['1..2', 'ERR'], ['%%', 'ERR'], ['null', 'ERR'], ['Infinity', 'ERR'], ['1/0 + 1', 'ERR'], ['(-8) ^ (1/3)', 'ERR'],
  ],
  percent2: [
    ['20% of 30% of 50% of 10000', '300'], ['1000 increased by 10% then decreased by 10%', '990'], ['what percent is 15 of 60', '25%'], ['15 is what percent more than 12', '25% increase'],
    ['12 is what percent less than 15', '20% decrease'], ['50 + 50%', '75'], ['50 - 50%', '25'], ['50 * 50%', '25'], ['50 / 50%', '100'], ['200 + 10% - 10%', '198'], ['5% of 5% of 100', '0.25'],
    ['120% of 50', '60'], ['0.5% of 20000', '100'], ['percent change from 200 to 150', '25% decrease'], ['percentage increase from 1.5 lakh to 2.1 lakh', '40% increase'], ['7 out of 8 as percentage', '87.5%'],
    ['what is 1/3 as a percentage', '33.33%'], ['2/3 as %', '66.67%'], ['increase 2.5 lakh by 7.5%', '268,750'], ['a number increased by 20% gives 720, find the number', '600'],
    ['after a 10% hike salary is 55000, old salary', '50,000'], ['price after 25% off is 750, original?', '1,000'], ['40% of x is 80, x?', '200'], ['what is 250 increased by 100%', '500'],
    ['decrease 999 by 33.33%', '666.0333'], ['12.5% of 12.5% of 6400', '100'], ['33 is what % of 44', '75%'], ['what % of 250 is 75', '30%'], ['from 100 to 100 percent change', '0% increase'],
    ['0 is what percent of 50', '0%'], ['50 is what percent of 0', 'ERR'], ['150% more than 40', '100'], ['what is 50% less than 1000', '500'],
  ],
  gst2: [
    ['price 1180 with 18% gst included, gst amount', '180'], ['remove 5% gst and 2% cess from 1070', '1,000'], ['bill 10000 add 18% gst then 2% tds deduct', '11,564'], ['5 items at 1200 each, 18% gst, total', '7,080'],
    ['subtotal 4500, discount 10%, gst 18%, total', '4,779'], ['gst inclusive price 2360, rate 18%, base', '2,000'], ['what is the gst on 2500 at 5%', '125'], ['how much tax on 2500 at 5%', '125'],
    ['2500 pe 5% tax kitna', '125'], ['5% tax on 2500 total', '2,625'], ['salary 60000 hai, 30% tax katke kitna milega', '42,000'], ['45000 me se 12% kaat lo', '39,600'], ['12% tds on 50000', '44,000'],
    ['gst 18% on 1 lakh and 5% on 50000, total gst', '20,500'], ['1000 + 18% gst + 2% tds', '1,156.4'],
  ],
  profit2: [
    ['mrp 2000, 25% off, then 10% off, final price', '1,350'], ['cp 800 sp 1000 profit percent', '25%'], ['loss percent if cp 500 sp 450', '10%'], ['selling price for 25% profit on cost 640', '800'],
    ['cost price if selling price 920 includes 15% profit', '800'], ['markup of 40% on cost 250', '350'], ['margin if cost 250 and selling price 350', '28.57%'], ['20% profit on 1500 then 10% loss on that', '1,620'],
    ['discount 15% on 2400 and gst 12% on discounted price', '2,284.8'], ['two successive discounts of 10% on 500', '405'], ['bought 10 pens at 12 each, sold all at 15 each, profit', '30 profit'],
    ['revenue 8 lakh, cogs 5 lakh, opex 1.5 lakh, operating margin', '18.75% operating margin'], ['profit 20% on cost 500, selling price', '600'], ['sold at 25% loss for 600, cost', '800'],
    ['cost 450 sell 450', '0 profit'], ['invested 20000 now worth 25000, return', '25% return'], ['roi if invested 10000 and received 9000', '-10% return'],
  ],
  interest2: [
    ['ci on 1 lakh at 8% for 2 years compounded half yearly', '16,985.86'], ['emi 20 lakh 8% 10 years total interest', '911,862.4'], ['home loan 50 lakh 8.5% 20 years emi', '43,391.16/month'],
    ['simple interest 25000 at 9% per annum for 15 months', '2,812.5'], ['flat rate 12% loan 100000 2 years, emi', '5,166.67/month'], ['fd 1 lakh at 7% for 3 years quarterly compounding maturity', '123,143.93'],
    ['paanch lakh ka loan 10 percent pe 5 saal ki emi', '10,623.52/month'], ['das hazaar pe 12 percent byaj 3 saal ka', '3,600'], ['loan of 1 lakh at 12% for 24 months, monthly payment', '4,707.35/month'],
    ['total repayment on 1 lakh at 12% for 24 months emi', '112,976.4'], ['interest on 1 lakh at 12% for 2 years compounded yearly', '25,440'], ['si on 0 at 5% for 2 years', '0'],
    ['emi 5 lakh at 9% for 0 months', 'ERR'], ['emi 5 lakh at -9% for 5 years', 'ERR'],
  ],
  units2: [
    ['1 light year in km', '9,460,730,472,580.8 km'], ['5 ft 7 in + 2 in', '69 in'], ['1 acre in hectares', '0.4 ha'], ['100 sq m in sq ft', '1,076.39 sq ft'], ['2 tonnes in kg', '2,000 kg'],
    ['3 km + 500 m in km', '3.5 km'], ['72 km/h in m/s', '20 m/s'], ['1 m/s in km/h', '3.6 km/h'], ['15 litres in gallons', '3.96 gal'], ['250 ml * 4', '1,000 ml'], ['250 ml * 4 in l', '1 l'],
    ['2 hours 30 minutes in minutes', '150 min'], ['3600 seconds in hours', '1 h'], ['1 week in hours', '168 h'], ['36.6 c in f', '97.88°F'], ['-40 c in f', '-40°F'], ['300 k in c', '26.85°C'],
    ['5 kg * 2', '10 kg'], ['10 kg / 4', '2.5 kg'], ['1400 km / 70 km/h', '20 h'], ['mera weight 70 kg hai, pounds me kitna', '154.32 lb'], ['meri height 5 feet 8 inch hai, cm me', '172.72 cm'],
    ['180 cm in ft and in', '5 ft 10.87 in'], ['1 kg in lb and oz', '2 lb 3.27 oz'], ['10 mbps in kbps', '10,000 kbps'], ['5 kg + 3 litres', 'ERR'], ['100 c in k', '373.15 K'], ['0 f in c', '-17.78°C'],
    ['1 mile in km, m and ft', '1.61 km · 1,609.34 m · 5,280 ft'], ['25 mm in cm', '2.5 cm'], ['1.75 m in cm', '175 cm'], ['half a kilometre in metres', '500 m'],
  ],
  dates2: [
    ['days between 29 feb 2024 and 1 mar 2024', '1 day'], ['29 feb 2023', 'ERR'], ['31 apr 2026', 'ERR'], ['weeks from 1 jan 2026 to 31 dec 2026', '52 weeks'], ['how many weekends in nov 2026', '9 weekend days'],
    ['date 1 year after 29 feb 2024', 'Fri, 28 Feb 2025'], ['today + 1 year', '23 Oct 2027'], ['days until end of year', '69 days'], ['working days between 1 dec 2026 and 31 dec 2026', '23 weekdays'],
    ['what date is 45 days before today', 'Tue, 8 Sep 2026'], ['15 aug 2026 is what day', 'Saturday, 15 Aug 2026'], ['diwali 2026', 'Sun, 8 Nov 2026'], ['1 jan 2000 + 10000 days', '19 May 2027'],
    ['2026-10-23 + 1 week', '30 Oct 2026'], ['end of next month', 'Mon, 30 Nov 2026'], ['aaj se 3 mahine baad kaunsi tarikh', 'Sat, 23 Jan 2027'], ['2 saal pehle ki date', 'Wed, 23 Oct 2024'],
    ['days from today to 1 jan 2027', '70 days'], ['how many days between 15 aug 2026 and 2 oct 2026', '48 days'], ['3 months after 30 nov 2026', 'Sun, 28 Feb 2027'], ['1 jan 2027 - 1 day', '31 Dec 2026'],
    ['age on 23 oct 2026 if born 23 oct 2000', '26 years'], ['is 1900 a leap year', '1900: not a leap year'], ['is 2000 a leap year', '2000: leap year'], ['next monday + 3 days', '29 Oct 2026'],
    ['this friday', '23 Oct 2026'], ['last day of this month', 'Sat, 31 Oct 2026'], ['first day of 2027', 'Fri, 1 Jan 2027'], ['days in 2023', '365 days'],
  ],
  times2: [
    ['11:45 pm + 30 minutes', '12:15 AM'], ['9:00 am - 15 minutes', '8:45 AM'], ['midnight to 6:30 am', '6 hours 30 minutes'], ['noon to 3:15 pm', '3 hours 15 minutes'], ['9am ist to cet', '4:30 AM CET'],
    ['9am ist to berlin', '5:30 AM CEST'], ['2pm pst to ist', '3:30 AM IST'], ['12am ist to utc', '6:30 PM UTC'], ['what time in sydney when it is 9am in mumbai', '2:30 PM AEDT'], ['6:30 pm + 2 hours 45 minutes', '9:15 PM'],
    ['45 min before 10am', '9:15 AM'], ['duration from 9:15 to 17:50', '8 hours 35 minutes'], ['abhi 10 baje hain, 3 ghante 45 minute baad kitne bajenge', '1:45 PM'], ['kal subah 9 baje se 2 ghante baad', '11 AM'],
    ['10:30 pm ist to 6:45 am gmt duration', '13 hours 45 minutes'], ['3pm to 3pm next day', '24 hours'], ['8:30 am to 12:00 pm', '3 hours 30 minutes'], ['now in london', '5:30 AM BST'], ['time in dubai', '8:30 AM GST'],
    ['6pm est to ist', '4:30 AM IST'], ['6pm new york to ist', '3:30 AM IST'], ['10am ist in new york on 15 jan 2027', '11:30 PM EST'], ['10am ist in new york on 15 jul 2027', '12:30 AM EDT'],
  ],
  currency2: [
    ['100 usd in inr and eur', '₹8,400 · €92'], ['1 lakh inr in usd in eur', '€1,095.24'], ['$100 * 1.18 in inr', '₹9,912'], ['(100 usd + 50 usd) in inr', '₹12,600'], ['100 usd in inr - 10%', '₹7,560'],
    ['10% of 100 usd in inr', '₹840'], ['100 usd to inr using historical rate for 13 october 2026', '₹8,000'], ['1 usd in inr on 1 jan 1990', 'ERR'], ['100 inr in inr', '₹100'], ['0 usd in inr', '₹0'],
    ['-50 usd in inr', '-₹4,200'], ['1,000,000 usd in inr', '₹8,40,00,000'], ['5 euro + 5 dollars in rupees', '₹876.52'], ['rupaye 1200 ka 15 pratishat', '₹180'], ['usd', 'ERR'], ['100 usd in', 'ERR'],
    ['in inr', 'ERR'], ['₹', 'ERR'], ['$5 + ₹5', 'ERR'], ['$5 + ₹5 in inr', '₹425'], ['2 crore rupees in usd', '$238,095.24'], ['500 usd per month in inr per year', '₹5,04,000'],
  ],
  context2: [
    [['a = 10', 'b = 20', 'c = a + b', 'c * 2'], '60'], [['x = 5', 'x = x + 1', 'x'], '6'], [['salary = 50000', 'tax = 10% of salary', 'salary - tax'], '45,000'], [['price: $20', 'qty: 5', 'price * qty in inr'], '₹8,400'],
    [['base: 1000', 'base + 18% gst'], '1,180'], [['100', '200', 'average'], '150'], [['total: 500', 'total * 2'], '1,000'], [['gst: 18%', '1000 + gst'], '1,180'], [['10', '20', 'prev + prev'], '40'],
    [['2026-01-01', 'prev + 30 days'], '31 Jan 2026'], [['start: 9am', 'start + 2 hours'], '11 AM'], [['rent 12000', 'food 6000', 'misc 2000', 'sum'], '20,000'], [['a: 1', '', 'b: 2', 'sum'], '2'],
    [['x: 10', 'y: x * 2', 'z: y * 2', 'x + y + z'], '70'], [['n = 3', 'n!'], '6'], [['r = 5', 'pi * r ^ 2'], '78.5398'], [['₹500', '20% of that', 'that + 100'], '₹200'],
    [['1000', 'clear context', '10% of that'], 'ERR'], [['rate = 18%', '5000 * rate'], '900'], [['km = 5', 'km * 2'], '10'],
  ],
  hinglish2: [
    ['ek lakh ka 15% nikalo aur usme 5000 jodo', '20,000'], ['2500 ka 5% nikaal ke usme 1200 jod do', '1,325'], ['1 crore ka 2 percent, phir uska 50%', '100,000'], ['sau ka dus percent', '10'],
    ['hazaar ka aadha', '500'], ['do sau pachas plus sau', '350'], ['mere paas 10 hazaar the, 2500 kharch kiye aur 1500 ka petrol, kitna bacha', '6,000'], ['mere paas 10 hazaar the, 2500 aur 1500 kharch kiye, kitna bacha', '6,000'],
    ['pichle mahine 45000 kamaye, is mahine 20% zyada, kitna', '54,000'], ['50000 ka 3 bhag', '16,666.67 each'], ['4 logon ka bill 2400, per head', '600 each'], ['teen hazaar ka 12% gst', '360'],
    ['5 lakh ka 8% byaj ek saal', '40,000'], ['1200 rupaye me 18% gst included, base kitna', '₹1,016.95'], ['25 ka 4 guna', '100'], ['100 ka 25 pratishat', '25'], ['200 me se 50 ghatao', '150'],
    ['80 ko 2 se guna karo', '160'], ['150 ko 3 se bhag do', '50'], ['kal subah 10 baje', '10 AM'], ['aaj ka din', 'Fri, 23 Oct 2026'], ['agle saal ki yahi tarikh', 'ERR'],
    ['1500 ka 20% discount ke baad gst 18%', '1,416'], ['mujhe 500 ka 15% batao', '75'], ['sabse pehle 1000 me 10% jodo phir 100 ghatao', '1,000'], ['kitna hoga 45 ka 30 percent', '13.5'],
  ],
  data3: [
    ['download time for a 4.7 GB movie at 25 Mbps', '25 min 4 s'], ['4.7 gb movie 25 mbps me kitne time me download hoga', '25 min 4 s'], ['upload 500 mb at 20 mbps', '3 min 20 s'],
    ['1 tb backup at 100 mbps in hours', '22.22 h'], ['1 tb / 4 gb', '250'], ['512 gb - 128 gb', '384 GB'], ['256 gb * 4', '1,024 GB'], ['1.5 tb + 500 gb in tb', '2 TB'], ['10% of 1 tb', '100 GB'],
    ['1 tb ka 20%', '200 GB'], ['how many mb in 1 gb', '1,000 MB'], ['1 pb in gb', '1,000,000 GB'], ['2 gbps in mb/s', '250 MB/s'], ['50 mbps * 30 minutes', '11.25 GB'], ['3 gb at 0 mbps', 'ERR'],
    ['1 gb in', 'ERR'], ['mbps', 'ERR'], ['5 mbps + 10 gb', 'ERR'], ['1 gb + 1 hour', 'ERR'], ['100 gb at 5 mbps in days', '1.85 days'], ['internet speed 2 gb in 2 minutes', '16.67 MB/s'],
  ],
  facts3: [
    ['distance to moon in km', '384,400 km'], ['moon distance / 2', '192,200 km'], ['speed of light in km/h', '1,079,252,848.8 km/h'], ['speed of sound in km/h', '1,234.8 km/h'],
    ['earth circumference / 24', '1,669.79 km'], ['height of everest in km', '8.85 km'], ['burj khalifa height * 2', '1,656 m'], ['nile length in miles', '4,132.12 mi'],
    ['distance from sun to earth / speed of light in minutes', '8.32 min'], ['suraj se dharti kitni door hai', '149,597,870.7 km'], ['chand ka vajan', '7.342e+22 kg'], ['everest ki unchai feet me', '29,031.69 ft'],
    ['ganga kitni lambi hai', '2,525 km'], ['india ka area', '3,287,263 km²'], ['how big is the atlantic ocean', '106,460,000 km²'], ['how far is jupiter from the sun', '778,479,000 km'],
    ['how hot is the sun', '5,500°C'], ['what is the freezing point of water', '100°C'], ['distance', 'ERR'], ['speed of lightning', 'ERR'], ['weight of 5 apples', 'ERR'], ['mars', 'ERR'],
    ['distance between delhi and jaipur', '235.3 km'], ['kolkata to chennai distance in miles', '844.07 mi'], ['how far is london from delhi', '6,711.3 km'], ['statue of unity', '182 m'],
    ['2 * speed of sound in km/h', '2,469.6 km/h'], ['earth to moon distance at 100 km/h', '160 days 4 h'],
  ],
  everyday3: [
    ['bmi for 70 kg and 1.75 m', '22.86'], ['bmi 70 kg 175 cm', '22.86'], ['mera weight 70 kg height 5 ft 9 in, bmi', '22.79'], ['bmi 85 kg 180 cm', '26.23'],
    ['mileage 600 km in 40 litres', '15 km/l'], ['40 litres me 600 km, mileage', '15 km/l'], ['fuel for 600 km at 15 km/l', '40 l'], ['15 km/l * 40 l', '600 km'], ['petrol needed for 1200 km at 18 kmpl', '66.67 l'],
    ['6 lakh per year in month', '50,000'], ['50000 per month yearly', '600,000'], ['salary 45000 monthly, annual', '540,000'], ['12 lakh per annum monthly', '100,000'],
    ['cgpa 8.2 to percentage', '77.9%'], ['9.4 cgpa in percent', '89.3%'], ['3 dozen', '36'], ['3 dozen * 6', '216'], ['half dozen', '6'],
    ['time to travel 450 km at 60 km/h', '7.5 h'], ['450 km at 60 km/h', '7.5 h'], ['distance in 2.5 hours at 80 km/h', '200 km'], ['speed for 300 km in 4 hours', '75 km/h'],
    ['time difference between india and london', '4 h 30 min'], ['time difference between ist and est', '10 h 30 min'], ['ist se pst kitna peeche hai', '13 h 30 min'],
    ['bill 2380, split among 3 people', '793.33 each'], ['tip 15% on 1240 split 4 ways', '356.5 each'], ['5 lakh in millions', '0.5 million'], ['2.5 crore in lakhs', '250 lakh'],
    ['1 million in lakhs', '10 lakh'], ['age in days if born 1 jan 2000', '9,792 days'], ['percentage of 45 out of 60', '75%'], ['9pm to 5am', '8 hours'],
    ['7 am ist to pst', '5:30 PM PST'], ['1200 per day monthly', '36,000'], ['interest on 1 lakh at 7% for 90 days simple', '1,726.03'], ['si 1 lakh 7% 90 days', '1,726.03'],
    ['what is 2 power 10 minus 24', '1,000'], ['average of 85, 90, 78 and 92', '86.25'], ['rounded to 1 dp 2 / 3', '0.7'], ['10 crore / 7', '14,285,714.2857'],
  ],
  money4: [
    ['15 lakh salary pe income tax kitna lagega', '97,500'], ['tax on 25 lakh income', '343,200'], ['mera package 12 lakh hai, in hand kitna milega', '87,800/month'], ['income tax 15 lakh old regime salaried', '257,400'],
    ['tax slab for 12.6 lakh', '62,400'], ['income tax on 7 lakh', '0'], ['sip 5000 monthly at 12% for 10 years', '1,161,695.38'], ['5000 ka sip 12% pe 10 saal', '1,161,695.38'],
    ['monthly sip needed for 50 lakh in 10 years at 12%', '21,520.27/month'], ['50 lakh target 10 years 12% sip kitna', '21,520.27/month'], ['fd of 1 lakh for 3 years at 7%', '123,143.93'],
    ['2 lakh fd 7.1% 3 saal maturity', '247,015'], ['rd 5000 monthly 2 years 6.5%', '128,425.3'], ['home loan 30 lakh 8.5% 20 years prepay 2 lakh after 24 months', '17 years 5 months'],
    ['at 8% money doubles in how many years', '9 years'], ['9% pe paisa kitne saal me double hoga', '8 years'], ['10 lakh after 10 years at 6% inflation', '1,790,847.7'], ['what 10 lakh buys after 10 years at 6% inflation', '558,394.78'],
    ['deposit for rent 25000 with 10 months', '250,000'], ['rent 25000 hike 5% for 3 years', '28,940.63'], ['bill 4800 rahul 2 items priya 1 item', '3,200 / 1,600'], ['sip 5000 for 10 years', 'ERR'], ['fd 2 lakh 3 years', 'ERR'],
    ['income tax', 'ERR'], ['lumpsum 2 lakh at 8% for 5 years', '293,865.62'],
  ],
  life4: [
    ['250 grams flour kitne cups', '2.08 cups'], ['1 cup sugar in grams', '200 g'], ['half cup butter in g', '113.5 g'], ['uk 8 in us shoe', 'US 9'], ['eu 43 shoe in uk', 'UK 10'], ['chest 42 inch shirt size', 'XL'],
    ['ideal weight 180 cm male', '75 kg'], ['delhi se mumbai 15 kmpl petrol 100', '7,654'], ['300 km at 20 km/l diesel 92', '1,380'], ['2 ton ac 6 hours daily 30 days at 7 per unit', '3,024'], ['100 watt bulb 10 hours 30 days units', '30 units'],
    ['days to holi 2027', '150 days'], ['diwali kab hai', 'Sun, 8 Nov 2026'], ['christmas', 'Fri, 25 Dec 2026'], ['independence day 2027', 'Sun, 15 Aug 2027'], ['next birthday if born 23 oct 2000', 'Fri, 23 Oct 2026'],
    ['week number', 'week 43'], ['10am to 7pm minus 1 hour, 26 days', '208 h'], ['time left until 11:30pm', '13 h 30 min'], ['3 kg at 300 vs 5 kg at 450', '5 kg at 450 is cheaper'],
    ['1 crore in words', 'one crore'], ['2500000 in words', 'twenty-five lakh'], ['999 in roman', 'CMXCIX'], ['roman MMXXIV', '2024'], ['4096 in hex', '0x1000'], ['255 in binary', '0b11111111'], ['0x10 * 2', '32'],
    ['5000 in roman', 'ERR'], ['-5 in binary', 'ERR'],
  ],
  health4: [
    ['bmr for 80 kg 180 cm 40 years male', '1,730 kcal/day'], ['tdee 1649 active', '2,845 kcal/day'], ['calories to lose 1 kg a week', '1,100 kcal/day deficit'], ['daily water for 60 kg', '2.1 l/day'],
    ['8000 steps in km', '6.1 km'], ['10 km in 55 minutes pace', '5:30 min/km'], ['pace 6:00 for 21.1 km', '2 h 7 min'], ['grade for 72%', 'B1'], ['grade 33%', 'D'],
    ['scores 78 82 91, what for 85 average', '89'], ['8 workers 12 days, 6 workers how many days', '16 days'], ['3 pens cost 45, 7 pens?', '105'], ['train 200 m at 36 km/h crosses platform 100 m', '30 s'],
    ['bmr 70 kg', 'ERR'],
  ],
  deeper4: [
    [['rate = 5%', 'amount = 2000', 'amount * rate'], '100'], [['d = 120 km', 't = 2 hours', 'd / t'], '60 km/h'], ['5x - 3 = 2x + 9', 'x = 4'], ['x/4 = 25', 'x = 100'], ['20% of x = 50', 'x = 250'], ['x + x = 10', 'x = 5'],
    ['x^2 = 9', 'ERR'], ['std of 2, 4, 4, 4, 5, 5, 7, 9', '2'], ['variance of 1, 2, 3, 4, 5', '2'], ['range of 7, 3, 9', '6'], ['50th percentile of 1, 2, 3, 4, 5', '3'],
    ['x = 10 to 1', '10, 9, 8, 7, 6, 5, 4, 3, 2, 1'], ['n = 0 to 20 step 5', '0, 5, 10, 15, 20'], ['si 10000 at 8% for 1 to 3 years', '1y: 800 · 2y: 1,600 · 3y: 2,400'],
  ],
};

const totals: Record<string, { pass: number; total: number }> = {};
describe('reliability benchmark', () => {
  for (const [cat, cases] of Object.entries(M)) {
    describe(cat, () => {
      for (const [input, expected] of cases) {
        const label = Array.isArray(input) ? input.join(' | ') : input;
        const group = expected === 'ERR' ? 'negative' : GROUP[cat];
        it(`${label} → ${expected}`, () => {
          const res = run(Array.isArray(input) ? input : [input]);
          const r = res[res.length - 1];
          const got = r.ok ? r.display : 'ERR';
          const ok = expected instanceof RegExp ? expected.test(got) : got === expected;
          totals[group] = totals[group] ?? { pass: 0, total: 0 };
          totals[group].total++;
          if (ok) totals[group].pass++;
          expect(got).toBe(expected instanceof RegExp ? got : expected);
        });
      }
    });
  }
  it('prints the per-group table', () => {
    const rows = Object.entries(totals).map(([g, t]) => `${g.padEnd(9)} ${t.pass}/${t.total} (${((100 * t.pass) / t.total).toFixed(2)}%)`);
    console.log(['benchmark results', ...rows].join('\n'));
    expect(Object.values(totals).reduce((s, t) => s + t.total, 0)).toBeGreaterThanOrEqual(300);
  });
});
