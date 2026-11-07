"use strict";

// Presentation layer only. Every cleaning rule, the quota and the flag thresholds come
// from the Google Sheet (DEALS_CLEAN, RAW_team and WEB_PARAMS tabs, published as CSV),
// so a change in the sheet shows up here on the next page load.

const state = { data: null, month: null, market: "All", pipeline: "All" };

const eur = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const pct = (v) => (v === null || Number.isNaN(v) ? "–" : `${Math.round(v * 100)}%`);
const money = (v) => (v === null || Number.isNaN(v) ? "–" : eur.format(v));
const compactMoney = (v) => {
  if (Math.abs(v) >= 1e6) return `€${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `€${Math.round(v / 1e3)}k`;
  return `€${Math.round(v)}`;
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

// ---------- calculations ----------
const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);

function filteredDeals({ byMarket }) {
  return state.data.deals.filter((d) =>
    (state.pipeline === "All" || d.pipeline === state.pipeline) &&
    (!byMarket || state.market === "All" || d.market === state.market));
}

function aesInSeat(month) {
  return state.data.team.filter((t) =>
    t.role === "AE" &&
    monthOf(t.start) <= month &&
    (t.end === null || monthOf(t.end) >= month) &&
    (state.market === "All" || t.market === state.market));
}

function tenure(ae, month) {
  return monthDiff(monthOf(ae.start), month) + 1;
}

function quotaFor(ae, month, base) {
  const ramp = state.data.params.ramp;
  return base * ramp[Math.min(tenure(ae, month), ramp.length) - 1];
}

function rates(deals, from, to) {
  const closed = deals.filter((d) => d.status !== "open" && inMonths(d.booking, from, to));
  const won = closed.filter((d) => d.status === "won");
  const sweep = closed.filter((d) => d.sweep).length;
  const afterDemo = closed.filter((d) => d.reachedDemo);
  return {
    winRate: closed.length ? won.length / closed.length : null,
    winRateExSweep: closed.length - sweep ? won.length / (closed.length - sweep) : null,
    demoToWon: afterDemo.length ? won.length / afterDemo.length : null,
    avgDeal: won.length ? sum(won, (d) => d.arr) / won.length : null,
    closed: closed.length,
    won: won.length,
  };
}

function compute() {
  const month = state.month;
  const winFrom = addMonths(month, -(state.data.params.rateWindowMonths - 1));
  const quotaBase = state.data.params.quotaBase;
  const teamDeals = filteredDeals({ byMarket: true });
  const allDeals = filteredDeals({ byMarket: false });

  const monthDeals = teamDeals.filter((d) => d.status === "won" && d.booking && monthOf(d.booking) === month);
  const open = teamDeals.filter((d) => d.status === "open");
  const teamRates = rates(teamDeals, winFrom, month);

  const reps = aesInSeat(month).sort((a, b) => a.name.localeCompare(b.name)).map((ae) => {
    const own = allDeals.filter((d) => d.owner === ae.name);
    const won = own.filter((d) => d.status === "won" && d.booking && monthOf(d.booking) === month);
    const ownOpen = own.filter((d) => d.status === "open");
    const r = rates(own, winFrom, month);
    const quota = quotaFor(ae, month, quotaBase);
    const newArr = sum(won.filter((d) => d.motion === "new"), (d) => d.arr);
    const trend = Array.from({ length: 12 }, (_, i) => {
      const m = addMonths(month, i - 11);
      return { month: m, value: sum(own.filter((d) => d.status === "won" && d.motion === "new" && d.booking && monthOf(d.booking) === m), (d) => d.arr) };
    });
    const rep = {
      name: ae.name,
      market: ae.market,
      tenure: tenure(ae, month),
      quota,
      newArr,
      attainment: quota ? newArr / quota : 0,
      expansionArr: sum(won.filter((d) => d.motion === "expansion"), (d) => d.arr),
      winRate: r.winRate,
      demoToWon: r.demoToWon,
      avgDeal: r.avgDeal,
      healthyPipe: sum(ownOpen, (d) => d.weightedHealthy),
      openDeals: ownOpen.length,
      unhealthyDeals: ownOpen.filter((d) => d.unhealthy).length,
      unhealthyShare: ownOpen.length ? ownOpen.filter((d) => d.unhealthy).length / ownOpen.length : null,
      sweepLosses: own.filter((d) => d.sweep).length,
      trend,
    };
    rep.flags = flagsFor(rep, teamRates.winRate);
    return rep;
  });

  const history = Array.from({ length: 12 }, (_, i) => {
    const m = addMonths(month, i - 11);
    const r = rates(teamDeals, addMonths(m, -(state.data.params.rateWindowMonths - 1)), m);
    return {
      month: m,
      newArr: sum(teamDeals.filter((d) => d.status === "won" && d.motion === "new" && d.booking && monthOf(d.booking) === m), (d) => d.arr),
      quota: sum(aesInSeat(m), (ae) => quotaFor(ae, m, quotaBase)),
      winRate: r.winRate,
      winRateExSweep: r.winRateExSweep,
    };
  });

  return {
    month, winFrom, quotaBase, reps, history,
    team: {
      winRate: teamRates.winRate,
      winRateExSweep: teamRates.winRateExSweep,
      newArr: sum(monthDeals.filter((d) => d.motion === "new"), (d) => d.arr),
      expansionArr: sum(monthDeals.filter((d) => d.motion === "expansion"), (d) => d.arr),
      won: monthDeals.length,
      avgDeal: monthDeals.length ? sum(monthDeals, (d) => d.arr) / monthDeals.length : null,
      quota: sum(reps, (r) => r.quota),
      healthyPipe: sum(open, (d) => d.weightedHealthy),
      rawPipe: sum(open, (d) => d.forecast),
      openDeals: open.length,
      unhealthyDeals: open.filter((d) => d.unhealthy).length,
      outsideAe: sum(monthDeals.filter((d) => d.role !== "AE"), (d) => d.arr),
      sweepTotal: teamDeals.filter((d) => d.sweep).length,
      nonAeDeals: teamDeals.filter((d) => d.role !== "AE").length,
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
  if (!flags.length) flags.push({ label: "OK", tone: "good" });
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
    const selected = d.month === model.month;
    svg += `<path d="${barPath(cx - bw / 2, y(d.newArr), bw, m.top + ih - y(d.newArr))}" fill="var(--series-1)" opacity="${selected ? 1 : 0.55}"/>`;
    if (i % 2 === 1 || data.length <= 6 || selected) {
      svg += `<text x="${cx}" y="${H - 8}" text-anchor="middle" class="${selected ? "label-strong" : ""}">${monthLabel(d.month)}</text>`;
    }
    svg += `<rect x="${m.left + band * i}" y="${m.top}" width="${band}" height="${ih}" fill="transparent" data-tip="${i}"/>`;
  });
  // Quota as a step line on the same axis (same unit, so one axis).
  let path = "";
  data.forEach((d, i) => {
    const x0 = m.left + band * i;
    path += `${i === 0 ? "M" : "L"}${x0},${y(d.quota)}H${x0 + band}`;
  });
  svg += `<path d="${path}" fill="none" stroke="var(--text-secondary)" stroke-width="2" pointer-events="none"/>`;
  svg += "</svg>";
  host.innerHTML = svg;
  bindTooltips(host, (i) => {
    const d = data[Number(i)];
    return `<div class="tt-title">${monthLabel(d.month, true)}</div>${ttRow("New-logo ARR", money(d.newArr))}${ttRow("Team quota", money(d.quota))}${ttRow("Attainment", pct(d.quota ? d.newArr / d.quota : null))}`;
  });
  el("legend-arr").innerHTML =
    `<span><i class="swatch" style="background:var(--series-1)"></i>New-logo ARR signed</span>` +
    `<span><i class="swatch line" style="background:var(--text-secondary)"></i>Team quota</span>`;
}

function renderWinChart(model) {
  const host = el("chart-win");
  const W = Math.max(320, host.clientWidth);
  const H = 240;
  const m = { top: 12, right: 64, bottom: 28, left: 40 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const data = model.history;
  const x = (i) => m.left + (iw / (data.length - 1)) * i;
  const y = (v) => m.top + ih - v * ih;
  const series = [
    { key: "winRate", label: "Clean-up counted as losses", color: "var(--series-1)" },
    { key: "winRateExSweep", label: "Excluding the clean-up", color: "var(--series-2)" },
  ];

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Rolling 3-month win rate">`;
  [0, 0.25, 0.5, 0.75, 1].forEach((v) => {
    svg += `<line x1="${m.left}" x2="${W - m.right}" y1="${y(v)}" y2="${y(v)}" stroke="var(--${v === 0 ? "axis" : "grid"})" stroke-width="1"/>`;
    svg += `<text x="${m.left - 8}" y="${y(v) + 4}" text-anchor="end">${pct(v)}</text>`;
  });
  data.forEach((d, i) => {
    if (i % 2 === 1 || d.month === model.month) {
      svg += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="${d.month === model.month ? "label-strong" : ""}">${monthLabel(d.month)}</text>`;
    }
  });
  const ends = [];
  // Draw the headline series last so it stays on top where the lines overlap.
  [...series].reverse().forEach((s) => {
    const pts = data.map((d, i) => (d[s.key] === null ? null : [x(i), y(d[s.key])]));
    let p = "";
    pts.forEach((pt, i) => { if (pt) p += `${p && pts[i - 1] ? "L" : "M"}${pt[0]},${pt[1]}`; });
    svg += `<path d="${p}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const last = [...pts].reverse().find(Boolean);
    if (last) {
      svg += `<circle cx="${last[0]}" cy="${last[1]}" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`;
      ends.push({ y: last[1], text: pct(data[data.length - 1][s.key]), color: s.color });
    }
  });
  // Direct labels at the line ends, nudged apart if they collide.
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
  ends.forEach((e) => { svg += `<text x="${W - m.right + 10}" y="${e.y + 4}" class="label-strong">${e.text}</text>`; });
  const band = iw / (data.length - 1);
  data.forEach((d, i) => {
    svg += `<rect x="${x(i) - band / 2}" y="${m.top}" width="${band}" height="${ih}" fill="transparent" data-tip="${i}"/>`;
  });
  svg += `<line id="win-cross" x1="0" x2="0" y1="${m.top}" y2="${m.top + ih}" stroke="var(--axis)" stroke-width="1" visibility="hidden" pointer-events="none"/>`;
  svg += "</svg>";
  host.innerHTML = svg;
  const cross = host.querySelector("#win-cross");
  host.querySelectorAll("[data-tip]").forEach((node) => {
    node.addEventListener("mouseenter", () => {
      const xi = x(Number(node.dataset.tip));
      cross.setAttribute("x1", xi); cross.setAttribute("x2", xi); cross.setAttribute("visibility", "visible");
    });
    node.addEventListener("mouseleave", () => cross.setAttribute("visibility", "hidden"));
  });
  bindTooltips(host, (i) => {
    const d = data[Number(i)];
    return `<div class="tt-title">3 months to ${monthLabel(d.month, true)}</div>${ttRow("Win rate", pct(d.winRate))}${ttRow("Excluding clean-up", pct(d.winRateExSweep))}`;
  });
  el("legend-win").innerHTML = series.map((s) => `<span><i class="swatch line" style="background:${s.color}"></i>${s.label}</span>`).join("");
}

function renderHealthChart(model) {
  const host = el("chart-health");
  const reps = model.reps.filter((r) => r.openDeals > 0).sort((a, b) => b.openDeals - a.openDeals);
  const W = Math.max(320, host.clientWidth);
  const rowH = 26;
  const m = { top: 4, right: 48, bottom: 8, left: 120 };
  const H = m.top + m.bottom + rowH * Math.max(reps.length, 1);
  const iw = W - m.left - m.right;
  const max = Math.max(1, ...reps.map((r) => r.openDeals));
  const xs = (v) => (v / max) * iw;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Healthy and unhealthy open deals per AE">`;
  reps.forEach((r, i) => {
    const yy = m.top + i * rowH;
    const healthy = r.openDeals - r.unhealthyDeals;
    const bh = 14;
    const by = yy + (rowH - bh) / 2;
    svg += `<text x="${m.left - 10}" y="${by + 11}" text-anchor="end" class="label-strong">${esc(r.name)}</text>`;
    const wh = xs(healthy);
    const wu = xs(r.unhealthyDeals);
    if (wh > 0) svg += `<rect x="${m.left}" y="${by}" width="${Math.max(wh - 1, 1)}" height="${bh}" rx="2" fill="var(--good)"/>`;
    if (wu > 0) svg += `<rect x="${m.left + wh + (wh > 0 ? 1 : 0)}" y="${by}" width="${Math.max(wu - (wh > 0 ? 1 : 0), 1)}" height="${bh}" rx="2" fill="var(--critical)"/>`;
    svg += `<text x="${m.left + wh + wu + 8}" y="${by + 11}">${pct(r.unhealthyShare)}</text>`;
    svg += `<rect x="0" y="${yy}" width="${W}" height="${rowH}" fill="transparent" data-tip="${i}"/>`;
  });
  svg += "</svg>";
  host.innerHTML = reps.length ? svg : `<p class="muted">No open deals for this selection.</p>`;
  bindTooltips(host, (i) => {
    const r = reps[Number(i)];
    return `<div class="tt-title">${esc(r.name)}</div>${ttRow("Open deals", r.openDeals)}${ttRow("Healthy", r.openDeals - r.unhealthyDeals)}${ttRow("Unhealthy", r.unhealthyDeals)}${ttRow("Healthy weighted pipe", money(r.healthyPipe))}`;
  });
  el("legend-health").innerHTML =
    `<span><i class="swatch" style="background:var(--good)"></i>Healthy open deals</span>` +
    `<span><i class="swatch" style="background:var(--critical)"></i>Unhealthy open deals</span>`;
}

function sparkline(trend, selectedMonth) {
  const W = 120, H = 28, gap = 2;
  const bw = (W - gap * (trend.length - 1)) / trend.length;
  const max = Math.max(1, ...trend.map((t) => t.value));
  const bars = trend.map((t, i) => {
    const h = t.value > 0 ? Math.max(2, (t.value / max) * (H - 2)) : 0;
    const op = t.month === selectedMonth ? 1 : 0.5;
    return h ? `<path d="${barPath(i * (bw + gap), H - h, bw, h, 1.5)}" fill="var(--series-1)" opacity="${op}"/>` : `<rect x="${i * (bw + gap)}" y="${H - 1}" width="${bw}" height="1" fill="var(--grid)"/>`;
  }).join("");
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">${bars}</svg>`;
}

// ---------- tiles, table, notes ----------
function renderTiles(model) {
  const t = model.team;
  const att = t.quota ? t.newArr / t.quota : 0;
  const tiles = [
    { label: "New-logo ARR (month)", value: money(t.newArr), sub: `${pct(att)} of team quota (${money(t.quota)})`, meter: { value: att, tone: attainmentTone(att) } },
    { label: "Expansion ARR (month)", value: money(t.expansionArr), sub: "Group rollouts, upsell, cross-sell" },
    { label: "Deals won (month)", value: String(t.won), sub: `avg deal ${money(t.avgDeal)}` },
    { label: "Win rate (3-month rolling)", value: pct(t.winRate), sub: `excluding bulk clean-up: ${pct(t.winRateExSweep)}` },
    { label: "Healthy weighted pipe", value: money(t.healthyPipe), sub: `out of ${money(t.rawPipe)} raw open pipe` },
    { label: "Unhealthy open pipe", value: pct(t.openDeals ? t.unhealthyDeals / t.openDeals : null), sub: `${t.unhealthyDeals} of ${t.openDeals} open deals` },
    { label: "Outside AE table (month)", value: money(t.outsideAe), sub: "Signed on deals owned by Ops / AM / SDR" },
  ];
  el("tiles").innerHTML = tiles.map((x) => `
    <div class="card tile">
      <span class="tile-label">${esc(x.label)}</span>
      <span class="tile-value">${esc(x.value)}</span>
      ${x.meter ? `<div class="meter" aria-hidden="true"><span style="width:${Math.min(100, x.meter.value * 100)}%;background:${statusColor(x.meter.tone)}"></span></div>` : ""}
      <span class="tile-sub">${esc(x.sub)}</span>
    </div>`).join("");
}

function renderTable(model) {
  const head = `<thead><tr>
    <th>AE</th><th class="left">Flag</th><th>Quota</th><th>New-logo ARR</th><th>% of quota</th><th class="left">12-month trend</th>
    <th>Expansion ARR</th><th>Win rate 3m</th><th>Demo → won 3m</th><th>Avg deal 3m</th>
    <th>Healthy pipe</th><th>Open deals</th><th>% unhealthy</th><th>Clean-up losses</th>
  </tr></thead>`;
  const rows = model.reps.map((r) => {
    const tone = attainmentTone(r.attainment);
    const ramping = r.tenure < state.data.params.ramp.length;
    return `<tr class="${ramping ? "ramping" : ""}">
      <td><span class="rep-name">${esc(r.name)}</span><span class="rep-meta">${esc(r.market)} · month ${r.tenure}</span></td>
      <td class="left"><span class="chips">${r.flags.map((f) => `<span class="chip"><i style="background:${statusColor(f.tone)}"></i>${esc(f.label)}</span>`).join("")}</span></td>
      <td>${money(r.quota)}</td>
      <td>${money(r.newArr)}</td>
      <td><span class="pct">${pct(r.attainment)}<span class="pct-bar" aria-hidden="true"><span style="width:${Math.min(100, r.attainment * 100)}%;background:${statusColor(ramping ? "neutral" : tone)}"></span></span></span></td>
      <td class="left">${sparkline(r.trend, model.month)}</td>
      <td>${money(r.expansionArr)}</td>
      <td>${pct(r.winRate)}</td>
      <td>${pct(r.demoToWon)}</td>
      <td>${money(r.avgDeal)}</td>
      <td>${money(r.healthyPipe)}</td>
      <td>${r.openDeals}</td>
      <td>${pct(r.unhealthyShare)}</td>
      <td>${r.sweepLosses}</td>
    </tr>`;
  }).join("");
  el("reps-table").innerHTML = head + `<tbody>${rows || `<tr><td colspan="14">No AE in seat for this selection.</td></tr>`}</tbody>`;
}

function renderNotes(model) {
  const t = model.team;
  const items = [
    `<strong>close_date is not a close date.</strong> It is filled on most open deals as an expected date, so "closed" is read from the stage only.`,
    `<strong>${t.sweepTotal} deals were closed lost in one sweep</strong> (20-25 Jul 2026, "no sales actions"). Counted as the AE's losses: excluding them would reward leaving dead deals open.`,
    `<strong>Group rollouts typed as New</strong> are reclassified as expansion, otherwise they inflate new logos.`,
    `<strong>${t.nonAeDeals} deals are owned by non-AEs</strong> (Ops, AM, SDR): kept in team totals, out of the AE table.`,
    `<strong>closing_probability is ignored</strong> (half empty, lost deals at 90%): the pipe is weighted by stage. <strong>Next steps are not maintained</strong> (none in the future), so only a step more than ${state.data.params.graceDays} days late counts.`,
    `<strong>Sales cycle is left out</strong>: deals are often created at signature.`,
  ];
  el("caveats").innerHTML = items.map((i) => `<li>${i}</li>`).join("");
}

function render() {
  const model = compute();
  const p = state.data.params;
  el("health-sub").textContent = `Unhealthy = older than ${p.staleDays} days, or next step / expected close more than ${p.graceDays} days late`;
  el("context-line").textContent =
    `Volumes: ${monthLabel(model.month, true)}  ·  Rates: ${monthLabel(model.winFrom, true)} – ${monthLabel(model.month, true)}  ·  Pipe as of ${new Date(state.data.asOf).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}  ·  Quota base ${money(model.quotaBase)} per tenured AE per month`;
  renderTiles(model);
  renderArrChart(model);
  renderWinChart(model);
  renderTable(model);
  renderHealthChart(model);
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
    params: {
      quotaBase: num(kv.quota_base),
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
    })).filter((t) => t.start),
    deals: dealRows.filter((r) => r.deal_id).map((r) => ({
      owner: r.owner,
      role: r.owner_role,
      market: r.owner_market,
      status: r.status.toLowerCase(),
      motion: r.motion === "New logo" ? "new" : "expansion",
      sweep: flag(r.is_sweep_loss),
      booking: isoDate(r.booking_date),
      arr: num(r.arr_won_eur),
      forecast: flag(r.forecast_outlier) ? null : num(r.forecast_eur),
      reachedDemo: flag(r.reached_demo),
      unhealthy: flag(r.is_sick),
      weightedHealthy: num(r.weighted_pipe_healthy) || 0,
      pipeline: r.pipeline || "Sales",
    })),
  };
}

