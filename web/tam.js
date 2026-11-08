"use strict";

// TAM cockpit: a work tool on top of 1B_tam_mapping/tam_dedup.py (data/tam_cockpit.json).
// Work queues -> the detailed list behind each queue (explorer) -> quality by source -> pair review.
// Review decisions are kept in this browser (localStorage) and exported as CSV;
// in production they would be posted to an n8n workflow that writes to Attio.

const REVIEW_STORE = "vocca-tam-review-v1";
const PAGE_SIZE = 100;

const fmt = new Intl.NumberFormat("en-GB");
const eur = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : "–");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const el = (id) => document.getElementById(id);

// One entry per work queue. `mode` says who acts: the script, a person, or a decision to take with Sales.
const QUEUES = [
  { code: "dup_certain", section: "Identity and duplicates", label: "Certain duplicates", hint: "same validated number, or calendar confirmed by a second key", mode: "auto", owner: "Script",
    action: "Merge into the survivor", rule: "Same validated company number and type, or same calendar plus a second key, or same SIREN + name + postcode. Never a customer, never two owners. Survivor: customer, most deals, most contacts, most complete, oldest." },
  { code: "dup_review", section: "Identity and duplicates", label: "Pairs to decide", hint: "customer involved, two numbers with the same calendar or address, no SIRET to confirm", mode: "manual", owner: "Sales + RevOps", unit: "pairs",
    action: "Decide in the pair review", rule: "A merge that moves invoices, ARR or ownership is signed off by a person. Two different validated numbers with the same calendar or address usually mean one number is wrong. Same name + postcode without a number, or a shared calendar alone, is a strong hint, not proof." },
  { code: "no_identity", section: "Identity and duplicates", label: "No validated identity", hint: "SIREN typed instead of SIRET, empty, or no US number", mode: "auto", owner: "Registry lookup",
    action: "Look up the SIRET in SIRENE, the NPI in NPPES", rule: "A number counts as identity only once it passes its type's validation (SIRET checksum, NPI check digit). Until then it is stored but ignored by matching." },
  { code: "missing_type", section: "Structure", label: "Accounts without type", hint: "neither site, group nor network", mode: "manual", owner: "RevOps",
    action: "Set site, group or network", rule: "Every account carries a type; without it the model cannot place the record or decide between merging and attaching." },
  { code: "hierarchy_error", section: "Structure", label: "Hierarchy errors", hint: "practices with several sites, attached to a practice, loops", mode: "manual", owner: "RevOps",
    action: "Re-type or re-attach", rule: "A site sits under a group or a network; a group under a group or a network. A group under a group is valid (sub-group); the top of the chain is the ultimate parent." },
  { code: "site_to_attach", section: "Structure", label: "Sites to attach to their group", hint: "site shares SIREN or SIRET with a group", mode: "manual", owner: "RevOps",
    action: "Attach the site, do not merge", rule: "A site and a group sharing an identifier are never merged: it is a missing hierarchy link or the group's head-office site." },
  { code: "group_missing", section: "Structure", label: "Multi-site organisations without a group", hint: "one website domain across several cities", mode: "manual", owner: "RevOps",
    action: "Create the group and attach its sites", rule: "A domain shared across cities is a group to create, not a duplicate." },
  { code: "structure_question", section: "Structure", label: "Structure questions", hint: "empty groups, single-site groups", mode: "decide", owner: "Sales",
    action: "Decide: real group or not; attach sites from SIRENE", rule: "Not an error: an empty group can be a real group whose sites are not in the CRM yet. Sites with the same SIREN can be attached automatically." },
  { code: "out_of_market", section: "Market", label: "Outside the market", hint: "investors, partners, media", mode: "auto", owner: "Script",
    action: "Keep in Attio, exclude from TAM and SAM views", rule: "TAM: every site of the market. SAM: what a team addresses. Investors, partners and media are tracked with their relationship type, never counted." },
  { code: "no_country", section: "Market", label: "Accounts without country", hint: "country inferred from a French postcode", mode: "auto", owner: "Script",
    action: "Set the ISO country", rule: "Country is required: identity, matching and ownership are read market by market." },
  { code: "owner_market", section: "Market", label: "US accounts owned by the French team", hint: "expected before the first US AE, now to reassign", mode: "manual", owner: "Sales lead",
    action: "Reassign to the US team", rule: "Ownership follows the account's market." },
  { code: "enrichment_junk", section: "Market", label: "Enrichment junk", hint: "platform or webmail as website, booking URL from the wrong country", mode: "auto", owner: "Script",
    action: "Clear the field", rule: "Enrichment writes to contacts only and never overwrites an identity field with a platform or webmail domain." },
  { code: "contact_no_account", section: "Contacts", dataset: "contacts", label: "Contacts without an account", hint: "created by telephony, email sync, enrichment", mode: "manual", owner: "RevOps",
    action: "Attach by email domain, else review", rule: "A tool that creates a contact must attach it to an account found by lookup; otherwise it does not create it." },
  { code: "contact_wrong_account", section: "Contacts", dataset: "contacts", label: "Contacts on the wrong account", hint: "work-email domain owned by another account family", mode: "auto", owner: "Script",
    action: "Re-attach by email domain", rule: "When a work-email domain belongs to exactly one account family, the contact moves there." },
];
const QUEUE = Object.fromEntries(QUEUES.map((q) => [q.code, q]));
const MODE_LABEL = { auto: "Automatic", manual: "Manual", decide: "To decide" };

