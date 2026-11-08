"use strict";

// TAM cockpit: displays the output of scripts/tam_dedup.py (data/tam_cockpit.json).
// Review decisions are kept in this browser (localStorage) and exported as CSV;
// in production they would be posted to an n8n workflow that writes to Attio.

const REVIEW_STORE = "vocca-tam-review-v1";
const AUTOMATION_CREATORS = ["API · enrichment pipeline", "API · n8n", "Attio · auto-created from email sync"];

const fmt = new Intl.NumberFormat("en-GB");
const eur = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : "–");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const el = (id) => document.getElementById(id);

let data;

// ---------- tabs ----------
function selectTab(name) {
  document.querySelectorAll('[role="tab"]').forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  document.querySelectorAll(".tab-panel").forEach((p) => { p.hidden = p.id !== `panel-${name}`; });
  if (location.hash !== `#${name}`) history.replaceState(null, "", `#${name}`);
}
document.querySelectorAll('[role="tab"]').forEach((b) => b.addEventListener("click", () => selectTab(b.dataset.tab)));
window.addEventListener("hashchange", () => {
  const name = location.hash.slice(1);
  if (["state", "after", "rules", "review"].includes(name)) selectTab(name);
});

// ---------- small components ----------
const tile = (label, value, sub, cls = "") => `
  <div class="card tile ${cls}"><span class="tile-label">${esc(label)}</span><span class="tile-value">${esc(value)}</span><span class="tile-sub">${sub}</span></div>`;

function barList(rows, { color = "var(--series-1)", max } = {}) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.value));
  return `<div class="bar-list">${rows.map((r) => `
    <div class="bar-row"><span class="label" title="${esc(r.label)}">${esc(r.label)}</span>
      <span class="track"><span style="width:${(r.value / m) * 100}%;background:${r.color || color}"></span></span>
      <span class="value">${fmt.format(r.value)}</span></div>`).join("")}</div>`;
}

function download(name, text, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(",")).join("\n");

// ---------- 1. current state ----------
const outOfMarketCount = (rel) => (rel.Invest || 0) + (rel.Partner || 0) + (rel.Media || 0);

function renderState() {
  const c = data.current;
  const rel = c.by_relationship || {};
  const outOfMarket = outOfMarketCount(rel);
  const s = data.summary;
  const noSiret = c.accounts - c.company_number_validated;
  const auto = Object.entries(data.duplicate_sources).filter(([k]) => AUTOMATION_CREATORS.includes(k)).reduce((t, [, v]) => t + v, 0);
  const dupTotal = Object.values(data.duplicate_sources).reduce((t, v) => t + v, 0);
  const siretParts = [
    { label: "Valid SIRET", value: c.siret_status.siret || 0, color: "var(--good)" },
    { label: "SIREN typed instead of SIRET", value: c.siret_status.siren_only || 0, color: "var(--warning)" },
    { label: "Missing", value: c.siret_status.missing || 0, color: "var(--critical)" },
    { label: "Malformed", value: c.siret_status.invalid || 0, color: "var(--serious)" },
  ];
  const hier = Object.entries(s.hierarchy_issues).map(([k, v]) => ({ label: k.replace(/_/g, " "), value: v }));

  el("panel-state").innerHTML = `
    <p class="lead">What the CRM looks like today, before any clean-up. Every figure is a count of records in the export.</p>
    <div class="tiles">
      ${tile("Accounts in Attio", fmt.format(c.accounts), `${fmt.format(c.by_type.Practice || 0)} practices · ${fmt.format(c.by_type.Group || 0)} groups · ${fmt.format(c.by_type.Superorga || 0)} networks · ${fmt.format(c.by_type.Missing || 0)} untyped`)}
      ${tile("No validated company number", pct(noSiret, c.accounts), `${fmt.format(noSiret)} accounts: no SIRET in France, no NPI in the US`, "alert")}
      ${tile("Certain duplicates", fmt.format(s.records_removed_by_auto_merge), `+ ${fmt.format(data.review.length)} pairs that need a human`, "alert")}
      ${tile("Outside the market", fmt.format(outOfMarket), `${fmt.format(rel.Invest || 0)} investors · ${fmt.format(rel.Partner || 0)} partners · ${fmt.format(rel.Media || 0)} media, mixed with prospects`, "alert")}
      ${tile("Contacts misplaced", fmt.format(s.contact_moves["email domain belongs to another account family"] || 0), `on the wrong account · ${fmt.format(c.contacts_without_company)} without company · ${fmt.format(c.contacts_on_group_level)} parked on a group`)}
      ${tile("Lifecycle / billing out of sync", fmt.format(c.by_lifecycle.Missing || 0), `accounts without lifecycle · ${fmt.format(c.billing_id_on_non_customers)} billing IDs on non-customers · ${fmt.format(c.customers_without_arr)} customers without ARR`)}
    </div>
    ${renderMarkets()}
    <div class="charts-2">
      <div class="card">
        <h3>France: site identifier (SIRET), ${fmt.format(c.fr_accounts)} accounts</h3>
        <div class="stack" role="img" aria-label="SIRET status">${siretParts.map((p) => `<span style="flex:${p.value};background:${p.color}" title="${esc(p.label)}: ${p.value}"></span>`).join("")}</div>
        ${barList(siretParts, { max: c.fr_accounts })}
        <p class="muted">${fmt.format(c.multi_site_sirens)} legal entities (SIREN) run several sites: SIREN cannot be the account key. ${fmt.format(c.calendar_coverage)} accounts have a booking-calendar URL, the best fallback key.</p>
      </div>
      <div class="card">
        <h3>Who created the duplicates</h3>
        <p class="muted" style="margin-top:0"><strong>${pct(auto, dupTotal)}</strong> of the certain duplicates were created by automations that insert instead of updating: cleaning once will not last.</p>
        ${barList(Object.entries(data.duplicate_sources).map(([k, v]) => ({ label: k, value: v, color: AUTOMATION_CREATORS.includes(k) ? "var(--series-1)" : "var(--axis)" })))}
      </div>
      <div class="card">
        <h3>Hierarchy issues</h3>
        ${barList(hier, { color: "var(--series-1)" })}
        <p class="muted">Site → group → network is broken: a group under a practice, records that are their own parent, groups with no site, practices that are really groups.</p>
      </div>
      <div class="card">
        <h3>Junk from enrichment</h3>
        <p class="tile-value">${fmt.format(c.junk_domains)}</p>
        <p class="muted">accounts whose "website" is a platform or a webmail (doctolib.fr, maiia.com, gmail.com…), and ${fmt.format(c.siret_checksum_failures)} SIRETs failing the checksum. Enrichment writes whatever it finds, unchecked.</p>
      </div>
    </div>`;
}

