"""
Adversarial case generator + independent oracle for FATAAK.

Every expected value here is computed by Python (decimal / fractions / datetime), never by the engine.
Run:  python tests/gen/generate.py  -> writes tests/gen/cases.json
The vitest runner tests/generated.test.ts executes the cases against the real engine.

Conventions of the engine that the oracle encodes (documented in README / AUDIT-REPORT):
- numbers are shown with up to 4 decimals, money with 2, units with 2 (HALF_UP)
- `a % b` is percent-of, not modulo
- EMI: reducing balance, monthly compounding, instalment rounded to 2 dp, total = rounded EMI x months
- SIP: monthly compounding, instalment at the start of the month (annuity due)
- FD: quarterly compounding; RD: each instalment compounded quarterly for its remaining term
- income tax: FY 2025-26 new regime by default (slabs 4/8/12/16/20/24 lakh, 87A rebate to 12 lakh with marginal relief,
  standard deduction 75,000 for salary, 4% cess); old regime 2.5/5/10 lakh, rebate to 5 lakh, std deduction 50,000
- in-hand: basic 50% of CTC, PF 12% of basic on both sides, professional tax 2,400/yr, income tax new regime
- dates are day-first; "days between" is exclusive; NOW = Fri 23 Oct 2026 10:00 IST
"""
from __future__ import annotations

import json
import math
import random
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP, getcontext
from fractions import Fraction
from pathlib import Path

getcontext().prec = 40
rng = random.Random(20261024)
NOW = datetime(2026, 10, 23, 10, 0)
TODAY = NOW.date()

CASES: list[dict] = []


def add(cat: str, inp, expect: dict, *, note: str = ""):
    CASES.append({"id": f"{cat}-{len(CASES) + 1:04d}", "cat": cat, "input": inp, "expect": expect, "note": note})


def num(cat, inp, value, tol="0.00006", suffix=None, note=""):
    """numeric comparison: first number in the display (commas/currency stripped) within tol"""
    add(cat, inp, {"type": "num", "value": str(Decimal(str(value)).normalize()) if not isinstance(value, Decimal) else str(value.normalize()), "tol": str(tol), "suffix": suffix}, note=note)


def exact(cat, inp, display, note=""):
    add(cat, inp, {"type": "exact", "display": display}, note=note)


def err(cat, inp, note=""):
    add(cat, inp, {"type": "error"}, note=note)


def contains(cat, inp, parts: list[str], note=""):
    add(cat, inp, {"type": "contains", "parts": parts}, note=note)


D = Decimal


def q2(x) -> Decimal:
    x = D(str(x)) if not isinstance(x, Decimal) else x
    return x.quantize(D("0.01"), rounding=ROUND_HALF_UP)


def fmt_int(n: int) -> str:
    return f"{n:,}"


def fmt(x, dp=2) -> str:
    x = D(str(x)).quantize(D(1).scaleb(-dp), rounding=ROUND_HALF_UP)
    s = f"{x:,.{dp}f}"
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return s if s != "-0" else "0"


def anyof(cat, inp, displays: list[str], note=""):
    add(cat, inp, {"type": "any", "displays": displays}, note=note)


def anynum(cat, inp, values: list, tol="0.006", note=""):
    add(cat, inp, {"type": "anynum", "values": [str(D(str(v))) for v in values], "tol": str(tol)}, note=note)


# ----------------------------------------------------------------------------- A. arithmetic
def gen_expr(depth: int) -> tuple[str, Fraction]:
    """random expression tree with exact Fraction value; ^ only with small integer exponents"""
    if depth == 0 or rng.random() < 0.25:
        if rng.random() < 0.3:
            v = Fraction(rng.randint(1, 999), 1) / Fraction(rng.choice([1, 2, 4, 5, 8, 10]))
            s = str(v.numerator / v.denominator) if v.denominator != 1 else str(v.numerator)
            if "." in s:
                s = s.rstrip("0").rstrip(".")
            return s, v
        n = rng.randint(1, 500)
        return str(n), Fraction(n)
    op = rng.choice(["+", "-", "*", "/", "+", "-", "*", "^"])
    if op == "^":
        base_s, base_v = gen_expr(0)
        e = rng.randint(2, 3)
        return f"{base_s}^{e}", base_v ** e
    a_s, a_v = gen_expr(depth - 1)
    b_s, b_v = gen_expr(depth - 1)
    if op == "/" and b_v == 0:
        b_s, b_v = "7", Fraction(7)
    v = {"+": a_v + b_v, "-": a_v - b_v, "*": a_v * b_v, "/": a_v / b_v if b_v else None}[op]
    s = f"({a_s} {op} {b_s})"
    return s, v


def frac_to_dec(v: Fraction) -> Decimal:
    return D(v.numerator) / D(v.denominator)


for _ in range(220):
    s, v = gen_expr(rng.randint(1, 4))
    if abs(v) > Fraction(10 ** 15):
        continue
    num("A-expr", s, frac_to_dec(v).quantize(D("0.0001"), rounding=ROUND_HALF_UP), tol="0.00006")

# precedence and signs
prec_cases = [
    ("2 + 3 * 4", 14), ("(2 + 3) * 4", 20), ("2 ^ 3 ^ 2", 512), ("-2 ^ 2", -4), ("(-2) ^ 2", 4), ("10 - 2 - 3", 5),
    ("100 / 10 / 2", 5), ("2 * 3 ^ 2", 18), ("-(3 + 4) * 2", -14), ("5 - -3", 8), ("5 + -3", 2), ("-5 * -5", 25),
    ("3 * (2 + (4 - 1) * 5)", 51), ("((((1 + 2))))", 3), ("0.1 + 0.2", D("0.3")), ("1 / 3 * 3", 1), ("2 ^ 10", 1024),
    ("2 ^ 0.5", D("1.4142")), ("sqrt(144)", 12), ("sqrt(2)", D("1.4142")), ("cbrt(27)", 3), ("10 mod 3", 1), ("17 mod 5", 2),
    ("1e3 + 1", 1001), ("2.5e-3 * 4", D("0.01")), ("1.5e6 / 3", 500000), ("123456789 * 1000", 123456789000),
    ("0.000123 * 1000", D("0.123")), ("1 / 8", D("0.125")), ("22 / 7", D("3.1429")), ("2 / 3", D("0.6667")),
    ("1.005 * 1000", 1005), ("999999999 + 1", 1000000000), ("12345.6789 * 0", 0), ("7 * 8 - 6 / 3 + 2 ^ 2", 58),
    ("50% of 200", 100), ("200 * 15%", 30), ("15% of 200", 30), ("200 + 15%", 230), ("200 - 15%", 170), ("10 % 3", D("0.3")),
    ("abs(-7.5)", D("7.5")), ("round(2.5)", 3), ("floor(2.7)", 2), ("ceil(2.1)", 3), ("5!", 120), ("0!", 1),
    ("log(1000)", 3), ("ln(1)", 0), ("log2(1024)", 10), ("4 ^ -1", D("0.25")), ("(1 + 2) ^ (3 - 1)", 9),
    ("3 lakh + 2 lakh", 500000), ("1 crore / 4", 2500000), ("2.5 lakh * 2", 500000), ("1 lakh crore", D("1e12")),
    ("1 million + 1", 1000001), ("2 billion / 1000", 2000000), ("3 thousand * 3", 9000), ("5 hundred + 5", 505),
    ("twelve * 12", 144), ("twenty five + 5", 30), ("ninety nine + 1", 100), ("two hundred fifty / 5", 50),
]
for s, v in prec_cases:
    num("A-prec", s, v)

for s in ["1 / 0", "5 / (3 - 3)", "2 +", "* 5", "(1 + 2", "1 + 2)", "abc + 1", "1 . 5 + 2", "+", "sqrt(-1)",
          "10 /", "(2 + 3))", "4 $ 5", "7 & 8", "log(0)", "0 ^ -1", "1 / (2 - 2) + 3"]:
    err("A-malformed", s)

# rounding boundaries (4 dp HALF_UP)
for s, v in [("1 / 3", D("0.3333")), ("2 / 3", D("0.6667")), ("0.00005 * 1", D("0.0001")), ("0.00004 * 1", D("0")),
             ("1.23456 * 1", D("1.2346")), ("9.99995 * 1", D("10")), ("1 / 7", D("0.1429")), ("1 / 6", D("0.1667"))]:
    num("A-round", s, v, tol="0.00001")