let data;
let decisions = {};
const explore = { queue: "all", dataset: "accounts", search: "", sources: new Set(), markets: new Set(), types: new Set(), open: null, limit: PAGE_SIZE };

// ---------- tabs and routing ----------
const TABS = ["queues", "explore", "sources", "review"];
function selectTab(name) {
  document.querySelectorAll('[role="tab"]').forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  document.querySelectorAll(".tab-panel").forEach((p) => { p.hidden = p.id !== `panel-${name}`; });
}
function route() {
  const [tab, queue] = location.hash.slice(1).split("/");
  if (tab === "explore" && queue && queue !== explore.queue && (QUEUE[queue] || queue === "all")) openQueue(queue, false);
  selectTab(TABS.includes(tab) ? tab : "queues");
}
document.querySelectorAll('[role="tab"]').forEach((b) => b.addEventListener("click", () => { location.hash = b.dataset.tab; }));
window.addEventListener("hashchange", route);

// ---------- helpers ----------
function download(name, text, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(",")).join("\n");
const marketOf = (country) => (country === "FR" || country === "US" ? country : "Other");
const rowsOf = (dataset) => (dataset === "contacts" ? data.contacts : data.accounts);
const hasQueue = (row, code) => row.issues.some((i) => i[0] === code);
function queueCount(q) {
  if (q.unit === "pairs") return data.review.length;
  return rowsOf(q.dataset || "accounts").filter((r) => hasQueue(r, q.code)).length;
}

function barList(rows, { color = "var(--series-1)", max } = {}) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.value));
  return `<div class="bar-list">${rows.map((r) => `
    <div class="bar-row"><span class="label" title="${esc(r.label)}">${esc(r.label)}</span>
      <span class="track"><span style="width:${(r.value / m) * 100}%;background:${r.color || color}"></span></span>
      <span class="value">${fmt.format(r.value)}</span></div>`).join("")}</div>`;
}

// ---------- health strip ----------
function renderHealth() {
  const h = data.health;
  const kpi = (label, value, sub) => `<div class="kpi"><span class="kpi-label">${label}</span><span class="kpi-value">${value}</span><span class="kpi-sub">${sub}</span></div>`;
  el("health").innerHTML = [
    kpi("Validated identity", pct(h.identity_validated, h.accounts), `${fmt.format(h.identity_validated)} of ${fmt.format(h.accounts)} accounts`),
    kpi("Accounts with an issue", fmt.format(h.accounts_with_issue), `${pct(h.accounts_with_issue, h.accounts)} of the base`),
    kpi("Of which created by a tool", pct(h.accounts_with_issue_from_tools, h.accounts_with_issue), `${fmt.format(h.accounts_with_issue_from_tools)} accounts: enrichment, n8n, email sync`),
    kpi("Contacts without an account", fmt.format(h.contacts_without_account), `out of ${fmt.format(h.contacts)} contacts`),
  ].join("");
}