function renderMarkets() {
  const order = ["FR", "US", "Other", "Unknown"];
  const names = { FR: "France", US: "United States", Other: "Other countries", Unknown: "Unknown" };
  const markets = order.filter((m) => data.summary.markets[m]).map((m) => ({ key: m, ...data.summary.markets[m] }));
  const issueLabels = {
    owner_market_mismatch: "owned by the other market's team",
    out_of_tam: "investors, partners, media (out of TAM)",
    group_missing: "multi-site, no group",
    booking_url_wrong_country: "booking URL not available in the country",
    company_number_unverified: "company number fails validation",
    country_inferred: "country inferred from postcode",
    country_unknown: "country unknown",
  };
  const cell = (m, k) => fmt.format(m.issues[k] || 0);
  return `
    <h2>One model, read market by market</h2>
    <p class="lead" style="margin-top:0">The CRM carries one generic identity for every market: <strong>country + company number + number type</strong> (SIRET in France, NPI in the US), validated per type. Market-specific sources are joined into it upstream, in the warehouse.</p>
    <div class="card table-card"><div class="table-scroll"><table class="plain">
      <thead><tr><th>Market</th><th class="num">Accounts</th><th class="num">Customers</th><th class="num">Customer ARR</th><th class="num">Validated number</th><th class="num">No lifecycle</th>
        ${Object.keys(issueLabels).map((k) => `<th class="num" title="${esc(issueLabels[k])}">${esc(issueLabels[k])}</th>`).join("")}</tr></thead>
      <tbody>${markets.map((m) => `<tr>
        <td><strong>${names[m.key]}</strong><br><span class="muted">${Object.entries(m.countries).map(([k, v]) => `${k} ${v}`).join(" · ")}</span></td>
        <td class="num">${fmt.format(m.accounts)}</td><td class="num">${fmt.format(m.customers)}</td><td class="num">${eur.format(m.customer_arr_eur)}</td>
        <td class="num">${pct(m.validated_company_number, m.accounts)}</td><td class="num">${pct(m.without_lifecycle, m.accounts)}</td>
        ${Object.keys(issueLabels).map((k) => `<td class="num">${cell(m, k)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div></div>`;
}

// ---------- 2. after the scripts ----------
function renderAfter() {
  const c = data.current;
  const outOfMarket = outOfMarketCount(c.by_relationship || {});
  const s = data.summary;
  const autoActions = data.actions.filter((a) => a.mode === "auto");
  const manualActions = data.actions.filter((a) => a.mode === "manual");
  const manualTotal = manualActions.reduce((t, a) => t + a.count, 0);
  const row = (a) => `<tr>
      <td><strong>${esc(a.action)}</strong><br><span class="muted">${esc(a.detail)}</span></td>
      <td><span class="mode ${a.mode}">${a.mode === "auto" ? "Automatic" : "Manual"}</span></td>
      <td class="num">${fmt.format(a.count)}</td>
      <td class="prod">${esc(a.prod)}</td></tr>`;
  const examples = data.merge_examples.filter((m) => m.role === "merge_into_survivor").slice(0, 8).map((m) => {
    const survivor = data.merge_examples.find((x) => x.record_id === m.survivor_id) || {};
    return `<tr><td>${esc(m.name)}</td><td>${esc(m.siret)}</td><td>${esc(m.lifecycle || "–")}</td><td>→ ${esc(survivor.name || m.survivor_id)}</td><td>${esc(survivor.lifecycle || "–")}</td></tr>`;
  }).join("");

  el("panel-after").innerHTML = `
    <p class="lead">What running <code>tam_dedup.py</code> does to the base: automatic actions are safe by construction (no customer, no ownership conflict); everything else lands in a review queue.</p>
    <div class="compare">
      <div class="card"><span class="tile-label">Accounts</span><div class="from-to"><span class="from">${fmt.format(s.accounts_before)}</span><span class="arrow">→</span><span class="to">${fmt.format(s.accounts_after_auto_merge)}</span></div><span class="tile-sub">${fmt.format(s.records_removed_by_auto_merge)} duplicates merged into ${fmt.format(s.auto_merge_clusters)} survivors</span></div>
      <div class="card"><span class="tile-label">Accounts counted in the TAM by mistake</span><div class="from-to"><span class="from">${fmt.format(outOfMarket)}</span><span class="arrow">→</span><span class="to">0</span></div><span class="tile-sub">Investors, partners and media kept in Attio, excluded from TAM and SAM views</span></div>
      <div class="card"><span class="tile-label">Contacts on the wrong account</span><div class="from-to"><span class="from">${fmt.format(s.contact_moves["email domain belongs to another account family"] || 0)}</span><span class="arrow">→</span><span class="to">0</span></div><span class="tile-sub">Re-attached by work-email domain</span></div>
      <div class="card"><span class="tile-label">Left for a human</span><div class="from-to"><span class="to">${fmt.format(manualTotal)}</span></div><span class="tile-sub">items across ${manualActions.length} review queues, about 3 days with Sales</span></div>
    </div>

    <div class="card" style="margin-top:12px">
      <h3>The action pack</h3>
      <p class="muted" style="margin-top:0">One Excel file with everything the scripts produced: summary, rules, automatic merges with their survivor, the manual review queue, hierarchy fixes, contact moves and every candidate pair with the reason of its decision.</p>
      <div class="toolbar">
        <a class="btn primary" href="data/tam_action_pack.xlsx" download>Download the action pack (.xlsx)</a>
        <button class="btn" type="button" data-tab-link="review">Open the review queue</button>
      </div>
      <code class="cmd">python scripts/tam_dedup.py data out/tam web/data</code>
    </div>

    <h2>Actions</h2>
    <div class="card table-card"><div class="table-scroll"><table class="plain">
      <thead><tr><th>Action</th><th>Mode</th><th>Records</th><th>In production</th></tr></thead>
      <tbody>${autoActions.map(row).join("")}${manualActions.map(row).join("")}</tbody>
    </table></div></div>

    <h2>Examples of automatic merges</h2>
    <div class="card table-card"><div class="table-scroll"><table class="plain">
      <thead><tr><th>Duplicate</th><th>SIRET</th><th>Lifecycle</th><th>Merged into</th><th>Survivor lifecycle</th></tr></thead>
      <tbody>${examples}</tbody>
    </table></div></div>`;
  el("panel-after").querySelector("[data-tab-link]").addEventListener("click", () => selectTab("review"));
}

// ---------- 3. rules ----------
function renderRules() {
  const r = data.rules;
  el("panel-rules").innerHTML = `
    <p class="lead">The rules the script applies, in the order it applies them, with how many candidate pairs each one touched on this file.</p>
    <div class="charts-2">
      <div class="card">
        <h3>Matching keys, strongest first</h3>
        ${r.keys.map((k, i) => `
          <div class="rule-key"><span class="rank">${i + 1}</span>
            <div><strong>${esc(k.label)}</strong><br><span class="muted">${esc(k.role)}</span></div>
            <div class="stats"><b>${fmt.format(k.auto_merges)}</b> in merged pairs<br>${fmt.format(k.pairs)} candidate pairs</div></div>`).join("")}
        <p class="muted">A pair can match on several keys, so the columns overlap.</p>
        <p class="muted">US accounts: NPI (NPPES registry) plays the role of the SIRET.</p>
      </div>
      <div class="card">
        <h3>What is never merged automatically</h3>
        <table class="plain"><thead><tr><th>Guard</th><th>Pairs</th></tr></thead><tbody>
          ${r.guards.map((g) => `<tr><td><strong>${esc(g.rule)}</strong><br><span class="muted">${esc(g.why)}</span></td><td class="num">${fmt.format(g.pairs_blocked_or_routed)}</td></tr>`).join("")}
        </tbody></table>
        <h3 style="margin-top:16px">Survivor rule</h3>
        <p class="muted" style="margin-top:0">${esc(r.survivor_rule)}.</p>
        <h3>Why pairs were merged</h3>
        ${barList(r.auto_merge_reasons.map((x) => ({ label: x.reason, value: x.pairs })))}
      </div>
    </div>`;
}

// ---------- 4. manual review ----------
const loadDecisions = () => { try { return JSON.parse(localStorage.getItem(REVIEW_STORE)) || {}; } catch { return {}; } };
const saveDecisions = (d) => { try { localStorage.setItem(REVIEW_STORE, JSON.stringify(d)); } catch { /* storage unavailable: decisions live for this visit only */ } };
let decisions = {};
let reviewFilter = "all";
let hideDecided = false;

function recordHtml(rec, other) {
  const field = (label, key, value) => {
    const same = value && other[key] && String(value).toLowerCase() === String(other[key]).toLowerCase();
    return `<dt>${label}</dt><dd class="${same ? "same" : ""}">${esc(value || "–")}</dd>`;
  };
  const customer = rec.billing_id || rec.arr || rec.lifecycle === "Customer" || rec.lifecycle === "Churn";
  return `<div class="record">
    <h4>${esc(rec.name)}</h4>
    <dl>
      ${field("Type", "type", rec.type)}
      ${field("Lifecycle", "lifecycle", rec.lifecycle)}
      ${field("SIRET", "siret", rec.siret)}
      ${field("Location", "address", rec.address)}
      ${field("Phone", "phone", rec.phone)}
      ${field("Domain", "domains", rec.domains)}
      ${field("Calendar", "calendar", rec.calendar)}
      ${field("Owner", "owner", rec.owner)}
      <dt>Billing</dt><dd class="${customer ? "flag-customer" : ""}">${customer ? `Customer${rec.arr ? ` · ${eur.format(rec.arr)} ARR` : ""}${rec.billing_id ? " · billing ID" : ""}` : "–"}</dd>
      <dt>Deals</dt><dd>${rec.deals}${rec.open_deals.length ? ` (${rec.open_deals.length} open: ${esc(rec.open_deals.map((d) => d.owner).join(", "))})` : ""}</dd>
      <dt>Created by</dt><dd>${esc(rec.created_by || "–")}</dd>
    </dl></div>`;
}

function renderReview() {
  const items = data.review;
  const reasons = [...new Set(items.map((i) => i.reason))];
  const done = items.filter((i) => decisions[i.pair_id]);
  const merged = done.filter((i) => decisions[i.pair_id].decision.startsWith("merge")).length;
  const visible = items.filter((i) => (reviewFilter === "all" || i.reason === reviewFilter) && !(hideDecided && decisions[i.pair_id]));
  el("review-count").textContent = `${items.length - done.length}`;

  el("panel-review").innerHTML = `
    <p class="lead">Pairs the rules refuse to merge without a human: a customer is involved, there is no SIRET to confirm, or only the calendar matches. Fields in <span style="color:var(--brand);font-weight:600">blue</span> are identical on both records.</p>
    <div class="card">
      <div class="review-head"><strong>${done.length} / ${items.length} reviewed</strong><span class="muted">${merged} to merge · ${done.length - merged} kept separate</span></div>
      <div class="progress" aria-hidden="true"><span style="width:${(merged / items.length) * 100}%;background:var(--brand)"></span><span style="width:${((done.length - merged) / items.length) * 100}%;background:var(--axis)"></span></div>
      <div class="toolbar">
        <div class="filters"><label>Reason
          <select id="review-filter"><option value="all">All reasons (${items.length})</option>${reasons.map((r) => `<option value="${esc(r)}"${r === reviewFilter ? " selected" : ""}>${esc(r)} (${items.filter((i) => i.reason === r).length})</option>`).join("")}</select>
        </label></div>
        <label class="muted"><input type="checkbox" id="hide-decided"${hideDecided ? " checked" : ""}> Hide reviewed</label>
        <button class="btn primary" type="button" id="export-decisions"${done.length ? "" : " disabled"}>Export decisions (.csv)</button>
        <button class="btn danger" type="button" id="reset-decisions"${done.length ? "" : " disabled"}>Reset</button>
      </div>
      <p class="muted" style="margin:0">Decisions are saved in this browser. In production, each decision is posted to an n8n workflow that merges or tags the records in Attio and logs who decided.</p>
    </div>
    <div style="margin-top:12px">${visible.map((i) => {
      const d = decisions[i.pair_id];
      const label = d ? (d.decision === "separate" ? "Kept separate" : `Merge: keep ${d.decision === "merge_keep_a" ? "left" : "right"}`) : "";
      return `<div class="card review-card${d ? " decided" : ""}" data-pair="${esc(i.pair_id)}">
        <div class="review-head"><span class="review-reason">${esc(i.reason)}</span><span class="keys">${i.shared_keys.map((k) => `<span class="key">${esc(k.replace("_", " + "))}</span>`).join("")}</span></div>
        <div class="pair">${recordHtml(i.a, i.b)}${recordHtml(i.b, i.a)}</div>
        <div class="review-actions">
          <button class="btn" type="button" data-decide="merge_keep_a">Merge · keep left</button>
          <button class="btn" type="button" data-decide="merge_keep_b">Merge · keep right</button>
          <button class="btn" type="button" data-decide="separate">Keep separate</button>
          ${d ? `<span class="decision ${d.decision === "separate" ? "separate" : "merge"}">${label}</span><button class="btn" type="button" data-decide="undo">Undo</button>` : ""}
        </div></div>`;
    }).join("") || `<p class="muted">Nothing left to review with this filter.</p>`}</div>`;

  el("review-filter").addEventListener("change", (e) => { reviewFilter = e.target.value; renderReview(); });
  el("hide-decided").addEventListener("change", (e) => { hideDecided = e.target.checked; renderReview(); });
  el("export-decisions").addEventListener("click", exportDecisions);
  el("reset-decisions").addEventListener("click", () => {
    if (!confirm("Clear every review decision saved in this browser?")) return;
    decisions = {}; saveDecisions(decisions); renderReview();
  });
  el("panel-review").querySelectorAll("[data-decide]").forEach((btn) => btn.addEventListener("click", () => {
    const pair = btn.closest("[data-pair]").dataset.pair;
    if (btn.dataset.decide === "undo") delete decisions[pair];
    else decisions[pair] = { decision: btn.dataset.decide, at: new Date().toISOString() };
    saveDecisions(decisions);
    renderReview();
  }));
}

function exportDecisions() {
  const rows = [["record_a", "name_a", "record_b", "name_b", "reason", "decision", "survivor_id", "merged_id", "decided_at"]];
  data.review.forEach((i) => {
    const d = decisions[i.pair_id];
    if (!d) return;
    const keepA = d.decision === "merge_keep_a";
    const survivor = d.decision === "separate" ? "" : keepA ? i.a.id : i.b.id;
    const mergedId = d.decision === "separate" ? "" : keepA ? i.b.id : i.a.id;
    rows.push([i.a.id, i.a.name, i.b.id, i.b.name, i.reason, d.decision === "separate" ? "keep_separate" : "merge", survivor, mergedId, d.at]);
  });
  download("tam_review_decisions.csv", toCsv(rows));
}

// ---------- init ----------
async function init() {
  const res = await fetch("data/tam_cockpit.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`data/tam_cockpit.json returned HTTP ${res.status}`);
  data = await res.json();
  decisions = loadDecisions();
  renderState();
  renderAfter();
  renderRules();
  renderReview();
  const fromHash = location.hash.slice(1);
  selectTab(["state", "after", "rules", "review"].includes(fromHash) ? fromHash : "state");
}

init().catch((err) => {
  document.querySelector(".page").insertAdjacentHTML("afterbegin", `<p class="card">Could not load the cockpit data: ${esc(err.message)}.</p>`);
});
