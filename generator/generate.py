"""Generate synthetic CRM data for the sample sales dashboard.

Run:  python3 generator/generate.py           (writes site/data/data.json, prints a summary)
      python3 generator/generate.py --seed 3  (try another seed, prints the summary only)

How it works, week by week:
1. Outbound: each channel contacts a number of prospects per message. Replies are drawn at
   the channel's reply rate, and every reply becomes one lead. The weekly counts go into the
   `outreach` table, so outreach.replied always matches the outbound leads in `deals`.
2. Inbound (SEO, website, SumUp) and referral leads arrive at their own weekly rates.
   Referrals grow with the number of live customers.
3. Each lead walks through the funnel. At each stage we draw the time spent there from a
   lognormal distribution, then draw whether it moves on, using the probabilities in config.py.
   Anything that would happen after AS_OF hasn't happened yet: the deal is open at that stage.
4. Won deals get a go-live date. Customers who are live by AS_OF get a subscription, which may churn.
Only the standard library is used.
"""
import json
import math
import random
import sys
from collections import Counter
from datetime import date, timedelta
from pathlib import Path
from statistics import median

import config as C

rng = random.Random()
used_names = set()
OUT = Path(__file__).resolve().parent.parent / "site" / "data" / "data.json"


# ---------------------------------------------------------------- helpers
def pick(weights):
    """Pick a key from a {value: weight} dict."""
    return rng.choices(list(weights), weights=list(weights.values()))[0]


def days(median_days, upper=C.MAX_DAYS):
    """Lognormal duration: most near the median, a few much longer. Redrawn above `upper`."""
    while True:
        d = max(1, round(rng.lognormvariate(math.log(median_days), C.SIGMA)))
        if d <= upper:
            return d


def binomial(n, p):
    """How many of n tries succeed, each with probability p."""
    return sum(rng.random() < p for _ in range(n))


def around(mu):
    """A whole number of events around mu (normal approximation of a Poisson count)."""
    return max(0, round(rng.gauss(mu, math.sqrt(mu)))) if mu > 0 else 0


def ramp(start_end, week, n_weeks):
    start, end = start_end
    return start + (end - start) * week / (n_weeks - 1)


def speed_factor(days_to_demo):
    for limit, factor in C.SPEED_FACTORS:
        if days_to_demo <= limit:
            return factor


def window_weekdays(week_start):
    """Weekdays of this week that fall inside the data window."""
    ds = [week_start + timedelta(i) for i in range(5)]
    return [d for d in ds if C.START <= d <= C.AS_OF]


# ---------------------------------------------------------------- accounts
def make_name(segment, specialty, city):
    # Try plain names first, then longer variants, then numbered ones
    if segment == "MVZ":
        tiers = [[f"MVZ {p}" for p in C.MVZ_PLACES[city]],
                 [f"MVZ {p} {specialty}" for p in C.MVZ_PLACES[city]]]
    else:
        prefix = C.PRAXIS_PREFIX[specialty]
        tiers = [[f"{prefix} {s}" for s in C.PLACE_SUFFIXES],
                 [f"{prefix} {s} {city}" for s in C.PLACE_SUFFIXES]]
    tiers.append([f"{tiers[0][0]} {i}" for i in range(2, 100)])
    for options in tiers:
        free = [o for o in options if o not in used_names]
        if free:
            break
    name = rng.choice(free)
    used_names.add(name)
    return name


def make_account(segment, message):
    city = pick(C.CITY_WEIGHTS)
    if segment == "Klinik":
        specialty = "Fachübergreifend"
        name = next(n for n in C.KLINIK_NAMES if n not in used_names)
        used_names.add(name)
        doctors = rng.randint(*C.KLINIK_DOCTORS_RANGE)
    else:
        specialties = dict(C.SPECIALTY_WEIGHTS)
        if message in C.NOT_FOR_DENTISTS:
            specialties.pop("Zahnmedizin")
        specialty = pick(specialties)
        name = make_name(segment, specialty, city)
        if segment == "MVZ":
            doctors = rng.randint(*C.MVZ_DOCTORS_RANGE)
        else:
            doctors = pick(C.PRAXIS_DOCTORS_WEIGHTS)
    return {
        "id": None,  # numbered at the end, in order of lead date
        "name": name,
        "segment": segment,
        "specialty": specialty,
        "city": city,
        "billing_setup": pick(C.BILLING_SETUP_WEIGHTS),
        "doctors": doctors,
    }


