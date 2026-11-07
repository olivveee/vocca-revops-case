"use strict";

// Four slides for Part 1B. Figures come from data/tam_cockpit.json, written by
// scripts/tam_dedup.py, so the slides, the cockpit and the action pack always agree.

const fmt = new Intl.NumberFormat("en-GB");
const AUTOMATIONS = ["API · enrichment pipeline", "API · n8n", "Attio · auto-created from email sync"];
const ICONS = {
  id: '<path d="M4 5h16v14H4z"/><circle cx="9" cy="11" r="2"/><path d="M6.5 16c.6-1.6 1.6-2.4 2.5-2.4s1.9.8 2.5 2.4M14 10h4M14 13h3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  euro: '<path d="M17 6.5A7 7 0 1 0 17 17.5M4 10h9M4 14h9"/>',
  tree: '<rect x="9" y="3" width="6" height="4" rx="1"/><rect x="3" y="17" width="6" height="4" rx="1"/><rect x="15" y="17" width="6" height="4" rx="1"/><path d="M12 7v5M6 17v-5h12v5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.2-4 4.3-6 8-6s6.8 2 8 6"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
const mark = (n) => `<span class="footer-mark">Vocca · Senior RevOps case · Part 1B · ${n} / 4</span>`;

function slides(d) {
  const c = d.current;
  const s = d.summary;
  const mi = s.market_issues || {};
  const noId = Math.round(((c.accounts - c.company_number_validated) / c.accounts) * 100);
  const dupTotal = Object.values(d.duplicate_sources).reduce((t, v) => t + v, 0);
  const dupAuto = Object.entries(d.duplicate_sources).filter(([k]) => AUTOMATIONS.includes(k)).reduce((t, [, v]) => t + v, 0);
  const hierTotal = Object.values(s.hierarchy_issues).reduce((t, v) => t + v, 0);
  const wrongAccount = s.contact_moves["email domain belongs to another account family"] || 0;
  const us = s.markets.US || { accounts: 0 };

  return [
    `<section class="slide">
      <p class="kicker">1 · What is wrong today</p>
      <h2>The base cannot tell us what our market is</h2>
      <p class="sub">${fmt.format(c.accounts)} accounts in Attio, read as they are.</p>
      <div class="body"><div class="problems">
        <div class="problem">${icon("id")}<span class="num">${noId}%</span><span class="what">No reliable identity</span><span class="why">No validated SIRET in France, no valid NPI on any of the ${us.accounts} US accounts</span></div>
        <div class="problem">${icon("copy")}<span class="num">${fmt.format(s.records_removed_by_auto_merge)}</span><span class="what">Certain duplicates</span><span class="why">+ ${fmt.format(d.review.length)} pairs that need a human</span></div>
        <div class="problem">${icon("euro")}<span class="num">€${(c.arr_double_counted_eur / 1e6).toFixed(1)}M</span><span class="what">ARR counted twice</span><span class="why">On a site and on its group, out of €${(c.customer_arr_eur / 1e6).toFixed(1)}M customer ARR</span></div>
        <div class="problem">${icon("tree")}<span class="num">${fmt.format(hierTotal)}</span><span class="what">Hierarchy breaks</span><span class="why">${fmt.format(mi.group_missing || 0)} multi-site organisations with no group, groups under practices, loops</span></div>
        <div class="problem">${icon("globe")}<span class="num">${fmt.format(mi.owner_market_mismatch || 0)}</span><span class="what">US accounts owned by the French team</span><span class="why">+ ${fmt.format(mi.out_of_tam || 0)} investors, partners and media counted in the TAM</span></div>
        <div class="problem">${icon("person")}<span class="num">${fmt.format(wrongAccount)}</span><span class="what">Contacts on the wrong account</span><span class="why">+ ${fmt.format(c.contacts_without_company)} contacts with no company</span></div>
      </div>
      <div class="takeaway">The mess is produced continuously: <b>${Math.round((dupAuto / dupTotal) * 100)}% of the duplicates were created by automations</b> (enrichment, n8n, email sync) that insert instead of updating.</div></div>
      ${mark(1)}
    </section>`,

    `<section class="slide">
      <p class="kicker">2 · The model</p>
      <h2>One account model, one identity, every market</h2>
      <div class="body">
        <div class="model">
          <div class="panel">
            <h3>What an account is</h3>
            <div class="tree">
              <div class="node"><b>Network</b><span>a chain of groups</span></div><div></div>
              <div class="down">↓</div><div></div>
              <div class="node"><b>Group</b><span>decision and framework contract</span></div><div class="node side"><b>Legal entity</b><span>contracts, invoices; linked, not a level</span></div>
              <div class="down">↓</div><div></div>
              <div class="node account"><b>Site = the account</b><span>one place, one calendar: what Vocca deploys and bills. ARR lives here</span></div><div class="node side"><b>Practitioner</b><span>pricing driver, champion; can work at several sites</span></div>
            </div>
          </div>
          <div class="panel">
            <h3>One generic identity in Attio</h3>
            <table class="identity">
              <thead><tr><th>Field</th><th>France</th><th>United States</th></tr></thead>
              <tbody>
                <tr><td><code>country</code></td><td>FR</td><td>US</td></tr>
                <tr><td><code>company_number</code> + type</td><td>SIRET</td><td>NPI (organisation)</td></tr>
                <tr><td><code>legal_entity</code></td><td>SIREN</td><td>legal name + state</td></tr>
                <tr><td><code>practitioner_number</code></td><td>RPPS</td><td>NPI (individual)</td></tr>
              </tbody>
            </table>
            <p class="note">Validated per type, then the <b>only dedupe key</b>. Fallbacks everywhere: booking URL, address, phone, domain, name + postcode. Country-specific columns stay upstream.</p>
          </div>
        </div>
        <p class="rules-title">Never merged automatically</p>
        <div class="rules">
          <div class="rule"><span class="x">✕</span><div><b>Two validated numbers</b><span>two sites, even of one company: link, never merge</span></div></div>
          <div class="rule"><span class="x">✕</span><div><b>A customer or two owners</b><span>a human signs off any merge that moves ARR or ownership</span></div></div>
          <div class="rule"><span class="x">✕</span><div><b>Phone, domain or name alone</b><span>shared by groups; a domain across cities is a group to create</span></div></div>
        </div>
      </div>
      ${mark(2)}
    </section>`,

    `<section class="slide">
      <p class="kicker">3 · The build</p>
      <h2>Master record in the warehouse, Attio as the operational copy</h2>
      <div class="body">
        <div class="flow">
          <div class="stage">
            <span class="tag">Sources, per market</span>
            <div class="market"><b>France</b><div class="chips"><span class="chip-s">SIRENE</span><span class="chip-s">RPPS</span><span class="chip-s">FINESS</span><span class="chip-s">Doctolib pages</span></div></div>
            <div class="market"><b>United States</b><div class="chips"><span class="chip-s">NPPES (NPI)</span><span class="chip-s">CMS provider data</span><span class="chip-s">state boards</span></div></div>
            <div class="market"><b>Internal</b><div class="chips"><span class="chip-s">Attio</span><span class="chip-s">Hyperline</span><span class="chip-s">enrichment (contacts only)</span></div></div>
          </div>
          <div class="arrow">→</div>
          <div class="stage core">
            <span class="tag">Warehouse · nightly</span>
            <h3>Golden site, group, legal entity, practitioner</h3>
            <ol class="steps">
              <li><i>1</i>Normalise into the generic model</li>
              <li><i>2</i>Validate numbers, match on keys</li>
              <li><i>3</i>Survivor: customer, deals, completeness</li>
              <li><i>4</i>Tests: no loops, ARR on one level</li>
            </ol>
          </div>
          <div class="arrow">→</div>
          <div class="stage">
            <span class="tag">Attio · daily sync</span>
            <h3>What Sales sees</h3>
            <div class="chips"><span class="chip-s">generic identity</span><span class="chip-s">hierarchy</span><span class="chip-s">master ID</span><span class="chip-s">market</span></div>
            <p class="note" style="margin:0">Attio writes back only what Sales owns: owner, lifecycle, notes.</p>
          </div>
        </div>
        <div class="guards">
          <div class="panel">
            <h3>Stays clean by design</h3>
            <ul>
              <li><b>Unique, validated</b> company number per country</li>
              <li>Automations <b>upsert</b>, never insert</li>
              <li><b>Lookup before create</b> in Attio</li>
              <li>Country required, <b>ownership by market</b></li>
            </ul>
          </div>
          <div class="panel">
            <h3>Humans where it matters</h3>
            <p class="note" style="margin:0">Weekly review queue owned by RevOps: <b>${fmt.format(d.review.length)}</b> pairs today. Data-quality KPIs per market, every week.</p>
          </div>
        </div>
      </div>
      ${mark(3)}
    </section>`,

    `<section class="slide">
      <p class="kicker">4 · Recommendations</p>
      <h2>Stop the bleeding first, then build the master</h2>
      <div class="body">
        <div class="roadmap">
          <div></div>${[1, 2, 3, 4, 5, 6, 7, 8].map((w) => `<div class="wk">W${w}</div>`).join("")}
          <div class="label"><b>P0</b>Stop the bleeding</div><div class="bar" style="grid-column: span 1">Identity + upserts</div><div style="grid-column: span 7"></div>
          <div class="label"><b>P0</b>Fix what breaks reporting</div><div class="bar" style="grid-column: span 2">${fmt.format(s.records_removed_by_auto_merge)} merges · ARR on sites</div><div style="grid-column: span 6"></div>
          <div class="label"><b>P1</b>Master record</div><div></div><div class="bar p1" style="grid-column: span 4">Warehouse models + sync to Attio</div><div style="grid-column: span 3"></div>
          <div class="label"><b>P1</b>Clear queues · US identity</div><div></div><div class="bar p1" style="grid-column: span 3">${fmt.format(d.review.length)} reviews · NPI for ${us.accounts} US accounts</div><div style="grid-column: span 4"></div>
          <div class="label"><b>P2</b>Size and score the TAM</div><div style="grid-column: span 4"></div><div class="bar p2" style="grid-column: span 3">Registries per market, US first</div><div></div>
          <div class="label"><b>P3</b>Run it</div><div style="grid-column: span 2"></div><div class="bar p3" style="grid-column: span 6">Weekly KPIs and review, warehouse tests</div>
        </div>
        <div class="closing">
          <div class="big">6 to 8 weeks, one person<span>Visible value in week 2: duplicates merged, ARR counted once, US accounts with their team.</span></div>
          <a class="cta" href="tam.html">Open the TAM cockpit →</a>
        </div>
      </div>
      ${mark(4)}
    </section>`,
  ];
}

// ---------- navigation ----------
let current = 0;
let total = 0;
function show(i) {
  const all = document.querySelectorAll(".slide");
  current = Math.max(0, Math.min(total - 1, i));
  all.forEach((el, n) => el.classList.toggle("active", n === current));
  document.getElementById("counter").textContent = `${current + 1} / ${total}`;
  history.replaceState(null, "", `#${current + 1}`);
}
document.getElementById("prev").addEventListener("click", () => show(current - 1));
document.getElementById("next").addEventListener("click", () => show(current + 1));
document.getElementById("fullscreen").addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
});
document.addEventListener("keydown", (e) => {
  if (["ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); show(current + 1); }
  if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); show(current - 1); }
  if (e.key === "Home") show(0);
  if (e.key === "End") show(total - 1);
  if (e.key === "f") document.getElementById("fullscreen").click();
});

window.addEventListener("hashchange", () => {
  const n = parseInt(location.hash.slice(1), 10);
  if (Number.isFinite(n) && n - 1 !== current) show(n - 1);
});

fetch("data/tam_cockpit.json", { cache: "no-store" })
  .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
  .then((d) => {
    const html = slides(d);
    total = html.length;
    document.getElementById("deck").innerHTML = html.join("");
    const fromHash = parseInt(location.hash.slice(1), 10);
    show(Number.isFinite(fromHash) ? fromHash - 1 : 0);
  })
  .catch((err) => {
    document.getElementById("deck").innerHTML = `<section class="slide active"><h2>Could not load the data</h2><p class="sub">${String(err.message)}</p></section>`;
  });