# ----------------------------------------------------------------------------- B. finance
def gst_add(base, rate):
    tax = q2(D(base) * D(rate) / 100)
    return q2(D(base) + tax), tax


def gst_remove(total, rate):
    base = q2(D(total) / (1 + D(rate) / 100))
    return base, q2(D(total) - base)


for _ in range(60):
    base = rng.choice([rng.randint(100, 99999), D(rng.randint(100, 99999)) / 100 + rng.randint(10, 5000)])
    rate = rng.choice([5, 12, 18, 28, 3, D("0.25")])
    total, tax = gst_add(base, rate)
    bs = str(base)
    form = rng.choice([f"{bs} + {rate}% gst", f"{bs} plus {rate}% gst", f"gst {rate}% on {bs}", f"{bs} with {rate}% gst", f"add {rate}% gst to {bs}", f"{bs} me {rate}% gst add karo"])
    num("B-gst", form, total, tol="0.006")
    b2, t2 = gst_remove(base, rate)
    form2 = rng.choice([f"{bs} inclusive of {rate}% gst", f"{bs} including {rate}% gst", f"remove {rate}% gst from {bs}", f"{bs} me {rate}% gst included hai, base?"])
    num("B-gst", form2, b2, tol="0.006")

# discounts, successive, chains
for _ in range(40):
    p = rng.randint(100, 50000)
    d1 = rng.choice([5, 10, 15, 20, 25, 30, 40, 50])
    final = q2(D(p) * (100 - d1) / 100)
    num("B-discount", rng.choice([f"{p} - {d1}%", f"{d1}% off {p}", f"{p} minus {d1}% discount", f"{p} pe {d1}% discount"]), final, tol="0.006")
    d2 = rng.choice([5, 10, 20])
    f2 = q2(q2(D(p) * (100 - d1) / 100) * (100 - d2) / 100)
    num("B-discount", f"{p} - {d1}% - {d2}%", f2, tol="0.02")
    g = 18
    f3, _t = gst_add(final, g)
    num("B-chain", f"{p} - {d1}% + {g}% gst", f3, tol="0.02")
    num("B-chain", f"{p} minus {d1}% discount then add {g}% gst", f3, tol="0.02")

# percent forms
for _ in range(40):
    a = rng.randint(1, 999)
    b = rng.randint(1, 999)
    num("B-percent", f"{a} is what % of {b}", (D(a) / D(b) * 100).quantize(D("0.01"), rounding=ROUND_HALF_UP), tol="0.006", suffix="%")
    num("B-percent", f"{a} as a % of {b}", (D(a) / D(b) * 100).quantize(D("0.01"), rounding=ROUND_HALF_UP), tol="0.006", suffix="%")
    chg = ((D(b) - D(a)) / D(a) * 100).quantize(D("0.01"), rounding=ROUND_HALF_UP)
    if chg < 0:
        contains("B-percent", f"% change from {a} to {b}", [f"{fmt(-chg)}%", "decrease"])
    else:
        num("B-percent", f"% change from {a} to {b}", chg, tol="0.006", suffix="%")
    pct = rng.choice([5, 12, 18, 25, 33, 50])
    num("B-percent", f"what original amount becomes {a * 10} after a {pct}% increase", q2(D(a * 10) / (1 + D(pct) / 100)), tol="0.006")
    num("B-percent", f"{pct}% of what is {a}", q2(D(a) * 100 / pct), tol="0.006")


def emi_calc(P, annual, months):
    P, r = D(P), D(annual) / 1200
    if r == 0:
        e = P / months
    else:
        f = (1 + r) ** months
        e = P * r * f / (f - 1)
    e = q2(e)
    total = q2(e * months) if r else q2(P)
    return e, total, q2(total - P)


for _ in range(60):
    P = rng.choice([rng.randint(1, 80) * 100000, rng.randint(50, 999) * 1000])
    rate = rng.choice([D("6.5"), 7, D("7.25"), D("8.5"), 9, D("9.75"), 10, 11, 12, D("13.5"), 0])
    yrs = rng.choice([1, 2, 3, 5, 7, 10, 15, 20, 25, 30])
    e, total, interest = emi_calc(P, rate, yrs * 12)
    pl = f"{P // 100000} lakh" if P % 100000 == 0 and rng.random() < 0.6 else str(P)
    num("B-emi", rng.choice([f"emi {pl} at {rate}% for {yrs} years", f"emi on {pl} {rate}% {yrs} years", f"{pl} loan at {rate}% for {yrs} years emi", f"{pl} ka emi {rate}% {yrs} saal"]), e, tol="0.006", suffix="/month")
    num("B-emi", f"total interest on {pl} at {rate}% for {yrs} years emi", interest, tol="0.02")
    m = rng.choice([6, 18, 30])
    e2, _, _ = emi_calc(P, rate, m)
    num("B-emi", f"emi {pl} at {rate}% for {m} months", e2, tol="0.006", suffix="/month")


def si(P, r, t):
    return q2(D(P) * D(r) * D(t) / 100)


def ci(P, r, t, n):
    return q2(D(P) * (1 + D(r) / 100 / n) ** (D(t) * n))


for _ in range(50):
    P = rng.randint(1, 50) * 10000
    r = rng.choice([D("4.5"), 5, 6, D("7.1"), 8, 10, 12])
    t = rng.choice([1, 2, 3, 5, 10, D("1.5")])
    num("B-interest", f"simple interest on {P} at {r}% for {t} years", si(P, r, t), tol="0.006")
    num("B-interest", f"{P} pe {r}% simple interest {t} saal", si(P, r, t), tol="0.006")
    num("B-interest", f"compound interest on {P} at {r}% for {t} years", ci(P, r, t, 1) - P, tol="0.02")
    # "P at r% compounded …" answers the interest and names the maturity total in the note; both must be right
    for name, n in [("yearly", 1), ("monthly", 12), ("quarterly", 4), ("half-yearly", 2)]:
        total = ci(P, r, t, n)
        contains("B-interest", f"{P} at {r}% compounded {name} for {t} years", [fmt(total - P), f"total {fmt(total)}"], note="interest shown, total in the note")


def sip_fv(m, annual, months):
    r = D(annual) / 1200
    if r == 0:
        return q2(D(m) * months)
    g = (1 + r) ** months
    return q2(D(m) * (g - 1) / r * (1 + r))


for _ in range(40):
    m = rng.choice([500, 1000, 2500, 5000, 7500, 10000, 15000, 25000])
    r = rng.choice([8, 10, 12, 13, 15, D("12.5")])
    y = rng.choice([1, 3, 5, 7, 10, 15, 20, 25])
    num("B-sip", rng.choice([f"sip {m} at {r}% for {y} years", f"{m} monthly sip {r}% {y} years", f"sip of {m} per month at {r}% for {y} years"]), sip_fv(m, r, y * 12), tol="0.02")
    target = rng.choice([10, 25, 50, 100]) * 100000
    unit = sip_fv(1, r, y * 12) if r else D(y * 12)
    # goal: monthly = target / fv-of-1 (unrounded)
    rr = D(r) / 1200
    g = (1 + rr) ** (y * 12)
    unit_exact = (g - 1) / rr * (1 + rr)
    num("B-sip", f"how much monthly sip for {target // 100000} lakh in {y} years at {r}%", q2(D(target) / unit_exact), tol="0.02", suffix="/month")
    P = rng.choice([50000, 100000, 250000, 1000000])
    num("B-lumpsum", f"lumpsum {P} at {r}% for {y} years", q2(D(P) * (1 + D(r) / 100) ** y), tol="0.02")


def fd(P, r, years):
    q = D(r) / 400
    return q2(D(P) * (1 + q) ** (D(years) * 4))


def rd(m, r, years):
    q = D(r) / 400
    months = int(round(D(years) * 12))
    tot = D(0)
    for k in range(1, months + 1):
        tot += D(m) * (1 + q) ** (D(4 * (months - k + 1)) / 12)
    return q2(tot)


for _ in range(30):
    P = rng.choice([50000, 100000, 200000, 500000, 1000000])
    r = rng.choice([D("6.5"), D("6.75"), 7, D("7.1"), D("7.5"), 8])
    y = rng.choice([1, 2, 3, 5, D("1.5"), D("2.5")])
    num("B-fd", f"fd {P} at {r}% for {y} years", fd(P, r, y), tol="0.02")
    m = rng.choice([1000, 2000, 5000, 10000])
    num("B-rd", f"rd {m} for {y} years at {r}%", rd(m, r, y), tol="0.02")


