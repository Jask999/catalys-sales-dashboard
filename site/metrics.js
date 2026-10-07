/* Metrics for the sample sales dashboard.
 *
 * Pure functions: data.json in, numbers out. No DOM, so the same file runs in the browser
 * and in Node (used to check every number against the Python generator's summary).
 * All data is synthetic. Definitions match the "How I'd structure the CRM" section.
 */
(function (root) {
  "use strict";
  const M = {};

  // ------------------------------------------------------------ constants
  M.STAGES = ["lead", "demo_booked", "demo_held", "won"];
  M.STAGE_LABEL = { lead: "Lead", demo_booked: "Demo booked", demo_held: "Demo held", won: "Won" };
  M.STAGE_DATE = { lead: "created_date", demo_booked: "demo_booked_date", demo_held: "demo_held_date", won: "won_date" };
  M.NEXT = { lead: "demo_booked", demo_booked: "demo_held", demo_held: "won" };
  M.SOURCES = ["outbound_email", "outbound_phone", "linkedin", "seo_tools", "website_demo", "sumup", "referral"];
  M.OUTBOUND = ["outbound_email", "outbound_phone", "linkedin"];
  M.SOURCE_LABEL = {
    outbound_email: "Outbound email", outbound_phone: "Outbound phone", linkedin: "LinkedIn",
    seo_tools: "SEO tools", website_demo: "Website “Demo buchen”", sumup: "SumUp partnership",
    referral: "Customer referral",
  };
  M.OUTBOUND_MESSAGES = ["Money in hours, not months", "No percentage cut", "GOÄneu ready", "AI from Befund to invoice"];
  M.TIERS = ["clinc", "catalys lite", "catalys"];

  // Small-n rule: a rate on fewer than SMALL_N deals is flagged, below FEW_N it is hidden.
  M.SMALL_N = 10;
  M.FEW_N = 3;

  // ------------------------------------------------------------ helpers
  const DAY = 86400000;
  M.day = (iso) => Math.round(Date.parse(iso + "T00:00:00Z") / DAY);
  M.iso = (dayNum) => new Date(dayNum * DAY).toISOString().slice(0, 10);
  M.daysBetween = (a, b) => M.day(b) - M.day(a);

  M.median = function (xs) {
    if (!xs.length) return null;
    const s = xs.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  M.sum = (xs) => xs.reduce((a, b) => a + b, 0);

  M.flag = (n) => (n < M.FEW_N ? "few" : n < M.SMALL_N ? "small" : "ok");
  M.rate = function (num, den) {
    return { num, den, pct: den ? (100 * num) / den : null, flag: M.flag(den) };
  };

  // ------------------------------------------------------------ data access
  M.prepare = function (raw) {
    const acc = {};
    raw.accounts.forEach((a) => (acc[a.id] = a));
    const deals = raw.deals.map((d) => Object.assign({}, d, { account: acc[d.account_id] }));
    return {
      meta: raw.meta, accounts: raw.accounts, acc, deals,
      subs: raw.subscriptions.map((s) => Object.assign({}, s, { account: acc[s.account_id] })),
      outreach: raw.outreach,
      asOf: raw.meta.as_of, start: raw.meta.window_start,
    };
  };

  /* Deals for the metrics: no Kliniken (no closed Klinik deals yet), lead created inside the
   * period (cohort view), optional segment. */
  M.cohort = function (data, f) {
    f = f || {};
    return data.deals.filter((d) =>
      d.account.segment !== "Klinik" &&
      (!f.from || d.created_date >= f.from) && (!f.to || d.created_date <= f.to) &&
      (!f.segment || f.segment === "All" || d.account.segment === f.segment));
  };
  M.kliniken = (data) => data.deals.filter((d) => d.account.segment === "Klinik");

  M.reached = (d, stage) => !!d[M.STAGE_DATE[stage]];
  // Did the deal resolve this stage, i.e. move on or get lost there?
  M.resolved = (d, stage) => M.reached(d, M.NEXT[stage]) || d.lost_stage === stage;
  M.closed = (d) => d.status !== "open";

  // ------------------------------------------------------------ funnel and stages
  M.stageConversion = function (deals, stage) {
    const res = deals.filter((d) => M.resolved(d, stage));
    return M.rate(res.filter((d) => M.reached(d, M.NEXT[stage])).length, res.length);
  };

  M.stageTable = function (data, deals) {
    return M.STAGES.map((stage) => {
      const reached = deals.filter((d) => M.reached(d, stage));
      const row = { stage, label: M.STAGE_LABEL[stage], reached: reached.length };
      if (stage === "won") {
        row.mrr = M.sum(reached.map((d) => d.expected_mrr));
        return row;
      }
      row.conversion = M.stageConversion(deals, stage);
      const moved = deals.filter((d) => M.reached(d, M.NEXT[stage]));
      row.medianDays = M.median(moved.map((d) => M.daysBetween(d[M.STAGE_DATE[stage]], d[M.STAGE_DATE[M.NEXT[stage]]])));
      const open = deals.filter((d) => d.status === "open" && d.stage === stage);
      row.open = open.length;
      row.openMrr = M.sum(open.map((d) => d.expected_mrr));
      const reasons = {};
      deals.filter((d) => d.lost_stage === stage).forEach((d) => (reasons[d.lost_reason] = (reasons[d.lost_reason] || 0) + 1));
      const lostN = M.sum(Object.values(reasons));
      const top = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0];
      row.lost = lostN;
      row.topLost = top ? { reason: top[0], n: top[1], share: top[1] / lostN } : null;
      return row;
    });
  };

  // Open deals as dots in the funnel (incl. Kliniken, marked)
  M.openDeals = function (data, f) {
    f = f || {};
    return data.deals.filter((d) => d.status === "open" &&
      (!f.from || d.created_date >= f.from) && (!f.to || d.created_date <= f.to) &&
      (!f.segment || f.segment === "All" || d.account.segment === f.segment || d.account.segment === "Klinik"))
      .map((d) => ({
        id: d.id, stage: d.stage, name: d.account.name, segment: d.account.segment,
        specialty: d.account.specialty, city: d.account.city, source: d.lead_source,
        daysInStage: M.daysBetween(d[M.STAGE_DATE[d.stage]], data.asOf),
        mrr: d.expected_mrr, tier: d.tier, klinik: d.account.segment === "Klinik",
      }));
  };

  // ------------------------------------------------------------ channels, messages, segments
  M.keyFns = {
    source: (d) => d.lead_source,
    message: (d) => d.message,
    segment: (d) => d.account.segment,
    specialty: (d) => d.account.specialty,
  };

  M.groupTable = function (deals, dim) {
    const key = M.keyFns[dim];
    const groups = {};
    deals.forEach((d) => (groups[key(d)] = groups[key(d)] || []).push(d));
    const order = dim === "source" ? M.SOURCES : Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length);
    return order.filter((k) => groups[k]).map((k) => {
      const ds = groups[k];
      const won = ds.filter((d) => d.status === "won");
      const closed = ds.filter(M.closed);
      return {
        key: k, leads: ds.length, won: won.length,
        winRate: M.rate(won.length, closed.length),
        medianCycle: M.median(won.map((d) => M.daysBetween(d.created_date, d.won_date))),
        cycleN: won.length,
        wonMrr: M.sum(won.map((d) => d.expected_mrr)),
        avgWonMrr: won.length ? M.sum(won.map((d) => d.expected_mrr)) / won.length : null,
      };
    });
  };

  M.stageBySource = function (deals) {
    return M.SOURCES.map((s) => {
      const ds = deals.filter((d) => d.lead_source === s);
      return {
        source: s, leads: ds.length,
        lead: M.stageConversion(ds, "lead"),
        demo_booked: M.stageConversion(ds, "demo_booked"),
        demo_held: M.stageConversion(ds, "demo_held"),
        winRate: M.rate(ds.filter((d) => d.status === "won").length, ds.filter(M.closed).length),
      };
    });
  };

  // ------------------------------------------------------------ outreach
  M.outreachRows = (data, f) => data.outreach.filter((r) =>
    (!f || !f.from || r.week_start >= M.iso(M.day(f.from) - 6)) && (!f || !f.to || r.week_start <= f.to));

  M.replyBy = function (data, f, field, keys) {
    const rows = M.outreachRows(data, f);
    return keys.map((k) => {
      const rs = rows.filter((r) => r[field] === k);
      const contacted = M.sum(rs.map((r) => r.contacted));
      const replied = M.sum(rs.map((r) => r.replied));
      return { key: k, contacted, replied, reply: M.rate(replied, contacted) };
    });
  };

  /* Outbound from first contact to demo, per channel, per message and per channel x message.
   * Contacts and replies come from the weekly outreach counts, demos from the deals.
   * Prospecting hours use the assumed minutes per contact (meta.costs). Contacts are counted
   * before the segment is known, so per-contact numbers only make sense for all segments. */
  M.outbound = function (data, deals, f) {
    const mins = data.meta.costs.minutes_per_contact;
    const rows = M.outreachRows(data, f);
    const out = deals.filter((d) => M.OUTBOUND.includes(d.lead_source));
    const cell = (src, msg) => {
      const rs = rows.filter((r) => (!src || r.source === src) && (!msg || r.message === msg));
      const ds = out.filter((d) => (!src || d.lead_source === src) && (!msg || d.message === msg));
      const contacted = M.sum(rs.map((r) => r.contacted));
      const replied = M.sum(rs.map((r) => r.replied));
      const booked = ds.filter((d) => d.demo_booked_date).length;
      const hours = M.sum(rs.map((r) => (r.contacted * mins[r.source]) / 60));
      return {
        contacted, replied, booked, hours,
        reply: M.rate(replied, contacted),
        booking: M.stageConversion(ds, "lead"),
        per100: contacted ? (100 * booked) / contacted : null,
        hoursPerDemo: booked ? hours / booked : null,
      };
    };
    return {
      channels: M.OUTBOUND.map((s) => Object.assign({ key: s }, cell(s, null))),
      all: cell(null, null),
      matrix: M.OUTBOUND.map((s) => ({ key: s, cells: M.OUTBOUND_MESSAGES.map((m) => Object.assign({ key: m }, cell(s, m))) })),
      messages: M.OUTBOUND_MESSAGES.map((m) => Object.assign({ key: m }, cell(null, m))),
    };
  };

  // Booking rate by message for outbound leads (lead -> demo booked)
  M.bookingByMessage = function (deals) {
    return M.OUTBOUND_MESSAGES.map((m) => {
      const ds = deals.filter((d) => d.message === m && M.OUTBOUND.includes(d.lead_source));
      return { key: m, booked: M.stageConversion(ds, "lead") };
    });
  };

  // F3: booking rate by message and billing setup (outbound)
  M.messageFit = function (deals) {
    return M.OUTBOUND_MESSAGES.map((m) => {
      const ds = deals.filter((d) => d.message === m && M.OUTBOUND.includes(d.lead_source));
      return {
        key: m,
        external: M.stageConversion(ds.filter((d) => d.account.billing_setup === "external_service"), "lead"),
        inHouse: M.stageConversion(ds.filter((d) => d.account.billing_setup === "in_house"), "lead"),
      };
    });
  };

  // F2: demo held -> won by days from lead to demo held
  M.SPEED_BUCKETS = [{ key: "7 days or less", lo: 0, hi: 7 }, { key: "8 to 14 days", lo: 8, hi: 14 }, { key: "over 14 days", lo: 15, hi: 1e9 }];
  M.speed = function (deals, filterFn) {
    const ds = deals.filter((d) => (!filterFn || filterFn(d)) && M.resolved(d, "demo_held"));
    return M.SPEED_BUCKETS.map((b) => {
      const bs = ds.filter((d) => { const t = M.daysBetween(d.created_date, d.demo_held_date); return t >= b.lo && t <= b.hi; });
      return { key: b.key, won: M.rate(bs.filter((d) => d.status === "won").length, bs.length) };
    });
  };

  // ------------------------------------------------------------ CAC and payback
  /* CAC per channel = (channel cost + sales hours x hourly rate) / won customers.
   * Payback months = CAC / average MRR of the customers won through that channel.
   * Costs can't be split by segment, so CAC is only computed for all segments. */
  M.cac = function (data, deals, f) {
    const k = data.meta.costs;
    const from = (f && f.from) || data.start, to = (f && f.to) || data.asOf;
    // Fixed monthly costs count for the share of the 6-month window the period covers
    const months = k.window_months * (M.daysBetween(from, to) + 1) / (M.daysBetween(data.start, data.asOf) + 1);
    const outreach = M.outreachRows(data, f);
    return M.SOURCES.map((s) => {
      const ds = deals.filter((d) => d.lead_source === s);
      const won = ds.filter((d) => d.status === "won");
      const booked = ds.filter((d) => d.demo_booked_date).length;
      let cost = booked * k.sales_hours_per_deal_from_demo_booked * k.hourly_rate_eur;
      if (M.OUTBOUND.includes(s)) {
        const contacted = M.sum(outreach.filter((r) => r.source === s).map((r) => r.contacted));
        cost += contacted * k.minutes_per_contact[s] / 60 * k.hourly_rate_eur;
      }
      cost += (k.monthly_fixed_eur[s] || 0) * months;
      cost += (k.fee_per_won_eur[s] || 0) * won.length;
      const avgMrr = won.length ? M.sum(won.map((d) => d.expected_mrr)) / won.length : null;
      const cac = won.length ? cost / won.length : null;
      return { source: s, cost, won: won.length, cac, avgMrr, payback: cac && avgMrr ? cac / avgMrr : null, flag: M.flag(won.length) };
    });
  };

  // ------------------------------------------------------------ revenue
  M.mrrAt = function (subs, iso) {
    const out = { total: 0 };
    M.TIERS.forEach((t) => (out[t] = 0));
    subs.forEach((s) => {
      if (s.start_date <= iso && (!s.end_date || s.end_date > iso)) { out[s.tier] += s.mrr; out.total += s.mrr; }
    });
    return out;
  };

  M.segSubs = (data, f) => data.subs.filter((s) => !f || !f.segment || f.segment === "All" || s.account.segment === f.segment);

  // MRR on each Monday plus the as-of date, by tier
  M.mrrSeries = function (data, f) {
    const subs = M.segSubs(data, f);
    const pts = [];
    let d = M.day(data.start);
    while (new Date(d * DAY).getUTCDay() !== 1) d++;
    for (; d < M.day(data.asOf); d += 7) pts.push(M.iso(d));
    pts.push(data.asOf);
    return pts.map((iso) => Object.assign({ date: iso }, M.mrrAt(subs, iso)));
  };

  M.revenueKpis = function (data, f) {
    const subs = M.segSubs(data, f);
    const live = subs.filter((s) => !s.end_date);
    const deals = M.cohort(data, { segment: f && f.segment });
    const wnl = deals.filter((d) => d.status === "won" && d.go_live_date > data.asOf);
    const toLive = deals.filter((d) => d.status === "won").map((d) => M.daysBetween(d.won_date, d.go_live_date));
    const churned = subs.filter((s) => s.end_date);
    const customerMonths = M.sum(subs.map((s) => M.daysBetween(s.start_date, s.end_date || data.asOf))) / (365.25 / 12);
    return {
      mrr: M.sum(live.map((s) => s.mrr)), customers: live.length,
      wonNotLive: wnl.length, wonNotLiveMrr: M.sum(wnl.map((d) => d.expected_mrr)),
      medianToLive: M.median(toLive), toLiveN: toLive.length,
      churned: churned.length, churnedMrr: M.sum(churned.map((s) => s.mrr)),
      everLive: subs.length, customerMonths,
      monthlyChurn: customerMonths ? churned.length / customerMonths : null,
    };
  };

  /* Q4 forecast: MRR on 31 Dec =
   *   live MRR on the as-of date
   * + won deals going live by 31 Dec
   * + open deals x win probability, if their expected go-live is by 31 Dec
   * - expected churn on today's live MRR over 3 months (observed monthly churn rate).
   * Win probability depends on the stage AND how long the deal has sat there: of the past
   * (closed) deals that were still undecided after that many days in the stage, the share
   * that was won. Old deals that stall are less likely to close, so they count for less.
   * If fewer than 5 past deals were that old, the oldest group with at least 5 is used.
   * Expected go-live = stage entry + median days from that stage to won (won deals),
   * at least one week from now, plus the median won-to-live time. Kliniken are left out. */
  M.forecast = function (data, f) {
    const end = "2026-12-31";
    const all = M.cohort(data, {});
    const scope = M.cohort(data, { segment: f && f.segment });
    const won = all.filter((d) => d.status === "won");
    const closed = all.filter(M.closed);
    const prob = {}, remaining = {};
    ["lead", "demo_booked", "demo_held"].forEach((s) => {
      const c = closed.filter((d) => M.reached(d, s));
      prob[s] = M.rate(c.filter((d) => d.status === "won").length, c.length);
      remaining[s] = M.median(won.map((d) => M.daysBetween(d[M.STAGE_DATE[s]], d.won_date)));
    });
    // Win probability for a deal that has been in `stage` for `age` days
    const winProbAt = function (stage, age) {
      const past = closed.filter((d) => M.reached(d, stage) && M.resolved(d, stage));
      const timeIn = (d) => M.daysBetween(d[M.STAGE_DATE[stage]], d[M.STAGE_DATE[M.NEXT[stage]]] || d.lost_date);
      let a = age, older = past.filter((d) => timeIn(d) > a);
      while (older.length < 5 && a > 0) { a -= 1; older = past.filter((d) => timeIn(d) > a); }
      return M.rate(older.filter((d) => d.status === "won").length, older.length);
    };
    const toLive = M.median(won.map((d) => M.daysBetween(d.won_date, d.go_live_date)));
    const asOf = M.day(data.asOf);

    const open = scope.filter((d) => d.status === "open").map((d) => {
      const expWon = Math.max(M.day(d[M.STAGE_DATE[d.stage]]) + remaining[d.stage], asOf + 7);
      const expLive = expWon + toLive;
      const inQ4 = expLive <= M.day(end);
      const age = M.daysBetween(d[M.STAGE_DATE[d.stage]], data.asOf);
      const p = winProbAt(d.stage, age);
      return { deal: d, age, p: p.pct / 100, pN: p.den, expLive: M.iso(expLive), inQ4, weighted: inQ4 ? d.expected_mrr * p.pct / 100 : 0 };
    });
    const k = M.revenueKpis(data, f);
    const wnl = scope.filter((d) => d.status === "won" && d.go_live_date > data.asOf && d.go_live_date <= end);
    const rateAll = M.revenueKpis(data, {}).monthlyChurn || 0;
    const churn = k.mrr * (1 - Math.pow(1 - rateAll, 3));
    const pipeline = M.sum(open.map((o) => o.weighted));
    const wnlMrr = M.sum(wnl.map((d) => d.expected_mrr));

    const mvzOpen = open.filter((o) => o.deal.account.segment === "MVZ" && o.inQ4).sort((a, b) => b.weighted - a.weighted);
    const top3 = mvzOpen.slice(0, 3);
    return {
      start: k.mrr, wonNotLive: wnlMrr, wonNotLiveN: wnl.length, pipeline, churn, monthlyChurn: rateAll,
      end: k.mrr + wnlMrr + pipeline - churn,
      prob, remaining, toLive, open, winProbAt,
      pipelineMvzShare: pipeline ? M.sum(open.filter((o) => o.deal.account.segment === "MVZ").map((o) => o.weighted)) / pipeline : 0,
      top3Mvz: top3.map((o) => ({ name: o.deal.account.name, mrr: o.deal.expected_mrr, weighted: o.weighted })),
      withoutTop3: k.mrr + wnlMrr + pipeline - M.sum(top3.map((o) => o.weighted)) - churn,
      openInQ4: open.filter((o) => o.inQ4).length, openN: open.length,
    };
  };

  // ------------------------------------------------------------ findings (always full window, all segments)
  M.findings = function (data) {
    const deals = M.cohort(data, {});
    const bySrc = {};
    M.stageBySource(deals).forEach((r) => (bySrc[r.source] = r));
    const others = (stage, s) => M.SOURCES.filter((x) => x !== s && bySrc[x][stage].den >= M.SMALL_N).map((x) => bySrc[x][stage].pct);
    const fit = {};
    M.messageFit(deals).forEach((r) => (fit[r.key] = r));
    return {
      f1: {
        bySource: bySrc,
        emailBook: bySrc.outbound_email.lead,
        emailAfterDemo: bySrc.outbound_email.demo_held,
        bookOthersMin: Math.min(...others("lead", "outbound_email").filter((x) => x < 100)),
        bookOthersMax: Math.max(...others("lead", "outbound_email").filter((x) => x < 100)),
        seoAfterDemo: bySrc.seo_tools.demo_held,
        seoBook: bySrc.seo_tools.lead,
        afterDemoOthersMin: Math.min(...others("demo_held", "seo_tools")),
        sumup: bySrc.sumup,
      },
      f2: {
        all: M.speed(deals),
        outbound: M.speed(deals, (d) => M.OUTBOUND.includes(d.lead_source)),
        inbound: M.speed(deals, (d) => !M.OUTBOUND.includes(d.lead_source)),
      },
      f3: {
        fit: M.messageFit(deals),
        noCut: fit["No percentage cut"],
        money: fit["Money in hours, not months"],
        reply: M.replyBy(data, null, "message", M.OUTBOUND_MESSAGES),
        booking: M.bookingByMessage(deals),
      },
      kliniken: M.kliniken(data),
    };
  };

  if (typeof module !== "undefined" && module.exports) module.exports = M;
  else root.Metrics = M;
})(this);