def pick_tier_and_mrr(account, source):
    seg, docs = account["segment"], account["doctors"]
    if seg == "Klinik":
        lo, hi = C.KLINIK_MRR_RANGE
        return "custom", rng.randrange(lo, hi + 1, 500)
    if seg == "MVZ":
        tier = pick(C.MVZ_TIER_WEIGHTS)
        mrr = C.TIER_PRICE[tier] * C.MVZ_PRICE_SHARE_PER_DOCTOR * docs
    else:
        tier = pick(C.SOURCE_PRAXIS_TIER_WEIGHTS[source])
        mrr = C.TIER_PRICE[tier] * (1 + C.PRAXIS_EXTRA_DOCTOR_SHARE * (docs - 1))
    return tier, int(round(mrr / 5) * 5)


def inbound_message(source):
    if source == "seo_tools":
        return pick(C.SEO_ENTRY_WEIGHTS)
    return {"website_demo": C.WEBSITE_MESSAGE, "sumup": C.SUMUP_MESSAGE,
            "referral": C.REFERRAL_MESSAGE}[source]


# ---------------------------------------------------------------- deals
def empty_deal(account, source, message, created):
    tier, mrr = pick_tier_and_mrr(account, source)
    return {
        "id": None,
        "account_id": None,
        "lead_source": source,
        "message": message,
        "tier": tier,
        "expected_mrr": mrr,
        "status": "open",
        "stage": "lead",
        "created_date": created,
        "demo_booked_date": None,
        "demo_held_date": None,
        "won_date": None,
        "lost_date": None,
        "lost_stage": None,
        "lost_reason": None,
        "go_live_date": None,
    }


def lose(deal, stage, when, reason):
    """Close as lost, unless that would happen after AS_OF (then it stays open)."""
    if when <= C.AS_OF:
        deal.update(status="lost", stage="lost", lost_stage=stage, lost_date=when, lost_reason=reason)


def simulate(deal, account):
    seg = C.SEGMENT_STAGE_FACTOR[account["segment"]]
    src = deal["lead_source"]
    created = deal["created_date"]

    # Stage 1: lead -> demo booked
    if src == "website_demo":
        booked = created  # booked the demo directly on the website
    else:
        p_book = C.P_BOOK[src] * C.MESSAGE_FIT.get((deal["message"], account["billing_setup"]), 1.0)
        if rng.random() < min(p_book, C.P_MAX):
            median_lead = C.MEDIAN_LEAD * seg["lead"] * C.FAST_LEAD_SOURCES.get(src, 1.0)
            booked = created + timedelta(days(median_lead, upper=C.LEAD_MAX_DAYS))
        else:
            reason = pick(C.LOST_LEAD_REASONS)
            if reason == C.SILENT:
                when = created + timedelta(C.NO_RESPONSE_DAYS)
            else:
                when = created + timedelta(rng.randint(3, 20))
            lose(deal, "lead", when, reason)
            return
    if booked > C.AS_OF:
        return  # still open at lead
    deal.update(stage="demo_booked", demo_booked_date=booked)

    # Stage 2: demo booked -> demo held (or no-show)
    demo_day = booked + timedelta(days(C.MEDIAN_BOOKED * seg["booked"]))
    if demo_day > C.AS_OF:
        return  # demo still scheduled
    if rng.random() >= C.P_HELD[src]:
        lose(deal, "demo_booked", demo_day + timedelta(rng.randint(1, 5)), pick(C.LOST_BOOKED_REASONS))
        return
    deal.update(stage="demo_held", demo_held_date=demo_day)

    # Stage 3: demo held -> won or lost
    days_to_demo = (demo_day - created).days
    p_win = C.P_WIN[src] * C.SEGMENT_WIN_FACTOR[account["segment"]] * speed_factor(days_to_demo)
    if rng.random() < min(p_win, C.P_MAX):
        won = demo_day + timedelta(days(C.MEDIAN_HELD_WON * seg["held"]))
        if won > C.AS_OF:
            return  # still deciding
        live = won + timedelta(days(C.MEDIAN_WON_TO_LIVE * seg["live"]))
        deal.update(status="won", stage="won", won_date=won, go_live_date=live)
    else:
        lost_day = demo_day + timedelta(days(C.MEDIAN_HELD_LOST * seg["held"]))
        reasons = C.LOST_HELD_REASONS_SEO if src == "seo_tools" else C.LOST_HELD_REASONS
        reason = pick(reasons)
        if reason == "Happy with current setup" and account["billing_setup"] == "external_service":
            reason = "Happy with external billing service"
        lose(deal, "demo_held", lost_day, reason)