// ---------- A. work queues ----------
function renderQueues() {
  const sections = [...new Set(QUEUES.map((q) => q.section))];
  el("panel-queues").innerHTML = `
    <p class="lead">Each line is a list of records to fix. Open it to see every record, the reason and the next action, filter it and export it.</p>
    ${sections.map((s) => `
      <div class="card queue-card">
        <h3>${esc(s)}</h3>
        <div class="queue-list">
          ${QUEUES.filter((q) => q.section === s).map((q) => {
            const n = queueCount(q);
            return `<button type="button" class="queue-row" data-queue="${q.code}">
              <span class="q-main"><strong>${esc(q.label)}</strong><span class="muted">${esc(q.hint)}</span></span>
              <span class="q-count">${fmt.format(n)}<small>${q.unit || (q.dataset === "contacts" ? "contacts" : "accounts")}</small></span>
              <span class="mode ${q.mode}">${MODE_LABEL[q.mode]}</span>
              <span class="q-owner">${esc(q.owner)}</span>
              <span class="q-open">Open →</span>
            </button>`;
          }).join("")}
        </div>
      </div>`).join("")}
    <details class="card rules-details">
      <summary>Matching rules and guards</summary>
      ${rulesHtml()}
    </details>`;
  el("panel-queues").querySelectorAll("[data-queue]").forEach((b) => b.addEventListener("click", () => {
    const q = QUEUE[b.dataset.queue];
    location.hash = q.unit === "pairs" ? "review" : `explore/${q.code}`;
  }));
}

function rulesHtml() {
  const r = data.rules;
  return `<div class="charts-2">
    <div>
      <h3>Matching keys, strongest first</h3>
      ${r.keys.map((k, i) => `
        <div class="rule-key"><span class="rank">${i + 1}</span>
          <div><strong>${esc(k.label)}</strong><br><span class="muted">${esc(k.role)}</span></div>
          <div class="stats"><b>${fmt.format(k.auto_merges)}</b> in merged pairs<br>${fmt.format(k.pairs)} candidate pairs</div></div>`).join("")}
      <p class="muted">A pair can match on several keys, so the columns overlap.</p>
    </div>
    <div>
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

// ---------- B. explorer ----------
function openQueue(code, navigate = true) {
  explore.queue = code;
  explore.dataset = code !== "all" && QUEUE[code].dataset === "contacts" ? "contacts" : (code === "all" ? explore.dataset : "accounts");
  explore.sources.clear(); explore.markets.clear(); explore.types.clear();
  explore.search = ""; explore.open = null; explore.limit = PAGE_SIZE;
  renderExplore();
  if (navigate) location.hash = `explore/${code}`;
}

function filtered({ skip } = {}) {
  const term = explore.search.trim().toLowerCase();
  return rowsOf(explore.dataset).filter((r) => {
    if (explore.queue !== "all" && !hasQueue(r, explore.queue)) return false;
    if (skip !== "source" && explore.sources.size && !explore.sources.has(r.source)) return false;
    if (explore.dataset === "accounts") {
      if (skip !== "market" && explore.markets.size && !explore.markets.has(marketOf(r.country))) return false;
      if (skip !== "type" && explore.types.size && !explore.types.has(r.type || "Missing")) return false;
    }
    if (term) {
      const hay = [r.name, r.number, r.city, r.email_domain, r.account, r.proposed_account, r.created_by, r.id].join(" ").toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  });
}

function facet(title, key, set, valueOf) {
  const counts = {};
  filtered({ skip: key }).forEach((r) => { const v = valueOf(r); counts[v] = (counts[v] || 0) + 1; });
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return "";
  return `<fieldset class="facet"><legend>${title}</legend>${entries.map(([v, n]) => `
    <label><input type="checkbox" data-facet="${key}" value="${esc(v)}"${set.has(v) ? " checked" : ""}><span>${esc(v)}</span><b>${fmt.format(n)}</b></label>`).join("")}</fieldset>`;
}

function chips(row) {
  return row.issues.map((i) => `<span class="chip${i[0] === explore.queue ? " current" : ""}">${esc(QUEUE[i[0]]?.label || i[0])}</span>`).join("");
}

function nextAction(row) {
  const issue = row.issues.find((i) => i[0] === explore.queue) || row.issues[0];
  return QUEUE[issue[0]]?.action || "";
}

function detailHtml(row) {
  const fields = explore.dataset === "accounts"
    ? [["Company number", row.number], ["Lifecycle", row.lifecycle], ["Owner", row.owner], ["City", row.city], ["Created by", row.created_by], ["Attio ID", row.id]]
    : [["Job", row.job], ["Category", row.category], ["Email domain", row.email_domain], ["Current account", row.account], ["Proposed account", row.proposed_account], ["Created by", row.created_by], ["Attio ID", row.id]];
  return `<div class="detail">
    <dl>${fields.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v || "–")}</dd>`).join("")}</dl>
    <div class="detail-issues">${row.issues.map(([code, detail]) => {
      const q = QUEUE[code] || {};
      return `<div class="detail-issue">
        <div><span class="mode ${q.mode}">${MODE_LABEL[q.mode] || ""}</span> <strong>${esc(q.label || code)}</strong></div>
        <p>${esc(detail)}</p>
        <p class="next">Next action: ${esc(q.action || "")}${q.unit === "pairs" ? ` · <a href="#review">open the pair review</a>` : ""}</p>
        <p class="rule">Rule: ${esc(q.rule || "")}</p>
      </div>`;
    }).join("")}</div>
  </div>`;
}

