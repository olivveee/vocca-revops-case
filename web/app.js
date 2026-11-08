"use strict";

// Presentation layer only. Every cleaning rule, the quota and the flag thresholds come
// from the Google Sheet (DEALS_CLEAN, RAW_team and WEB_PARAMS tabs, published as CSV),
// so a change in the sheet shows up here on the next page load. The breakdowns below
// (by country, stage, source, specialty) use the same definitions as the WHAT_WORKS tab.

const state = { data: null, month: null, country: "All", period: "ytd", motion: "All" };

const STAGES = ["Demo Scheduled", "Demo Held", "Qualified", "Quoted"];
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
    };
  });

  const newArr = sum(won.filter((d) => d.motion === "New logo"), (d) => d.arr);
  // Quota belongs to a team: compare it with what that team signed, not with every deal on the country's accounts.
  const quotaArr = teamMarket() ? sum(won.filter((d) => d.motion === "New logo" && d.market === teamMarket()), (d) => d.arr) : newArr;
  const expansionArr = sum(won.filter((d) => d.motion === "Expansion"), (d) => d.arr);
  const expansionRates = rates(all.filter((d) => d.motion === "Expansion"), rateFrom, to);
  return {
    from, to, rateFrom, months, reps, history, stages,
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
function renderArrChart(model) {
  const host = el("chart-arr");
  const W = Math.max(320, host.clientWidth);
  const H = 240;
  const m = { top: 12, right: 12, bottom: 28, left: 52 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const data = model.history;
  const max = niceMax(Math.max(...data.map((d) => Math.max(d.newArr, d.quota))));
  const y = (v) => m.top + ih - (v / max) * ih;
  const band = iw / data.length;
  const bw = Math.min(28, band * 0.6);

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly new-logo ARR against team quota">`;
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    svg += `<line x1="${m.left}" x2="${W - m.right}" y1="${y(v)}" y2="${y(v)}" stroke="var(--${i === 0 ? "axis" : "grid"})" stroke-width="1"/>`;
    svg += `<text x="${m.left - 8}" y="${y(v) + 4}" text-anchor="end">${compactMoney(v)}</text>`;
  }
  data.forEach((d, i) => {
    const cx = m.left + band * i + band / 2;
    const selected = d.month === model.to;
    svg += `<path d="${barPath(cx - bw / 2, y(d.newArr), bw, m.top + ih - y(d.newArr))}" fill="var(--series-1)" opacity="${selected ? 1 : 0.55}"/>`;
    if (i % 2 === 1 || data.length <= 6 || selected) {
      svg += `<text x="${cx}" y="${H - 8}" text-anchor="middle" class="${selected ? "label-strong" : ""}">${monthLabel(d.month)}</text>`;
    }
    svg += `<rect x="${m.left + band * i}" y="${m.top}" width="${band}" height="${ih}" fill="transparent" data-tip="${i}"/>`;
  });
  // Quota as a step line on the same axis (same unit, so one axis); none when no team covers the country.
  const showQuota = model.team.quota !== null;
  let path = "";
  data.forEach((d, i) => {
    const x0 = m.left + band * i;
    path += `${i === 0 ? "M" : "L"}${x0},${y(d.quota)}H${x0 + band}`;
  });
  if (showQuota) svg += `<path d="${path}" fill="none" stroke="var(--text-secondary)" stroke-width="2" pointer-events="none"/>`;
  svg += "</svg>";
  host.innerHTML = svg;
  bindTooltips(host, (i) => {
    const d = data[Number(i)];
    return `<div class="tt-title">${monthLabel(d.month, true)}</div>${ttRow("New-logo ARR", money(d.newArr))}${ttRow("Team quota", money(d.quota))}${ttRow("Attainment", pct(d.quota ? d.newArr / d.quota : null))}`;
  });
  el("legend-arr").innerHTML =
    `<span><i class="swatch" style="background:var(--series-1)"></i>New-logo ARR signed</span>` +
    (showQuota ? `<span><i class="swatch line" style="background:var(--text-secondary)"></i>Team quota</span>` : "");
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
    <div class="hbar-head"><span>Stage</span><span>Open deals</span><span class="num">Weighted pipe</span><span class="num">Unhealthy</span></div>
    ${model.stages.map((s, i) => `
      <div class="hbar-row" data-tip="${i}">
        <span class="hbar-label">${esc(s.stage)}</span>
        <span class="hbar-track"><span style="width:${(s.deals / max) * 100}%"></span><b>${s.deals}</b></span>
        <span class="num">${money(s.pipe)}</span>
        <span class="num ${s.unhealthyShare > state.data.params.flags.unhealthyShare ? "bad" : ""}">${pct(s.unhealthyShare)}</span>
      </div>`).join("")}`;
  bindTooltips(el("pipe"), (i) => {
    const s = model.stages[Number(i)];
    return `<div class="tt-title">${esc(s.stage)}</div>${ttRow("Open deals", s.deals)}${ttRow("Forecast ARR (AE)", money(s.forecast))}${ttRow("Weighted healthy pipe", money(s.pipe))}${ttRow("Unhealthy share", pct(s.unhealthyShare))}`;
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
        <span class="num${thin ? " thin" : r.winRate !== null && r.winRate < 0.25 ? " bad" : ""}">${pct(r.winRate)}</span>
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
  const head = `<thead><tr><th>AE</th><th>New-logo ARR vs quota</th><th>Win rate</th><th>Healthy pipe</th><th class="left">Flag</th></tr></thead>`;
  const rows = model.reps.map((r) => {
    const ramping = r.tenure < state.data.params.ramp.length;
    const tone = ramping ? "neutral" : attainmentTone(r.attainment);
    return `<tr class="${ramping ? "ramping" : ""}">
      <td><span class="rep-name">${esc(r.name)}</span><span class="rep-meta">${esc(r.market)} · month ${r.tenure}</span></td>
      <td><span class="pct">${pct(r.attainment)}<span class="pct-bar" aria-hidden="true"><span style="width:${Math.min(100, r.attainment * 100)}%;background:${statusColor(tone)}"></span></span></span><span class="rep-meta">${money(r.newArr)} of ${money(r.quota)}</span></td>
      <td>${pct(r.winRate)}<span class="rep-meta">${r.closed} closed</span></td>
      <td>${money(r.healthyPipe)}<span class="rep-meta">${r.openDeals} open · ${pct(r.unhealthyShare)} unhealthy</span></td>
      <td class="left"><span class="chips">${r.flags.map((f) => `<span class="chip"><i style="background:${statusColor(f.tone)}"></i>${esc(f.label)}</span>`).join("") || `<span class="muted">–</span>`}</span></td>
    </tr>`;
  }).join("");
  el("reps-table").innerHTML = head + `<tbody>${rows || `<tr><td colspan="5">No AE team covers this country.</td></tr>`}</tbody>`;
}

function renderNotes(model) {
  const t = model.team;
  const items = [
    `<strong>Country is the account's, not the AE's.</strong> The French team owns almost every deal, US accounts included: filtering on the AE's market would show nothing.`,
    `<strong>${t.sweepTotal} deals were closed lost in one sweep</strong> (20-25 Jul 2026, "no sales actions"). Counted as losses: excluding them would reward leaving dead deals open.`,
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
  renderArrChart(model);
  renderPipe(model);
  renderBreakdown("by-source", model.sources);
  renderBreakdown("by-specialty", model.specialties);
  renderTable(model);
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
  [["filter-country", "country"], ["filter-period", "period"], ["filter-month", "month"], ["filter-motion", "motion"]].forEach(([id, key]) =>
    el(id).addEventListener("change", (e) => { state[key] = e.target.value; render(); }));

  let resizeTimer;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 150); });
  render();
}

init().catch((err) => {
  document.querySelector(".page").insertAdjacentHTML("afterbegin", `<p class="card">Could not load the Google Sheet: ${esc(err.message)}.</p>`);
});