# ---------------------------------------------------------------- subscriptions
def make_subscription(deal):
    start = deal["go_live_date"]
    end = None
    month = timedelta(days=30)
    t = start + month
    while t <= C.AS_OF:  # one churn check per full month live
        if rng.random() < C.MONTHLY_CHURN[deal["tier"]]:
            end = t
            break
        t += month
    return {
        "id": None,
        "account_id": deal["account_id"],
        "deal_id": deal["id"],
        "tier": deal["tier"],
        "mrr": deal["expected_mrr"],
        "start_date": start,
        "end_date": end,
    }


# ---------------------------------------------------------------- main
def generate(seed):
    rng.seed(seed)
    used_names.clear()
    pairs = []      # (account, deal)
    outreach = []   # one row per week x outbound source x message

    def new_lead(source, message, created, segment=None):
        account = make_account(segment or pick(C.SOURCE_SEGMENT_WEIGHTS[source]), message)
        deal = empty_deal(account, source, message, created)
        if segment != "Klinik":
            simulate(deal, account)
        pairs.append((account, deal))
        return deal

    first_monday = C.START - timedelta(C.START.weekday())
    weeks = []
    w = first_monday
    while w <= C.AS_OF:
        weeks.append(w)
        w += timedelta(7)

    for i, week_start in enumerate(weeks):
        weekdays = window_weekdays(week_start)
        share = len(weekdays) / 5  # partial first and last week

        # Referrals: each live customer may refer a new practice this week
        live = sum(1 for _, d in pairs if d["status"] == "won" and d["go_live_date"] <= week_start)
        for _ in range(binomial(live, C.REFERRAL_P_PER_CUSTOMER_WEEK)):
            new_lead("referral", C.REFERRAL_MESSAGE, rng.choice(weekdays))

        # Outbound: contacts per message, replies become leads
        for src in C.OUTBOUND_SOURCES:
            n_contacts = round(ramp(C.OUTBOUND_CONTACTS_PER_WEEK[src], i, len(weeks)) * share)
            per_message = Counter(rng.choice(C.OUTBOUND_MESSAGES) for _ in range(n_contacts))
            for msg in C.OUTBOUND_MESSAGES:
                contacted = per_message[msg]
                replied = binomial(contacted, C.REPLY_RATE[src] * C.MESSAGE_REPLY_FACTOR[msg])
                for _ in range(replied):
                    new_lead(src, msg, rng.choice(weekdays))
                outreach.append({"week_start": week_start, "source": src, "message": msg,
                                 "contacted": contacted, "replied": replied})

        # Inbound
        for src, start_end in C.INBOUND_LEADS_PER_WEEK.items():
            for _ in range(around(ramp(start_end, i, len(weeks)) * share)):
                new_lead(src, inbound_message(src), rng.choice(weekdays))

    # Kliniken: early conversations from outbound, open at lead or demo booked.
    # Each one is also a contact and a reply in the outreach table.
    for _ in range(C.KLINIK_LEADS):
        src = rng.choice(C.KLINIK_SOURCES)
        created = C.AS_OF - timedelta(rng.randint(8, 45))
        while created.weekday() >= 5:
            created -= timedelta(1)
        deal = new_lead(src, C.KLINIK_MESSAGE, created, segment="Klinik")
        if (C.AS_OF - created).days > 25:
            deal.update(stage="demo_booked", demo_booked_date=created + timedelta(rng.randint(5, 15)))
        week_start = created - timedelta(created.weekday())
        row = next(r for r in outreach if r["week_start"] == week_start and r["source"] == src
                   and r["message"] == C.KLINIK_MESSAGE)
        row["contacted"] += 1
        row["replied"] += 1

    # Number accounts and deals in order of lead date (A-0001 belongs to D-0001)
    pairs.sort(key=lambda p: p[1]["created_date"])
    accounts, deals = [], []
    for n, (account, deal) in enumerate(pairs, start=1):
        account["id"] = f"A-{n:04d}"
        deal.update(id=f"D-{n:04d}", account_id=account["id"])
        accounts.append(account)
        deals.append(deal)

    subs = []
    for deal in deals:
        if deal["status"] == "won" and deal["go_live_date"] <= C.AS_OF:
            sub = make_subscription(deal)
            sub["id"] = f"S-{len(subs) + 1:04d}"
            subs.append(sub)

    check_outreach(deals, outreach)
    return {"accounts": accounts, "deals": deals, "subscriptions": subs, "outreach": outreach}