function renderExplore() {
  const rows = filtered();
  const shown = rows.slice(0, explore.limit);
  const isAcc = explore.dataset === "accounts";
  const q = QUEUE[explore.queue];
  const options = QUEUES.filter((x) => (x.dataset || "accounts") === explore.dataset && x.unit !== "pairs");
  const head = isAcc
    ? "<th>Account</th><th>Market</th><th>Type</th><th>Created by</th><th>Issues</th><th>Next action</th>"
    : "<th>Contact</th><th>Email domain</th><th>Current account</th><th>Proposed account</th><th>Created by</th><th>Issue</th>";
  const line = (r) => isAcc
    ? `<td><strong>${esc(r.name)}</strong><br><span class="muted">${esc(r.city || "")}</span></td><td>${esc(r.country)}</td><td>${esc(r.type || "–")}</td><td>${esc(r.source)}</td><td class="chips">${chips(r)}</td><td class="muted">${esc(nextAction(r))}</td>`
    : `<td><strong>${esc(r.name)}</strong><br><span class="muted">${esc(r.job || "")}</span></td><td>${esc(r.email_domain || "–")}</td><td>${esc(r.account || "–")}</td><td>${esc(r.proposed_account || "–")}</td><td>${esc(r.source)}</td><td class="chips">${chips(r)}</td>`;

  el("panel-explore").innerHTML = `
    <div class="explore-head">
      <div>
        <h2>${esc(q ? q.label : explore.dataset === "accounts" ? "All accounts with an issue" : "All contacts with an issue")}</h2>
        <p class="lead" style="margin:4px 0 0">${q ? `${esc(q.hint)}. Next action: <strong>${esc(q.action)}</strong> (${esc(q.owner)}).` : "Every record that sits in at least one queue."}</p>
      </div>
    </div>
    <div class="explore">
      <aside class="facets">
        <label class="facet-select">Queue
          <select id="queue-select">
            <option value="all"${explore.queue === "all" ? " selected" : ""}>All ${explore.dataset}</option>
            ${options.map((x) => `<option value="${x.code}"${x.code === explore.queue ? " selected" : ""}>${esc(x.label)}</option>`).join("")}
          </select>
        </label>
        <div class="dataset-switch" role="group" aria-label="Records">
          <button type="button" data-dataset="accounts" aria-pressed="${isAcc}">Accounts</button>
          <button type="button" data-dataset="contacts" aria-pressed="${!isAcc}">Contacts</button>
        </div>
        ${facet("Created by", "source", explore.sources, (r) => r.source)}
        ${isAcc ? facet("Market", "market", explore.markets, (r) => marketOf(r.country)) : ""}
        ${isAcc ? facet("Type", "type", explore.types, (r) => r.type || "Missing") : ""}
      </aside>
      <div class="results">
        <div class="toolbar">
          <input type="search" id="explore-search" placeholder="Search a name, number, city or domain" value="${esc(explore.search)}" aria-label="Search">
          <span class="muted">${fmt.format(rows.length)} ${explore.dataset}</span>
          <button class="btn" type="button" id="explore-export"${rows.length ? "" : " disabled"}>Export CSV</button>
        </div>
        <div class="card table-card"><div class="table-scroll"><table class="plain explore-table">
          <thead><tr>${head}</tr></thead>
          <tbody>${shown.map((r) => `<tr class="row${explore.open === r.id ? " open" : ""}" data-id="${esc(r.id)}" tabindex="0">${line(r)}</tr>${explore.open === r.id ? `<tr class="detail-row"><td colspan="6">${detailHtml(r)}</td></tr>` : ""}`).join("")
            || `<tr><td colspan="6" class="muted">No record matches these filters.</td></tr>`}</tbody>
        </table></div></div>
        ${rows.length > shown.length ? `<button class="btn more" type="button" id="explore-more">Show ${fmt.format(Math.min(PAGE_SIZE, rows.length - shown.length))} more</button>` : ""}
      </div>
    </div>`;

  el("queue-select").addEventListener("change", (e) => openQueue(e.target.value));
  el("panel-explore").querySelectorAll("[data-dataset]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.dataset === explore.dataset) return;
    explore.dataset = b.dataset.dataset;
    openQueue("all");
  }));
  el("panel-explore").querySelectorAll("[data-facet]").forEach((cb) => cb.addEventListener("change", () => {
    const set = { source: explore.sources, market: explore.markets, type: explore.types }[cb.dataset.facet];
    if (cb.checked) set.add(cb.value); else set.delete(cb.value);
    explore.limit = PAGE_SIZE; explore.open = null;
    renderExplore();
  }));
  const search = el("explore-search");
  search.addEventListener("input", () => {
    explore.search = search.value; explore.limit = PAGE_SIZE; explore.open = null;
    renderExplore();
    const again = el("explore-search"); again.focus(); again.setSelectionRange(again.value.length, again.value.length);
  });
  el("explore-export").addEventListener("click", () => exportExplore(rows));
  el("explore-more")?.addEventListener("click", () => { explore.limit += PAGE_SIZE; renderExplore(); });
  el("panel-explore").querySelectorAll("tr.row").forEach((tr) => {
    const toggle = () => { explore.open = explore.open === tr.dataset.id ? null : tr.dataset.id; renderExplore(); };
    tr.addEventListener("click", (e) => { if (!e.target.closest("a")) toggle(); });
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
  });
}

