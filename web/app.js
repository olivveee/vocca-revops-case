"use strict";

// Presentation layer only. Every cleaning rule, the quota and the flag thresholds come
// from the Google Sheet (DEALS_CLEAN, RAW_team and WEB_PARAMS tabs, published as CSV),
// so a change in the sheet shows up here on the next page load. The breakdowns below
// (by country, stage, source, specialty) use the same definitions as the WHAT_WORKS tab.

const state = { data: null, month: null, country: "All", period: "ytd", motion: "All", person: "" };

const STAGES = ["Demo Scheduled", "Demo Held", "Qualified", "Quoted"];
const KINDS = ["New logo", "Group rollout", "Upsell", "Cross-sell", "Retention"];
const MARKETS = ["FR", "US", "Other", "Unknown"];
const COUNTRY_LABEL = { All: "All countries", FR: "France", US: "United States", Other: "Other countries", Unknown: "Country unknown" };
const PERIOD_LABEL = { month: "Month", quarter: "Last 3 months", ytd: "Year to date" };

// Amounts arrive in the Sheet's reporting currency (WEB_PARAMS "currency", USD by default).
let currencyFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
let currencySymbol = "$";
function setCurrency(code) {
  currencyFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: code, maximumFractionDigits: 0 });
  currencySymbol = currencyFmt.formatToParts(0).find((p) => p.type === "currency").value;
}
const pct = (v) => (v === null || Number.isNaN(v) ? "–" : `${Math.round(v * 100)}%`);
const money = (v) => (v === null || Number.isNaN(v) ? "–" : currencyFmt.format(v));
const compactMoney = (v) => {
  if (Math.abs(v) >= 1e6) return `${currencySymbol}${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `${currencySymbol}${Math.round(v / 1e3)}k`;
  return `${currencySymbol}${Math.round(v)}`;
};

// ---------- month helpers (months are "YYYY-MM" strings) ----------
const monthOf = (iso) => iso.slice(0, 7);
const addMonths = (m, n) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const monthDiff = (a, b) => {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
};
const monthLabel = (m, long = false) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-GB", {
    month: long ? "long" : "short", year: long ? "numeric" : "2-digit", timeZone: "UTC",
  });
};
const inMonths = (iso, from, to) => iso !== null && monthOf(iso) >= from && monthOf(iso) <= to;
const monthsBetween = (from, to) => Array.from({ length: monthDiff(from, to) + 1 }, (_, i) => addMonths(from, i));

// ---------- calculations ----------
const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);
const median = (values) => {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
};

function periodRange() {
  const to = state.month;
  if (state.period === "month") return { from: to, to };
  if (state.period === "quarter") return { from: addMonths(to, -2), to };
  return { from: `${to.slice(0, 4)}-01`, to };
}

// Deals are filtered on the country of the account; AEs (quota, table) on the market of their team.
const countryDeals = () => state.data.deals.filter((d) => state.country === "All" || d.country === state.country);
const byMotion = (deals) => deals.filter((d) => state.motion === "All" || d.motion === state.motion);
const teamMarket = () => (state.country === "FR" || state.country === "US" ? state.country : null);

function aesInSeat(month) {
  const market = teamMarket();
  return state.data.team.filter((t) =>
    t.role === "AE" &&
    monthOf(t.start) <= month &&
    (t.end === null || monthOf(t.end) >= month) &&
    (state.country === "All" || t.market === market));
}

function sdrsInSeat(month) {
  const market = teamMarket();
  return state.data.team.filter((t) =>
    t.role === "SDR" &&
    monthOf(t.start) <= month &&
    (t.end === null || monthOf(t.end) >= month) &&
    (state.country === "All" || t.market === market));
}

const tenure = (ae, month) => monthDiff(monthOf(ae.start), month) + 1;

// Quota source is chosen in the Sheet (PARAMS): recalculated base with ramp-up, or the provided per-AE quotas.
function quotaFor(ae, month, base) {
  const p = state.data.params;
  if (p.quotaSource === "Provided") return (ae.quotaProvided || 0) * p.quotaProvidedRate;
  return base * p.ramp[Math.min(tenure(ae, month), p.ramp.length) - 1];
}

function rates(deals, from, to) {
  const closed = deals.filter((d) => d.status !== "open" && inMonths(d.booking, from, to));
  const won = closed.filter((d) => d.status === "won");
  const sweep = closed.filter((d) => d.sweep).length;
  return {
    winRate: closed.length ? won.length / closed.length : null,
    winRateExSweep: closed.length - sweep ? won.length / (closed.length - sweep) : null,
    closed: closed.length,
    won: won.length,
    wonArr: sum(won, (d) => d.arr),
  };
}

// One row per value of `key` (source, specialty): closed deals in the period, won ARR, win rate, open pipe.
// Beyond `top` rows the long tail is grouped, so the list stays readable.
function breakdown(deals, key, from, to, top = Infinity) {
  const rows = {};
  deals.forEach((d) => {
    const k = d[key] || "Unknown";
    const r = rows[k] || (rows[k] = { label: k, won: 0, closed: 0, wonArr: 0, open: 0, pipe: 0 });
    if (d.status === "open") { r.open += 1; r.pipe += d.weightedHealthy; return; }
    if (!inMonths(d.booking, from, to)) return;
    r.closed += 1;
    if (d.status === "won") { r.won += 1; r.wonArr += d.arr || 0; }
  });
  const list = Object.values(rows).filter((r) => r.closed || r.open)
    .map((r) => ({ ...r, winRate: r.closed ? r.won / r.closed : null }))
    .sort((a, b) => b.wonArr - a.wonArr || b.closed - a.closed);
  if (list.length <= top + 1) return list;
  const rest = list.slice(top);
  const other = rest.reduce((o, r) => ({ ...o, won: o.won + r.won, closed: o.closed + r.closed, wonArr: o.wonArr + r.wonArr, open: o.open + r.open, pipe: o.pipe + r.pipe }),
    { label: `${rest.length} others`, won: 0, closed: 0, wonArr: 0, open: 0, pipe: 0, grouped: true });
  other.winRate = other.closed ? other.won / other.closed : null;
  return [...list.slice(0, top), other];
}

function compute() {
  const p = state.data.params;
  const { from, to } = periodRange();
  const months = monthsBetween(from, to);
  // A single month holds too few closed deals per AE: rates then use the rolling window.
  const rateFrom = state.period === "month" ? addMonths(to, -(p.rateWindowMonths - 1)) : from;
  const all = countryDeals();
  const deals = byMotion(all);
  const won = all.filter((d) => d.status === "won" && inMonths(d.booking, from, to));
  const open = deals.filter((d) => d.status === "open");
  const quota = teamMarket() || state.country === "All" ? sum(months, (m) => sum(aesInSeat(m), (ae) => quotaFor(ae, m, p.quotaBase))) : null;
  const r = rates(deals, rateFrom, to);

  const reps = aesInSeat(to).map((ae) => {
    const own = state.data.deals.filter((d) => d.owner === ae.name);
    const ownOpen = own.filter((d) => d.status === "open");
    const repQuota = sum(months.filter((m) => monthOf(ae.start) <= m), (m) => quotaFor(ae, m, p.quotaBase));
    const newArr = sum(own.filter((d) => d.status === "won" && d.motion === "New logo" && inMonths(d.booking, from, to)), (d) => d.arr);
    const rr = rates(own, rateFrom, to);
    const rep = {
      name: ae.name,
      market: ae.market,
      tenure: tenure(ae, to),
      quota: repQuota,
      newArr,
      attainment: repQuota ? newArr / repQuota : 0,
      winRate: rr.winRate,
      closed: rr.closed,
      healthyPipe: sum(ownOpen, (d) => d.weightedHealthy),
      openDeals: ownOpen.length,
      unhealthyShare: ownOpen.length ? ownOpen.filter((d) => d.unhealthy).length / ownOpen.length : null,
      sweepLosses: own.filter((d) => d.sweep).length,
      trend: Array.from({ length: 12 }, (_, i) => {
        const m = addMonths(to, i - 11);
        return { month: m, value: sum(own.filter((d) => d.status === "won" && d.motion === "New logo" && d.booking && monthOf(d.booking) === m), (d) => d.arr) };
      }),
    };
    rep.flags = flagsFor(rep, rates(all, rateFrom, to).winRate);
    return rep;
  });
  // Who needs help first: tenured AEs by attainment, lowest first; ramping AEs last.
  const rampMonths = p.ramp.length - 1;
  reps.sort((a, b) => (a.tenure <= rampMonths) - (b.tenure <= rampMonths) || a.attainment - b.attainment || a.name.localeCompare(b.name));

  const history = Array.from({ length: 12 }, (_, i) => {
    const m = addMonths(to, i - 11);
    return {
      month: m,
      newArr: sum(all.filter((d) => d.status === "won" && d.motion === "New logo" && d.booking && monthOf(d.booking) === m), (d) => d.arr),
      quota: quota === null ? 0 : sum(aesInSeat(m), (ae) => quotaFor(ae, m, p.quotaBase)),
    };
  });

  const stages = STAGES.map((s) => {
    const inStage = open.filter((d) => d.stage === s);
    return {
      stage: s,
      deals: inStage.length,
      forecast: sum(inStage, (d) => d.forecast),
      pipe: sum(inStage, (d) => d.weightedHealthy),
      unhealthyShare: inStage.length ? inStage.filter((d) => d.unhealthy).length / inStage.length : null,
      medianAge: median(inStage.map((d) => d.age).filter((a) => a !== null)),
    };
  });

  // Same tables as the Sheet's DASHBOARD: by market (all countries, for comparison), by deal type, month by month.
  const closedIn = (d) => d.status !== "open" && inMonths(d.booking, from, to);
  const markets = MARKETS.map((mk) => {
    const ds = byMotion(state.data.deals).filter((d) => d.country === mk);
    const cl = ds.filter(closedIn); const wn = cl.filter((d) => d.status === "won");
    const op = ds.filter((d) => d.status === "open");
    return { label: mk, won: wn.length, winRate: cl.length ? wn.length / cl.length : null, wonArr: sum(wn, (d) => d.arr), open: op.length, pipe: sum(op, (d) => d.weightedHealthy) };
  });
  const dealTypes = KINDS.map((k) => {
    const ds = all.filter((d) => d.kind === k);
    const cl = ds.filter(closedIn); const wn = cl.filter((d) => d.status === "won");
    const wonArr = sum(wn, (d) => d.arr);
    return { label: k, motion: k === "New logo" ? "New logo" : "Expansion", closed: cl.length, won: wn.length, winRate: cl.length ? wn.length / cl.length : null, wonArr, avg: wn.length ? wonArr / wn.length : null, open: ds.filter((d) => d.status === "open").length };
  });
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const m = addMonths(to, -i);
    const wm = all.filter((d) => d.status === "won" && d.booking && monthOf(d.booking) === m);
    const byKind = Object.fromEntries(KINDS.map((k) => [k, sum(wm.filter((d) => d.kind === k), (d) => d.arr)]));
    const q = quota === null ? 0 : sum(aesInSeat(m), (ae) => quotaFor(ae, m, p.quotaBase));
    return { month: m, byKind, total: sum(wm, (d) => d.arr), quota: q, attainment: q ? byKind["New logo"] / q : null };
  });


  // SDRs: a demo booked = a new-logo deal created (deals are created at Demo Scheduled), credited in the Sheet (DEALS_CLEAN.sdr).
  const newLogo = all.filter((d) => d.motion === "New logo");
  const bookedIn = (d) => d.created !== null && inMonths(d.created, from, to);
  const wonIn = (d) => d.status === "won" && inMonths(d.booking, from, to);
  const trendOf = (ds) => Array.from({ length: 12 }, (_, i) => {
    const m = addMonths(to, i - 11);
    return { month: m, value: ds.filter((d) => d.created && monthOf(d.created) === m).length };
  });
  const sdrGroup = (label, ds) => {
    const bk = ds.filter(bookedIn); const wn = ds.filter(wonIn);
    return { label, booked: bk.length, held: bk.filter((d) => d.reachedDemo).length, won: wn.length, wonArr: sum(wn, (d) => d.arr), trend: trendOf(ds) };
  };
  const sdrGroups = [sdrGroup("Booked by an SDR", newLogo.filter((d) => d.sdr)), sdrGroup("Not by an SDR (AE, inbound, automation)", newLogo.filter((d) => !d.sdr)), sdrGroup("Total", newLogo)];
  const sdrs = sdrsInSeat(to).map((t) => {
    const ds = newLogo.filter((d) => d.sdr === t.name);
    const bk = ds.filter(bookedIn);
    const target = (t.demoTarget || 0) * months.filter((m) => monthOf(t.start) <= m).length;
    const held = bk.filter((d) => d.reachedDemo).length;
    return { name: t.name, start: t.start, booked: bk.length, held, target, vsTarget: target ? held / target : null, wonArr: sum(ds.filter(wonIn), (d) => d.arr), trend: trendOf(ds) };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const newArr = sum(won.filter((d) => d.motion === "New logo"), (d) => d.arr);
  // Quota belongs to a team: compare it with what that team signed, not with every deal on the country's accounts.
  const quotaArr = teamMarket() ? sum(won.filter((d) => d.motion === "New logo" && d.market === teamMarket()), (d) => d.arr) : newArr;
  const expansionArr = sum(won.filter((d) => d.motion === "Expansion"), (d) => d.arr);
  const expansionRates = rates(all.filter((d) => d.motion === "Expansion"), rateFrom, to);
  return {
    from, to, rateFrom, months, reps, history, stages, markets, dealTypes, monthly, sdrGroups, sdrs,
    sources: breakdown(deals, "source", from, to),
    specialties: breakdown(deals, "specialty", from, to, 9),
    team: {
      newArr, expansionArr, quota, quotaArr,
      expansionShare: newArr + expansionArr ? expansionArr / (newArr + expansionArr) : null,
      expansionWinRate: expansionRates.winRate,
      winRate: r.winRate, winRateExSweep: r.winRateExSweep, closed: r.closed, wonCount: r.won,
      healthyPipe: sum(open, (d) => d.weightedHealthy),
      openDeals: open.length,
      unhealthyShare: open.length ? open.filter((d) => d.unhealthy).length / open.length : null,
      sweepTotal: all.filter((d) => d.sweep).length,
      nonAeDeals: all.filter((d) => d.role !== "AE").length,
    },
  };
}

// One person, all countries, same period: as deal owner (Sales) and as SDR (demos booked). Same as the PERSON tab.
function personModel(name, model) {
  const p = state.data.params;
  const t = state.data.team.find((x) => x.name === name);
  const { from, to, rateFrom, months } = model;
  const deals = state.data.deals;
  const own = deals.filter((d) => d.owner === name);
  const ownOpen = own.filter((d) => d.status === "open");
  const booked = deals.filter((d) => d.sdr === name && d.motion === "New logo");
  const bk = booked.filter((d) => d.created !== null && inMonths(d.created, from, to));
  const wonIn = (d) => d.status === "won" && inMonths(d.booking, from, to);
  const quota = t.role === "AE" ? sum(months.filter((m) => monthOf(t.start) <= m), (m) => quotaFor(t, m, p.quotaBase)) : null;
  const newArr = sum(own.filter((d) => d.motion === "New logo" && wonIn(d)), (d) => d.arr);
  const target = (t.demoTarget || 0) * months.filter((m) => monthOf(t.start) <= m).length;
  const held = bk.filter((d) => d.reachedDemo).length;
  const rr = rates(own, rateFrom, to);
  const monthsBack = Array.from({ length: 12 }, (_, i) => addMonths(to, -i));
  const inM = (iso, m) => iso !== null && monthOf(iso) === m;
  const lines = [
    { label: "Demos booked (as SDR)", values: monthsBack.map((m) => booked.filter((d) => inM(d.created, m)).length), fmt: String },
    { label: "Demos held (as SDR)", values: monthsBack.map((m) => booked.filter((d) => inM(d.created, m) && d.reachedDemo).length), fmt: String },
    { label: "New-logo deals won (as owner)", values: monthsBack.map((m) => own.filter((d) => d.status === "won" && d.motion === "New logo" && inM(d.booking, m)).length), fmt: String },
    { label: "New-logo ARR won", values: monthsBack.map((m) => sum(own.filter((d) => d.status === "won" && d.motion === "New logo" && inM(d.booking, m)), (d) => d.arr)), fmt: money },
    { label: "Expansion ARR won", values: monthsBack.map((m) => sum(own.filter((d) => d.status === "won" && d.motion === "Expansion" && inM(d.booking, m)), (d) => d.arr)), fmt: money },
    { label: "Win rate (closed in the month)", values: monthsBack.map((m) => { const r = rates(own, m, m); return r.winRate; }), fmt: pct, heat: true },
  ];
  return {
    person: t, monthsBack, lines,
    sales: { newArr, quota, attainment: quota ? newArr / quota : null, expansionArr: sum(own.filter((d) => d.motion === "Expansion" && wonIn(d)), (d) => d.arr),
      winRate: rr.winRate, won: rr.won, closed: rr.closed, open: ownOpen.length,
      unhealthyShare: ownOpen.length ? ownOpen.filter((d) => d.unhealthy).length / ownOpen.length : null, pipe: sum(ownOpen, (d) => d.weightedHealthy) },
    sdr: { booked: bk.length, held, target, vsTarget: target ? held / target : null, won: booked.filter(wonIn).length, wonArr: sum(booked.filter(wonIn), (d) => d.arr) },
  };
}

function flagsFor(rep, teamWinRate) {
  const t = state.data.params.flags;
  const rampMonths = state.data.params.ramp.length - 1;
  const flags = [];
  if (rep.tenure <= rampMonths) flags.push({ label: "Ramp-up", tone: "neutral" });
  if (rep.tenure > rampMonths && rep.attainment < t.belowQuota) flags.push({ label: "Below quota", tone: "critical" });
  if (rep.winRate !== null && teamWinRate !== null && rep.winRate < teamWinRate * t.lowConversion) flags.push({ label: "Low conversion", tone: "serious" });
  if (rep.unhealthyShare !== null && rep.unhealthyShare > t.unhealthyShare) flags.push({ label: "Pipe needs cleaning", tone: "warning" });
  if (rep.sweepLosses >= t.sweepLosses) flags.push({ label: "Does not close out losses", tone: "serious" });
  return flags;
}

// ---------- rendering helpers ----------
const el = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const statusColor = (tone) => ({ good: "var(--good)", warning: "var(--warning)", serious: "var(--serious)", critical: "var(--critical)", neutral: "var(--text-muted)" }[tone]);
const attainmentTone = (a) => (a >= 1 ? "good" : a >= 0.5 ? "warning" : "critical");

const tooltip = el("tooltip");
function showTooltip(evt, html) {
  tooltip.innerHTML = html;
  tooltip.hidden = false;
  const pad = 14;
  const { innerWidth: w, innerHeight: h } = window;
  const rect = tooltip.getBoundingClientRect();
  let x = evt.clientX + pad;
  let y = evt.clientY + pad;
  if (x + rect.width > w - 8) x = evt.clientX - rect.width - pad;
  if (y + rect.height > h - 8) y = evt.clientY - rect.height - pad;
  tooltip.style.left = `${Math.max(8, x)}px`;
  tooltip.style.top = `${Math.max(8, y)}px`;
}
function hideTooltip() { tooltip.hidden = true; }
function bindTooltips(root, contentFor) {
  root.querySelectorAll("[data-tip]").forEach((node) => {
    node.addEventListener("mousemove", (e) => showTooltip(e, contentFor(node.dataset.tip)));
    node.addEventListener("mouseleave", hideTooltip);
  });
}
const ttRow = (label, value) => `<div class="tt-row"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;

function niceMax(v) {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  const n = v / exp;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * exp;
}

// Rounded-top bar anchored on the baseline (square bottom).
function barPath(x, y, w, h, r = 4) {
  if (h <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

// ---------- charts ----------
// Win-rate and average colour scale, the same as the Sheet: red, yellow, green.
function heat(v, lo, mid, hi) {
  if (v === null || v === undefined || Number.isNaN(v)) return "";
  const stops = [[lo, [244, 199, 195]], [mid, [252, 232, 178]], [hi, [183, 225, 205]]];
  const t = Math.max(lo, Math.min(hi, v));
  const [a, b] = t <= mid ? [stops[0], stops[1]] : [stops[1], stops[2]];
  const f = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0]);
  const c = a[1].map((x, i) => Math.round(x + (b[1][i] - x) * f));
  return `background:rgb(${c.join(",")})`;
}
const winHeat = (v) => heat(v, 0.2, 0.5, 0.8);
const quantile = (vals, q) => { const v = vals.filter((x) => x !== null).sort((x, y) => x - y); return v.length ? v[Math.min(v.length - 1, Math.floor(q * (v.length - 1)))] : 0; };

// ---------- small tables: by market, by deal type ----------
function renderMarkets(model) {
  const names = { FR: "France", US: "United States", Other: "Other", Unknown: "Unknown" };
  el("by-market").innerHTML = `<table class="plain mini"><thead><tr><th>Market</th><th class="num">Won</th><th class="num">Win rate</th><th class="num">Won ARR</th><th class="num">Open deals</th><th class="num">Healthy pipe</th></tr></thead><tbody>${
    model.markets.map((m) => `<tr><td>${names[m.label]}</td><td class="num">${m.won}</td><td class="num" style="${winHeat(m.winRate)}">${pct(m.winRate)}</td><td class="num">${money(m.wonArr)}</td><td class="num">${m.open}</td><td class="num">${money(m.pipe)}</td></tr>`).join("")}</tbody></table>`;
}

function renderDealTypes(model) {
  const avgs = model.dealTypes.map((t) => t.avg);
  const [lo, mid, hi] = [quantile(avgs, 0.1), quantile(avgs, 0.5), quantile(avgs, 0.9)];
  el("by-type").innerHTML = `<table class="plain mini"><thead><tr><th>Deal type</th><th>Motion</th><th class="num">Closed deals</th><th class="num">Won</th><th class="num">Win rate</th><th class="num">Won ARR</th><th class="num">Average won</th><th class="num">Open deals</th></tr></thead><tbody>${
    model.dealTypes.map((t) => `<tr><td>${esc(t.label)}</td><td>${t.motion}</td><td class="num">${t.closed}</td><td class="num">${t.won}</td><td class="num" style="${winHeat(t.winRate)}">${pct(t.winRate)}</td><td class="num">${money(t.wonArr)}</td><td class="num" style="${heat(t.avg, lo, mid, hi)}">${money(t.avg)}</td><td class="num">${t.open}</td></tr>`).join("")}</tbody></table>`;
}

// ---------- month by month: stacked chart (oldest first) and table (most recent first) ----------
const KIND_COLORS = { "New logo": "#0073ec", "Group rollout": "#3d93f0", Upsell: "#86b6ef", "Cross-sell": "#bcd6f4", Retention: "#d9d9d9" };
function renderMonthly(model) {
  const host = el("chart-month");
  const data = [...model.monthly].reverse();
  const W = Math.max(320, host.clientWidth);
  const H = 260;
  const m = { top: 12, right: 12, bottom: 28, left: 56 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const max = niceMax(Math.max(...data.map((d) => Math.max(d.total, d.quota))));
  const y = (v) => m.top + ih - (v / max) * ih;
  const band = iw / data.length;
  const bw = Math.min(34, band * 0.62);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Won ARR by deal type, month by month, against the new-logo quota">`;
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    svg += `<line x1="${m.left}" x2="${W - m.right}" y1="${y(v)}" y2="${y(v)}" stroke="var(--${i === 0 ? "axis" : "grid"})" stroke-width="1"/>`;
    svg += `<text x="${m.left - 8}" y="${y(v) + 4}" text-anchor="end">${compactMoney(v)}</text>`;
  }
  data.forEach((d, i) => {
    const x = m.left + band * i + (band - bw) / 2;
    let base = 0;
    KINDS.forEach((k) => {
      const v = d.byKind[k];
      if (v > 0) {
        const top = y(base + v); const h = y(base) - top;
        svg += `<rect x="${x}" y="${top}" width="${bw}" height="${Math.max(h - 1, 0.5)}" fill="${KIND_COLORS[k]}"/>`;
      }
      base += v;
    });
    svg += `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle" class="${d.month === model.to ? "label-strong" : ""}">${monthLabel(d.month)}</text>`;
    svg += `<rect x="${m.left + band * i}" y="${m.top}" width="${band}" height="${ih}" fill="transparent" data-tip="${i}"/>`;
  });
  if (model.team.quota !== null) {
    const pts = data.map((d, i) => `${m.left + band * i + band / 2},${y(d.quota)}`).join(" ");
    svg += `<polyline points="${pts}" fill="none" stroke="var(--text-primary)" stroke-width="2" stroke-dasharray="6 4" pointer-events="none"/>`;
  }
  host.innerHTML = svg + "</svg>";
  bindTooltips(host, (i) => {
    const d = data[Number(i)];
    return `<div class="tt-title">${monthLabel(d.month, true)}</div>${KINDS.map((k) => ttRow(k, money(d.byKind[k]))).join("")}${ttRow("Total", money(d.total))}${ttRow("New-logo quota", money(d.quota))}`;
  });
  el("legend-month").innerHTML = KINDS.map((k) => `<span><i class="swatch" style="background:${KIND_COLORS[k]}"></i>${k}</span>`).join("") +
    (model.team.quota !== null ? `<span><i class="swatch line dashed"></i>New-logo quota (team)</span>` : "");
  const months = model.monthly;
  const cell = (v) => `<td class="num">${money(v)}</td>`;
  el("month-table").innerHTML = `<table class="plain mini month"><thead><tr><th>Deal type</th>${months.map((d) => `<th class="num">${monthLabel(d.month)}</th>`).join("")}</tr></thead><tbody>${
    KINDS.map((k) => `<tr><td>${k}</td>${months.map((d) => cell(d.byKind[k])).join("")}</tr>`).join("")}
    <tr class="total"><td>Total won ARR</td>${months.map((d) => cell(d.total)).join("")}</tr>
    <tr class="quota"><td>New-logo quota (team)</td>${months.map((d) => cell(d.quota)).join("")}</tr>
    <tr class="att"><td>New logo vs quota</td>${months.map((d) => `<td class="num" style="${heat(d.attainment, 0.5, 0.8, 1)}">${pct(d.attainment)}</td>`).join("")}</tr></tbody></table>`;
}

function sparkline(trend, selectedMonth) {
  const W = 120, H = 28, gap = 2;
  const bw = (W - gap * (trend.length - 1)) / trend.length;
  const max = Math.max(1, ...trend.map((t) => t.value));
  const best = Math.max(...trend.map((t) => t.value));
  const bars = trend.map((t, i) => {
    const h = t.value > 0 ? Math.max(2, (t.value / max) * (H - 2)) : 0;
    const fill = t.value > 0 && t.value === best ? "var(--text-primary)" : "var(--series-1)";
    return h ? `<path d="${barPath(i * (bw + gap), H - h, bw, h, 1.5)}" fill="${fill}" opacity="${t.month === selectedMonth ? 1 : 0.8}"/>` : `<rect x="${i * (bw + gap)}" y="${H - 1}" width="${bw}" height="1" fill="var(--grid)"/>`;
  }).join("");
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">${bars}</svg>`;
}

// ---------- tiles ----------
function renderTiles(model) {
  const t = model.team;
  const att = t.quota ? t.quotaArr / t.quota : null;
  const tiles = [
    t.quota === null
      ? { label: "New-logo ARR", value: money(t.newArr), sub: "No quota: no AE team covers this country" }
      : { label: "New-logo ARR vs quota", value: pct(att), sub: t.quotaArr === t.newArr ? `${money(t.newArr)} of ${money(t.quota)}` : `${money(t.quotaArr)} by the ${state.country} team of ${money(t.quota)} · ${money(t.newArr)} signed on ${state.country} accounts`, meter: { value: att, tone: attainmentTone(att) } },
    { label: "Expansion ARR", value: money(t.expansionArr), sub: `${pct(t.expansionShare)} of won ARR · win rate ${pct(t.expansionWinRate)}` },
    { label: "Weighted healthy pipe", value: money(t.healthyPipe), sub: `${t.openDeals} open deals · ${pct(t.unhealthyShare)} unhealthy` },
    { label: "Win rate", value: pct(t.winRate), sub: `${t.wonCount} won of ${t.closed} closed · ${pct(t.winRateExSweep)} without the clean-up` },
  ];
  el("tiles").innerHTML = tiles.map((x) => `
    <div class="card tile">
      <span class="tile-label">${esc(x.label)}</span>
      <span class="tile-value">${esc(x.value)}</span>
      ${x.meter ? `<div class="meter" aria-hidden="true"><span style="width:${Math.min(100, x.meter.value * 100)}%;background:${statusColor(x.meter.tone)}"></span></div>` : ""}
      <span class="tile-sub">${esc(x.sub)}</span>
    </div>`).join("");
}

// ---------- pipe in progress ----------
function renderPipe(model) {
  const max = Math.max(1, ...model.stages.map((s) => s.deals));
  el("pipe").innerHTML = `
    <div class="hbar-head"><span>Stage</span><span>Open deals</span><span class="num">Healthy pipe</span><span class="num">Unhealthy</span><span class="num">Median age</span></div>
    ${model.stages.map((s, i) => `
      <div class="hbar-row" data-tip="${i}">
        <span class="hbar-label">${esc(s.stage)}</span>
        <span class="hbar-track"><span style="width:${(s.deals / max) * 100}%"></span><b>${s.deals}</b></span>
        <span class="num">${money(s.pipe)}</span>
        <span class="num ${s.unhealthyShare > state.data.params.flags.unhealthyShare ? "bad" : ""}">${pct(s.unhealthyShare)}</span>
        <span class="num ${s.medianAge > state.data.params.staleDays ? "bad" : ""}">${s.medianAge === null ? "–" : `${Math.round(s.medianAge)} d`}</span>
      </div>`).join("")}`;
  bindTooltips(el("pipe"), (i) => {
    const s = model.stages[Number(i)];
    return `<div class="tt-title">${esc(s.stage)}</div>${ttRow("Open deals", s.deals)}${ttRow("Forecast ARR (AE)", money(s.forecast))}${ttRow("Weighted healthy pipe", money(s.pipe))}${ttRow("Unhealthy share", pct(s.unhealthyShare))}${ttRow("Median age", s.medianAge === null ? "–" : `${Math.round(s.medianAge)} days`)}`;
  });
}

// ---------- what works ----------
function renderBreakdown(id, rows) {
  const max = Math.max(1, ...rows.map((r) => r.wonArr));
  const host = el(id);
  host.innerHTML = rows.length ? `
    <div class="hbar-head"><span></span><span>Won ARR</span><span class="num">Win rate</span><span class="num">Open</span></div>
    ${rows.map((r, i) => {
      const thin = r.closed < 5;
      return `<div class="hbar-row${r.grouped ? " grouped" : ""}" data-tip="${i}">
        <span class="hbar-label" title="${esc(r.label)}">${esc(r.label)}</span>
        <span class="hbar-track"><span style="width:${(r.wonArr / max) * 100}%"></span><b>${compactMoney(r.wonArr)}</b></span>
        <span class="num${thin ? " thin" : ""}" style="${thin ? "" : winHeat(r.winRate)}">${pct(r.winRate)}</span>
        <span class="num">${r.open}</span>
      </div>`;
    }).join("")}` : `<p class="muted">No deal for this selection.</p>`;
  bindTooltips(host, (i) => {
    const r = rows[Number(i)];
    return `<div class="tt-title">${esc(r.label)}</div>${ttRow("Won ARR", money(r.wonArr))}${ttRow("Won / closed", `${r.won} / ${r.closed}`)}${ttRow("Win rate", pct(r.winRate))}${ttRow("Average won", money(r.won ? r.wonArr / r.won : null))}${ttRow("Open deals", r.open)}${ttRow("Weighted healthy pipe", money(r.pipe))}`;
  });
}

// ---------- AE table ----------
function renderTable(model) {
  const head = `<thead><tr><th>AE</th><th>New-logo ARR vs quota</th><th>Win rate</th><th>Healthy pipe</th><th class="left">12-month trend</th><th class="left">Flag</th></tr></thead>`;
  const rows = model.reps.map((r) => {
    const ramping = r.tenure < state.data.params.ramp.length;
    const tone = ramping ? "neutral" : attainmentTone(r.attainment);
    return `<tr class="${ramping ? "ramping" : ""}">
      <td><span class="rep-name">${esc(r.name)}</span><span class="rep-meta">${esc(r.market)} · month ${r.tenure}</span></td>
      <td><span class="pct">${pct(r.attainment)}<span class="pct-bar" aria-hidden="true"><span style="width:${Math.min(100, r.attainment * 100)}%;background:${statusColor(tone)}"></span></span></span><span class="rep-meta">${money(r.newArr)} of ${money(r.quota)}</span></td>
      <td>${pct(r.winRate)}<span class="rep-meta">${r.closed} closed</span></td>
      <td>${money(r.healthyPipe)}<span class="rep-meta">${r.openDeals} open · ${pct(r.unhealthyShare)} unhealthy</span></td>
      <td class="left">${sparkline(r.trend, model.to)}</td>
      <td class="left"><span class="chips">${r.flags.map((f) => `<span class="chip"><i style="background:${statusColor(f.tone)}"></i>${esc(f.label)}</span>`).join("") || `<span class="muted">–</span>`}</span></td>
    </tr>`;
  }).join("");
  el("reps-table").innerHTML = head + `<tbody>${rows || `<tr><td colspan="6">No AE team covers this country.</td></tr>`}</tbody>`;
}

// ---------- SDRs ----------
function renderSdr(model) {
  const g = model.sdrGroups; const tot = g[2];
  el("sdr-split").innerHTML = `<table class="plain"><thead><tr><th class="left">Who booked the demo</th><th>Demos booked</th><th>Share of demos</th><th>Demos held</th><th>Held / booked</th><th>Won new-logo deals</th><th>Won new-logo ARR</th><th>Share of won ARR</th><th class="left">12-month trend</th></tr></thead><tbody>${
    g.map((r, i) => `<tr class="${i === 2 ? "total" : ""}"><td class="left">${esc(r.label)}</td><td class="num">${r.booked}</td><td class="num">${pct(tot.booked ? r.booked / tot.booked : null)}</td><td class="num">${r.held}</td><td class="num" style="${i < 2 ? heat(r.booked ? r.held / r.booked : null, 0.3, 0.5, 0.7) : ""}">${pct(r.booked ? r.held / r.booked : null)}</td><td class="num">${r.won}</td><td class="num">${money(r.wonArr)}</td><td class="num">${pct(tot.wonArr ? r.wonArr / tot.wonArr : null)}</td><td class="left">${sparkline(r.trend, model.to)}</td></tr>`).join("")}</tbody></table>`;
  el("sdr-table").innerHTML = `<thead><tr><th>SDR</th><th>Demos booked</th><th>Demos held</th><th>Target: held</th><th>Held vs target</th><th>Won new-logo ARR</th><th class="left">12-month trend (demos booked)</th></tr></thead><tbody>${
    model.sdrs.map((r) => `<tr><td><span class="rep-name">${esc(r.name)}</span><span class="rep-meta">since ${monthLabel(monthOf(r.start), true)}</span></td><td>${r.booked}</td><td>${r.held}</td><td>${r.target}</td><td style="${heat(r.vsTarget, 0.5, 0.9, 1.1)}">${pct(r.vsTarget)}</td><td>${money(r.wonArr)}</td><td class="left">${sparkline(r.trend, model.to)}</td></tr>`).join("") ||
    `<tr><td colspan="7">No SDR in seat for this team at the end of the period.</td></tr>`}</tbody>`;
}

// ---------- one person ----------
function renderPerson(model) {
  const host = el("person");
  if (!state.person) { host.hidden = true; return; }
  const v = personModel(state.person, model);
  const t = v.person; const s = v.sales; const d = v.sdr;
  const kv = (label, value, sub = "", style = "") => `<div class="kv"><span>${esc(label)}</span><b style="${style}">${esc(value)}</b><small>${esc(sub)}</small></div>`;
  host.hidden = false;
  host.innerHTML = `
    <div class="person-head"><h3>${esc(t.name)}</h3><span class="muted">${esc(t.role)} · ${esc(t.market)} · since ${monthLabel(monthOf(t.start), true)} · all countries, same period</span></div>
    <div class="person-cols">
      <div><p class="corr-title">As deal owner (Sales)</p>
        ${kv("New-logo ARR won", money(s.newArr))}
        ${kv("New-logo ARR vs quota", s.quota === null ? "–" : pct(s.attainment), s.quota === null ? "No new-logo quota: not an AE" : `of ${money(s.quota)}`, s.quota === null ? "" : heat(s.attainment, 0.5, 0.9, 1.1))}
        ${kv("Expansion ARR won", money(s.expansionArr))}
        ${kv("Win rate", pct(s.winRate), `${s.won} won of ${s.closed} closed`)}
        ${kv("Open deals", String(s.open), `${pct(s.unhealthyShare)} unhealthy`)}
        ${kv("Healthy weighted pipe", money(s.pipe))}
      </div>
      <div><p class="corr-title">As SDR (demos booked)</p>
        ${kv("Demos booked", String(d.booked), "New-logo deals created in the period")}
        ${kv("Demos held", String(d.held), "Of those, demo held so far")}
        ${kv("Target: demos held", String(d.target), "Monthly target × months in seat")}
        ${kv("Held vs target", pct(d.vsTarget), "", heat(d.vsTarget, 0.5, 0.9, 1.1))}
        ${kv("Won new-logo deals", String(d.won), "From demos they booked")}
        ${kv("Won new-logo ARR", money(d.wonArr))}
      </div>
    </div>
    <div class="table-scroll"><table class="plain mini"><thead><tr><th class="left"></th><th class="left">12-month trend</th>${v.monthsBack.map((m) => `<th>${monthLabel(m)}</th>`).join("")}</tr></thead><tbody>${
      v.lines.map((l) => `<tr><td class="left">${esc(l.label)}</td><td class="left">${sparkline(v.monthsBack.map((m, i) => ({ month: m, value: l.values[i] || 0 })).reverse(), model.to)}</td>${l.values.map((x) => `<td class="num" style="${l.heat ? heat(x, 0.2, 0.5, 0.8) : ""}">${l.fmt(x)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function renderNotes(model) {
  const t = model.team;
  const items = [
    `<strong>Country is the account's, not the AE's.</strong> The French team owns almost every deal, US accounts included: filtering on the AE's market would show nothing.`,
    `<strong>${t.sweepTotal} deals were closed lost for "no sales actions"</strong>, most of them in a pipeline clean-up (71 on 20-25 Jul 2026). Counted as losses: excluding them would reward leaving dead deals open.`,
    `<strong>Group rollouts typed as New</strong> are counted as expansion, otherwise they inflate new logos.`,
    `<strong>Source and specialty are typed by hand</strong>: specialty spellings are merged in PARAMS, empty values show as Unknown. Win rates on fewer than 5 closed deals are greyed out.`,
    `<strong>closing_probability is ignored</strong> (half empty, lost deals at 90%): the pipe is weighted by stage. <strong>Next steps are not maintained</strong>, so only a step more than ${state.data.params.graceDays} days late counts.`,
    `<strong>${t.nonAeDeals} deals are owned by non-AEs</strong> (Ops, AM, SDR): in the totals, out of the AE table.`,
  ];
  el("caveats").innerHTML = items.map((i) => `<li>${i}</li>`).join("");
}

function render() {
  const model = compute();
  const range = model.from === model.to ? monthLabel(model.to, true) : `${monthLabel(model.from, true)} – ${monthLabel(model.to, true)}`;
  const rateRange = model.rateFrom === model.from ? "same period" : `${monthLabel(model.rateFrom, true)} – ${monthLabel(model.to, true)}`;
  el("context-line").textContent =
    `${COUNTRY_LABEL[state.country]}  ·  Won ARR: ${range}  ·  Win rate: ${rateRange}  ·  Pipe as of ${new Date(state.data.asOf).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
  el("whatworks-sub").textContent = `Deals closed ${range}${state.motion === "All" ? "" : `, ${state.motion.toLowerCase()} only`}. Bar = won ARR; win rate = won / closed.`;
  renderTiles(model);
  renderPipe(model);
  renderMarkets(model);
  renderDealTypes(model);
  renderMonthly(model);
  renderBreakdown("by-source", model.sources);
  renderBreakdown("by-specialty", model.specialties);
  renderTable(model);
  renderSdr(model);
  renderPerson(model);
  renderNotes(model);
}

function fillSelect(select, options, value) {
  select.innerHTML = options.map((o) => `<option value="${esc(o.value)}"${o.value === value ? " selected" : ""}>${esc(o.label)}</option>`).join("");
}

// ---------- loading the published sheet ----------
// RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes.
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.filter((r) => r.some((v) => v !== "")).map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

const num = (v) => {
  if (v === undefined || v === "") return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isNaN(n) ? null : n;
};
const flag = (v) => num(v) === 1;
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}/.test(v || "") ? v.slice(0, 10) : null);

async function fetchTab(gid) {
  const { publishedId } = window.DASHBOARD_CONFIG;
  const url = `https://docs.google.com/spreadsheets/d/e/${publishedId}/pub?gid=${gid}&single=true&output=csv`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`tab gid=${gid} returned HTTP ${res.status} (is it published to the web?)`);
  return parseCsv(await res.text());
}


async function loadFromSheet() {
  const cfg = window.DASHBOARD_CONFIG;
  if (!cfg || !cfg.publishedId) throw new Error("publishedId is empty in config.js: publish the sheet tabs to the web first");
  const [dealRows, teamRows, paramRows] = await Promise.all([fetchTab(cfg.gids.deals), fetchTab(cfg.gids.team), fetchTab(cfg.gids.params)]);
  const kv = Object.fromEntries(paramRows.map((r) => [r.key, r.value]));
  const required = ["as_of", "quota_base", "rate_window_months", "stale_days", "grace_days", "ramp_1", "flag_below_quota", "flag_low_conversion", "flag_unhealthy_share", "flag_sweep_losses"];
  const missing = required.filter((k) => kv[k] === undefined || kv[k] === "");
  if (missing.length) throw new Error(`WEB_PARAMS is missing: ${missing.join(", ")}`);
  return {
    asOf: isoDate(kv.as_of),
    currency: /^[A-Z]{3}$/.test(kv.currency || "") ? kv.currency : "USD",
    params: {
      quotaBase: num(kv.quota_base),
      quotaSource: kv.quota_source === "Provided" ? "Provided" : "Recalculated",
      quotaProvidedRate: num(kv.quota_provided_rate) || 1,
      rateWindowMonths: num(kv.rate_window_months),
      staleDays: num(kv.stale_days),
      graceDays: num(kv.grace_days),
      ramp: Object.keys(kv).filter((k) => /^ramp_\d+$/.test(k)).sort((a, b) => num(a) - num(b)).map((k) => num(kv[k])),
      flags: {
        belowQuota: num(kv.flag_below_quota),
        lowConversion: num(kv.flag_low_conversion),
        unhealthyShare: num(kv.flag_unhealthy_share),
        sweepLosses: num(kv.flag_sweep_losses),
      },
    },
    team: teamRows.filter((r) => r.name).map((r) => ({
      name: r.name, role: r.role, market: r.market, start: isoDate(r.start_date), end: isoDate(r.end_date),
      quotaProvided: num(r.monthly_new_arr_quota_synthetic),
      demoTarget: num(r.monthly_demos_held_target_synthetic),
    })).filter((t) => t.start),
    deals: dealRows.filter((r) => r.deal_id).map((r) => ({
      owner: r.owner,
      role: r.owner_role,
      market: r.owner_market,
      status: r.status.toLowerCase(),
      motion: r.motion === "New logo" ? "New logo" : "Expansion",
      country: r.account_market || "Unknown",
      source: r.source || "Unknown",
      specialty: r.specialty || "Unknown",
      stage: r.stage,
      sweep: flag(r.is_sweep_loss),
      booking: isoDate(r.booking_date),
      arr: num(r.arr_won),
      forecast: flag(r.forecast_outlier) ? null : num(r.forecast_amt),
      reachedDemo: flag(r.reached_demo),
      unhealthy: flag(r.is_sick),
      age: num(r.open_age_days),
      kind: r.deal_kind || "Unknown",
      created: isoDate(r.created_date),
      sdr: r.sdr || "",
      weightedHealthy: num(r.weighted_pipe_healthy) || 0,
    })),
  };
}


async function init() {
  state.data = await loadFromSheet();
  setCurrency(state.data.currency);
  const asOfMonth = monthOf(state.data.asOf);
  const months = [...new Set(state.data.deals.filter((d) => d.booking).map((d) => monthOf(d.booking)))].sort().reverse();
  state.month = months.includes(addMonths(asOfMonth, -1)) ? addMonths(asOfMonth, -1) : months[0];
  const countries = ["All", "FR", "US", "Other", "Unknown"].filter((c) => c === "All" || state.data.deals.some((d) => d.country === c));

  fillSelect(el("filter-country"), countries.map((c) => ({ value: c, label: COUNTRY_LABEL[c] })), state.country);
  fillSelect(el("filter-period"), Object.entries(PERIOD_LABEL).map(([value, label]) => ({ value, label })), state.period);
  fillSelect(el("filter-month"), months.map((m) => ({ value: m, label: monthLabel(m, true) + (m === asOfMonth ? " (to date)" : "") })), state.month);
  fillSelect(el("filter-motion"), ["All", "New logo", "Expansion"].map((m) => ({ value: m, label: m === "All" ? "All deals" : m })), state.motion);
  const people = state.data.team.filter((t) => ["AE", "SDR", "AM"].includes(t.role)).sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
  fillSelect(el("filter-person"), [{ value: "", label: "Everyone" }, ...people.map((t) => ({ value: t.name, label: `${t.name} (${t.role})` }))], state.person);
  [["filter-country", "country"], ["filter-period", "period"], ["filter-month", "month"], ["filter-motion", "motion"], ["filter-person", "person"]].forEach(([id, key]) =>
    el(id).addEventListener("change", (e) => { state[key] = e.target.value; render(); }));

  let resizeTimer;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 150); });
  render();
}

init().catch((err) => {
  document.querySelector(".page").insertAdjacentHTML("afterbegin", `<p class="card">Could not load the Google Sheet: ${esc(err.message)}.</p>`);
});