def check_outreach(deals, outreach):
    """outreach.replied must equal the outbound leads per week, source and message."""
    leads = Counter((d["created_date"] - timedelta(d["created_date"].weekday()), d["lead_source"], d["message"])
                    for d in deals if d["lead_source"] in C.OUTBOUND_SOURCES)
    replies = Counter({(r["week_start"], r["source"], r["message"]): r["replied"] for r in outreach})
    replies = +replies  # drop zero rows
    assert leads == replies, "outreach.replied does not match outbound leads"


def to_json(data):
    def clean(row):
        return {k: v.isoformat() if hasattr(v, "isoformat") else v for k, v in row.items()}

    return {
        "meta": {
            "as_of": C.AS_OF.isoformat(),
            "window_start": C.START.isoformat(),
            "seed": C.SEED,
            "stages": ["lead", "demo_booked", "demo_held", "won"],
            "disclaimer": C.DISCLAIMER,
            "assumptions": C.ASSUMPTIONS,
            "costs": C.COSTS,
            "reply_rates_assumed": C.REPLY_RATE,
        },
        "accounts": data["accounts"],
        "deals": [clean(d) for d in data["deals"]],
        "subscriptions": [clean(s) for s in data["subscriptions"]],
        "outreach": [clean(r) for r in data["outreach"]],
    }


# ---------------------------------------------------------------- metrics (summary and seed check)
def rate(num, den):
    return {"num": num, "den": den, "pct": 100 * num / den if den else None}