async function init() {
  state.data = await loadFromSheet();
  const asOfMonth = monthOf(state.data.asOf);
  const months = [...new Set(state.data.deals.filter((d) => d.booking).map((d) => monthOf(d.booking)))].sort().reverse();
  state.month = months.includes(addMonths(asOfMonth, -1)) ? addMonths(asOfMonth, -1) : months[0];
  const markets = ["All", ...new Set(state.data.team.map((t) => t.market).filter(Boolean))];
  const pipelines = ["All", ...new Set(state.data.deals.map((d) => d.pipeline))];

  fillSelect(el("filter-month"), months.map((m) => ({ value: m, label: monthLabel(m, true) + (m === asOfMonth ? " (to date)" : "") })), state.month);
  fillSelect(el("filter-market"), markets.map((m) => ({ value: m, label: m })), state.market);
  fillSelect(el("filter-pipeline"), pipelines.map((p) => ({ value: p, label: p })), state.pipeline);
  el("filter-month").addEventListener("change", (e) => { state.month = e.target.value; render(); });
  el("filter-market").addEventListener("change", (e) => { state.market = e.target.value; render(); });
  el("filter-pipeline").addEventListener("change", (e) => { state.pipeline = e.target.value; render(); });

  let resizeTimer;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 150); });
  render();
}

init().catch((err) => {
  document.querySelector(".page").insertAdjacentHTML("afterbegin", `<p class="card">Could not load the Google Sheet: ${esc(err.message)}.</p>`);
});
