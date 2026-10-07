/* Sales Befund: rendering. All numbers come from metrics.js; this file only draws them. */
(function () {
  "use strict";
  const M = window.Metrics;

  // ------------------------------------------------------------ tokens and formatting
  const C = {
    ink: "#14212b", ink2: "#5b6b77", ink3: "#8996a0", rule: "#dde3e8", rule2: "#eef2f5",
    brand: "#005696", brand2: "#3f7fb5", brand3: "#8db8dd", context: "#b8c3cc", surface: "#ffffff",
  };
  const TIER_COLOR = { clinc: C.brand3, "catalys lite": C.brand2, catalys: C.brand };
  const FONT = '"Public Sans", system-ui, sans-serif';
  const PERIODS = {
    all: { from: "2026-04-01", to: "2026-09-30", label: "April to September" },
    q2: { from: "2026-04-01", to: "2026-06-30", label: "Q2 (April to June)" },
    q3: { from: "2026-07-01", to: "2026-09-30", label: "Q3 (July to September)" },
  };
  const state = { period: "all", segment: "All", group: "source", omx: "reply" };
  let findings = [], currentFinding = 0;
  const charts = {};
  let data, F;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (x) => Math.round(x).toLocaleString("en-GB");
  const eur = (x) => (x < 0 ? "-" : "") + "€" + num(Math.abs(x));
  const pct = (r) => (r.pct === null ? "n/a" : Math.round(r.pct) + "%");
  const pctN = (x) => Math.round(x) + "%";
  const days = (d) => (d === null || d === undefined ? "n/a" : Math.round(d) + " days");
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmtDate = (iso) => `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]}`;
  const label = (k) => M.SOURCE_LABEL[k] || k;
  const $ = (id) => document.getElementById(id);

  function filt() {
    const p = PERIODS[state.period];
    return { from: p.from, to: p.to, segment: state.segment };
  }

  // A rate with its n, following the small-n rule
  function rateHtml(r, opts) {
    opts = opts || {};
    if (r.flag === "few") return `<span class="few">too few (n=${r.den})</span>`;
    const tag = r.flag === "small" ? '<span class="tag">small n</span>' : "";
    return `${pct(r)} <span class="n">n=${r.den}</span>${tag}`;
  }
  function barRate(r, max) {
    if (r.flag === "few") return `<td class="bar-cell"><span class="few">too few (n=${r.den})</span></td>`;
    const w = Math.max(2, Math.round((r.pct / (max || 100)) * 100));
    const cls = r.flag === "small" ? "bar-cell flag-small" : "bar-cell";
    const tag = r.flag === "small" ? '<span class="tag">small n</span>' : "";
    return `<td class="${cls}"><span class="barwrap">${pct(r)} <span class="n">n=${r.den}</span>${tag}<span class="bar"><i style="width:${w}%"></i></span></span></td>`;
  }
  // A value that rests on n deals (e.g. median cycle on won deals)
  function nValue(text, n) {
    const f = M.flag(n);
    if (f === "few") return `<span class="few">too few (n=${n})</span>`;
    return `${text} <span class="n">n=${n}</span>${f === "small" ? '<span class="tag">small n</span>' : ""}`;
  }

  function chart(id) {
    const el = $(id);
    if (charts[id] && charts[id].getDom() !== el) { charts[id].dispose(); delete charts[id]; }
    if (!charts[id]) charts[id] = echarts.init(el, null, { renderer: "svg" });
    return charts[id];
  }
  const baseText = { fontFamily: FONT, color: C.ink2, fontSize: 12 };
  const tooltipBase = {
    backgroundColor: C.ink, borderWidth: 0, padding: [8, 10],
    textStyle: { color: "#fff", fontFamily: FONT, fontSize: 12 }, extraCssText: "border-radius:6px;",
  };

  // Sequential brand ramp for the heatmap: 0% light, 100% brand
  function heatColor(p) {
    const a = [238, 245, 251], b = [0, 86, 150];
    const t = Math.max(0, Math.min(1, p / 100));
    return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
  }

  // ------------------------------------------------------------ findings (full data, all segments)
  function renderFindings() {
    const f1 = F.f1, s = f1.bySource;
    const f2 = F.f2, f3 = F.f3;
    const topReply = f3.reply.slice().sort((a, b) => b.reply.pct - a.reply.pct)[0];
    const topReplyBooking = f3.booking.find((b) => b.key === topReply.key).booked;
    const bestBooking = f3.booking.slice().sort((a, b) => b.booked.pct - a.booked.pct)[0];

    findings = [
      {
        title: "Each channel loses deals at a different stage, so one win rate per channel hides what to fix",
        evidence: `Outbound email loses most deals at the very first step: only ${pct(f1.emailBook)} of email replies book a demo (n=${f1.emailBook.den}), against ${pctN(f1.bookOthersMin)} to ${pctN(f1.bookOthersMax)} for the other channels. SEO leads leak at the other end. ${pct(f1.seoBook)} of them book a demo, but only ${pct(f1.seoAfterDemo)} of SEO demos end in a contract (n=${f1.seoAfterDemo.den}), the lowest of any channel. SumUp leads move steadily: ${pct(s.sumup.lead)} book, ${pct(s.sumup.demo_booked)} show up, ${pct(s.sumup.demo_held)} sign.`,
        rec: "Fix each channel where it leaks. For email, that means the targeting and the first message, not the demo. For SEO, ask one qualifying question before offering a demo slot (practice size and share of private patients), so demo time goes to practices that are ready to buy.",
        checks: [
          "Are the dates of each stage stored per deal, so conversion can be measured stage by stage and not only as won or lost?",
          "Is the lead source the first touch, or does it get overwritten by the last one?",
          "How many SEO demos end with “just researching” or “price” as the lost reason?",
        ],
        visual: f1Visual,
      },
      {
        title: "Deals that reach a demo within a week win far more often",
        evidence: `${pct(f2.all[0].won)} of deals with a demo within 7 days of first contact were won (n=${f2.all[0].won.den}), against ${pct(f2.all[1].won)} at 8 to 14 days and ${pct(f2.all[2].won)} after more than two weeks (n=${f2.all[2].won.den}). The pattern holds within outbound alone (${pct(f2.outbound[0].won)} against ${pct(f2.outbound[2].won)}), so it isn't only fast SumUp and website leads. This is a correlation: a keen practice books fast and also buys. But speed is the part sales controls.`,
        rec: "Offer a demo slot within one working day of every reply, and put a booking link in every outbound message. Track the median days from first reply to demo as a weekly number next to the pipeline.",
        checks: [
          "The median days from first reply to demo in the real data, per channel.",
          "Is the date of the first reply stored, or only the date the deal was created in the CRM?",
          "Do fast deals still win more when you compare within one segment or specialty?",
        ],
        visual: f2Visual,
      },
      {
        title: "The best message depends on how the practice bills today",
        evidence: `“No percentage cut” books a demo with ${pct(f3.noCut.external)} of practices that use an external billing service (n=${f3.noCut.external.den}), but with only ${pct(f3.noCut.inHouse)} of practices that bill in-house (n=${f3.noCut.inHouse.den}). “Money in hours, not months” works the other way round: ${pct(f3.money.inHouse)} in-house against ${pct(f3.money.external)} external. And the message with the most replies, “${esc(topReply.key)}” (${pct(topReply.reply)} reply rate), books a demo with only ${pct(topReplyBooking)} of the practices that reply.`,
        rec: "Make billing setup (in-house or external service) a required field at the lead stage, ask for it in the first conversation, and choose the message by it. Judge messages by demos booked, not by replies.",
        checks: [
          "Is billing setup recorded anywhere today? Even a free-text note would let us fill it in for past deals.",
          "Reply rate and demo booking rate per message and segment for the last three months.",
          "Which messages do the best reps actually use on the phone, and does that match the email copy?",
        ],
        visual: f3Visual,
      },
    ];

    showFinding(0);

    const k = F.kliniken;
    const booked = k.filter((d) => d.stage === "demo_booked").length;
    $("klinik-note").innerHTML = `
      <summary>Kliniken: ${k.length} early conversations</summary>
      <p>${k.length} Kliniken are talking to sales, ${booked} of them with a demo booked. They are left out of every rate on this page: no Klinik deal has closed yet, and the sales motion is different, with several departments, legacy IT and an integration set up on site by Forward Deployed Engineers. I would track them in their own pipeline with their own stages (for example technical assessment and pilot department) instead of mixing them into the practice funnel.</p>`;
  }

  // One finding at a time in the findings panel
  function showFinding(i) {
    currentFinding = i;
    const f = findings[i];
    document.querySelectorAll("#fswitch button").forEach((b, j) => {
      b.setAttribute("aria-selected", String(j === i));
      b.tabIndex = j === i ? 0 : -1;
    });
    $("findings-list").innerHTML = `
      <article class="finding" role="tabpanel" aria-labelledby="ftoggle-${i}">
        <p class="finding-num">Finding ${i + 1} of ${findings.length}</p>
        <h3>${esc(f.title)}</h3>
        <p class="evidence">${f.evidence}</p>
        <div class="visual" id="f-visual"></div>
        <div class="rec"><strong>Recommendation</strong>${esc(f.rec)}</div>
        <div class="checks"><strong>What I'd check in the real CRM</strong><ul>${f.checks.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div>
      </article>`;
    f.visual($("f-visual"));
    $("fbody").scrollTop = 0;
  }

  function f1Visual(el) {
    const rows = M.SOURCES.map((s) => F.f1.bySource[s]);
    const leak = { outbound_email: "lead", seo_tools: "demo_held" };
    const cell = (r, stage) => {
      const x = r[stage];
      const isLeak = leak[r.source] === stage;
      if (r.source === "website_demo" && stage === "lead") return `<td class="dim">starts at demo<span class="n">booked online</span></td>`;
      if (x.flag === "few") return `<td class="dim">too few<span class="n">n=${x.den}</span></td>`;
      const bg = heatColor(x.pct), fg = x.pct > 55 ? "#fff" : C.ink;
      const small = x.flag === "small" ? ' style="outline:1px dashed ' + C.ink3 + ';outline-offset:-3px;background:' + bg + ";color:" + fg + '"' : ` style="background:${bg};color:${fg}"`;
      return `<td${small} class="${isLeak ? "leak" : ""}">${pct(x)}<span class="n">n=${x.den}</span></td>`;
    };
    el.innerHTML = `
      <p class="visual-title">Stage conversion by channel</p>
      <p class="visual-sub">Share of deals that moved on, of those that left the stage. Outlined: the leak each finding is about. Dashed: fewer than ${M.SMALL_N} deals.</p>
      <table class="heat">
        <thead><tr><th></th><th>Lead to demo booked</th><th>Booked to held</th><th>Demo to won</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><th scope="row">${esc(label(r.source))}</th>${cell(r, "lead")}${cell(r, "demo_booked")}${cell(r, "demo_held")}</tr>`).join("")}</tbody>
      </table>`;
  }

  function f2Visual(el) {
    el.innerHTML = `<p class="visual-title">Won after the demo, by days from first contact to demo</p>
      <p class="visual-sub">Deals that reached a decision after the demo</p><div class="chart" id="c-f2" role="img" aria-label="Win rate after demo by days to demo"></div>`;
    const cats = M.SPEED_BUCKETS.map((b) => b.key);
    const series = [
      { name: "All channels", data: F.f2.all, color: C.brand },
      { name: "Outbound only", data: F.f2.outbound, color: C.brand3 },
    ];
    chart("c-f2").setOption({
      textStyle: { fontFamily: FONT },
      grid: { left: 8, right: 8, top: 36, bottom: 8, containLabel: true },
      legend: { top: 0, left: 0, itemWidth: 12, itemHeight: 12, textStyle: baseText, icon: "roundRect" },
      tooltip: Object.assign({}, tooltipBase, {
        trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(20,33,43,0.05)" } },
        formatter: (ps) => `<b>${ps[0].axisValue}</b><br>` + ps.map((p) => {
          const r = series[p.seriesIndex].data[p.dataIndex].won;
          return `${p.marker}${p.seriesName}: ${pct(r)} (${r.num} of ${r.den})${r.flag !== "ok" ? ", small n" : ""}`;
        }).join("<br>"),
      }),
      xAxis: { type: "category", data: cats, axisTick: { show: false }, axisLine: { lineStyle: { color: C.rule } }, axisLabel: baseText },
      yAxis: { type: "value", max: 100, interval: 25, axisLabel: Object.assign({}, baseText, { formatter: "{value}%" }), splitLine: { lineStyle: { color: C.rule2 } } },
      series: series.map((s) => ({
        name: s.name, type: "bar", barMaxWidth: 34, barGap: "12%",
        itemStyle: { color: s.color, borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: "top", fontFamily: FONT, fontSize: 12, color: C.ink, formatter: (p) => pct(s.data[p.dataIndex].won) },
        data: s.data.map((d) => d.won.pct),
      })),
    });
  }

  function f3Visual(el) {
    el.innerHTML = `<p class="visual-title">Demo booking rate by message and billing setup</p>
      <p class="visual-sub">Outbound replies that booked a demo</p><div class="chart" id="c-f3" role="img" aria-label="Demo booking rate by message for external and in-house billing"></div>`;
    const rows = F.f3.fit.slice().reverse();
    const cats = rows.map((r) => r.key);
    chart("c-f3").setOption({
      textStyle: { fontFamily: FONT },
      grid: { left: 8, right: 24, top: 36, bottom: 8, containLabel: true },
      legend: { top: 0, left: 0, itemWidth: 10, itemHeight: 10, textStyle: baseText, data: ["External billing service", "Bills in-house"] },
      tooltip: Object.assign({}, tooltipBase, {
        trigger: "item",
        formatter: (p) => {
          if (p.seriesType !== "scatter") return "";
          const r = rows[p.dataIndex][p.seriesName === "External billing service" ? "external" : "inHouse"];
          return `<b>${esc(p.name)}</b><br>${p.seriesName}: ${pct(r)} (${r.num} of ${r.den})`;
        },
      }),
      xAxis: { type: "value", max: 80, interval: el.clientWidth < 420 ? 40 : 20, axisLabel: Object.assign({}, baseText, { formatter: "{value}%" }), splitLine: { lineStyle: { color: C.rule2 } } },
      yAxis: { type: "category", data: cats, axisTick: { show: false }, axisLine: { show: false }, axisLabel: Object.assign({}, baseText, { color: C.ink, width: 150, overflow: "break" }) },
      series: [
        {
          type: "lines", coordinateSystem: "cartesian2d", silent: true, lineStyle: { color: C.context, width: 2, opacity: 1 },
          data: rows.map((r) => ({ coords: [[r.external.pct, r.key], [r.inHouse.pct, r.key]] })),
        },
        {
          name: "External billing service", type: "scatter", symbolSize: 13, z: 3,
          itemStyle: { color: C.brand, borderColor: C.surface, borderWidth: 2 },
          data: rows.map((r) => [r.external.pct, r.key]),
        },
        {
          name: "Bills in-house", type: "scatter", symbolSize: 13, z: 3,
          itemStyle: { color: C.brand3, borderColor: C.surface, borderWidth: 2 },
          data: rows.map((r) => [r.inHouse.pct, r.key]),
        },
      ],
    });
  }

  // ------------------------------------------------------------ pipeline
  function renderPipeline() {
    const f = filt();
    const deals = M.cohort(data, f);
    const rows = M.stageTable(data, deals);
    const open = M.openDeals(data, f);
    const won = deals.filter((d) => d.status === "won");
    const cycle = M.median(won.map((d) => M.daysBetween(d.created_date, d.won_date)));

    $("pipeline-intro").textContent = `${num(deals.length)} leads created ${PERIODS[state.period].label}${state.segment !== "All" ? ", " + state.segment + " only" : ""}. Each stage shows how many deals reached it and what happened next. Dots are deals that are still open on 30 September, at their current stage.`;

    $("stage-list").innerHTML = rows.map((r) => {
      if (r.stage === "won") {
        return `<div class="stage" data-stage="won"><h3><span>${r.label}</span><span class="count">${num(r.reached)}</span></h3>
          <dl><dt>Won MRR</dt><dd>${eur(r.mrr)}</dd>
          <dt>Median cycle</dt><dd>${nValue(days(cycle), won.length)}</dd>
          <dt>Lead to won</dt><dd>${rateHtml(M.rate(won.length, deals.filter(M.closed).length))} of closed deals</dd></dl></div>`;
      }
      const top = r.topLost ? `${esc(r.topLost.reason)} <span class="n">${r.topLost.n} of ${r.lost}</span>` : "none yet";
      return `<div class="stage" data-stage="${r.stage}"><h3><span>${r.label}</span><span class="count">${num(r.reached)}</span></h3>
        <dl><dt>Moved on</dt><dd>${rateHtml(r.conversion)}</dd>
        <dt>Median days to next stage</dt><dd>${days(r.medianDays)}</dd>
        <dt>Open now</dt><dd>${r.open} deals, ${eur(r.openMrr)} expected MRR</dd>
        <dt>Top lost reason</dt><dd>${top}</dd></dl></div>`;
    }).join("");

    drawFunnel(rows, open);
    renderOpenTable(open);
  }

  let lastFunnel = null, funnelGlobalsBound = false;
  function drawFunnel(rows, open) {
    lastFunnel = { rows, open };
    const svg = $("funnel");
    const W = svg.parentNode.clientWidth - 24;
    const stacked = window.matchMedia("(max-width: 859px)").matches;
    const stageEls = Array.from(document.querySelectorAll("#stage-list .stage"));
    const max0 = rows[0].reached || 1;
    const openCount = (s) => open.filter((d) => d.stage === s).length;
    const mobileHeight = (r, i) => {
      if (r.stage === "won") return 56;
      const wMid = W * Math.max(0.22, ((r.reached + rows[i + 1].reached) / 2) / max0) - 28;
      const perRow = Math.max(1, Math.floor(wMid / 14));
      return Math.max(72, 44 + Math.ceil(openCount(r.stage) / perRow) * 14 + 14);
    };
    const heights = stacked ? rows.map(mobileHeight)
      : stageEls.map((e) => Math.max(e.getBoundingClientRect().height, 96));
    const H = heights.reduce((a, b) => a + b, 0);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("height", H);

    const max = rows[0].reached || 1;
    const minFrac = 0.22;
    const widthOf = (n) => W * Math.max(minFrac, n / max);
    const cx = W / 2;
    let y = 0, out = `<title id="funnel-title">Funnel from lead to won, with open deals as dots</title>`;
    const dotsByStage = { lead: [], demo_booked: [], demo_held: [] };
    open.forEach((d) => dotsByStage[d.stage] && dotsByStage[d.stage].push(d));

    rows.forEach((r, i) => {
      const h = heights[i], gap = 3;
      const wTop = widthOf(r.reached);
      const wBot = r.stage === "won" ? wTop : widthOf(rows[i + 1].reached);
      const x0 = cx - wTop / 2, x1 = cx + wTop / 2, x2 = cx + wBot / 2, x3 = cx - wBot / 2;
      const yb = y + h - gap;
      const isWon = r.stage === "won";
      out += `<path class="band${isWon ? " won" : ""}" d="M${x0},${y} L${x1},${y} L${x2},${yb} L${x3},${yb} Z"/>`;
      if (isWon) {
        out += `<text class="band-label won-text" x="${cx}" y="${y + h / 2 + 4}" text-anchor="middle">Won <tspan class="won-text" font-weight="600">${num(r.reached)}</tspan></text>`;
      } else {
        if (wTop < 260) {
          out += `<text class="band-label" x="${cx}" y="${y + 20}" text-anchor="middle">${r.label} <tspan class="band-count">${num(r.reached)}</tspan></text>`;
        } else {
          out += `<text class="band-label" x="${x0 + 12}" y="${y + 20}">${r.label}</text>`;
          out += `<text class="band-count" x="${x1 - 12}" y="${y + 20}" text-anchor="end">${num(r.reached)}</text>`;
        }
        // Pack open-deal dots in rows inside the band, oldest first
        const ds = dotsByStage[r.stage].sort((a, b) => b.daysInStage - a.daysInStage);
        const step = 14, top = y + 36, bottom = yb - 10;
        let k = 0;
        for (let yy = top; yy <= bottom && k < ds.length; yy += step) {
          const t = (yy - y) / (yb - y);
          const half = (wTop + (wBot - wTop) * t) / 2 - 14;
          const n = Math.max(1, Math.floor((2 * half) / step));
          const startX = cx - ((n - 1) * step) / 2;
          for (let j = 0; j < n && k < ds.length; j++, k++) {
            const d = ds[k];
            const x = startX + j * step;
            const cls = d.klinik ? "klinik" : d.segment === "MVZ" ? "mvz" : "praxis";
            const shape = d.klinik
              ? `<rect class="dot ${cls}" x="${x - 5}" y="${yy - 5}" width="10" height="10" transform="rotate(45 ${x} ${yy})" data-id="${d.id}" tabindex="-1"/>`
              : `<circle class="dot ${cls}" cx="${x}" cy="${yy}" r="${d.segment === "MVZ" ? 6 : 5}" data-id="${d.id}" tabindex="-1"/>`;
            out += shape;
          }
        }
        if (k < ds.length) out += `<text class="band-label" x="${cx}" y="${bottom + 4}" text-anchor="middle">+${ds.length - k} more</text>`;
      }
      y += h;
    });
    svg.innerHTML = out;

    const byId = {};
    open.forEach((d) => (byId[d.id] = d));
    const tip = $("tip");
    const show = (target, evt) => {
      const d = byId[target.getAttribute("data-id")];
      if (!d) return;
      svg.querySelectorAll(".dot.active").forEach((e) => e.classList.remove("active"));
      target.classList.add("active");
      tip.innerHTML = `<strong>${esc(d.name)}</strong>${esc(d.segment)}, ${esc(d.specialty)}, ${esc(d.city)}<br>
        <span class="muted">Source</span> ${esc(label(d.source))}<br>
        <span class="muted">Stage</span> ${M.STAGE_LABEL[d.stage]} for ${d.daysInStage} days<br>
        <span class="muted">Expected MRR</span> ${eur(d.mrr)} (${esc(d.tier)})`;
      tip.hidden = false;
      const r = target.getBoundingClientRect();
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let left = r.left + r.width / 2 - tw / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
      let top = r.top - th - 10;
      if (top < 60) top = r.bottom + 10;
      tip.style.left = left + "px";
      tip.style.top = top + "px";
    };
    const hide = () => { tip.hidden = true; svg.querySelectorAll(".dot.active").forEach((e) => e.classList.remove("active")); };
    svg.onmouseover = (e) => { if (e.target.classList.contains("dot")) show(e.target, e); };
    svg.onmouseout = (e) => { if (e.target.classList.contains("dot")) hide(); };
    svg.onclick = (e) => { if (e.target.classList.contains("dot")) { e.stopPropagation(); show(e.target, e); } else hide(); };
    if (!funnelGlobalsBound) {
      funnelGlobalsBound = true;
      document.addEventListener("click", (e) => { if (!$("funnel").contains(e.target)) hideTip(); });
      window.addEventListener("scroll", hideTip, { passive: true });
    }

    const dot = (fill, stroke, r, diamond) => diamond
      ? `<svg width="14" height="14" aria-hidden="true"><rect x="3" y="3" width="8" height="8" transform="rotate(45 7 7)" fill="${fill}" stroke="${stroke}" stroke-width="2"/></svg>`
      : `<svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="${r}" fill="${fill}"/></svg>`;
    $("funnel-legend").innerHTML = `<span>${dot(C.brand2, "", 5)}Open Praxis deal</span><span>${dot(C.brand, "", 6)}Open MVZ deal</span><span>${dot("#fff", C.brand, 0, true)}Klinik (early conversation)</span><span>Hover or tap a dot for details</span>`;
  }

  function hideTip() {
    $("tip").hidden = true;
    document.querySelectorAll("#funnel .dot.active").forEach((e) => e.classList.remove("active"));
  }

  function renderOpenTable(open) {
    const rows = open.slice().sort((a, b) => M.STAGES.indexOf(b.stage) - M.STAGES.indexOf(a.stage) || b.mrr - a.mrr);
    $("open-table").className = "data-table";
    $("open-table").innerHTML = `<thead><tr><th class="first">Account</th><th>Segment</th><th>Stage</th><th>Days in stage</th><th>Source</th><th>Expected MRR</th></tr></thead>
      <tbody>${rows.map((d) => `<tr><td class="first">${esc(d.name)}</td><td>${esc(d.segment)}</td><td>${M.STAGE_LABEL[d.stage]}</td><td>${d.daysInStage}</td><td>${esc(label(d.source))}</td><td>${eur(d.mrr)}</td></tr>`).join("")}</tbody>`;
  }

  // ------------------------------------------------------------ channels
  function renderChannels() {
    const f = filt();
    const deals = M.cohort(data, f);
    const dim = state.group;
    const rows = M.groupTable(deals, dim);
    const showCac = dim === "source" && state.segment === "All";
    const cac = {};
    if (showCac) M.cac(data, deals, f).forEach((c) => (cac[c.source] = c));
    const maxRate = Math.max(...rows.filter((r) => r.winRate.flag !== "few").map((r) => r.winRate.pct), 1);
    const won = deals.filter((d) => d.status === "won");
    const total = {
      leads: deals.length, winRate: M.rate(won.length, deals.filter(M.closed).length),
      cycle: M.median(won.map((d) => M.daysBetween(d.created_date, d.won_date))), wonMrr: M.sum(won.map((d) => d.expected_mrr)), won: won.length,
    };
    const head = { source: "Channel", message: "Message or entry point", segment: "Segment", specialty: "Specialty" }[dim];
    const cacCells = (r) => {
      if (!showCac) return "";
      const c = cac[r.key];
      if (!c || c.flag === "few") return `<td><span class="few">too few (n=${c ? c.won : 0})</span></td><td></td>`;
      const tag = c.flag === "small" ? '<span class="tag">small n</span>' : "";
      return `<td>${eur(c.cac)} <span class="n">n=${c.won}</span>${tag}</td><td>${c.payback.toFixed(1)} months</td>`;
    };
    $("group-table").innerHTML = `<thead><tr><th class="first">${head}</th><th>Leads</th><th>Win rate</th><th>Median cycle</th><th>Won MRR</th>${showCac ? "<th>CAC</th><th>Payback</th>" : ""}</tr></thead>
      <tbody>${rows.map((r) => `<tr><td class="first">${esc(label(r.key))}</td><td>${num(r.leads)}</td>${barRate(r.winRate, maxRate)}<td>${nValue(days(r.medianCycle), r.cycleN)}</td><td>${eur(r.wonMrr)}</td>${cacCells(r)}</tr>`).join("")}
      <tr><td class="first"><strong>All</strong></td><td><strong>${num(total.leads)}</strong></td>${barRate(total.winRate, maxRate)}<td>${nValue(days(total.cycle), total.won)}</td><td><strong>${eur(total.wonMrr)}</strong></td>${showCac ? "<td></td><td></td>" : ""}</tr></tbody>`;

    const notes = ["Short periods understate median cycle, because recent leads only count if they closed fast."];
    if (dim === "source" && state.segment !== "All") notes.push("CAC is only shown for all segments, because channel costs can't be split by segment.");
    if (dim === "segment") notes.push("Kliniken are not included: none has closed yet.");
    $("group-note").textContent = notes.join(" ");

    renderOutbound(deals, f);
  }

  const SHORT = { outbound_email: "email", outbound_phone: "phone", linkedin: "LinkedIn" };
  function renderOutbound(deals, f) {
    const o = M.outbound(data, deals, f);
    const allSeg = state.segment === "All";
    const chans = o.channels;
    const best = chans.slice().sort((a, b) => b.per100 - a.per100);
    const top = best[0], low = best[best.length - 1];

    // Intro: computed, so it always matches the filters
    $("outbound-intro").innerHTML = allSeg && top.booked && low.booked
      ? `Every outbound reply becomes a lead, so these numbers start one step earlier, at the first contact. Per 100 contacts, ${SHORT[top.key]} books ${top.per100.toFixed(1)} demos and ${SHORT[low.key]} ${low.per100.toFixed(1)}. With the assumed time per contact, that is about ${top.hoursPerDemo.toFixed(1)} hours of prospecting per booked demo against ${low.hoursPerDemo.toFixed(1)}.`
      : `Every outbound reply becomes a lead, so these numbers start one step earlier, at the first contact. Contacts are counted before the segment is known, so per-contact numbers are only shown for all segments.`;

    // 1. Channel flow: contacted -> replied -> demo booked
    const maxPer = Math.max(...chans.map((c) => c.per100 || 0), 0.01);
    const maxH = Math.max(...chans.map((c) => c.hoursPerDemo || 0), 0.01);
    const bestH = Math.min(...chans.filter((c) => c.hoursPerDemo).map((c) => c.hoursPerDemo));
    const bar = (v, max, isBest) => `<span class="bar"><i style="width:${Math.max(3, Math.round((v / max) * 100))}%;background:${isBest ? C.brand : C.context}"></i></span>`;
    const flowRow = (c, name, isAll) => {
      const perCell = !allSeg || c.per100 === null ? `<td class="n">n/a</td>` :
        `<td class="bar-cell"><span class="barwrap">${c.per100.toFixed(1)}${isAll ? "" : bar(c.per100, maxPer, c === top)}</span></td>`;
      const hCell = !allSeg || c.hoursPerDemo === null ? `<td class="n">n/a</td>` :
        `<td class="bar-cell"><span class="barwrap">${c.hoursPerDemo.toFixed(1)} h${isAll ? "" : bar(c.hoursPerDemo, maxH, c.hoursPerDemo === bestH)}</span></td>`;
      const tag = isAll ? "strong" : "span";
      return `<tr><td class="first"><${tag}>${name}</${tag}></td><td>${num(c.contacted)}</td><td>${num(c.replied)} <span class="n">${pct(c.reply)}</span></td><td>${num(c.booked)}</td>${perCell}${hCell}</tr>`;
    };
    $("flow-table").innerHTML = `<thead><tr><th class="first">Channel</th><th>Contacted</th><th>Replied</th><th>Demos booked</th><th>Demos per 100 contacts</th><th>Prospecting hours per demo <span class="n">lower is better</span></th></tr></thead>
      <tbody>${chans.map((c) => flowRow(c, esc(label(c.key)) + (c.key === "outbound_phone" ? ' <span class="n">dials</span>' : ""), false)).join("")}
      ${flowRow(o.all, "All outbound", true)}</tbody>`;

    renderMatrix(o);
  }

  // 2. Channel x message matrix (reply rate or booking rate), darker = higher
  function renderMatrix(o) {
    const metric = state.omx;
    const get = (c) => (metric === "reply" ? c.reply : c.booking);
    const inner = o.matrix.flatMap((r) => r.cells.map(get)).filter((r) => r.flag !== "few" && r.pct !== null);
    const lo = Math.min(...inner.map((r) => r.pct)), hi = Math.max(...inner.map((r) => r.pct));
    const shade = (p) => heatColor(10 + 80 * ((p - lo) / Math.max(hi - lo, 0.01)));
    const cellHtml = (c, ri, ci, opts) => {
      const r = get(c);
      const attrs = `data-r="${ri}" data-c="${ci}" tabindex="0"`;
      if (r.flag === "few" || r.pct === null) return `<td class="dim" ${attrs}>too few<span class="n">n=${r.den}</span></td>`;
      const n = `<span class="n">n=${num(r.den)}</span>`;
      if (opts.total) return `<td class="tot" ${attrs}>${pct(r)}${n}</td>`;
      const bg = shade(r.pct), fg = (r.pct - lo) / Math.max(hi - lo, 0.01) > 0.55 ? "#fff" : C.ink;
      const cls = [opts.best ? "best" : "", r.flag === "small" ? "small" : ""].join(" ").trim();
      return `<td class="${cls}" style="background:${bg};color:${fg}" ${attrs}>${pct(r)}${n}</td>`;
    };
    const rows = o.matrix.map((row, ri) => {
      // Outline the row's best message, unless the top value rests on small n
      const shown = row.cells.filter((c) => get(c).flag !== "few" && get(c).pct !== null);
      const topCell = shown.slice().sort((a, b) => get(b).pct - get(a).pct)[0];
      const bestKey = topCell && get(topCell).flag === "ok" ? topCell.key : null;
      const total = o.channels[ri];
      return `<tr><th scope="row">${esc(label(row.key))}</th>${row.cells.map((c, ci) => cellHtml(c, ri, ci, { best: c.key === bestKey })).join("")}${cellHtml(total, ri, 4, { total: true })}</tr>`;
    }).join("");
    const totals = `<tr><th scope="row">All channels</th>${o.messages.map((c, ci) => cellHtml(c, 3, ci, { total: true })).join("")}${cellHtml(o.all, 3, 4, { total: true })}</tr>`;
    $("omx").innerHTML = `<thead><tr><th></th>${M.OUTBOUND_MESSAGES.map((m) => `<th scope="col">${esc(m)}</th>`).join("")}<th scope="col">All messages</th></tr></thead><tbody>${rows}${totals}</tbody>`;

    const dens = o.matrix.flatMap((r) => r.cells.map((c) => get(c).den));
    const unit = metric === "reply" ? "contacts" : "replies";
    $("omx-note").textContent = `Darker means higher. Outlined: the best message in each channel, left out where the top value rests on small n (dashed). Inner cells rest on ${num(Math.min(...dens))} to ${num(Math.max(...dens))} ${unit}${metric === "booking" ? ", so treat differences inside a row as hints, not results. The clearest message effect shows up when split by billing setup (finding 3)." : "."}`;

    // Hover or tap a cell for the full chain
    const lookup = (ri, ci) => {
      if (ri === 3) return ci === 4 ? { c: o.all, ch: "All channels", msg: "All messages" } : { c: o.messages[ci], ch: "All channels", msg: o.messages[ci].key };
      if (ci === 4) return { c: o.channels[ri], ch: label(o.channels[ri].key), msg: "All messages" };
      return { c: o.matrix[ri].cells[ci], ch: label(o.matrix[ri].key), msg: o.matrix[ri].cells[ci].key };
    };
    const show = (td) => {
      const { c, ch, msg } = lookup(+td.dataset.r, +td.dataset.c);
      const per = state.segment === "All" && c.per100 !== null ? `<br><span class="muted">Demos per 100 contacts</span> ${c.per100.toFixed(1)}` : "";
      placeTip(td, `<strong>${esc(msg)}</strong>${esc(ch)}<br>
        <span class="muted">Contacted</span> ${num(c.contacted)}<br>
        <span class="muted">Replied</span> ${num(c.replied)} (${pct(c.reply)})<br>
        <span class="muted">Booked a demo</span> ${num(c.booked)} (${pct(c.booking)} of replies that moved on or were lost)${per}`);
    };
    const tbl = $("omx");
    tbl.onmouseover = (e) => { const td = e.target.closest("td"); if (td) show(td); };
    tbl.onmouseout = (e) => { if (e.target.closest("td")) hideTip(); };
    tbl.onfocusin = (e) => { const td = e.target.closest("td"); if (td) show(td); };
    tbl.onfocusout = hideTip;
    tbl.onclick = (e) => { const td = e.target.closest("td"); if (td) { e.stopPropagation(); show(td); } };
  }

  // Shared tooltip placement (funnel dots, matrix cells)
  function placeTip(target, html) {
    const tip = $("tip");
    tip.innerHTML = html;
    tip.hidden = false;
    const r = target.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - tw / 2, window.innerWidth - tw - 8));
    let top = r.top - th - 10;
    if (top < 60) top = r.bottom + 10;
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  }

  // ------------------------------------------------------------ revenue
  function renderRevenue() {
    const f = filt();
    const k = M.revenueKpis(data, f);
    const periodDeals = M.cohort(data, f).filter((d) => d.status === "won");
    $("kpis").innerHTML = [
      { label: "Live MRR on 30 Sep", value: eur(k.mrr), detail: `${k.customers} live customers` },
      { label: "Won, not live yet", value: eur(k.wonNotLiveMrr), detail: `${k.wonNotLive} deals in onboarding, median ${days(k.medianToLive)} from won to live` },
      { label: `Won from leads created ${state.period === "all" ? "Apr to Sep" : state.period.toUpperCase()}`, value: eur(M.sum(periodDeals.map((d) => d.expected_mrr))), detail: `${periodDeals.length} new customers` },
      { label: "Churned customers", value: num(k.churned), detail: k.churned < M.SMALL_N ? `${eur(k.churnedMrr)} MRR. Too few to estimate a churn rate reliably` : `${eur(k.churnedMrr)} MRR` },
    ].map((x) => `<div class="kpi"><div class="label">${x.label}</div><div class="value">${x.value}</div><div class="detail">${x.detail}</div></div>`).join("");

    const series = M.mrrSeries(data, f);
    const p = PERIODS[state.period];
    const markArea = state.period === "all" ? undefined : {
      silent: true, itemStyle: { color: "rgba(0,86,150,0.06)" },
      label: { show: true, position: "insideTop", color: C.ink2, fontFamily: FONT, fontSize: 11, formatter: "Selected period" },
      data: [[{ xAxis: series.find((s) => s.date >= p.from).date }, { xAxis: series.filter((s) => s.date <= p.to).slice(-1)[0].date }]],
    };
    chart("c-mrr").setOption({
      textStyle: { fontFamily: FONT },
      grid: { left: 12, right: 20, top: 44, bottom: 12, containLabel: true },
      legend: { top: 10, left: 12, itemWidth: 12, itemHeight: 12, icon: "roundRect", textStyle: baseText, data: M.TIERS.slice().reverse() },
      tooltip: Object.assign({}, tooltipBase, {
        trigger: "axis", axisPointer: { type: "line", lineStyle: { color: C.ink3 } },
        formatter: (ps) => `<b>${fmtDate(series[ps[0].dataIndex].date)}</b><br>` + ps.slice().reverse().map((q) => `${q.marker}${q.seriesName}: ${eur(q.value)}`).join("<br>") + `<br><b>Total ${eur(series[ps[0].dataIndex].total)}</b>`,
      }),
      xAxis: { type: "category", boundaryGap: false, data: series.map((s) => s.date), axisLabel: Object.assign({}, baseText, { formatter: fmtDate, hideOverlap: true }), axisTick: { show: false }, axisLine: { lineStyle: { color: C.rule } } },
      yAxis: { type: "value", axisLabel: Object.assign({}, baseText, { formatter: (v) => "€" + (v >= 1000 ? v / 1000 + "k" : v) }), splitLine: { lineStyle: { color: C.rule2 } } },
      series: M.TIERS.map((t, i) => ({
        name: t, type: "line", stack: "mrr", step: false, symbol: "none", smooth: false,
        lineStyle: { width: 1.5, color: TIER_COLOR[t] }, areaStyle: { color: TIER_COLOR[t], opacity: 0.9 },
        itemStyle: { color: TIER_COLOR[t] },
        data: series.map((s) => s[t]),
        markArea: i === 0 ? markArea : undefined,
      })),
    }, true);

    renderForecast(f);
  }

  function renderForecast(f) {
    const fc = M.forecast(data, f);
    const steps = [
      { name: "30 Sep", value: fc.start, base: 0, color: C.brand, text: eur(fc.start) },
      { name: "Going live", value: fc.wonNotLive, base: fc.start, color: C.brand3, text: "+" + eur(fc.wonNotLive) },
      { name: "Pipeline", value: fc.pipeline, base: fc.start + fc.wonNotLive, color: C.brand3, text: "+" + eur(fc.pipeline) },
      { name: "Churn", value: fc.churn, base: fc.end, color: C.context, text: "-" + eur(fc.churn) },
      { name: "31 Dec", value: fc.end, base: 0, color: C.brand, text: eur(fc.end) },
    ];
    chart("c-bridge").setOption({
      textStyle: { fontFamily: FONT },
      grid: { left: 12, right: 12, top: 32, bottom: 12, containLabel: true },
      tooltip: Object.assign({}, tooltipBase, { trigger: "item", formatter: (p) => p.seriesIndex === 1 ? `<b>${p.name}</b><br>${steps[p.dataIndex].text}` : "" }),
      xAxis: { type: "category", data: steps.map((s) => s.name), axisTick: { show: false }, axisLine: { lineStyle: { color: C.rule } }, axisLabel: Object.assign({}, baseText, { interval: 0, width: 72, overflow: "break" }) },
      yAxis: { type: "value", axisLabel: Object.assign({}, baseText, { formatter: (v) => "€" + (v >= 1000 ? v / 1000 + "k" : v) }), splitLine: { lineStyle: { color: C.rule2 } } },
      series: [
        { type: "bar", stack: "b", silent: true, itemStyle: { color: "transparent" }, data: steps.map((s) => s.base), barMaxWidth: 56 },
        {
          type: "bar", stack: "b", barMaxWidth: 56,
          label: { show: true, position: "top", fontFamily: FONT, fontSize: 12, color: C.ink, formatter: (p) => steps[p.dataIndex].text },
          data: steps.map((s) => ({ value: s.value, itemStyle: { color: s.color, borderRadius: 4 } })),
        },
      ],
    }, true);

    const pa = (stage, age) => fc.winProbAt(stage, age);
    const probRow = (stage) => `<tr><td class="first">${M.STAGE_LABEL[stage]}</td><td>${pct(pa(stage, 0))}</td><td>${pct(pa(stage, 14))}</td><td>${pct(pa(stage, 30))}</td></tr>`;
    const mvz = state.segment !== "Praxis" && fc.top3Mvz.length
      ? `<p class="scenario">${pctN(fc.pipelineMvzShare * 100)} of the weighted pipeline is MVZ, from a handful of deals. If the ${fc.top3Mvz.length} biggest (${fc.top3Mvz.map((t) => esc(t.name)).join(", ")}) slip into next year, the forecast drops to <strong>${eur(fc.withoutTop3)}</strong>. That is the number I would watch.</p>` : "";
    $("forecast-text").innerHTML = `
      <p>If open deals close like similar deals did before, MRR on 31 December lands near <strong>${eur(fc.end)}</strong>${state.segment !== "All" ? ` for ${state.segment}` : ""}, up from ${eur(fc.start)} today.</p>
      <p>Each open deal counts with its chance of winning, and that chance falls the longer a deal sits in its stage. It comes from the closed deals: of those still undecided after that many days, the share that was won.</p>
      <div class="table-scroll"><table class="data-table prob"><thead><tr><th class="first">Open at</th><th>Fresh</th><th>After 14 days</th><th>After 30 days</th></tr></thead>
        <tbody>${probRow("lead")}${probRow("demo_booked")}${probRow("demo_held")}</tbody></table></div>
      ${mvz}
      <p class="n">Expected churn uses the observed rate of ${(fc.monthlyChurn * 100).toFixed(1)}% per month, based on only ${M.revenueKpis(data, {}).churned} churned customers. Kliniken are left out.</p>`;
  }

  // ------------------------------------------------------------ CRM structure (static text)
  function renderCrm() {
    const k = data.meta.costs;
    $("crm-body").innerHTML = `
      <h3>Definitions</h3>
      <dl class="defs">
        <div><dt>Prospect</dt><dd>A practice that fits the target group but hasn't engaged yet. For outbound, these are the contacts in the weekly outreach counts.</dd></div>
        <div><dt>Lead</dt><dd>Any practice that engaged: replied to outreach (even lukewarm), used an SEO tool and left contact details, booked a demo on the website, or was referred. The first funnel stage.</dd></div>
        <div><dt>Lead source</dt><dd>The first touch, never overwritten. “Website Demo buchen” means the demo was booked without an earlier tracked touch. A practice that used the GOÄ-Rechner first counts as SEO.</dd></div>
        <div><dt>Kliniken</dt><dd>A separate pipeline. Different decision process and on-site integration, so they don't share stages or rates with practices.</dd></div>
      </dl>

      <h3>Stages, exit criteria and required fields</h3>
      <div class="table-scroll"><table class="data-table">
        <thead><tr><th>Stage</th><th>A deal is here when</th><th>It moves on when</th><th>Required fields</th></tr></thead>
        <tbody>
          <tr><td>Lead</td><td>The practice engaged for the first time</td><td>A demo date is agreed</td><td>Lead source, first-touch date, segment, specialty, billing setup, number of doctors</td></tr>
          <tr><td>Demo booked</td><td>A demo date is in the calendar</td><td>The demo took place</td><td>Demo date, decision maker attending (yes or no)</td></tr>
          <tr><td>Demo held</td><td>The demo took place</td><td>The contract is signed, or there is a clear no</td><td>Expected tier, expected MRR, PVS in use, next step with a date</td></tr>
          <tr><td>Won</td><td>The contract is signed</td><td>The customer is live (onboarding, tracked separately)</td><td>Tier, MRR, planned go-live date</td></tr>
          <tr><td>Lost</td><td>A deal ends at any stage</td><td></td><td>Stage it was lost at, lost reason from a fixed list</td></tr>
        </tbody></table></div>
      <p class="table-note">CRM hygiene rule: a lead with no progress for 30 days is closed as lost (“Went silent after first reply”), so the open pipeline stays honest.</p>

      <h3>Metrics</h3>
      <dl class="defs">
        <div><dt>Stage conversion</dt><dd class="formula">moved on ÷ (moved on + lost at that stage)</dd></div>
        <div><dt>Win rate</dt><dd class="formula">won ÷ (won + lost). Open deals are excluded until they close.</dd></div>
        <div><dt>Cycle length</dt><dd class="formula">days from lead created to won. Days from won to live are a separate onboarding metric.</dd></div>
        <div><dt>MRR</dt><dd class="formula">counted from the go-live date, not the signature</dd></div>
        <div><dt>CAC per channel</dt><dd class="formula">(channel cost + sales hours × €${k.hourly_rate_eur}) ÷ customers won</dd></div>
        <div><dt>Payback</dt><dd class="formula">CAC ÷ average MRR of the customers won through that channel, in months</dd></div>
        <div><dt>Weighted forecast</dt><dd class="formula">live MRR + won deals going live + Σ (open deal MRR × win chance at its stage and age) − expected churn</dd></div>
        <div><dt>Small n</dt><dd class="formula">rates on fewer than ${M.SMALL_N} deals are tagged “small n”, below ${M.FEW_N} they are not shown</dd></div>
      </dl>`;
  }

  function renderFooter() {
    const k = data.meta.costs;
    const items = data.meta.assumptions.slice();
    items.push(`Cost assumptions: €${k.hourly_rate_eur} per sales hour; ${k.minutes_per_contact.outbound_email}, ${k.minutes_per_contact.outbound_phone} and ${k.minutes_per_contact.linkedin} minutes per email, dial and LinkedIn contact; ${k.sales_hours_per_deal_from_demo_booked} sales hours per deal from demo booked; SEO €${num(k.monthly_fixed_eur.seo_tools)} and website €${num(k.monthly_fixed_eur.website_demo)} per month; no fee for SumUp or referral customers, because those terms are unknown.`);
    $("assumptions").innerHTML = items.map((a) => `<li>${esc(a)}</li>`).join("");
  }

  // ------------------------------------------------------------ findings drawer
  /* Closed: only the vertical tab shows on the right edge.
   * Peek: a mouse hovering the tab slides the panel out; it closes when the pointer leaves.
   * Pinned: a click (or tap, or keyboard) keeps it open until closed.
   * On wide screens an open panel (peek or pinned) pushes the page to the left instead of
   * covering it. */
  const PUSH_MIN = 1420;
  let drawerMode = "closed", leaveTimer, layoutAnim;
  const SLIDE_MS = 320; // keep in sync with --slide in styles.css

  function setDrawer(mode, focus) {
    clearTimeout(leaveTimer);
    const prevPush = document.documentElement.classList.contains("fpush");
    drawerMode = mode;
    const open = mode !== "closed";
    const drawer = $("fdrawer");
    drawer.classList.toggle("open", open);
    drawer.classList.toggle("pinned", mode === "pinned");
    $("ftab").setAttribute("aria-expanded", String(open));
    $("fpanel").setAttribute("aria-hidden", String(!open));
    $("fpanel").inert = !open;
    const push = open && window.innerWidth >= PUSH_MIN; // hover peek pushes too
    document.documentElement.classList.toggle("fpush", push);
    document.documentElement.classList.toggle("fscrim-on", mode === "pinned" && window.innerWidth < 720);
    if (open) { const c = charts["c-f2"] || charts["c-f3"]; if (c) c.resize(); }
    if (push !== prevPush) animateLayout();
    if (focus && open) $("fpanel-h").focus();
    if (focus && !open) $("ftab").focus();
  }

  function bindDrawer() {
    const drawer = $("fdrawer");
    $("ftab").addEventListener("click", () => setDrawer(drawerMode === "pinned" ? "closed" : "pinned", true));
    $("fclose").addEventListener("click", () => setDrawer("closed", true));
    $("fscrim").addEventListener("click", () => setDrawer("closed"));
    $("open-findings").addEventListener("click", () => { showFinding(0); setDrawer("pinned", true); });
    drawer.addEventListener("pointerenter", (e) => {
      if (e.pointerType !== "mouse") return;
      clearTimeout(leaveTimer);
      if (drawerMode === "closed") setDrawer("peek");
    });
    drawer.addEventListener("pointerleave", (e) => {
      if (e.pointerType !== "mouse" || drawerMode !== "peek") return;
      leaveTimer = setTimeout(() => setDrawer("closed"), 300);
    });
    // Interacting inside a peeking panel pins it
    $("fpanel").addEventListener("click", () => { if (drawerMode === "peek") setDrawer("pinned"); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && drawerMode !== "closed") setDrawer("closed", true); });
    // Toggles 1, 2, 3 (tabs: arrow keys move between them)
    const toggles = Array.from(document.querySelectorAll("#fswitch button"));
    toggles.forEach((b, i) => {
      b.addEventListener("click", () => showFinding(i));
      b.addEventListener("keydown", (e) => {
        const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!d) return;
        const j = (currentFinding + d + toggles.length) % toggles.length;
        showFinding(j);
        toggles[j].focus();
      });
    });
    setDrawer("closed");
  }

  /* While the page width animates, charts and the funnel would keep their old size and jump
   * at the end. Instead, every frame redraws the ones on screen (cheap: one to three charts),
   * and everything is redrawn once the slide is over. */
  function animateLayout() {
    cancelAnimationFrame(layoutAnim);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const end = performance.now() + (reduce ? 0 : SLIDE_MS + 40);
    const frame = (now) => {
      if (now >= end) { relayout(); return; }
      resizeVisible();
      layoutAnim = requestAnimationFrame(frame);
    };
    layoutAnim = requestAnimationFrame(frame);
  }

  function onScreen(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight;
  }

  function resizeVisible() {
    Object.values(charts).forEach((c) => { if (onScreen(c.getDom())) c.resize({ animation: { duration: 0 } }); });
    if (lastFunnel && onScreen($("funnel"))) drawFunnel(lastFunnel.rows, lastFunnel.open);
  }

  function relayout() {
    Object.values(charts).forEach((c) => c.resize({ animation: { duration: 0 } }));
    renderPipeline();
  }

  // ------------------------------------------------------------ wiring
  function renderFiltered() {
    renderPipeline();
    renderChannels();
    renderRevenue();
  }

  function bindControls() {
    $("f-period").addEventListener("change", (e) => { state.period = e.target.value; renderFiltered(); });
    const press = (container, key, after) => container.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      container.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      state[key] = b.dataset.v;
      after();
    });
    press($("f-segment"), "segment", renderFiltered);
    press(document.querySelector(".group-switch"), "group", renderChannels);
    press($("omx-switch"), "omx", () => renderMatrix(M.outbound(data, M.cohort(data, filt()), filt())));
    // Phones fire "resize" when the address bar hides on scroll; only redraw when the width changes
    let t, lastWidth = window.innerWidth;
    window.addEventListener("resize", () => {
      if (window.innerWidth === lastWidth) return;
      lastWidth = window.innerWidth;
      clearTimeout(t);
      t = setTimeout(() => { setDrawer(drawerMode); relayout(); }, 150);
    });
  }

  // Bump ?v= in index.html after changing site files, so browsers fetch fresh copies
  fetch("data/data.json", { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then((raw) => {
      data = M.prepare(raw);
      F = M.findings(data);
      renderFindings();
      renderFiltered();
      renderCrm();
      renderFooter();
      bindControls();
      bindDrawer();
    })
    .catch((err) => {
      const loadFailed = !data;
      $("pipeline-intro").innerHTML = loadFailed
        ? `The data file could not be loaded (${esc(err.message)}). If you opened this file directly, serve the folder instead, for example with <code>python3 -m http.server</code> in the site folder.`
        : `Something went wrong while drawing the page (${esc(err.message)}). A hard reload (Cmd+Shift+R) usually fixes this after the files were updated.`;
      console.error(err);
    });
})();