# income tax FY 2025-26 (new regime) and old regime; independent implementation
NEW = [(400000, 0), (800000, 5), (1200000, 10), (1600000, 15), (2000000, 20), (2400000, 25), (10 ** 15, 30)]
NEW_BY_FY = {
    2023: ([(300000, 0), (600000, 5), (900000, 10), (1200000, 15), (1500000, 20), (10 ** 15, 30)], 700000, 50000),
    2024: ([(300000, 0), (700000, 5), (1000000, 10), (1200000, 15), (1500000, 20), (10 ** 15, 30)], 700000, 75000),
    2025: (NEW, 1200000, 75000),
}
OLD = [(250000, 0), (500000, 5), (1000000, 20), (10 ** 15, 30)]


def slab(taxable, slabs):
    tax, lower = D(0), D(0)
    for upper, rate in slabs:
        if taxable <= lower:
            break
        part = min(taxable, D(upper)) - lower
        tax += part * rate / 100
        lower = D(upper)
    return tax


def surcharge_rate(income, old):
    if income > 50000000:
        return D(37) if old else D(25)
    if income > 20000000:
        return D(25)
    if income > 10000000:
        return D(15)
    if income > 5000000:
        return D(10)
    return D(0)


def itax(income, old=False, salaried=False, fy=2025):
    """Rebate 87A (new: taxable <= limit with marginal relief; old: <= 5L), surcharge with marginal relief, 4% cess."""
    income = D(income)
    slabs, rebate, std = NEW_BY_FY[fy]
    ded = D(50000 if old else std) if salaried else D(0)
    taxable = max(D(0), income - ded)
    t = slab(taxable, OLD if old else slabs)
    if old:
        if taxable <= 500000:
            t = D(0)
    else:
        if taxable <= rebate:
            t = D(0)
        else:
            t = min(t, taxable - rebate)
    # surcharge on taxable income (total income) with marginal relief
    sr = surcharge_rate(taxable, old)
    sur = t * sr / 100
    if sr > 0:
        thresholds = [5000000, 10000000, 20000000, 50000000]
        th = max(x for x in thresholds if taxable > x)
        t_th = slab(D(th), OLD if old else slabs)
        sr_th = surcharge_rate(D(th), old)
        total_at_th = t_th + t_th * sr_th / 100
        excess = taxable - th
        if (t + sur) - total_at_th > excess:
            sur = total_at_th + excess - t
    cess = (t + sur) * 4 / 100
    return q2(t + sur + cess)


tax_incomes = [300000, 400000, 700000, 1000000, 1200000, 1200001, 1210000, 1250000, 1275000, 1275001, 1300000, 1500000, 1600000, 2000000, 2400000, 2500000,
               3000000, 4500000, 5000000, 5000001, 5100000, 5500000, 7500000, 10000000, 10100000, 15000000, 25000000, 60000000]
for inc in tax_incomes:
    lk = inc / 100000
    lk_s = f"{lk:g} lakh" if inc % 1000 == 0 and lk < 100 else str(inc)
    num("B-tax", f"income tax on {inc}", itax(inc), tol="0.02")
    num("B-tax", f"income tax on {lk_s} salary", itax(inc, salaried=True), tol="0.02")
    num("B-tax", f"income tax on {inc} old regime", itax(inc, old=True), tol="0.02")
    num("B-tax", f"income tax on {lk_s} salary old regime", itax(inc, old=True, salaried=True), tol="0.02")
for inc in [800000, 1200000, 1500000, 2500000]:
    num("B-tax", f"{inc // 100000} lakh salary pe income tax kitna", itax(inc, salaried=True), tol="0.02")
    num("B-tax", f"tax on salary of {inc} new regime", itax(inc, salaried=True), tol="0.02")
# other financial years: known years give that year's figure, unknown years must error (never FY 2025-26 figures silently)
for inc in [700000, 750000, 1000000, 1275000, 1500000, 2500000, 6000000]:
    num("B-tax-fy", f"income tax on {inc} salary fy 2024-25", itax(inc, salaried=True, fy=2024), tol="0.02")
    num("B-tax-fy", f"income tax on {inc} fy 2023-24", itax(inc, fy=2023), tol="0.02")
    num("B-tax-fy", f"income tax on {inc} salary ay 2025-26", itax(inc, salaried=True, fy=2024), tol="0.02", note="AY 2025-26 = FY 2024-25")
    num("B-tax-fy", f"income tax on {inc} salary financial year 2025-26", itax(inc, salaried=True, fy=2025), tol="0.02")
for s in ["income tax on 15 lakh salary fy 2026-27", "income tax on 15 lakh fy 2022-23", "income tax on 10 lakh ay 2024-25 old regime fy 2019-20"]:
    err("B-tax-fy", s, note="slabs for that year are not loaded: say so")


def inhand(ctc, old=False):
    ctc = D(ctc)
    basic = ctc / 2
    pf = basic * D("0.12")
    gross = ctc - pf
    tax = itax(gross, old=old, salaried=True)
    yearly = gross - pf - 2400 - tax
    return q2(yearly / 12)


for ctc in [300000, 500000, 600000, 800000, 1000000, 1200000, 1275000, 1400000, 1500000, 1800000, 2000000, 2500000, 3000000, 4000000, 5000000]:
    num("B-inhand", rng.choice([f"ctc {ctc // 100000} lakh in hand", f"{ctc} ctc take home", f"in hand salary for ctc {ctc}", f"ctc {ctc} monthly in hand"]), inhand(ctc), tol="0.02", suffix="/month")


def prepay(P, annual, years, prepay_amt, after_months):
    P, r = D(P), D(annual) / 1200
    n = years * 12
    g = (1 + r) ** n
    e = q2(P * r * g / (g - 1))
    bal, months, interest = P, 0, D(0)
    while bal > 0 and months < 1200:
        months += 1
        i = bal * r
        interest += i
        bal = bal + i - e
        if months == after_months:
            bal -= D(prepay_amt)
        if bal < 0:
            bal = D(0)
    return months, q2(interest), q2(e * n - P)


for _ in range(20):
    P = rng.choice([20, 30, 40, 50, 75]) * 100000
    r = rng.choice([D("8.5"), 9, D("8.25"), 10])
    y = rng.choice([10, 15, 20, 25])
    pre = rng.choice([1, 2, 3, 5]) * 100000
    am = rng.choice([1, 2, 3, 5])
    months, interest, base = prepay(P, r, y, pre, am * 12)
    yy, mm = divmod(months, 12)
    exact("B-prepay", f"emi {P // 100000} lakh {r}% {y} years, prepay {pre // 100000} lakh after {am} years", f"{yy} years {mm} months" if mm else f"{yy} years")
    contains("B-prepay", f"emi {P // 100000} lakh {r}% {y} years, prepay {pre // 100000} lakh after {am} years", [f"saving"], note="note must report interest saved")

# bill splitting, tips, per-unit
for _ in range(30):
    total = rng.randint(200, 20000)
    n = rng.choice([2, 3, 4, 5, 6, 7])
    num("B-split", rng.choice([f"split {total} between {n} people", f"{total} divided among {n} people", f"{total} ko {n} logo me baanto", f"{total} / {n} people"]), (D(total) / n).quantize(D("0.0001"), rounding=ROUND_HALF_UP), tol="0.01")
    tip = rng.choice([5, 10, 15])
    with_tip = q2(D(total) * (100 + tip) / 100)
    num("B-split", f"{total} + {tip}% tip split {n} ways", (with_tip / n).quantize(D("0.0001"), rounding=ROUND_HALF_UP), tol="0.02")
    a, b = rng.randint(1, 5), rng.randint(1, 5)
    sa = q2(D(total) * a / (a + b))
    contains("B-split", f"bill {total}, rahul {a} items, priya {b} items", [f"{sa:,.2f}".rstrip("0").rstrip(".") if sa != sa.to_integral_value() else f"{int(sa):,}"], note="unequal split by item count")
    k1, p1, k2, p2 = rng.choice([1, 2, 5]), rng.randint(50, 900), rng.choice([1, 2, 3]), rng.randint(50, 900)
    cheaper = f"{k1} kg at {p1}" if D(p1) / k1 <= D(p2) / k2 else f"{k2} kg at {p2}"
    exact("B-compare", f"{k1} kg at {p1} vs {k2} kg at {p2}, which is cheaper", f"{cheaper} is cheaper")

