"""Check how often each planted pattern shows up across many seeds, and suggest a seed.

Run:  python3 generator/check_seeds.py [n_seeds]   (default 400)

The patterns are probabilities in config.py, so with a few hundred leads, noise sometimes
hides them. This script reports how often each one holds on its own. Then it lists the seeds
where F1, F2 and F3 all show clearly with no extreme values, and suggests the one closest to
the typical (median) seed, so the chosen data is representative rather than the most dramatic.
"""
import sys
from statistics import median, pstdev

import config as C
from generate import generate, metrics


def pct(r):
    return r["pct"] if r["den"] else None


def patterns(m):
    src = m["source"]
    ok_den = lambda key: {s: pct(v[key]) for s, v in src.items() if v[key]["den"] >= 5}
    booked, after_demo = ok_den("booked"), ok_den("won_after_demo")
    sp, fit = m["speed"], m["fit"]
    ext = {msg: pct(fit[(msg, "external_service")]) or 0 for msg in C.OUTBOUND_MESSAGES}
    inh = {msg: pct(fit[(msg, "in_house")]) or 0 for msg in C.OUTBOUND_MESSAGES}
    reply = {s: m["reply_by_source"][s]["pct"] for s in C.OUTBOUND_SOURCES}
    reply_msg = {k: v["pct"] for k, v in m["reply_by_message"].items()}
    book_msg = {k: v["pct"] or 0 for k, v in m["booking_by_message"].items()}

    def pooled_avg_mrr(sources):
        won = sum(src[s]["won"] for s in sources)
        return sum(src[s]["won_mrr"] for s in sources) / won if won else 0

    sumup = src["sumup"]
    f2 = [pct(sp["all"][k]) for k in ("<=7d", "8-14d", ">14d")]
    f2o = [pct(sp["outbound"][k]) for k in ("<=7d", ">14d")]
    p = {
        "F1a email weakest at lead -> booked": min(booked, key=booked.get) == "outbound_email",
        "F1b SEO weakest at demo held -> won": "seo_tools" in after_demo and min(after_demo, key=after_demo.get) == "seo_tools",
        "F1c SumUp steady at every stage": all(x is not None for x in (pct(sumup["booked"]), pct(sumup["held"]), pct(sumup["won_after_demo"])))
        and pct(sumup["booked"]) >= 50 and pct(sumup["held"]) >= 75 and pct(sumup["won_after_demo"]) >= 45,
        "F2 faster demo wins more (all)": None not in f2 and f2[0] > f2[1] > f2[2],
        "F2 holds within outbound": None not in f2o and f2o[0] > f2o[1],
        "F3 'No percentage cut' best for external": max(ext, key=ext.get) == "No percentage cut",
        "F3 'Money in hours' best for in-house": max(inh, key=inh.get) == "Money in hours, not months",
        "Reply rates inside assumed ranges": 3 <= reply["outbound_email"] <= 5 and 6 <= reply["linkedin"] <= 8
        and 10 <= reply["outbound_phone"] <= 15,
        "Top reply message is not top booking message": max(reply_msg, key=reply_msg.get) != max(book_msg, key=book_msg.get),
        "Phone/LinkedIn win bigger customers than SEO/website/SumUp":
            pooled_avg_mrr(["outbound_phone", "linkedin"]) > pooled_avg_mrr(["seo_tools", "website_demo", "sumup"]),
        "Referral leads 5 to 10": 5 <= m["referral_leads"] <= 10,
        "CAC defined (>= 2 wins, SEO >= 1)": all(src[s]["won"] >= (1 if s == "seo_tools" else 2)
                                                 for s in C.ALL_SOURCES if s != "referral"),
    }
    p["F1 all three"] = p["F1a email weakest at lead -> booked"] and p["F1b SEO weakest at demo held -> won"] \
        and p["F1c SumUp steady at every stage"]
    p["F2 both"] = p["F2 faster demo wins more (all)"] and p["F2 holds within outbound"]
    p["F3 both"] = p["F3 'No percentage cut' best for external"] and p["F3 'Money in hours' best for in-house"]

    # Clear and not extreme
    def second(d, top):
        return max(v for k, v in d.items() if k != top)
    # Clear and not extreme: the three findings show with a margin, no cell is extreme,
    # CAC is defined for every main channel, and the small-n areas are not empty
    clear = (
        p["F1 all three"] and p["F2 both"] and p["F3 both"]
        and booked["outbound_email"] <= 0.85 * min(v for k, v in booked.items() if k != "outbound_email")
        and after_demo["seo_tools"] <= 0.85 * min(v for k, v in after_demo.items() if k != "seo_tools")
        and 15 <= f2[0] - f2[2] <= 45 and sp["all"][">14d"]["den"] >= 5
        and ext["No percentage cut"] >= 1.2 * second(ext, "No percentage cut")
        and inh["Money in hours, not months"] >= 1.1 * second(inh, "Money in hours, not months")
        and all(v > 0 for v in list(ext.values()) + list(inh.values()))
        and all(pct(v["won_after_demo"]) <= 65 for v in src.values() if v["won_after_demo"]["den"] >= 8)
        and p["CAC defined (>= 2 wins, SEO >= 1)"] and m["referral_leads"] >= 3
        and m["segment"]["MVZ"]["won"] >= 2 and m["churned"] >= 1 and m["won_not_live"][0] >= 2
    )
    return p, clear


def key_stats(m):
    src, fit = m["source"], m["fit"]
    return [
        m["status"]["won"], m["mrr_live"], m["segment"]["MVZ"]["won"],
        pct(src["outbound_email"]["booked"]) or 0, pct(src["seo_tools"]["won_after_demo"]) or 0,
        pct(src["sumup"]["win_rate"]) or 0,
        pct(m["speed"]["all"]["<=7d"]) or 0, pct(m["speed"]["all"][">14d"]) or 0,
        pct(fit[("No percentage cut", "external_service")]) or 0, pct(fit[("No percentage cut", "in_house")]) or 0,
        pct(fit[("Money in hours, not months", "in_house")]) or 0,
        pct(fit[("Money in hours, not months", "external_service")]) or 0,
    ]


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 400
    counts, clear_seeds, stats = {}, [], {}
    for seed in range(1, n + 1):
        m = metrics(generate(seed))
        p, clear = patterns(m)
        for k, v in p.items():
            counts[k] = counts.get(k, 0) + bool(v)
        stats[seed] = key_stats(m)
        if clear:
            clear_seeds.append(seed)

    print(f"How often each pattern holds across {n} seeds:")
    for k, v in counts.items():
        print(f"  {k:58} {100 * v / n:5.1f}%")

    cols = list(zip(*stats.values()))
    med = [median(c) for c in cols]
    sd = [pstdev(c) or 1 for c in cols]
    dist = lambda s: sum(((x - mm) / ss) ** 2 for x, mm, ss in zip(stats[s], med, sd)) ** 0.5
    ranked = sorted(clear_seeds, key=dist)
    print(f"\nSeeds with F1, F2, F3 clear and no extreme values: {len(clear_seeds)} of {n}")
    print("Closest to the typical seed:", [(s, round(dist(s), 2)) for s in ranked[:8]])