function exportExplore(rows) {
  const issues = (r) => r.issues.map(([c, d]) => `${QUEUE[c]?.label || c}: ${d}`).join(" | ");
  const table = explore.dataset === "accounts"
    ? [["record_id", "name", "country", "type", "company_number", "lifecycle", "owner", "city", "created_by", "issues", "next_action"],
      ...rows.map((r) => [r.id, r.name, r.country, r.type, r.number, r.lifecycle, r.owner, r.city, r.created_by, issues(r), nextAction(r)])]
    : [["contact_id", "name", "job", "email_domain", "current_account", "proposed_account", "created_by", "issues"],
      ...rows.map((r) => [r.id, r.name, r.job, r.email_domain, r.account, r.proposed_account, r.created_by, issues(r)])];
  download(`tam_${explore.queue}_${explore.dataset}.csv`, toCsv(table));
}

// ---------- C. quality by source ----------
function renderSources() {
  const src = [...data.sources].sort((a, b) => (b.is_tool - a.is_tool) || (b.accounts_created + b.contacts_created) - (a.accounts_created + a.contacts_created));
  const tools = src.filter((s) => s.is_tool);
  const sum = (rows, k) => rows.reduce((t, s) => t + s[k], 0);
  const allAcc = sum(src, "accounts_created");
  const allCon = sum(src, "contacts_created");
  const worst = [...tools].filter((s) => s.contacts_created).sort((a, b) => b.contacts_without_account / b.contacts_created - a.contacts_without_account / a.contacts_created)[0];
  const share = (n, d) => `<span class="share"><span class="track"><span style="width:${d ? (n / d) * 100 : 0}%"></span></span><span>${pct(n, d)}</span></span>`;

  el("panel-sources").innerHTML = `
    <p class="lead">Who creates the records, and how many of them end up in a queue. Tools created <strong>${pct(sum(tools, "accounts_created"), allAcc)}</strong> of the accounts and <strong>${pct(sum(tools, "contacts_created"), allCon)}</strong> of the contacts${worst ? `; ${esc(worst.source.toLowerCase())} leaves <strong>${pct(worst.contacts_without_account, worst.contacts_created)}</strong> of the contacts it creates without an account` : ""}. Connected, not orchestrated.</p>
    <div class="card table-card"><div class="table-scroll"><table class="plain sources-table">
      <thead><tr><th>Created by</th><th class="num">Accounts</th><th>With an issue</th><th class="num">Certain duplicates</th><th class="num">Contacts</th><th>Without an account</th><th class="num">Wrong account</th><th></th></tr></thead>
      <tbody>${src.map((s) => `<tr class="${s.is_tool ? "" : "people"}">
        <td><strong>${esc(s.source)}</strong><br><span class="muted">${s.is_tool ? "tool" : s.source === "People" ? "created by hand" : "creator not recorded"}</span></td>
        <td class="num">${fmt.format(s.accounts_created)}</td>
        <td>${s.accounts_created ? share(s.accounts_with_issue, s.accounts_created) : "–"}</td>
        <td class="num">${fmt.format(s.certain_duplicates)}</td>
        <td class="num">${fmt.format(s.contacts_created)}</td>
        <td>${s.contacts_created ? share(s.contacts_without_account, s.contacts_created) : "–"}</td>
        <td class="num">${fmt.format(s.contacts_wrong_account)}</td>
        <td><button class="btn small" type="button" data-source="${esc(s.source)}">See records</button></td>
      </tr>`).join("")}</tbody>
    </table></div></div>
    <p class="muted">"With an issue" counts accounts in at least one queue, including the ones with no validated identity. What to change per tool: enrichment writes to contacts only; email sync and telephony attach contacts to an account found by lookup and never create companies; n8n workflows upsert on the identity.</p>`;

  el("panel-sources").querySelectorAll("[data-source]").forEach((b) => b.addEventListener("click", () => {
    const s = data.sources.find((x) => x.source === b.dataset.source);
    explore.dataset = s.accounts_created ? "accounts" : "contacts";
    openQueue("all", false);
    explore.sources.add(b.dataset.source);
    renderExplore();
    location.hash = "explore/all";
  }));
}

// ---------- pair review ----------
const loadDecisions = () => { try { return JSON.parse(localStorage.getItem(REVIEW_STORE)) || {}; } catch { return {}; } };
const saveDecisions = (d) => { try { localStorage.setItem(REVIEW_STORE, JSON.stringify(d)); } catch { /* storage unavailable: decisions live for this visit only */ } };
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
    <p class="lead">Pairs the rules refuse to merge without a human: a customer is involved, two valid numbers share a calendar or an address, there is no SIRET to confirm, or only the calendar matches. Fields in <span style="color:var(--brand);font-weight:600">blue</span> are identical on both records.</p>
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
  renderHealth();
  renderQueues();
  renderExplore();
  renderSources();
  renderReview();
  route();
}

init().catch((err) => {
  document.querySelector(".page").insertAdjacentHTML("afterbegin", `<p class="card">Could not load the cockpit data: ${esc(err.message)}.</p>`);
});