# rent
for _ in range(10):
    rent = rng.randint(8, 60) * 1000
    m = rng.choice([2, 3, 6, 10, 11])
    num("B-rent", f"rent {rent} with {m} months deposit", rent * m, tol="0.01")
    pct = rng.choice([5, 8, 10])
    y = rng.choice([2, 3, 5])
    num("B-rent", f"rent {rent} increase {pct}% for {y} years", q2(D(rent) * (1 + D(pct) / 100) ** y), tol="0.02")

# profit/loss, margin, markup
for _ in range(25):
    cost, sell = rng.randint(100, 5000), rng.randint(100, 5000)
    pl = D(sell - cost)
    pct = (pl / cost * 100).quantize(D("0.01"), rounding=ROUND_HALF_UP)
    if pl < 0:
        contains("B-profit", f"bought at {cost} sold at {sell} profit %", [f"{fmt(-pct)}%", "loss"], note="a loss must be named")
        contains("B-profit", f"cost {cost} selling price {sell} profit", [fmt(-pl), "loss"])
    else:
        num("B-profit", f"bought at {cost} sold at {sell} profit %", pct, tol="0.006", suffix="%")
        num("B-profit", f"cost {cost} selling price {sell} profit", pl, tol="0.01")
    mk = rng.choice([10, 20, 25, 40, 50])
    num("B-profit", f"{cost} with {mk}% markup", q2(D(cost) * (100 + mk) / 100), tol="0.006")
    num("B-profit", f"{cost} with {mk}% margin", q2(D(cost) / (1 - D(mk) / 100)), tol="0.006")

# ----------------------------------------------------------------------------- C. dates and times
WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def fdate(d: date) -> str:
    return f"{WD[d.weekday()]}, {d.day} {d.strftime('%b')} {d.year}"


def add_months(d: date, n: int) -> date:
    y, m = divmod(d.month - 1 + n, 12)
    y += d.year
    m += 1
    import calendar
    last = calendar.monthrange(y, m)[1]
    return date(y, m, min(d.day, last))


MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
edge_dates = [date(2024, 2, 29), date(2023, 2, 28), date(2026, 12, 31), date(2026, 1, 1), date(2027, 1, 31), date(2000, 2, 29), date(2100, 2, 28), date(2026, 3, 31), date(2026, 8, 31), date(2025, 12, 25)]
for _ in range(50):
    d0 = rng.choice(edge_dates) if rng.random() < 0.4 else date(rng.randint(1990, 2040), rng.randint(1, 12), rng.randint(1, 28))
    n = rng.choice([1, 7, 30, 45, 90, 100, 365, 366, 1000])
    ds = f"{d0.day} {MON[d0.month - 1]} {d0.year}"
    exact("C-date", f"{ds} + {n} days", fdate(d0 + timedelta(days=n)))
    exact("C-date", f"{ds} - {n} days", fdate(d0 - timedelta(days=n)))
    mo = rng.choice([1, 2, 6, 12, 13, 24])
    exact("C-date", f"{ds} + {mo} months", fdate(add_months(d0, mo)), note="end-of-month clamps to the last day")
    exact("C-date", f"{ds} + 1 year", fdate(add_months(d0, 12)))
    exact("C-date", f"what day is {ds}", {"Mon": "Monday", "Tue": "Tuesday", "Wed": "Wednesday", "Thu": "Thursday", "Fri": "Friday", "Sat": "Saturday", "Sun": "Sunday"}[WD[d0.weekday()]] + f", {d0.day} {d0.strftime('%b')} {d0.year}")
    d1 = d0 + timedelta(days=rng.randint(1, 800))
    d1s = f"{d1.day} {MON[d1.month - 1]} {d1.year}"
    num("C-date", f"days between {ds} and {d1s}", (d1 - d0).days, tol="0", suffix="days")
    num("C-date", f"{d1s} - {ds}", (d1 - d0).days, tol="0", suffix="days")
    num("C-date", f"weekdays between {ds} and {d1s}", sum(1 for k in range((d1 - d0).days + 1) if (d0 + timedelta(days=k)).weekday() < 5), tol="0", note="Mon-Fri, both ends inclusive (the note says so)")

# numeric day-first dates
for _ in range(15):
    d0 = date(rng.randint(2000, 2030), rng.randint(1, 12), rng.randint(13, 28))
    n = rng.randint(1, 400)
    exact("C-date", f"{d0.day:02d}/{d0.month:02d}/{d0.year} + {n} days", fdate(d0 + timedelta(days=n)), note="day-first")
    exact("C-date", f"{d0.day}-{d0.month}-{d0.year} + {n} days", fdate(d0 + timedelta(days=n)))

# relative to NOW
for n in [1, 10, 45, 69, 70, 100, 365]:
    exact("C-now", f"today + {n} days", fdate(TODAY + timedelta(days=n)))
    exact("C-now", f"aaj se {n} din baad", fdate(TODAY + timedelta(days=n)))
    exact("C-now", f"{n} days ago", fdate(TODAY - timedelta(days=n)))
exact("C-now", "tomorrow", fdate(TODAY + timedelta(days=1)))
exact("C-now", "yesterday", fdate(TODAY - timedelta(days=1)))
exact("C-now", "today", fdate(TODAY))
exact("C-now", "next monday", fdate(TODAY + timedelta(days=(7 - TODAY.weekday()) % 7 or 7)))
exact("C-now", "last day of this month", fdate(date(2026, 10, 31)))
exact("C-now", "first day of next month", fdate(date(2026, 11, 1)))
exact("C-now", "last day of feb 2028", fdate(date(2028, 2, 29)))
exact("C-now", "last day of feb 2100", fdate(date(2100, 2, 28)))
num("C-now", "days until 1 jan 2027", (date(2027, 1, 1) - TODAY).days, tol="0", suffix="days")
num("C-now", "days till 31 dec 2026", (date(2026, 12, 31) - TODAY).days, tol="0", suffix="days")
num("C-now", "days since 15 aug 1947", (TODAY - date(1947, 8, 15)).days, tol="0", suffix="days")
num("C-now", "days to diwali 2026", (date(2026, 11, 8) - TODAY).days, tol="0", suffix="days", note="Diwali 8 Nov 2026 per Indian national calendar; verify")
for y, leap in [(2024, True), (2026, False), (2000, True), (1900, False), (2100, False), (2028, True), (2400, True)]:
    exact("C-leap", f"is {y} a leap year", f"{y}: leap year" if leap else f"{y}: not a leap year")
num("C-age", "age if born 15 aug 1990", 36, tol="0", suffix="years")
num("C-age", "age on 1 jan 2027 if born 29 feb 2000", 26, tol="0", suffix="years", note="29 Feb birthday")
num("C-age", "age if born 24 oct 2000", 25, tol="0", suffix="years", note="birthday tomorrow: still 25")
num("C-age", "age if born 23 oct 2000", 26, tol="0", suffix="years", note="birthday today")