def metrics(data):
    acc = {a["id"]: a for a in data["accounts"]}
    core = [d for d in data["deals"] if acc[d["account_id"]]["segment"] != "Klinik"]
    closed = [d for d in core if d["status"] != "open"]
    m = {"status": Counter(d["status"] for d in core),
         "open_by_stage": Counter(d["stage"] for d in core if d["status"] == "open")}

    def past(d, stage):  # did the deal resolve this stage (move on or get lost there)?
        nxt = {"lead": "demo_booked_date", "demo_booked": "demo_held_date", "demo_held": "won_date"}[stage]
        return bool(d[nxt]) or d["lost_stage"] == stage

    # F1 and channel economics
    m["source"] = {}
    for src in C.ALL_SOURCES:
        ds = [d for d in core if d["lead_source"] == src]
        won = [d for d in ds if d["status"] == "won"]
        a = [d for d in ds if past(d, "lead")]
        b = [d for d in ds if past(d, "demo_booked")]
        h = [d for d in ds if past(d, "demo_held")]
        cl = [d for d in ds if d["status"] != "open"]
        m["source"][src] = {
            "leads": len(ds),
            "booked": rate(sum(bool(d["demo_booked_date"]) for d in a), len(a)),
            "held": rate(sum(bool(d["demo_held_date"]) for d in b), len(b)),
            "won_after_demo": rate(sum(d["status"] == "won" for d in h), len(h)),
            "win_rate": rate(len(won), len(cl)),
            "won": len(won),
            "won_mrr": sum(d["expected_mrr"] for d in won),
            "avg_won_mrr": sum(d["expected_mrr"] for d in won) / len(won) if won else None,
            "mvz_share_leads": rate(sum(acc[d["account_id"]]["segment"] == "MVZ" for d in ds), len(ds)),
            "demos_booked": sum(bool(d["demo_booked_date"]) for d in ds),
        }

    # Outreach and reply rates
    out = data["outreach"]
    m["reply_by_source"] = {s: rate(sum(r["replied"] for r in out if r["source"] == s),
                                    sum(r["contacted"] for r in out if r["source"] == s)) for s in C.OUTBOUND_SOURCES}
    m["reply_by_message"] = {msg: rate(sum(r["replied"] for r in out if r["message"] == msg),
                                       sum(r["contacted"] for r in out if r["message"] == msg)) for msg in C.OUTBOUND_MESSAGES}
    m["contacted_by_source"] = {s: sum(r["contacted"] for r in out if r["source"] == s) for s in C.OUTBOUND_SOURCES}

    # CAC and payback
    k = C.COSTS
    m["cac"] = {}
    for src in C.ALL_SOURCES:
        s = m["source"][src]
        cost = s["demos_booked"] * k["sales_hours_per_deal_from_demo_booked"] * k["hourly_rate_eur"]
        if src in C.OUTBOUND_SOURCES:
            cost += m["contacted_by_source"][src] * k["minutes_per_contact"][src] / 60 * k["hourly_rate_eur"]
        cost += k["monthly_fixed_eur"].get(src, 0) * k["window_months"]
        cost += k["fee_per_won_eur"].get(src, 0) * s["won"]
        cac = cost / s["won"] if s["won"] else None
        payback = cac / s["avg_won_mrr"] if cac else None
        m["cac"][src] = {"cost": cost, "won": s["won"], "cac": cac, "payback_months": payback}

    # F2 speed to demo
    def held_resolved(f):
        return [d for d in core if f(d["lead_source"]) and past(d, "demo_held")]
    groups = {"all": lambda s: True, "outbound": lambda s: s in C.OUTBOUND_SOURCES,
              "inbound": lambda s: s not in C.OUTBOUND_SOURCES}
    m["speed"] = {}
    for g, f in groups.items():
        ds = held_resolved(f)
        m["speed"][g] = {}
        for lo, hi, label in [(0, 7, "<=7d"), (8, 14, "8-14d"), (15, 10_000, ">14d")]:
            b = [d for d in ds if lo <= (d["demo_held_date"] - d["created_date"]).days <= hi]
            m["speed"][g][label] = rate(sum(d["status"] == "won" for d in b), len(b))

    # F3 booking by message and billing setup (outbound)
    m["fit"] = {}
    for msg in C.OUTBOUND_MESSAGES:
        for b in ("external_service", "in_house"):
            ds = [d for d in core if d["message"] == msg and acc[d["account_id"]]["billing_setup"] == b and past(d, "lead")]
            m["fit"][(msg, b)] = rate(sum(bool(d["demo_booked_date"]) for d in ds), len(ds))
    m["booking_by_message"] = {}
    for msg in C.OUTBOUND_MESSAGES:
        ds = [d for d in core if d["message"] == msg and past(d, "lead")]
        m["booking_by_message"][msg] = rate(sum(bool(d["demo_booked_date"]) for d in ds), len(ds))

    # Segments, revenue, forecast inputs
    m["segment"] = {}
    for seg in ("Praxis", "MVZ"):
        ds = [d for d in closed if acc[d["account_id"]]["segment"] == seg]
        won = [d for d in ds if d["status"] == "won"]
        m["segment"][seg] = {
            "win_rate": rate(len(won), len(ds)),
            "cycle": median([(d["won_date"] - d["created_date"]).days for d in won]) if won else None,
            "to_live": median([(d["go_live_date"] - d["won_date"]).days for d in won]) if won else None,
            "mrr": median([d["expected_mrr"] for d in won]) if won else None,
            "won": len(won),
        }
    subs = data["subscriptions"]
    m["mrr_live"] = sum(s["mrr"] for s in subs if s["end_date"] is None)
    m["churned"] = sum(s["end_date"] is not None for s in subs)
    wnl = [d for d in core if d["status"] == "won" and d["go_live_date"] > C.AS_OF]
    m["won_not_live"] = (len(wnl), sum(d["expected_mrr"] for d in wnl))
    oh = [d for d in core if d["status"] == "open" and d["stage"] == "demo_held"]
    m["open_held"] = rate(sum(d["expected_mrr"] for d in oh if acc[d["account_id"]]["segment"] == "MVZ"),
                          sum(d["expected_mrr"] for d in oh))
    m["open_held_n"] = len(oh)
    m["referral_leads"] = m["source"]["referral"]["leads"]
    m["leads"] = len(core)
    return m