# time spans incl. midnight
for _ in range(30):
    h1, m1 = rng.randint(0, 23), rng.choice([0, 15, 30, 45])
    h2, m2 = rng.randint(0, 23), rng.choice([0, 15, 30, 45])
    t1 = datetime(2026, 1, 1, h1, m1)
    t2 = datetime(2026, 1, 1, h2, m2)
    if t2 <= t1:
        t2 += timedelta(days=1)
    mins = int((t2 - t1).total_seconds() // 60)
    hh, mm = divmod(mins, 60)
    disp = f"{hh} h {mm} min" if mm else f"{hh} h"
    exact("C-time", f"{h1:02d}:{m1:02d} to {h2:02d}:{m2:02d}", disp, note="crosses midnight when end <= start")
    br = rng.choice([30, 45, 60])
    if mins > br:
        hh2, mm2 = divmod(mins - br, 60)
        exact("C-time", f"{h1:02d}:{m1:02d} to {h2:02d}:{m2:02d} minus {br} min break", f"{hh2} h {mm2} min" if mm2 else f"{hh2} h")
exact("C-time", "10pm to 6am", "8 h")
exact("C-time", "11:30 pm to 7:15 am", "7 h 45 min")
exact("C-time", "9am to 5pm", "8 h")
exact("C-time", "9 am to 5:30 pm minus 1 hour lunch", "7 h 30 min")
exact("C-time", "22:00 to 06:00", "8 h")
num("C-time", "9:30 to 18:45 minus 45 min, 22 days", 187, tol="0", suffix="h")
num("C-time", "8 h 30 min * 5", 2550, tol="0.01", suffix="min", note="compound literal keeps the smaller unit (Numi convention)")
num("C-time", "2 h 45 min + 1 h 30 min", 255, tol="0.01", suffix="min", note="two durations print in minutes")
exact("C-time", "3pm + 90 minutes", "4:30 PM")
exact("C-time", "11:45 pm + 30 minutes", "12:15 AM")
exact("C-time", "6pm ist to est", "7:30 AM EST")
exact("C-time", "9am est to ist", "7:30 PM IST")
exact("C-time", "12pm utc in ist", "5:30 PM IST")
exact("C-time", "3pm in london to tokyo on 1 jul 2026", "11 PM JST", note="BST +1, JST +9")
exact("C-time", "3pm in london to tokyo on 1 dec 2026", "12 AM JST", note="GMT, JST +9")
exact("C-time", "9am new york to london on 15 mar 2026", "1 PM GMT", note="US DST started 8 Mar, UK not until 29 Mar: 4 h gap")
exact("C-time", "9am new york to london on 15 apr 2026", "2 PM BST")
for _ in range(10):
    d0 = date(rng.randint(2020, 2030), rng.randint(1, 12), rng.randint(1, 28))
    exact("C-week", f"week number of {d0.day} {MON[d0.month - 1]} {d0.year}", f"week {d0.isocalendar()[1]}", note="ISO week")
exact("C-week", "week number of 1 jan 2027", "week 53", note="ISO: 1 Jan 2027 is a Friday, belongs to week 53 of 2026")
exact("C-week", "week number of 31 dec 2024", "week 1", note="ISO: belongs to week 1 of 2025")
for s in ["31 feb 2026 + 1 day", "30/02/2026 + 1 day", "29 feb 2026", "13/13/2026 + 1 day", "0 jan 2026", "32 jan 2026 + 1 day"]:
    err("C-invalid", s)

# ----------------------------------------------------------------------------- D. units
UNITS = {
    "length": {"mm": D("0.001"), "cm": D("0.01"), "m": D(1), "km": D(1000), "inch": D("0.0254"), "ft": D("0.3048"), "yard": D("0.9144"), "mile": D("1609.344"), "nautical mile": D(1852)},
    "mass": {"mg": D("0.000001"), "g": D("0.001"), "kg": D(1), "tonne": D(1000), "lb": D("0.45359237"), "oz": D("0.028349523125")},
    "volume": {"ml": D("0.001"), "l": D(1), "tsp": D("0.00492892159375"), "tbsp": D("0.01478676478125"), "cup": D("0.2365882365"), "gallon": D("3.785411784"), "pint": D("0.473176473"), "fl oz": D("0.0295735295625"), "m3": D(1000), "cubic feet": D("28.316846592")},
    "area": {"sqft": D("0.09290304"), "sqm": D(1), "acre": D("4046.8564224"), "hectare": D(10000), "sq km": D(1000000), "sq yd": D("0.83612736")},
    "data": {"bit": D("0.125"), "byte": D(1), "kb": D(1000), "mb": D(10 ** 6), "gb": D(10 ** 9), "tb": D(10 ** 12), "pb": D(10 ** 15), "kib": D(1024), "mib": D(1024 ** 2), "gib": D(1024 ** 3), "tib": D(1024 ** 4)},
    "speed": {"m/s": D(1), "km/h": D(1000) / 3600, "mph": D("0.44704"), "knots": D("0.514444444444444444")},
    "time": {"s": D(1), "min": D(60), "h": D(3600), "days": D(86400), "weeks": D(604800)},
}
SYM = {"inch": "in", "yard": "yd", "mile": "mi", "nautical mile": "nmi", "tonne": "t", "gallon": "gal", "pint": "pt", "m3": "m³", "cubic feet": "ft³", "sqft": "sq ft", "sqm": "m²", "hectare": "ha", "sq km": "km²", "sq yd": "sq yd",
       "byte": "B", "kb": "KB", "mb": "MB", "gb": "GB", "tb": "TB", "pb": "PB", "kib": "KiB", "mib": "MiB", "gib": "GiB", "tib": "TiB", "knots": "kn", "fl oz": "fl oz", "bit": "bit"}
for dim, table in UNITS.items():
    names = list(table)
    for _ in range(28 if dim != "time" else 10):
        a, b = rng.sample(names, 2)
        v = rng.choice([rng.randint(1, 999), D(rng.randint(1, 99999)) / 100, rng.choice([D("0.5"), D("2.5"), D("1000000"), D("0.001")])])
        res = (D(v) * table[a] / table[b])
        shown = res.quantize(D("0.01"), rounding=ROUND_HALF_UP)
        if dim == "data" and shown == 0 and res != 0:
            continue  # engine scales tiny data values down a unit; skip
        if abs(res) >= D("1e21") or (res != 0 and abs(res) < D("0.005")):
            continue
        tol = D("0.006") if shown != 0 else D("0.006")
        inp = rng.choice([f"{v} {a} in {b}", f"{v} {a} to {b}", f"convert {v} {a} to {b}", f"{v} {a} = ? {b}"])
        if inp.endswith("= ? " + b):
            inp = f"{v} {a} in {b}"
        num("D-convert", inp, shown, tol=tol, suffix=SYM.get(b, b) if rng.random() < 0.5 else None)

# temperature
for c in [-40, -273.15, 0, 36.6, 37, 100, 180, 200, 350, 451, 1000]:
    f = D(str(c)) * 9 / 5 + 32
    num("D-temp", f"{c} c in f", f.quantize(D("0.01"), rounding=ROUND_HALF_UP), tol="0.006", suffix="°F")
    num("D-temp", f"{c} celsius to kelvin", (D(str(c)) + D("273.15")).quantize(D("0.01"), rounding=ROUND_HALF_UP), tol="0.006", suffix="K")
for f in [-40, 0, 32, 98.6, 212, 350, 451]:
    c = (D(str(f)) - 32) * 5 / 9
    num("D-temp", f"{f} f in c", c.quantize(D("0.01"), rounding=ROUND_HALF_UP), tol="0.006", suffix="°C")
# gb vs gib
num("D-data", "1 gb in mb", 1000, tol="0", suffix="MB")
num("D-data", "1 gib in mib", 1024, tol="0", suffix="MiB")
num("D-data", "1 gb in gib", D("0.93"), tol="0.006", suffix="GiB")
num("D-data", "512 gb in gib", D("476.84"), tol="0.006", suffix="GiB")
num("D-data", "1 tb in gb", 1000, tol="0", suffix="GB")
num("D-data", "1 tib in gib", 1024, tol="0", suffix="GiB")
num("D-data", "8 bits in bytes", 1, tol="0", suffix="B")
num("D-data", "1 mb in kib", D("976.56"), tol="0.006", suffix="KiB")
num("D-data", "100 mbps in mb/s", D("12.5"), tol="0.006", suffix="MB/s")
num("D-data", "1 gbps in mbps", 1000, tol="0", suffix="Mbps")
# data / rate = time
for gb, mbps in [(2, 50), (10, 100), (1, 8), (4.7, 20), (100, 1000), (0.5, 4)]:
    secs = D(str(gb)) * 8000 / D(mbps)
    h, rem = divmod(int(secs), 3600)
    m, s = divmod(rem, 60)
    disp = (f"{h} h " if h else "") + (f"{m} min " if m else "") + (f"{s} s" if s else "")
    exact("D-rate", f"{gb} gb at {mbps} mbps", disp.strip(), note="download time")
    exact("D-rate", f"download {gb} gb at {mbps} mbps", disp.strip())
# speed x time = distance; distance / speed = time; dimensional
for _ in range(25):
    sp = rng.choice([40, 60, 72, 90, 100, 120])
    t = rng.choice([D("0.5"), 1, D("1.5"), 2, D("2.5"), 3, 4])
    num("D-dim", f"{sp} km/h * {t} h", D(sp) * t, tol="0.006", suffix="km")
    num("D-dim", f"{sp} km/h for {t} hours", D(sp) * t, tol="0.006", suffix="km")
    dist = rng.choice([90, 120, 150, 300, 450, 600])
    secs = D(dist) * 3600 / sp
    hh, rem = divmod(int(secs), 3600)
    mm = int(round(rem / 60))
    if mm == 60:
        hh, mm = hh + 1, 0
    disp = (f"{hh} h {mm} min" if mm else f"{hh} h") if hh else f"{mm} min"
    dec_h = fmt(D(dist) / D(sp), 2) + " h"
    anyof("D-dim", f"{dist} km at {sp} km/h", [disp, dec_h])
    anyof("D-dim", f"{dist} km / {sp} km/h", [disp, dec_h])
num("D-dim", "5 km + 300 m", D("5.3"), tol="0.006", suffix="km")
num("D-dim", "2 kg + 500 g", D("2.5"), tol="0.006", suffix="kg")
num("D-dim", "1 l - 250 ml", D("0.75"), tol="0.006", suffix="l")
num("D-dim", "3 ft 6 in in cm", D("106.68"), tol="0.006", suffix="cm")
num("D-dim", "5 ft 10 in in cm", D("177.8"), tol="0.006", suffix="cm")
num("D-dim", "180 cm in ft", D("5.91"), tol="0.006", suffix="ft")
num("D-dim", "10 m * 10 m", 100, tol="0.006", suffix="m²")
num("D-dim", "2 m * 3 m * 4 m", 24, tol="0.006", suffix="m³")
num("D-dim", "1200 sq ft in sq m", D("111.48"), tol="0.006", suffix="m²")
num("D-dim", "1 acre in sq ft", D("43560"), tol="0.006", suffix="sq ft")
num("D-dim", "1 hectare in acres", D("2.47"), tol="0.006", suffix="acre")
num("D-dim", "100 km at 15 km/l", D("6.67"), tol="0.006", suffix="l")
num("D-dim", "40 l * 18 km/l", 720, tol="0.006", suffix="km")
num("D-dim", "12 km/l in mpg", D("28.23"), tol="0.006", suffix="mpg")
for s in ["5 km + 3 kg", "2 h + 3 km", "10 kg in litres", "1 gb + 5 km", "3 m * 4 kg in m²", "100 c in km"]:
    err("D-dim-err", s, note="incompatible dimensions must error")
# electricity
for kw, h, days, rate in [(D("1.5"), 8, 30, 8), (D("0.1"), 10, 30, D("7.5")), (2, 5, 31, 9), (D("0.75"), 3, 30, 6)]:
    units = kw * h * days
    num("D-elec", f"{kw} kw for {h} hours a day for {days} days at {rate} per unit", q2(units * rate), tol="0.01")
    num("D-elec", f"{int(kw * 1000)} watt for {h} hours a day for {days} days at {rate} per unit", q2(units * rate), tol="0.01")
num("D-elec", "1.5 ton ac 8 hours a day for 30 days at 8 per unit", D("1.5") * D("1.2") * 8 * 30 * 8, tol="0.01", note="1 ton = 1.2 kW assumption")
num("D-elec", "1500 watt heater 3 hours daily 30 days at 7 per unit", D("1.5") * 3 * 30 * 7, tol="0.01")

# ----------------------------------------------------------------------------- E. statistics, equations
def pstats(xs):
    n = len(xs)
    mean = sum(xs) / n
    var = sum((x - mean) ** 2 for x in xs) / n
    return mean, var, var.sqrt()


for _ in range(40):
    n = rng.randint(2, 9)
    xs = [D(rng.randint(-20, 200)) if rng.random() < 0.9 else D(rng.randint(1, 9999)) / 100 for _ in range(n)]
    if rng.random() < 0.3:
        xs.append(rng.choice(xs))
    lst = rng.choice([", ", " ", " and "]).join(str(x) for x in xs)
    mean, var, sd = pstats(xs)
    srt = sorted(xs)
    med = srt[len(xs) // 2] if len(xs) % 2 else (srt[len(xs) // 2 - 1] + srt[len(xs) // 2]) / 2
    num("E-stats", f"average of {lst}", mean.quantize(D("0.0001"), rounding=ROUND_HALF_UP), tol="0.00006")
    num("E-stats", f"mean of {lst}", mean.quantize(D("0.0001"), rounding=ROUND_HALF_UP), tol="0.00006")
    num("E-stats", f"median of {lst}", med, tol="0.00006")
    num("E-stats", f"sum of {lst}", sum(xs), tol="0.00006")
    num("E-stats", f"max of {lst}", max(xs), tol="0")
    num("E-stats", f"min of {lst}", min(xs), tol="0")
    num("E-stats", f"range of {lst}", max(xs) - min(xs), tol="0")
    num("E-stats", f"variance of {lst}", var.quantize(D("0.0001"), rounding=ROUND_HALF_UP), tol="0.00006", note="population")
    num("E-stats", f"std of {lst}", sd.quantize(D("0.0001"), rounding=ROUND_HALF_UP), tol="0.00006", note="population")
    num("E-stats", f"standard deviation of {lst}", sd.quantize(D("0.0001"), rounding=ROUND_HALF_UP), tol="0.00006")
    p = rng.choice([10, 25, 50, 75, 90, 95, 100])
    rank = max(1, math.ceil(p / 100 * len(xs)))
    num("E-stats", f"{p}th percentile of {lst}", srt[rank - 1], tol="0", note="nearest-rank")
    from collections import Counter
    c = Counter(xs)
    top = max(c.values())
    modes = [x for x in xs if c[x] == top]
    if top > 1 and len(set(modes)) == 1:
        num("E-stats", f"mode of {lst}", modes[0], tol="0")

# equations
for _ in range(40):
    a = rng.choice([1, 2, 3, 4, 5, 7, 10, -2, -3, D("0.5"), D("1.5")])
    b = rng.randint(-50, 50)
    x = rng.choice([rng.randint(-30, 30), D(rng.randint(-300, 300)) / 10])
    rhs = D(a) * D(x) + b
    sign = "+" if b >= 0 else "-"
    form = rng.choice([f"{a}x {sign} {abs(b)} = {rhs}", f"{a} * x {sign} {abs(b)} = {rhs}", f"{rhs} = {a}x {sign} {abs(b)}", f"{a}x {sign} {abs(b)} - {rhs} = 0"])
    form = form.replace("1x", "x") if a == 1 else form
    exact("E-eq", form, f"x = {fmt(x, 4)}")
    c = rng.randint(1, 9)
    form2 = f"{a}x {sign} {abs(b)} = {c}x + {rhs - c * D(x)}" if rhs - c * D(x) >= 0 else f"{a}x {sign} {abs(b)} = {c}x - {abs(rhs - c * D(x))}"
    if D(a) != c:
        exact("E-eq", form2, f"x = {fmt(x, 4)}")
for s in ["x * x = 4", "x^2 = 9", "x / x = 1", "0x = 5", "2x + 3 = 2x + 4", "x = x", "1/x = 2", "y + 2 = 5"]:
    err("E-eq-err", s, note="non-linear, degenerate, or other variable: clarify, never a number")
for pct, total in [(25, 80), (10, 50), (50, 300), (12, 250)]:
    exact("E-eq", f"x% of {total} = {D(total) * pct / 100}", f"x = {pct}")
# work rate and proportion
for _ in range(20):
    w1, d1, w2 = rng.randint(2, 30), rng.randint(2, 40), rng.randint(2, 30)
    ans = D(w1 * d1) / w2
    num("E-prop", f"{w1} workers {d1} days, {w2} workers how many days", ans.quantize(D("0.01"), rounding=ROUND_HALF_UP), tol="0.006", suffix="days")
    num("E-prop", f"{w1} men can do a job in {d1} days, how many days for {w2} men", ans.quantize(D("0.01"), rounding=ROUND_HALF_UP), tol="0.006")
    n1, p1, n2 = rng.randint(2, 12), rng.randint(10, 999), rng.randint(2, 20)
    num("E-prop", f"{n1} pens cost {p1}, {n2} pens?", (D(p1) * n2 / n1).quantize(D("0.01"), rounding=ROUND_HALF_UP), tol="0.006")
    num("E-prop", f"if {n1} kg costs {p1}, what do {n2} kg cost", (D(p1) * n2 / n1).quantize(D("0.01"), rounding=ROUND_HALF_UP), tol="0.006")
for _ in range(12):
    tl, pl, sp = rng.choice([100, 150, 200, 250, 300, 360]), rng.choice([100, 150, 200, 240, 400]), rng.choice([36, 54, 72, 90, 108])
    secs = D(tl + pl) / (D(sp) * 1000 / 3600)
    num("E-train", f"train {tl} m at {sp} km/h crosses platform {pl} m", secs.quantize(D("0.01"), rounding=ROUND_HALF_UP), tol="0.006", suffix="s")
    num("E-train", f"a {tl} m long train at {sp} km/h crosses a {pl} m platform in", secs.quantize(D("0.01"), rounding=ROUND_HALF_UP), tol="0.006", suffix="s")
# variables
for _ in range(25):
    a, b, c = rng.randint(1, 500), rng.randint(1, 500), rng.randint(1, 50)
    num("E-vars", [f"a = {a}", f"b = {b}", "a + b"], a + b, tol="0")
    num("E-vars", [f"price = {a}", f"qty = {c}", "price * qty"], a * c, tol="0")
    num("E-vars", [f"rent = {a * 100}", f"food = {b * 10}", "total = rent + food", "total * 12"], (a * 100 + b * 10) * 12, tol="0")
    num("E-vars", [f"x = {a}", f"x * 2", "that + 1"], a * 2 + 1, tol="0")
    num("E-vars", [f"speed = {a} km/h", f"time = {c} h", "speed * time"], a * c, tol="0", suffix="km", note="units carried through variables")
    num("E-vars", [f"salary = {a * 1000}", "salary - 10%", "prev * 12"], q2(D(a * 1000) * D("0.9")) * 12, tol="0.02")
    pct = rng.choice([10, 18, 20])
    num("E-vars", [f"base = {a * 10}", f"gst = {pct}%", "base + gst"], q2(D(a * 10) * (100 + pct) / 100), tol="0.006")
for s in [["a = 5", "a + b"], ["undefined_var * 2"], ["x = ", "x + 1"]]:
    err("E-vars-err", s, note="missing variable must error")

# ----------------------------------------------------------------------------- F. health, study, everyday
for _ in range(30):
    kg, cm, age = rng.randint(40, 120), rng.randint(140, 200), rng.randint(18, 80)
    female = rng.random() < 0.5
    bmr = 10 * kg + D("6.25") * cm - 5 * age + (-161 if female else 5)
    sex = "female" if female else "male"
    num("F-health", f"bmr {kg} kg {cm} cm {age} {sex}", bmr.quantize(D("1"), rounding=ROUND_HALF_UP), tol="0.5", suffix="kcal/day")
    lvl = rng.choice([("sedentary", D("1.2")), ("light", D("1.375")), ("moderate", D("1.55")), ("active", D("1.725")), ("very active", D("1.9"))])
    num("F-health", f"tdee {kg} kg {cm} cm {age} {sex} {lvl[0]}", (bmr * lvl[1]).quantize(D("1"), rounding=ROUND_HALF_UP), tol="1", suffix="kcal/day")
    bmi = D(kg) / (D(cm) / 100) ** 2
    num("F-health", f"bmi {kg} kg {cm} cm", bmi.quantize(D("0.1"), rounding=ROUND_HALF_UP), tol="0.06")
    num("F-health", f"water intake {kg} kg", (D(kg) * 35 / 1000).quantize(D("0.01"), rounding=ROUND_HALF_UP), tol="0.006", suffix="l/day")
    base = D("45.5") if female else D("50")
    inches = D(cm) / D("2.54")
    num("F-health", f"ideal weight for {cm} cm {sex}", (base + D("2.3") * (inches - 60) if inches >= 60 else base).quantize(D("0.1"), rounding=ROUND_HALF_UP), tol="0.06", suffix="kg", note="Devine; below 152 cm the base weight (the note says so)")
for kg_wk in [D("0.25"), D("0.5"), 1]:
    num("F-health", f"calories to lose {kg_wk} kg a week", (D(kg_wk) * 7700 / 7).quantize(D("1"), rounding=ROUND_HALF_UP), tol="0.5", suffix="kcal/day deficit")
for steps in [2500, 5000, 8000, 10000, 12345, 20000]:
    num("F-health", f"{steps} steps in km", (D(steps) * D("0.762") / 1000).quantize(D("0.01"), rounding=ROUND_HALF_UP), tol="0.006", suffix="km")
for km, mins in [(5, 28), (10, 55), (D("2.5"), 15), (21.1, 120), (42.2, 240), (3, 18)]:
    per = D(str(mins)) / D(str(km))
    mm = int(per)
    ss = int(round((per - mm) * 60))
    if ss == 60:
        mm, ss = mm + 1, 0
    exact("F-health", f"{km} km in {mins} minutes pace", f"{mm}:{ss:02d} min/km")
for pace, km in [("5:30", 10), ("6:00", 5), ("4:45", 21.1), ("7:15", 3)]:
    m, s = pace.split(":")
    total = (D(m) + D(s) / 60) * D(str(km))
    h = int(total // 60)
    mins = int((total - h * 60).quantize(D("1"), rounding=ROUND_HALF_UP))
    exact("F-health", f"pace {pace} for {km} km", f"{h} h {mins} min" if h else f"{mins} min")
# grades, marks
GR = [(91, "A1"), (81, "A2"), (71, "B1"), (61, "B2"), (51, "C1"), (41, "C2"), (33, "D"), (0, "E")]
for pc in [100, 95, 91, 90.5, 90, 81, 80, 71, 70, 61, 60, 51, 50, 41, 40, 33, 32, 0]:
    exact("F-study", f"grade for {pc}%", next(g for m, g in GR if D(str(pc)) >= m))
for _ in range(20):
    have = [rng.randint(40, 100) for _ in range(rng.randint(2, 5))]
    target = rng.randint(60, 95)
    need = target * (len(have) + 1) - sum(have)
    num("F-study", f"marks needed for {target} average with {', '.join(map(str, have))}", need, tol="0")
    num("F-study", f"average of {' '.join(map(str, have))} then what for {target} average", need, tol="0")
    num("F-study", f"cgpa {rng.choice([7, 8, 8.5, 9, 9.2])} in percentage", None, tol="0") if False else None
for cg in [7, 8, D("8.5"), 9, D("9.2"), 10]:
    num("F-study", f"cgpa {cg} in percentage", D(cg) * D("9.5"), tol="0.006", suffix="%")
# number words
ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]


def w99(n):
    return ONES[n] if n < 20 else TENS[n // 10] + ("-" + ONES[n % 10] if n % 10 else "")


def w999(n):
    s = []
    if n >= 100:
        s.append(ONES[n // 100] + " hundred")
    if n % 100:
        s.append(w99(n % 100))
    return " ".join(s)


def words_indian(n):
    if n == 0:
        return "zero"
    parts = []
    crore, n = divmod(n, 10 ** 7)
    lakh, n = divmod(n, 10 ** 5)
    th, n = divmod(n, 1000)
    if crore:
        parts.append(words_indian(crore) + " crore")
    if lakh:
        parts.append(w99(lakh) + " lakh")
    if th:
        parts.append(w99(th) + " thousand")
    if n:
        parts.append(w999(n))
    return " ".join(parts)


def words_intl(n):
    if n == 0:
        return "zero"
    parts = []
    for div, name in [(10 ** 9, "billion"), (10 ** 6, "million"), (10 ** 3, "thousand")]:
        k, n = divmod(n, div)
        if k:
            parts.append(w999(k) + " " + name)
    if n:
        parts.append(w999(n))
    return " ".join(parts)


for n in [0, 7, 19, 20, 21, 99, 100, 101, 110, 999, 1000, 1001, 10000, 12345, 99999, 100000, 100001, 123456, 1000000, 1234567, 9999999, 10000000, 12345678, 100000000, 123456789]:
    exact("F-words", f"{n} in words", words_indian(n))
    exact("F-words", f"{n} in words international", words_intl(n))


def to_roman(n):
    out = ""
    for v, s in [(1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"), (90, "XC"), (50, "L"), (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")]:
        while n >= v:
            out += s
            n -= v
    return out


for n in [1, 4, 9, 14, 40, 49, 90, 99, 400, 444, 499, 900, 999, 1000, 1994, 2024, 2026, 3999]:
    exact("F-roman", f"{n} in roman", to_roman(n))
    num("F-roman", f"roman {to_roman(n)}", n, tol="0")
for n in [0, 1, 5, 10, 15, 16, 100, 255, 256, 1000, 4095, 65535, 65536, 123456]:
    exact("F-base", f"{n} in hex", "0x" + format(n, "X"))
    exact("F-base", f"{n} in binary", "0b" + format(n, "b"))
    num("F-base", f"0x{format(n, 'x')} + 0", n, tol="0")
    num("F-base", f"0b{format(n, 'b')} * 1", n, tol="0")
num("F-base", "0xff + 0b1", 256, tol="0")
num("F-base", "0x10 * 0x10", 256, tol="0")
for s in ["4000 in roman", "0 in roman", "-5 in roman", "roman IIII", "roman ABC", "0xZZ + 1", "0b102 + 1"]:
    err("F-base-err", s)
# cooking
for g, ing, cup_g in [(250, "flour", 120), (200, "sugar", 200), (100, "butter", 227), (300, "rice", 185)]:
    num("F-cook", f"{g} g {ing} in cups", (D(g) / cup_g).quantize(D("0.01"), rounding=ROUND_HALF_UP), tol="0.006", suffix="cups", note="per-ingredient cup weights: flour 120, sugar 200, butter 227, rice 185")
    num("F-cook", f"2 cups {ing} in g", 2 * cup_g, tol="0.006", suffix="g")
num("F-cook", "2 cups in ml", D("473.18"), tol="0.006", suffix="ml")
num("F-cook", "3 tbsp in tsp", 9, tol="0.006", suffix="tsp")
num("F-cook", "1 cup in tbsp", 16, tol="0.006", suffix="tbsp")
num("F-cook", "500 ml in cups", D("2.11"), tol="0.006", suffix="cups")
num("F-cook", "350 f in c for oven", D("176.67"), tol="0.006", suffix="°C")
# sizes
for uk, us, eu in [(6, 7, 39), (7, 8, 40), (8, 9, 42), (9, 10, 43), (10, 11, 44)]:
    contains("F-size", f"uk {uk} shoe in us", [f"US {us}"], note="men's UK→US = +1")
exact("F-size", "shirt size for 40 inch chest", "L")
exact("F-size", "shirt size for 38 inch chest", "M")
exact("F-size", "shirt size for 44 inch chest", "XXL")
# fuel
for dist, kmpl, price in [(400, 18, 90), (250, 15, 105), (1200, 12, 100), (80, 20, D("102.5"))]:
    num("F-fuel", f"{dist} km at {kmpl} kmpl petrol {price}", q2(D(dist) / kmpl * D(price)), tol="0.01")
    num("F-fuel", f"{dist} km at {kmpl} km/l diesel {price}", q2(D(dist) / kmpl * D(price)), tol="0.01")

# ----------------------------------------------------------------------------- G. multi-step natural language
for _ in range(30):
    p = rng.randint(500, 20000)
    d = rng.choice([10, 15, 20, 25])
    g = rng.choice([5, 12, 18])
    n = rng.choice([2, 3, 4, 5])
    tip = rng.choice([5, 10])
    after_d = q2(D(p) * (100 - d) / 100)
    after_g = q2(after_d * (100 + g) / 100)
    num("G-multi", f"{p} - {d}% + {g}% gst", after_g, tol="0.02")
    num("G-multi", f"{p} - {d}% + {g}% gst / {n}", (after_g / n).quantize(D("0.0001"), rounding=ROUND_HALF_UP), tol="0.02")
    num("G-multi", f"{p} - {d}% + {g}% gst + {tip}% tip", q2(after_g * (100 + tip) / 100), tol="0.03")
    num("G-multi", f"{p} minus {d}% discount plus {g}% gst split {n} ways", (after_g / n).quantize(D("0.0001"), rounding=ROUND_HALF_UP), tol="0.02")
    num("G-multi", [f"bill = {p} - {d}%", f"bill + {g}% gst", f"prev / {n}"], (after_g / n).quantize(D("0.0001"), rounding=ROUND_HALF_UP), tol="0.02")
    sal = rng.randint(30, 150) * 10000
    hike = rng.choice([8, 10, 12, 15])
    new = q2(D(sal) * (100 + hike) / 100)
    num("G-multi", f"{sal} + {hike}% hike", new, tol="0.02")
    num("G-multi", [f"salary = {sal}", f"salary + {hike}%", "prev - 12%", "prev - 200"], q2(q2(new * D("0.88")) - 200), tol="0.03", note="hike, then PF 12%, then PT 200")
    L = rng.choice([2, 5, 10, 20])
    num("G-multi", f"{L} l - 10% + 500 ml in ml", q2(D(L) * 1000 * D("0.9") + 500), tol="0.02", suffix="ml")
    num("G-multi", f"{L} litres minus 10% plus 500 ml", D(L) * D("0.9") + D("0.5"), tol="0.02", suffix="l")
    a, b = rng.randint(100, 999), rng.randint(1, 99)
    num("G-multi", f"{a} + {b} - {b} * 2 + {b}", a, tol="0")
    cost = rng.randint(1000, 50000)
    num("G-multi", f"{cost} + 18% gst then 10% off", q2(q2(D(cost) * D("1.18")) * D("0.9")), tol="0.03", note="order: gst then discount")
    num("G-multi", f"{cost} with 10% off then 18% gst", q2(q2(D(cost) * D("0.9")) * D("1.18")), tol="0.03")
    anynum("G-multi", f"{cost} ka 10% nikal ke 18% gst laga ke total", [D(cost) * D("0.9") * D("1.18"), D(cost) * D("0.1") * D("1.18")], tol="0.01", note="'10% nikal ke' = remove 10% or take 10%; both readings keep both steps")
    num("G-multi", f"{cost} me se 10% nikal ke 18% gst laga ke total", q2(q2(D(cost) * D("0.9")) * D("1.18")), tol="0.03", note="'me se nikal' = take off the amount")
    num("G-multi", f"mere paas {cost} the, {b * 10} kharch kiye, {a} aur mile, kitna bacha", cost - b * 10 + a, tol="0")
    num("G-multi", f"i had {cost}, spent {b * 10}, got {a} more, how much left", cost - b * 10 + a, tol="0")

# ----------------------------------------------------------------------------- S. safety: unsupported / ambiguous / malformed must not return an unrelated number
for s in ["hello how are you", "what is the meaning of life", "convert my salary", "tell me a joke", "interest on 10000 at 5%", "emi 5 lakh", "sip 5000 for 10 years", "10 lakh today in 10 years", "shoe size 9",
          "100 usd + 50 eur", "5 apples + 3 oranges in kg", "what time is it on mars", "fd 2 lakh", "income tax", "ctc", "bmr 70 kg", "split 1000", "pace", "grade for",
          "x% of 80", "convert 5", "5 kg in", "in km", "how many", "tax on", "10 @ 5", "???", "calculate", "%", "100 100", "5 5 5", "12 apples 3 oranges",
          "weather tomorrow", "translate 5 to hindi", "remind me at 5pm", "open calculator", "who is the pm of india", "capital of france", "2 + 2 = 5",
          "diwali 2031", "holi 2019", "rd 5000 for 2 years", "ideal weight", "steps in km"]:
    err("S-safety", s, note="must be an error/clarification, never a plausible unrelated number")
# whitespace, punctuation, casing
for s, v in [("  25%   of   480  ", 120), ("25% OF 480", 120), ("25% Of 480.", 120), ("25 % of 480", 120), ("Emi 5 Lakh At 9% For 5 Years", D("10379.18")), ("EMI 5 LAKH AT 9% FOR 5 YEARS", D("10379.18")),
             ("sqrt( 144 )", 12), ("2+3*4", 14), ("2 +3* 4", 14), ("1,00,000 + 1", 100001), ("1,000,000 / 4", 250000), ("₹500 + ₹250", 750), ("rs 500 + rs 250", 750), ("Rs. 1,200 - 10%", 1080)]:
    num("S-format", s, v, tol="0.006")

out = Path(__file__).with_name("cases.json")
out.write_text(json.dumps(CASES, indent=0, ensure_ascii=False), encoding="utf-8")
from collections import Counter as _C
print(len(CASES), "cases")
print(_C(c["cat"].split("-")[0] for c in CASES))