def fmt(r, width=17):
    s = f"{r['pct']:5.1f}% (n={r['den']})" if r["den"] else "   -   (n=0)"
    return f"{s:>{width}}"


def eur(x):
    return f"{x:,.0f}".replace(",", ".") if x is not None else "-"


def summary(m):
    print(f"\nLeads (excl. Klinik) {m['leads']} | status {dict(m['status'])} | open by stage {dict(m['open_by_stage'])}")

    print("\nF1 channel leaks (stage conversion on deals that resolved that stage)")
    print(f"{'source':15} {'leads':>5} {'lead->booked':>17} {'booked->held':>17} {'held->won':>17} {'win rate':>17}  MVZ share of leads")
    for src, s in m["source"].items():
        print(f"{src:15} {s['leads']:5} {fmt(s['booked'])} {fmt(s['held'])} {fmt(s['won_after_demo'])} {fmt(s['win_rate'])}  {fmt(s['mvz_share_leads'])}")

    print("\nOutbound reply rate by channel (contacted -> replied)")
    for s, r in m["reply_by_source"].items():
        print(f"  {s:15} {r['num']:4} of {r['den']:5} = {r['pct']:4.1f}%")
    print("Reply rate vs demo booking rate by message (outbound)")
    for msg in C.OUTBOUND_MESSAGES:
        r, b = m["reply_by_message"][msg], m["booking_by_message"][msg]
        print(f"  {msg:28} reply {r['pct']:4.1f}% (n={r['den']})  booked {fmt(b)}")

    print("\nF2 speed to demo: held->won by days from lead to demo held")
    for g, row in m["speed"].items():
        print(f"  {g:9}", " | ".join(f"{k} {fmt(v, 15)}" for k, v in row.items()))

    print("\nF3 message x billing setup: outbound lead->demo booked")
    for msg in C.OUTBOUND_MESSAGES:
        print(f"  {msg:28} external {fmt(m['fit'][(msg, 'external_service')])} | in-house {fmt(m['fit'][(msg, 'in_house')])}")

    print("\nChannel economics (CAC = cost / won, payback = CAC / avg won MRR)")
    print(f"  {'source':15} {'won':>4} {'won MRR':>9} {'avg MRR':>8} {'cost':>8} {'CAC':>7} {'payback':>8}")
    for src in C.ALL_SOURCES:
        s, c = m["source"][src], m["cac"][src]
        pb = f"{c['payback_months']:.1f} mo" if c["payback_months"] else "-"
        print(f"  {src:15} {s['won']:4} {eur(s['won_mrr']):>9} {eur(s['avg_won_mrr']):>8} {eur(c['cost']):>8} {eur(c['cac']):>7} {pb:>8}")
    print(f"Referral leads: {m['referral_leads']}")

    print("\nSegments (closed deals)")
    for seg, s in m["segment"].items():
        print(f"  {seg:7} win rate {fmt(s['win_rate'])}, won {s['won']}, median cycle {s['cycle']}d, "
              f"median won->live {s['to_live']}d, median MRR {s['mrr']}")
    print(f"\nMRR live at {C.AS_OF}: {eur(m['mrr_live'])} EUR, churned subs: {m['churned']}")
    print(f"Won, not live yet: {m['won_not_live'][0]} deals, {eur(m['won_not_live'][1])} EUR MRR")
    print(f"Open at demo held: {m['open_held_n']} deals, MVZ share of their MRR: {fmt(m['open_held'])}")


if __name__ == "__main__":
    trial_seed = int(sys.argv[sys.argv.index("--seed") + 1]) if "--seed" in sys.argv else None
    data = generate(trial_seed if trial_seed is not None else C.SEED)
    summary(metrics(data))
    if trial_seed is not None:
        sys.exit(0)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(to_json(data), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"\nWrote {OUT} ({OUT.stat().st_size // 1024} KB)")
